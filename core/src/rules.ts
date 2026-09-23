/**
 * 规则引擎：攻击合法性、部署合法性、有效攻击力
 *
 * 对应 docs/gdd/02-battlefield.md §3 的 4 条规则：
 *   ① 近战只能攻击同列
 *   ② 目标列前军为空 → 打该列后军（穿透）
 *   ③ 该列两排皆空 → 可打主将（破阵斩将）
 *   ④ 架盾最高优先级（可跨列；仅前军生效；不阻挡打主将）
 */

import { BOARD, DECK } from './constants.ts';
import {
  allUnits, getUnit, hasCap, hasCapOn, hasKeyword, hasTrait, other, shieldUnits, statusStacks, unitCount,
} from './state.ts';
import type { CardDef, MatchState, Row, Side, SkillDef, Unit } from './types.ts';

export interface Target {
  kind: 'unit' | 'lord';
  side: Side;
  row?: Row;
  col?: number;
}

export interface TargetResult {
  targets: Target[];
  why: string;
}

export interface Check {
  ok: boolean;
  reason?: string;
}

/** 是否近战（非神射、非谋臣） */
export const isMelee = (u: Unit): boolean =>
  u.type !== 'strategist' && !hasTrait(u, 'shen_she');

/**
 * 能否使用某单位的主动技（GDD 10 §1.1：默认每回合 1 次）。
 *
 * 规则放在这里而不是 engine 里，是为了让 **AI 与引擎共用同一判定**——
 * 否则 AI 会提出引擎必拒的动作（曾导致对局在回合中途直接停摆）。
 */
export function canUseUnitSkill(
  state: MatchState, side: Side, row: Row, col: number,
): Check & { skill?: SkillDef } {
  const u = getUnit(state, side, row, col);
  if (!u) return { ok: false, reason: '该格没有单位' };
  if (hasCap(u, 'block_action') || hasCap(u, 'block_skill')) return { ok: false, reason: '被禁用技能' };
  const skill = (u.skills ?? []).find((sk) => sk.kind === 'active');
  if (!skill) return { ok: false, reason: '没有主动技' };
  const key = skill.id || skill.name || '0';
  const freq = skill.frequency ?? 'once_per_turn';
  if (freq === 'once' && u.skillsUsedOnce.includes(key)) return { ok: false, reason: '本局已用过' };
  if (freq === 'once_per_turn' && (u.skillUsesThisTurn[key] ?? 0) >= 1) {
    return { ok: false, reason: '本回合已用过' };
  }
  if (state.sides[side].command.cur < (skill.cost ?? 0)) return { ok: false, reason: '统率值不足' };
  return { ok: true, skill };
}

/** 能否普通攻击（与目标无关的限制） */
export function canAttack(state: MatchState, side: Side, row: Row, col: number): Check {
  const u = getUnit(state, side, row, col);
  if (!u) return { ok: false, reason: '该格没有人物卡' };
  // ADR-051：谋臣也可以普通攻击（默认 1 攻）——原「谋臣不能普攻」已取消
  if (hasCap(u, 'block_action') || hasCap(u, 'block_attack')) {
    return { ok: false, reason: '当前状态无法普通攻击' };
  }
  const maxAttacks = hasTrait(u, 'lian_ji') ? 2 : 1;
  if (u.attackedThisTurn >= maxAttacks) {
    return { ok: false, reason: `本回合已攻击 ${u.attackedThisTurn} 次` };
  }
  // 「先攻」= 入场当回合即可攻击（ADR-054：设计者裁定「疾行 = 先攻」，已合并为同名）
  if (u.enteredTurn === state.turn && !hasTrait(u, 'xian_gong')) {
    return { ok: false, reason: '本回合入场，无法攻击（「先攻」除外）' };
  }
  return { ok: true };
}

/** 有效攻击力（含振奋/虚弱/结阵） */
export function effectiveAttack(state: MatchState, side: Side, row: Row, col: number): number {
  const u = getUnit(state, side, row, col);
  if (!u) return 0;
  let atk = u.atk;
  atk += statusStacks(u, 'zhen_fen');
  atk -= statusStacks(u, 'xu_ruo');
  // 「结阵」已移除（ADR-067）：引擎里"相邻有友方步兵时 +1 攻"是 AI 自己推的，
  // 设计者从未给出机制，且 0 张卡在用 —— 与先攻/无双/武圣同属需清理的编造内容。
  return Math.max(0, atk);
}

/**
 * 计算合法攻击目标（docs/gdd/02-battlefield.md §3.2 / §3.3）
 */
export function legalTargets(state: MatchState, side: Side, row: Row, col: number): TargetResult {
  const u = getUnit(state, side, row, col);
  if (!u) return { targets: [], why: '空格' };

  const gate = canAttack(state, side, row, col);
  if (!gate.ok) return { targets: [], why: gate.reason as string };

  const foe = other(side);

  // 规则① 架盾＝嘲讽（ADR-051）：敌方存在「架盾」单位时，普通攻击**只能**打它们
  const shields = shieldUnits(state, foe);
  if (shields.length) {
    return {
      targets: shields.map((sh) => ({ kind: 'unit' as const, side: foe, row: sh.row, col: sh.col })),
      why: `敌方存在「架盾」${
        shields.map((sh) => `第${sh.col + 1}格`).join('、')
      } → 必须先攻击它（嘲讽）`,
    };
  }

  // 规则② 无架盾 → 可自由攻击任意敌方人物（翻面/奇袭者不可被指定）
  const targets: Target[] = allUnits(state, foe)
    .filter(({ unit }) => unit.hp > 0                    // 已阵亡但尚未移出场的（结算中途）不算
      && !hasCap(unit, 'untargetable') && !hasTrait(unit, 'qi_xi'))
    .map(({ row: r, col: c }) => ({ kind: 'unit' as const, side: foe, row: r, col: c }));

  // 规则③ 也可以直接攻击主将（ADR-051：取消「必须先清空一列」的破阵限制）
  // ADR-074：主帅身上带 `untargetable`（空城计「空城」）时不可被指定为攻击目标。
  // 只挡**普通攻击** —— 效果伤害（战法/技能）仍可打主将，与卡面「无法攻击」一致。
  if (!hasCapOn(state.sides[foe].lord.statuses, 'untargetable')) {
    targets.push({ kind: 'lord', side: foe });
  }

  return {
    targets,
    why: '无敌方架盾 → 可自由选择任意敌方人物，或直接攻击敌方主将',
  };
}

/** 可部署的格子 */
export function legalPlacements(state: MatchState, side: Side): Array<{ row: Row; col: number }> {
  const out: Array<{ row: Row; col: number }> = [];
  if (unitCount(state, side) >= BOARD.MAX_UNITS) return out;
  for (const row of BOARD.ROWS) {
    for (let col = 0; col < BOARD.COLS; col++) {
      if (!state.sides[side].rows[row][col]) out.push({ row, col });
    }
  }
  return out;
}

/** 能否打出这张牌 */
export function canPlayCard(
  state: MatchState,
  side: Side,
  card: CardDef,
  slot?: { row: Row; col: number },
  costOverride?: number,          // 手牌费用修正后的实际费用（ADR-038）
): Check {
  const s = state.sides[side];
  const cost = costOverride ?? card.cost ?? 0;
  if (cost > s.command.cur) {
    return { ok: false, reason: `统率值不足（需要 ${cost}，当前 ${s.command.cur}）` };
  }
  if (card.type === 'troop' || card.type === 'general' || card.type === 'strategist') {
    if (!slot) return { ok: false, reason: '人物卡需要指定部署位置' };
    if (state.sides[side].rows[slot.row][slot.col]) return { ok: false, reason: '该格已有单位' };
    if (unitCount(state, side) >= BOARD.MAX_UNITS) return { ok: false, reason: '战场已满' };
  }
  return { ok: true };
}

/** 手牌上限检查（回合结束用） */
export const handOverflow = (state: MatchState, side: Side): number =>
  Math.max(0, state.sides[side].hand.length - DECK.HAND_LIMIT);
