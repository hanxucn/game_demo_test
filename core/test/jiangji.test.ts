import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { applyAction } from '../src/engine.ts';
import { loadData } from '../src/loader.ts';
import { createMatch, makeUnit, setUnit } from '../src/state.ts';
import type { CardDef, LordDef } from '../src/types.ts';

const cards = JSON.parse(readFileSync(new URL('../data/cards.json', import.meta.url), 'utf8')) as CardDef[];
const heroes = JSON.parse(readFileSync(new URL('../data/heroes.json', import.meta.url), 'utf8')) as LordDef[];
const data = loadData({ cards, heroes }, { own: 'wei_caocao', enemy: 'shu_liubei' });

function makeState() {
  const state = createMatch({
    seed: 19,
    cards: data.cards,
    lords: data.lords,
    decks: { own: [], enemy: [] },
    firstSide: 'own',
    secondCompensation: 'none',
  });
  state.sides.own.command = { cur: 10, max: 10 };
  state.sides.own.hand = [{ card: data.cards.get('wei_jiangji')!, mods: [] }];
  const enemyCard = data.cards.get('neutral_infantry')!;
  for (let col = 0; col < 5; col++) {
    setUnit(state, 'enemy', 'front', col, makeUnit(enemyCard, 0, col + 1));
  }
  const general = data.cards.get('wei_caoxiu')!;
  setUnit(state, 'enemy', 'front', 2, makeUnit(general, 0, 20));
  return state;
}

test('蒋济：选择敌方武将后限制该武将和所有普通兵种攻击', () => {
  const result = applyAction(makeState(), { cards: data.cards, lords: data.lords }, {
    type: 'PLAY_CARD',
    cardIndex: 0,
    row: 'front',
    col: 0,
    target: { side: 'enemy', row: 'front', col: 2 },
  });
  assert.equal(result.ok, true, result.error);
  for (const col of [0, 1, 2, 3, 4]) {
    assert.equal(result.state.sides.enemy.rows.front[col]?.statuses.jin_gong?.stacks, 1, `列 ${col} 应被禁攻`);
  }
});

test('蒋济：选择普通兵种时回退到合法武将目标', () => {
  const result = applyAction(makeState(), { cards: data.cards, lords: data.lords }, {
    type: 'PLAY_CARD',
    cardIndex: 0,
    row: 'front',
    col: 0,
    target: { side: 'enemy', row: 'front', col: 0 },
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.state.sides.enemy.rows.front[0]?.statuses.jin_gong?.stacks, 1);
  assert.equal(result.state.sides.enemy.rows.front[2]?.statuses.jin_gong?.stacks, 1);
});
