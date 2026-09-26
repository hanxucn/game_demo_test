import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadData } from '../src/loader.ts';
import { applyAction } from '../src/engine.ts';
import { createMatch } from '../src/state.ts';
import type { CardDef, LordDef } from '../src/types.ts';

const cards = JSON.parse(readFileSync(new URL('../data/cards.json', import.meta.url), 'utf8')) as CardDef[];
const heroes = JSON.parse(readFileSync(new URL('../data/heroes.json', import.meta.url), 'utf8')) as LordDef[];
const data = loadData({ cards, heroes }, { own: 'wei_caocao', enemy: 'shu_liubei' });

test('曹丕发现：随机展示三张曹氏宗亲，选择后加入手牌并减 1 统帅；抽到时卡牌立即结算', () => {
  const state = createMatch({
    seed: 4,
    cards: data.cards,
    lords: data.lords,
    decks: { own: ['wei_caoxiu', 'wei_caozhang', 'wei_caoren'], enemy: [] },
    firstSide: 'own',
    secondCompensation: 'none',
  });
  state.sides.own.command = { cur: 10, max: 10 };
  state.sides.own.deck = ['wei_caoxiu', 'wei_caozhang', 'wei_caoren'];
  state.sides.own.hand = [{ card: data.cards.get('wei_caopi')!, mods: [] }];

  const played = applyAction(state, { cards: data.cards, lords: data.lords }, {
    type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 0,
  });
  assert.equal(played.ok, true, played.error);
  assert.equal(played.state.pendingDiscover, undefined, '上场不应自动触发发现');

  const used = applyAction(played.state, { cards: data.cards, lords: data.lords }, {
    type: 'USE_SKILL', row: 'front', col: 0,
  });
  assert.equal(used.ok, true, used.error);
  assert.equal(used.state.pendingDiscover?.side, 'own');
  assert.equal(used.state.pendingDiscover?.candidates.length, 3);
  assert.equal(used.events.find((e) => e.type === 'DISCOVER_OPTIONS')?.type, 'DISCOVER_OPTIONS');

  const choice = used.state.pendingDiscover!.candidates[0]!;
  const chosen = applyAction(used.state, { cards: data.cards, lords: data.lords }, {
    type: 'CHOOSE_DISCOVER', cardId: choice,
  });
  assert.equal(chosen.ok, true, chosen.error);
  assert.equal(chosen.state.pendingDiscover, undefined);
  const selected = data.cards.get(choice)!;
  const autoSummoned = chosen.state.sides.own.rows.front.some((unit) => unit?.cardId === choice);
  if (selected.skills?.some((skill) => skill.trigger === 'on_draw')) {
    assert.equal(autoSummoned, true);
    assert.equal(chosen.state.sides.own.hand.some((h) => h.card.id === choice), false);
  } else {
    const found = chosen.state.sides.own.hand.find((h) => h.card.id === choice);
    assert.ok(found);
    assert.equal(found.mods[0]?.value, -1);
  }
  assert.equal(chosen.state.sides.own.deck.includes(choice), false);
});

test('曹丕发现曹休：选择后沿用抽到触发，曹休立即召唤上场', () => {
  const state = createMatch({
    seed: 8,
    cards: data.cards,
    lords: data.lords,
    decks: { own: [], enemy: [] },
    firstSide: 'own',
    secondCompensation: 'none',
  });
  state.sides.own.command = { cur: 10, max: 10 };
  state.sides.own.deck = ['wei_caoxiu', 'wei_caozhang', 'wei_caoren'];
  state.sides.own.hand = [{ card: data.cards.get('wei_caopi')!, mods: [] }];
  const played = applyAction(state, { cards: data.cards, lords: data.lords }, {
    type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 0,
  });
  const used = applyAction(played.state, { cards: data.cards, lords: data.lords }, {
    type: 'USE_SKILL', row: 'front', col: 0,
  });
  assert.equal(used.ok, true, used.error);
  assert.ok(used.state.pendingDiscover?.candidates.includes('wei_caoxiu'));
  const chosen = applyAction(used.state, { cards: data.cards, lords: data.lords }, {
    type: 'CHOOSE_DISCOVER', cardId: 'wei_caoxiu',
  });
  assert.equal(chosen.ok, true, chosen.error);
  assert.equal(chosen.state.sides.own.rows.front.some((unit) => unit?.cardId === 'wei_caoxiu'), true);
  assert.equal(chosen.state.sides.own.hand.some((handCard) => handCard.card.id === 'wei_caoxiu'), false);
});

test('曹丕发现的卡牌：减 1 费后按修正费用出牌', () => {
  const state = createMatch({
    seed: 12,
    cards: data.cards,
    lords: data.lords,
    decks: { own: [], enemy: [] },
    firstSide: 'own',
    secondCompensation: 'none',
  });
  state.sides.own.command = { cur: 10, max: 10 };
  state.sides.own.deck = ['wei_caozhang', 'wei_caoren', 'wei_caohong'];
  state.sides.own.hand = [{ card: data.cards.get('wei_caopi')!, mods: [] }];

  const played = applyAction(state, { cards: data.cards, lords: data.lords }, {
    type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 0,
  });
  const used = applyAction(played.state, { cards: data.cards, lords: data.lords }, {
    type: 'USE_SKILL', row: 'front', col: 0,
  });
  const chosen = applyAction(used.state, { cards: data.cards, lords: data.lords }, {
    type: 'CHOOSE_DISCOVER', cardId: 'wei_caozhang',
  });
  assert.equal(chosen.ok, true, chosen.error);
  chosen.state.sides.own.command = { cur: 2, max: 10 };
  const cast = applyAction(chosen.state, { cards: data.cards, lords: data.lords }, {
    type: 'PLAY_CARD', cardIndex: 0, row: 'back', col: 0,
  });
  assert.equal(cast.ok, true, cast.error);
  assert.equal(cast.state.sides.own.command.cur, 0);
  assert.equal(cast.state.sides.own.rows.back[0]?.cardId, 'wei_caozhang');
});
