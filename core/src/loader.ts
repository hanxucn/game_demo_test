/**
 * 数据加载：JSON → 卡牌索引
 *
 * 数据来源：data/*.yaml，经 tools/yaml2json.py 转成 core/data/*.json
 * （引擎不直接解析 YAML，避免引入依赖；YAML 是策划的编辑格式，JSON 是运行时格式）
 */

import type { CardDef, Faction, JiulingDef, LordDef, Side } from './types.ts';

export interface DataBundle {
  cards: CardDef[];
  heroes: LordDef[];
  /** 酒令（data/jiuling.yaml → core/data/jiuling.json）；可选 */
  jiuling?: JiulingDef[];
}

export interface LoadedData {
  cards: Map<string, CardDef>;
  lords: Record<Side, LordDef>;
  byFaction: Map<Faction, CardDef[]>;
  /** 酒令表（按 id 索引） */
  jiulings: Map<string, JiulingDef>;
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
    jiulings: new Map((bundle.jiuling ?? []).map((j) => [j.id, j])),
  };
}
