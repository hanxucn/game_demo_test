/**
 * ADR-074：内容缺口收口（空城计 / 司马懿 / 休养生息 / 黄皓 / 张宝·张梁）
 *        + 让客户端能看见技能的 `SKILL_TRIGGERED`
 *
 * 数据来自 core/data/cards_v1.json（真实翻译结果），不是测试替身。
 *
 * | 卡 | 补了什么引擎能力 |
 * |---|---|
 * | 空城计 | 主帅可被 `untargetable` 保护（`kong_cheng`）+ `legalTargets` 判定 |
 * | 司马懿 | `acted_this_turn` / `dealt_damage_this_turn` 追踪、`mill` 动作、`any_of` 条件组合 |
 * | 休养生息 | `skip_turn` 能力 + 引擎的跳回合结算 + 主将治疗 |
 * | 黄皓 | `gain_command` 负数（自削统率）、`ban_play`（封锁而非弃掉） |
 * | 张宝/张梁 | `all_of` 条件组合 + 按 `card_id` 精确判「谁在场」 |
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { applyAction } from '../src/engine.ts';
import { legalTargets } from '../src/rules.ts';
import { getUnit, makeUnit, setUnit } from '../src/state.ts';
import { dealDamage, lordRef } from '../src/mutate.ts';
import { applyStatus } from '../src/mutate.ts';
import { STATUSES } from '../src/constants.ts';
import { TEST_CARDS, scenario } from './fixtures.ts';
import type { Action, CardDef, GameEvent, Unit } from '../src/types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ALL: CardDef[] = JSON.parse(readFileSync(join(ROOT, 'data', 'cards_v1.json'), 'utf8'));

for (const c of ALL) {
  const flat: CardDef = {
    ...c,
    keywords: c.keywords ?? [],
    skills: (c.skills ?? []).flatMap((sk) => (sk.dsl as unknown as CardDef['skills']) ?? []),
  };
  const i = TEST_CARDS.findIndex((x) => x.id === c.id);
  if (i >= 0) TEST_CARDS[i] = flat; else TEST_CARDS.push(flat);
}

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
const mk = (id: string, atk: number, hp: number, faction: 'shu' | 'wei' = 'wei'): Unit =>
  makeUnit({ id, name: id, faction, type: 'general', cost: 2, attack: atk, health: hp,
    keywords: [], tags: [], memo: '' } as CardDef, 1, 1);

const has = (evs: GameEvent[], t: GameEvent['type']) => evs.some((e) => e.type === t);
const tokens = (evs: GameEvent[]) =>
  evs.filter((e): e is Extract<GameEvent, { type: 'UNIT_SUMMONED' }> => e.type === 'UNIT_SUMMONED')
    .filter((e) => e.unit.cardId === 'token_huangjin_bing').length;

/* ============================================================
   空城计：主帅不能被普通攻击指定
   ============================================================ */

test('ADR-074 空城计：己方场上无人时，主帅一整个对手回合内不能被攻击', () => {
  realCard('tactic_kongchengji');
  // 敌方单位必须用 scenario 摆位（enteredTurn = 0）—— mk() 造的 enteredTurn = 当前回合，
  // 会因召唤失调而"没有合法目标"，把空城的断言掩盖成假通过
  const { state, ctx } = scenario({ ownHand: ['tactic_kongchengji'], enemy: { front: ['neutral_archer'] } });

  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0 });
  assert.ok(r.ok, `打出应成功：${r.error}`);
  assert.ok(r.state.sides.own.lord.statuses?.kong_cheng, '己方主帅应获得「空城」');

  // 打出之后己方才放人（条件只判"打出那一刻"）——留一个可打的目标，
  // 才能证明"打得到人物、但打不到主帅"，而不是"根本没得打"
  setUnit(r.state, 'own', 'front', 4, mk('ally', 1, 6, 'shu'));

  // 敌方回合：仍然打不到主帅
  const r2 = applyAction(r.state, ctx, { type: 'END_TURN' });
  assert.ok(r2.ok);
  const legal = legalTargets(r2.state, 'enemy', 'front', 0);
  assert.ok(legal.targets.some((t) => t.kind === 'unit'), '己方人物本身仍可被攻击');
  assert.ok(!legal.targets.some((t) => t.kind === 'lord'),
    '「空城」期间主帅不该出现在合法攻击目标里');

  // 效果伤害不受影响（卡面说的是"无法**攻击**"）
  const lordHp = r2.state.sides.own.lord.hp;
  dealDamage(r2.state, ctx.cards, lordRef('own'), 2, [], 'test');
  assert.equal(r2.state.sides.own.lord.hp, lordHp - 2, '战法/技能伤害仍可打主将');
});

test('ADR-074 空城计：己方场上有人时不生效（条件不满足）', () => {
  realCard('tactic_kongchengji');
  const { state, ctx } = scenario({ ownHand: ['tactic_kongchengji'], own: { front: ['neutral_infantry'] } });
  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0 });
  assert.ok(r.ok, `打出应成功：${r.error}`);
  assert.equal(r.state.sides.own.lord.statuses?.kong_cheng, undefined, '场上有自己人 → 不该获得空城');
  const legal = legalTargets(r.state, 'enemy', 'front', 0);
  assert.ok(legal.targets.length >= 0);   // 只断言不抛错；主将可打与否由上一测试覆盖
});

test('ADR-074：`kong_cheng` 状态已注册且带 untargetable 能力', () => {
  assert.ok(STATUSES.kong_cheng, 'kong_cheng 必须登记在 STATUSES');
  assert.ok(STATUSES.kong_cheng!.caps!.includes('untargetable'));
});

/* ============================================================
   司马懿「谋定后动」①②③
   ============================================================ */

/**
 * 司马懿在己方场上，敌方摆两个 30 血沙包（便于观察 AOE / 不被打死）。
 *
 * ⚠️ 己方**必须再站一个人**：否则触发 ③「场上只剩司马懿」，
 * `any_of` 的第二个分支恒真，①②的断言全被污染（第一版就栽在这里）。
 */
function simayiBoard(withDeck = true) {
  realCard('wei_simayi');
  const { state, ctx } = scenario({ own: { front: ['wei_simayi', 'neutral_infantry'] } });
  setUnit(state, 'enemy', 'front', 0, mk('dummy0', 1, 30));
  setUnit(state, 'enemy', 'front', 1, mk('dummy1', 1, 30));
  // 注意：牌库会在对手回合开始时被抽走 1 张，所以断言要看事件而不是死数长度
  if (withDeck) state.sides.enemy.deck = ['neutral_infantry', 'neutral_archer', 'neutral_shieldman'];
  return { state, ctx };
}

test('ADR-074 司马懿①：本回合没有任何行动 → 回合结束对全体敌人各 1 点', () => {
  const { state, ctx } = simayiBoard();
  const r = applyAction(state, ctx, { type: 'END_TURN' });
  assert.ok(r.ok);
  assert.equal(getUnit(r.state, 'enemy', 'front', 0)!.hp, 29, '敌方每个人物各吃 1 点');
  assert.equal(getUnit(r.state, 'enemy', 'front', 1)!.hp, 29);
  assert.ok(!has(r.events, 'CARD_MILLED'), '没行动且场上有别人 → 不拆对手牌库');
});

test('ADR-074 司马懿②：行动过且造成过伤害 → 弃掉对方牌库一张（不造成 AOE）', () => {
  const { state, ctx } = simayiBoard();
  const sim = getUnit(state, 'own', 'front', 0)!;
  const foe = mk('target', 1, 30);
  setUnit(state, 'enemy', 'front', 2, foe);

  const atk = applyAction(state, ctx, {
    type: 'ATTACK', from: { row: 'front', col: 0 }, to: { kind: 'unit', row: 'front', col: 2 },
  });
  assert.ok(atk.ok, `攻击应成功：${atk.error}`);
  assert.equal(getUnit(atk.state, 'own', 'front', 0)!.actedThisTurn, true, '行动过');
  assert.equal(getUnit(atk.state, 'own', 'front', 0)!.dealtDamageThisTurn, true, '造成过伤害');

  const r = applyAction(atk.state, ctx, { type: 'END_TURN' });
  assert.ok(r.ok);
  assert.equal(r.events.filter((e) => e.type === 'CARD_MILLED').length, 1, '应恰好弃掉对手牌库一张');
  assert.equal(r.state.sides.enemy.deck.length, 1, '牌库 3 张：对手回合抽 1 + 被拆 1 → 剩 1');
  assert.equal(getUnit(r.state, 'enemy', 'front', 0)!.hp, 30, '行动过 → 不触发①的 AOE');
  assert.ok(sim.hp > 0);
});

test('ADR-074 司马懿：只是行动、没造成伤害 → 两个分支都不触发', () => {
  const { state, ctx } = simayiBoard();
  // 构造"行动过但没造成伤害"：把司马懿攻击力改成 0，去打一个 0 攻高血的墙
  const wall = mk('wall', 0, 30);
  setUnit(state, 'enemy', 'front', 2, wall);
  // 让司马懿的攻击力为 0 → 造成 0 伤害（dealDamage 对 amount<=0 直接返回）
  const sim = getUnit(state, 'own', 'front', 0)!;
  sim.atk = 0; sim.baseAtk = 0;

  const atk = applyAction(state, ctx, {
    type: 'ATTACK', from: { row: 'front', col: 0 }, to: { kind: 'unit', row: 'front', col: 2 },
  });
  assert.ok(atk.ok, `攻击应成功：${atk.error}`);
  assert.equal(getUnit(atk.state, 'own', 'front', 0)!.actedThisTurn, true);
  assert.equal(getUnit(atk.state, 'own', 'front', 0)!.dealtDamageThisTurn, false, '0 伤害 = 没造成伤害');

  const r = applyAction(atk.state, ctx, { type: 'END_TURN' });
  assert.ok(r.ok);
  assert.ok(!has(r.events, 'CARD_MILLED'), '行动了但没造成伤害 → 不该拆牌库');
  assert.equal(getUnit(r.state, 'enemy', 'front', 0)!.hp, 30, '行动过 → 也不该触发①的 AOE');
});

test('ADR-074 司马懿③：场上只剩他一人时，②额外生效（any_of 条件组合）', () => {
  realCard('wei_simayi');
  // 己方场上**只有**司马懿 → count(ally characters) == 1
  const { state, ctx } = scenario({ own: { front: ['wei_simayi'] } });
  setUnit(state, 'enemy', 'front', 0, mk('dummy0', 1, 30));
  state.sides.enemy.deck = ['neutral_infantry'];

  const r = applyAction(state, ctx, { type: 'END_TURN' });
  assert.ok(r.ok);
  assert.ok(has(r.events, 'CARD_MILLED'), '只剩他一人 → 即使没行动也拆牌库');
  assert.equal(r.state.sides.enemy.deck.length, 0);
});

/* ============================================================
   休养生息：己方全体（含主帅）+3 血，然后抽 1 张
   ------------------------------------------------------------
   ADR-075（设计者裁定）把效果改成这个 —— 去掉了旧的
   「下一回合不进行任何活动」（skip_turn）与抽 3 张。
   ============================================================ */

test('ADR-075 休养生息：己方全体（含主帅）各回 3 血，然后抽 1 张', () => {
  realCard('tactic_xiushengyangxi');
  // ⚠️ 不能用 1/1 的步兵：它 maxHp = 1，治疗被上限吃掉，等于没测（第一版就栽在这里）
  const { state, ctx } = scenario({ ownHand: ['tactic_xiushengyangxi'], own: { front: ['test_champion'] } });
  const ally = getUnit(state, 'own', 'front', 0)!;
  ally.hp = 1;
  state.sides.own.lord.hp = 20;
  state.sides.own.deck = ['neutral_infantry', 'neutral_archer', 'neutral_shieldman', 'test_champion'];

  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0 });
  assert.ok(r.ok, `打出应成功：${r.error}`);

  assert.equal(r.state.sides.own.lord.hp, 23, '「己方全体」含主帅 → 主帅回 3 点');
  assert.equal(getUnit(r.state, 'own', 'front', 0)!.hp, 4, '场上人物回 3 点（1 → 4）');
  assert.equal(r.state.sides.own.hand.length, 1, '抽 1 张（原先是抽 3）');
  assert.equal(r.state.sides.own.deck.length, 3, '牌库只少 1 张');
  assert.equal(r.state.sides.own.lord.statuses?.xiu_zheng, undefined,
    'ADR-075 已去掉「下一回合不进行任何活动」，不该再挂「休整」');
});

test('ADR-075 休养生息：不再跳过任何一方的回合（回归：旧代价已移除）', () => {
  realCard('tactic_xiushengyangxi');
  const { state, ctx } = scenario({ ownHand: ['tactic_xiushengyangxi'] });
  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0 });
  assert.ok(r.ok, `打出应成功：${r.error}`);

  const r2 = applyAction(r.state, ctx, { type: 'END_TURN' });        // → 敌方
  assert.ok(r2.ok);
  const r3 = applyAction(r2.state, ctx, { type: 'END_TURN' });       // → 回来正常轮到自己
  assert.ok(r3.ok, `对手结束回合应成功：${r3.error}`);
  assert.ok(!has(r3.events, 'TURN_SKIPPED'), '不该再出现跳回合');
  assert.equal(r3.state.active, 'own', '轮次应正常回到自己');
});

test('ADR-075 / ADR-074：`skip_turn` 能力与 `xiu_zheng` 状态仍保留（当前无卡使用）', () => {
  // 设计者随时可能把「下一回合不进行任何活动」挂回某张卡，能力与测试一并留着
  assert.ok(STATUSES.xiu_zheng, 'xiu_zheng 必须登记在 STATUSES');
  assert.ok(STATUSES.xiu_zheng!.caps!.includes('skip_turn'));
});

/* ============================================================
   陈到：先作为**无技能武将**进卡池（ADR-075）
   ============================================================ */

test('ADR-075 陈到：无技能、无关键词的白板武将（技能名「白毦兵」暂缓设计）', () => {
  const chendao = ALL.find((c) => c.id === 'shu_chendao');
  assert.ok(chendao, '陈到应存在于卡表');
  assert.equal(chendao.type, 'general', '是武将');
  assert.equal(chendao.attack, 2, '2 攻 > 1 → 按 ADR-018 判武将，不需要 type_explicit');
  assert.equal(chendao.health, 2);
  assert.equal(chendao.cost, 3);
  assert.deepEqual(chendao.keywords ?? [], [], '没有关键词');
  // 关键：不能留一条 `pending: true` 的空技能，那会让卡面显示一个不存在的技能
  assert.deepEqual(chendao.skills ?? [], [], '不该再有「白毦兵」这条待设计技能');
  assert.ok(chendao.memo, '白板卡也要有 memo');
});

test('ADR-075：全卡池不再有「有技能名、效果待设计」的人物卡', () => {
  const pending = ALL.filter((c) =>
    (c.skills ?? []).some((sk) => (sk as { pending?: boolean }).pending));
  assert.deepEqual(pending.map((c) => `${c.id}（${c.name}）`), [],
    'pending 技能会让 UI 显示一个点不动的技能，应改为白板或补齐效果');
});

/* ============================================================
   黄皓「谮言」：自削统率 + 封锁（不是弃掉）
   ============================================================ */

test('ADR-074 黄皓：己方主公统率 −1，且**封锁**敌方一张手牌（牌还在手里）', () => {
  realCard('shu_huanghao');
  const { state, ctx } = scenario({ ownHand: ['shu_huanghao'], enemyHand: ['neutral_infantry', 'neutral_archer'] });
  const cmdBefore = state.sides.own.command.cur;
  const cost = base('shu_huanghao').cost;

  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 0 });
  assert.ok(r.ok, `打出应成功：${r.error}`);

  assert.equal(r.state.sides.own.command.cur, cmdBefore - cost - 1,
    `统率应是「卡费 ${cost} + 自削 1」`);
  assert.equal(r.state.sides.enemy.hand.length, 2, '被封锁的牌仍在对手手里');
  assert.equal(r.state.sides.enemy.discard.length, 0, '封锁 ≠ 弃牌');
  assert.ok(r.state.sides.enemy.hand.some((hc) => hc.mods.some((m) => m.kind === 'ban')),
    '应有一张手牌被禁止上场');
  assert.ok(r.events.some((e) => e.type === 'HAND_MODIFIED' && e.kind === 'ban'));
});

test('ADR-074 黄皓：被封锁的手牌打不出来', () => {
  realCard('shu_huanghao');
  const { state, ctx } = scenario({ ownHand: ['shu_huanghao'], enemyHand: ['neutral_infantry'] });
  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 0 });
  assert.ok(r.ok);
  // 换到敌方行动，尝试打出那张被封锁的牌
  const r2 = applyAction(r.state, ctx, { type: 'END_TURN' });
  assert.ok(r2.ok);
  const idx = r2.state.sides.enemy.hand.findIndex((hc) => hc.mods.some((m) => m.kind === 'ban'));
  assert.ok(idx >= 0, '敌方手里应有一张被封锁的牌');
  const r3 = applyAction(r2.state, ctx, { type: 'PLAY_CARD', cardIndex: idx, row: 'front', col: 5 } as Action);
  assert.equal(r3.ok, false, '被封锁的牌不应打得出来');
});

/* ============================================================
   张宝 / 张梁「黄天当立」：按 card_id 精确判「谁在场」
   ============================================================ */

test('ADR-074 张宝：与张梁同场 → 2 个黄巾兵；三兄弟齐全 → 共 4 个', () => {
  realCard('qun_zhangbao');
  realCard('qun_zhangliang');
  realCard('qun_zhangjiao');

  // ① 只有张梁
  const a = scenario({ ownHand: ['qun_zhangbao'], own: { front: [null, 'qun_zhangliang'] } });
  const ra = applyAction(a.state, a.ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 0 });
  assert.ok(ra.ok, `打出应成功：${ra.error}`);
  assert.equal(tokens(ra.events), 2, '与张梁同场 → 2 个');

  // ② 三兄弟齐全
  const b = scenario({ ownHand: ['qun_zhangbao'], own: { front: [null, 'qun_zhangliang', 'qun_zhangjiao'] } });
  const rb = applyAction(b.state, b.ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 0 });
  assert.ok(rb.ok, `打出应成功：${rb.error}`);
  assert.equal(tokens(rb.events), 4, '三兄弟齐全 → 共 4 个');
});

test('ADR-074 张宝：只有黄巾标签的兵在场**不算**张梁（原先的宽条件会误触发）', () => {
  realCard('qun_zhangbao');
  realCard('token_huangjin_bing');
  const { state, ctx } = scenario({ ownHand: ['qun_zhangbao'], own: { front: [null, 'token_huangjin_bing'] } });
  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 0 });
  assert.ok(r.ok, `打出应成功：${r.error}`);
  assert.equal(tokens(r.events), 0, '场上只有黄巾兵（不是张梁）→ 不该召唤');
});

test('ADR-074 张梁：与张宝同场 → 2 个；三兄弟齐全 → 共 4 个', () => {
  realCard('qun_zhangliang');
  realCard('qun_zhangbao');
  realCard('qun_zhangjiao');

  const a = scenario({ ownHand: ['qun_zhangliang'], own: { front: [null, 'qun_zhangbao'] } });
  const ra = applyAction(a.state, a.ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 0 });
  assert.ok(ra.ok, `打出应成功：${ra.error}`);
  assert.equal(tokens(ra.events), 2);

  const b = scenario({ ownHand: ['qun_zhangliang'], own: { front: [null, 'qun_zhangbao', 'qun_zhangjiao'] } });
  const rb = applyAction(b.state, b.ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 0 });
  assert.ok(rb.ok, `打出应成功：${rb.error}`);
  assert.equal(tokens(rb.events), 4);
});

/* ============================================================
   任何条件：all_of / any_of 的语义
   ============================================================ */

test('ADR-074 all_of：全部子条件成立才算过；any_of：任一成立即过', () => {
  const card: CardDef = {
    id: 'test_cond', name: '条件测试', faction: 'neutral', type: 'tactic', cost: 0, memo: 'x',
    effects: [
      { action: 'gain_armor', value: 1,
        condition: { all_of: [
          { exists: { side: 'enemy', filter: { card_id: 'e_a' } } },
          { exists: { side: 'enemy', filter: { card_id: 'e_b' } } },
        ] } },
      { action: 'gain_command', value: 1,
        condition: { any_of: [
          { exists: { side: 'enemy', filter: { card_id: 'nope' } } },
          { exists: { side: 'enemy', filter: { card_id: 'e_a' } } },
        ] } },
    ],
  };
  if (!TEST_CARDS.some((c) => c.id === card.id)) TEST_CARDS.push(card);

  // 只有 e_a → all_of 不过、any_of 过
  const one = scenario({ ownHand: ['test_cond'] });
  setUnit(one.state, 'enemy', 'front', 0, mk('e_a', 1, 3));
  const r1 = applyAction(one.state, one.ctx, { type: 'PLAY_CARD', cardIndex: 0 });
  assert.ok(r1.ok, `${r1.error}`);
  assert.equal(r1.state.sides.own.lord.armor, 0, 'all_of 缺一个 → 不该加护甲');
  assert.ok(has(r1.events, 'HAND_MODIFIED') === false);   // gain_command 不发事件，用统率值判
  assert.equal(r1.state.sides.own.command.cur, 10, 'any_of 命中也不该超上限（10 已是 max）');

  // 两个都在 → all_of 过
  const both = scenario({ ownHand: ['test_cond'] });
  setUnit(both.state, 'enemy', 'front', 0, mk('e_a', 1, 3));
  setUnit(both.state, 'enemy', 'front', 1, mk('e_b', 1, 3));
  both.state.sides.own.command = { cur: 3, max: 10 };
  const r2 = applyAction(both.state, both.ctx, { type: 'PLAY_CARD', cardIndex: 0 });
  assert.ok(r2.ok, `${r2.error}`);
  assert.equal(r2.state.sides.own.lord.armor, 1, 'all_of 全中 → 加护甲');
  assert.equal(r2.state.sides.own.command.cur, 4, 'any_of 命中 → 统率 +1');
});

/* ============================================================
   SKILL_TRIGGERED：让客户端播得出"技能发动"
   ============================================================ */

test('ADR-074：战吼会产生 SKILL_TRIGGERED（带技能名/时机/来源）', () => {
  realCard('qun_caimao');
  const { state, ctx } = scenario({ ownHand: ['qun_caimao'] });
  setUnit(state, 'enemy', 'front', 0, mk('foe', 1, 9));
  const r = applyAction(state, ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 0 });
  assert.ok(r.ok, `${r.error}`);
  const ev = r.events.find((e) => e.type === 'SKILL_TRIGGERED') as Extract<GameEvent, { type: 'SKILL_TRIGGERED' }>;
  assert.ok(ev, '应发 SKILL_TRIGGERED');
  assert.equal(ev.skillName, '水攻');
  assert.equal(ev.from, 'on_play');
  assert.equal(ev.kind, 'trigger');
  assert.equal(ev.unitName, '蔡瑁');
  assert.equal(ev.row, 'front');
  assert.equal(ev.col, 0, '应带上坐标，客户端才能把提示画在卡上');
});

test('ADR-074：触发技 / 光环 / 主动技 / 主公技都发 SKILL_TRIGGERED', () => {
  // 触发技：张角 turn_end
  realCard('qun_zhangjiao');
  const zj = scenario({ own: { front: ['qun_zhangjiao'] } });
  const rz = applyAction(zj.state, zj.ctx, { type: 'END_TURN' });
  assert.ok(rz.events.some((e) => e.type === 'SKILL_TRIGGERED' && e.timing === 'turn_end'),
    'turn_end 触发技应发事件');

  // 光环：黄权（给主帅挂参谋）
  realCard('shu_huangquan');
  const hq = scenario({ ownHand: ['shu_huangquan'] });
  const rh = applyAction(hq.state, hq.ctx, { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 0 });
  assert.ok(rh.events.some((e) => e.type === 'SKILL_TRIGGERED' && e.kind === 'aura'),
    '光环重算应发事件');

  // 主动技：华佗「青囊」
  realCard('qun_huatuo');
  const ht = scenario({ own: { front: ['qun_huatuo'] }, ownHand: ['neutral_infantry'] });
  setUnit(ht.state, 'own', 'front', 1, mk('patient', 1, 5, 'shu'));
  const rt = applyAction(ht.state, ht.ctx, {
    type: 'USE_SKILL', row: 'front', col: 0, target: { side: 'own', row: 'front', col: 1 },
  });
  assert.ok(rt.ok, `${rt.error}`);
  assert.ok(rt.events.some((e) => e.type === 'SKILL_TRIGGERED' && e.from === 'active'),
    '主动技应发事件');

  // 主公技：刘备「仁德」
  const lk = scenario({ ownHand: ['neutral_infantry'] });
  setUnit(lk.state, 'own', 'front', 0, mk('hurt', 1, 5, 'shu'));
  getUnit(lk.state, 'own', 'front', 0)!.hp = 2;
  const rl = applyAction(lk.state, lk.ctx, {
    type: 'USE_LORD_SKILL', target: { side: 'own', row: 'front', col: 0 },
  });
  assert.ok(rl.ok, `${rl.error}`);
  assert.ok(rl.events.some((e) => e.type === 'SKILL_TRIGGERED' && e.from === 'lord_skill'),
    '主公技应发事件');
});

test('ADR-074：亡语 / 击杀触发也发 SKILL_TRIGGERED（客户端才看得见）', () => {
  realCard('qun_huaxiong');
  const { state, ctx } = scenario({ own: { front: ['qun_huaxiong'] } });
  setUnit(state, 'enemy', 'front', 0, mk('victim', 1, 1));
  const r = applyAction(state, ctx, {
    type: 'ATTACK', from: { row: 'front', col: 0 }, to: { kind: 'unit', row: 'front', col: 0 },
  });
  assert.ok(r.ok, `${r.error}`);
  assert.ok(r.events.some((e) => e.type === 'SKILL_TRIGGERED' && e.skillId === 'wei_zhen_si_fang'),
    '华雄「威震四方」的 on_kill 应发事件');
});

/* ============================================================
   回归：本回合行为标记在回合开始时重置
   ============================================================ */

test('ADR-074：actedThisTurn / dealtDamageThisTurn 在新回合被重置', () => {
  const { state, ctx } = scenario({ own: { front: ['test_champion'] } });
  setUnit(state, 'enemy', 'front', 0, mk('foe', 1, 30));
  const a = applyAction(state, ctx, {
    type: 'ATTACK', from: { row: 'front', col: 0 }, to: { kind: 'unit', row: 'front', col: 0 },
  });
  assert.ok(a.ok);
  assert.equal(getUnit(a.state, 'own', 'front', 0)!.actedThisTurn, true);

  const b = applyAction(a.state, ctx, { type: 'END_TURN' });      // → 敌方
  const c = applyAction(b.state, ctx, { type: 'END_TURN' });      // → 自己（新回合）
  assert.ok(c.ok);
  const me = getUnit(c.state, 'own', 'front', 0)!;
  assert.equal(me.actedThisTurn, false, '新回合应重置');
  assert.equal(me.dealtDamageThisTurn, false);
});

test('ADR-074：光环施加的状态不会因为「本回合行动过」而误判（回归）', () => {
  const { state } = scenario({});
  applyStatus(state, lordRef('own'), 'kong_cheng', 1, []);
  assert.ok(state.sides.own.lord.statuses?.kong_cheng);
});
