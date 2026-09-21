/**
 * 规则断言测试 —— 对应 docs/gdd/02-battlefield.md §3（ADR-051 改版：一行 8 格）
 *
 * 新规则三条：
 *   ① 架盾＝嘲讽：敌方存在「架盾」单位时，普通攻击只能打它们
 *   ② 无敌方架盾 → 可自由攻击任意敌方人物（翻面/奇袭者除外）
 *   ③ 也可以直接攻击敌方主将（取消旧的「必须先清空一列」破阵限制）
 * 另：谋臣也可以普通攻击（ADR-051 取消「谋臣不能普攻」）。
 *
 * 运行：npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { legalPlacements, legalTargets, effectiveAttack, canAttack } from '../src/rules.ts';
import { BOARD } from '../src/constants.ts';
import { scenario, targetsToStr } from './fixtures.ts';

test('规则② 无敌方架盾 → 可自由攻击任意敌方人物', () => {
  const { state } = scenario({
    own: { front: ['neutral_infantry'] },
    enemy: { front: [null, 'neutral_infantry'] },
  });
  const res = legalTargets(state, 'own', 'front', 0);
  assert.deepEqual(targetsToStr(res.targets), ['unit:enemy.front.1', 'lord:enemy']);
});

test('规则③ 可以直接攻击敌方主将（不再要求清空一列）', () => {
  const { state } = scenario({
    own: { front: ['neutral_infantry'] },
    enemy: { front: ['neutral_infantry', 'neutral_infantry'] },
  });
  const res = legalTargets(state, 'own', 'front', 0);
  assert.ok(res.targets.some((t) => t.kind === 'lord'), '主将应始终是合法目标');
});

test('规则① 架盾＝嘲讽：敌方有架盾时只能打它', () => {
  const { state } = scenario({
    own: { front: ['neutral_infantry'] },
    enemy: { front: ['neutral_infantry', null, null, 'neutral_shieldman'] },
  });
  const res = legalTargets(state, 'own', 'front', 0);
  assert.deepEqual(targetsToStr(res.targets), ['unit:enemy.front.3']);
  assert.match(res.why, /架盾/);
});

test('规则① 架盾嘲讽：不给出主将选项', () => {
  const { state } = scenario({
    own: { front: ['neutral_infantry'] },
    enemy: { front: [null, null, null, 'neutral_shieldman'] },
  });
  const res = legalTargets(state, 'own', 'front', 0);
  assert.ok(!res.targets.some((t) => t.kind === 'lord'), '架盾在场时不能越过它打主将');
});

test('规则① 多个架盾：可以任选其中一个（嘲讽不唯一）', () => {
  const { state } = scenario({
    own: { front: ['neutral_infantry'] },
    enemy: { front: ['neutral_shieldman', null, 'neutral_shieldman'] },
  });
  const res = legalTargets(state, 'own', 'front', 0);
  assert.deepEqual(targetsToStr(res.targets), ['unit:enemy.front.0', 'unit:enemy.front.2']);
});

test('规则① 架盾单位阵亡后嘲讽解除', () => {
  const { state } = scenario({
    own: { front: ['neutral_infantry'] },
    enemy: { front: ['neutral_shieldman', 'neutral_infantry'] },
  });
  const sh = state.sides.enemy.rows.front[0]!;
  sh.hp = 0;
  const res = legalTargets(state, 'own', 'front', 0);
  assert.deepEqual(targetsToStr(res.targets), ['unit:enemy.front.1', 'lord:enemy']);
});

test('谋臣也可以普通攻击（ADR-051 取消旧限制）', () => {
  const { state } = scenario({
    own: { front: [null, null, 'test_strategist'] },
    enemy: { front: ['neutral_infantry'] },
  });
  const gate = canAttack(state, 'own', 'front', 2);
  assert.equal(gate.ok, true, gate.reason ?? '');
  const res = legalTargets(state, 'own', 'front', 2);
  assert.ok(res.targets.length > 0, '谋臣应有合法目标');
});

test('奇袭单位不能被指定为目标', () => {
  const { state } = scenario({
    own: { front: ['neutral_infantry'] },
    enemy: { front: ['neutral_infantry'] },
  });
  state.sides.enemy.rows.front[0]!.kw.push('qi_xi');
  const res = legalTargets(state, 'own', 'front', 0);
  assert.ok(!res.targets.some((t) => t.kind === 'unit'), '奇袭者不可被指定');
  assert.ok(res.targets.some((t) => t.kind === 'lord'), '但仍可打主将');
});

test('部署：一行 8 格，已占用的格子不可再部署', () => {
  const { state } = scenario({ own: { front: ['neutral_infantry'] } });
  const spots = legalPlacements(state, 'own');
  assert.equal(BOARD.COLS, 8, '每行 8 格');
  assert.equal(BOARD.MAX_UNITS, 8, '上限 8 张');
  assert.equal(spots.length, 8 - 1);
  assert.ok(!spots.some((sp) => sp.col === 0), '已占用的 0 号格不可再部署');
});

test('部署：满 8 张后无法再部署', () => {
  const full = Array(BOARD.COLS).fill('neutral_infantry');
  const { state } = scenario({ own: { front: full } });
  assert.equal(legalPlacements(state, 'own').length, 0);
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
  state.sides.own.rows.front[0]!.statuses.zhen_she = { stacks: 1, turns: 1 };
  const check = canAttack(state, 'own', 'front', 0);
  assert.equal(check.ok, false);
  assert.match(check.reason ?? '', /无法普通攻击/);
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
