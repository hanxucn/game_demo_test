/**
 * 游戏框架测试：组卡 → 起牌 → 对战 → 技能释放 → 结束
 *
 * 对应 docs/gdd/03-turn-flow.md §1 的开局流程与 §2 的回合结构。
 * 这里测的是**框架闭环**，不是单张卡的机制（后者见 cards-v1.test.ts / dsl.test.ts）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { applyAction, startMatch } from '../src/engine.ts';
import { autoDeck, cardPool, validateDeck, MAX_COPIES } from '../src/deck.ts';
import { mulligan, offerJiuling, setupMatch } from '../src/setup.ts';
import { rollFirstSide, YUXI_ID } from '../src/state.ts';
import { checkJiuling } from '../src/jiuling.ts';
import { loadData } from '../src/loader.ts';
import { createRng } from '../src/rng.ts';
import type { Action, CardDef, Faction, JiulingDef, LordDef } from '../src/types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (f: string): unknown => JSON.parse(readFileSync(join(ROOT, 'data', f), 'utf8'));
const CARDS = load('cards.json') as CardDef[];
const HEROES = load('heroes.json') as LordDef[];
const JIULING = load('jiuling.json') as JiulingDef[];

const data = loadData({ cards: CARDS, heroes: HEROES, jiuling: JIULING }, {
  own: 'shu_liubei', enemy: 'wei_caocao',
});

/* ============================================================
   ① 组卡
   ============================================================ */

test('组卡：四个阵营都能自动组出合法 30 张卡组', () => {
  for (const f of ['shu', 'wei', 'wu', 'qun'] as Faction[]) {
    const deck = autoDeck(data, f);
    assert.equal(deck.length, 30, `${f} 卡组张数`);
    const r = validateDeck(data, f, deck);
    assert.equal(r.ok, true, `${f} 卡组应合法：${r.errors.map((e) => e.message).join(';')}`);
  }
});

test('组卡：同名上限 2 张', () => {
  const pool = cardPool(data, 'shu');
  const one = pool.find((c) => c.faction === 'shu')!;
  const over = Array(3).fill(one.id).concat(Array(27).fill(pool.find((c) => c.id !== one.id)!.id));
  const r = validateDeck(data, 'shu', over);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.kind === 'copies'), '应报同名超限');
});

test('组卡：混阵营卡组被拒绝（GDD 01 §7）', () => {
  const shu = cardPool(data, 'shu').filter((c) => c.faction === 'shu').slice(0, 20);
  const wei = cardPool(data, 'wei').filter((c) => c.faction === 'wei').slice(0, 10);
  const mixed = [...shu, ...wei].map((c) => c.id);
  const r = validateDeck(data, 'shu', mixed);
  assert.ok(r.errors.some((e) => e.kind === 'faction'), '应报跨阵营');
});

test('组卡：中立卡可进任何阵营卡组', () => {
  const neutral = cardPool(data, 'qun').filter((c) => c.faction === 'neutral');
  assert.ok(neutral.length > 0, '中立池不应为空');
  const deck = autoDeck(data, 'qun');
  assert.ok(deck.some((id) => data.cards.get(id)!.faction === 'neutral'), 'qun 卡组应含中立卡');
});

test('组卡：主公卡 / 衍生物 / 精英卡不可组入卡组', () => {
  for (const id of ['shu_liubei', 'token_shizu_bing', 'elite_baima_yicong']) {
    const c = data.cards.get(id);
    assert.ok(c, `${id} 应存在于卡表`);
    const r = validateDeck(data, 'shu', [id]);
    assert.equal(r.ok, false, `${id} 不应可组`);
  }
});

test('组卡：自动卡组不违反同名上限，且不含主公/衍生物', () => {
  for (const f of ['shu', 'wei', 'wu', 'qun'] as Faction[]) {
    const deck = autoDeck(data, f);
    const count = new Map<string, number>();
    for (const id of deck) count.set(id, (count.get(id) ?? 0) + 1);
    for (const [id, n] of count) {
      assert.ok(n <= MAX_COPIES, `${f} 的 ${id} 出现 ${n} 次`);
      const t = data.cards.get(id)!.type;
      assert.ok(!['lord', 'token', 'elite', 'status', 'special'].includes(t),
        `${f} 卡组不应含 ${t} 卡 ${id}`);
    }
  }
});

/* ============================================================
   ② 起牌（掷点 / 换牌 / 玉玺 / 酒令）
   ============================================================ */

test('起手：掷点定先手，且结果确定可复现', () => {
  const a = rollFirstSide(createRng(7));
  const b = rollFirstSide(createRng(7));
  assert.deepEqual(a, b, '同一 seed 的掷点必须一致');
  assert.ok(['own', 'enemy'].includes(a.side));
  assert.notEqual(a.own, a.enemy, '平局应重掷');
});

test('起手：先手 3 张 / 后手 4 张 + 传国玉玺（GDD 03 §1.2）', () => {
  const { state } = setupMatch({
    seed: 3, cards: data.cards, lords: data.lords,
    decks: { own: autoDeck(data, 'shu'), enemy: autoDeck(data, 'wei') },
  });
  const first = state.active;
  const second = first === 'own' ? 'enemy' : 'own';
  // 换牌前的手牌数（换牌不改变张数）
  const firstHand = state.sides[first].hand.length;
  const secondHand = state.sides[second].hand.length;
  assert.equal(firstHand, 3, '先手起手 3 张');
  assert.ok(secondHand >= 4, '后手起手至少 4 张（+玉玺）');
});

test('起手：后手拿到传国玉玺', () => {
  const { state } = setupMatch({
    seed: 11, cards: data.cards, lords: data.lords,
    decks: { own: autoDeck(data, 'shu'), enemy: autoDeck(data, 'wei') },
  });
  const second = state.active === 'own' ? 'enemy' : 'own';
  assert.ok(state.sides[second].hand.some((h) => h.card.id === YUXI_ID), '后手应有传国玉玺');
  const first = state.active;
  assert.ok(!state.sides[first].hand.some((h) => h.card.id === YUXI_ID), '先手不应有玉玺');
});

test('换牌：换掉 N 张则补 N 张，手牌数不变，且只能用一次', () => {
  const { state } = setupMatch({
    seed: 5, cards: data.cards, lords: data.lords,
    decks: { own: autoDeck(data, 'shu'), enemy: autoDeck(data, 'wei') },
  });
  const before = state.sides.own.hand.length;
  const r = mulligan(state, 'own', [0, 1], data.cards);
  assert.equal(r.ok, true, r.reason ?? '');
  assert.equal(r.replaced.length, 2);
  assert.equal(r.drawn.length, 2);
  assert.equal(r.state.sides.own.hand.length, before, '换牌不改变手牌数');

  const again = mulligan(r.state, 'own', [0], data.cards);
  assert.equal(again.ok, false, '每方只能换一次牌');
});

test('换牌：空数组 = 不换，但机会被用掉', () => {
  const { state } = setupMatch({
    seed: 6, cards: data.cards, lords: data.lords,
    decks: { own: autoDeck(data, 'shu'), enemy: autoDeck(data, 'wei') },
  });
  const r = mulligan(state, 'enemy', [], data.cards);
  assert.equal(r.ok, true);
  assert.equal(r.state.sides.enemy.hand.length, state.sides.enemy.hand.length);
  assert.equal(mulligan(r.state, 'enemy', [0], data.cards).ok, false);
});

test('换牌：下标越界被拒绝', () => {
  const { state } = setupMatch({
    seed: 6, cards: data.cards, lords: data.lords,
    decks: { own: autoDeck(data, 'shu'), enemy: autoDeck(data, 'wei') },
  });
  const r = mulligan(state, 'own', [99], data.cards);
  assert.equal(r.ok, false);
  assert.match(r.reason ?? '', /越界/);
});

test('酒令：三选一候选来自全部酒令且可复现', () => {
  const ids = JIULING.map((j) => j.id);
  const a = offerJiuling(ids, 42, 'own');
  const b = offerJiuling(ids, 42, 'own');
  assert.deepEqual(a, b, '同 seed 候选必须一致');
  assert.equal(a.length, 3);
  for (const id of a) assert.ok(ids.includes(id));
});

test('酒令数据自洽：hook / memo / 代价限制齐全', () => {
  assert.equal(JIULING.length, 4, 'v1 应提供 4 个酒令（GDD 11 §3.1）');
  for (const j of JIULING) {
    assert.deepEqual(checkJiuling(j), [], `${j.id} 数据不合格`);
  }
});

/* ============================================================
   ③ 酒令 hook 生效
   ============================================================ */

function withJiuling(id: string, seed = 21) {
  return setupMatch({
    seed, cards: data.cards, lords: data.lords,
    decks: { own: autoDeck(data, 'shu'), enemy: autoDeck(data, 'wei') },
    jiulings: { own: id },
    jiulingDefs: data.jiulings,
    firstSide: 'own',                                  // 测试固定先手，避免掷点造成分支
  });
}

test('酒令·温酒斩华雄：每回合第一张武将费用 −1', () => {
  const { state } = withJiuling('jiuling_wenjiu');
  const ctx = { cards: data.cards, lords: data.lords, jiulings: data.jiulings };
  const s = startMatch(state, ctx).state;
  assert.equal(s.active, 'own', '测试固定 own 先手');
  const idx = s.sides.own.hand.findIndex((h) => h.card.type === 'general' && h.card.cost >= 1);
  assert.ok(idx >= 0, `起手应有 ≥1 费武将，实际手牌：${s.sides.own.hand.map((h) => h.card.name).join('、')}`);
  const card = s.sides.own.hand[idx]!.card;
  // 先把统率值拉满，确保费用不是瓶颈
  const rich = structuredClone(s);
  rich.sides.own.command.cur = 10;
  const r = applyAction(rich, ctx, { type: 'PLAY_CARD', cardIndex: idx, row: 'front', col: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.state.sides.own.command.cur, 10 - Math.max(0, card.cost - 1),
    '第一张武将应按 −1 费结算');
  const ev = r.events.find((e) => e.type === 'JIULING_TRIGGERED');
  assert.ok(ev, '应产生酒令触发事件');
});

test('酒令·温酒斩华雄：每回合只惠及第一张', () => {
  const { state } = withJiuling('jiuling_wenjiu');
  const ctx = { cards: data.cards, lords: data.lords, jiulings: data.jiulings };
  const s = structuredClone(startMatch(state, ctx).state);
  s.sides.own.command.cur = 10;
  const generals = s.sides.own.hand
    .map((h, i) => ({ h, i }))
    .filter((x) => x.h.card.type === 'general' && x.h.card.cost >= 1);
  if (generals.length < 2) return;                      // 起手武将不足则跳过
  const c0 = generals[0]!.h.card;
  const r1 = applyAction(s, ctx, { type: 'PLAY_CARD', cardIndex: generals[0]!.i, row: 'front', col: 0 });
  assert.equal(r1.ok, true);
  assert.equal(r1.state.sides.own.command.cur, 10 - Math.max(0, c0.cost - 1));
  // 第二张武将：折扣额度已用完，应原价
  const after = r1.state;
  after.sides.own.command.cur = 10;
  const idx2 = after.sides.own.hand.findIndex((h) => h.card.type === 'general');
  if (idx2 < 0) return;
  const c1 = after.sides.own.hand[idx2]!.card;
  const r2 = applyAction(after, ctx, { type: 'PLAY_CARD', cardIndex: idx2, row: 'back', col: 0 });
  assert.equal(r2.ok, true);
  assert.equal(r2.state.sides.own.command.cur, 10 - c1.cost, '第二张武将应原价');
});

test('酒令·青梅煮酒：每回合第一次受到的伤害 −1', async () => {
  const { dealDamage, lordRef } = await import('../src/mutate.ts');
  const { state } = withJiuling('jiuling_qingmei');
  const ctx = { cards: data.cards, lords: data.lords, jiulings: data.jiulings };
  const s = structuredClone(startMatch(state, ctx).state);
  // 青梅煮酒挂在 own 身上 → 减免 own 受到的伤害
  const before = s.sides.own.lord.hp;

  dealDamage(s, data.cards, lordRef('own'), 3, [], 'test', 0, data.jiulings);
  assert.equal(s.sides.own.lord.hp, before - 2, '第一次伤害应被减免 1');

  dealDamage(s, data.cards, lordRef('own'), 3, [], 'test', 0, data.jiulings);
  assert.equal(s.sides.own.lord.hp, before - 5, '同一回合第二次伤害不再减免');
});

test('酒令·煮酒论英雄：开局注入一张本阵营最高费卡到手上，并被 ban 到第 5 回合', () => {
  const { state } = withJiuling('jiuling_zhujiu');
  const hand = state.sides.own.hand;
  const injected = hand.filter((h) => h.mods.some((m) => m.kind === 'ban'));
  assert.equal(injected.length, 1, '应恰好注入一张被 ban 的卡');

  const hc = injected[0]!;
  const ban = hc.mods.find((m) => m.kind === 'ban')!;
  assert.equal(ban.turns, 4, `unlock_turn=5 → ban 4 回合，实际 ${ban.turns}`);

  // 注入的应是本阵营费用最高的可组卡
  const ownPool = cardPool(data, 'shu').filter((c) => c.faction === 'shu');
  const maxCost = Math.max(...ownPool.map((c) => c.cost));
  assert.equal(hc.card.cost, maxCost, `注入卡费用应为本阵营最高 ${maxCost}`);
  assert.equal(hc.card.faction, 'shu');
});

test('酒令·煮酒论英雄：被 ban 期间无法打出，解禁后可打出', () => {
  const { state } = withJiuling('jiuling_zhujiu');
  const ctx = { cards: data.cards, lords: data.lords, jiulings: data.jiulings };
  let s = startMatch(state, ctx).state;

  const findIdx = (st: typeof s): number =>
    st.sides.own.hand.findIndex((h) => h.mods.some((m) => m.kind === 'ban'));

  // 被 ban：即使统率值充足也应被拒
  if (s.active === 'own') {
    const i = findIdx(s);
    assert.ok(i >= 0, '起手应持有被 ban 的注入卡');
    s.sides.own.command.cur = 10;
    const r = applyAction(s, ctx, { type: 'PLAY_CARD', cardIndex: i, row: 'front', col: 0 });
    assert.equal(r.ok, false, '被 ban 的卡不应能打出');
  }
});

test('酒令·对酒当歌：回合开始多抽 1 张再弃 1 张', () => {
  const { state } = withJiuling('jiuling_duijiu');
  const ctx = { cards: data.cards, lords: data.lords, jiulings: data.jiulings };
  const s = startMatch(state, ctx).state;
  const ev = s.turn >= 1;
  assert.ok(ev);
  const triggered = s.sides[s.active].jiulingUsed['jiuling_duijiu:draw'] ?? 0;
  assert.equal(triggered, 1, '本回合应触发一次「对酒当歌」');
});

/* ============================================================
   ④ 完整对局闭环
   ============================================================ */

test('全流程：setupMatch → startMatch → 打满一局 → 有胜者', async () => {
  const { chooseAction } = await import('../src/ai.ts');
  const { state } = setupMatch({
    seed: 2026, cards: data.cards, lords: data.lords,
    decks: { own: autoDeck(data, 'shu'), enemy: autoDeck(data, 'wei') },
    jiulings: { own: 'jiuling_wenjiu', enemy: 'jiuling_qingmei' },
    jiulingDefs: data.jiulings,
    mulliganIndices: { own: [0], enemy: [] },
  });
  const ctx = { cards: data.cards, lords: data.lords, jiulings: data.jiulings };
  let s = startMatch(state, ctx).state;

  let guard = 0;
  while (!s.winner && guard < 4000) {
    // chooseAction 返回 null = 无牌可出/无攻击可做 → 结束回合
    const a: Action = chooseAction(s, ctx) ?? { type: 'END_TURN' };
    const r = applyAction(s, ctx, a);
    assert.equal(r.ok, true, `第 ${guard} 步被拒：${JSON.stringify(a)} — ${r.error ?? ''}`);
    s = r.state;
    guard += 1;
  }
  assert.ok(guard < 4000, '对局应在有限步内结束（无死循环）');
  assert.ok(guard > 20, `对局不该几步就结束，实际 ${guard} 步`);
  assert.ok(s.winner, `对局应产生胜者，实际 winner=${s.winner} turn=${s.turn}`);
  assert.ok(['own', 'enemy', 'draw'].includes(s.winner!));
});

/* ============================================================
   ⑤ 结束：胜负摘要
   ============================================================ */

test('结束：未结束的对局 reason 为「未结束」', async () => {
  const { summarizeMatch } = await import('../src/result.ts');
  const { state } = setupMatch({
    seed: 1, cards: data.cards, lords: data.lords,
    decks: { own: autoDeck(data, 'shu'), enemy: autoDeck(data, 'wei') },
  });
  const sum = summarizeMatch(state);
  assert.equal(sum.reason, '未结束');
  assert.equal(sum.winnerName, '—');
  assert.equal(sum.sides.own.lordHp, 30);
});

test('结束：主将阵亡 → reason「主将阵亡」且摘要含双方数据', async () => {
  const { summarizeMatch, formatSummary } = await import('../src/result.ts');
  const { dealDamage, lordRef } = await import('../src/mutate.ts');
  const { state } = setupMatch({
    seed: 1, cards: data.cards, lords: data.lords,
    decks: { own: autoDeck(data, 'shu'), enemy: autoDeck(data, 'wei') },
  });
  const ctx = { cards: data.cards, lords: data.lords };
  const s = structuredClone(startMatch(state, ctx).state);
  const events: import('../src/types.ts').GameEvent[] = [];
  dealDamage(s, data.cards, lordRef('enemy'), 99, events, 'test');

  assert.equal(s.winner, 'own', '敌方主将阵亡 → 己方胜');
  const sum = summarizeMatch(s);
  assert.equal(sum.result, 'own');
  assert.equal(sum.reason, '主将阵亡');
  assert.equal(sum.sides.enemy.lordHp, 0);
  assert.equal(sum.sides.enemy.damageTaken, 30);
  assert.ok(events.some((e) => e.type === 'GAME_OVER'), '应产生 GAME_OVER 事件');
  assert.match(formatSummary(sum), /胜/);
});

/* ============================================================
   ⑥ 卡数据正确性回归（docs/balance-backlog.md 报告的问题）
   ============================================================ */

test('回归·华雄「威震四方」：只震慑一名目标，不再双次结算', () => {
  const hx = data.cards.get('qun_huaxiong');
  assert.ok(hx, '华雄应存在于卡表');
  const effs = (hx.skills ?? []).flatMap((sk) => sk.effects ?? []);
  // ADR-047：原文「指定一名敌人物」，原先两条分支会各选一个目标各震慑一次（低价目标被双重结算）
  assert.equal(effs.length, 1, `应合并为单条震慑，实际 ${effs.length} 条`);
  const e = effs[0]!;
  assert.equal(e.action, 'apply_status');
  assert.equal(e.status, 'zhen_she');
  assert.equal(e.target?.count, 1, '只作用于一个目标');
  assert.equal(e.target?.filter?.cost_min, undefined, '不应再有互斥的 cost 分支');
  assert.equal(e.target?.filter?.cost_below_source, undefined, '不应再有互斥的 cost 分支');
  assert.equal(e.chance, 0.75, '概率按「低于华雄必中 / 否则半概率」的期望值折算');
});

test('主动技频率：0 费主动技每回合只能用 1 次（GDD 10 §1.1）', () => {
  // 用真实数据里一个 0 费主动技的卡：华佗「青囊」
  const huatuo = data.cards.get('qun_huatuo');
  assert.ok(huatuo, '华佗应存在');
  const sk = (huatuo.skills ?? []).find((s) => s.kind === 'active');
  assert.ok(sk, '华佗应有主动技');
  assert.equal(sk!.cost ?? 0, 0, '青囊是 0 费主动技');
  assert.equal(sk!.frequency ?? 'once_per_turn', 'once_per_turn');
});

test('全流程：0 费主动技在场也不会无限循环（回归 ADR-047）', async () => {
  const { chooseAction } = await import('../src/ai.ts');
  // seed=7 曾让 AI 反复使用 0 费主动技，把对局卡在第 10 回合 4000 步
  for (const seed of [7, 11, 2026, 99]) {
    const { state } = setupMatch({
      seed, cards: data.cards, lords: data.lords,
      decks: { own: autoDeck(data, 'shu'), enemy: autoDeck(data, 'wu') },
      jiulings: { own: 'jiuling_wenjiu', enemy: 'jiuling_qingmei' },
      jiulingDefs: data.jiulings,
    });
    const ctx = { cards: data.cards, lords: data.lords, jiulings: data.jiulings };
    let s = startMatch(state, ctx).state;
    let n = 0;
    while (!s.winner && n < 3000) {
      const a: Action = chooseAction(s, ctx) ?? { type: 'END_TURN' };
      const r = applyAction(s, ctx, a);
      assert.equal(r.ok, true, `seed=${seed} 第 ${n} 步被拒：${JSON.stringify(a)}`);
      s = r.state;
      n += 1;
    }
    assert.ok(n < 3000, `seed=${seed} 对局未在有限步内结束（${n} 步，turn=${s.turn}）`);
  }
});
