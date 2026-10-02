import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyAction, unitSkillTargetPlan } from '../src/engine.ts';
import { dealDamage, unitRef } from '../src/mutate.ts';
import { recomputeAuras } from '../src/effects.ts';
import { createRng } from '../src/rng.ts';
import { capStacks, getUnit, makeUnit, setUnit } from '../src/state.ts';
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

/* ========================================================================
 * ADR-108 藤甲盾：「刀枪不入、箭矢不透，遇火即燃」
 *
 * 这是**首个受伤侧属性感知**的机制。此前 dealDamage 完全不知道伤害来源是
 * 火还是水（damage_type 只在发起侧被读取），所以这三条必须各锁一个用例：
 *   ① 物理/无属性伤害 −1，且**最低为 0**（1 攻单位打不动 2/4 藤甲）
 *   ② 火属性伤害 +1
 *   ③ 伤害来源反弹 1 点
 * ===================================================================== */

const TENGJIA: CardDef = {
  id: 'test_tengjia', name: '藤甲盾', faction: 'shu', type: 'troop',
  cost: 2, attack: 2, health: 4, troopKind: 'shield', keywords: ['jia_dun'], memo: '测试',
  skills: [{ id: 'teng_jia_wei', name: '藤甲', kind: 'aura', effects: [
    { action: 'apply_status', status: 'teng_jia', stacks: 1, target: { source: true } },
  ] }],
};
const STRAW: CardDef = {
  id: 'test_straw', name: '草人', faction: 'wei', type: 'troop',
  cost: 1, attack: 1, health: 4, troopKind: 'infantry', keywords: [], memo: '测试',
};

/** 摆一个「藤甲盾挨打」的局面，返回目标与攻击者的坐标 */
function tengjiaUnderAttack() {
  const { state, ctx } = scenario({});
  ctx.cards.set(TENGJIA.id, TENGJIA);
  ctx.cards.set(STRAW.id, STRAW);
  // uid 必须与本文件其它用例错开（前面已用到 1~10）：光环的 auraId 以 uid 为键，
  // uid 撞车会让 recomputeAuras 认到别的单位身上。
  setUnit(state, 'enemy', 'front', 3, makeUnit(TENGJIA, 0, 201));  // 挨打方
  setUnit(state, 'own', 'front', 0, makeUnit(STRAW, 0, 202));     // 攻击方
  // 光环由 recomputeAuras 挂载 —— 直接 setUnit 进场不会跑它，
  // 必须显式重算，否则藤甲的减伤/反伤状态根本没挂上（实测 4 条用例会全灭）。
  recomputeAuras(state, ctx.cards, createRng(1), []);
  // 目标必须是**带 kind 判别字段**的 TargetRef（`unitRef()` 构造）。
  // 写成 `{ side, row, col }` 会因缺 `kind` 被 `ref.kind !== 'unit'` 判否，
  // dealDamage 在函数第一行就返回 0 —— 症状是「藤甲减伤完全不生效」，极难定位。
  return { state, ctx, target: unitRef('enemy', 'front', 3) };
}

test('ADR-108 藤甲盾：物理伤害 −1（刀枪不入）', () => {
  const { state, ctx, target } = tengjiaUnderAttack();
  const u = getUnit(state, 'enemy', 'front', 3)!;
  const before = u.hp;
  assert.equal(capStacks(u.statuses, 'reduce_physical'), 1, '藤甲减伤应挂 1 层');
  // 2 点物理伤害 → 减 1 → 实际 1 点
  const dealt = dealDamage(state, ctx.cards, target, 2, [], '测试', 0, { side: 'own', row: 'front', col: 0 },
    getUnit(state, 'own', 'front', 0) ?? undefined, 'physical');
  assert.equal(dealt, 1, 'dealt 应为 1');
  assert.equal(before - (getUnit(state, 'enemy', 'front', 3)?.hp ?? -1), 1, '2 点物理伤害应被减到 1 点');
});

test('ADR-108 藤甲盾：减伤有下限，1 点物理伤害被完全免疫（不得为负）', () => {
  const { state, ctx, target } = tengjiaUnderAttack();
  const before = getUnit(state, 'enemy', 'front', 3)!.hp;
  const dealt = dealDamage(state, ctx.cards, target, 1, [], '测试', 0, { side: 'own', row: 'front', col: 0 },
    getUnit(state, 'own', 'front', 0) ?? undefined, 'physical');
  assert.equal(dealt, 0, '1 点物理伤害应被完全减掉');
  assert.equal(getUnit(state, 'enemy', 'front', 3)!.hp, before, '血量不应变化');
});

test('ADR-108 藤甲盾：火属性伤害 +1（遇火即燃）', () => {
  const { state, ctx, target } = tengjiaUnderAttack();
  const before = getUnit(state, 'enemy', 'front', 3)!.hp;
  // 2 点火伤 → 加 1 → 实际 3 点
  dealDamage(state, ctx.cards, target, 2, [], '火攻', 0, { side: 'own', row: 'front', col: 0 },
    getUnit(state, 'own', 'front', 0) ?? undefined, 'fire');
  assert.equal(before - getUnit(state, 'enemy', 'front', 3)!.hp, 3, '2 点火伤应放大为 3 点');
});

test('ADR-108 藤甲盾：火属性伤害触发反伤，来源掉 1 点', () => {
  const { state, ctx, target } = tengjiaUnderAttack();
  const atkBefore = getUnit(state, 'own', 'front', 0)!.hp;
  dealDamage(state, ctx.cards, target, 2, [], '火攻', 0, { side: 'own', row: 'front', col: 0 },
    getUnit(state, 'own', 'front', 0) ?? undefined, 'fire');
  assert.equal(atkBefore - getUnit(state, 'own', 'front', 0)!.hp, 1, '伤害来源应受到 1 点反伤');
});

test('ADR-108 藤甲盾：水属性伤害不增不减（照常结算）', () => {
  const { state, ctx, target } = tengjiaUnderAttack();
  const before = getUnit(state, 'enemy', 'front', 3)!.hp;
  dealDamage(state, ctx.cards, target, 2, [], '水攻', 0, { side: 'own', row: 'front', col: 0 },
    getUnit(state, 'own', 'front', 0) ?? undefined, 'water');
  assert.equal(before - getUnit(state, 'enemy', 'front', 3)!.hp, 2, '水攻应原样结算');
});

test('ADR-108 藤甲盾：无藤甲状态的单位不受影响（能力是状态驱动，不是卡 id 驱动）', () => {
  const { state, ctx } = scenario({});
  ctx.cards.set(STRAW.id, STRAW);
  setUnit(state, 'own', 'front', 0, makeUnit(STRAW, 0, 301));
  setUnit(state, 'enemy', 'front', 1, makeUnit(STRAW, 0, 302));
  const before = getUnit(state, 'enemy', 'front', 1)!.hp;
  dealDamage(state, ctx.cards, unitRef('enemy', 'front', 1), 2, [], '测试', 0,
    { side: 'own', row: 'front', col: 0 }, getUnit(state, 'own', 'front', 0) ?? undefined, 'physical');
  assert.equal(before - getUnit(state, 'enemy', 'front', 1)!.hp, 2, '普通单位应吃满 2 点物理伤害');
});

/* ========================================================================
 * 无难兵「赴难」：己方主公血量**低于**敌方主公时攻击力 +1
 *
 * 与青州兵「青州突骑」是同一套模板（on_attack + lord_hp_vs_enemy），
 * 但条件方向相反：青州=顺风（>），无难=逆风（<）。两条都锁住，
 * 防止将来改条件时把两张卡改成同一个方向。
 * ===================================================================== */

const WUNAN: CardDef = {
  id: 'test_wunan', name: '无难兵', faction: 'wu', type: 'troop',
  cost: 3, attack: 2, health: 4, troopKind: 'shield', keywords: ['jia_dun'], memo: '测试',
  skills: [{ id: 'fu_nan', name: '赴难', kind: 'trigger', trigger: 'on_attack', effects: [
    { action: 'attack_bonus', value: 1, condition: { lord_hp_vs_enemy: '<' } },
  ] }],
};

test('无难兵 赴难：己方主公血量低于敌方时，打主公伤害 +1', () => {
  // scenario() 的 place 只认**卡池里已注册**的 id，测试卡必须先 ctx.cards.set，
  // 否则 setup 阶段就抛「测试卡不存在」。
  const { state, ctx } = scenario({});
  ctx.cards.set(WUNAN.id, WUNAN);
  setUnit(state, 'own', 'front', 0, makeUnit(WUNAN, 0, 501));
  state.sides.own.lord.hp = 20;    // 我方 20
  state.sides.enemy.lord.hp = 28;   // 敌方 28 → 逆风
  const r = applyAction(state, ctx, { type: 'ATTACK', from: { row: 'front', col: 0 }, to: { kind: 'lord' } });
  assert.equal(r.ok, true, r.error ?? '攻击应成立');
  assert.equal(r.state.sides.enemy.lord.hp, 25, '2 点基础伤害 + 1 点赴难 = 3');
});

test('无难兵 赴难：己方主公血量高于敌方时**不加成**（逆风才触发）', () => {
  const { state, ctx } = scenario({});
  ctx.cards.set(WUNAN.id, WUNAN);
  setUnit(state, 'own', 'front', 0, makeUnit(WUNAN, 0, 502));
  state.sides.own.lord.hp = 28;
  state.sides.enemy.lord.hp = 20;   // 顺风
  const r = applyAction(state, ctx, { type: 'ATTACK', from: { row: 'front', col: 0 }, to: { kind: 'lord' } });
  assert.equal(r.ok, true);
  assert.equal(r.state.sides.enemy.lord.hp, 18, '顺风时只有 2 点基础伤害，无加成');
});

test('无难兵 赴难：与青州兵「青州突骑」条件方向相反，互不串味', () => {
  const { state, ctx } = scenario({});
  ctx.cards.set(WUNAN.id, WUNAN);
  setUnit(state, 'own', 'front', 0, makeUnit(WUNAN, 0, 503));
  // 双方同血：两个条件（> 与 <）都不成立，应无任何加成
  state.sides.own.lord.hp = 25;
  state.sides.enemy.lord.hp = 25;
  const r = applyAction(state, ctx, { type: 'ATTACK', from: { row: 'front', col: 0 }, to: { kind: 'lord' } });
  assert.equal(r.ok, true);
  assert.equal(r.state.sides.enemy.lord.hp, 23, '主公同血时两条条件都不触发，只有 2 点基础伤害');
});

/* ========================================================================
 * 丹阳兵「袍泽」：阵亡时己方其他【步兵系】永久 +1/+1
 *
 * 关键不变量：只作用于 troopKind=infantry —— 盾/骑/弓系**不得**被误伤
 * （`type: troop` 的卡占全池 38 张，若过滤失效会波及所有兵种）。
 * ===================================================================== */

const DANYANG: CardDef = {
  id: 'test_danyang', name: '丹阳兵', faction: 'shu', type: 'troop',
  cost: 3, attack: 3, health: 3, troopKind: 'infantry', keywords: [], memo: '测试',
  skills: [{ id: 'pao_ze', name: '袍泽', kind: 'trigger', trigger: 'on_death', effects: [
    { action: 'modify', attack: 1, health: 1, target: {
      side: 'ally', filter: { type: 'troop', troopKind: 'infantry', exclude_source: true }, count: 'all' } },
  ] }],
};
const SHIELDER: CardDef = {
  id: 'test_shield', name: '测试盾兵', faction: 'wu', type: 'troop',
  cost: 2, attack: 1, health: 4, troopKind: 'shield', keywords: ['jia_dun'], memo: '测试',
};

test('丹阳兵 袍泽：亡语给己方其他步兵 +1/+1', () => {
  const { state, ctx } = scenario({});
  ctx.cards.set(DANYANG.id, DANYANG);
  setUnit(state, 'own', 'front', 0, makeUnit(DANYANG, 0, 504));
  setUnit(state, 'own', 'front', 1, makeUnit(DANYANG, 0, 401)); // 另一名步兵
  setUnit(state, 'own', 'front', 2, makeUnit(DANYANG, 0, 402));
  const ally = getUnit(state, 'own', 'front', 1)!;
  const ally2 = getUnit(state, 'own', 'front', 2)!;
  assert.equal(ally.atk, 3); assert.equal(ally.hp, 3);

  // 打死 0 号位的丹阳兵 → 触发亡语
  const events: GameEvent[] = [];
  dealDamage(state, ctx.cards, unitRef('own', 'front', 0), 99, events, '测试');

  assert.equal(ally.atk, 4, '另一名步兵应 +1 攻');
  assert.equal(ally.hp, 4, '另一名步兵应 +1 血');
  assert.equal(ally2.atk, 4, '第三名步兵也应吃到增益');
});

test('丹阳兵 袍泽：不得波及其他兵种（盾/骑/弓）', () => {
  const { state, ctx } = scenario({});
  ctx.cards.set(DANYANG.id, DANYANG);
  ctx.cards.set(SHIELDER.id, SHIELDER);
  setUnit(state, 'own', 'front', 0, makeUnit(DANYANG, 0, 505));
  setUnit(state, 'own', 'front', 1, makeUnit(SHIELDER, 0, 411)); // 盾兵：不该被加成
  const shield = getUnit(state, 'own', 'front', 1)!;
  assert.equal(shield.atk, 1);

  dealDamage(state, ctx.cards, unitRef('own', 'front', 0), 99, [], '测试');

  assert.equal(shield.atk, 1, '盾兵攻击力不应被步兵亡语加成');
  assert.equal(shield.hp, 4, '盾兵生命值不应被步兵亡语加成');
});
