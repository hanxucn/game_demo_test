import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { drawCard } from '../src/mutate.ts';
import '../src/effects.ts';
import { createMatch, makeUnit, setUnit } from '../src/state.ts';
import { loadData } from '../src/loader.ts';
import type { CardDef, LordDef } from '../src/types.ts';

const cards = JSON.parse(readFileSync(new URL('../data/cards.json', import.meta.url), 'utf8')) as CardDef[];
const heroes = JSON.parse(readFileSync(new URL('../data/heroes.json', import.meta.url), 'utf8')) as LordDef[];
const data = loadData({ cards, heroes }, { own: 'wei_caocao', enemy: 'shu_liubei' });

const makeState = () => createMatch({
  seed: 7,
  cards: data.cards,
  lords: data.lords,
  decks: { own: [], enemy: [] },
  firstSide: 'own',
  secondCompensation: 'none',
});

test('曹休：抽到时自动召唤为 2/3 人物牌，不进入手牌或弃牌堆', () => {
  const state = makeState();
  state.sides.own.deck = ['wei_caoxiu'];
  const events: Parameters<typeof drawCard>[3] = [];
  drawCard(state, data.cards, 'own', events);

  const unit = state.sides.own.rows.front[0];
  assert.equal(unit?.cardId, 'wei_caoxiu');
  assert.equal(unit?.atk, 2);
  assert.equal(unit?.hp, 3);
  assert.equal(state.sides.own.hand.length, 0);
  assert.equal(state.sides.own.discard.length, 0);
  assert.ok(events.some((event) => event.type === 'UNIT_SUMMONED'));
});

test('曹休：战场已满时回退进入手牌', () => {
  const state = makeState();
  const filler = data.cards.get('neutral_infantry')!;
  for (let col = 0; col < state.sides.own.rows.front.length; col++) {
    setUnit(state, 'own', 'front', col, makeUnit(filler, 1, col + 1));
  }
  state.sides.own.deck = ['wei_caoxiu'];
  const events: Parameters<typeof drawCard>[3] = [];
  drawCard(state, data.cards, 'own', events);

  assert.equal(state.sides.own.hand[0]?.card.id, 'wei_caoxiu');
  assert.equal(state.sides.own.discard.length, 0);
});
