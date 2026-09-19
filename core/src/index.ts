/**
 * @juhua/core —— 《酒话三国》规则引擎
 *
 * 对外只暴露一个写入口：applyAction(state, ctx, action) → { ok, state, events }
 *
 * 客户端（Cocos）：拿 events 播动画，不含任何规则判断
 * 服务端（Go）：用同一份逻辑做权威裁决（或按 golden replay 对齐）
 */

export * from './types.ts';
export { createRng, hashSeed, type Rng } from './rng.ts';
export * from './constants.ts';
export * from './state.ts';
export * from './rules.ts';
export * from './mutate.ts';
export { resolveTargets, runEffects, type EffectContext } from './effects.ts';
export { applyAction, startMatch } from './engine.ts';
export {
  summarizeMatch, formatSummary,
  type MatchResult, type MatchSummary, type SideSummary,
} from './result.ts';
export {
  mulligan, setupMatch, offerJiuling, startHandSize, handLimit, JIULING_CHOICES,
  type MulliganResult, type SetupOptions, type SetupResult,
} from './setup.ts';
export {
  checkJiuling, jiulingCostDelta, jiulingDamageReduce, jiulingDrawExtra, jiulingOf,
  jiulingUsed, resolveInjectCard,
} from './jiuling.ts';
export { loadData, type DataBundle, type LoadedData } from './loader.ts';
export {
  autoDeck, cardPool, validateDeck, isDeckable, isPlayableBy, MAX_COPIES, SUGGESTED_CURVE,
  type DeckCheck, type DeckError, type DeckWarning, type DeckStats,
} from './deck.ts';
export { chooseAction, takeTurn } from './ai.ts';

import { createMatch, type CreateMatchOptions } from './state.ts';
import { startMatch } from './engine.ts';
import type { ApplyResult, EngineContext, MatchState } from './types.ts';

/**
 * 便捷入口：一步创建并开局
 * @example
 *   const { state, ctx } = newMatch({ seed: 42, data, decks: { own: [...], enemy: [...] } });
 */
export function newMatch(opts: CreateMatchOptions): { state: MatchState; ctx: EngineContext; events: ApplyResult['events'] } {
  const state = createMatch(opts);
  const ctx: EngineContext = { cards: opts.cards, lords: opts.lords };
  const started = startMatch(state, ctx);
  return { state: started.state, ctx, events: started.events };
}
