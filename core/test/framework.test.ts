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
import { autoDeck, cardPool, validateDeck, MAX_COPIES, PLAYABLE_FACTIONS } from '../src/deck.ts';
import { mulligan, setupMatch } from '../src/setup.ts';
import { rollFirstSide, YUXI_ID } from '../src/state.ts';
import { loadData } from '../src/loader.ts';
import { createRng } from '../src/rng.ts';
import type { Action, CardDef, Faction, LordDef } from '../src/types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (f: string): unknown => JSON.parse(readFileSync(join(ROOT, 'data', f), 'utf8'));
const CARDS = load('cards.json') as CardDef[];
const HEROES = load('heroes.json') as LordDef[];

const data = loadData({ cards: CARDS, heroes: HEROES }, {
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

/* ============================================================
   ④ 完整对局闭环
   ============================================================ */

test('全流程：setupMatch → startMatch → 打满一局 → 有胜者', async () => {
  const { chooseAction } = await import('../src/ai.ts');
  const { state } = setupMatch({
    seed: 2026, cards: data.cards, lords: data.lords,
    decks: { own: autoDeck(data, 'shu'), enemy: autoDeck(data, 'wei') },
    mulliganIndices: { own: [0], enemy: [] },
  });
  const ctx = { cards: data.cards, lords: data.lords };
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
    });
    const ctx = { cards: data.cards, lords: data.lords };
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

/* ============================================================
   ⑦ 主公与主公技（ADR-049：数据驱动 / 2 统率 / 群雄公共池）
   ============================================================ */

test('主公：三位主公的主公技都从数据读取，费用统一 2', () => {
  const ids = ['shu_liubei', 'wei_caocao', 'wu_sunquan'];
  for (const id of ids) {
    const l = data.lords.own.id === id ? data.lords.own : data.cards.get(id);
    assert.ok(l, `${id} 应存在`);
    assert.equal(l!.type, 'lord', `${id} 应为 lord 类型（不是人物卡）`);
    const sk = (l as { skills?: Array<{ kind: string; cost?: number; frequency?: string }> }).skills?.[0];
    assert.ok(sk, `${id} 应有 skills[0]`);
    assert.equal(sk!.kind, 'active');
    assert.equal(sk!.cost, 2, `${id} 主公技应为 2 统率`);
    assert.equal(sk!.frequency, 'once_per_turn');
  }
});

test('主公：群雄不设主公（heroes.yaml 里没有群雄）', () => {
  const heroes = HEROES;
  assert.equal(heroes.length, 3, `应只有 3 位主公，实际 ${heroes.length}`);
  assert.ok(!heroes.some((h) => h.faction === 'qun'), '不应有群雄主公');
});

test('组卡：群雄是公共池，三个阵营都能选用', () => {
  for (const f of ['shu', 'wei', 'wu'] as Faction[]) {
    const pool = cardPool(data, f);
    assert.ok(pool.some((c) => c.faction === 'qun'), `${f} 应能用群雄卡`);
    const d = autoDeck(data, f);
    assert.equal(validateDeck(data, f, d).ok, true);
  }
  // 群雄不是可选阵营
  assert.ok(!(PLAYABLE_FACTIONS as readonly string[]).includes('qun'), '群雄不可选为阵营');
});

test('卡池：cards.yaml 里不再有 type=lord 的卡（主公数据统一在 heroes.yaml）', () => {
  // 注意：运行时 data.cards 会并入 heroes（loadData 的行为），所以要查 cards.json 本身
  const lords = CARDS.filter((c) => c.type === 'lord');
  assert.equal(lords.length, 0, `cards.yaml 不应含 lord 卡，实际 ${lords.map((c) => c.id).join(',')}`);
  // 而运行时仍能按 id 取到主公（引擎要用）
  assert.ok(data.cards.get('wu_sunquan'), '运行时应能取到主公');
});

test('主公技·坐断东南：指定手牌洗回牌组随机位置，再随机抽 1 张', async () => {
  const { applyAction } = await import('../src/engine.ts');
  const { createMatch } = await import('../src/state.ts');
  // 必须走 loadData 拿主公（skillDef 是 loadData 从 skills[0] 接上的）
  const wu = loadData({ cards: CARDS, heroes: HEROES }, { own: 'wu_sunquan', enemy: 'wei_caocao' });
  const sunquan = wu.lords.own;
  const base = createMatch({
    seed: 3, cards: wu.cards,
    lords: { own: sunquan, enemy: wu.lords.enemy },
    // 牌库要够大：createMatch 会从牌库发起手，之后「抽 1 张」还要有牌可抽
    decks: { own: Array(10).fill('shu_guanyu').concat(Array(10).fill('shu_zhangfei')), enemy: [] },
    firstSide: 'own',
  });
  const ctx = { cards: wu.cards, lords: { own: sunquan, enemy: wu.lords.enemy } };
  let s = startMatch(base, ctx).state;
  s.sides.own.command.cur = 10;
  while (s.sides.own.hand.length < 3 && s.sides.own.deck.length) {
    const id = s.sides.own.deck.pop()!;
    s.sides.own.hand.push({ card: wu.cards.get(id)!, mods: [] });
  }
  const picked = s.sides.own.hand[0]!.card.id;
  const handBefore = s.sides.own.hand.length;
  const deckBefore = s.sides.own.deck.length;

  const r = applyAction(s, ctx, { type: 'USE_LORD_SKILL', handIndex: 0 });
  assert.equal(r.ok, true);
  const st = r.state.sides.own;
  // 置换 ≠ 弃牌：指定的牌应回到牌组（可再抽到），而不是进弃牌堆
  assert.ok(st.deck.includes(picked), `指定的 ${picked} 应回到牌组`);
  assert.ok(!st.discard.some((c) => c.id === picked), '不应进弃牌堆');
  assert.equal(st.hand.length, handBefore, '回 1 张抽 1 张 → 手牌数不变');
  assert.equal(st.deck.length, deckBefore, '牌组张数也不变');
  assert.equal(st.command.cur, 8, '消耗 2 统率');
  assert.ok(r.events.some((e) => e.type === 'CARD_RETURNED_TO_DECK'), '应产生回牌组事件');
});

/* ============================================================
   ⑧ 袁绍与「万箭齐发」（ADR-050：塞牌进牌库 / 抽到时释放）
   ============================================================ */

function qun() {
  return loadData({ cards: CARDS, heroes: HEROES }, { own: 'shu_liubei', enemy: 'wei_caocao' });
}

test('袁绍：6 费 3/6 普通人物卡，三个技能（每回合召唤/战吼/亡语）', () => {
  const ys = CARDS.find((c) => c.id === 'qun_yuanshao');
  assert.ok(ys, '袁绍应在卡池里');
  assert.equal(ys!.type, 'general', '应为普通人物卡，不是主公');
  assert.equal(ys!.cost, 6);
  assert.equal(ys!.attack, 3);
  assert.equal(ys!.health, 6);
  const triggers = (ys!.skills ?? []).map((s) => s.trigger);
  assert.deepEqual(triggers, ['turn_start', 'on_play', 'on_death']);
});

test('袁绍战吼：获得 1 张 + 加入牌组 2 张「万箭齐发」', async () => {
  const { applyAction } = await import('../src/engine.ts');
  const { createMatch } = await import('../src/state.ts');
  const d = qun();
  const base = createMatch({ seed: 5, cards: d.cards, lords: d.lords, decks: { own: [], enemy: [] }, firstSide: 'own' });
  const ctx = { cards: d.cards, lords: d.lords };
  let s = startMatch(base, ctx).state;
  s.sides.own.command.cur = 10;
  s.sides.own.hand.push({ card: d.cards.get('qun_yuanshao')!, mods: [] });
  const idx = s.sides.own.hand.length - 1;
  const r = applyAction(s, ctx, { type: 'PLAY_CARD', cardIndex: idx, row: 'front', col: 0 });
  assert.equal(r.ok, true);
  const n = r.state.sides.own.deck.filter((x) => x === 'tactic_wanjianqifa').length;
  assert.equal(n, 3, `牌组里应有 3 张万箭齐发（1+2），实际 ${n}`);
});

test('万箭齐发：抽到时自动释放（不进手牌），对全体敌方人物各 1 点伤害', async () => {
  const { applyAction } = await import('../src/engine.ts');
  const { createMatch, setUnit, getUnit, makeUnit } = await import('../src/state.ts');
  const d = qun();
  const base = createMatch({ seed: 5, cards: d.cards, lords: d.lords, decks: { own: [], enemy: [] }, firstSide: 'own' });
  const ctx = { cards: d.cards, lords: d.lords };
  let s = startMatch(base, ctx).state;
  setUnit(s, 'enemy', 'front', 0, makeUnit(d.cards.get('shu_guanyu')!, 1, 900));   // 4/4
  setUnit(s, 'enemy', 'front', 1, makeUnit(d.cards.get('shu_zhangfei')!, 1, 901)); // 4/4
  s.sides.own.deck = ['tactic_wanjianqifa'];
  const handBefore = s.sides.own.hand.length;

  // 交出行动权（敌方回合）再交回（己方回合开始抽牌）——万箭齐发在己方抽牌时释放
  const r1 = applyAction(s, ctx, { type: 'END_TURN' });
  assert.equal(r1.ok, true);
  const r2 = applyAction(r1.state, ctx, { type: 'END_TURN' });
  assert.equal(r2.ok, true);
  const r = { state: r2.state, events: [...r1.events, ...r2.events] };
  const cur = r.state;
  const cast = r.events.filter((e) => e.type === 'CARD_AUTO_CAST');
  assert.equal(cast.length, 1, '万箭齐发应自动释放 1 次');
  assert.equal(cur.sides.own.hand.length, handBefore, '自动释放的牌不进手牌');
  assert.ok(cur.sides.own.discard.some((c) => c.id === 'tactic_wanjianqifa'), '应进弃牌堆');
  assert.equal(getUnit(cur, 'enemy', 'front', 0)!.hp, 3, '关羽 4 → 3');
  assert.equal(getUnit(cur, 'enemy', 'front', 1)!.hp, 3, '张飞 4 → 3');
});

test('袁绍亡语：把牌组里**未抽到**的万箭齐发全部塞进敌方牌库', async () => {
  const { createMatch, setUnit, getUnit, makeUnit } = await import('../src/state.ts');
  const { killUnit } = await import('../src/mutate.ts');
  const d = qun();
  const base = createMatch({ seed: 5, cards: d.cards, lords: d.lords, decks: { own: [], enemy: [] }, firstSide: 'own' });
  const ctx = { cards: d.cards, lords: d.lords };
  const s = startMatch(base, ctx).state;
  setUnit(s, 'own', 'front', 0, makeUnit(d.cards.get('qun_yuanshao')!, 1, 902));
  // 牌组里留 2 张未抽到的
  s.sides.own.deck = ['tactic_wanjianqifa', 'shu_guanyu', 'tactic_wanjianqifa'];
  const enemyBefore = s.sides.enemy.deck.filter((x) => x === 'tactic_wanjianqifa').length;

  const me = getUnit(s, 'own', 'front', 0)!;
  killUnit(s, d.cards, { side: 'own', row: 'front', col: 0, unit: me }, []);

  assert.equal(s.sides.own.deck.filter((x) => x === 'tactic_wanjianqifa').length, 0,
    '己方牌组里未抽到的应被搬走');
  assert.equal(s.sides.enemy.deck.filter((x) => x === 'tactic_wanjianqifa').length, enemyBefore + 2,
    '应全部进入敌方牌库');
  assert.ok(s.sides.own.deck.includes('shu_guanyu'), '不该动其它牌');
});

test('仁德：可指定**敌方**人物回血（设计者裁定「任何人物」）', async () => {
  const { applyAction } = await import('../src/engine.ts');
  const { createMatch, setUnit, getUnit, makeUnit } = await import('../src/state.ts');
  const d = qun();
  const base = createMatch({ seed: 5, cards: d.cards, lords: d.lords, decks: { own: [], enemy: [] }, firstSide: 'own' });
  const ctx = { cards: d.cards, lords: d.lords };
  let s = startMatch(base, ctx).state;
  s.sides.own.command.cur = 10;
  const foe = makeUnit(d.cards.get('shu_guanyu')!, 1, 903);
  foe.hp = 1;
  setUnit(s, 'enemy', 'front', 0, foe);

  const r = applyAction(s, ctx, { type: 'USE_LORD_SKILL', target: { side: 'enemy', row: 'front', col: 0 } });
  assert.equal(r.ok, true);
  assert.equal(getUnit(r.state, 'enemy', 'front', 0)!.hp, 3, '敌方人物也能被治疗 1 → 3');
});
