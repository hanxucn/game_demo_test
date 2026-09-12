/**
 * 规则断言测试 —— 迁移自 prototype/rules-check.mjs
 *
 * 覆盖 docs/gdd/02-battlefield.md §3 的 4 条攻击规则与边界情况。
 * 运行：npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { legalPlacements, legalTargets, effectiveAttack, canAttack } from '../src/rules.ts';
import { scenario, targetsToStr } from './fixtures.ts';

test('规则① 近战只能攻击同列前军', () => {
  const { state } = scenario({
    own: { front: ['neutral_infantry'] },
    enemy: { front: ['neutral_infantry'] },
  });
  const res = legalTargets(state, 'own', 'front', 0);
  assert.deepEqual(targetsToStr(res.targets), ['unit:enemy.front.0']);
});

test('规则② 目标列前军为空 → 穿透攻击后军', () => {
  const { state } = scenario({
    own: { front: ['neutral_infantry'] },
    enemy: { back: ['neutral_archer'] },
  });
  const res = legalTargets(state, 'own', 'front', 0);
  assert.deepEqual(targetsToStr(res.targets), ['unit:enemy.back.0']);
});

test('规则③ 两排皆空 → 可攻击主将（破阵斩将）', () => {
  const { state } = scenario({ own: { front: ['neutral_infantry'] } });
  const res = legalTargets(state, 'own', 'front', 0);
  assert.deepEqual(targetsToStr(res.targets), ['lord:enemy']);
});

test('规则④ 架盾最高优先级（可跨列）', () => {
  const { state } = scenario({
    own: { front: ['neutral_infantry'] },
    enemy: { front: [null, null, null, 'neutral_shieldman', null] },
  });
  const res = legalTargets(state, 'own', 'front', 0);
  assert.deepEqual(targetsToStr(res.targets), ['unit:enemy.front.3']);
});

test('架盾在后军不生效', () => {
  const { state } = scenario({
    own: { front: ['neutral_infantry'] },
    enemy: { front: ['neutral_infantry'], back: [null, null, null, 'neutral_shieldman', null] },
  });
  const res = legalTargets(state, 'own', 'front', 0);
  assert.deepEqual(targetsToStr(res.targets), ['unit:enemy.front.0']);
});

test('神射：可攻击任意列的人物卡', () => {
  const { state } = scenario({
    own: { back: [null, 'neutral_archer', null, null, null] },
    enemy: { front: [null, null, 'neutral_infantry', null, null], back: [null, 'neutral_infantry', null, null, 'neutral_archer'] },
  });
  const res = legalTargets(state, 'own', 'back', 1);
  assert.deepEqual(targetsToStr(res.targets), [
    'unit:enemy.front.2', 'unit:enemy.back.1', 'unit:enemy.back.4',
  ]);
});

test('神射不能绕过架盾', () => {
  const { state } = scenario({
    own: { back: [null, 'neutral_archer', null, null, null] },
    enemy: { front: [null, null, null, 'neutral_shieldman', null], back: [null, 'neutral_infantry', null, null, null] },
  });
  const res = legalTargets(state, 'own', 'back', 1);
  assert.deepEqual(targetsToStr(res.targets), ['unit:enemy.front.3']);
});

test('后军近战被自己人挡住', () => {
  const { state } = scenario({
    own: { front: ['neutral_infantry'], back: ['neutral_infantry'] },
    enemy: { front: ['neutral_infantry'] },
  });
  const res = legalTargets(state, 'own', 'back', 0);
  assert.deepEqual(res.targets, []);
  assert.match(res.why, /被自己人挡住/);
});

test('谋臣不能普通攻击', () => {
  const { state } = scenario({
    own: { back: [null, null, 'test_strategist', null, null] },
    enemy: { front: [null, null, 'neutral_infantry', null, null] },
  });
  const res = legalTargets(state, 'own', 'back', 2);
  assert.deepEqual(res.targets, []);
});

test('部署：每方 10 格，已占用的格子不可再部署', () => {
  const { state } = scenario({
    own: { front: ['neutral_infantry'], back: [null, null, 'neutral_archer', null, null] },
  });
  const spots = legalPlacements(state, 'own');
  assert.equal(spots.length, 8);
  assert.ok(!spots.some((s) => s.row === 'front' && s.col === 0));
});

test('有效攻击力：结阵加成（相邻有友方步兵）', () => {
  const { state } = scenario({
    own: { front: ['neutral_infantry', 'neutral_infantry'] },
  });
  // 两个步兵相邻 → 各 +1
  assert.equal(effectiveAttack(state, 'own', 'front', 0), 3);
  assert.equal(effectiveAttack(state, 'own', 'front', 1), 3);
});

test('有效攻击力：结阵不生效（无相邻步兵）', () => {
  const { state } = scenario({
    own: { front: ['neutral_infantry', null, null, null, 'neutral_infantry'] },
  });
  assert.equal(effectiveAttack(state, 'own', 'front', 0), 2);
});

test('震慑状态：不能攻击', () => {
  const { state } = scenario({
    own: { front: ['neutral_infantry'] },
    enemy: { front: ['neutral_infantry'] },
  });
  state.sides.own.rows.front[0]!.statuses.zhen_she = 1;
  const check = canAttack(state, 'own', 'front', 0);
  assert.equal(check.ok, false);
  assert.match(check.reason ?? '', /震慑/);
});

test('入场当回合不能攻击（疾行除外）', () => {
  const { state } = scenario({
    own: { front: ['neutral_infantry'] },
    enemy: { front: ['neutral_infantry'] },
  });
  state.sides.own.rows.front[0]!.enteredTurn = state.turn;
  assert.equal(canAttack(state, 'own', 'front', 0).ok, false);
});

test('连击：每回合可攻击两次', () => {
  const { state } = scenario({
    own: { front: ['neutral_infantry'] },
    enemy: { front: ['neutral_infantry'] },
  });
  const u = state.sides.own.rows.front[0]!;
  u.kw.push('lian_ji');
  u.attackedThisTurn = 1;
  assert.equal(canAttack(state, 'own', 'front', 0).ok, true);
  u.attackedThisTurn = 2;
  assert.equal(canAttack(state, 'own', 'front', 0).ok, false);
});
