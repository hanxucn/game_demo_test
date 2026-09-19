/**
 * 测试夹具：最小可用的卡牌数据 + 场景搭建工具
 *
 * 这些卡只用于测试引擎，不是正式卡牌设计。
 */

import { createMatch, makeUnit, nextUidSeq, setUnit } from '../src/state.ts';
import { loadData } from '../src/loader.ts';
import type {
  CardDef, EngineContext, LordDef, MatchState, Row, Side,
} from '../src/types.ts';

export const TEST_CARDS: CardDef[] = [
  {
    id: 'neutral_infantry', name: '步兵', faction: 'neutral', type: 'troop',
    troopKind: 'infantry', cost: 1, attack: 2, health: 1, keywords: ['jie_zhen'],
    memo: '相邻有友方步兵时，本次攻击 +1',
  },
  {
    id: 'neutral_shieldman', name: '盾兵', faction: 'neutral', type: 'troop',
    troopKind: 'shield', cost: 1, attack: 1, health: 2, keywords: ['jia_dun'],
    memo: '仅前军生效：必须先攻击它',
  },
  {
    id: 'neutral_archer', name: '弓箭手', faction: 'neutral', type: 'troop',
    troopKind: 'archer', cost: 1, attack: 1, health: 1, keywords: ['shen_she'],
    memo: '可攻击任意列的人物卡',
  },
  {
    id: 'test_champion', name: '测试武将', faction: 'shu', type: 'general',
    cost: 5, attack: 5, health: 5, keywords: ['xian_gong'],
    memo: '带先攻的测试武将',
  },
  {
    id: 'test_assassin', name: '测试刺客', faction: 'qun', type: 'general',
    cost: 4, attack: 4, health: 3, keywords: ['wu_shuang'],
    memo: '带无双的测试武将',
  },
  {
    id: 'test_strategist', name: '测试谋臣', faction: 'wei', type: 'strategist',
    cost: 4, attack: 0, health: 3, keywords: [],
    memo: '谋臣不能普攻',
    skills: [{
      id: 'fireball', name: '火计', kind: 'active', cost: 2, frequency: 'once_per_turn',
      target: { side: 'enemy', filter: { type: 'character' }, count: 1, mode: 'choose' },
      effects: [{ action: 'damage', value: 4 }],
    }],
  },
  {
    id: 'test_draw_tactic', name: '测试战法', faction: 'neutral', type: 'tactic',
    cost: 2, memo: '抽 2 张牌',
    effects: [{ action: 'draw', value: 2 }],
  },
  {
    id: 'test_deathrattle', name: '测试忠义', faction: 'shu', type: 'general',
    cost: 3, attack: 2, health: 2, keywords: ['zhong_yi'],
    memo: '阵亡时对全体敌人造成 1 点伤害',
    skills: [{ id: 'lastword', name: '遗志', kind: 'trigger', trigger: 'on_death', effects: [{ action: 'damage', value: 1 }] }],
  },
];

export const TEST_HEROES: LordDef[] = [
  {
    id: 'shu_liubei', name: '刘备', faction: 'shu', type: 'lord', cost: 0,
    skills: [{
      id: 'ren_de', name: '仁德', kind: 'active', cost: 2, frequency: 'once_per_turn',
      effects: [{ action: 'heal', value: 2, target: { side: 'both', filter: { type: 'character' }, count: 1, mode: 'choose' } }],
    }],
    memo: '主公技：为一名友方人物恢复 2 点生命',
  },
  {
    id: 'wei_caocao', name: '曹操', faction: 'wei', type: 'lord', cost: 0,
    skills: [{
      id: 'jian_xiong', name: '奸雄', kind: 'active', cost: 2, frequency: 'once_per_turn',
      effects: [{ action: 'damage', value: 2, target: { side: 'self', lord: true } }, { action: 'draw', value: 1 }],
    }],
    memo: '主公技：自伤 2 换 1 张牌',
  },
  {
    id: 'wu_sunquan', name: '孙权', faction: 'wu', type: 'lord', cost: 0,
    skills: [{
      id: 'zuo_duan_dong_nan', name: '坐断东南', kind: 'active', cost: 2, frequency: 'once_per_turn',
      effects: [{ action: 'cycle_to_deck' }],
    }],
    memo: '主公技：弃 1 张手牌再抽 1 张',
  },
];

export function loadTestData(): ReturnType<typeof loadData> {
  return loadData({ cards: TEST_CARDS, heroes: TEST_HEROES }, { own: 'shu_liubei', enemy: 'wei_caocao' });
}

export interface Scenario {
  ownCommand?: number;
  own?: Partial<Record<Row, Array<string | null>>>;
  enemy?: Partial<Record<Row, Array<string | null>>>;
  ownHand?: string[];
  enemyHand?: string[];
  seed?: number;
}

/** 搭建一个可控的测试场景（直接摆位，不走对局流程） */
export function scenario(opts: Scenario): { state: MatchState; ctx: EngineContext } {
  const data = loadTestData();
  const state = createMatch({
    seed: opts.seed ?? 1,
    cards: data.cards,
    lords: data.lords,
    decks: { own: [], enemy: [] },
  });
  state.turn = 1;
  state.active = 'own';
  state.sides.own.command = { cur: opts.ownCommand ?? 10, max: 10 };
  state.sides.enemy.command = { cur: 10, max: 10 };

  const place = (side: Side, rows?: Partial<Record<Row, Array<string | null>>>) => {
    if (!rows) return;
    for (const row of ['front', 'front'] as Row[]) {
      const arr = rows[row];
      if (!arr) continue;
      arr.forEach((id, col) => {
        if (!id) return;
        const card = data.cards.get(id);
        if (!card) throw new Error(`测试卡不存在：${id}`);
        // enteredTurn=0 表示"不是本回合入场"，便于直接测试攻击规则
        setUnit(state, side, row, col, makeUnit(card, 0, nextUidSeq(state)));
      });
    }
  };
  place('own', opts.own);
  place('enemy', opts.enemy);

  const hc = (id: string) => ({ card: data.cards.get(id) as CardDef, mods: [] });
  if (opts.ownHand) state.sides.own.hand = opts.ownHand.map(hc);
  if (opts.enemyHand) state.sides.enemy.hand = opts.enemyHand.map(hc);

  return { state, ctx: { cards: data.cards, lords: data.lords } };
}

/** 目标列表 → 可断言的字符串 */
export function targetsToStr(targets: Array<{ kind: string; side: Side; row?: Row; col?: number }>): string[] {
  return targets.map((t) => `${t.kind}:${t.side}${t.row ? '.' + t.row : ''}${t.col !== undefined ? '.' + t.col : ''}`);
}
