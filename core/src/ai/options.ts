/**
 * 候选动作生成（ADR-084）
 *
 * 这一层的**唯一职责**是：把当前局面下所有「引擎会接受」的动作列出来，并给每个动作
 * 一个廉价的预排序分（`quick`），好让搜索层把模拟次数花在最像样的候选上。
 *
 * 两条硬约束：
 *   ① **合法性一律取自引擎**：攻击目标用 `legalTargets`、出牌用 `canPlayCard`、
 *      技能用 `canUseUnitSkill`、指向性选择用 `playTargetPlan` / `unitSkillTargetPlan`
 *      / `lordSkillTargetPlan`。AI 不自己判断"这个目标合不合法"——
 *      旧版 AI 就因为自己瞎猜目标，让引擎退回兜底目标，表现为"技能指向乱选"。
 *   ② **确定性**：候选的产出顺序只依赖局面，不依赖随机；打平时先出现的胜出。
 */

import { createRng } from '../rng.ts';
import { allUnits, getUnit, hasTrait, other } from '../state.ts';
import {
  canAttack, canPlayCard, canUseLordSkill, canUseUnitSkill, effectiveAttack, legalPlacements, legalTargets,
} from '../rules.ts';
import { effectiveCost, isBanned } from '../mutate.ts';
import { costRuleDelta } from '../effects.ts';
import {
  lordSkillTargetPlan, playTargetPlan, unitSkillTargetPlan,
  type PlayTargetChoice, type PlayTargetPlan,
} from '../engine.ts';
import { cardBudget, isCharacterCard, picksEnemySide, unitValueOf } from './cards.ts';
import type { EvalWeights } from './profile.ts';
import type { Action, CardDef, MatchState, Row, Side, SkillDef } from '../types.ts';

export type OptionKind = 'attack' | 'play' | 'skill' | 'lord';

export interface AiOption {
  action: Action;
  kind: OptionKind;
  /** 人类可读标签（冒烟日志 / 统计报表用） */
  label: string;
  /** 预排序分：越大越像好棋；只用于决定谁先被模拟 */
  quick: number;
}

/** 单个类别最多产出多少候选（防止"8 个攻击者 × 9 个目标"把预算吃光） */
const CAP = { attack: 32, play: 28, skill: 24, lord: 6 } as const;

/** 指向性选择各自最多试几个目标（先按启发式排序） */
const PICK1_CAP = 4;
const PICK2_CAP = 3;

interface Ref { side: Side; row?: Row; col?: number }

/** 把 plan 里的目标转成 action 上的写法（主将没有 row/col） */
const toActionTarget = (t: { kind: 'unit' | 'lord'; side: Side; row?: Row; col?: number }): Ref =>
  t.kind === 'lord' ? { side: t.side } : { side: t.side, row: t.row, col: t.col };

/* ============================================================
   ① 攻击
   ============================================================ */

function attackOptions(state: MatchState, w: EvalWeights): AiOption[] {
  const side = state.active;
  const foe = other(side);
  const out: AiOption[] = [];
  const lordEff = state.sides[foe].lord.hp + state.sides[foe].lord.armor;

  for (const ref of allUnits(state, side)) {
    if (!canAttack(state, side, ref.row, ref.col).ok) continue;
    const dmg = effectiveAttack(state, side, ref.row, ref.col);
    const me = ref.unit;
    const myValue = unitValueOf(me, (k) => hasTrait(me, k));
    for (const t of legalTargets(state, side, ref.row, ref.col).targets) {
      if (t.kind === 'lord') {
        const lethal = dmg >= lordEff;
        out.push({
          kind: 'attack',
          action: { type: 'ATTACK', from: { row: ref.row, col: ref.col }, to: { kind: 'lord' } },
          label: `${me.name} → 主将 ${dmg}`,
          quick: lethal ? 1e6 : dmg * w.face * 2,
        });
        continue;
      }
      const target = getUnit(state, foe, t.row as Row, t.col as number);
      if (!target) continue;
      const tv = unitValueOf(target, (k) => hasTrait(target, k));
      const kills = dmg >= target.hp;
      const retaliate = effectiveAttack(state, foe, t.row as Row, t.col as number);
      const iDie = retaliate >= me.hp;
      // 预排序：能白吃（击杀且自己活）最优先；同归于尽打折；换不掉又挨打最低
      let quick = kills ? (iDie ? tv * 0.35 : tv * 1.5) : dmg * 1.1 - Math.min(dmg, target.hp) * 0.1;
      if (!kills && iDie) quick -= myValue * 0.5;
      if (kills && !iDie) quick += 3;
      out.push({
        kind: 'attack',
        action: {
          type: 'ATTACK', from: { row: ref.row, col: ref.col },
          to: { kind: 'unit', row: t.row as Row, col: t.col as number },
        },
        label: `${me.name} → ${target.name}${kills ? '（击杀）' : ''}`,
        quick,
      });
    }
  }
  return out.sort((a, b) => b.quick - a.quick).slice(0, CAP.attack);
}

/* ============================================================
   ② 出牌（含战吼目标与抉择分支）
   ============================================================ */

/** 人物卡的落点：只有「相邻」类效果才值得逐格比较，其余位置等价 */
function slotsFor(state: MatchState, side: Side, card: CardDef): Array<{ row: Row; col: number }> {
  const spots = legalPlacements(state, side);
  if (!spots.length) return [];
  const adjacencySensitive = (card.skills ?? []).some((sk) =>
    effectsOfSkill(sk).some((e) => e.target?.filter?.adjacent_to === 'self'));
  return adjacencySensitive ? spots : [spots[0] as { row: Row; col: number }];
}

const effectsOfSkill = (sk: SkillDef): NonNullable<SkillDef['effects']> =>
  sk.modes?.length ? sk.modes.flatMap((m) => m.effects ?? []) : (sk.effects ?? []);

/** 一个候选目标对某个效果有多值得被选 */
function rankTarget(
  state: MatchState, side: Side, choice: PlayTargetChoice, w: EvalWeights,
  t: { kind: 'unit' | 'lord'; side: Side; row?: Row; col?: number },
): number {
  const dir = picksEnemySide(choice.action, choice.sides);
  if (choice.action === 'heal' || choice.action === 'survive') {
    if (t.kind === 'lord') return 1;                              // 主将满血时治疗没意义
    const u = getUnit(state, t.side, t.row as Row, t.col as number);
    if (!u) return 0;
    return (u.maxHp - u.hp) * 3 + unitValueOf(u, (k) => hasTrait(u, k)) * 0.2;
  }
  if (t.kind === 'lord') {
    const lord = state.sides[t.side].lord;
    const eff = lord.hp + lord.armor;
    if (dir === 'ally') return 0;
    // 打主将：血越少越值；对我们自己人（side:'both' 的伤害）则越值越不该选
    return t.side === side ? -eff : (40 - eff) * 0.5 * w.face;
  }
  const u = getUnit(state, t.side, t.row as Row, t.col as number);
  if (!u) return 0;
  const v = unitValueOf(u, (k) => hasTrait(u, k));
  if (dir === 'ally') return v;
  if (dir === 'enemy') return t.side === side ? -v : v;
  return v;
}

/** 目标的可读写法：以**施法方**为参照（"我" = 自己人），日志里不会把敌我读反 */
function brief(t: Ref, self: Side): string {
  const who = t.side === self ? '我' : '敌';
  return t.col === undefined ? `${who}·主将` : `${who}·第${t.col + 1}格`;
}

/** 一组「分支 + 目标」选择 */
interface PlanCombo { modeIndex?: number; target?: Ref; target2?: Ref; label: string }

/**
 * 把一个 plan 展开成若干组合
 *
 * `planFor(modeIndex)` 必须按分支现算 —— 抉择的两个分支往往有**不同的选择器**
 * （曹彰「猛袭」：一个分支打人、一个分支加攻），只算 mode 0 会漏掉另一支。
 */
function combosOf(
  state: MatchState, side: Side, planFor: (mi?: number) => PlayTargetPlan,
  w: EvalWeights, modeCount: number,
): PlanCombo[] {
  const modeIndexes: Array<number | undefined> = modeCount > 1
    ? Array.from({ length: modeCount }, (_, i) => i)
    : [undefined];
  const out: PlanCombo[] = [];

  const rankAndCap = (c: PlayTargetChoice, cap: number): Array<Ref | undefined> => {
    const ranked = [...c.targets]
      .map((t) => ({ t, s: rankTarget(state, side, c, w, t) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, cap)
      .map((x) => toActionTarget(x.t));
    // 池子为空但含手牌（UI 表达不了）→ 不带目标，让引擎按自己的兜底规则选
    if (!ranked.length && c.includesHand) return [undefined];
    return ranked;
  };

  for (const mi of modeIndexes) {
    const plan = planFor(mi);
    const c1 = plan.choices.find((c) => c.pick === 1);
    const c2 = plan.choices.find((c) => c.pick === 2);
    const picks1 = c1 ? rankAndCap(c1, PICK1_CAP) : [undefined];
    const picks2 = c2 ? rankAndCap(c2, PICK2_CAP) : [undefined];
    for (const p1 of picks1) {
      for (const p2 of picks2) {
        const parts: string[] = [];
        if (mi !== undefined) parts.push(plan.modes[mi] ?? `#${mi}`);
        if (p1) parts.push(`${c1?.action ?? '?'}→${brief(p1, side)}`);
        if (p2) parts.push(`${c2?.action ?? '?'}→${brief(p2, side)}`);
        out.push({ modeIndex: mi, target: p1, target2: p2, label: parts.join(' ') });
      }
    }
  }
  return out;
}

function playOptions(state: MatchState, w: EvalWeights): AiOption[] {
  const side = state.active;
  const s = state.sides[side];
  const out: AiOption[] = [];
  // 费用一律走引擎同一套算法（卡面 + cost_rule + 手牌修正），
  // 否则 AI 会以为打得起 / 打不起，与引擎判定分叉
  const rng = createRng(state.rngState);

  s.hand.forEach((hc, i) => {
    if (isBanned(hc)) return;
    const card = hc.card;
    const cost = effectiveCost(hc, costRuleDelta(state, card, side, rng));
    const isChar = isCharacterCard(card);
    const slots = isChar ? slotsFor(state, side, card) : [undefined];
    if (isChar && !slots.length) return;                     // 场上已满
    const base = -cost * w.mana + cardBudget(cost) * 0.35;

    for (const slot of slots) {
      const check = canPlayCard(state, side, card, slot, cost);
      if (!check.ok) continue;
      const p0 = playTargetPlan(state, side, card, 0);
      const modeCount = p0.modes.length || 1;
      const combos = combosOf(state, side, (mi) => playTargetPlan(state, side, card, mi), w, modeCount);
      for (const cb of combos) {
        out.push({
          kind: 'play',
          action: {
            type: 'PLAY_CARD', cardIndex: i,
            ...(slot ? { row: slot.row, col: slot.col } : {}),
            ...(cb.target ? { target: cb.target as { side: Side; row: Row; col: number } } : {}),
            ...(cb.target2 ? { target2: cb.target2 as { side: Side; row: Row; col: number } } : {}),
            ...(cb.modeIndex !== undefined ? { modeIndex: cb.modeIndex } : {}),
          },
          label: `出 ${card.name}${slot ? ` → 第${slot.col + 1}格` : ''}${cb.label ? ` [${cb.label}]` : ''}`,
          quick: base + (isChar ? 2 : 0),
        });
      }
    }
  });
  return out.sort((a, b) => b.quick - a.quick).slice(0, CAP.play);
}

/* ============================================================
   ③ 人物主动技 / ④ 主公技
   ============================================================ */

function skillOptions(state: MatchState, w: EvalWeights): AiOption[] {
  const side = state.active;
  const out: AiOption[] = [];
  for (const ref of allUnits(state, side)) {
    const gate = canUseUnitSkill(state, side, ref.row, ref.col);
    if (!gate.ok || !gate.skill) continue;
    const sk = gate.skill;
    const p0 = unitSkillTargetPlan(state, side, ref.row, ref.col, 0);
    const modeCount = p0.modes.length || 1;
    const combos = combosOf(state, side,
      (mi) => unitSkillTargetPlan(state, side, ref.row, ref.col, mi ?? 0), w, modeCount);
    const handPicks = needsHandIndex(sk) ? handPickCandidates(state, side) : [undefined];
    for (const cb of combos) {
      for (const hi of handPicks) {
        out.push({
          kind: 'skill',
          action: {
            type: 'USE_SKILL', row: ref.row, col: ref.col,
            ...(cb.target ? { target: cb.target } : {}),
            ...(cb.modeIndex !== undefined ? { modeIndex: cb.modeIndex } : {}),
            ...(hi !== undefined ? { handIndex: hi } : {}),
          },
          label: `${ref.unit.name}·${sk.name || '主动技'}${cb.label ? ` [${cb.label}]` : ''}`
            + (hi !== undefined ? ` [弃第${hi + 1}张]` : ''),
          quick: 2 + (sk.cost ?? 0) * 0.1,
        });
      }
    }
  }
  return out.sort((a, b) => b.quick - a.quick).slice(0, CAP.skill);
}

function lordOptions(state: MatchState, w: EvalWeights): AiOption[] {
  const side = state.active;
  // 门控与引擎同源（rules.canUseLordSkill）：AI 不再自己抄一份，也就不会漏掉「进言」
  const gate = canUseLordSkill(state, side);
  if (!gate.ok || !gate.skill) return [];
  const sk = gate.skill;
  const out: AiOption[] = [];
  const p0 = lordSkillTargetPlan(state, side, 0);
  const modeCount = p0.modes.length || 1;
  const handPicks = needsHandIndex(sk) ? handPickCandidates(state, side) : [undefined];
  for (const cb of combosOf(state, side, (mi) => lordSkillTargetPlan(state, side, mi ?? 0), w, modeCount)) {
    for (const hi of handPicks) {
      out.push({
        kind: 'lord',
        action: {
          type: 'USE_LORD_SKILL',
          ...(cb.target ? { target: cb.target } : {}),
          ...(cb.modeIndex !== undefined ? { modeIndex: cb.modeIndex } : {}),
          ...(hi !== undefined ? { handIndex: hi } : {}),
        },
        label: `主公技 ${sk.name || ''}${cb.label ? ` [${cb.label}]` : ''}`
          + (hi !== undefined ? ` [弃第${hi + 1}张]` : ''),
        quick: 1,
      });
    }
  }
  return out.slice(0, CAP.lord);
}

/* ============================================================
   工具
   ============================================================ */

/**
 * 该技能是否要「从手牌里挑一张」（引擎读 `ctx.handIndex`，缺省是随机挑）
 *
 * 两种：`discard`（永久损失，华佗青囊按它的统率回血）与 `cycle_to_deck`
 * （回牌库再抽，孙权坐断东南）。**不给 handIndex 就是随机** ——
 * 对玩家等于"系统替我乱扔牌"，对 AI 等于放弃选择权。
 */
function needsHandIndex(sk: SkillDef): boolean {
  return effectsOfSkill(sk).some((e) =>
    (e.action === 'discard' && e.mode === 'choose') || e.action === 'cycle_to_deck');
}

/**
 * 要从手里挑哪几张来试（返回手牌下标；空手牌时给 [undefined] 表示不指定）
 *
 * 不预设"扔最便宜的那张"：华佗青囊的**治疗量 = 弃牌的统率**，
 * 扔贵牌治得多、扔便宜牌亏得少 —— 这是真的取舍，交给模拟去算。
 * 只挑三张有代表性的（最贵 / 最便宜 / 中间），把预算花在刀刃上。
 */
function handPickCandidates(state: MatchState, side: Side): Array<number | undefined> {
  const hand = state.sides[side].hand;
  if (!hand.length) return [undefined];
  const byCost = hand.map((hc, i) => ({ i, cost: hc.card.cost ?? 0 }))
    .sort((a, b) => a.cost - b.cost || a.i - b.i);
  const picks = new Set<number>();
  picks.add(byCost[0]!.i);
  picks.add(byCost[byCost.length - 1]!.i);
  picks.add(byCost[Math.floor(byCost.length / 2)]!.i);
  return [...picks].sort((a, b) => a - b);
}

/** 当前局面下全部候选动作（已按 `quick` 预排序、按类别限量） */
export function generateOptions(state: MatchState, w: EvalWeights): AiOption[] {
  if (state.winner) return [];
  const attacks = attackOptions(state, w);
  const plays = playOptions(state, w);
  const skills = skillOptions(state, w);
  const lords = lordOptions(state, w);
  // 类别内已按 quick 排序；合并后再整体排序，打平时按稳定顺序（攻击 → 出牌 → 技能 → 主公技）取胜者
  return [...attacks, ...plays, ...skills, ...lords].sort((a, b) => b.quick - a.quick);
}
