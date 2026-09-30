import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyAction, unitSkillTargetPlan } from '../src/engine.ts';
import { dealDamage, unitRef } from '../src/mutate.ts';
import { createRng } from '../src/rng.ts';
import { getUnit, makeUnit, setUnit } from '../src/state.ts';
import { scenario } from './fixtures.ts';
import type { CardDef, GameEvent } from '../src/types.ts';

test('攻击目标条件：青州兵只在己方主公血量更高时强化主公伤害', () => {
  const { state, ctx } = scenario({});
  const qingzhou: CardDef = {
    id: 'test_qingzhou', name: '青州兵', faction: 'wei', type: 'troop',
    cost: 2, attack: 3, health: 3, troopKind: 'infantry', memo: '测试',
    skills: [{ id: 'qingzhou', name: '青州突骑', kind: 'trigger', trigger: 'on_attack', effects: [
      { action: 'attack_bonus', value: 2, condition: {
        all_of: [{ attack_target: { type: 'lord' } }, { lord_hp_vs_enemy: '>' }],
      } },
    ] }],
  };
  ctx.cards.set(qingzhou.id, qingzhou);
  setUnit(state, 'own', 'front', 0, makeUnit(qingzhou, 0, 1));
  state.sides.enemy.lord.hp = 29;
  const r = applyAction(state, ctx, {
    type: 'ATTACK', from: { row: 'front', col: 0 }, to: { kind: 'lord' },
  });
  assert.equal(r.ok, true);
  assert.equal(r.state.sides.enemy.lord.hp, 24, '3 点基础伤害 + 2 点青州兵强化');
});

test('战技相邻目标：蒙冲式伤害会命中指定目标左右相邻单位', () => {
  const { state, ctx } = scenario({});
  const ship: CardDef = {
    id: 'test_ship', name: '蒙冲', faction: 'wu', type: 'troop',
    cost: 2, attack: 0, health: 4, troopKind: 'archer', memo: '测试',
    skills: [{ id: 'ship', name: '蒙冲', kind: 'active', frequency: 'once_per_turn',
      target: { side: 'enemy', filter: { type: 'character' }, count: 1, mode: 'choose' },
      effects: [
        { action: 'damage', value: 2 },
        { action: 'damage', value: 1, target: { side: 'enemy', filter: { type: 'character', adjacent_to: 'chosen' }, count: 'all' } },
      ] }],
  };
  const victim: CardDef = { id: 'test_victim', name: '目标', faction: 'wei', type: 'general', cost: 2, attack: 0, health: 5, memo: '测试' };
  ctx.cards.set(ship.id, ship);
  ctx.cards.set(victim.id, victim);
  setUnit(state, 'own', 'front', 0, makeUnit(ship, 0, 2));
  setUnit(state, 'enemy', 'front', 2, makeUnit(victim, 0, 3));
  setUnit(state, 'enemy', 'front', 3, makeUnit(victim, 0, 4));
  const plan = unitSkillTargetPlan(state, 'own', 'front', 0);
  assert.equal(plan.choices.length, 1, '技能级 target 应生成指向性选择');
  assert.equal(plan.choices[0]!.targets.length, 2);
  const r = applyAction(state, ctx, {
    type: 'USE_SKILL', row: 'front', col: 0,
    target: { side: 'enemy', row: 'front', col: 2 },
  });
  assert.equal(r.ok, true, r.error ?? '蒙冲技能应当成功结算');
  assert.equal(getUnit(r.state, 'enemy', 'front', 2)?.hp, 3);
  assert.equal(getUnit(r.state, 'enemy', 'front', 3)?.hp, 4);
});

test('放箭改为主动战技：随机造成1点伤害，回合结束不会自动触发', () => {
  const { state, ctx } = scenario({});
  const archer: CardDef = {
    id: 'test_fangjian', name: '测试弓兵', faction: 'neutral', type: 'troop',
    cost: 1, attack: 1, health: 2, troopKind: 'archer', memo: '测试', keywords: ['zhan_ji'],
    skills: [{ id: 'fangjian', name: '放箭', kind: 'active', frequency: 'once_per_turn',
      effects: [{ action: 'damage', value: 1,
        target: { side: 'enemy', filter: { type: 'character', include_lord: false }, count: 1, mode: 'random' } }] }],
  };
  const victim: CardDef = { id: 'test_victim', name: '目标', faction: 'wei', type: 'general', cost: 2, attack: 0, health: 5, memo: '测试' };
  ctx.cards.set(archer.id, archer);
  ctx.cards.set(victim.id, victim);
  setUnit(state, 'own', 'front', 0, makeUnit(archer, 0, 5));
  setUnit(state, 'enemy', 'front', 0, makeUnit(victim, 0, 7));
  const used = applyAction(state, ctx, { type: 'USE_SKILL', row: 'front', col: 0, skillId: 'fangjian' });
  assert.equal(used.ok, true, used.error ?? '放箭战技应当成功');
  assert.ok(used.events.some((e) => e.type === 'DAMAGE'), '放箭应当造成伤害');
  const ended = applyAction(used.state, ctx, { type: 'END_TURN' });
  assert.equal(ended.events.some((e) => e.type === 'SKILL_TRIGGERED' && e.skillName === '放箭'), false,
    '回合结束不应再自动触发放箭');
});

test('同一单位多个战技：可按 skillId 使用第二个战技', () => {
  const { state, ctx } = scenario({});
  const multi: CardDef = {
    id: 'test_multi_skill', name: '多技兵', faction: 'neutral', type: 'troop',
    cost: 1, attack: 0, health: 2, troopKind: 'archer', memo: '测试',
    skills: [
      { id: 'first_skill', name: '先技', kind: 'active', frequency: 'once_per_turn', effects: [{ action: 'draw', value: 1 }] },
      { id: 'second_skill', name: '放箭', kind: 'active', frequency: 'once_per_turn',
        effects: [{ action: 'damage', value: 1,
          target: { side: 'enemy', filter: { type: 'character', include_lord: false }, count: 1, mode: 'random' } }] },
    ],
  };
  const victim: CardDef = { id: 'test_victim', name: '目标', faction: 'wei', type: 'general', cost: 2, attack: 0, health: 5, memo: '测试' };
  ctx.cards.set(multi.id, multi);
  ctx.cards.set(victim.id, victim);
  setUnit(state, 'own', 'front', 0, makeUnit(multi, 0, 6));
  setUnit(state, 'enemy', 'front', 0, makeUnit(victim, 0, 8));
  const used = applyAction(state, ctx, { type: 'USE_SKILL', row: 'front', col: 0, skillId: 'second_skill' });
  assert.equal(used.ok, true, used.error ?? '第二个战技应当成功');
  assert.equal(used.events.filter((e) => e.type === 'DAMAGE').length, 1);
});

test('圣盾关键词免疫一次伤害，消耗后下一次伤害正常结算', () => {
  const { state, ctx } = scenario({});
  const shield: CardDef = {
    id: 'test_shield', name: '圣盾兵', faction: 'wei', type: 'troop', cost: 2,
    attack: 1, health: 3, troopKind: 'infantry', keywords: ['sheng_dun'], memo: '测试',
  };
  ctx.cards.set(shield.id, shield);
  setUnit(state, 'own', 'front', 0, makeUnit(shield, 0, 10));
  const events: GameEvent[] = [];
  const target = unitRef('own', 'front', 0);
  const first = dealDamage(state, ctx.cards, target, 2, events, '测试', 0, undefined, undefined);
  assert.equal(first, 0);
  assert.equal(getUnit(state, 'own', 'front', 0)?.hp, 3);
  const second = dealDamage(state, ctx.cards, target, 2, events, '测试', 0, undefined, undefined);
  assert.equal(second, 2);
  assert.equal(getUnit(state, 'own', 'front', 0)?.hp, 1);
});

test('先登弩手战技：先随机消灭先攻士兵，再继续放箭', () => {
  const { state, ctx } = scenario({});
  const xiandeng: CardDef = {
    id: 'test_xiandeng_nu', name: '先登弩手', faction: 'qun', type: 'troop',
    cost: 2, attack: 2, health: 4, troopKind: 'archer', keywords: ['zhan_ji'], memo: '测试',
    skills: [{ id: 'xiandeng_nu', name: '先登', kind: 'active', frequency: 'once_per_turn', effects: [
      { action: 'destroy', target: { side: 'enemy', filter: { type: 'troop', keyword: 'xian_gong' }, count: 1, mode: 'random' } },
      { action: 'damage', value: 1, target: { side: 'enemy', filter: { type: 'character', include_lord: false }, count: 1, mode: 'random' } },
    ] }],
  };
  const striker: CardDef = {
    id: 'test_striker_troop', name: '先攻兵', faction: 'wei', type: 'troop',
    cost: 1, attack: 1, health: 1, troopKind: 'infantry', keywords: ['xian_gong'], memo: '测试',
  };
  const victim: CardDef = {
    id: 'test_arrow_victim', name: '目标', faction: 'wei', type: 'general',
    cost: 2, attack: 1, health: 3, keywords: [], memo: '测试',
  };
  ctx.cards.set(xiandeng.id, xiandeng);
  ctx.cards.set(striker.id, striker);
  ctx.cards.set(victim.id, victim);
  setUnit(state, 'own', 'front', 0, makeUnit(xiandeng, 0, 1));
  setUnit(state, 'enemy', 'front', 0, makeUnit(striker, 0, 2));
  setUnit(state, 'enemy', 'front', 1, makeUnit(victim, 0, 3));

  const result = applyAction(state, ctx, { type: 'USE_SKILL', row: 'front', col: 0, skillId: 'xiandeng_nu' });
  assert.equal(result.ok, true, result.error ?? '先登战技应当成功');
  assert.equal(getUnit(result.state, 'enemy', 'front', 0), null, '应先消灭敌方先攻士兵');
  assert.equal(getUnit(result.state, 'enemy', 'front', 1)?.hp, 2, '先登消灭后仍应继续随机放箭造成1点伤害');
});

test('治疗战技可以选择满血友军', () => {
  const { state, ctx } = scenario({});
  const healer: CardDef = {
    id: 'test_full_heal', name: '木牛流马', faction: 'shu', type: 'troop',
    cost: 2, attack: 0, health: 6, troopKind: 'cavalry', keywords: ['zhan_ji'], memo: '测试',
    skills: [{ id: 'mu_niu', name: '木牛流马', kind: 'active', frequency: 'once_per_turn',
      target: { side: 'ally', filter: { type: 'character' }, count: 1, mode: 'choose' },
      effects: [{ action: 'heal', value: 3 }] }],
  };
  const ally: CardDef = {
    id: 'test_full_ally', name: '满血士兵', faction: 'shu', type: 'troop',
    cost: 1, attack: 1, health: 2, troopKind: 'infantry', keywords: [], memo: '测试',
  };
  ctx.cards.set(healer.id, healer);
  ctx.cards.set(ally.id, ally);
  setUnit(state, 'own', 'front', 0, makeUnit(healer, 0, 4));
  setUnit(state, 'own', 'front', 1, makeUnit(ally, 0, 5));
  const plan = unitSkillTargetPlan(state, 'own', 'front', 0);
  assert.equal(plan.choices[0]?.targets.some((t) => t.side === 'own' && t.row === 'front' && t.col === 1), true,
    '满血友军也应出现在治疗目标列表');
  const result = applyAction(state, ctx, {
    type: 'USE_SKILL', row: 'front', col: 0, skillId: 'mu_niu',
    target: { side: 'own', row: 'front', col: 1 },
  });
  assert.equal(result.ok, true, result.error ?? '治疗满血友军应当成功');
  assert.equal(getUnit(result.state, 'own', 'front', 1)?.hp, 2);
});
