/**
 * 引擎行为测试：出牌、战斗结算、回合流程、粮尽、主公技
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyAction, startMatch } from '../src/engine.ts';
import { createMatch, getUnit, makeUnit, setUnit } from '../src/state.ts';
import { loadTestData, scenario } from './fixtures.ts';
import type { Action, CardDef, GameEvent } from '../src/types.ts';

const run = (state: ReturnType<typeof scenario>['state'], ctx: ReturnType<typeof scenario>['ctx'], action: Action) =>
  applyAction(state, ctx, action);

test('出牌：扣除统率、进入战场、产生事件', () => {
  const { state, ctx } = scenario({ ownHand: ['neutral_infantry'] });
  const before = state.sides.own.command.cur;
  const r = run(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 0 });

  assert.equal(r.ok, true);
  assert.equal(r.state.sides.own.command.cur, before - 1);
  assert.ok(getUnit(r.state, 'own', 'front', 0));
  assert.ok(r.events.some((e: GameEvent) => e.type === 'UNIT_SUMMONED'));
  assert.equal(r.state.sides.own.hand.length, 0);
});

test('出牌：统率不足被拒绝，状态不变', () => {
  const { state, ctx } = scenario({ ownHand: ['test_champion'] });
  state.sides.own.command.cur = 1;
  const r = run(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.state.sides.own.command.cur, 1);
});

test('战斗：目标存活时反击', () => {
  const { state, ctx } = scenario({
    own: { front: ['neutral_infantry'] },        // 2/1
    enemy: { front: ['test_champion'] },         // 5/5
  });
  const r = run(state, ctx, { type: 'ATTACK', from: { row: 'front', col: 0 }, to: { kind: 'unit', row: 'front', col: 0 } });
  assert.equal(r.ok, true);
  // 步兵打 2 点 → 武将剩 3；武将反击 5 → 步兵 1 血阵亡
  assert.equal(getUnit(r.state, 'enemy', 'front', 0)!.hp, 3);
  assert.equal(getUnit(r.state, 'own', 'front', 0), null);
});

test('战斗：击杀目标则不反击（非先攻也成立）', () => {
  const { state, ctx } = scenario({
    own: { front: ['neutral_infantry'] },        // 2/1
    enemy: { front: ['neutral_shieldman'] },     // 1/2（架盾，必须先打它）
  });
  const r = run(state, ctx, { type: 'ATTACK', from: { row: 'front', col: 0 }, to: { kind: 'unit', row: 'front', col: 0 } });
  assert.equal(r.ok, true);
  assert.equal(getUnit(r.state, 'enemy', 'front', 0), null);
  assert.equal(getUnit(r.state, 'own', 'front', 0)!.hp, 1);   // 目标已死，未受反击
});

test('先攻：击杀目标则不受反击', () => {
  const { state, ctx } = scenario({
    own: { front: ['test_champion'] },           // 5/5 先攻
    enemy: { front: ['neutral_infantry'] },      // 2/1
  });
  const r = run(state, ctx, { type: 'ATTACK', from: { row: 'front', col: 0 }, to: { kind: 'unit', row: 'front', col: 0 } });
  assert.equal(r.ok, true);
  assert.equal(getUnit(r.state, 'enemy', 'front', 0), null);
  assert.equal(getUnit(r.state, 'own', 'front', 0)!.hp, 5);   // 未被反击
});

test('无双：攻击时不受反击', () => {
  const { state, ctx } = scenario({
    own: { front: ['test_assassin'] },           // 4/3 无双
    enemy: { front: ['neutral_shieldman'] },     // 1/2
  });
  const r = run(state, ctx, { type: 'ATTACK', from: { row: 'front', col: 0 }, to: { kind: 'unit', row: 'front', col: 0 } });
  assert.equal(r.ok, true);
  assert.equal(getUnit(r.state, 'own', 'front', 0)!.hp, 3);   // 未被反击
});

test('阵亡：移除单位并触发遗计抽牌', () => {
  const { state, ctx } = scenario({
    own: { front: ['test_champion'] },
    enemy: { front: ['neutral_infantry'] },
    enemyHand: [],
  });
  // 给敌方牌库塞一张牌，验证遗计
  state.sides.enemy.deck = ['neutral_infantry'];
  const u = getUnit(state, 'enemy', 'front', 0)!;
  u.kw.push('yi_ji');
  const r = run(state, ctx, { type: 'ATTACK', from: { row: 'front', col: 0 }, to: { kind: 'unit', row: 'front', col: 0 } });
  assert.equal(r.ok, true);
  assert.equal(r.state.sides.enemy.hand.length, 1);
});

test('破阵：主将护甲优先吸收伤害', () => {
  const { state, ctx } = scenario({ own: { front: ['test_champion'] } });   // 5 攻
  state.sides.enemy.lord.armor = 2;
  const r = run(state, ctx, { type: 'ATTACK', from: { row: 'front', col: 0 }, to: { kind: 'lord' } });
  assert.equal(r.ok, true);
  assert.equal(r.state.sides.enemy.lord.armor, 0);
  assert.equal(r.state.sides.enemy.lord.hp, 30 - 3);
});

test('回合结束：换边、统率 +1、抽牌', () => {
  const data = loadTestData();
  const base = createMatch({
    seed: 7, cards: data.cards, lords: data.lords,
    decks: { own: Array(30).fill('neutral_infantry'), enemy: Array(30).fill('neutral_infantry') },
  });
  const ctx = { cards: data.cards, lords: data.lords };
  const started = startMatch(base, ctx);
  assert.equal(started.state.turn, 1);
  assert.equal(started.state.active, 'own');
  assert.equal(started.state.sides.own.command.max, 2);   // 1 → 2

  const r = applyAction(started.state, ctx, { type: 'END_TURN' });
  assert.equal(r.state.active, 'enemy');
  assert.equal(r.state.turn, 2);
  assert.equal(r.state.sides.enemy.command.max, 2);
});

test('粮尽：牌库为空时抽牌受到递增伤害', () => {
  const data = loadTestData();
  const base = createMatch({
    seed: 3, cards: data.cards, lords: data.lords,
    decks: { own: [], enemy: [] },
  });
  const ctx = { cards: data.cards, lords: data.lords };
  const s1 = startMatch(base, ctx);                       // 第 1 回合抽牌 → 粮尽 1
  assert.equal(s1.state.sides.own.lord.hp, 29);
  const s2 = applyAction(s1.state, ctx, { type: 'END_TURN' });   // 敌方回合 → 粮尽 1
  const s3 = applyAction(s2.state, ctx, { type: 'END_TURN' });   // 己方第 2 次 → 粮尽 2
  assert.equal(s3.state.sides.own.lord.hp, 29 - 2);
});

test('主公技·仁德：恢复 2 点生命（费用 2，ADR-049）', () => {
  const { state, ctx } = scenario({ own: { front: ['test_champion'] }, ownCommand: 10 });
  const u = getUnit(state, 'own', 'front', 0)!;
  u.hp = 1;                                                  // 5/5 打残到 1
  const r = run(state, ctx, { type: 'USE_LORD_SKILL', target: { side: 'own', row: 'front', col: 0 } });
  assert.equal(r.ok, true);
  assert.equal(getUnit(r.state, 'own', 'front', 0)!.hp, 3, '恢复 2 点');
  assert.equal(r.state.sides.own.command.cur, 8, '主公技消耗 2 统率');
});

test('主公技·仁德：治疗不超过最大生命', () => {
  const { state, ctx } = scenario({ own: { front: ['test_champion'] }, ownCommand: 10 });
  const u = getUnit(state, 'own', 'front', 0)!;
  u.hp = 4;                                                  // 5/5 只差 1 点
  const r = run(state, ctx, { type: 'USE_LORD_SKILL', target: { side: 'own', row: 'front', col: 0 } });
  assert.equal(r.ok, true);
  assert.equal(getUnit(r.state, 'own', 'front', 0)!.hp, 5, '夹到上限，不溢出');
});

test('主公技·奸雄：自伤 2 点并抽 1 张（只作用于曹操自身）', () => {
  const data = loadTestData();
  const caocao = data.cards.get('wei_caocao')!;
  const { state, ctx } = scenario({ ownCommand: 10, ownHand: [] });
  const base = structuredClone(state);
  base.sides.own.deck = ['neutral_infantry'];   // 牌库非空，否则抽牌会触发粮尽（自伤 1）
  const ctx2 = { cards: data.cards, lords: { own: caocao, enemy: data.lords.enemy } };
  base.sides.own.lord = {
    ...base.sides.own.lord, id: caocao.id, name: caocao.name,
    skill: caocao.skills![0]!.name, skillDef: caocao.skills![0], skillUsedThisTurn: false,
  };
  const before = base.sides.own.lord.hp;
  const handBefore = base.sides.own.hand.length;
  const deckBefore = base.sides.own.deck.length;

  const r = applyAction(base, ctx2, { type: 'USE_LORD_SKILL' });
  assert.equal(r.ok, true);
  assert.equal(r.state.sides.own.lord.hp, before - 2, '自伤 2 点');
  assert.equal(r.state.sides.own.hand.length, handBefore + 1, '抽 1 张');
  assert.equal(r.state.sides.own.deck.length, deckBefore - 1);
  assert.equal(r.state.sides.own.command.cur, 8, '消耗 2 统率');
  // 只作用于自身：敌方主将与场上都应无变化
  assert.equal(r.state.sides.enemy.lord.hp, 30, '敌方主将不受影响');
  void ctx;
});

test('主公技：每回合只能释放 1 次', () => {
  const { state, ctx } = scenario({ own: { front: ['test_champion'] }, ownCommand: 10 });
  const u = getUnit(state, 'own', 'front', 0)!;
  u.hp = 1;
  const cmd = { side: 'own', row: 'front', col: 0 } as const;
  const r1 = run(state, ctx, { type: 'USE_LORD_SKILL', target: cmd });
  assert.equal(r1.ok, true);
  const r2 = applyAction(r1.state, ctx, { type: 'USE_LORD_SKILL', target: cmd });
  assert.equal(r2.ok, false, '同一回合第二次应被拒');
});

test('主公技门控：统率值不足时不可用', () => {
  const { state, ctx } = scenario({ own: { front: ['test_champion'] }, ownCommand: 1 });
  const r = run(state, ctx, { type: 'USE_LORD_SKILL', target: { side: 'own', row: 'front', col: 0 } });
  assert.equal(r.ok, false, '只有 1 统率，主公技需要 2');
});

test('谋臣主动技：火计造成 4 点伤害', () => {
  const { state, ctx } = scenario({
    own: { front: [null, null, 'test_strategist', null, null] },
    enemy: { front: ['test_champion'] },       // 5/5
  });
  const r = run(state, ctx, {
    type: 'USE_SKILL', row: 'front', col: 2,
    target: { side: 'enemy', row: 'front', col: 0 },
  });
  assert.equal(r.ok, true);
  assert.equal(getUnit(r.state, 'enemy', 'front', 0)!.hp, 1);
  assert.equal(r.state.sides.own.command.cur, 8);   // 10 - 2
});

test('对局结束：主将生命归零即结束', () => {
  const { state, ctx } = scenario({ own: { front: ['test_champion'] } });
  state.sides.enemy.lord.hp = 3;
  const r = run(state, ctx, { type: 'ATTACK', from: { row: 'front', col: 0 }, to: { kind: 'lord' } });
  assert.equal(r.state.winner, 'own');
  assert.ok(r.events.some((e) => e.type === 'GAME_OVER'));
});

/* ---------- ADR-031：回合时机触发技（turn_start / turn_end） ---------- */

test('turn_end 触发技：张角五雷轰顶（5 次随机 1 伤）', () => {
  const zhangjiao: CardDef = {
    id: 'test_zhangjiao', name: '测试张角', faction: 'qun', type: 'strategist',
    cost: 5, attack: 1, health: 5, keywords: [], memo: '五雷轰顶',
    skills: [{
      id: 'lei', name: '五雷轰顶', kind: 'trigger', trigger: 'turn_end',
      effects: [{
        action: 'damage', value: 1, count: 5,
        target: { side: 'enemy', filter: { type: 'character' }, count: 1, mode: 'random' },
      }],
    }],
  };
  const { state, ctx } = scenario({ ownHand: [] });
  const u = makeUnit(zhangjiao, 1, 99);
  setUnit(state, 'own', 'front', 2, u);
  // 敌方一个 10 血靶子：5 次雷击后应剩 5 血（打满 5 点）
  const target = makeUnit(
    { id: 'dummy', name: '靶子', faction: 'wei', type: 'general', cost: 2, attack: 1, health: 10, keywords: [], memo: '' },
    1, 98,
  );
  setUnit(state, 'enemy', 'front', 0, target);

  const r = applyAction(state, ctx, { type: 'END_TURN' });
  assert.equal(r.ok, true);
  assert.equal(getUnit(r.state, 'enemy', 'front', 0)?.hp, 5, '5 次 1 伤应打满 5 点（10 → 5）');
});

test('turn_start 触发技在回合开始时生效', () => {
  const buffer: CardDef = {
    id: 'test_buffer', name: '测试光环', faction: 'shu', type: 'general',
    cost: 2, attack: 1, health: 1, keywords: [], memo: '回合开始回血',
    skills: [{
      id: 'bless', name: '赐福', kind: 'trigger', trigger: 'turn_start',
      effects: [{ action: 'modify', health: 1, target: { side: 'self' } }],
    }],
  };
  const { state, ctx } = scenario({ ownHand: [] });
  setUnit(state, 'own', 'front', 0, makeUnit(buffer, 1, 97));
  const before = getUnit(state, 'own', 'front', 0)!.maxHp;
  const r = applyAction(state, ctx, { type: 'END_TURN' });   // 结束己方回合 → 敌方回合 → 回到己方
  applyAction(r.state, ctx, { type: 'END_TURN' });
  const after = getUnit(r.state, 'own', 'front', 0)?.maxHp ?? 0;
  assert.ok(after >= before, `回合开始触发技应提升上限（${before} → ${after}）`);
});
