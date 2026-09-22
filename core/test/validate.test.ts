/**
 * 卡牌数据校验器测试
 *
 * 覆盖 docs/gdd/13-balance-data-model.md §5 的规则，重点是**会被改动**的那几条。
 * 运行：cd core && npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { validateCards, cardValue, budgetOf } from '../tools/validate.ts';
import type { CardDef, CardEffect } from '../src/types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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

/* ---------- ADR-073：类型定型 / 空转检测 / 关键词与文案一致 ---------- */

const general = (over: Partial<CardDef> = {}): CardDef => ({
  id: 'test_wujiang', name: '测试武将', faction: 'shu', type: 'general',
  cost: 4, attack: 3, health: 3, keywords: [], skills: [], memo: '测试用', ...over,
});

test('ADR-073：1 攻武将没有显式标注 → 报错（应按 ADR-018 默认成谋臣）', () => {
  const msgs = errorsOf(general({ attack: 1 }));
  assert.ok(msgs.some((m) => m.includes('未显式标注')), `应报类型定型错误，实际：${msgs.join('|')}`);
});

test('ADR-073：显式标注 type_explicit 的 1 攻武将 → 合法（祖茂/曹昂/张宝）', () => {
  const msgs = errorsOf(general({ attack: 1, type_explicit: true }));
  assert.deepEqual(msgs.filter((m) => m.includes('未显式标注')), []);
});

test('ADR-073：0 攻武将同样要先标注，1 攻以上不受约束', () => {
  assert.ok(errorsOf(general({ attack: 0 })).some((m) => m.includes('未显式标注')));
  assert.deepEqual(errorsOf(general({ attack: 2 })).filter((m) => m.includes('未显式标注')), []);
});

test('ADR-073：「拿不到任何数值」的效果 → 警告（空城计就是 damage value: 0）', () => {
  const noop = general({
    skills: [{ id: 'noop', name: '空转', kind: 'trigger', trigger: 'on_play',
      effects: [{ action: 'damage', value: 0, target: { side: 'enemy', lord: true } }] }],
  });
  const w = warnsOf(noop);
  assert.ok(w.some((m) => m.includes('没有任何数值来源')), `应报空转警告，实际：${w.join('|')}`);
});

test('ADR-073：有动态取值来源的 damage/heal 不算空转', () => {
  const cases: CardEffect[] = [
    { action: 'damage', value: 0, value_from_flag: 'sacrificed_hp' },
    { action: 'heal', value_from: { side: 'ally', count: 'all' } },
  ];
  for (const eff of cases) {
    const c = general({ skills: [{ id: 'x', name: 'x', kind: 'trigger', trigger: 'on_play', effects: [eff] }] });
    assert.deepEqual(warnsOf(c).filter((m) => m.includes('没有任何数值来源')), [],
      `${JSON.stringify(eff)} 不应被判为空转`);
  }
});

test('ADR-073：modify 一个数值都没给 → 警告', () => {
  const c = general({
    skills: [{ id: 'x', name: 'x', kind: 'trigger', trigger: 'on_play',
      effects: [{ action: 'modify', target: { source: true } }] }],
  });
  assert.ok(warnsOf(c).some((m) => m.includes('modify')), '应报 modify 空转警告');
});

/**
 * 真实卡池的这道扫描是**新增的回归网**：文案里白纸黑字写了某个关键词，
 * 卡上却既没有该关键词、也没有施加对应状态的 DSL —— 那就是一张静默的白板。
 * 用「金名单」而不是断言为空：修一张就删一条，剩下的永远看得见。
 */
test('ADR-073：真实卡池里不存在「文案提到关键词但卡上没实现」的静默白板', () => {
  const KW_CN: Record<string, string> = {
    先攻: 'xian_gong', 疾行: 'xian_gong', 架盾: 'jia_dun', 奇袭: 'qi_xi',
    连击: 'lian_ji', 圣盾: 'sheng_dun', 饮血: 'yin_xue', 神射: 'shen_she',
  };
  // 「亡语 / 遗计」由 `trigger: 'on_death'` 承载，不靠关键词，故不在此列
  const cards: CardDef[] = JSON.parse(readFileSync(join(ROOT, 'data', 'cards.json'), 'utf8'));
  const offenders: string[] = [];
  for (const c of cards) {
    const effs = [...(c.effects ?? [])];
    const texts: string[] = [];
    for (const s of c.skills ?? []) {
      texts.push(s.text ?? '');
      effs.push(...(s.effects ?? []));
      for (const m of s.modes ?? []) effs.push(...m.effects);
    }
    const text = texts.join(' ');
    if (!text) continue;
    // 「召唤 / 进化」类卡的关键词文案说的是**被召唤 / 被进化出来的那张卡**
    // （高顺的盾兵"保留架盾"、马腾的西凉铁骑"获得先攻"、黄月英的机械守卫"带架盾"）——
    // 关键词挂在 token / elite 卡上，不该要求本卡也有。
    if (effs.some((e) => e.action === 'summon' || e.action === 'transform')) continue;
    const kws = new Set(c.keywords ?? []);
    const applied = new Set(effs.filter((e) => e.action === 'apply_status').map((e) => e.status));
    for (const [cn, kw] of Object.entries(KW_CN)) {
      if (!text.includes(cn)) continue;
      if (kws.has(kw) || applied.has(`${kw}_status`) || applied.has(kw)) continue;
      offenders.push(`${c.id}（${c.name}）文案提到「${cn}」`);
    }
  }
  assert.deepEqual(offenders, [], `这些卡的文案与实现不一致：\n${offenders.join('\n')}`);
});
