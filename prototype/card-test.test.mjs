import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as Core from '../core/src/index.ts';
import CardTest from './card-test.js';

const gameData = {
  cards: JSON.parse(readFileSync(new URL('../core/data/cards.json', import.meta.url), 'utf8')),
  heroes: JSON.parse(readFileSync(new URL('../core/data/heroes.json', import.meta.url), 'utf8')),
};

test('测试选卡只接受 1～10 张不同的已实现卡牌', () => {
  const cards = CardTest.selectableCards(Core, gameData);
  assert.ok(cards.some((card) => card.id === 'wei_zhangyan'));
  assert.ok(cards.some((card) => card.id === 'wu_zhouyu'));
  assert.equal(CardTest.parseConfig('?test=', Core, gameData), null);
  assert.equal(CardTest.parseConfig('?test=wei_zhangyan,wei_zhangyan', Core, gameData), null);
  assert.equal(CardTest.parseConfig('?test=not_a_card', Core, gameData), null);
  assert.equal(CardTest.parseConfig('?test=' + cards.slice(0, 11).map((card) => card.id).join(','), Core, gameData), null);
  assert.deepEqual(CardTest.parseConfig('?test=wei_zhangyan,wu_zhouyu&own=shu&enemy=wu', Core, gameData), {
    ids: ['wei_zhangyan', 'wu_zhouyu'], ownFaction: 'shu', enemyFaction: 'wu', enemyAi: false,
  });
  assert.equal(CardTest.parseConfig('?test=wei_zhangyan&ai=1', Core, gameData).enemyAi, true);
});

test('跨阵营测试牌直接进入手牌，并能通过引擎出牌', () => {
  const config = CardTest.parseConfig('?test=wei_zhangyan,wu_zhouyu&own=shu&enemy=wu', Core, gameData);
  const session = CardTest.createSession(Core, gameData, config);
  assert.deepEqual(session.state.sides.own.hand.map((item) => item.card.id), config.ids);
  assert.ok(session.state.sides.own.deck.every((id) => config.ids.includes(id)));
  assert.deepEqual(session.state.sides.own.command, { cur: 10, max: 10 });
  assert.equal(session.events.some((event) => event.type === 'CARD_DRAWN' && event.side === 'own'), false);
  assert.equal(session.events.find((event) => event.type === 'TURN_START').command.cur, 10);
  assert.equal(session.state.sides.own.rows.front[0]?.cardId, 'neutral_infantry');
  const enemyFront = session.state.sides.enemy.rows.front;
  assert.deepEqual(
    [2, 3, 4, 5, 6].map((col) => enemyFront[col]?.cardId),
    ['neutral_infantry', 'neutral_infantry', 'neutral_infantry', 'neutral_infantry', 'neutral_infantry'],
  );
  assert.equal(enemyFront.filter(Boolean).length, 5);
  assert.equal(new Set(enemyFront.filter(Boolean).map((unit) => unit.uid)).size, 5);
  assert.equal(session.state.sides.own.lord.name, '刘备');
  assert.equal(session.state.sides.enemy.lord.name, '孙权');
  const played = Core.applyAction(session.state, session.ctx, {
    type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 1,
  });
  assert.equal(played.ok, true);
  assert.equal(played.state.sides.own.rows.front[1]?.cardId, 'wei_zhangyan');
  assert.deepEqual(played.state.sides.own.hand.map((item) => item.card.id), ['wu_zhouyu']);
});

test('选择十张时全部保留在手中', () => {
  const ids = CardTest.selectableCards(Core, gameData).slice(0, 10).map((card) => card.id);
  const config = CardTest.parseConfig('?test=' + ids.join(','), Core, gameData);
  const session = CardTest.createSession(Core, gameData, config);
  assert.deepEqual(session.state.sides.own.hand.map((item) => item.card.id), ids);
});
