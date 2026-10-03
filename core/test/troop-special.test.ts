import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyAction, unitSkillTargetPlan } from '../src/engine.ts';
import { dealDamage, lordRef, unitRef } from '../src/mutate.ts';
import { recomputeAuras, resolveAttack } from '../src/effects.ts';
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
 *   ① 物理/无属性伤害 −1，且**最低为 0**（1 攻单位打不动 2/4 藤甲——预期设计，ADR-110）
 *   ② 火属性伤害 +1
 *   ③ **没有反伤层**（ADR-110 删除：反弹挂在火分支会惩罚用火克制藤甲的正确行为）
 * ===================================================================== */

const TENGJIA: CardDef = {
  id: 'test_tengjia', name: '藤甲兵', faction: 'shu', type: 'troop',
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

test('ADR-110 藤甲兵：没有反伤层——火伤只放大自身，来源不掉血', () => {
  const { state, ctx, target } = tengjiaUnderAttack();
  const atkBefore = getUnit(state, 'own', 'front', 0)!.hp;
  dealDamage(state, ctx.cards, target, 2, [], '火攻', 0, { side: 'own', row: 'front', col: 0 },
    getUnit(state, 'own', 'front', 0) ?? undefined, 'fire');
  assert.equal(getUnit(state, 'own', 'front', 0)!.hp, atkBefore, '火是克制手段，不应被反弹惩罚');
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

/* ========================================================================
 * 武卫营「虎帐」（护主）
 *
 * 史实：典韦「引置左右，将亲兵数百人，常绕大帐」——护卫主公是本职。
 * 机制复用已有的 hu_zhu（redirect_damage + guard_scope:lord）。
 *
 * 这条用例锁的是**「持续承伤直到阵亡」**的完整行为，而不只是"能触发一次"：
 *   ① 主公受 2 伤 → 血量不变，武卫营掉 2
 *   ② 再次受 2 伤 → 守护者阵亡
 *   ③ 阵亡后主公开始正常掉血（保护消失）
 * 另有一条锁住**「架盾挡不住效果伤害」**这个缺口：护主正是为补它而存在。
 * ===================================================================== */

const WUWEI: CardDef = {
  id: 'test_wuweiying', name: '武卫营', faction: 'wei', type: 'troop',
  cost: 2, attack: 2, health: 4, troopKind: 'shield', keywords: ['jia_dun'], memo: '测试',
  skills: [{ id: 'hu_zhang', name: '虎帐', kind: 'aura', effects: [
    { action: 'apply_status', status: 'hu_zhu', status_source: 'self', target: { side: 'ally', lord: true } },
  ] }],
};

/** 摆一个「武卫营护卫主公」的局面（需显式重算光环才会挂上 hu_zhu） */
function wuweiGuarding() {
  const { state, ctx } = scenario({});
  ctx.cards.set(WUWEI.id, WUWEI);
  setUnit(state, 'own', 'front', 0, makeUnit(WUWEI, 0, 601));
  recomputeAuras(state, ctx.cards, createRng(1), []);
  return { state, ctx };
}

test('武卫营 虎帐：主公受到的伤害由自己承受，自己不掉血', () => {
  const { state, ctx } = wuweiGuarding();
  const guard = getUnit(state, 'own', 'front', 0)!;
  const lordBefore = state.sides.own.lord.hp;
  assert.equal(guard.hp, 4, '起始应为满血 4');
  assert.ok(state.sides.own.lord.statuses?.hu_zhu, '主公应挂上 hu_zhu 守护状态');

  dealDamage(state, ctx.cards, lordRef('own'), 2, [], '测试');

  assert.equal(state.sides.own.lord.hp, lordBefore, '主公血量不应变化');
  assert.equal(getUnit(state, 'own', 'front', 0)!.hp, 2, '武卫营应代为承受 2 点伤害');
});

test('武卫营 虎帐：自己被打光后保护消失，主公开始正常掉血', () => {
  const { state, ctx } = wuweiGuarding();
  // 先打光守护者：4 血，两次 2 点
  dealDamage(state, ctx.cards, unitRef('own', 'front', 0), 2, [], '测试');
  dealDamage(state, ctx.cards, unitRef('own', 'front', 0), 2, [], '测试');
  assert.equal(getUnit(state, 'own', 'front', 0), null, '武卫营应已阵亡');

  // 光环重算（阵亡结算后会跑）后主公不再有 hu_zhu
  recomputeAuras(state, ctx.cards, createRng(1), []);
  const lordBefore = state.sides.own.lord.hp;
  dealDamage(state, ctx.cards, lordRef('own'), 2, [], '测试');
  assert.equal(state.sides.own.lord.hp, lordBefore - 2, '守护者阵亡后，主公应正常承受伤害');
});

test('武卫营 虎帐：护的是「效果伤害」——架盾挡不住的那类（存在的缺口）', () => {
  // 架盾只写在 legalTargets 里，约束的是**普通攻击的目标选择**；
  // 卡牌效果造成的伤害不经过它。所以主公每回合都在被绕过架盾直击，
  // 武卫营的虎帐正是补这个缺口。
  const { state, ctx } = wuweiGuarding();
  const lordBefore = state.sides.own.lord.hp;
  // 走与「卡牌效果」同一条路径（dealDamage + lordRef），不走 ATTACK
  const events: GameEvent[] = [];
  dealDamage(state, ctx.cards, lordRef('own'), 3, events, '楼船军', 0, undefined, undefined, 'water');
  assert.ok(events.some((e) => e.type === 'DAMAGE_REDIRECTED' && 'lord' in e && e.lord === true),
    '应产生「主公伤害被转走」的事件');
  assert.equal(state.sides.own.lord.hp, lordBefore, '主公不应因效果伤害掉血');
});

test('武卫营 虎帐：己方与敌方各一个时，只护己方主公', () => {
  const { state, ctx } = wuweiGuarding();
  // 敌方也放一个武卫营，护敌方主公
  setUnit(state, 'enemy', 'front', 0, makeUnit(WUWEI, 0, 602));
  recomputeAuras(state, ctx.cards, createRng(1), []);

  const ownBefore = state.sides.own.lord.hp;
  const enemyBefore = state.sides.enemy.lord.hp;
  dealDamage(state, ctx.cards, lordRef('enemy'), 2, [], '测试');
  assert.equal(state.sides.own.lord.hp, ownBefore, '己方主公不应因敌方受击而变化');
  assert.equal(state.sides.enemy.lord.hp, enemyBefore, '敌方主公的伤害应由敌方武卫营承担');
  assert.equal(getUnit(state, 'enemy', 'front', 0)!.hp, 2, '敌方武卫营应代为承受');
});

/* ========================================================================
 * 白毦兵「忠勇」：受到普通攻击后，对攻击者**额外**造成 1 点伤害
 *
 * 这是 ADR-110 释放出来的 `thorns` cap 的首个使用者（此前藤甲兵删掉反伤层后，
 * 引擎代码保留但无卡在用 = 休眠路径）。三条不变量各锁一个用例：
 *   ① 与**自动反击**分开结算 —— 合计回敬 = 反击 2 + 忠勇 1 = 3
 *   ② **技能伤害不触发**（无 killerRef）—— 这是它的解药
 *   ③ 即使被打死也触发（与「反击同时结算、死了也反击」的语义一致）
 * ===================================================================== */

const BAIER: CardDef = {
  id: 'test_baier', name: '白毦兵', faction: 'shu', type: 'troop',
  cost: 3, attack: 2, health: 6, troopKind: 'shield', keywords: ['jia_dun'], memo: '测试',
  skills: [{ id: 'zhong_yong', name: '忠勇', kind: 'aura', effects: [
    { action: 'apply_status', status: 'zhong_yong_status', stacks: 1, target: { source: true } },
  ] }],
};
const RAIDER: CardDef = {
  id: 'test_raider', name: '攻击者', faction: 'wei', type: 'troop',
  cost: 2, attack: 3, health: 9, troopKind: 'infantry', keywords: [], memo: '测试',
};

function baierUnderAttack() {
  const { state, ctx } = scenario({});
  ctx.cards.set(BAIER.id, BAIER);
  ctx.cards.set(RAIDER.id, RAIDER);
  setUnit(state, 'enemy', 'front', 3, makeUnit(BAIER, 0, 601));   // 挨打方（蜀）
  setUnit(state, 'own', 'front', 0, makeUnit(RAIDER, 0, 602));    // 攻击方（魏）
  recomputeAuras(state, ctx.cards, createRng(1), []);
  return { state, ctx };
}

test('ADR-108 白毦兵 忠勇：普攻后额外回敬 1 点（与自动反击合计 3）', () => {
  const { state, ctx } = baierUnderAttack();
  assert.equal(capStacks(getUnit(state, 'enemy', 'front', 3)!.statuses, 'thorns'), 1, '忠勇应挂 1 层');
  const atkBefore = getUnit(state, 'own', 'front', 0)!.hp;
  resolveAttack(state, ctx.cards, 'own', { row: 'front', col: 0 },
    { kind: 'unit', row: 'front', col: 3 }, [], createRng(1), { toSide: 'enemy' });
  const lost = atkBefore - (getUnit(state, 'own', 'front', 0)?.hp ?? 0);
  assert.equal(lost, 3, '攻击者应吃 反击 2 + 忠勇 1 = 3 点');
});

test('ADR-108 白毦兵 忠勇：技能伤害不触发（无 killerRef）—— 这是它的解药', () => {
  const { state, ctx } = baierUnderAttack();
  const atkBefore = getUnit(state, 'own', 'front', 0)!.hp;
  const t0 = getUnit(state, 'enemy', 'front', 3)!.hp;
  // 模拟火攻/战技：走 dealDamage 的技能路径，不传 killerRef
  dealDamage(state, ctx.cards, unitRef('enemy', 'front', 3), 2, [], '火攻',
    0, undefined, undefined, 'fire');
  assert.equal(getUnit(state, 'enemy', 'front', 3)!.hp, t0 - 2, '白毦兵应正常受伤');
  assert.equal(getUnit(state, 'own', 'front', 0)!.hp, atkBefore, '技能伤害不得引发忠勇回敬');
});

test('ADR-108 白毦兵 忠勇：即使本击被打死也照样回敬（与反击「同时结算」一致）', () => {
  const { state, ctx } = baierUnderAttack();
  ctx.cards.set(RAIDER.id, { ...RAIDER, attack: 20 });
  setUnit(state, 'own', 'front', 0, makeUnit({ ...RAIDER, attack: 20 }, 0, 603));
  const atkBefore = getUnit(state, 'own', 'front', 0)!.hp;
  resolveAttack(state, ctx.cards, 'own', { row: 'front', col: 0 },
    { kind: 'unit', row: 'front', col: 3 }, [], createRng(1), { toSide: 'enemy' });
  assert.equal(getUnit(state, 'enemy', 'front', 3), null, '白毦兵应被击杀并离场');
  assert.equal(atkBefore - (getUnit(state, 'own', 'front', 0)?.hp ?? 0), 3, '阵亡也要吃满 反击 2 + 忠勇 1');
});
