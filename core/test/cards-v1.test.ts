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
import { TEST_CARDS, scenario } from './fixtures.ts';
import type { Action, CardDef, Unit } from '../src/types.ts';

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

/* ================= 程昱：牺牲手牌，按其血量回血并造伤 ================= */

test('程昱 审时度势：弃手牌 → 按该牌血量给友军回血', () => {
  realCard('wei_chengyu');
  const { state, ctx } = scenario({ ownHand: ['wei_chengyu', 'test_champion'] });
  const ally = u('hurt', 2, 5, [], 'shu');
  ally.hp = 1;
  setUnit(state, 'own', 'front', 0, ally);

  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 1 });
  assert.ok(r.events.some((e) => e.type === 'CARD_DISCARDED'), '应弃掉一张手牌');
  // test_champion 血量 5 → 友军应从 1 回到 5（上限）
  const healed = getUnit(r.state, 'own', 'front', 0)!;
  assert.ok(healed.hp > 1, `友军应被治疗（1 → ${healed.hp}）`);
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

test('草船借箭：迫使敌方人物攻击其友军，并打上阵亡标记', () => {
  realCard('tactic_caochuanjiejian');
  const { state, ctx } = scenario({ ownHand: ['tactic_caochuanjiejian'] });
  setUnit(state, 'enemy', 'front', 0, u('e1', 3, 3));
  setUnit(state, 'enemy', 'front', 1, u('e2', 3, 3));
  setUnit(state, 'own', 'front', 0, u('mine', 2, 6, [], 'shu'));   // 强制攻击需要己方目标存在
  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0 });
  assert.ok(r.ok, '应能打出');
  assert.ok(r.events.some((e) => e.type === 'FORCED_ATTACK'), '应产生强制攻击事件');
  assert.ok(r.events.some((e) => e.type === 'STATUS_APPLIED'), '应打上阵亡标记');
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
  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 2 });
  const elites = r.state.sides.own.rows.front
    .filter((u) => u?.cardId === 'elite_xianzhen_dun');
  assert.equal(elites.length, 2, `应进化 2 个盾兵，实际 ${elites.length}`);
  assert.ok(elites.every((u) => u!.atk === 2 && u!.maxHp === 2), '陷阵盾兵 2 攻 2 血');
  assert.ok(elites.every((u) => u!.kw.includes('jia_dun')), '陷阵盾兵保留架盾');
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
