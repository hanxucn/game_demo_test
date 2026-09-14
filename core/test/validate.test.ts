/**
 * 卡牌数据校验器测试
 *
 * 覆盖 docs/gdd/13-balance-data-model.md §5 的规则，重点是**会被改动**的那几条。
 * 运行：cd core && npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateCards, cardValue, budgetOf } from '../tools/validate.ts';
import type { CardDef } from '../src/types.ts';

/** 造一张最小可用的谋臣卡 */
function strategist(over: Partial<CardDef> = {}): CardDef {
  return {
    id: 'test_mouchen',
    name: '测试谋臣',
    faction: 'shu',
    type: 'strategist',
    cost: 2,
    attack: 0,
    health: 3,
    keywords: [],
    skills: [],
    memo: '测试用',
    ...over,
  };
}

const errorsOf = (c: CardDef) =>
  validateCards([c]).filter((i) => i.level === 'error').map((i) => i.message);
const warnsOf = (c: CardDef) =>
  validateCards([c]).filter((i) => i.level === 'warn').map((i) => i.message);

/* ---------- 规则⑤：谋臣攻击力（ADR-015 / ADR-018 放宽为「上限 1」） ---------- */

test('谋臣 0 攻 → 合法', () => {
  assert.deepEqual(errorsOf(strategist({ attack: 0 })), []);
});

test('谋臣 1 攻 → 合法（旧规则会报错，ADR-015 放宽）', () => {
  const errs = errorsOf(strategist({ attack: 1 }));
  assert.ok(!errs.some((m) => m.includes('谋臣')), `不该再报谋臣攻击错误：${errs.join('；')}`);
});

test('谋臣 2 攻 → 报错（超过上限 1）', () => {
  const errs = errorsOf(strategist({ cost: 4, attack: 2, health: 4 }));
  assert.ok(errs.some((m) => m.includes('谋臣攻击力上限')), `应报上限错误，实际：${errs.join('；')}`);
});

test('谋臣 3 攻 → 报错', () => {
  const errs = errorsOf(strategist({ cost: 5, attack: 3, health: 5 }));
  assert.ok(errs.some((m) => m.includes('谋臣攻击力上限')), `应报上限错误，实际：${errs.join('；')}`);
});

test('武将不受谋臣攻击上限约束', () => {
  const general = strategist({ type: 'general', attack: 5, health: 5, cost: 5 });
  const errs = errorsOf(general);
  assert.ok(!errs.some((m) => m.includes('谋臣')), `武将不该触发谋臣规则：${errs.join('；')}`);
});

/* ---------- 数值模型：预算公式（改数据时的自检工具） ---------- */

test('同费白板基准 = 2 × 统率 + 1', () => {
  assert.equal(budgetOf(1), 3);
  assert.equal(budgetOf(5), 11);
  assert.equal(budgetOf(10), 21);
});

test('白板卡总价值 = 攻击 + 生命', () => {
  const v = cardValue(strategist({ type: 'general', attack: 2, health: 3, cost: 2 }));
  assert.equal(v.stats, 5);
  assert.equal(v.keywords, 0);
  assert.equal(v.total, 5);
});

test('关键词占用预算（架盾 -1、神射 -0.5）', () => {
  const v = cardValue(strategist({ type: 'general', attack: 2, health: 2, cost: 2, keywords: ['jia_dun'] }));
  assert.equal(v.keywords, -1);
  assert.equal(v.total, 3);
});

/* ---------- 卡名与 memo ---------- */

test('卡名超过 4 字 → 报错', () => {
  const errs = errorsOf(strategist({ name: '五个字的卡名' }));
  assert.ok(errs.some((m) => m.includes('卡名')), `应报卡名错误，实际：${errs.join('；')}`);
});

test('缺 memo → 警告（不是错误）', () => {
  const c = strategist();
  delete (c as { memo?: string }).memo;
  assert.ok(warnsOf(c).some((m) => m.includes('memo')), '应给缺 memo 的警告');
  assert.deepEqual(errorsOf(c), [], '缺 memo 不该报错');
});

/* ---------- 引用完整性 ---------- */

test('未注册的关键词 → 报错', () => {
  const errs = errorsOf(strategist({ type: 'general', attack: 2, health: 2, keywords: ['bu_cun_zai'] }));
  assert.ok(errs.some((m) => m.includes('未注册的关键词')), `应报未注册关键词，实际：${errs.join('；')}`);
});

test('未注册的效果动作 → 报错', () => {
  const errs = errorsOf(strategist({ effects: [{ action: 'bu_cun_zai_de_action' }] }));
  assert.ok(errs.some((m) => m.includes('未注册的动作')), `应报未注册动作，实际：${errs.join('；')}`);
});

/* ---------- 规则⑪：归属标签（ADR-029） ---------- */

test('已注册的归属标签 → 合法', () => {
  const errs = errorsOf(strategist({ tags: ['xi_liang', 'huang_jin'] }));
  assert.deepEqual(errs, []);
});

test('未注册的归属标签 → 报错', () => {
  const errs = errorsOf(strategist({ tags: ['bu_cun_zai_de_tag'] }));
  assert.ok(errs.some((m) => m.includes('未注册的归属标签')), `应报未注册标签，实际：${errs.join('；')}`);
});

test('选择器引用未注册的归属标签 → 报错', () => {
  const errs = errorsOf(strategist({
    effects: [{
      action: 'modify', value: 1,
      target: { side: 'both', filter: { tag: 'mei_you_zhe_ge' } },
    }],
  }));
  assert.ok(errs.some((m) => m.includes('未注册的归属标签')), `应报未注册标签，实际：${errs.join('；')}`);
});

test('选择器引用已注册的归属标签 → 合法', () => {
  const errs = errorsOf(strategist({
    effects: [{
      action: 'modify', value: 1,
      target: { side: 'both', filter: { tag: 'xi_liang' } },
    }],
  }));
  assert.ok(!errs.some((m) => m.includes('归属标签')), `不该报标签错，实际：${errs.join('；')}`);
});

/* ---------- ADR-030：modify 可分离攻击/生命 ---------- */

test('modify 的 attack/health 字段被类型接受', () => {
  const errs = errorsOf(strategist({
    effects: [{ action: 'modify', attack: 1, health: 2, target: { side: 'ally', count: 1 } }],
  }));
  assert.deepEqual(errs, [], 'attack/health 应是合法字段');
});
