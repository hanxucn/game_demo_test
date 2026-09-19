/**
 * 开局流程（docs/gdd/03-turn-flow.md §1）
 *
 *   ① 选阵营 → 自动任命主公
 *   ② 各选一个酒令（三选一）
 *   ③ 换牌（起手可替换任意张数，每张仅一次机会）
 *   ④ 掷点决定先手（后手补「传国玉玺」）
 *   ⑤ 先手方开始第 1 回合
 *
 * ①②④⑤ 在 createMatch 里一次做完；**③ 换牌是玩家的独立动作**，在这里实现，
 * 因为它需要「先看牌、再决定」，无法在开局时一口气算完。
 */

import { DECK } from './constants.ts';
import { createRng } from './rng.ts';
import { cloneState, createMatch } from './state.ts';
import type { CardDef, JiulingDef, LordDef, MatchState, Side } from './types.ts';

/** 酒令「三选一」候选数（GDD 11 §3.1） */
export const JIULING_CHOICES = 3;

export interface MulliganResult {
  ok: boolean;
  state: MatchState;
  reason?: string;
  /** 换掉的卡（客户端播放「飞回牌库」动画） */
  replaced: CardDef[];
  /** 换进来的卡 */
  drawn: CardDef[];
}

/**
 * 换牌：把起手里指定的位置放回牌库、洗牌、补抽同样张数。
 *
 * GDD 规则：「起手可换一次（任意张数），每张仅一次机会」——所以每方只能调用一次，
 * 由 `state.sides[side].mulliganDone` 记录，避免反复换牌找最优起手。
 *
 * @param indices 要换掉的手牌下标（任意张数；空数组 = 不换，但仍算用掉机会）
 */
export function mulligan(
  state: MatchState,
  side: Side,
  indices: readonly number[],
  cards: Map<string, CardDef>,
): MulliganResult {
  const s = state.sides[side];
  if (s.mulliganDone) {
    return { ok: false, state, reason: '本局已换过牌（每张仅一次机会）', replaced: [], drawn: [] };
  }
  const uniq = [...new Set(indices)].sort((a, b) => a - b);
  for (const i of uniq) {
    if (i < 0 || i >= s.hand.length) {
      return { ok: false, state, reason: `手牌下标越界：${i}`, replaced: [], drawn: [] };
    }
  }

  const next = cloneState(state);
  const ns = next.sides[side];
  const rng = createRng(next.rngState);
  const replaced: CardDef[] = [];
  const drawn: CardDef[] = [];

  // ① 取回要换的牌（从大到小删，避免下标漂移）
  for (const i of [...uniq].sort((a, b) => b - a)) {
    const hc = ns.hand.splice(i, 1)[0];
    if (hc) {
      replaced.push(hc.card);
      ns.deck.push(hc.card.id);
    }
  }
  // ② 洗牌后补抽同样张数
  rng.shuffle(ns.deck);
  for (let k = 0; k < replaced.length; k++) {
    const id = ns.deck.pop();
    if (!id) break;                                  // 牌库见底（起手阶段不可能发生）
    const c = cards.get(id);
    if (!c) continue;
    drawn.push(c);
    ns.hand.push({ card: c, mods: [] });
  }

  // ③ 换牌后手牌顺序按「保留的牌 + 新抽的牌」排列，稳定可复现
  ns.mulliganDone = true;
  next.rngState = rng.getState();

  return { ok: true, state: next, replaced, drawn };
}

/** 起手张数（GDD 03 §1.2：先手 3 / 后手 4） */
export const startHandSize = (side: Side, firstSide: Side): number =>
  side === firstSide ? DECK.HAND_START_FIRST : DECK.HAND_START_SECOND;

/** 手牌上限（GDD 01 §6） */
export const handLimit = (): number => DECK.HAND_LIMIT;

/**
 * 酒令三选一：从全部酒令里确定性地抽 3 个候选。
 * 双方用不同派生种子，候选可以不同，但同一 seed 下完全可复现。
 */
export function offerJiuling(allIds: readonly string[], seed: number, side: Side): string[] {
  if (allIds.length <= JIULING_CHOICES) return [...allIds];
  const rng = createRng((seed + (side === 'own' ? 0x9e3779b9 : 0x85ebca6b)) >>> 0);
  return rng.shuffle([...allIds]).slice(0, JIULING_CHOICES);
}

/**
 * 完整开局编排：组好卡组 → 选好酒令 → 创建对局 → 双方换牌 → 返回可开打的状态。
 *
 * demo / AI 对战用；真人客户端会分步调用 createMatch + mulligan（让玩家自己选）。
 */
export interface SetupOptions {
  seed?: number;
  cards: Map<string, CardDef>;
  lords: Record<Side, LordDef>;
  decks: Record<Side, string[]>;
  jiulings?: Partial<Record<Side, string>>;
  jiulingDefs?: Map<string, JiulingDef>;
  /** 各方要换掉的手牌下标；缺省 = 不换 */
  mulliganIndices?: Partial<Record<Side, number[]>>;
  firstSide?: Side;
}

export interface SetupResult {
  state: MatchState;
  log: string[];
}

export function setupMatch(opts: SetupOptions): SetupResult {
  const log: string[] = [];
  let state = createMatch({
    seed: opts.seed,
    lords: opts.lords,
    decks: opts.decks,
    cards: opts.cards,
    jiulings: opts.jiulings,
    jiulingDefs: opts.jiulingDefs,
    firstSide: opts.firstSide,
    rollFirst: opts.firstSide === undefined,      // 未指定 → 按 GDD 掷点
  });

  log.push(`主公：己方 ${state.sides.own.lord.name} / 敌方 ${state.sides.enemy.lord.name}`);
  log.push(`先手：${state.active === 'own' ? '己方' : '敌方'}`);
  if (state.sides.own.jiuling) log.push(`己方酒令：${state.sides.own.jiuling}`);
  if (state.sides.enemy.jiuling) log.push(`敌方酒令：${state.sides.enemy.jiuling}`);

  // 只对显式给出下标的方位换牌；未列出的方位保留换牌机会（真人客户端会自己调 mulligan）
  for (const side of ['own', 'enemy'] as Side[]) {
    const idx = opts.mulliganIndices?.[side];
    if (idx === undefined) { log.push(`${side} 未换牌`); continue; }
    const r = mulligan(state, side, idx, opts.cards);
    if (!r.ok) { log.push(`${side} 换牌失败：${r.reason ?? ''}`); continue; }
    state = r.state;
    log.push(`${side} 换牌 ${r.replaced.length} 张：${r.replaced.map((c) => c.name).join('、') || '不换'}`);
  }

  return { state, log };
}
