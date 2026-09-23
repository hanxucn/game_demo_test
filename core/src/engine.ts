function useLordSkill(
  state: MatchState, ctx: EngineContext,
  action: Extract<Action, { type: 'USE_LORD_SKILL' }>,
  events: GameEvent[], rng: ReturnType<typeof createRng>,
): boolean {
  const side = state.active;
  const lord = state.sides[side].lord;
  const skill = lord.skillDef;
  // 主公技一律走数据（ADR-049）：heroes.yaml 的 skills[0]，与卡牌同一套 DSL。
  // 原先按中文技能名硬编码在 LORD_SKILLS 表里，改技能必须改代码。
  if (!skill || skill.kind !== 'active') return false;

  // 主公技门控（ADR-040）：被「进言」封锁则不可用；「参谋」提升每回合可用次数
  if (hasCapOn(lord.statuses, 'block_lord_skill')) return false;
  if (lord.skillUsedThisTurn && capStacks(lord.statuses, 'extra_lord_skill') <= 0) return false;

  // 费用来自数据（ADR-049：三主公统一 2），不再硬编码 1
  const cost = skill.cost ?? LORD_SKILL_COST;
  if (state.sides[side].command.cur < cost) return false;

  const target: TargetRef | undefined = action.target
    ? action.target.row !== undefined
      ? unitRef(action.target.side, action.target.row, action.target.col as number)
      : lordRef(action.target.side)
    : undefined;

  state.sides[side].command.cur -= cost;
  // 有「参谋」加成时先消耗加成次数，再消耗基础次数
  if (capStacks(lord.statuses, 'extra_lord_skill') > 0 && lord.skillUsedThisTurn) {
    const bonus = Object.entries(lord.statuses ?? {})
      .find(([id, st]) => st.stacks > 0 && STATUSES[id]?.caps?.includes('extra_lord_skill'));
    if (bonus) bonus[1].stacks -= 1;
  } else {
    lord.skillUsedThisTurn = true;
  }
  events.push({ type: 'LORD_SKILL_USED', side, skill: lord.skill });
  emitSkillTriggered(state, side, null, skill, 'lord_skill', events);
  // 抉择（ADR-071）：主公技同样支持 modes
  runEffects(state, ctx.cards, effectsOf(skill, action.modeIndex),
             { side, chosen: target, handIndex: action.handIndex, modeIndex: action.modeIndex }, rng, events);
  return true;
}

/**
 * 引擎主循环：applyAction
 *
 * 这是 core 唯一的写入口。客户端与服务器都调用它，拿到 { state, events }。
 * 客户端只消费 events 播放动画；服务器用同一个引擎做权威裁决。
 */

import { COMMAND, LORD_SKILL_COST, MATCH, STATUSES, TIMING } from './constants.ts';
import { createRng } from './rng.ts';
import {
  capStacks,
  hasCapOn,
  lordStatusStacks,
  allUnits, cloneState, getUnit, makeUnit, nextUidSeq, other, setUnit, statusStacks,
} from './state.ts';
import {
  canPlayCard, canUseUnitSkill, legalTargets,
} from './rules.ts';
import {
  discardOverflow, drawCard, effectiveCost, expireHandMods, expireMods, expireStatuses,
  gainArmor, isBanned, lordRef,
  resolveTurnEndStatuses, resolveTurnStartStatuses, unitRef, type TargetRef,
} from './mutate.ts';
import {
  costRuleDelta, effectsOf, emitSkillTriggered, recomputeAuras, resolveAttack, resolveTargets,
  runCardPlayedTriggers, runEffects, runTriggerSkills,
} from './effects.ts';
import type {
  Action, ApplyResult, CardDef, CardEffect, EngineContext, GameEvent, MatchState, Row, Side,
  TargetSelector, Unit,
} from './types.ts';

/** 开局：创建对局后调用一次，进入第一回合 */
export function startMatch(state: MatchState, ctx: EngineContext): ApplyResult {
  const events: GameEvent[] = [];
  const next = cloneState(state);
  const rng = createRng(next.rngState);
  startTurn(next, ctx, events, rng);
  next.rngState = rng.getState();
  return { ok: true, state: next, events };
}

/** 唯一写入口 */
export function applyAction(state: MatchState, ctx: EngineContext, action: Action): ApplyResult {
  if (state.winner) {
    return { ok: false, state, events: [{ type: 'REJECTED', reason: '对局已结束', action }], error: '对局已结束' };
  }
  const events: GameEvent[] = [];
  const next = cloneState(state);
  const rng = createRng(next.rngState);
  let ok = true;
  let error: string | undefined;

  try {
    switch (action.type) {
      case 'PLAY_CARD': ok = playCard(next, ctx, action, events, rng); break;
      case 'ATTACK': ok = attack(next, ctx, action, events, rng); break;
      case 'USE_LORD_SKILL': ok = useLordSkill(next, ctx, action, events, rng); break;
      case 'USE_SKILL': ok = useUnitSkill(next, ctx, action, events, rng); break;
      case 'END_TURN': endTurn(next, ctx, events, rng); break;
      default: ok = false;
    }
  } catch (e) {
    ok = false;
    error = (e as Error).message;
  }

  if (!ok) {
    error = error ?? '动作不合法';
    events.push({ type: 'REJECTED', reason: error, action });
    return { ok: false, state, events, error };
  }

  next.rngState = rng.getState();
  return { ok: true, state: next, events };
}

/* ============================================================
   出牌前的「要选什么」—— 判定下沉到 core，UI 不自己判断（BACKLOG §3）
   ============================================================ */

/** 一个需要玩家做的选择（写进 `PLAY_CARD.target` / `target2`） */
export interface PlayTargetChoice {
  /** 1 → `action.target`；2 → `action.target2`（ADR-071） */
  pick: 1 | 2;
  label: string;
  /** 合法目标（场上 / 主将）。手牌类目标不在此列 —— UI 表达不了，交给引擎兜底 */
  targets: Array<{ kind: 'unit' | 'lord'; side: Side; row?: Row; col?: number }>;
  /** 候选池里还含手牌（`zone: 'both'`）→ UI 选不到，引擎会用兜底目标 */
  includesHand: boolean;
}

export interface PlayTargetPlan {
  /** 抉择分支名（`modes`）：长度 > 1 时 UI 要先让玩家选一项，其下标即 `modeIndex` */
  modes: string[];
  /** 需要依次询问的选择；空 = 直接打出 */
  choices: PlayTargetChoice[];
}

const TYPE_CN: Record<string, string> = {
  troop: '兵种', general: '武将', strategist: '谋臣', character: '人物',
  event: '事件', tactic: '策略', elite: '精英', token: '衍生物',
};

function choiceLabel(t: TargetSelector): string {
  const who = t.lord ? '主帅'
    : (t.side === 'ally' || t.side === 'self' ? '己方' : t.side === 'enemy' ? '敌方' : '任意');
  const what = TYPE_CN[t.filter?.type ?? 'character'] ?? '人物';
  const gender = t.filter?.gender === 'male' ? '男性' : t.filter?.gender === 'female' ? '女性' : '';
  return who + gender + what;
}

/**
 * 这张牌打出前需要玩家选什么（战吼 / 卡级效果里的 `mode: 'choose'` 选择器）。
 *
 * 与 `canUseUnitSkill` 同样的思路：**判定放在 core**，原型 / 客户端 / AI 共用，
 * 免得 UI 各写一份"要不要选目标"的猜测（BACKLOG §3 明确要求）。
 *
 * 注意两点：
 *  · `modes` 需要玩家先选分支；`modeIndex` 缺省时按 `modes[0]` 枚举；
 *  · 枚举用的"来源单位"是**尚未入场**的卡的替身（只有 cost/atk），
 *    所以 `adjacent_to` 这类依赖站位的过滤会得到空集（当前没有战吼这样写）。
 */
export function playTargetPlan(
  state: MatchState, side: Side, card: CardDef, modeIndex?: number,
): PlayTargetPlan {
  const plan: PlayTargetPlan = { modes: [], choices: [] };
  const onPlay = (card.skills ?? []).filter((sk) => sk.trigger === 'on_play');
  for (const sk of onPlay) {
    if (sk.modes?.length) plan.modes = sk.modes.map((m, i) => m.name || `选项 ${i + 1}`);
    for (const eff of effectsOf(sk, modeIndex)) collect(eff);
  }
  // 非人物卡的卡级效果同样可能带 mode:'choose'（如指定一方）
  if (!['troop', 'general', 'strategist'].includes(card.type)) {
    for (const eff of card.effects ?? []) collect(eff);
  }
  return plan;

  // 预览来源用**卡面数值**：`attack_below_source` / `cost_below_source` 这类过滤要靠它
  function collect(eff: CardEffect): void {
    const c = choiceOf(state, side, eff, { cost: card.cost, atk: card.attack ?? 0 });
    if (c && !plan.choices.some((x) => x.pick === c.pick)) plan.choices.push(c);
  }
}

/**
 * 枚举**一个 `mode:'choose'` 效果**的合法目标（ADR-077）
 *
 * 三种"要玩家点目标"的场景共用它：卡牌战吼（`playTargetPlan`）、
 * 主动技（`unitSkillTargetPlan`）、主公技（`lordSkillTargetPlan`）。
 *
 * 此前原型 UI 自己按 `selector.side` 枚举"该方所有单位"，**完全忽略 filter** ——
 * 于是貂蝉（只认男性）、陆抗（排除自己）这类带过滤的技能会高亮一堆非法目标，
 * 点了之后引擎又退回兜底目标，表现为"指向性技能的选择逻辑有问题，有些又没问题"
 * （没问题的那些恰好是 filter 为空、按 side 枚举就等于合法集的）。
 */
function choiceOf(
  state: MatchState, side: Side, eff: CardEffect,
  preview: { cost: number; atk: number },
): PlayTargetChoice | null {
  const t = eff.target;
  if (!t || t.mode !== 'choose') return null;
  if (t.count === 'all' || (t.count ?? 1) !== 1) return null;
  const pick: 1 | 2 = t.pick === 2 ? 2 : 1;
  // 用 `count:'all'` 拿**整个候选池**（而不是 resolveTargets 的"取前 N 个"）
  const src = { uid: '#preview', cost: preview.cost, atk: preview.atk } as Unit;
  const pool = resolveTargets(state, { ...t, count: 'all', mode: 'first' },
    { side, source: src }, createRng(state.seed));
  const targets: PlayTargetChoice['targets'] = [];
  for (const r of pool) {
    if (r.kind === 'lord') targets.push({ kind: 'lord', side: r.side });
    else if (r.kind === 'unit') targets.push({ kind: 'unit', side: r.side, row: r.row, col: r.col });
  }
  return { pick, label: choiceLabel(t), targets, includesHand: pool.some((r) => r.kind === 'hand') };
}

/** 主公技的预览来源：主公不参与普攻，cost/atk 取 0 即可 */
const LORD_PREVIEW = { cost: 0, atk: 0 };

/**
 * **主动技**需要玩家选什么（ADR-077）
 *
 * 与 `playTargetPlan` 同一套判定，UI 直接照它高亮即可 —— 不再自己按 side 猜。
 */
export function unitSkillTargetPlan(
  state: MatchState, side: Side, row: Row, col: number,
): PlayTargetPlan {
  const plan: PlayTargetPlan = { modes: [], choices: [] };
  const u = getUnit(state, side, row, col);
  if (!u) return plan;
  const sk = (u.skills ?? []).find((x) => x.kind === 'active');
  if (!sk) return plan;
  if (sk.modes?.length) plan.modes = sk.modes.map((m, i) => m.name || `选项 ${i + 1}`);
  for (const eff of effectsOf(sk, 0)) {
    const c = choiceOf(state, side, eff, { cost: u.cost, atk: u.atk });
    if (c && !plan.choices.some((x) => x.pick === c.pick)) plan.choices.push(c);
  }
  return plan;
}

/** **主公技**需要玩家选什么（ADR-077） */
export function lordSkillTargetPlan(state: MatchState, side: Side): PlayTargetPlan {
  const plan: PlayTargetPlan = { modes: [], choices: [] };
  const sk = state.sides[side].lord.skillDef;
  if (!sk) return plan;
  if (sk.modes?.length) plan.modes = sk.modes.map((m, i) => m.name || `选项 ${i + 1}`);
  for (const eff of effectsOf(sk, 0)) {
    const c = choiceOf(state, side, eff, LORD_PREVIEW);
    if (c && !plan.choices.some((x) => x.pick === c.pick)) plan.choices.push(c);
  }
  return plan;
}

/* ============================================================
   回合流程
   ============================================================ */

function startTurn(state: MatchState, ctx: EngineContext, events: GameEvent[], rng: ReturnType<typeof createRng>): void {
  // 回合计数（ADR-064，设计者裁定）：**双方都行动完才算一个完整回合**。
  // halfTurn 每有一方开始行动就 +1；turn 只在完整回合推进时 +1，
  // 与统率值上限的增长严格同步（原先 turn 每半回合 +1，导致显示的第 N 回合
  // 与统率值的第 N 档对不上）。
  state.halfTurn += 1;
  const side = state.active;
  const s = state.sides[side];

  // 第 1、3、5… 个半回合 = 新一轮完整回合的开始。
  // 第 1 个半回合属于开局的第 1 回合（已在 createMatch 里计过），故不再 +1。
  if (state.halfTurn % 2 === 1 && state.halfTurn > 1) {
    state.turn += 1;
    // 统率值增长（ADR-061）：完整回合结束后**双方一起** +1
    for (const sd of ['own', 'enemy'] as Side[]) {
      state.sides[sd].command.max = Math.min(COMMAND.MAX, state.sides[sd].command.max + 1);
    }
  }
  // 断粮：主公状态「断粮」按层数削减本回合统率上限（ADR-040）
  const duan = lordStatusStacks(s.lord, 'duan_liang');
  s.command.cur = Math.max(0, s.command.max - duan);
  s.lord.skillUsedThisTurn = false;
  for (const ref of allUnits(state, side)) {
    ref.unit.attackedThisTurn = 0;
    ref.unit.actedThisTurn = false;               // ADR-074：本回合行为标记
    ref.unit.dealtDamageThisTurn = false;
    ref.unit.skillUsesThisTurn = {};              // 主动技频率每回合重置（GDD 10 §1.1）
  }

  events.push({ type: 'TURN_START', side, turn: state.turn, halfTurn: state.halfTurn, command: { ...s.command } });

  drawCard(state, ctx.cards, side, events);
  // 后手补偿（ADR-053）：该方第 1 回合额外抽 1 张
  if (state.secondCompensation === 'extra_draw' && state.halfTurn === 2) {
    drawCard(state, ctx.cards, side, events);
  }
  // ADR-059：翻面的单位在**自己的回合开始时翻回正面并能行动**
  // （翻面 = 当回合不能行动 + 不能被指定为目标；下个回合开始即恢复）
  for (const ref of allUnits(state, side)) {
    if (ref.unit.statuses.fan_mian) {
      delete ref.unit.statuses.fan_mian;
      events.push({ type: 'UNIT_FLIPPED', side, row: ref.row, col: ref.col, to: 'front', unit: ref.unit });
    }
  }
  resolveTurnStartStatuses(state, ctx.cards, side, events);
  recomputeAuras(state, ctx.cards, rng, events);                              // 第 3 步 ②光环重算
  runTriggerSkills(state, ctx.cards, side, TIMING.TURN_START, rng, events);   // 第 3 步 ③回合开始技
}

/** 结算当前行动方的回合结束（第 20~23 步），**不**换手、不开始新回合 */
function finishTurn(state: MatchState, ctx: EngineContext, events: GameEvent[], rng: ReturnType<typeof createRng>): void {
  const side = state.active;
  resolveTurnEndStatuses(state, ctx.cards, side, events);                     // 第 20 步 ①中毒
  runTriggerSkills(state, ctx.cards, side, TIMING.TURN_END, rng, events);     // 第 20 步 ②回合结束技
  expireStatuses(state, side, events);                                        // 第 21 步 清除临时效果
  expireMods(state, side);                                                     // 第 21 步 临时属性修正到期
  expireHandMods(state, side);                                                 // 第 21 步 手牌修正到期
  recomputeAuras(state, ctx.cards, rng, events);                              // 第 21 步后重算
  const dropped = discardOverflow(state, side);
  dropped.forEach((c) => events.push({ type: 'CARD_PLAYED', side, card: c }));   // 弃牌也用同一事件，客户端可区分
  events.push({ type: 'TURN_END', side, turn: state.turn, halfTurn: state.halfTurn });
}

/** 该方身上是否有「跳过整个回合」的状态（ADR-074，休养生息）；有则消耗掉并返回 true */
function consumeSkipTurn(state: MatchState, events: GameEvent[]): boolean {
  const lord = state.sides[state.active].lord;
  const hit = Object.entries(lord.statuses ?? {})
    .find(([id, inst]) => inst.stacks > 0 && STATUSES[id]?.caps?.includes('skip_turn'));
  if (!hit) return false;
  delete lord.statuses![hit[0]];
  events.push({ type: 'LORD_STATUS_EXPIRED', side: state.active, status: hit[0] });
  events.push({ type: 'TURN_SKIPPED', side: state.active, reason: STATUSES[hit[0]]?.name ?? hit[0] });
  return true;
}

function endTurn(state: MatchState, ctx: EngineContext, events: GameEvent[], rng: ReturnType<typeof createRng>): void {
  finishTurn(state, ctx, events, rng);

  // ADR-054：不设回合上限、不判平局——对局只能由主将阵亡结束（粮尽保证必然收束）

  state.active = other(state.active);
  startTurn(state, ctx, events, rng);

  // 跳回合（ADR-074，休养生息「下一回合不进行任何活动」）：
  // 带 `skip_turn` 状态的一方，其回合刚开始就整个结束 —— 用循环而不是递归，
  // 并设上限防呆（双方同时带着该状态时不会无限套娃）。
  for (let guard = 0; guard < 4; guard++) {
    if (!consumeSkipTurn(state, events)) break;
    finishTurn(state, ctx, events, rng);
    state.active = other(state.active);
    startTurn(state, ctx, events, rng);
  }
}

/* ============================================================
   出牌
   ============================================================ */

function playCard(
  state: MatchState, ctx: EngineContext,
  action: Extract<Action, { type: 'PLAY_CARD' }>,
  events: GameEvent[], rng: ReturnType<typeof createRng>,
): boolean {
  const side = state.active;
  const s = state.sides[side];
  const hc = s.hand[action.cardIndex];
  if (!hc) return false;
  if (isBanned(hc)) return false;                 // 被禁止上场（ADR-038）
  const card = hc.card;
  const cost = effectiveCost(hc, costRuleDelta(state, card, side, rng));  // 费用 = 卡面 + cost_rule + mods

  const isCharacter = ['troop', 'general', 'strategist'].includes(card.type);
  const slot = isCharacter ? { row: action.row as 'front' | 'back', col: action.col as number } : undefined;
  const check = canPlayCard(state, side, card, slot, cost);
  if (!check.ok) return false;

  s.command.cur -= cost;
  s.hand.splice(action.cardIndex, 1);
  events.push({ type: 'CARD_PLAYED', side, card, row: slot?.row, col: slot?.col, handIndex: action.cardIndex });

  if (isCharacter && slot) {
    const u = makeUnit(card, state.turn, nextUidSeq(state));
    setUnit(state, side, slot.row, slot.col, u);
    events.push({ type: 'UNIT_SUMMONED', side, row: slot.row, col: slot.col, unit: u });
    // 入场效果（战吼）
    const onPlay = (card.skills ?? []).filter((sk) => sk.trigger === 'on_play');
    // 战吼需要选目标时（如陈宫「忠烈」、蔡瑁「水攻」），把玩家选的目标作为 chosen 传入。
    // 此前完全没传 → mode:'choose' 只能退回"取第一个合法目标"，玩家无法真正选择。
    const chosen = action.target
      ? ({ kind: 'unit', side: action.target.side, row: action.target.row, col: action.target.col } as const)
      : undefined;
    // 第二选择（ADR-071，程昱「审时度势」：牺牲谁 + 恢复谁）
    const chosen2 = action.target2
      ? ({ kind: 'unit', side: action.target2.side, row: action.target2.row, col: action.target2.col } as const)
      : undefined;
    for (const sk of onPlay) {
      emitSkillTriggered(state, side, u, sk, 'on_play', events);
      // 抉择（ADR-071）：给了 modes 就按 modeIndex 挑分支，否则用 effects
      runEffects(state, ctx.cards, effectsOf(sk, action.modeIndex),
        { side, source: u, chosen, chosen2, chosenRow: slot.row, chosenCol: slot.col }, rng, events);
    }
    if (card.effects?.length) {
      runEffects(state, ctx.cards, card.effects, { side, source: u }, rng, events);
    }
    // 时机表第 7 步：入场后光环重算（ADR-037）
    recomputeAuras(state, ctx.cards, rng, events);
    runCardPlayedTriggers(state, ctx.cards, card, rng, events);   // ADR-041
    recomputeAuras(state, ctx.cards, rng, events);
  } else {
    // 非人物卡：直接执行效果
    runEffects(state, ctx.cards, card.effects, {
      side,
      chosen: action.target
        ? ({ kind: 'unit', side: action.target.side, row: action.target.row, col: action.target.col } as const)
        : undefined,
    }, rng, events);
    s.discard.push(card);
    runCardPlayedTriggers(state, ctx.cards, card, rng, events);   // ADR-041
    recomputeAuras(state, ctx.cards, rng, events);
  }
  return true;
}

/* ============================================================
   攻击
   ============================================================ */

function attack(
  state: MatchState, ctx: EngineContext,
  action: Extract<Action, { type: 'ATTACK' }>,
  events: GameEvent[], rng: ReturnType<typeof createRng>,
): boolean {
  const side = state.active;
  const { from, to } = action;
  const attacker = getUnit(state, side, from.row, from.col);
  if (!attacker) return false;

  const legal = legalTargets(state, side, from.row, from.col);
  if (!legal.targets.length) return false;

  // 混乱：在合法目标中随机
  let target = legal.targets.find((t) =>
    t.kind === to.kind &&
    (t.kind === 'lord' || (t.row === (to as { row: string }).row && t.col === (to as { col: number }).col)),
  );
  if (statusStacks(attacker, 'hun_luan') > 0) {
    target = legal.targets[rng.int(legal.targets.length)];
  }
  if (!target) return false;

  // 结算整体交给 effects.resolveAttack —— 与 DSL 的 `attack_each`（张苞）共用同一条
  // 路径，反击/圣盾/饮血/奇袭/触发技不可能出现两份实现（ADR-071）
  resolveAttack(state, ctx.cards, side, from,
    target as { kind: 'unit'; row: Row; col: number } | { kind: 'lord' },
    events, rng, { consumeAttack: true });
  return true;
}

/* ============================================================
   技能
   ============================================================ */

function useUnitSkill(
  state: MatchState, ctx: EngineContext,
  action: Extract<Action, { type: 'USE_SKILL' }>,
  events: GameEvent[], rng: ReturnType<typeof createRng>,
): boolean {
  const side = state.active;
  const u = getUnit(state, side, action.row, action.col);
  if (!u) return false;
  // 频率 / 震慑 / 费用共用 rules.ts 的判定（AI 与引擎必须同源）
  const check = canUseUnitSkill(state, side, action.row, action.col);
  if (!check.ok) return false;
  const skill = check.skill!;

  const key = skill.id || skill.name || '0';
  u.skillUsesThisTurn[key] = (u.skillUsesThisTurn[key] ?? 0) + 1;
  u.actedThisTurn = true;                       // ADR-074：司马懿要判"本回合有没有行动"
  emitSkillTriggered(state, side, u, skill, 'active', events);
  if ((skill.frequency ?? 'once_per_turn') === 'once') u.skillsUsedOnce.push(key);
  state.sides[side].command.cur -= skill.cost ?? 0;
  const target: TargetRef | undefined = action.target
    ? action.target.row !== undefined
      ? unitRef(action.target.side, action.target.row, action.target.col as number)
      : lordRef(action.target.side)
    : undefined;
  // 抉择（ADR-071）：主动技同样支持 modes
  runEffects(state, ctx.cards, effectsOf(skill, action.modeIndex),
             { side, source: u, chosen: target, handIndex: action.handIndex, modeIndex: action.modeIndex }, rng, events);
  return true;
}
