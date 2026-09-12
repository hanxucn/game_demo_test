/**
 * 数据加载：JSON → 卡牌索引
 *
 * 数据来源：data/*.yaml，经 tools/yaml2json.py 转成 core/data/*.json
 * （引擎不直接解析 YAML，避免引入依赖；YAML 是策划的编辑格式，JSON 是运行时格式）
 */

import type { CardDef, Faction, LordDef, Side } from './types.ts';

export interface DataBundle {
  cards: CardDef[];
  heroes: LordDef[];
}

export interface LoadedData {
  cards: Map<string, CardDef>;
  lords: Record<Side, LordDef>;
  byFaction: Map<Faction, CardDef[]>;
}

export function loadData(bundle: DataBundle, lordIds: { own: string; enemy: string }): LoadedData {
  const cards = new Map<string, CardDef>();
  const byFaction = new Map<Faction, CardDef[]>();

  for (const c of bundle.cards) {
    cards.set(c.id, c);
    const list = byFaction.get(c.faction) ?? [];
    list.push(c);
    byFaction.set(c.faction, list);
  }
  for (const h of bundle.heroes) cards.set(h.id, h);

  const findLord = (id: string): LordDef => {
    const l = bundle.heroes.find((h) => h.id === id);
    if (!l) throw new Error(`找不到主公：${id}`);
    return l;
  };

  return {
    cards,
    lords: { own: findLord(lordIds.own), enemy: findLord(lordIds.enemy) },
    byFaction,
  };
}

/**
 * 按统率曲线自动组一套 30 张卡组（demo / AI 用）
 * 曲线建议见 docs/gdd/13-balance-data-model.md
 */
export function autoDeck(data: LoadedData, faction: Faction, seed = 1): string[] {
  const pool = (data.byFaction.get(faction) ?? []).filter((c) => c.type !== 'elite');
  const neutral = data.byFaction.get('neutral') ?? [];
  const all = [...pool, ...neutral].filter((c) => c.type !== 'elite' && c.cost <= 8);
  if (!all.length) throw new Error(`阵营 ${faction} 没有可用卡牌`);

  const curve: Record<number, number> = { 1: 6, 2: 8, 3: 6, 4: 5, 5: 3, 6: 2 };
  const deck: string[] = [];
  const buckets = new Map<number, CardDef[]>();
  for (const c of all) {
    const b = buckets.get(c.cost) ?? [];
    b.push(c);
    buckets.set(c.cost, b);
  }
  let i = 0;
  for (const [costStr, want] of Object.entries(curve)) {
    const cost = Number(costStr);
    const bucket = buckets.get(cost) ?? all;
    for (let k = 0; k < want; k++) {
      deck.push(bucket[(i++) % bucket.length]!.id);
    }
  }
  // 补足 / 裁剪到 30 张
  while (deck.length < 30) deck.push(all[deck.length % all.length]!.id);
  return deck.slice(0, 30);
}
