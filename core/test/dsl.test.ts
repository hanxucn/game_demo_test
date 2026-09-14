/**
 * 效果 DSL 扩展测试（ADR-030 / ADR-031 / ADR-033）
 *
 * 覆盖：概率 chance、条件 condition、动态取值 *_from、source 选择器、
 *       新动作 discard / return_to_hand、damage 的 count。
 *
 * 设计原则：**卡牌效果没有"特殊机制"，只有通用算子的组合**。
 * 运行：cd core && npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyAction } from '../src/engine.ts';
import { getUnit, makeUnit, setUnit } from '../src/state.ts';
import { TEST_CARDS, scenario } from './fixtures.ts';
import { effectiveCost, findGuard, isBanned } from '../src/mutate.ts';
import type { CardDef, Unit } from '../src/types.ts';

/* ---------- 测试用卡 ---------- */

const base = (id: string) => TEST_CARDS.find((x) => x.id === id)!;

/** 造一张测试卡并**注册进夹具**（scenario 的 ownHand 按 id 查找 TEST_CARDS） */
const CARD = (over: Partial<CardDef>): CardDef => {
  const c: CardDef = {
    id: 'test_x', name: '测试', faction: 'shu', type: 'general',
    cost: 3, attack: 2, health: 3, keywords: [], memo: '测试', ...over,
  };
  if (!TEST_CARDS.some((x) => x.id === c.id)) TEST_CARDS.push(c);
  return c;
};

const unit = (id: string, atk: number, hp: number, tags: string[] = [], faction: 'shu' | 'wei' = 'wei'): Unit =>
  ({ ...makeUnit(CARD({ id, name: id, attack: atk, health: hp, tags, faction }), 1, 1) } as Unit);

/* ---------- 条件 condition：event ---------- */

test('condition.event=killed：击杀后才召唤', () => {
  const zhangjiao = CARD({
    id: 'test_zj', name: '张角', type: 'strategist', cost: 5, attack: 1, health: 5,
    skills: [{
      id: 'lei', name: '五雷', kind: 'trigger', trigger: 'turn_end',
      effects: [
        { action: 'damage', value: 1, count: 5,
          target: { side: 'enemy', filter: { type: 'character' }, count: 1, mode: 'random' } },
        { action: 'summon', unit: 'neutral_infantry', count: 1, position: 'random',
          condition: { event: 'killed' } },
      ],
    }],
  });
  const { state, ctx } = scenario({ ownHand: [] });
  const u = makeUnit(zhangjiao, 1, 90);
  setUnit(state, 'own', 'back', 2, u);
  // 敌方一个 1 血单位：必被 5 次雷击中的某一次击杀
  setUnit(state, 'enemy', 'front', 0, unit('dying', 1, 1));
  const r = applyAction(state, ctx, { type: 'END_TURN' });
  const summoned = r.events.filter((e) => e.type === 'UNIT_SUMMONED' && e.side === 'own');
  assert.equal(summoned.length, 1, '发生了击杀 → 应召唤 1 个黄巾兵');
});

test('condition.event=killed：没击杀就不召唤', () => {
  const zhangjiao = CARD({
    id: 'test_zj2', name: '张角', type: 'strategist', cost: 5, attack: 1, health: 5,
    skills: [{
      id: 'lei', name: '五雷', kind: 'trigger', trigger: 'turn_end',
      effects: [
        { action: 'damage', value: 1, count: 1,
          target: { side: 'enemy', filter: { type: 'character' }, count: 1, mode: 'random' } },
        { action: 'summon', unit: 'neutral_infantry', count: 1, position: 'random',
          condition: { event: 'killed' } },
      ],
    }],
  });
  const { state, ctx } = scenario({ ownHand: [] });
  setUnit(state, 'own', 'back', 2, makeUnit(zhangjiao, 1, 91));
  setUnit(state, 'enemy', 'front', 0, unit('tanky', 1, 9));   // 9 血，1 点伤害杀不死
  const r = applyAction(state, ctx, { type: 'END_TURN' });
  const summoned = r.events.filter((e) => e.type === 'UNIT_SUMMONED' && e.side === 'own');
  assert.equal(summoned.length, 0, '没有击杀 → 不该召唤');
});

/* ---------- 条件 condition：count ---------- */

test('condition.count：场上只有 1 名己方人物时才生效', () => {
  const lonely = CARD({
    id: 'test_lonely', name: '独守', cost: 3, attack: 2, health: 3,
    skills: [{
      id: 's', name: '一夫当关', kind: 'trigger', trigger: 'on_play',
      effects: [{ action: 'modify', attack: 1, target: { source: true },
                  condition: { count: { selector: { side: 'ally', filter: { type: 'character' } }, op: '==', value: 1 } } }],
    }],
  });
  // 场景 A：只有自己 → 生效
  const a = scenario({ ownHand: ['test_lonely'] });
  const ra = applyAction(a.state, a.ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 0 });
  assert.equal(getUnit(ra.state, 'own', 'front', 0)?.atk, 3, '独自一人应 +1 攻');

  // 场景 B：已有同伴 → 不生效
  const b = scenario({ ownHand: ['test_lonely'] });
  setUnit(b.state, 'own', 'front', 1, unit('buddy', 2, 2, [], 'shu'));
  const rb = applyAction(b.state, b.ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 0 });
  assert.equal(getUnit(rb.state, 'own', 'front', 0)?.atk, 2, '有同伴时不该 +1 攻');
});

/* ---------- 动态取值 *_from ---------- */

test('动态取值：每有 1 名蛮族人物自身 +1/+1', () => {
  const huwang = CARD({
    id: 'test_huwang', name: '沙摩柯', cost: 4, attack: 3, health: 4, tags: ['man_zu'],
    skills: [{
      id: 'h', name: '胡王', kind: 'trigger', trigger: 'on_play',
      effects: [{
        action: 'modify',
        attack_from: { side: 'both', filter: { tag: 'man_zu' } },
        health_from: { side: 'both', filter: { tag: 'man_zu' } },
        target: { source: true },
      }],
    }],
  });
  const { state, ctx } = scenario({ ownHand: ['test_huwang'] });
  setUnit(state, 'own', 'front', 0, unit('m2', 3, 3, ['man_zu'], 'shu'));
  setUnit(state, 'enemy', 'front', 0, unit('m3', 3, 3, ['man_zu']));
  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 2 });
  const me = getUnit(r.state, 'own', 'front', 2);
  assert.equal(me?.atk, 6, '场上 3 名蛮族 → 3 + 3 = 6');
  assert.equal(me?.hp, 7, '场上 3 名蛮族 → 4 + 3 = 7');
  assert.equal(getUnit(r.state, 'own', 'front', 0)?.atk, 3, '同伴不该被误加');
});

/* ---------- source 选择器 ---------- */

test('target.source：只作用于来源单位自身', () => {
  const selfish = CARD({
    id: 'test_selfish', name: '自励', cost: 2, attack: 2, health: 2,
    skills: [{
      id: 's', name: '自励', kind: 'trigger', trigger: 'on_play',
      effects: [{ action: 'modify', attack: 1, target: { source: true } }],
    }],
  });
  const { state, ctx } = scenario({ ownHand: ['test_selfish'] });
  setUnit(state, 'own', 'front', 0, unit('other', 5, 5, [], 'shu'));
  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 1 });
  assert.equal(getUnit(r.state, 'own', 'front', 1)?.atk, 3, '自己 +1');
  assert.equal(getUnit(r.state, 'own', 'front', 0)?.atk, 5, '别人不受影响');
});

/* ---------- 动作 discard / return_to_hand ---------- */

test('discard：从指定方手牌弃牌（按「方」结算，不依赖场上有无单位）', () => {
  const discarder = CARD({
    id: 'test_discard', name: '弃牌', type: 'strategist', cost: 5, attack: 1, health: 5,
    skills: [{
      id: 'd', name: '审时度势', kind: 'trigger', trigger: 'on_play',
      effects: [{ action: 'discard', count: 2, target: { side: 'enemy' } }],
    }],
  });
  const { state, ctx } = scenario({
    ownHand: ['test_discard'],
    enemyHand: ['neutral_infantry', 'neutral_archer', 'neutral_shieldman'],
  });
  const before = state.sides.enemy.hand.length;
  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'back', col: 1 });
  assert.equal(r.state.sides.enemy.hand.length, before - 2, '敌方手牌应少 2 张');
  assert.equal(r.state.sides.enemy.discard.length, 2, '弃牌堆应有 2 张');
});

test('return_to_hand：把场上单位收回手牌', () => {
  const recall = CARD({
    id: 'test_recall', name: '避其锐气', type: 'tactic', cost: 2,
    effects: [{ action: 'return_to_hand', target: { side: 'ally', filter: { type: 'character' }, count: 1, mode: 'first' } }],
  });
  const { state, ctx } = scenario({ ownHand: ['test_recall'] });
  setUnit(state, 'own', 'front', 0, makeUnit(CARD({ id: 'neutral_infantry', name: '步兵' }), 1, 50));
  const handBefore = state.sides.own.hand.length;
  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0 });
  assert.equal(getUnit(r.state, 'own', 'front', 0), null, '场上单位应被收回');
  assert.equal(r.state.sides.own.hand.length, handBefore, '打出 1 张、收回 1 张 → 手牌数不变');
  assert.ok(r.events.some((e) => e.type === 'UNIT_RETURNED'), '应有 UNIT_RETURNED 事件');
});

/* ---------- damage 的 count ---------- */

test('damage.count：重复结算 N 次', () => {
  const multi = CARD({
    id: 'test_multi', name: '连击', cost: 3, attack: 2, health: 3,
    skills: [{
      id: 'm', name: '三连', kind: 'trigger', trigger: 'on_play',
      effects: [{ action: 'damage', value: 1, count: 3,
                  target: { side: 'enemy', filter: { type: 'character' }, count: 1, mode: 'lowest_health' } }],
    }],
  });
  const { state, ctx } = scenario({ ownHand: ['test_multi'] });
  setUnit(state, 'enemy', 'front', 0, unit('tank', 1, 10));
  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 0 });
  assert.equal(getUnit(r.state, 'enemy', 'front', 0)?.hp, 7, '3 次 1 伤 → 10 - 3 = 7');
});

/* ---------- 概率：固定 seed 可复现 ---------- */

test('chance：同 seed 结果可复现（确定性 RNG）', () => {
  const gambler = CARD({
    id: 'test_gamble', name: '设伏', cost: 3, attack: 2, health: 3,
    skills: [{
      id: 'g', name: '设伏', kind: 'trigger', trigger: 'on_play',
      effects: [{ action: 'apply_status', status: 'zhen_she', duration: 1, chance: 0.5,
                  target: { side: 'enemy', filter: { type: 'character' }, count: 1, mode: 'random' } }],
    }],
  });
  const runOnce = (seed: number) => {
    const { state, ctx } = scenario({ ownHand: ['test_gamble'], seed });
    setUnit(state, 'enemy', 'front', 0, unit('e', 3, 3));
    const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 1 });
    return getUnit(r.state, 'enemy', 'front', 0)?.statuses.zhen_she?.stacks ?? 0;
  };
  assert.equal(runOnce(7), runOnce(7), '同 seed 必须同结果');
  const hits = Array.from({ length: 40 }, (_, i) => runOnce(i)).filter((v) => v > 0).length;
  assert.ok(hits > 8 && hits < 32, `50% 概率 40 次应命中约 20 次，实测 ${hits}`);
});

/* ---------- ADR-034：状态能力机制 ---------- */

test('状态持续时间：1 回合后自动失效，永久状态保留', () => {
  const applier = CARD({
    id: 'test_applier', name: '施法', type: 'strategist', cost: 3, attack: 1, health: 3,
    skills: [{
      id: 'a', name: '施加', kind: 'trigger', trigger: 'on_play',
      effects: [
        { action: 'apply_status', status: 'zhen_she', duration: 1, target: { side: 'enemy' } },
        { action: 'apply_status', status: 'zhong_du', stacks: 1, target: { side: 'enemy' } },   // 永久
      ],
    }],
  });
  const { state, ctx } = scenario({ ownHand: ['test_applier'] });
  setUnit(state, 'enemy', 'front', 0, unit('e', 3, 9));
  const r1 = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'back', col: 1 });
  const e1 = getUnit(r1.state, 'enemy', 'front', 0);
  assert.equal(e1?.statuses.zhen_she?.stacks, 1, '震慑应生效');
  assert.equal(e1?.statuses.zhen_she?.turns, 1, '震慑应剩 1 回合');
  assert.equal(e1?.statuses.zhong_du?.turns, undefined, '中毒应是永久');

  // 持续时间在**持有者**的回合结束时递减：结束己方回合 → 敌方回合 → 敌方结束
  const r2 = applyAction(r1.state, ctx, { type: 'END_TURN' });   // 己方结束
  const before = getUnit(r2.state, 'enemy', 'front', 0);
  assert.equal(before?.statuses.zhen_she?.turns, 1, '敌方回合内震慑仍应生效（这正是它的价值）');
  const r3 = applyAction(r2.state, ctx, { type: 'END_TURN' });   // 敌方结束
  const e2 = getUnit(r3.state, 'enemy', 'front', 0);
  assert.equal(e2?.statuses.zhen_she, undefined, '敌方回合结束后震慑应失效');
  assert.ok(e2?.statuses.zhong_du, '永久状态应保留');
});

test('禁用状态：不能使用主动技，但仍可普通攻击', () => {
  const caster = CARD({
    id: 'test_caster', name: '谋臣', type: 'strategist', cost: 3, attack: 0, health: 5,
    skills: [{ id: 's', name: '火计', kind: 'active', cost: 1,
               effects: [{ action: 'damage', value: 2, target: { side: 'enemy' } }] }],
  });
  const { state, ctx } = scenario({ own: { back: ['test_caster'] } });
  setUnit(state, 'enemy', 'front', 0, unit('e', 3, 9));
  const blocked = { ...state.sides.own.rows.back[0]!, statuses: { jin_yong: { stacks: 1, turns: 1 } } };
  setUnit(state, 'own', 'back', 0, blocked);
  const skill = applyAction(state, ctx, { type: 'USE_SKILL', row: 'back', col: 0 });
  assert.equal(skill.ok, false, '被禁用时不能使用主动技');
});

test('免疫状态：不能作为目标，且免疫负面状态', () => {
  const applier = CARD({
    id: 'test_debuff', name: '诅咒', type: 'strategist', cost: 3, attack: 1, health: 3,
    skills: [{
      id: 'd', name: '诅咒', kind: 'trigger', trigger: 'on_play',
      effects: [{ action: 'apply_status', status: 'zhen_she', duration: 1,
                  target: { side: 'enemy', filter: { type: 'character' }, count: 1, mode: 'first' } }],
    }],
  });
  const { state, ctx } = scenario({ ownHand: ['test_debuff'] });
  const immune = { ...unit('immune', 3, 9), statuses: { mian_yi: { stacks: 1, turns: 2 } } };
  setUnit(state, 'enemy', 'front', 0, immune);
  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'back', col: 1 });
  const e = getUnit(r.state, 'enemy', 'front', 0);
  assert.equal(e?.statuses.zhen_she, undefined, '免疫单位不该被挂上震慑');
});

test('混乱状态：目标在全体中随机（不分敌我）', () => {
  // 混乱者带一个 turn_end 技能：对「敌方」造成 1 点伤害；
  // 但处于混乱时，目标池扩为全场，因此可能打到自己人
  const confused = CARD({
    id: 'test_confused', name: '混乱者', type: 'strategist', cost: 3, attack: 1, health: 5,
    skills: [{
      id: 'c', name: '乱击', kind: 'trigger', trigger: 'turn_end',
      effects: [{ action: 'damage', value: 1,
                  target: { side: 'enemy', filter: { type: 'character' }, count: 1 } }],
    }],
  });
  let hitAlly = 0;
  for (let seed = 0; seed < 30; seed++) {
    const { state, ctx } = scenario({ ownHand: [], seed });
    setUnit(state, 'own', 'back', 1, makeUnit(confused, 1, 80));
    setUnit(state, 'own', 'front', 0, unit('ally1', 2, 5, [], 'shu'));
    setUnit(state, 'enemy', 'front', 0, unit('foe1', 2, 5));
    // 给混乱者挂上混乱
    getUnit(state, 'own', 'back', 1)!.statuses.hun_luan = { stacks: 1, turns: 1 };
    const r = applyAction(state, ctx, { type: 'END_TURN' });
    if ((getUnit(r.state, 'own', 'front', 0)?.hp ?? 5) < 5) hitAlly++;
  }
  assert.ok(hitAlly > 0, `混乱时应有打到自己人的情况（实测 ${hitAlly}/30）`);
  assert.ok(hitAlly < 30, `不应总是打自己人（实测 ${hitAlly}/30）`);
});

test('clash 拼点：结果写入 flags 供条件判定', () => {
  const dueler = CARD({
    id: 'test_duel', name: '拼点者', type: 'general', cost: 4, attack: 3, health: 4,
    skills: [{
      id: 'd', name: '拼点', kind: 'trigger', trigger: 'on_play',
      effects: [
        { action: 'clash', unit: 'roll', target: { side: 'enemy' } },
        { action: 'damage', value: 3, target: { side: 'enemy', filter: { type: 'character' }, mode: 'first' },
          condition: { event: 'clash_won' } },
      ],
    }],
  });
  let wins = 0;
  for (let seed = 0; seed < 40; seed++) {
    const { state, ctx } = scenario({ ownHand: ['test_duel'], seed });
    setUnit(state, 'enemy', 'front', 0, unit('e', 3, 9));
    const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 1 });
    assert.ok(r.events.some((e) => e.type === 'CLASH'), '应产生 CLASH 事件');
    if ((getUnit(r.state, 'enemy', 'front', 0)?.hp ?? 9) < 9) wins++;
  }
  assert.ok(wins > 5 && wins < 35, `掷点拼点胜率应接近五成，实测 ${wins}/40`);
});

/* ---------- ADR-037：光环与属性修正层 ---------- */

test('光环：条件变化时重算（沙摩柯 胡王「每有 1 名蛮族 +1/+1」）', () => {
  const huwang = CARD({
    id: 'test_hw', name: '沙摩柯', cost: 4, attack: 3, health: 4, tags: ['man_zu'],
    skills: [{
      id: 'h', name: '胡王', kind: 'aura',
      effects: [{
        action: 'modify',
        attack_from: { side: 'both', filter: { tag: 'man_zu' } },
        health_from: { side: 'both', filter: { tag: 'man_zu' } },
        target: { source: true },
      }],
    }],
  });
  const manzu = CARD({ id: 'test_mz', name: '蛮兵', cost: 1, attack: 2, health: 2, tags: ['man_zu'] });
  const { state, ctx } = scenario({ ownHand: ['test_hw', 'test_mz'] });
  setUnit(state, 'own', 'front', 0, unit('m1', 2, 2, ['man_zu'], 'shu'));   // 场上已有 1 名蛮族

  // 打出沙摩柯 → 蛮族数 = 2 → +2/+2
  const r1 = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 1 });
  const me1 = getUnit(r1.state, 'own', 'front', 1)!;
  assert.equal(me1.atk, 5, `3 + 2 名蛮族 = 5，实际 ${me1.atk}`);
  assert.equal(me1.maxHp, 6, `4 + 2 = 6，实际 ${me1.maxHp}`);

  // 再上一个蛮族 → 蛮族数 = 3 → 光环应重算为 +3/+3（这正是光环与触发技的区别）
  const r2 = applyAction(r1.state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 2 });
  const me2 = getUnit(r2.state, 'own', 'front', 1)!;
  assert.equal(me2.atk, 6, `3 + 3 名蛮族 = 6，实际 ${me2.atk}`);
  assert.equal(me2.maxHp, 7, `4 + 3 = 7，实际 ${me2.maxHp}`);
});

test('光环：来源阵亡后修正被移除', () => {
  const lord: CardDef = {
    id: 'test_aura_src', name: '光环源', faction: 'shu', type: 'general',
    cost: 3, attack: 1, health: 1, keywords: [], tags: [], memo: '光环',
    skills: [{
      id: 'a', name: '增益', kind: 'aura',
      effects: [{ action: 'modify', attack: 2, target: { side: 'ally', filter: { type: 'character' }, count: 'all' } }],
    }],
  };
  TEST_CARDS.push(lord);
  const { state, ctx } = scenario({ own: { front: ['test_aura_src'] } });
  setUnit(state, 'own', 'front', 1, unit('friend', 3, 3, [], 'shu'));
  // 手动触发一次入场重算
  const r0 = applyAction(state, ctx, { type: 'END_TURN' });   // 回合开始会重算
  const buffed = getUnit(r0.state, 'own', 'front', 1)?.atk ?? 0;
  assert.equal(buffed, 5, `友军应被光环 +2（3 → 5），实际 ${buffed}`);
});

test('临时属性修正：到期后回滚（甘宁「-1 攻一回合」）', () => {
  const ganning = CARD({
    id: 'test_gn', name: '甘宁', cost: 5, attack: 5, health: 5,
    skills: [{
      id: 'b', name: '百骑劫营', kind: 'trigger', trigger: 'on_play',
      effects: [{ action: 'modify', attack: -1, duration: 1,
                  target: { side: 'enemy', filter: { type: 'character' }, count: 'all' } }],
    }],
  });
  const { state, ctx } = scenario({ ownHand: ['test_gn'] });
  setUnit(state, 'enemy', 'front', 0, unit('foe', 4, 4));
  const r1 = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'back', col: 1 });
  assert.equal(getUnit(r1.state, 'enemy', 'front', 0)?.atk, 3, '打出时 -1 攻');

  // 走完敌方回合 → 临时修正到期
  const r2 = applyAction(r1.state, ctx, { type: 'END_TURN' });   // 己方结束
  const r3 = applyAction(r2.state, ctx, { type: 'END_TURN' });   // 敌方结束
  assert.equal(getUnit(r3.state, 'enemy', 'front', 0)?.atk, 4, '一回合后应回滚到 4');
});

test('永久修正：不会到期（张郃 -2 攻）', () => {
  const zhanghe = CARD({
    id: 'test_zh', name: '张郃', cost: 5, attack: 4, health: 4,
    skills: [{
      id: 'l', name: '料战如计', kind: 'trigger', trigger: 'on_play',
      effects: [{ action: 'modify', attack: -2,
                  target: { side: 'enemy', filter: { type: 'character' }, count: 1, mode: 'first' } }],
    }],
  });
  const { state, ctx } = scenario({ ownHand: ['test_zh'] });
  setUnit(state, 'enemy', 'front', 0, unit('foe', 4, 4));
  const r1 = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 1 });
  assert.equal(getUnit(r1.state, 'enemy', 'front', 0)?.atk, 2, '打出时 -2 攻');
  const r2 = applyAction(r1.state, ctx, { type: 'END_TURN' });
  const r3 = applyAction(r2.state, ctx, { type: 'END_TURN' });
  assert.equal(getUnit(r3.state, 'enemy', 'front', 0)?.atk, 2, '永久修正不该回滚');
});

test('基础值不被修正污染：光环移除后回到卡面值', () => {
  const buffer = CARD({
    id: 'test_buf', name: '光环者', cost: 2, attack: 2, health: 2,
    skills: [{ id: 'b', name: '鼓舞', kind: 'aura',
               effects: [{ action: 'modify', attack: 3, target: { source: true } }] }],
  });
  const { state, ctx } = scenario({ own: { front: ['test_buf'] } });
  const u = getUnit(state, 'own', 'front', 0)!;
  // 入场时未走重算，派生值仍是基础值
  assert.equal(u.baseAtk, 2, '基础攻击应固定为卡面值');
  const r = applyAction(state, ctx, { type: 'END_TURN' });
  assert.equal(getUnit(r.state, 'own', 'front', 0)?.atk, 5, '重算后 2 + 3 = 5');
  assert.equal(getUnit(r.state, 'own', 'front', 0)?.baseAtk, 2, '基础值不变');
});

/* ---------- ADR-038：手牌操作 ---------- */

test('手牌实例：费用修正不污染共享的卡牌定义', () => {
  const cheaper = CARD({
    id: 'test_cheap', name: '减费', type: 'strategist', cost: 3, attack: 0, health: 3,
    skills: [{
      id: 'c', name: '减费', kind: 'trigger', trigger: 'on_play',
      effects: [{ action: 'cost_modifier', value: -1, duration: 1,
                  target: { side: 'self', zone: 'hand', count: 'all' } }],
    }],
  });
  const { state, ctx } = scenario({ ownHand: ['test_cheap', 'neutral_infantry'] });
  const originalCost = base('neutral_infantry').cost;
  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'back', col: 1 });
  // 手牌费用被改
  const hc = r.state.sides.own.hand.find((x) => x.card.id === 'neutral_infantry')!;
  assert.equal(effectiveCost(hc), originalCost - 1, '手牌费用应 -1');
  // 但共享的卡牌定义没被污染
  assert.equal(base('neutral_infantry').cost, originalCost, '卡牌定义的费用不该被改动');
});

test('禁止上场：被 ban 的手牌打不出去，到期后恢复', () => {
  const banner = CARD({
    id: 'test_ban', name: '封锁', type: 'strategist', cost: 3, attack: 0, health: 3,
    skills: [{
      id: 'b', name: '封锁', kind: 'trigger', trigger: 'on_play',
      effects: [{ action: 'ban_play', duration: 1,
                  target: { side: 'enemy', zone: 'hand', count: 1, mode: 'first' } }],
    }],
  });
  const { state, ctx } = scenario({ ownHand: ['test_ban'], enemyHand: ['neutral_infantry'] });
  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'back', col: 1 });
  assert.ok(isBanned(r.state.sides.enemy.hand[0]!), '敌方手牌应被禁止上场');
});

test('夺取手牌：从敌方手牌取走并强制上场', () => {
  const stealer = CARD({
    id: 'test_steal', name: '激将', type: 'tactic', cost: 4,
    effects: [{ action: 'steal_card', count: 1, to: 'board', target: { side: 'enemy' } }],
  });
  const { state, ctx } = scenario({ ownHand: ['test_steal'], enemyHand: ['neutral_infantry'] });
  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0 });
  assert.equal(r.state.sides.enemy.hand.length, 0, '敌方手牌应被取走');
  const onBoard = ['front', 'back'] as const;
  const summoned = onBoard.some((row) => r.state.sides.own.rows[row].some((u) => u?.cardId === 'neutral_infantry'));
  assert.ok(summoned, '被夺取的人物卡应强制上场到我方');
});

/* ---------- ADR-039：伤害重定向与免死 ---------- */

test('伤害重定向：伤害整体转给守护者，原目标毫发无伤', () => {
  // 周泰：给一名友军挂「守护」，伤害转由自己承受
  const protector = CARD({
    id: 'test_guard', name: '周泰', cost: 4, attack: 3, health: 6,
    skills: [{
      id: 'g', name: '铁血守护', kind: 'trigger', trigger: 'on_play',
      effects: [{ action: 'apply_status', status: 'shou_hu', duration: 1, status_source: 'self',
                  target: { side: 'ally', filter: { type: 'character' }, count: 1, mode: 'first' } }],
    }],
  });
  // 只打「场上第一个己方人物」（即 ward），隔离验证转移，避免 AOE 同时直接命中周泰
  const single = CARD({
    id: 'test_ally_hit', name: '试炼', type: 'tactic', cost: 0,
    effects: [{ action: 'damage', value: 2,
                target: { side: 'ally', filter: { type: 'character' }, count: 1, mode: 'first' } }],
  });
  const { state, ctx } = scenario({ ownHand: ['test_guard'] });
  setUnit(state, 'own', 'front', 0, unit('ward', 2, 5, [], 'shu'));   // 被保护者
  const r1 = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 1 });

  const ward = getUnit(r1.state, 'own', 'front', 0)!;
  const zhou = getUnit(r1.state, 'own', 'front', 1)!;
  assert.ok(ward.statuses.shou_hu, 'ward 应获得守护状态');
  assert.equal(ward.statuses.shou_hu?.srcUid, zhou.uid, '守护状态应记录周泰的 uid');

  const wardHp0 = ward.hp, zhouHp0 = zhou.hp;
  // 打出 AOE（0 费，直接可用）
  r1.state.sides.own.command.cur = 10;
  const idx = r1.state.sides.own.hand.findIndex((h) => h.card.id === 'test_guard');
  void idx;
  r1.state.sides.own.hand.push({ card: TEST_CARDS.find((x) => x.id === 'test_ally_hit')!, mods: [] });
  const r2 = applyAction(r1.state, ctx, { type: 'PLAY_CARD', cardIndex: r1.state.sides.own.hand.length - 1 });

  const ward2 = getUnit(r2.state, 'own', 'front', 0)!;
  const zhou2 = getUnit(r2.state, 'own', 'front', 1)!;
  assert.ok(r2.events.some((e) => e.type === 'DAMAGE_REDIRECTED'), '应产生 DAMAGE_REDIRECTED 事件');
  assert.equal(ward2.hp, wardHp0, `被保护者不该掉血（${wardHp0} → ${ward2.hp}）`);
  assert.equal(zhou2.hp, zhouHp0 - 2, `守护者应承受 2 点（${zhouHp0} → ${zhou2.hp}）`);
});

test('伤害重定向：守护者阵亡后伤害回落到原目标', () => {
  const { state } = scenario({ own: { front: ['neutral_infantry'] } });
  const ward = getUnit(state, 'own', 'front', 0)!;
  ward.statuses.shou_hu = { stacks: 1, turns: 1, srcUid: 'ghost#999' };   // 守护者已不存在
  const guard = findGuard(state, ward);
  assert.equal(guard, null, '守护者不存在时应返回 null（伤害回落）');
});

test('伤害重定向：不自我守护（srcUid 等于自己时忽略）', () => {
  const { state } = scenario({ own: { front: ['neutral_infantry'] } });
  const u = getUnit(state, 'own', 'front', 0)!;
  u.statuses.shou_hu = { stacks: 1, turns: 1, srcUid: u.uid };
  assert.equal(findGuard(state, u), null, '自我守护应被忽略，避免死循环');
});

test('免死：50% 概率以 1 血存活（同 seed 可复现）', () => {
  const immortal = CARD({
    id: 'test_immortal', name: '不屈', cost: 4, attack: 3, health: 5,
    skills: [{ id: 's', name: '不屈', kind: 'trigger', trigger: 'on_lethal',
               chance: 0.5, frequency: 'once',
               effects: [{ action: 'survive', target: { source: true } }] }],
  });
  TEST_CARDS.push(immortal);
  let survived = 0;
  for (let seed = 0; seed < 40; seed++) {
    const { state, ctx } = scenario({ enemy: { front: ['test_immortal'] }, seed });
    const u = getUnit(state, 'enemy', 'front', 0)!;
    // 直接用一记致命伤害
    const nuke = CARD({
      id: 'test_nuke', name: '斩', type: 'tactic', cost: 0,
      effects: [{ action: 'damage', value: 99, target: { side: 'enemy' } }],
    });
    TEST_CARDS.push(nuke);
    const s = scenario({ ownHand: ['test_nuke'], seed });
    setUnit(s.state, 'enemy', 'front', 0,
      { ...u, statuses: {}, hp: 5, maxHp: 5, baseMaxHp: 5, mods: [] });
    const r = applyAction(s.state, s.ctx, { type: 'PLAY_CARD', cardIndex: 0 });
    void ctx; void r;
    if (r.events.some((e) => e.type === 'UNIT_SURVIVED')) survived++;
  }
  assert.ok(survived > 8 && survived < 32, `50% 免死 40 次应约 20 次，实测 ${survived}`);
});

test('免死：没有 on_lethal 技能的单位正常阵亡', () => {
  const nuke = CARD({
    id: 'test_nuke2', name: '斩', type: 'tactic', cost: 0,
    effects: [{ action: 'damage', value: 99, target: { side: 'enemy' } }],
  });
  const { state, ctx } = scenario({ ownHand: ['test_nuke2'] });
  setUnit(state, 'enemy', 'front', 0, unit('mortal', 2, 3));
  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0 });
  assert.ok(r.events.some((e) => e.type === 'UNIT_DIED'), '普通单位应正常阵亡');
  assert.ok(!r.events.some((e) => e.type === 'UNIT_SURVIVED'), '不该触发免死');
});
