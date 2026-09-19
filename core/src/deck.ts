/**
 * 组卡：卡组校验与自动构筑
 *
 * 对应 docs/gdd/01-overview.md §6 与 docs/gdd/03-turn-flow.md §1：
 *   · 卡组 30 张，**单一阵营**（可搭配中立卡）
 *   · 同名卡上限 2 张
 *   · 精英 / 主公 / 衍生物 / 状态卡 / 特殊卡不进卡组
 *
 * 这里只做「卡组合法性」判断，不涉及对局状态——组卡发生在开局之前。
 */

import { DECK, NON_DECK_TYPES } from './constants.ts';
import type { CardDef, Faction } from './types.ts';
import type { LoadedData } from './loader.ts';

/** 同名卡上限 */
export const MAX_COPIES = 2;

/** 可搭配进任何阵营卡组的中立阵营 */
export const NEUTRAL: Faction = 'neutral';

export interface DeckError {
  kind: 'size' | 'faction' | 'copies' | 'type' | 'unknown' | 'lord';
  message: string;
}

export interface DeckWarning {
  kind: 'curve' | 'attack' | 'duplicate';
  message: string;
}

export interface DeckStats {
  /** 张数 */
  size: number;
  /** 去重后的种类数 */
  unique: number;
  /** 费用分布 */
  curve: Record<number, number>;
  /** 平均费用 */
  avgCost: number;
  /** 人物卡（可上场单位）张数 */
  units: number;
  /** 非人物卡张数 */
  nonUnits: number;
}

export interface DeckCheck {
  ok: boolean;
  errors: DeckError[];
  warnings: DeckWarning[];
  stats: DeckStats;
}

/** 该卡能否进卡组（类型层面） */
export const isDeckable = (c: CardDef): boolean =>
  !(NON_DECK_TYPES as readonly string[]).includes(c.type);

/** 该卡能否进某个阵营的卡组 */
export const isPlayableBy = (c: CardDef, faction: Faction): boolean =>
  isDeckable(c) && (c.faction === faction || c.faction === NEUTRAL);

/** 某阵营可用的卡池 */
export function cardPool(data: LoadedData, faction: Faction): CardDef[] {
  return (data.byFaction.get(faction) ?? [])
    .concat(data.byFaction.get(NEUTRAL) ?? [])
    .filter((c) => isPlayableBy(c, faction));
}

/** 建议统率曲线（docs/gdd/13-balance-data-model.md §7.x）——低费为主，6+ 少量 */
export const SUGGESTED_CURVE: Record<number, number> = { 1: 4, 2: 7, 3: 7, 4: 6, 5: 4, 6: 2 };

function computeStats(cards: CardDef[]): DeckStats {
  const curve: Record<number, number> = {};
  let units = 0;
  for (const c of cards) {
    curve[c.cost] = (curve[c.cost] ?? 0) + 1;
    if (['troop', 'general', 'strategist'].includes(c.type)) units += 1;
  }
  const size = cards.length;
  return {
    size,
    unique: new Set(cards.map((c) => c.id)).size,
    curve,
    avgCost: size ? cards.reduce((a, c) => a + c.cost, 0) / size : 0,
    units,
    nonUnits: size - units,
  };
}

/**
 * 校验一套卡组。
 *
 * @param data    已加载的数据
 * @param faction 卡组所属阵营
 * @param deckIds 卡组内的卡 id（可含重复，重复即多张）
 */
export function validateDeck(data: LoadedData, faction: Faction, deckIds: readonly string[]): DeckCheck {
  const errors: DeckError[] = [];
  const warnings: DeckWarning[] = [];
  const cards: CardDef[] = [];

  for (const id of deckIds) {
    const c = data.cards.get(id);
    if (!c) {
      errors.push({ kind: 'unknown', message: `卡组里有不存在的卡：${id}` });
      continue;
    }
    if (c.type === 'lord') {
      errors.push({ kind: 'lord', message: `主公卡不进卡组，开局自动任命：${c.name}` });
      continue;
    }
    if (!isDeckable(c)) {
      errors.push({ kind: 'type', message: `${c.name}（${c.type}）不可组入卡组` });
      continue;
    }
    if (!isPlayableBy(c, faction)) {
      errors.push({ kind: 'faction', message: `${c.name} 属于 ${c.faction}，不能进 ${faction} 卡组` });
      continue;
    }
    cards.push(c);
  }

  // 张数
  if (deckIds.length !== DECK.SIZE) {
    errors.push({ kind: 'size', message: `卡组必须 ${DECK.SIZE} 张，当前 ${deckIds.length} 张` });
  }

  // 同名上限
  const copies = new Map<string, number>();
  for (const c of cards) copies.set(c.id, (copies.get(c.id) ?? 0) + 1);
  for (const [id, n] of copies) {
    if (n > MAX_COPIES) {
      const c = data.cards.get(id);
      errors.push({ kind: 'copies', message: `${c?.name ?? id} 同名上限 ${MAX_COPIES} 张，当前 ${n} 张` });
    }
  }

  // 曲线与人物卡配比（仅提示，不拦截）
  const stats = computeStats(cards);
  const cheap = (stats.curve[1] ?? 0) + (stats.curve[2] ?? 0);
  if (stats.size >= DECK.SIZE && cheap < 5) {
    warnings.push({ kind: 'curve', message: `1–2 费只有 ${cheap} 张，前期容易空过（建议 ≥5）` });
  }
  const top = Object.entries(stats.curve)
    .filter(([k]) => Number(k) >= 7)
    .reduce((a, [, n]) => a + n, 0);
  if (stats.size >= DECK.SIZE && top > 6) {
    warnings.push({ kind: 'curve', message: `7 费以上 ${top} 张，卡手风险高（建议 ≤6）` });
  }
  if (stats.size >= DECK.SIZE && stats.units < 14) {
    warnings.push({ kind: 'curve', message: `人物卡只有 ${stats.units} 张，站场能力偏弱（建议 ≥14）` });
  }
  if (stats.unique < 15) {
    warnings.push({ kind: 'duplicate', message: `只有 ${stats.unique} 种卡，卡组过于单一` });
  }

  return { ok: errors.length === 0, errors, warnings, stats };
}

/**
 * 自动构筑一套合法卡组（demo / AI 用）。
 *
 * 规则：阵营 + 中立池，同名 ≤2 张，共 30 张，按建议曲线配比。
 * 与旧实现的区别：**保证合法性**（旧版会超出同名上限，且会选到衍生物）。
 */
export function autoDeck(data: LoadedData, faction: Faction, seed = 1): string[] {
  const pool = cardPool(data, faction);
  if (!pool.length) throw new Error(`阵营 ${faction} 没有可用卡牌`);

  // 按费用分桶；桶内排序保证确定性（Rng 之外的稳定顺序）
  const buckets = new Map<number, CardDef[]>();
  for (const c of [...pool].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const b = buckets.get(c.cost) ?? [];
    b.push(c);
    buckets.set(c.cost, b);
  }

  const used = new Map<string, number>();
  const deck: string[] = [];
  const take = (c: CardDef): boolean => {
    const n = used.get(c.id) ?? 0;
    if (n >= MAX_COPIES) return false;
    used.set(c.id, n + 1);
    deck.push(c.id);
    return true;
  };

  // ① 先按建议曲线取满
  const costs = [...Object.keys(SUGGESTED_CURVE).map(Number), ...[...buckets.keys()].filter((k) => !(k in SUGGESTED_CURVE))]
    .sort((a, b) => a - b);
  const offset = seed % Math.max(1, pool.length);
  let cursor = offset;
  for (const cost of costs) {
    const want = SUGGESTED_CURVE[cost] ?? 0;
    const bucket = buckets.get(cost) ?? [];
    if (!bucket.length) continue;
    let placed = 0;
    let guard = 0;
    while (placed < want && guard < bucket.length * MAX_COPIES + bucket.length) {
      const c = bucket[cursor % bucket.length] as CardDef;
      cursor += 1;
      guard += 1;
      if (take(c)) placed += 1;
    }
  }

  // ② 不足 30 张 → 从整个池子补齐（跳过满同名）
  const flat = [...pool].sort((a, b) => (a.id < b.id ? -1 : 1));
  let guard = 0;
  while (deck.length < DECK.SIZE && guard < flat.length * MAX_COPIES + flat.length) {
    const c = flat[cursor % flat.length] as CardDef;
    cursor += 1;
    guard += 1;
    take(c);
  }

  if (deck.length < DECK.SIZE) {
    throw new Error(`阵营 ${faction} 卡池不足以组出 ${DECK.SIZE} 张卡组（当前 ${deck.length} 张，池子仅 ${pool.length} 种）`);
  }
  return deck.slice(0, DECK.SIZE);
}
