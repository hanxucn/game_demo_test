/**
 * ADR-071：B 类技能所需的 8 项 DSL / 引擎能力
 *
 * 对应 docs/BACKLOG-skills.md 的 B-3 ~ B-11。数据直接来自 core/data/cards_v1.json
 * （由 data/cards_decisions.draft.yaml 的 DSL 翻译生成），所以测的是**真实翻译结果**，
 * 不是测试替身。
 *
 * | 项 | 能力 | 代表卡 |
 * |---|---|---|
 * | B-3  | 抉择 `modes` + `modeIndex`              | 曹彰「猛袭」 |
 * | B-4  | 性别筛选 `filter.gender`                | 貂蝉「祸国倾城」 |
 * | B-5  | 连续普攻 `attack_each`（复用普攻结算）  | 张苞「父子将风」 |
 * | B-6  | 攻击时加成的**时序**修正                | 姜维 / 魏延 |
 * | B-7  | 批量驱散 `remove_kind: debuff`          | 华佗「青囊」 |
 * | B-8  | 牺牲取值 `sacrifice` + `value_from_flag`| 程昱「审时度势」 |
 * | B-9  | 复制技能支持手牌                        | 陆抗「谦冲如常」 |
 * | B-10 | 抽到非某类为止 `draw_until`             | 姜维「文武双全」 |
 * | B-11 | 守护·只护主将 `hu_zhu` / `guard_scope`  | 祖茂「替主」 |
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { applyAction, playTargetPlan } from '../src/engine.ts';
import { getUnit, makeUnit, setUnit } from '../src/state.ts';
import { applyStatus, dealDamage, lordRef, unitRef } from '../src/mutate.ts';
import { recomputeAuras, resolveTargets, effectsOf } from '../src/effects.ts';
import { createRng } from '../src/rng.ts';
import { STATUSES } from '../src/constants.ts';
import { TEST_CARDS, scenario } from './fixtures.ts';
import type { Action, CardDef, GameEvent, MatchState, TargetSelector, Unit } from '../src/types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ALL: CardDef[] = JSON.parse(readFileSync(join(ROOT, 'data', 'cards_v1.json'), 'utf8'));

for (const c of ALL) {
  const flat: CardDef = {
    ...c,
    keywords: c.keywords ?? [],
    skills: (c.skills ?? []).flatMap((sk) => (sk.dsl as unknown as CardDef['skills']) ?? []),
  };
  if (!TEST_CARDS.some((x) => x.id === c.id)) TEST_CARDS.push(flat);
}

/** 取真实翻译后的卡（skills[].dsl 摊平回 skills），**就地替换卡表**，便于按需改造 */
function realCard(id: string): CardDef {
  const raw = ALL.find((c) => c.id === id);
  assert.ok(raw, `cards_v1.json 里找不到 ${id}`);
  const flat: CardDef = {
    ...raw,
    keywords: raw.keywords ?? [],
    skills: (raw.skills ?? []).flatMap((s) => (s.dsl as unknown as CardDef['skills']) ?? []),
  };
  const i = TEST_CARDS.findIndex((x) => x.id === id);
  if (i >= 0) TEST_CARDS[i] = flat; else TEST_CARDS.push(flat);
  return flat;
}

const base = (id: string) => TEST_CARDS.find((x) => x.id === id)!;
const mk = (
  id: string, atk: number, hp: number, opts: Partial<CardDef> = {}, faction: 'shu' | 'wei' = 'wei',
): Unit => makeUnit({
  id, name: id, faction, type: 'general', cost: 2, attack: atk, health: hp,
  keywords: [], tags: [], memo: '', ...opts,
} as CardDef, 1, 1);

const hasEvent = (evs: GameEvent[], t: GameEvent['type']) => evs.some((e) => e.type === t);

/* ============================================================
   B-3 抉择（二选一）— 曹彰「猛袭」
   ============================================================ */

test('B-3 抉择：modeIndex 0 走「抽 1 张」，1 走「本回合攻击 +1」', () => {
  realCard('wei_caozhang');

  // 分支 ① 抽 1 张（scenario 默认牌库为空，必须自己放牌，否则走的是粮尽）
  const a = scenario({ ownHand: ['wei_caozhang'] });
  a.state.sides.own.deck = ['neutral_infantry'];
  const ra = applyAction(a.state, a.ctx, {
    type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 0, modeIndex: 0,
  });
  assert.ok(ra.ok, `打出应成功：${ra.error}`);
  assert.equal(ra.state.sides.own.deck.length, 0, '分支 ①：应抽掉 1 张');
  assert.equal(ra.state.sides.own.hand.length, 1, '分支 ①：手牌应为 1 张（抽到的牌）');
  const cao = getUnit(ra.state, 'own', 'front', 0)!;
  assert.equal(cao.atk, cao.baseAtk, '分支 ① 不应改攻击力');

  // 分支 ② 本回合攻击 +1
  const b = scenario({ ownHand: ['wei_caozhang'] });
  const rb = applyAction(b.state, b.ctx, {
    type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 1, modeIndex: 1,
  });
  assert.ok(rb.ok, `打出应成功：${rb.error}`);
  const cao2 = getUnit(rb.state, 'own', 'front', 1)!;
  assert.equal(cao2.atk, cao2.baseAtk + 1, '分支 ② 应 +1 攻');
  assert.equal(rb.state.sides.own.hand.length, 0, '分支 ② 不应抽牌');
  assert.ok(rb.events.some((e) => e.type === 'STAT_MODIFIED'), '应发 STAT_MODIFIED 供客户端播动画');
});

test('B-3 抉择：缺省 / 越界 modeIndex 一律安全退回 modes[0]（AI 与旧 UI 的兜底）', () => {
  realCard('wei_caozhang');
  for (const modeIndex of [undefined, -1, 2, 99, 1.5, NaN]) {
    const { state, ctx } = scenario({ ownHand: ['wei_caozhang'] });
    state.sides.own.deck = ['neutral_infantry'];
    const r = applyAction(state, ctx, {
      type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 0, modeIndex,
    });
    assert.ok(r.ok, `modeIndex=${String(modeIndex)} 应仍能打出：${r.error}`);
    // modes[0] = 抽 1 张 → 手牌恰好 1 张，且攻击力没变
    assert.equal(r.state.sides.own.hand.length, 1,
      `modeIndex=${String(modeIndex)} 应走 modes[0]（抽 1 张）`);
    const u = getUnit(r.state, 'own', 'front', 0)!;
    assert.equal(u.atk, u.baseAtk, `modeIndex=${String(modeIndex)} 不应走 +1 攻分支`);
  }
});

test('B-3 抉择：effectsOf 是分支取值的唯一真源（纯函数）', () => {
  const sk = { id: 'x', name: 'x', kind: 'trigger' as const,
    modes: [
      { name: 'a', effects: [{ action: 'draw', value: 1 }] },
      { name: 'b', effects: [{ action: 'heal', value: 2 }] },
    ] };
  assert.equal(effectsOf(sk, 1)[0]!.action, 'heal');
  assert.equal(effectsOf(sk, 0)[0]!.action, 'draw');
  for (const bad of [undefined, -3, 7, 2.5, NaN, Infinity]) {
    assert.equal(effectsOf(sk, bad)[0]!.action, 'draw', `越界 ${String(bad)} 应取 modes[0]`);
  }
  // 没有 modes 时行为不变
  assert.equal(effectsOf({ id: 'y', name: 'y', kind: 'active', effects: [{ action: 'damage' }] }, 1)[0]!.action, 'damage');
});

/* ============================================================
   B-4 性别筛选 — 貂蝉「祸国倾城」
   ============================================================ */

test('B-4 性别：数据层给具名人物卡都写上了 gender，兵种保持 unknown', () => {
  const byId = new Map(ALL.map((c) => [c.id, c]));
  assert.equal(byId.get('qun_diaochan')!.gender, 'female', '貂蝉应为 female');
  assert.equal(byId.get('shu_huangyueying')!.gender, 'female', '黄月英应为 female');
  assert.equal(byId.get('qun_caiwenji')!.gender, 'female', '蔡文姬应为 female');
  assert.equal(byId.get('shu_guanyu')!.gender, 'male', '具名武将默认 male');
  assert.equal(byId.get('wei_chengyu')!.gender, 'male', '具名谋臣默认 male');
  // 基础兵也是"角色"→ male。若记 unknown，貂蝉在纯兵种对局里会完全空转（ADR-071 踩过）
  assert.equal(byId.get('neutral_infantry')!.gender, 'male', '兵种也是场上的角色 → male');
  assert.equal(byId.get('tactic_huogong')!.gender, 'unknown', '战法卡不是角色 → unknown');
  // 回归：人物卡缺 gender 会让「按性别筛目标」静默落空
  const missing = ALL.filter((c) => ['general', 'strategist'].includes(c.type) && !c.gender);
  assert.equal(missing.length, 0, `这些人物卡缺少 gender：${missing.map((c) => c.id).join('、')}`);
});

test('B-4 性别：resolveTargets 的 gender 过滤只放行匹配者', () => {
  const { state, ctx } = scenario({});
  setUnit(state, 'enemy', 'front', 0, mk('male_0', 1, 3, { gender: 'male' }));
  setUnit(state, 'enemy', 'front', 1, mk('female_1', 1, 3, { gender: 'female' }));
  setUnit(state, 'enemy', 'front', 2, mk('unknown_2', 1, 3, { gender: 'unknown' }));

  const rng = createRng(1);
  const sel: TargetSelector = { side: 'enemy', filter: { gender: 'male' }, count: 'all' };
  const got = resolveTargets(state, sel, { side: 'own' }, rng);
  assert.deepEqual(got.map((t) => (t.kind === 'unit' ? t.col : -1)), [0], '只应选中第 0 格（男性）');

  // 玩家硬选一个女性目标 → 不在合法池内，退回池内第一个（男），绝不静默打到女性身上
  const forced = resolveTargets(state, { ...sel, count: 1, mode: 'choose' },
    { side: 'own', chosen: unitRef('enemy', 'front', 1) }, rng);
  assert.deepEqual(forced.map((t) => (t.kind === 'unit' ? t.col : -1)), [0],
    '选了非法的女性目标时应退回合法目标，而不是照打');
});

test('B-4 性别：貂蝉「祸国倾城」只震慑男性，指定女性无效', () => {
  // 拼点用 rng，先改成「比统率」让它确定可断言（被测的是 gender 过滤，不是拼点随机）
  const diao = realCard('qun_diaochan');
  const skill = diao.skills!.find((s) => s.id === 'huo_guo_qing_cheng')!;
  skill.effects![0]!.clashMode = 'cost';

  const { state, ctx } = scenario({ ownHand: ['qun_diaochan'] });
  const male = mk('male', 1, 4, { gender: 'male', cost: 2 });
  const female = mk('female', 1, 4, { gender: 'female', cost: 3 });
  setUnit(state, 'enemy', 'front', 0, male);
  setUnit(state, 'enemy', 'front', 1, female);

  // 貂蝉 cost 5 > 男敌 2 → 拼点必胜；指定目标即使是女性也应被过滤掉
  const r = applyAction(state, ctx, {
    type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 0,
    target: { side: 'enemy', row: 'front', col: 1 },   // 硬指女性
  });
  assert.ok(r.ok, `打出应成功：${r.error}`);
  assert.ok(r.events.some((e) => e.type === 'CLASH' && e.won), '拼点应胜（cost 模式，5 > 2）');
  const m = getUnit(r.state, 'enemy', 'front', 0)!;
  const f = getUnit(r.state, 'enemy', 'front', 1)!;
  assert.ok(m.statuses.zhen_she, '男性目标应被震慑');
  assert.ok(!f.statuses.zhen_she, '女性目标不该被震慑（卡面：只认男性角色）');
});

/* ============================================================
   B-5 连续普通攻击 — 张苞「父子将风」
   ============================================================ */

test('B-5 连续普攻：每个「攻 < 自己」的敌人各吃一次**真正的普攻**（含反击）', () => {
  realCard('shu_zhangbao');
  const { state, ctx } = scenario({ ownHand: ['shu_zhangbao'] });
  // 张苞卡面 4 攻 3 血；两个 2 攻 5 血的敌人 → 都吃 4 点，各自反击 2 点
  const e0 = mk('e0', 2, 5);
  const e1 = mk('e1', 2, 4);          // 4 血 → 吃 4 点正好阵亡
  const e2 = mk('e2', 4, 5);          // 攻 = 4，**不**小于张苞 → 不该被打
  setUnit(state, 'enemy', 'front', 0, e0);
  setUnit(state, 'enemy', 'front', 1, e1);
  setUnit(state, 'enemy', 'front', 2, e2);

  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 5 });
  assert.ok(r.ok, `打出应成功：${r.error}`);

  assert.equal(e0.maxHp - getUnit(r.state, 'enemy', 'front', 0)!.hp, 4, '目标 0 应吃 4 点普攻伤害');
  assert.equal(getUnit(r.state, 'enemy', 'front', 1), null, '目标 1 应被 4 点击杀（4 血）');
  assert.equal(getUnit(r.state, 'enemy', 'front', 2)!.hp, 5, '攻 >= 自己的敌人不该被选中');

  // 反击：两次普攻各吃 2 点 → 张苞 3 - 4 < 0 → 阵亡
  assert.equal(getUnit(r.state, 'own', 'front', 5), null, '张苞应被两次反击打死');
  assert.equal(r.events.filter((e) => e.type === 'ATTACK_DECLARED').length, 2, '应声明两次攻击');
});

test('B-5 连续普攻：张苞中途阵亡则立即停手，剩余目标一点伤害都不吃', () => {
  realCard('shu_zhangbao');
  const { state, ctx } = scenario({ ownHand: ['shu_zhangbao'] });
  const e0 = mk('e0', 3, 9);          // 反击 3 → 张苞（3 血）第一次普攻后就被打死
  const e1 = mk('e1', 1, 9);
  setUnit(state, 'enemy', 'front', 0, e0);
  setUnit(state, 'enemy', 'front', 1, e1);

  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 5 });
  assert.ok(r.ok, `打出应成功：${r.error}`);
  assert.equal(getUnit(r.state, 'own', 'front', 5), null, '张苞应在第一次普攻后阵亡');
  assert.equal(getUnit(r.state, 'enemy', 'front', 0)!.hp, 9 - 4, '第一个目标应吃到伤害');
  assert.equal(getUnit(r.state, 'enemy', 'front', 1)!.hp, 9, '张苞已阵亡 → 第二个目标不该再被打');
  assert.equal(r.events.filter((e) => e.type === 'ATTACK_DECLARED').length, 1, '只应声明一次攻击');
});

/* ============================================================
   B-6 攻击时加成的时序 — 姜维 / 魏延
   ============================================================ */

test('B-6 时序：on_attack 的 +1 攻必须作用于**本次**攻击（姜维）', () => {
  realCard('shu_jiangwei');
  const { state, ctx } = scenario({ own: { front: ['shu_jiangwei'] } });
  const jiang = getUnit(state, 'own', 'front', 0)!;
  const foe = mk('foe', 1, 30);
  setUnit(state, 'enemy', 'front', 0, foe);

  const r = applyAction(state, ctx, {
    type: 'ATTACK', from: { row: 'front', col: 0 }, to: { kind: 'unit', row: 'front', col: 0 },
  });
  assert.ok(r.ok, `攻击应成功：${r.error}`);
  // 卡面 4 攻 + 攻击时 +1 = 5。原先触发技排在伤害之后，这一下只打 4（回归点）
  assert.equal(foe.maxHp - getUnit(r.state, 'enemy', 'front', 0)!.hp, jiang.baseAtk + 1,
    '本次攻击就应吃到 +1 攻');
});

test('B-6 时序：攻击时加成是临时的，回合结束后不残留（姜维 / 魏延）', () => {
  for (const id of ['shu_jiangwei', 'shu_weiyan']) {
    const card = realCard(id);
    // 魏延的 +1 是 50% 概率，改成必中才好断言；被测的是 duration 语义
    for (const sk of card.skills ?? []) for (const e of sk.effects ?? []) delete e.chance;
  }
  const { state, ctx } = scenario({ own: { front: ['shu_jiangwei'] }, ownCommand: 10 });
  const jiang = getUnit(state, 'own', 'front', 0)!;
  setUnit(state, 'enemy', 'front', 0, mk('foe', 1, 60));

  const r = applyAction(state, ctx, {
    type: 'ATTACK', from: { row: 'front', col: 0 }, to: { kind: 'unit', row: 'front', col: 0 },
  });
  const after = getUnit(r.state, 'own', 'front', 0)!;
  assert.ok(after.atk > jiang.baseAtk, '攻击时应获得加成');
  assert.ok(after.mods.some((m) => m.kind === 'temp' && m.turns !== undefined),
    '加成必须是**临时**修正（否则会永久累积）');
});

test('B-6 时序：魏延两条分支都在数据里（攻击时 / 受创时），且都带 duration', () => {
  const wei = realCard('shu_weiyan');
  const attack = wei.skills!.find((s) => s.trigger === 'on_attack');
  const hurt = wei.skills!.find((s) => s.trigger === 'on_damaged');
  assert.ok(attack, '应有「攻击时」分支');
  assert.ok(hurt, '卡面写了「受到伤害时」，数据里不能缺（否则就是静默的文案白板）');
  for (const sk of [attack!, hurt!]) {
    assert.equal(sk.effects![0]!.duration, 'this_turn', `${sk.name} 的加成应只在本回合有效`);
  }
});

/* ============================================================
   B-7 批量驱散 — 华佗「青囊」
   ============================================================ */

test('B-7 批量驱散：清掉目标身上**全部**负面，buff 不受影响', () => {
  const hua = realCard('qun_huatuo');
  assert.ok(hua.skills!.some((s) => s.effects?.some((e) => e.remove_kind === 'debuff')),
    '「清除其负面效果状态」应翻译成 remove_kind: debuff');

  const { state, ctx } = scenario({ own: { front: ['qun_huatuo'] }, ownHand: ['neutral_infantry'] });
  const patient = mk('patient', 2, 10, {}, 'shu');
  patient.hp = 4;
  setUnit(state, 'own', 'front', 1, patient);
  for (const s of ['zhen_she', 'hun_luan', 'xu_ruo']) applyStatus(state, unitRef('own', 'front', 1), s, 1, []);
  applyStatus(state, unitRef('own', 'front', 1), 'zhen_fen', 1, []);

  const r = applyAction(state, ctx, {
    type: 'USE_SKILL', row: 'front', col: 0, target: { side: 'own', row: 'front', col: 1 },
  });
  assert.ok(r.ok, `主动技应成功：${r.error}`);

  const after = getUnit(r.state, 'own', 'front', 1)!;
  for (const s of ['zhen_she', 'hun_luan', 'xu_ruo']) {
    assert.equal(after.statuses[s], undefined, `负面状态 ${s} 应被清掉`);
  }
  assert.ok(after.statuses.zhen_fen, '正面状态（振奋）不该被清');
  assert.ok(after.hp > 4, '同时应按弃牌统率值治疗');
});

test('B-7 批量驱散：清掉的状态确实是 debuff 集合（与 STATUSES 表一致）', () => {
  const debuffs = Object.entries(STATUSES).filter(([, d]) => d.kind === 'debuff').map(([id]) => id);
  assert.ok(debuffs.includes('zhen_she') && debuffs.includes('hun_luan'),
    '震慑 / 混乱 必须登记为 debuff，否则「清全部负面」会漏掉它们');
});

/* ============================================================
   B-8 牺牲取值 — 程昱「审时度势」（行为测试见 cards-v1.test.ts）
   ============================================================ */

test('B-8 牺牲：sacrifice 把「血量上限」与「当前血量」分别写进 flags', () => {
  const cheng = realCard('wei_chengyu');
  assert.ok(cheng.skills!.some((s) => s.effects?.some((e) => e.action === 'sacrifice')),
    '程昱应改用 sacrifice 动作（原先读错成「弃手牌」）');
  const heal = cheng.skills!.flatMap((s) => s.effects ?? []).find((e) => e.action === 'heal')!;
  const dmg = cheng.skills!.flatMap((s) => s.effects ?? []).find((e) => e.action === 'damage')!;
  assert.equal(heal.value_from_flag, 'sacrificed_max_hp', '治疗量取「血量最大值」');
  assert.equal(dmg.value_from_flag, 'sacrificed_hp', '伤害量取「牺牲时血量」');
  assert.equal(heal.target?.pick, 2, '治疗对象是第二个玩家选择（target2）');
});

/* ============================================================
   B-9 复制技能（手里或场上）— 陆抗「谦冲如常」
   ============================================================ */

test('B-9 复制技能：场上有其他友方人物时，复制场上的技能', () => {
  realCard('wu_lukang');
  const { state, ctx } = scenario({ ownHand: ['wu_lukang'], own: { front: ['test_strategist'] } });
  setUnit(state, 'own', 'front', 0, makeUnit(base('test_strategist'), 0, 90));

  const r = applyAction(state, ctx, {
    type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 1,
    target: { side: 'own', row: 'front', col: 0 },
  });
  assert.ok(r.ok, `打出应成功：${r.error}`);
  const lu = getUnit(r.state, 'own', 'front', 1)!;
  assert.ok(lu.skills!.some((s) => s.id === 'fireball'), '应复制到场上的「火计」');
  const copied = r.events.filter((e) => e.type === 'SKILL_COPIED');
  assert.equal(copied.length, 1, '「可选择……一次」= 只复制一个技能');
});

test('B-9 复制技能：场上没有其他友方人物时，同一个选择器自动退回**手牌**', () => {
  realCard('wu_lukang');
  const { state, ctx } = scenario({ ownHand: ['wu_lukang', 'test_strategist'] });

  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 0 });
  assert.ok(r.ok, `打出应成功：${r.error}`);
  const lu = getUnit(r.state, 'own', 'front', 0)!;
  assert.ok(lu.skills!.some((s) => s.id === 'fireball'),
    '卡面写「手里或场上」：zone: both 的候选池里必须还有手牌那条路');
  const copied = r.events.filter((e) => e.type === 'SKILL_COPIED');
  assert.equal(copied.length, 1, '只应复制一次');
  assert.equal((copied[0] as Extract<GameEvent, { type: 'SKILL_COPIED' }>).from, '测试谋臣',
    '来源应显示为手牌里的那张卡');
});

test('B-9 复制技能：不会把陆抗自己算成「友方将领」', () => {
  realCard('wu_lukang');
  const { state, ctx } = scenario({ ownHand: ['wu_lukang'] });
  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 0 });
  assert.ok(r.ok);
  assert.ok(!hasEvent(r.events, 'SKILL_COPIED'), '没有别的友方人物时不该复制自己的技能');
});

/* ============================================================
   B-10 抽到非某类为止 — 姜维「文武双全」
   ============================================================ */

test('B-10 抽到非策略牌为止：牌库 [策略,策略,非策略,…] → 恰好抽 3 张停在非策略', () => {
  realCard('shu_jiangwei');
  // 牌库是 pop() 取牌，故「先抽到的」在数组末尾
  const { state, ctx } = scenario({ own: { front: ['shu_jiangwei'] }, ownHand: ['tactic_huogong'] });
  state.sides.own.deck = ['neutral_infantry', 'test_draw_tactic', 'test_draw_tactic'];
  state.turn = 2;                       // 与 enteredTurn 拉开，避免召唤失调干扰
  state.sides.own.hand = [{ card: base('tactic_huogong'), mods: [] }];

  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0 });
  assert.ok(r.ok, `打出策略牌应成功：${r.error}`);

  const drawn = r.events.filter((e): e is Extract<GameEvent, { type: 'CARD_DRAWN' }> => e.type === 'CARD_DRAWN');
  assert.equal(drawn.length, 3, `应抽 3 张（2 张策略 + 停在 1 张非策略），实际 ${drawn.length}`);
  assert.deepEqual(drawn.map((e) => e.card.type), ['tactic', 'tactic', 'troop'],
    '抽牌顺序应为 策略 → 策略 → 非策略');
  assert.equal(r.state.sides.own.deck.length, 0, '牌库应被抽空到只剩非策略那张之后');
});

test('B-10 抽到非策略牌为止：牌库耗尽时停手并触发粮尽，不死循环', () => {
  realCard('shu_jiangwei');
  const { state, ctx } = scenario({ own: { front: ['shu_jiangwei'] }, ownHand: ['tactic_huogong'] });
  state.sides.own.deck = ['test_draw_tactic', 'test_draw_tactic'];   // 全是策略牌 → 抽空
  state.turn = 2;

  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0 });
  assert.ok(r.ok, `打出应成功：${r.error}`);
  assert.equal(r.state.sides.own.deck.length, 0, '策略牌应被抽光');
  assert.ok(r.events.some((e) => e.type === 'CARD_DRAWN' && e.card.type === 'troop') === false,
    '不该凭空抽到非策略牌');
  assert.ok(r.state.sides.own.fatigue >= 1, '牌库耗尽后应开始粮尽');
});

test('B-10 抽到非策略牌为止：只在打出**策略牌**时触发', () => {
  realCard('shu_jiangwei');
  const { state, ctx } = scenario({ own: { front: ['shu_jiangwei'] } });
  state.sides.own.deck = ['neutral_infantry', 'test_draw_tactic', 'test_draw_tactic'];
  state.turn = 2;
  state.sides.own.hand = [{ card: base('neutral_infantry'), mods: [] }];

  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 3 });
  assert.ok(r.ok, `打出人物牌应成功：${r.error}`);
  assert.equal(r.state.sides.own.deck.length, 3, '打出人物牌不该触发抽牌');
});

/* ============================================================
   B-11 守护·只护主将 — 祖茂「替主」
   ============================================================ */

function withZumao(): { state: MatchState; ctx: ReturnType<typeof scenario>['ctx'] } {
  realCard('wu_zumao');
  const s = scenario({ ownHand: ['wu_zumao'] });
  const r = applyAction(s.state, s.ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 0 });
  assert.ok(r.ok, `祖茂应能打出：${r.error}`);
  return { state: r.state, ctx: s.ctx };
}

test('B-11 护主：主帅受伤时转由祖茂承受，且带 lord 标记', () => {
  const { state, ctx } = withZumao();
  const lordHp = state.sides.own.lord.hp;
  const zumaoHp = getUnit(state, 'own', 'front', 0)!.hp;

  const evs: GameEvent[] = [];
  dealDamage(state, ctx.cards, lordRef('own'), 1, evs, 'test');   // 祖茂 2 血，用 1 点避免直接打死

  assert.equal(state.sides.own.lord.hp, lordHp, '主帅血量不该掉');
  assert.equal(getUnit(state, 'own', 'front', 0)!.hp, zumaoHp - 1, '伤害应转给祖茂');
  const red = evs.find((e) => e.type === 'DAMAGE_REDIRECTED');
  assert.ok(red, '应产生 DAMAGE_REDIRECTED');
  assert.equal((red as Extract<GameEvent, { type: 'DAMAGE_REDIRECTED' }>).lord, true,
    '客户端要靠 lord 标记把飘字指到主公条上');
});

test('B-11 护主：**只**护主帅 —— 其他友方单位受伤不转移', () => {
  const { state, ctx } = withZumao();
  const ally = mk('ally', 1, 10, {}, 'shu');
  setUnit(state, 'own', 'front', 3, ally);
  const zumaoHp = getUnit(state, 'own', 'front', 0)!.hp;

  const evs: GameEvent[] = [];
  dealDamage(state, ctx.cards, unitRef('own', 'front', 3), 4, evs, 'test');

  assert.equal(getUnit(state, 'own', 'front', 3)!.hp, 6, '友方单位应自己吃下伤害');
  assert.equal(getUnit(state, 'own', 'front', 0)!.hp, zumaoHp, '祖茂不该替友方单位挨打');
  assert.ok(!hasEvent(evs, 'DAMAGE_REDIRECTED'), '不该发生转移');
});

test('B-11 护主：祖茂阵亡后保护立即失效（光环随之撤销）', () => {
  const { state, ctx } = withZumao();
  const rng = createRng(state.seed);
  // 直接把祖茂打死，然后按引擎的做法重算光环
  dealDamage(state, ctx.cards, unitRef('own', 'front', 0), 999, [], 'test');
  recomputeAuras(state, ctx.cards, rng, []);
  assert.equal(getUnit(state, 'own', 'front', 0), null, '祖茂应已阵亡');
  assert.equal(state.sides.own.lord.statuses?.hu_zhu, undefined,
    '光环消失后主帅身上的「护主」应被清掉');

  const lordHp = state.sides.own.lord.hp;
  dealDamage(state, ctx.cards, lordRef('own'), 3, [], 'test');
  assert.equal(state.sides.own.lord.hp, lordHp - 3, '没有守护时主帅应正常掉血');
});

test('B-11 护主：跨过回合边界保护仍在 —— 光环维持的状态不该被「回合到期」清掉', () => {
  const { state, ctx } = withZumao();
  // 光环状态必须**无到期**，否则会在自己回合结束时被清，
  // 而「护主」要挡的恰恰是对手回合的伤害（实现时最容易漏的一步）
  assert.equal(state.sides.own.lord.statuses!.hu_zhu!.turns, undefined,
    '光环施加的状态应交给光环管生命周期，不能带 turns');

  const r1 = applyAction(state, ctx, { type: 'END_TURN' });        // 进入敌方回合
  assert.ok(r1.ok, `结束回合应成功：${r1.error}`);
  assert.ok(r1.state.sides.own.lord.statuses?.hu_zhu, '换手后「护主」仍应在主帅身上');

  const lordHp = r1.state.sides.own.lord.hp;
  const zumaoHp = getUnit(r1.state, 'own', 'front', 0)!.hp;
  const evs: GameEvent[] = [];
  dealDamage(r1.state, ctx.cards, lordRef('own'), 1, evs, 'test');
  assert.equal(r1.state.sides.own.lord.hp, lordHp, '敌方回合内主帅仍应受保护');
  assert.equal(getUnit(r1.state, 'own', 'front', 0)!.hp, zumaoHp - 1, '伤害仍应转给祖茂');
});

test('B-11 护主：srcUid 指向阵亡者时保护自动失效（不依赖光环重算）', () => {
  const { state, ctx } = withZumao();
  const before = state.sides.own.lord.hp;
  // 手动把祖茂移出场，但**不**重算光环 —— findLordGuard 必须自己认出守护者已不在
  setUnit(state, 'own', 'front', 0, null);
  dealDamage(state, ctx.cards, lordRef('own'), 5, [], 'test');
  assert.equal(state.sides.own.lord.hp, before - 5, '守护者不在场 → 主帅自己挨打');
});

test('B-11 守护范围：shou_hu 是 any、hu_zhu 是 lord，两者在状态表里都注册', () => {
  assert.equal(STATUSES.shou_hu!.guard_scope, 'any');
  assert.equal(STATUSES.hu_zhu!.guard_scope, 'lord');
  assert.ok(STATUSES.shou_hu!.caps!.includes('redirect_damage'));
  assert.ok(STATUSES.hu_zhu!.caps!.includes('redirect_damage'));
});

/* ============================================================
   回归：陈宫「忠烈」用的 shou_hu（any）不受护主改动影响
   ============================================================ */

test('回归：shou_hu（any）仍然接管被守护单位的伤害', () => {
  const { state, ctx } = scenario({ ownHand: ['qun_chengong'] });
  const target = mk('target', 1, 10, {}, 'shu');
  setUnit(state, 'own', 'front', 1, target);

  const r = applyAction(state, ctx, {
    type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 0,
    target: { side: 'own', row: 'front', col: 1 },
  });
  assert.ok(r.ok, `陈宫应能打出：${r.error}`);
  const cheng = getUnit(r.state, 'own', 'front', 0)!;
  const hpTarget = getUnit(r.state, 'own', 'front', 1)!.hp;
  const hpCheng = cheng.hp;

  const evs: GameEvent[] = [];
  dealDamage(r.state, ctx.cards, unitRef('own', 'front', 1), 3, evs, 'test');
  assert.equal(getUnit(r.state, 'own', 'front', 1)!.hp, hpTarget, '被守护者不该掉血');
  assert.equal(getUnit(r.state, 'own', 'front', 0)!.hp, hpCheng - 3, '伤害应转给陈宫');
});

/* ============================================================
   出牌前的「要选什么」：判定下沉到 core（BACKLOG §3，UI 不自己猜）
   ============================================================ */

test('playTargetPlan：抉择卡返回分支名、且不要求选目标（曹彰）', () => {
  realCard('wei_caozhang');
  const { state } = scenario({ ownHand: ['wei_caozhang'] });
  const plan = playTargetPlan(state, 'own', base('wei_caozhang'));
  assert.equal(plan.modes.length, 2, '「猛袭」应给出两个分支');
  assert.ok(plan.modes[0]!.includes('抽'), `第一个分支应是抽牌：${plan.modes[0]}`);
  assert.equal(plan.choices.length, 0, '分支里没有 choose 选择器 → 不需要选目标');
});

test('playTargetPlan：普通基础兵不需要任何选择', () => {
  const { state } = scenario({});
  const plan = playTargetPlan(state, 'own', base('neutral_infantry'));
  assert.deepEqual(plan, { modes: [], choices: [] });
});

test('playTargetPlan：张苞是全体目标（count: all），不该弹选目标', () => {
  realCard('shu_zhangbao');
  const { state } = scenario({ ownHand: ['shu_zhangbao'] });
  setUnit(state, 'enemy', 'front', 0, mk('e', 1, 3));
  const plan = playTargetPlan(state, 'own', base('shu_zhangbao'));
  assert.equal(plan.choices.length, 0, 'count: all 由引擎逐个结算，不需要玩家挑');
});

test('playTargetPlan：陈宫可指定敌我双方的人（side: both）', () => {
  realCard('qun_chengong');
  const { state } = scenario({ ownHand: ['qun_chengong'], own: { front: [null, 'neutral_infantry'] } });
  setUnit(state, 'enemy', 'front', 0, mk('e', 1, 3));
  const plan = playTargetPlan(state, 'own', base('qun_chengong'));
  assert.equal(plan.choices.length, 1, '陈宫只需选一个目标');
  const sides = plan.choices[0]!.targets.map((t) => t.side);
  assert.ok(sides.includes('own') && sides.includes('enemy'), '敌我都要能选');
});

test('playTargetPlan：程昱要两个选择（先牺牲谁、再恢复给谁），走 target2', () => {
  realCard('wei_chengyu');
  const { state } = scenario({ ownHand: ['wei_chengyu'], own: { front: ['neutral_infantry'] } });
  setUnit(state, 'enemy', 'front', 0, mk('e', 1, 3));
  const plan = playTargetPlan(state, 'own', base('wei_chengyu'));
  assert.equal(plan.choices.length, 2, '「牺牲谁」与「恢复给谁」是两个选择');
  assert.deepEqual(plan.choices.map((c) => c.pick), [1, 2], '第二个选择走 target2');
  assert.deepEqual(plan.choices.map((c) => c.label), ['己方人物', '己方人物']);
  // 牺牲的目标只能是己方，不能把敌人当成牺牲品
  assert.ok(plan.choices[0]!.targets.every((t) => t.side === 'own'));
});

test('playTargetPlan：陆抗的目标池含手牌 —— UI 选不到，标记 includesHand', () => {
  realCard('wu_lukang');
  const { state } = scenario({ ownHand: ['wu_lukang', 'test_strategist'] });
  const plan = playTargetPlan(state, 'own', base('wu_lukang'));
  assert.equal(plan.choices.length, 1);
  assert.equal(plan.choices[0]!.includesHand, true, '「手里或场上」应把含手牌这件事告诉 UI');
  assert.equal(plan.choices[0]!.targets.length, 0, '手牌不是选项目标');
});

test('playTargetPlan：貂蝉只列男性敌人（女性/兵种不进候选）', () => {
  realCard('qun_diaochan');
  const { state } = scenario({ ownHand: ['qun_diaochan'] });
  setUnit(state, 'enemy', 'front', 0, mk('m', 1, 3, { gender: 'male' }));
  setUnit(state, 'enemy', 'front', 1, mk('f', 1, 3, { gender: 'female' }));
  setUnit(state, 'enemy', 'front', 2, mk('u', 1, 3, { gender: 'unknown' }));
  const plan = playTargetPlan(state, 'own', base('qun_diaochan'));
  assert.equal(plan.choices.length, 1);
  assert.deepEqual(plan.choices[0]!.targets.map((t) => t.col), [0], '只应出现男性那一格');
  assert.equal(plan.choices[0]!.label, '敌方男性人物');
});

test('playTargetPlan：plan 给出的目标一定能被引擎接受（闭环）', () => {
  realCard('wei_chengyu');
  const { state, ctx } = scenario({ ownHand: ['wei_chengyu'] });
  const victim = mk('victim', 3, 4, {}, 'shu');
  setUnit(state, 'own', 'front', 0, victim);
  const wounded = mk('wounded', 2, 5, {}, 'shu');
  wounded.hp = 1;
  setUnit(state, 'own', 'front', 2, wounded);
  setUnit(state, 'enemy', 'front', 0, mk('foe', 1, 20));

  const plan = playTargetPlan(state, 'own', base('wei_chengyu'));
  const t1 = plan.choices[0]!.targets.find((t) => t.col === 0)!;
  const t2 = plan.choices[1]!.targets.find((t) => t.col === 2)!;
  const r = applyAction(state, ctx, {
    type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 1,
    target: { side: t1.side, row: t1.row!, col: t1.col! },
    target2: { side: t2.side, row: t2.row!, col: t2.col! },
  });
  assert.ok(r.ok, `按 plan 的选择出牌应成功：${r.error}`);
  assert.equal(getUnit(r.state, 'own', 'front', 0), null, 'plan 指的第 1 个目标应正是被牺牲者');
});

/* ============================================================
   ADR-072：`condition.event === 'killed'` 必须在**伤害之后**判定
   ------------------------------------------------------------
   on_attack 触发技原先统一排在算攻击力之前（ADR-071 为了让「攻击时 +1」生效），
   于是「击杀后……」这类效果的条件**永远为假** —— 张辽「冲锋陷阵」的溢出伤害、
   关兴「额外行动」的额外攻击都等于白板。现在拆成两趟：非击杀条件在伤害前、
   击杀条件在伤害后。
   ============================================================ */

test("ADR-072：击杀条件在伤害之后判定 —— 张辽斩杀后溢出伤害真的打出来了", () => {
  const zhang = realCard('wei_zhangliao');
  assert.equal(zhang.attack, 5, '张辽卡面攻击力（回归：本测试按相对值断言，改数值不受影响）');

  const { state, ctx } = scenario({ own: { front: ['wei_zhangliao'] } });
  const atk = getUnit(state, 'own', 'front', 0)!.atk;
  // 目标：血量正好被打死（相对卡面攻击力，不写死数值）
  const victim = mk('victim', 1, atk);
  setUnit(state, 'enemy', 'front', 0, victim);
  const bystander = mk('bystander', 1, 30);
  setUnit(state, 'enemy', 'front', 1, bystander);

  const r = applyAction(state, ctx, {
    type: 'ATTACK', from: { row: 'front', col: 0 }, to: { kind: 'unit', row: 'front', col: 0 },
  });
  assert.ok(r.ok, `攻击应成功：${r.error}`);
  assert.equal(getUnit(r.state, 'enemy', 'front', 0), null, '目标应被斩杀');
  assert.equal(bystander.maxHp - getUnit(r.state, 'enemy', 'front', 1)!.hp, 2,
    '斩杀后应再对另一名敌人造成 2 点（溢出伤害）');
});

test('ADR-072：没杀死就不该触发击杀分支', () => {
  realCard('wei_zhangliao');
  const { state, ctx } = scenario({ own: { front: ['wei_zhangliao'] } });
  const atk = getUnit(state, 'own', 'front', 0)!.atk;
  const tough = mk('tough', 1, atk + 5);        // 打不死
  setUnit(state, 'enemy', 'front', 0, tough);
  const bystander = mk('bystander', 1, 30);
  setUnit(state, 'enemy', 'front', 1, bystander);

  const r = applyAction(state, ctx, {
    type: 'ATTACK', from: { row: 'front', col: 0 }, to: { kind: 'unit', row: 'front', col: 0 },
  });
  assert.ok(r.ok, `攻击应成功：${r.error}`);
  assert.equal(getUnit(r.state, 'enemy', 'front', 0)!.hp, 5, '目标应存活');
  assert.equal(getUnit(r.state, 'enemy', 'front', 1)!.hp, 30, '没杀死 → 不该有溢出伤害');
});

test('ADR-072：关兴击杀后获得额外行动（extra_attack 真的重置了攻击次数）', () => {
  const guanCard = realCard('shu_guanxing');
  // 「额外行动」是 50% 概率；删掉 chance 让它必中 —— 被测的是"击杀条件有没有被满足"
  for (const sk of guanCard.skills ?? []) for (const e of sk.effects ?? []) delete e.chance;

  const { state, ctx } = scenario({ own: { front: ['shu_guanxing'] } });
  const atk = getUnit(state, 'own', 'front', 0)!.atk;
  setUnit(state, 'enemy', 'front', 0, mk('victim', 1, atk));   // 正好被打死
  setUnit(state, 'enemy', 'front', 1, mk('bystander', 1, 30));

  const r = applyAction(state, ctx, {
    type: 'ATTACK', from: { row: 'front', col: 0 }, to: { kind: 'unit', row: 'front', col: 0 },
  });
  assert.ok(r.ok, `攻击应成功：${r.error}`);
  const guan = getUnit(r.state, 'own', 'front', 0)!;
  assert.ok(r.events.some((e) => e.type === 'EXTRA_ATTACK'),
    '击杀后应触发额外行动（原先击杀条件永假 → 事件根本不会出现）');
  assert.equal(guan.attackedThisTurn, 0, 'extra_attack 应把本回合攻击次数重置为 0');
});

test('ADR-072：攻击者被反击打死时，不再拿击杀奖励', () => {
  realCard('wei_zhangliao');
  const { state, ctx } = scenario({ own: { front: ['wei_zhangliao'] } });
  const me = getUnit(state, 'own', 'front', 0)!;
  // 目标会被打死，但反击力足够反杀张辽
  setUnit(state, 'enemy', 'front', 0, mk('victim', me.hp + 1, me.atk));
  const bystander = mk('bystander', 1, 30);
  setUnit(state, 'enemy', 'front', 1, bystander);

  const r = applyAction(state, ctx, {
    type: 'ATTACK', from: { row: 'front', col: 0 }, to: { kind: 'unit', row: 'front', col: 0 },
  });
  assert.ok(r.ok, `攻击应成功：${r.error}`);
  assert.equal(getUnit(r.state, 'enemy', 'front', 0), null, '目标应被斩杀');
  assert.equal(getUnit(r.state, 'own', 'front', 0), null, '张辽应被反击打死');
  assert.equal(getUnit(r.state, 'enemy', 'front', 1)!.hp, 30, '攻击者已阵亡 → 不该再结算击杀奖励');
});

test('ADR-072：`killed` 是"这一击"的标记，不跨回合/跨攻击残留', () => {
  realCard('wei_zhangliao');
  const { state, ctx } = scenario({ own: { front: ['wei_zhangliao'] } });
  const atk = getUnit(state, 'own', 'front', 0)!.atk;
  setUnit(state, 'enemy', 'front', 0, mk('tough', 1, atk + 9));   // 第一击打不死
  const bystander = mk('bystander', 1, 30);
  setUnit(state, 'enemy', 'front', 1, bystander);

  const r1 = applyAction(state, ctx, {
    type: 'ATTACK', from: { row: 'front', col: 0 }, to: { kind: 'unit', row: 'front', col: 0 },
  });
  assert.ok(r1.ok);
  assert.equal(getUnit(r1.state, 'enemy', 'front', 1)!.hp, 30, '第一击没杀死 → 无奖励');
});

/* ============================================================
   ADR-072：类型定型（1 攻武将必须显式标注）
   ============================================================ */

test('ADR-072：数据里「1 攻武将」都有显式标注，其余人物类型与攻击力自洽', () => {
  const chars = ALL.filter((c) => ['general', 'strategist'].includes(c.type));
  const problems: string[] = [];
  for (const c of chars) {
    const atk = c.attack ?? 0;
    if (c.type === 'general' && atk <= 1 && c.type_explicit !== true) {
      problems.push(`${c.id}（${c.name}）是武将但只有 ${atk} 攻且未显式标注`);
    }
    if (c.type === 'strategist' && atk > 1) {
      problems.push(`${c.id}（${c.name}）是谋臣却有 ${atk} 攻`);
    }
  }
  assert.deepEqual(problems, [], `类型与攻击力不自洽：\n${problems.join('\n')}`);
});

test('ADR-072：显式标注的 1 攻武将与默认谋臣各自正确（祖茂/曹昂/张宝/向宠）', () => {
  const byId = new Map(ALL.map((c) => [c.id, c]));
  // 设计者 2026-09-23：祖茂即便 1 攻仍是武将，可以显式标注
  assert.equal(byId.get('wu_zumao')!.attack, 1, '祖茂按 ADR-068 的 2 费 1/3');
  assert.equal(byId.get('wu_zumao')!.health, 3);
  assert.equal(byId.get('wu_zumao')!.type, 'general', '1 攻仍显式定为武将');
  assert.equal(byId.get('wu_zumao')!.type_explicit, true, '需要显式标注，否则校验器报错');
  for (const id of ['wei_caogang', 'qun_zhangbao']) {
    assert.equal(byId.get(id)!.type, 'general', `${id} 是显式判定的武将`);
    assert.equal(byId.get(id)!.type_explicit, true, `${id} 应带 type_explicit`);
  }
  // 没有显式标注的 1 攻人物 → 默认谋臣
  assert.equal(byId.get('shu_xiangchong')!.type, 'strategist',
    '向宠 1 攻且无设计者显式标注 → 按 ADR-018 默认谋臣（ADR-072 从「武将」修正）');
  assert.equal(byId.get('shu_xiangchong')!.type_explicit, undefined);
});

test('ADR-072：定型为「判不出类型」的卡不再丢攻血（黄权回归）', () => {
  const huang = ALL.find((c) => c.id === 'shu_huangquan')!;
  assert.ok(huang, '黄权应存在于卡表');
  assert.equal(huang.type, 'strategist', '黄权史实为文臣、攻击 ≤ 1 → 谋臣');
  assert.equal(huang.health, 3, '生命值不能因为「类型判不出」而丢失（曾整块丢过）');
  assert.equal(huang.attack, 0, '攻击力应显式为 0，而不是缺字段');
  // 顺带锁住"非单位卡不该有攻血"这条不变量
  const unitLike = ['tactic', 'event', 'status', 'special'];
  for (const c of ALL) {
    if (!unitLike.includes(c.type)) continue;
    assert.equal(c.attack, undefined, `${c.id}（${c.type}）不该有攻击力`);
    assert.equal(c.health, undefined, `${c.id}（${c.type}）不该有生命值`);
  }
});
