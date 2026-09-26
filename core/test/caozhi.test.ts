import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { applyAction } from '../src/engine.ts';
import { runCardPlayedTriggers } from '../src/effects.ts';
import { killUnit } from '../src/mutate.ts';
import { createMatch, getUnit, setUnit } from '../src/state.ts';
import { makeUnit } from '../src/state.ts';
import { createRng } from '../src/rng.ts';
import { loadData } from '../src/loader.ts';
import type { CardDef, GameEvent, LordDef } from '../src/types.ts';

const cards = JSON.parse(readFileSync(new URL('../data/cards.json', import.meta.url), 'utf8')) as CardDef[];
const heroes = JSON.parse(readFileSync(new URL('../data/heroes.json', import.meta.url), 'utf8')) as LordDef[];
const data = loadData({ cards, heroes }, { own: 'wei_caocao', enemy: 'shu_liubei' });
const ctx = { cards: data.cards, lords: data.lords };

const stateWith = (hand: string[]) => {
  const state = createMatch({
    seed: 9, cards: data.cards, lords: data.lords,
    decks: { own: [], enemy: [] }, firstSide: 'own', secondCompensation: 'none',
  });
  state.sides.own.command = { cur: 10, max: 10 };
  state.sides.own.hand = hand.map((id) => ({ card: data.cards.get(id)!, mods: [] }));
  return state;
};

test('曹植：入场本回合每打出战法抽一张，下一回合不再触发', () => {
  const state = stateWith(['wei_caozhi', 'tactic_wanjianqifa', 'tactic_wanjianqifa']);
  state.sides.own.deck = ['neutral_infantry', 'neutral_archer'];
  const played = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 0 });
  assert.equal(played.ok, true, played.error);

  const firstTactic = applyAction(played.state, ctx, { type: 'PLAY_CARD', cardIndex: 0 });
  assert.equal(firstTactic.ok, true, firstTactic.error);
  assert.equal(firstTactic.state.sides.own.hand.length, 2, '本回合释放战法应额外抽 1 张');

  firstTactic.state.turn += 1;
  const events: GameEvent[] = [];
  runCardPlayedTriggers(firstTactic.state, data.cards, data.cards.get('tactic_wanjianqifa')!,
    createRng(1), events);
  assert.equal(firstTactic.state.sides.own.hand.length, 2, '技能只在入场本回合有效');
});

test('曹植：亡语抽两张牌', () => {
  const state = stateWith([]);
  state.sides.own.deck = ['neutral_infantry', 'neutral_archer'];
  const caoZhi = data.cards.get('wei_caozhi')!;
  const unit = makeUnit(caoZhi, 1, 1);
  unit.hp = 1;
  setUnit(state, 'own', 'front', 0, unit);
  const placed = getUnit(state, 'own', 'front', 0)!;
  const events: GameEvent[] = [];
  killUnit(state, data.cards, { side: 'own', row: 'front', col: 0, unit: placed }, events);
  assert.equal(state.sides.own.hand.length, 2);
});

test('曹洪：架盾，战吼使己方主公恢复 5 点生命', () => {
  const state = stateWith(['wei_caohong']);
  state.sides.own.lord.hp = 20;
  const result = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 0 });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.state.sides.own.lord.hp, 25);
  assert.ok(result.state.sides.own.rows.front[0]?.kw.includes('jia_dun'));
});

test('曹真：架盾，战吼使双方场上所有角色获得 +1/+1', () => {
  const state = stateWith(['wei_caozhen']);
  const own = makeUnit(data.cards.get('neutral_infantry')!, 1, 11);
  const enemy = makeUnit(data.cards.get('neutral_infantry')!, 1, 12);
  setUnit(state, 'own', 'front', 1, own);
  setUnit(state, 'enemy', 'front', 1, enemy);
  const result = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 0 });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.state.sides.own.rows.front[1]?.atk, 2);
  assert.equal(result.state.sides.own.rows.front[1]?.maxHp, 2);
  assert.equal(result.state.sides.enemy.rows.front[1]?.atk, 2);
  assert.equal(result.state.sides.enemy.rows.front[1]?.maxHp, 2);
});

test('刘晔：战吼时手牌不超过一张则抽一张', () => {
  const state = stateWith(['wei_liuye']);
  state.sides.own.deck = ['neutral_infantry'];
  const result = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 0 });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.state.sides.own.hand.length, 1);

  const withCard = stateWith(['wei_liuye', 'neutral_infantry']);
  withCard.sides.own.deck = ['neutral_archer'];
  const noDraw = applyAction(withCard, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 0 });
  assert.equal(noDraw.ok, true, noDraw.error);
  assert.equal(noDraw.state.sides.own.hand.length, 2, '手牌为 1 张时仍应抽牌');
});
