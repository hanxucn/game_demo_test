/**
 * 酒令（docs/gdd/11-events-tactics-jiuling.md §3）
 *
 * 开局双方各选 1 个，整局持续生效。酒令数据在 data/jiuling.yaml，
 * 每个酒令挂在一个已实现的 hook 上——**在 hook 形状内新增酒令只改数据**。
 *
 *   cost_discount   出牌费用修正（可限定类型 + 每回合次数）
 *   draw_extra      抽牌后追加「多抽 N 再弃 M」
 *   damage_reduce   受伤减免（每回合前 N 次）
 *   deck_inject     开局注入一张卡，并设最早可用回合
 */

import type { CardDef, Faction, JiulingDef, MatchState, Side } from './types.ts';

/** 每方每回合的酒令触发计数键 */
export const jiulingKey = (jiulingId: string, tag: string): string => `${jiulingId}:${tag}`;

/** 取某方本回合已触发次数 */
export function jiulingUsed(state: MatchState, side: Side, key: string): number {
  return state.sides[side].jiulingUsed[key] ?? 0;
}

/** 记一次触发 */
export function markJiulingUsed(state: MatchState, side: Side, key: string): void {
  const s = state.sides[side];
  s.jiulingUsed[key] = (s.jiulingUsed[key] ?? 0) + 1;
}

/** 每回合清零（startTurn 调用） */
export function resetJiulingTurn(state: MatchState, side: Side): void {
  state.sides[side].jiulingUsed = {};
}

/** 取某方酒令定义 */
export function jiulingOf(state: MatchState, jiulings: Map<string, JiulingDef>, side: Side): JiulingDef | undefined {
  const id = state.sides[side].jiuling;
  return id ? jiulings.get(id) : undefined;
}

/**
 * cost_discount：算出这张牌的酒令费用修正。
 *
 * 纯查询，不改状态——真正扣减在 playCard 成功后才 markJiulingUsed。
 */
export function jiulingCostDelta(
  state: MatchState,
  side: Side,
  card: CardDef,
  jiulings: Map<string, JiulingDef>,
): number {
  const j = jiulingOf(state, jiulings, side);
  if (!j || j.hook !== 'cost_discount') return 0;
  const f = j.filter;
  if (f?.type && card.type !== f.type) return 0;
  if (f?.faction && card.faction !== f.faction) return 0;
  const limit = j.limit_per_turn ?? 1;
  if (jiulingUsed(state, side, jiulingKey(j.id, 'cost')) >= limit) return 0;
  return j.cost ?? 0;
}

/** playCard 成功后确认消耗掉本回合的折扣额度 */
export function consumeJiulingCost(state: MatchState, side: Side, jiulings: Map<string, JiulingDef>): void {
  const j = jiulingOf(state, jiulings, side);
  if (j?.hook === 'cost_discount') markJiulingUsed(state, side, jiulingKey(j.id, 'cost'));
}

/**
 * draw_extra：本回合该不该触发「多抽再弃」。
 * 返回 null 表示不触发。
 */
export function jiulingDrawExtra(
  state: MatchState,
  side: Side,
  jiulings: Map<string, JiulingDef>,
): { extra: number; discard: number } | null {
  const j = jiulingOf(state, jiulings, side);
  if (!j || j.hook !== 'draw_extra') return null;
  const limit = j.limit_per_turn ?? 1;
  if (jiulingUsed(state, side, jiulingKey(j.id, 'draw')) >= limit) return null;
  return { extra: j.extra ?? 1, discard: j.discard ?? 0 };
}

/**
 * damage_reduce：本回合受伤减免额。
 * 返回 0 表示不减免。
 */
export function jiulingDamageReduce(
  state: MatchState,
  side: Side,
  jiulings: Map<string, JiulingDef>,
): number {
  const j = jiulingOf(state, jiulings, side);
  if (!j || j.hook !== 'damage_reduce') return 0;
  const limit = j.limit_per_turn ?? 1;
  if (jiulingUsed(state, side, jiulingKey(j.id, 'damage')) >= limit) return 0;
  return j.reduce ?? 0;
}

export function markJiulingDraw(state: MatchState, side: Side, jiulings: Map<string, JiulingDef>): void {
  const j = jiulingOf(state, jiulings, side);
  if (j?.hook === 'draw_extra') markJiulingUsed(state, side, jiulingKey(j.id, 'draw'));
}

export function consumeJiulingDamageReduce(state: MatchState, side: Side, jiulings: Map<string, JiulingDef>): void {
  const j = jiulingOf(state, jiulings, side);
  if (j?.hook === 'damage_reduce') markJiulingUsed(state, side, jiulingKey(j.id, 'damage'));
}

/**
 * deck_inject：开局注入一张卡。
 *
 * v1 的三张精英卡都是 neutral 且 cost 0，且按 GDD 07-troops.md §4「精英卡只作为进化目标存在」，
 * 所以这里注入的是**本阵营费用最高的可组卡**（即「史诗卡」在本卡池下的等价物），
 * 并加一张 ban 手牌修正把它压到 unlock_turn 才可用。
 *
 * @returns 注入的卡 id（无可用卡时返回 null）
 */
export function resolveInjectCard(
  j: JiulingDef,
  faction: Faction,
  pool: readonly CardDef[],
): CardDef | null {
  if (j.hook !== 'deck_inject') return null;
  const own = pool.filter((c) => c.faction === faction);
  const candidates = own.length ? own : pool;
  if (!candidates.length) return null;
  const best = [...candidates].sort((a, b) =>
    b.cost - a.cost || ((b.attack ?? 0) + (b.health ?? 0)) - ((a.attack ?? 0) + (a.health ?? 0)) || (a.id < b.id ? -1 : 1),
  )[0] as CardDef;
  return best;
}

/** 校验酒令数据自洽（validate 工具调用） */
export function checkJiuling(j: JiulingDef): string[] {
  const errs: string[] = [];
  const hooks = ['cost_discount', 'draw_extra', 'damage_reduce', 'deck_inject'];
  if (!hooks.includes(j.hook)) {
    errs.push(`未知 hook：${j.hook}（可选 ${hooks.join(' / ')}）`);
    return errs;
  }
  if (j.hook === 'cost_discount' && !j.cost) errs.push('cost_discount 必须给 cost');
  if (j.hook === 'draw_extra' && !j.extra) errs.push('draw_extra 必须给 extra');
  if (j.hook === 'damage_reduce' && !j.reduce) errs.push('damage_reduce 必须给 reduce');
  if (j.hook === 'deck_inject' && !j.unlock_turn) errs.push('deck_inject 必须给 unlock_turn');
  if (!j.memo) errs.push('缺 memo（一句话记忆点）');
  if (!j.tradeoff) errs.push('缺 tradeoff——每个酒令都要有代价或限制（GDD 11 §3.3）');
  return errs;
}
