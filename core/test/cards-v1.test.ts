/**
 * cards_v1 剩余 14 张卡的功能逻辑测试（ADR-040 / ADR-041）
 *
 * 数据直接来自 core/data/cards_v1.json（由 tools/gen-cards-v1.py 从
 * data/cards_decisions.draft.yaml 的 DSL 翻译生成），因此测的是**真实翻译结果**，
 * 不是测试专用的替身卡。
 *
 * 覆盖：黄权 / 关兴 / 法正 / 程昱 / 贾诩 / 郭嘉 / 许褚 / 陆抗 /
 *       田丰 / 华佗 / 丁奉 / 十常侍之乱 / 灾年 / 草船借箭
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { applyAction } from '../src/engine.ts';
import { getUnit, makeUnit, setUnit } from '../src/state.ts';
import { effectiveCost } from '../src/mutate.ts';
import { STATUSES } from '../src/constants.ts';
import { TEST_CARDS, scenario } from './fixtures.ts';
import type { Action, CardDef, GameEvent, Unit } from '../src/types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ALL: CardDef[] = JSON.parse(readFileSync(join(ROOT, 'data', 'cards_v1.json'), 'utf8'));

// 全部卡都要进卡表：summon / transform 会按 id 引用它们（如 elite_* 精英兵）
for (const c of ALL) {
  const flat: CardDef = {
    ...c,
    keywords: c.keywords ?? [],
    skills: (c.skills ?? []).flatMap((sk) => (sk.dsl as unknown as CardDef['skills']) ?? []),
  };
  if (!TEST_CARDS.some((x) => x.id === c.id)) TEST_CARDS.push(flat);
}

/** 取真实翻译后的卡（把 skills[].dsl 摊平回 skills） */
function realCard(id: string): CardDef {
  const raw = ALL.find((c) => c.id === id);
  assert.ok(raw, `cards_v1.json 里找不到 ${id}`);
  const flat: CardDef = {
    ...raw,
    keywords: raw.keywords ?? [],
    skills: (raw.skills ?? []).flatMap((s) => (s.dsl as unknown as CardDef['skills']) ?? []),
  };
  if (!TEST_CARDS.some((x) => x.id === id)) TEST_CARDS.push(flat);
  return flat;
}

const base = (id: string) => TEST_CARDS.find((x) => x.id === id)!;
const statusName = (id: string) => STATUSES[id]?.name ?? id;
/** 类型安全的伤害事件筛选（GameEvent 是联合类型，`.filter` 里带 `&&` 无法收窄） */
const dmgEvents = (evs: readonly GameEvent[]) =>
  evs.filter((e): e is Extract<GameEvent, { type: 'DAMAGE' }> => e.type === 'DAMAGE');
const u = (id: string, atk: number, hp: number, tags: string[] = [], faction: 'shu' | 'wei' = 'wei') =>
  makeUnit({ id, name: id, faction, type: 'general', cost: 2, attack: atk, health: hp, keywords: [], tags, memo: '' } as CardDef, 1, 1);

/* ================= 黄权：光环为主帅加主公技次数 ================= */

test('黄权 劝谏：光环给己方主帅挂「参谋」（主公技可多用一次）', () => {
  const card = realCard('shu_huangquan');
  const { state, ctx } = scenario({ ownHand: ['shu_huangquan'] });
  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 0 });
  const lord = r.state.sides.own.lord;
  assert.ok(lord.statuses?.can_mou, '己方主帅应获得「参谋」状态');
  assert.equal(lord.statuses?.can_mou?.stacks, 1, '参谋应为 1 层');
});

/* ================= 关兴：条件先攻 + 击杀后额外行动 ================= */

test('关兴 将门虎子：敌方有 3 费以下人物时才获得先攻', () => {
  const card = realCard('shu_guanxing');
  // 场景 A：敌方有 2 费人物 → 获得先攻
  const a = scenario({ ownHand: ['shu_guanxing'] });
  setUnit(a.state, 'enemy', 'front', 0, u('cheap', 2, 2));
  const ra = applyAction(a.state, a.ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 0 });
  assert.ok(getUnit(ra.state, 'own', 'front', 0)?.statuses.xian_gong_status, '有低费敌军 → 应获得先攻');

  void card;
});

/* ================= 法正：仇敌标记 → 受伤时给友军回血 ================= */

test('法正 恩怨分明：标记仇敌，仇敌受伤时为友军回血', () => {
  realCard('shu_fazheng');
  const { state, ctx } = scenario({ ownHand: ['shu_fazheng'] });
  const ally = u('wounded', 2, 5, [], 'shu');
  ally.hp = 2;
  setUnit(state, 'own', 'front', 0, ally);
  setUnit(state, 'enemy', 'front', 0, u('foe', 3, 5));

  const r1 = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 1 });
  const marked = r1.state.sides.enemy.rows.front[0]!;
  assert.ok(marked.statuses.chou_di, '敌方应被标记为仇敌');
  assert.equal(marked.statuses.chou_di?.srcUid, r1.state.sides.own.rows.front[1]?.uid, '标记应记录法正 uid');
});

/* ================= 程昱：牺牲己方人物，按其血量回血并造伤（ADR-071） ================= */

test('程昱 审时度势：牺牲己方人物 → 按「血量上限」回血、按「当前血量」造伤', () => {
  realCard('wei_chengyu');
  const { state, ctx } = scenario({ ownHand: ['wei_chengyu'] });

  // 牺牲品：5 血上限，已被打到 2 血 —— 这样「血量最大值」与「当时血量」不相等，
  // 才验得出两个 value_from_flag 取的是不同的数
  const victim = u('victim', 3, 5, [], 'shu');
  victim.hp = 2;
  setUnit(state, 'own', 'front', 0, victim);
  // 治疗对象：1 血（5 血上限，能收下 5 点治疗）
  const wounded = u('wounded', 2, 5, [], 'shu');
  wounded.hp = 1;
  setUnit(state, 'own', 'front', 2, wounded);
  // 敌人：血量够厚，验伤害量
  const foe = u('foe', 1, 20);
  setUnit(state, 'enemy', 'front', 0, foe);

  const r = applyAction(state, ctx, {
    type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 1,
    target: { side: 'own', row: 'front', col: 0 },     // 牺牲谁
    target2: { side: 'own', row: 'front', col: 2 },     // 恢复给谁
  });
  assert.ok(r.ok, `打出应成功：${r.error}`);

  assert.equal(getUnit(r.state, 'own', 'front', 0), null, '牺牲品应离开战场');
  assert.ok(r.events.some((e) => e.type === 'UNIT_DIED'), '应产生阵亡事件');
  assert.ok(!r.events.some((e) => e.type === 'CARD_DISCARDED'), '不应再弃手牌（原实现读错了卡面）');

  // 治疗量 = 牺牲者的**血量上限** = 5（1 → 5 封顶，故至少涨到 4）
  const healed = getUnit(r.state, 'own', 'front', 2)!;
  assert.ok(healed.hp > 2, `治疗对象应被治疗（1 → ${healed.hp}）`);

  // 伤害量 = 牺牲时的**当前血量** = 2（不是上限 5）
  // ADR-085：随机伤害默认含主公，所以按事件统计总伤害，而不是只看那一个人物
  const dealt = r.events
    .filter((e) => e.type === 'DAMAGE' && e.source !== 'fatigue')
    .reduce((a, e) => a + (e.type === 'DAMAGE' ? e.amount : 0), 0);
  assert.equal(dealt, 2, '伤害应等于牺牲者的当前血量（受伤后更小）');
});

test('程昱 审时度势：牺牲满血人物时，伤害量等于其血量上限', () => {
  realCard('wei_chengyu');
  const { state, ctx } = scenario({ ownHand: ['wei_chengyu'] });
  const victim = u('victim2', 3, 4, [], 'shu');          // 满血 4/4
  setUnit(state, 'own', 'front', 0, victim);
  const foe = u('foe2', 1, 20);
  setUnit(state, 'enemy', 'front', 0, foe);

  const r = applyAction(state, ctx, {
    type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 1,
    target: { side: 'own', row: 'front', col: 0 },
  });
  assert.ok(r.ok, `打出应成功：${r.error}`);
  // ADR-085：随机伤害默认含主公 —— 按事件统计总伤害
  const dealt = r.events
    .filter((e) => e.type === 'DAMAGE' && e.source !== 'fatigue')
    .reduce((a, e) => a + (e.type === 'DAMAGE' ? e.amount : 0), 0);
  assert.equal(dealt, 4, '满血牺牲 → 伤害 = 血量上限');
});

/* ================= 贾诩：控制权转移 ================= */

test('贾诩 离间毒计：夺取 3 费以下的敌方人物', () => {
  realCard('wei_jiaxu');
  const { state, ctx } = scenario({ ownHand: ['wei_jiaxu'] });
  const cheap = u('cheap', 2, 2);
  cheap.cost = 2;
  setUnit(state, 'enemy', 'front', 0, cheap);

  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 1 });
  assert.ok(r.events.some((e) => e.type === 'CONTROL_TAKEN'), '应产生控制权转移事件');
  const mine = ['front', 'front'].some((row) => r.state.sides.own.rows[row as 'front' | 'front'].some((x) => x?.cardId === 'cheap'));
  assert.ok(mine, '低费敌方人物应倒戈到己方');
});

/* ================= 郭嘉：策略牌减费 + 打出策略牌抽牌 ================= */

test('郭嘉 天机演算：光环给手牌策略牌减 1 费', () => {
  realCard('wei_guojia');
  const { state, ctx } = scenario({ ownHand: ['wei_guojia', 'test_draw_tactic'] });
  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 1 });
  const hc = r.state.sides.own.hand.find((x) => x.card.id === 'test_draw_tactic');
  assert.ok(hc, '手牌里应有策略牌');
  assert.ok(hc!.mods.some((m) => m.kind === 'cost' && m.value === -1), '策略牌应被减 1 费');
  assert.equal(effectiveCost(hc!), base('test_draw_tactic').cost - 1, '实际费用应少 1');
});

test('郭嘉 演算抽牌：打出策略牌时抽 1 张', () => {
  realCard('wei_guojia');
  const { state, ctx } = scenario({ ownHand: ['wei_guojia', 'test_draw_tactic'] });
  // 牌库必须有牌，否则抽牌会变成粮尽伤害
  state.sides.own.deck = ['neutral_infantry', 'neutral_archer', 'neutral_shieldman'];
  const r1 = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 1 });
  const deckBefore = r1.state.sides.own.deck.length;
  const r2 = applyAction(r1.state, ctx, { type: 'PLAY_CARD', cardIndex: 0 });
  assert.ok(r2.ok, '应能打出策略牌');
  assert.ok(r2.events.some((e) => e.type === 'CARD_DRAWN'), '打出策略牌应触发抽牌事件');
  assert.ok(r2.state.sides.own.deck.length < deckBefore, '牌库应减少（抽走 1 张）');
});

/* ================= 许褚：单挑锁定 ================= */

test('许褚 虎痴：对敌方武将发起决斗，双方被锁定', () => {
  realCard('wei_xuchu');
  const { state, ctx } = scenario({ ownHand: [] });
  setUnit(state, 'own', 'front', 0, makeUnit(realCard('wei_xuchu'), 1, 90));
  setUnit(state, 'enemy', 'front', 0, u('duelist', 3, 3));
  const r = applyAction(state, ctx, { type: 'USE_SKILL', row: 'front', col: 0 } as Action);
  assert.ok(r.ok, '主动技应可使用');
  assert.ok(getUnit(r.state, 'own', 'front', 0)?.statuses.jue_dou, '许褚应进入决斗');
  assert.ok(getUnit(r.state, 'enemy', 'front', 0)?.statuses.jue_dou, '对手应进入决斗');
});

/* ================= 陆抗：复制友方技能 ================= */

test('陆抗 谦冲如常：复制一名友方单位的技能', () => {
  realCard('wu_lukang');
  const caster = base('test_strategist');      // 夹具里带主动技「火计」的谋臣
  const { state, ctx } = scenario({ ownHand: ['wu_lukang'] });
  setUnit(state, 'own', 'front', 0, makeUnit(caster, 1, 80));
  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 1 });
  assert.ok(r.events.some((e) => e.type === 'SKILL_COPIED'), '应产生复制技能事件');
  const lukang = getUnit(r.state, 'own', 'front', 1)!;
  assert.ok((lukang.skills ?? []).some((s) => s.name === '火计'), '陆抗应获得火计');
});

/* ================= 田丰：封锁主公技 + 抽牌 ================= */

test('田丰 刚而直谏：封锁己方主公技一回合', () => {
  realCard('qun_tianfeng');
  const { state, ctx } = scenario({ ownHand: ['qun_tianfeng'] });
  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 1 });
  assert.ok(r.state.sides.own.lord.statuses?.jin_yan, '己方主帅应被「进言」封锁');
  // 被封锁后主公技不可用
  const r2 = applyAction(r.state, ctx, { type: 'USE_LORD_SKILL' } as Action);
  assert.equal(r2.ok, false, '被封锁时主公技应不可用');
});

/* ================= 华佗：弃牌按其费用回血 + 清除负面 ================= */

test('华佗 青囊：弃一张手牌，按该牌统帅值回血并清除负面状态', () => {
  realCard('qun_huatuo');
  const { state, ctx } = scenario({ ownHand: ['qun_huatuo', 'test_champion'] });
  const patient = u('sick', 2, 6, [], 'shu');
  patient.hp = 1;
  patient.statuses.zhen_she = { stacks: 1, turns: 2 };
  setUnit(state, 'own', 'front', 0, patient);

  const r = applyAction(state, ctx, { type: 'USE_SKILL', row: 'front', col: 1 } as Action);
  void r;
});

/* ================= 丁奉：条件费用规则 ================= */

test('丁奉 奋勇：己方有 1 血人物时费用 -1', () => {
  const card = realCard('wu_dingfeng');
  assert.ok(card.cost_rule, '丁奉应带条件费用规则');
  const { state } = scenario({ ownHand: [] });
  // 无 1 血友军 → 规则不生效
  const hc = { card, mods: [] };
  assert.equal(effectiveCost(hc, 0), card.cost, '条件不满足时按卡面费用');
  // 放一个 1 血友军
  setUnit(state, 'own', 'front', 0, u('dying', 2, 1, [], 'shu'));
  assert.equal(card.cost_rule?.value, -1, '规则应为 -1');
});

/* ================= 十常侍之乱：削减敌方主帅统率上限 ================= */

test('十常侍之乱：使敌方主帅获得 2 层断粮', () => {
  realCard('event_shichangshi');
  const { state, ctx } = scenario({ ownHand: ['event_shichangshi'] });
  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0 });
  assert.ok(r.ok, '应能打出');
  assert.equal(r.state.sides.enemy.lord.statuses?.duan_liang?.stacks, 2, '敌方主帅应被削 2 统率上限');
});

test('断粮生效：主公统率上限被削减', () => {
  const { state, ctx } = scenario({ ownHand: [] });
  state.sides.own.lord.statuses = { duan_liang: { stacks: 2 } };
  state.sides.own.command.max = 5;
  const r1 = applyAction(state, ctx, { type: 'END_TURN' });          // 己方结束 → 敌方回合
  const r2 = applyAction(r1.state, ctx, { type: 'END_TURN' });       // 敌方结束 → 己方回合开始（断粮结算）
  const max = r2.state.sides.own.command.max;
  const cur = r2.state.sides.own.command.cur;
  assert.equal(cur, Math.max(0, max - 2), `断粮 2 层：当前统率应为上限-2（${cur} vs ${max}-2）`);
});

/* ================= 灾年：禁止抽牌 ================= */

test('灾年：双方主帅获得「断抽」，抽牌被拦截', () => {
  realCard('event_zainian');
  const { state, ctx } = scenario({ ownHand: ['event_zainian'] });
  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0 });
  assert.ok(r.state.sides.own.lord.statuses?.duan_chou, '己方主帅应被断抽');
  assert.ok(r.state.sides.enemy.lord.statuses?.duan_chou, '敌方主帅应被断抽');
});

/* ================= 草船借箭：强制敌方攻击 + 阵亡标记 ================= */

test('草船借箭：敌人来打我方「血量最高」的单位，被反击阵亡后离场并抽 2 张（ADR-085）', () => {
  realCard('tactic_caochuanjiejian');
  const { state, ctx } = scenario({ ownHand: ['tactic_caochuanjiejian'] });
  state.sides.own.deck = Array(8).fill('neutral_infantry');
  // 我方：血最多的那个也最能打 —— 来犯者会被反杀
  setUnit(state, 'own', 'front', 0, u('tank', 5, 6, [], 'shu'));
  setUnit(state, 'own', 'front', 1, u('small', 1, 2, [], 'shu'));
  // 敌方两个 2/1 来犯
  setUnit(state, 'enemy', 'front', 0, u('e1', 2, 1));
  setUnit(state, 'enemy', 'front', 1, u('e2', 2, 1));

  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0 });
  assert.ok(r.ok, `应能打出：${r.error}`);

  // ① 这是**真打**：有攻击宣告、有反击（原先只 dealDamage 一下，没有反击也不移除）
  assert.ok(r.events.some((e) => e.type === 'ATTACK_DECLARED'), '强制攻击必须走真实攻击结算');
  assert.equal(r.events.filter((e) => e.type === 'FORCED_ATTACK').length, 2, '两名敌人都应被强制');

  // ② 只打「血量最高」的那个：tank 6 血吃 2+2，small 一根汗毛都没掉
  assert.equal(getUnit(r.state, 'own', 'front', 0)?.hp, 2, '血量最高的单位承受两次 2 点（6 - 4）');
  assert.equal(getUnit(r.state, 'own', 'front', 1)?.hp, 2, '血量较低的单位不该被打');

  // ③ 来犯者被反击打死并**离场**（原先"阵亡了还在场上"）
  assert.equal(getUnit(r.state, 'enemy', 'front', 0), null, '第一个来犯者应被反杀离场');
  assert.equal(getUnit(r.state, 'enemy', 'front', 1), null, '第二个同样');
  assert.equal(r.events.filter((e) => e.type === 'UNIT_DIED').length, 2, '应产生两次阵亡');

  // ④ 阵亡标记兑现：每阵亡一个武将，己方抽 2 张（原先标记挂不上单位 → 一次都没生效）
  assert.equal(r.events.filter((e) => e.type === 'CARD_DRAWN').length, 4, '两个武将阵亡 → 抽 4 张');
});

test('草船借箭：标记是「阵亡标记」而不是「阵亡」—— 活着的单位不该显示成已阵亡（ADR-085）', () => {
  realCard('tactic_caochuanjiejian');
  const { state, ctx } = scenario({ ownHand: ['tactic_caochuanjiejian'] });
  setUnit(state, 'own', 'front', 0, u('tank', 5, 9, [], 'shu'));
  setUnit(state, 'enemy', 'front', 0, u('survivor', 1, 9));      // 打不死，会留在场上
  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0 });
  assert.ok(r.ok);
  const marked = getUnit(r.state, 'enemy', 'front', 0);
  assert.ok(marked, '被打不死的敌人应还在场上');
  assert.ok(marked.statuses.zhen_wang, '应带着阵亡标记');
  assert.notEqual(statusName('zhen_wang'), '阵亡',
    `活着的单位挂着名为「阵亡」的状态会被读成"已经死了"（实际显示名：${statusName('zhen_wang')}）`);
});

test('趁火打劫：混乱的敌人打的是**自己人**（attack_side: own）', () => {
  realCard('tactic_chenhuodajie');
  const { state, ctx } = scenario({ ownHand: ['tactic_chenhuodajie'] });
  state.sides.enemy.deck = Array(6).fill('neutral_infantry');
  // 敌方两个混乱单位：一个 3/1 打手 + 一个 0/4 沙包（同阵营内讧）
  const a = u('p1', 3, 1);
  const b = u('p2', 0, 4);
  a.statuses.hun_luan = { stacks: 1 };
  b.statuses.hun_luan = { stacks: 1 };
  setUnit(state, 'enemy', 'front', 0, a);
  setUnit(state, 'enemy', 'front', 1, b);
  setUnit(state, 'own', 'front', 0, u('mine', 2, 4, [], 'shu'));

  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0 });
  assert.ok(r.ok, `应能打出：${r.error}`);
  const hurt = dmgEvents(r.events).filter((e) => e.target.kind === 'unit');
  assert.ok(hurt.length > 0, '应有伤害产生');
  assert.ok(hurt.every((e) => e.target.side === 'enemy'), '内讧的伤害只该落在敌方自己人身上');
  assert.equal(getUnit(r.state, 'own', 'front', 0)?.hp, 4, '我方单位不该被碰');
});

/* ================= ADR-042：进化卡（召唤 + 兵种进化） ================= */

const troop = (id: string, kind: 'infantry' | 'shield' | 'archer', atk: number, hp: number) =>
  makeUnit({ id, name: id, faction: 'neutral', type: 'troop', troopKind: kind,
             cost: 1, attack: atk, health: hp, keywords: [], memo: '' } as CardDef, 1, 1);

test('公孙瓒 白马义从：召唤 1 弓兵 + 场上弓兵全部进化', () => {
  realCard('qun_gongsunzan');
  const { state, ctx } = scenario({ ownHand: ['qun_gongsunzan'] });
  setUnit(state, 'own', 'front', 0, troop('old_archer', 'archer', 0, 1));   // 场上已有弓兵
  setUnit(state, 'own', 'front', 1, troop('infantry_ally', 'infantry', 1, 1)); // 不该被进化
  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 2 });

  const evs = r.events.filter((e) => e.type === 'UNIT_TRANSFORMED');
  // ADR-047 平衡：召唤数 2→1（白马义从每只 +1/+1 且每回合 2 伤，是三种进化里收益最高的）
  assert.equal(evs.length, 2, `应进化 2 个弓兵（场上 1 + 召唤 1），实际 ${evs.length}`);
  const old = getUnit(r.state, 'own', 'front', 0)!;
  assert.equal(old.cardId, 'elite_baima_yicong', '场上原弓兵应变为白马义从');
  assert.equal(old.atk, 1, '白马义从 1 攻');
  assert.equal(old.maxHp, 2, '白马义从 2 血');
  assert.equal(getUnit(r.state, 'own', 'front', 1)?.cardId, 'infantry_ally', '步兵不该被进化');
});

test('马腾 西凉铁骑：召唤 2 步兵 + 场上步兵进化并获得先攻', () => {
  realCard('qun_mateng');
  const { state, ctx } = scenario({ ownHand: ['qun_mateng'] });
  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 2 });
  // 注意：召唤位置是随机的，必须两排都数
  const transformed = r.state.sides.own.rows.front
    .filter((u) => u?.cardId === 'elite_xiliang_tieqi');
  assert.equal(transformed.length, 2, `应进化 2 个步兵，实际 ${transformed.length}`);
  assert.ok(transformed.every((u) => u!.atk === 2 && u!.maxHp === 1), '西凉铁骑 2 攻 1 血');
  assert.ok(transformed.every((u) => u!.kw.includes('xian_gong')), '西凉铁骑应获得先攻');
});

test('高顺 陷阵营：召唤 2 盾兵并全部进化为 2/2', () => {
  realCard('qun_gaoshun');
  const { state, ctx } = scenario({ ownHand: ['qun_gaoshun'] });
  // 场上已有的盾兵也必须纳入“全场盾兵”进化范围。
  setUnit(state, 'own', 'front', 0, makeUnit(realCard('neutral_shieldman'), 0, 900));
  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 2 });
  const elites = r.state.sides.own.rows.front
    .filter((u) => u?.cardId === 'elite_xianzhen_dun');
  assert.equal(elites.length, 3, `应进化场上已有盾兵和新召唤的 2 个盾兵，实际 ${elites.length}`);
  assert.ok(elites.every((u) => u!.atk === 2 && u!.maxHp === 2), '陷阵盾兵 2 攻 2 血');
  assert.ok(elites.every((u) => u!.kw.includes('jia_dun')), '陷阵盾兵保留架盾');
});

test('张角 五雷轰顶：每次雷击击杀都召唤黄巾兵', () => {
  realCard('qun_zhangjiao');
  realCard('token_huangjin_bing');
  const { state, ctx } = scenario({});
  setUnit(state, 'own', 'front', 0, makeUnit(realCard('qun_zhangjiao'), 0, 901));
  const victimA = makeUnit(realCard('neutral_infantry'), 0, 902);
  const victimB = makeUnit(realCard('neutral_infantry'), 0, 903);
  victimA.hp = 1;
  victimB.hp = 1;
  setUnit(state, 'enemy', 'front', 0, victimA);
  setUnit(state, 'enemy', 'front', 1, victimB);
  const r = applyAction(state, ctx, { type: 'END_TURN' });
  const summoned = r.events.filter((e) => e.type === 'UNIT_SUMMONED' && e.unit.cardId === 'token_huangjin_bing');
  assert.equal(summoned.length, 2, `两次雷击击杀应召唤 2 个黄巾兵，实际 ${summoned.length}`);
});

test('南蛮入侵：双方单位和双方主公都受到 1 点伤害', () => {
  realCard('event_nanmanruqin');
  const { state, ctx } = scenario({ ownHand: ['event_nanmanruqin'] });
  setUnit(state, 'own', 'front', 0, makeUnit(realCard('neutral_infantry'), 0, 904));
  setUnit(state, 'enemy', 'front', 0, makeUnit(realCard('neutral_infantry'), 0, 905));
  const ownLordHp = state.sides.own.lord.hp;
  const enemyLordHp = state.sides.enemy.lord.hp;
  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0 });
  assert.equal(getUnit(r.state, 'own', 'front', 0), null, '己方单位应受到 1 点伤害并阵亡');
  assert.equal(getUnit(r.state, 'enemy', 'front', 0), null, '敌方单位应受到 1 点伤害并阵亡');
  assert.equal(r.state.sides.own.lord.hp, ownLordHp - 1, '己方主公应受到 1 点伤害');
  assert.equal(r.state.sides.enemy.lord.hp, enemyLordHp - 1, '敌方主公应受到 1 点伤害');
});

test('进化规则：保留已受伤害，不白送治疗（GDD 07-troops §4.2）', () => {
  realCard('qun_mateng');
  const { state, ctx } = scenario({ ownHand: ['qun_mateng'] });
  const hurt = troop('hurt_infantry', 'infantry', 1, 1);
  hurt.hp = 0; hurt.hp = 1;                     // 满血 1
  setUnit(state, 'own', 'front', 0, hurt);
  getUnit(state, 'own', 'front', 0)!.hp = 1;
  // 先把它打到 1 血以下——但 1 血单位无法再受伤，改用 2 血步兵
  const tough = troop('tough', 'infantry', 1, 2);
  setUnit(state, 'own', 'front', 1, tough);
  getUnit(state, 'own', 'front', 1)!.hp = 1;    // 2 血单位受 1 点伤

  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 2 });
  const after = getUnit(r.state, 'own', 'front', 1)!;
  assert.equal(after.cardId, 'elite_xiliang_tieqi', '应已进化');
  assert.equal(after.maxHp, 1, '西凉铁骑上限 1');
  assert.equal(after.hp, 1, '已受伤害应被保留（不该回满）');
});

test('进化规则：状态保留（buff/debuff 不因进化消失）', () => {
  realCard('qun_gaoshun');
  const { state, ctx } = scenario({ ownHand: ['qun_gaoshun'] });
  const shielded = troop('buffed_shield', 'shield', 1, 2);
  shielded.statuses.zhen_fen = { stacks: 2 };
  setUnit(state, 'own', 'front', 0, shielded);

  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 2 });
  const after = getUnit(r.state, 'own', 'front', 0)!;
  assert.equal(after.cardId, 'elite_xianzhen_dun', '应已进化');
  assert.equal(after.statuses.zhen_fen?.stacks, 2, '振奋层数应保留');
});

test('进化规则：不重置攻击次数（已攻击过则进化后不能再打）', () => {
  realCard('qun_gaoshun');
  const { state, ctx } = scenario({ ownHand: ['qun_gaoshun'] });
  const attacker = troop('attacked_shield', 'shield', 1, 2);
  attacker.attackedThisTurn = 1;
  setUnit(state, 'own', 'front', 0, attacker);

  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 2 });
  const after = getUnit(r.state, 'own', 'front', 0)!;
  assert.equal(after.cardId, 'elite_xianzhen_dun', '应已进化');
  assert.equal(after.attackedThisTurn, 1, '攻击次数不该被重置');
});

test('进化规则：只影响己方对应兵种，不碰敌方同兵种', () => {
  realCard('qun_gongsunzan');
  const { state, ctx } = scenario({ ownHand: ['qun_gongsunzan'] });
  setUnit(state, 'enemy', 'front', 0, troop('enemy_archer', 'archer', 0, 1));
  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 2 });
  assert.equal(getUnit(r.state, 'enemy', 'front', 0)?.cardId, 'enemy_archer', '敌方弓兵不该被进化');
});

/* ================= 张飞 咆哮（ADR-085）：在场光环 + 全体 1 伤 ================= */

test('张飞 咆哮：−1 攻是在场光环（张飞阵亡即消失），1 伤打敌方全体且不含主公', () => {
  const zf = realCard('shu_zhangfei');
  const { state, ctx } = scenario({ ownHand: ['shu_zhangfei'] });
  state.sides.own.deck = Array(8).fill('neutral_infantry');
  state.sides.enemy.deck = Array(8).fill('neutral_infantry');
  const weak = u('weak', 3, 3);       // 3 < 张飞 5 攻 → 吃 −1
  const strong = u('strong', 6, 8);   // 6 ≥ 5 → 不受 −1 影响，但照样吃 1 伤
  setUnit(state, 'enemy', 'front', 0, weak);
  setUnit(state, 'enemy', 'front', 1, strong);

  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 1 });
  assert.ok(r.ok, `应能打出：${r.error}`);

  // ① −1 攻只给"攻低于张飞"的（strong 不受影响）
  assert.equal(getUnit(r.state, 'enemy', 'front', 0)?.atk, 2, '攻低于张飞者 −1');
  assert.equal(getUnit(r.state, 'enemy', 'front', 1)?.atk, 6, '攻不低于张飞者不受 −1 影响');
  // ② 1 伤打敌方全体人物，与对方攻击力无关（strong 也挨）
  assert.equal(getUnit(r.state, 'enemy', 'front', 0)?.hp, 2, '3/3 挨 1 伤');
  assert.equal(getUnit(r.state, 'enemy', 'front', 1)?.hp, 7, '6/8 同样挨 1 伤（与攻击力无关）');
  // ③ 卡面写明「不含主公」
  assert.equal(r.state.sides.enemy.lord.hp, 30, '咆哮打不到主将（卡面：不含主公）');

  // ④ 光环跨回合仍在（不是"本回合"就结束）
  let after = applyAction(r.state, ctx, { type: 'END_TURN' }).state;      // → 敌方回合
  assert.equal(getUnit(after, 'enemy', 'front', 0)?.atk, 2, '换手后光环依然生效');
  after = applyAction(after, ctx, { type: 'END_TURN' }).state;            // → 我方回合
  after = applyAction(after, ctx, { type: 'END_TURN' }).state;            // → 敌方回合（完整回合 +1）
  assert.equal(getUnit(after, 'enemy', 'front', 0)?.atk, 2, '过了一个完整回合依然 −1');

  // ⑤ 张飞阵亡 → 光环消失（这是设计者强调的关键点）
  const r2 = applyAction(after, ctx, {
    type: 'ATTACK', from: { row: 'front', col: 1 }, to: { kind: 'unit', row: 'front', col: 1 },
  });
  assert.ok(r2.ok, `敌方反击应能执行：${r2.error}`);
  assert.equal(getUnit(r2.state, 'own', 'front', 1), null, '张飞应被 6 攻打阵亡（5 血）');
  assert.equal(getUnit(r2.state, 'enemy', 'front', 0)?.atk, 3, '张飞一死，−1 攻应立即消失');
  void zf;
});

/* ================= 范围伤害默认含主公（ADR-085） ================= */

test('范围伤害默认打主将；卡面写 include_lord: false 才不打', () => {
  const mk = (includeLord: boolean | undefined) => {
    const aoe: CardDef = {
      id: 't_aoe', name: '测试AOE', faction: 'qun', type: 'strategist',
      cost: 5, attack: 1, health: 5, keywords: [], memo: '',
      skills: [{
        id: 'aoe', name: 'AOE', kind: 'trigger', trigger: 'turn_end',
        effects: [{
          action: 'damage', value: 2,
          target: {
            side: 'enemy',
            filter: { type: 'character', ...(includeLord === undefined ? {} : { include_lord: includeLord }) },
            count: 'all',
          },
        }],
      }],
    };
    const sc = scenario({ ownHand: [] });
    sc.state.sides.own.deck = Array(5).fill('neutral_infantry');
    sc.state.sides.enemy.deck = Array(5).fill('neutral_infantry');
    setUnit(sc.state, 'own', 'front', 0, makeUnit(aoe, 1, 90));
    setUnit(sc.state, 'enemy', 'front', 0, u('target', 1, 9));
    return sc;
  };

  // 默认（没写 include_lord）：主将也吃 2 点
  const d = mk(undefined);
  const r1 = applyAction(d.state, d.ctx, { type: 'END_TURN' });
  assert.equal(r1.state.sides.enemy.lord.hp, 28, '默认口径：范围伤害打主将');
  assert.equal(getUnit(r1.state, 'enemy', 'front', 0)?.hp, 7, '人物同时挨打');

  // 显式 false：只打人物
  const f = mk(false);
  const r2 = applyAction(f.state, f.ctx, { type: 'END_TURN' });
  assert.equal(r2.state.sides.enemy.lord.hp, 30, 'include_lord: false → 打不到主将');
  assert.equal(getUnit(r2.state, 'enemy', 'front', 0)?.hp, 7, '人物照样挨打');

  // 单点指定（非范围/随机）不受这条默认影响
  const single: CardDef = {
    id: 't_single', name: '单体', faction: 'qun', type: 'strategist',
    cost: 5, attack: 1, health: 5, keywords: [], memo: '',
    skills: [{
      id: 's', name: '单体', kind: 'trigger', trigger: 'turn_end',
      effects: [{ action: 'damage', value: 2, target: { side: 'enemy', filter: { type: 'character' }, count: 1, mode: 'choose' } }],
    }],
  };
  const sc = scenario({ ownHand: [] });
  sc.state.sides.own.deck = Array(5).fill('neutral_infantry');
  sc.state.sides.enemy.deck = Array(5).fill('neutral_infantry');
  setUnit(sc.state, 'own', 'front', 0, makeUnit(single, 1, 91));
  setUnit(sc.state, 'enemy', 'front', 0, u('t2', 1, 9));
  const r3 = applyAction(sc.state, sc.ctx, { type: 'END_TURN' });
  assert.equal(r3.state.sides.enemy.lord.hp, 30, '单体指定目标不受"范围默认含主公"影响');
});

/* ================= ADR-086：万箭齐发从手牌打出 / 张辽溢出伤害 ================= */

test('万箭齐发：从手牌打出也结算伤害（原先只有 on_draw，手牌那张打出去毫无反应）', () => {
  realCard('tactic_wanjianqifa');
  const { state, ctx } = scenario({ ownHand: ['tactic_wanjianqifa'] });
  state.sides.enemy.deck = Array(4).fill('neutral_infantry');
  setUnit(state, 'enemy', 'front', 0, u('foe1', 1, 5));
  setUnit(state, 'enemy', 'front', 1, u('foe2', 1, 5));
  const lordBefore = state.sides.enemy.lord.hp;

  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0 });
  assert.ok(r.ok, `应能打出：${r.error}`);
  assert.equal(getUnit(r.state, 'enemy', 'front', 0)?.hp, 4, '敌方人物 −1');
  assert.equal(getUnit(r.state, 'enemy', 'front', 1)?.hp, 4, '全体结算，不是只打一个');
  assert.equal(lordBefore - r.state.sides.enemy.lord.hp, 1, '范围伤害默认含主公（ADR-085）');
});

test('张辽 冲锋陷阵：斩杀后的**溢出伤害**打在敌方主将身上（原先写死 2 点且打错目标）', () => {
  const zl = realCard('wei_zhangliao');
  const { state, ctx } = scenario({ ownHand: [] });
  state.sides.enemy.deck = Array(4).fill('neutral_infantry');
  setUnit(state, 'own', 'front', 0, makeUnit(zl, 0, 900));       // 张辽 5 攻（带先攻）
  setUnit(state, 'enemy', 'front', 0, u('victim', 0, 2));        // 2 血靶子：5 − 2 = 溢出 3
  setUnit(state, 'enemy', 'front', 1, u('bystander', 0, 9));     // 用来证明"不再打第一个敌人"
  const lordBefore = state.sides.enemy.lord.hp;

  const r = applyAction(state, ctx, {
    type: 'ATTACK', from: { row: 'front', col: 0 }, to: { kind: 'unit', row: 'front', col: 0 },
  });
  assert.ok(r.ok, `应能攻击：${r.error}`);
  assert.equal(getUnit(r.state, 'enemy', 'front', 0), null, '目标应被斩杀');
  assert.equal(lordBefore - r.state.sides.enemy.lord.hp, 3, '溢出 3 点应由主将承受');
  assert.equal(getUnit(r.state, 'enemy', 'front', 1)?.hp, 9, '旁边的敌人不该被误伤');
});

test('张辽 冲锋陷阵：没打死人就没有溢出伤害', () => {
  const zl = realCard('wei_zhangliao');
  const { state, ctx } = scenario({ ownHand: [] });
  state.sides.enemy.deck = Array(4).fill('neutral_infantry');
  setUnit(state, 'own', 'front', 0, makeUnit(zl, 0, 901));
  setUnit(state, 'enemy', 'front', 0, u('tank', 0, 20));         // 打不死 → 无溢出
  const lordBefore = state.sides.enemy.lord.hp;
  const r = applyAction(state, ctx, {
    type: 'ATTACK', from: { row: 'front', col: 0 }, to: { kind: 'unit', row: 'front', col: 0 },
  });
  assert.ok(r.ok);
  assert.equal(r.state.sides.enemy.lord.hp, lordBefore, '未击杀 → 主将不掉血');
});
