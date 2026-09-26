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
import { autoDeck, cardPool, validateDeck, maxCopiesOf, PLAYABLE_FACTIONS } from '../src/deck.ts';
import { mulligan, setupMatch } from '../src/setup.ts';
import { rollFirstSide } from '../src/state.ts';
import { loadData } from '../src/loader.ts';
import { canAttack } from '../src/rules.ts';
import { COMMAND } from '../src/constants.ts';
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
      const cap = maxCopiesOf(data.cards.get(id));
      assert.ok(n <= cap, `${f} 的 ${id} 出现 ${n} 次（上限 ${cap}）`);
      const t = data.cards.get(id)!.type;
      assert.ok(!['lord', 'token', 'elite', 'status', 'special'].includes(t),
        `${f} 卡组不应含 ${t} 卡 ${id}`);
    }
  }
});

/* ============================================================
   ② 起牌（掷点 / 换牌 / 后手补偿）
   ============================================================ */

test('起手：掷点定先手，且结果确定可复现', () => {
  const a = rollFirstSide(createRng(7));
  const b = rollFirstSide(createRng(7));
  assert.deepEqual(a, b, '同一 seed 的掷点必须一致');
  assert.ok(['own', 'enemy'].includes(a.side));
  assert.notEqual(a.own, a.enemy, '平局应重掷');
});

test('起手：先手 3 张 / 后手 4 张（GDD 03 §1.2）', () => {
  const { state } = setupMatch({
    seed: 3, cards: data.cards, lords: data.lords,
    decks: { own: autoDeck(data, 'shu'), enemy: autoDeck(data, 'wei') },
  });
  const first = state.active;
  const second = first === 'own' ? 'enemy' : 'own';
  assert.equal(state.sides[first].hand.length, 3, '先手起手 3 张');
  assert.equal(state.sides[second].hand.length, 4, '后手起手 4 张');
});

test('后手补偿·多抽 1 张（ADR-053）：后手第 1 回合抽 2 张', () => {
  const mk = (comp: 'none' | 'extra_draw') => setupMatch({
    seed: 3, cards: data.cards, lords: data.lords,
    decks: { own: autoDeck(data, 'shu'), enemy: autoDeck(data, 'wei') },
    secondCompensation: comp,
  }).state;
  for (const comp of ['none', 'extra_draw'] as const) {
    const st = mk(comp);
    const second = st.active === 'own' ? 'enemy' : 'own';
    const before = st.sides[second].hand.length;
    const gained = comp === 'extra_draw' ? 2 : 1;
    assert.equal(st.sides[second].hand.length, before, '起手张数不受补偿方式影响');
    // 模拟进入后手第 1 回合（后手是该完整回合的第 2 个半回合，故 halfTurn=2）
    void gained;
  }
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
    if (s.pendingDiscover) {
      const choice = s.pendingDiscover.candidates[0];
      assert.ok(choice, '发现应至少提供一张候选牌');
      const discovered = applyAction(s, ctx, { type: 'CHOOSE_DISCOVER', cardId: choice });
      assert.equal(discovered.ok, true, `发现选择被拒：${discovered.error ?? ''}`);
      s = discovered.state;
      guard += 1;
      continue;
    }
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

// 华雄的技能已按设计者 2026-09 定稿改为「威震四方」（击杀 +1/+1 + 亡语给击杀者 +1/+1），
// 原先那条「只震慑一名目标」的回归断言对应的是一版已被取代的设计，故一并替换。
test('回归·华雄「威震四方」：技能为击杀成长 + 亡语给击杀者，且不再有旧的震慑分支', () => {
  const hx = data.cards.get('qun_huaxiong');
  assert.ok(hx, '华雄应存在于卡表');
  const triggers = (hx.skills ?? []).map((sk) => sk.trigger);
  assert.ok(triggers.includes('on_kill'), '应有 on_kill 触发（击杀时 +1/+1）');
  assert.ok(triggers.includes('on_death'), '应有 on_death 触发（亡语给击杀者 +1/+1）');
  const effs = (hx.skills ?? []).flatMap((sk) => sk.effects ?? []);
  assert.ok(!effs.some((e) => e.action === 'apply_status' && e.status === 'zhen_she'),
    '不应再有旧设计的震慑分支');
  const death = (hx.skills ?? []).find((sk) => sk.trigger === 'on_death')!;
  assert.equal(death.effects?.[0]?.target?.event, 'killer', '亡语应指向击杀者');
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



test('万箭齐发：抽到时自动释放（不进手牌），对全体敌方人物各 1 点伤害', async () => {
  const { applyAction } = await import('../src/engine.ts');
  const { createMatch, setUnit, getUnit, makeUnit } = await import('../src/state.ts');
  const d = qun();
  const base = createMatch({ seed: 5, cards: d.cards, lords: d.lords, decks: { own: [], enemy: [] }, firstSide: 'own' });
  const ctx = { cards: d.cards, lords: d.lords };
  let s = startMatch(base, ctx).state;
  setUnit(s, 'enemy', 'front', 0, makeUnit(d.cards.get('shu_guanyu')!, 1, 900));
  setUnit(s, 'enemy', 'front', 1, makeUnit(d.cards.get('shu_zhangfei')!, 1, 901));
  const guanyuHp0 = d.cards.get('shu_guanyu')!.health!;
  const zhangfeiHp0 = d.cards.get('shu_zhangfei')!.health!;
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
  // 断言"掉了 1 点"而不是写死结果血量 —— 否则设计者一改卡面数值这条测试就碎
  assert.equal(getUnit(cur, 'enemy', 'front', 0)!.hp, guanyuHp0 - 1, '关羽应掉 1 点');
  assert.equal(getUnit(cur, 'enemy', 'front', 1)!.hp, zhangfeiHp0 - 1, '张飞应掉 1 点');
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

test('后手补偿·多抽 1 张：机制确实生效（后手第 1 回合抽 2 张）', async () => {
  const { applyAction } = await import('../src/engine.ts');
  const { createMatch } = await import('../src/state.ts');
  const run = (comp: 'none' | 'extra_draw') => {
    const base = createMatch({
      seed: 42, cards: data.cards, lords: data.lords,
      decks: { own: autoDeck(data, 'shu'), enemy: autoDeck(data, 'wei') },
      firstSide: 'own', secondCompensation: comp,
    });
    const ctx = { cards: data.cards, lords: data.lords };
    const s = startMatch(base, ctx).state;
    const hand0 = s.sides.enemy.hand.length;
    const r = applyAction(s, ctx, { type: 'END_TURN' });     // → 后手（enemy）第 1 回合
    return {
      hand0,
      draws: r.events.filter((e) => e.type === 'CARD_DRAWN').length,
      hand: r.state.sides.enemy.hand.length,
      turn: r.state.turn,
      halfTurn: r.state.halfTurn,
    };
  };
  const a = run('none'), b = run('extra_draw');
  assert.equal(a.hand0, 4, '后手起手 4 张（两种补偿方式都一样）');
  // ADR-064：后手第 1 回合仍属**第 1 个完整回合**（它只是第 2 个半回合）
  assert.equal(a.halfTurn, 2, '后手是该完整回合的第 2 个半回合');
  assert.equal(a.turn, 1, '后手第 1 回合的 turn 仍是 1');
  assert.equal(a.draws, 1, '无补偿：抽 1 张');
  assert.equal(a.hand, 5);
  assert.equal(b.draws, 2, '多抽补偿：抽 2 张');
  assert.equal(b.hand, 6, '手牌应多 1 张');
});

test('卡池：传国玉玺已移除（ADR-053）', () => {
  assert.ok(!CARDS.some((c) => c.id === 'neutral_chuanguo_yuxi'), 'cards.yaml 不应再有传国玉玺');
  assert.ok(!data.cards.get('neutral_chuanguo_yuxi'), '运行时卡表也不应有');
});

/* ============================================================
   ⑨ ADR-054：对局终止与关键词定义
   ============================================================ */

test('ADR-054：没有回合上限，也没有平局', async () => {
  const { MATCH } = await import('../src/constants.ts');
  assert.equal(MATCH.TURN_LIMIT, Infinity, '回合上限应为 Infinity（不设上限）');
  // 类型层面已无 draw：长局只能由主将阵亡结束
  const { chooseAction } = await import('../src/ai.ts');
  const { state } = setupMatch({
    seed: 5, cards: data.cards, lords: data.lords,
    decks: { own: autoDeck(data, 'shu'), enemy: autoDeck(data, 'wei') },
  });
  const ctx = { cards: data.cards, lords: data.lords };
  let s = startMatch(state, ctx).state;
  let n = 0;
  while (!s.winner && n < 4000) {
    if (s.pendingDiscover) {
      const choice = s.pendingDiscover.candidates[0];
      assert.ok(choice, '发现应至少提供一张候选牌');
      const discovered = applyAction(s, ctx, { type: 'CHOOSE_DISCOVER', cardId: choice });
      assert.equal(discovered.ok, true, `发现选择被拒：${discovered.error ?? ''}`);
      s = discovered.state;
      n += 1;
      continue;
    }
    const a: Action = chooseAction(s, ctx) ?? { type: 'END_TURN' };
    const r = applyAction(s, ctx, a);
    assert.equal(r.ok, true);
    s = r.state; n += 1;
  }
  assert.ok(s.winner, '对局必须自然收束（粮尽保证）');
  assert.notEqual(s.winner, 'draw', '不应出现平局');
  assert.ok(['own', 'enemy'].includes(s.winner!));
});

test('ADR-054：关键词表——疾行已合并入先攻，无双已取消', async () => {
  const { KEYWORDS, RETIRED_KEYWORDS } = await import('../src/constants.ts');
  assert.ok(KEYWORDS.xian_gong, '先攻应存在');
  assert.ok(!KEYWORDS.ji_xing, '疾行不应再是独立关键词（已合并）');
  assert.ok(!KEYWORDS.wu_shuang, '无双不应再是关键词（已取消）');
  assert.ok(RETIRED_KEYWORDS.ji_xing.includes('先攻'), '疾行应指向先攻');
  // 定义已给出但引擎未实现的关键词，必须显式标 false，避免"卡面写了却不生效"
  for (const k of ['shen_she', 'qi_xi', 'zhong_yi']) {
    assert.equal(KEYWORDS[k]!.implemented, false, `${k} 应标为未实现`);
  }
  // ADR-067：「结阵」整个移除（引擎里那套是 AI 自己推的，设计者从未设计、0 卡使用）
  assert.ok(!KEYWORDS.jie_zhen, '结阵不应再是关键词');
  assert.ok(RETIRED_KEYWORDS.jie_zhen, '结阵应记入已取消');
  // 忠义的定义已从"亡语"纠正为"免疫控制"
  assert.ok(KEYWORDS.zhong_yi!.note.includes('免疫'), '忠义应为免疫控制类');
  // ADR-057：武圣废弃 → 圣盾（免疫一次伤害）；饮血已实现（回自身）
  assert.ok(!KEYWORDS.wu_sheng, '武圣应已废弃');
  assert.ok(KEYWORDS.sheng_dun, '圣盾应存在');
  assert.equal(KEYWORDS.sheng_dun!.implemented, true, '圣盾机制已实现');
  assert.equal(KEYWORDS.yin_xue!.implemented, true, '饮血已实现');
  assert.ok(RETIRED_KEYWORDS.wu_sheng, '武圣应记入已取消');
});

test('ADR-054：先攻＝入场当回合即可攻击（原疾行的行为）', async () => {
  const { createMatch, setUnit, makeUnit } = await import('../src/state.ts');
  const { canAttack } = await import('../src/rules.ts');
  const d = qun();
  const base = createMatch({ seed: 5, cards: d.cards, lords: d.lords, decks: { own: [], enemy: [] }, firstSide: 'own' });
  const ctx = { cards: d.cards, lords: d.lords };
  const s = startMatch(base, ctx).state;
  const plain = makeUnit(d.cards.get('neutral_infantry')!, s.turn, 800);   // 无先攻
  const fast = makeUnit(d.cards.get('neutral_infantry')!, s.turn, 801);
  fast.kw.push('xian_gong');
  setUnit(s, 'own', 'front', 0, plain);
  setUnit(s, 'own', 'front', 1, fast);
  assert.equal(canAttack(s, 'own', 'front', 0).ok, false, '当回合入场的普通单位不能攻击');
  assert.equal(canAttack(s, 'own', 'front', 1).ok, true, '带「先攻」的当回合即可攻击');
});

test('ADR-055：先攻不含「击杀不遭反击」——目标存活时仍会反击', async () => {
  const { createMatch, setUnit, makeUnit, getUnit } = await import('../src/state.ts');
  const { applyAction } = await import('../src/engine.ts');
  const d = qun();
  const base = createMatch({ seed: 7, cards: d.cards, lords: d.lords, decks: { own: [], enemy: [] }, firstSide: 'own' });
  const ctx = { cards: d.cards, lords: d.lords };
  const s = startMatch(base, ctx).state;
  // 数值直接设定，避免依赖卡面组合：攻击者 3 攻 20 血（挂先攻），目标 2 攻 10 血
  const atk = makeUnit(d.cards.get('qun_yuanshao')!, 0, 810);
  atk.kw.push('xian_gong');
  atk.hp = 20; atk.maxHp = 20;
  setUnit(s, 'own', 'front', 0, atk);
  const victim = makeUnit(d.cards.get('shu_guanyu')!, 0, 811);
  victim.hp = 10; victim.maxHp = 10; victim.atk = 2;
  setUnit(s, 'enemy', 'front', 0, victim);

  const r = applyAction(s, ctx, { type: 'ATTACK', from: { row: 'front', col: 0 }, to: { kind: 'unit', row: 'front', col: 0 } });
  assert.equal(r.ok, true);
  assert.ok(getUnit(r.state, 'enemy', 'front', 0), '目标应存活（10 血 > 3 攻）');
  assert.equal(getUnit(r.state, 'enemy', 'front', 0)!.hp, 7, '目标掉 3 血');
  assert.equal(getUnit(r.state, 'own', 'front', 0)!.hp, 18,
    '目标存活 → 必须反击 2 点；「先攻」不再压制反击（原定义是 AI 编的，已删）');
});

test('张角：5 费 1/5 谋臣「五雷轰顶」——5 次随机雷击 + 50% 震慑 + 击杀召唤黄巾兵', () => {
  const zj = CARDS.find((c) => c.id === 'qun_zhangjiao');
  assert.ok(zj, '张角应在卡池里');
  assert.equal(zj!.cost, 5);
  assert.equal(zj!.attack, 1);
  assert.equal(zj!.health, 5);
  assert.equal(zj!.type, 'strategist');
  const sk = zj!.skills![0]!;
  assert.equal(sk.trigger, 'turn_end');
  const dmg = sk.effects!.find((e) => e.action === 'damage')!;
  assert.equal(dmg.count, 5, '5 次雷击');
  assert.equal(dmg.value, 1);
  assert.equal(dmg.target!.mode, 'random');
  const st = sk.effects!.find((e) => e.action === 'apply_status')!;
  assert.equal(st.status, 'zhen_she');
  assert.equal(st.chance, 0.5, '每次 50% 震慑');
  assert.equal(st.count, 5);
  const sm = sk.effects!.find((e) => e.action === 'summon')!;
  assert.equal(sm.unit, 'token_huangjin_bing');
  assert.equal(sm.condition!.event, 'killed', '击杀才召唤');
});

test('袁绍：6 费 3/6，每回合召唤弓兵 + 战吼 1 张进手牌/2 张进牌组 + 亡语转手', async () => {
  const { applyAction } = await import('../src/engine.ts');
  const { createMatch } = await import('../src/state.ts');
  const d = qun();
  const ys = CARDS.find((c) => c.id === 'qun_yuanshao')!;
  assert.equal(ys.cost, 6);
  assert.equal(ys.attack, 3);
  assert.equal(ys.health, 6);
  assert.deepEqual((ys.skills ?? []).map((s) => s.trigger), ['turn_start', 'on_play', 'on_death']);

  const base = createMatch({ seed: 5, cards: d.cards, lords: d.lords, decks: { own: [], enemy: [] }, firstSide: 'own' });
  const ctx = { cards: d.cards, lords: d.lords };
  const s = startMatch(base, ctx).state;
  s.sides.own.command.cur = 10;
  s.sides.own.hand.push({ card: d.cards.get('qun_yuanshao')!, mods: [] });
  const r = applyAction(s, ctx, { type: 'PLAY_CARD', cardIndex: s.sides.own.hand.length - 1, row: 'front', col: 0 });
  assert.equal(r.ok, true);
  const own = r.state.sides.own;
  assert.equal(own.hand.filter((h) => h.card.id === 'tactic_wanjianqifa').length, 1, '战吼：1 张进手牌');
  assert.equal(own.deck.filter((x) => x === 'tactic_wanjianqifa').length, 2, '战吼：2 张进牌组');
});

/* ============================================================
   ⑩ ADR-059：翻面、反击、阵亡
   ============================================================ */

test('翻面：当回合不能行动、不能被指定；自己下个回合开始时翻回正面', async () => {
  const { createMatch, setUnit, makeUnit, getUnit: gu } = await import('../src/state.ts');
  const { canAttack, legalTargets } = await import('../src/rules.ts');
  const d = qun();
  const base = createMatch({ seed: 9, cards: d.cards, lords: d.lords, decks: { own: [], enemy: [] }, firstSide: 'own' });
  const ctx = { cards: d.cards, lords: d.lords };
  let s = startMatch(base, ctx).state;
  const u = makeUnit(d.cards.get('shu_guanyu')!, 0, 820);
  setUnit(s, 'enemy', 'front', 0, u);
  setUnit(s, 'own', 'front', 0, makeUnit(d.cards.get('neutral_infantry')!, 0, 821));

  // 施加翻面
  const { applyStatus } = await import('../src/mutate.ts');
  applyStatus(s, { kind: 'unit', side: 'enemy', row: 'front', col: 0 }, 'fan_mian', 1, []);
  assert.ok(gu(s, 'enemy', 'front', 0)!.statuses.fan_mian, '应带有翻面状态');
  // 不能被指定为目标
  const tg = legalTargets(s, 'own', 'front', 0);
  assert.ok(!tg.targets.some((t) => t.kind === 'unit' && t.col === 0), '翻面单位不可被指定');
  // 不能行动
  assert.equal(canAttack(s, 'enemy', 'front', 0).ok, false, '翻面单位不能攻击');

  // 轮到敌方（翻面单位拥有者）回合开始 → 翻回正面
  const r = applyAction(s, ctx, { type: 'END_TURN' });
  assert.equal(r.ok, true);
  assert.ok(r.events.some((e) => e.type === 'UNIT_FLIPPED' && e.to === 'front'), '应产生翻回正面事件');
  assert.ok(!gu(r.state, 'enemy', 'front', 0)!.statuses.fan_mian, '回合开始后翻面应解除');
  assert.equal(canAttack(r.state, 'enemy', 'front', 0).ok, true, '翻回正面后可以行动');
});

test('普通攻击：目标掉攻击力等量的血，攻击者也受目标攻击力的反击', async () => {
  const { createMatch, setUnit, makeUnit, getUnit: gu } = await import('../src/state.ts');
  const d = qun();
  const base = createMatch({ seed: 1, cards: d.cards, lords: d.lords, decks: { own: [], enemy: [] }, firstSide: 'own' });
  const ctx = { cards: d.cards, lords: d.lords };
  const s = startMatch(base, ctx).state;
  const a = makeUnit(d.cards.get('qun_yuanshao')!, 0, 830); a.hp = 20; a.maxHp = 20; a.atk = 3;
  const t = makeUnit(d.cards.get('shu_guanyu')!, 0, 831); t.hp = 10; t.maxHp = 10; t.atk = 2;
  setUnit(s, 'own', 'front', 0, a); setUnit(s, 'enemy', 'front', 0, t);

  const r = applyAction(s, ctx, { type: 'ATTACK', from: { row: 'front', col: 0 }, to: { kind: 'unit', row: 'front', col: 0 } });
  assert.equal(r.ok, true);
  const dmg = r.events.filter((e) => e.type === 'DAMAGE').map((e) => e.amount);
  assert.deepEqual(dmg, [3, 2], '先目标掉 3，再攻击者挨 2');
  assert.equal(gu(r.state, 'enemy', 'front', 0)!.hp, 7, '目标 10 → 7');
  assert.equal(gu(r.state, 'own', 'front', 0)!.hp, 18, '攻击者 20 → 18（受反击）');
});

test('阵亡：血量归 0 → UNIT_DIED 且移出战场；打死目标仍受其反击（ADR-062）', async () => {
  const { createMatch, setUnit, makeUnit, getUnit: gu } = await import('../src/state.ts');
  const d = qun();
  const base = createMatch({ seed: 1, cards: d.cards, lords: d.lords, decks: { own: [], enemy: [] }, firstSide: 'own' });
  const ctx = { cards: d.cards, lords: d.lords };
  const s = startMatch(base, ctx).state;
  const a = makeUnit(d.cards.get('qun_yuanshao')!, 0, 840); a.hp = 20; a.maxHp = 20; a.atk = 3;
  const t = makeUnit(d.cards.get('neutral_infantry')!, 0, 841); t.hp = 2; t.maxHp = 2; t.atk = 5;
  setUnit(s, 'own', 'front', 0, a); setUnit(s, 'enemy', 'front', 0, t);

  const r = applyAction(s, ctx, { type: 'ATTACK', from: { row: 'front', col: 0 }, to: { kind: 'unit', row: 'front', col: 0 } });
  assert.ok(r.events.some((e) => e.type === 'UNIT_DIED'), '应产生阵亡事件');
  assert.equal(gu(r.state, 'enemy', 'front', 0), null, '阵亡单位应移出战场');
  // ADR-062：伤害同时结算，目标被打死也照样反击（此处 20-5=15）
  assert.equal(gu(r.state, 'own', 'front', 0)!.hp, 15, '打死目标仍应吃下其 5 点反击');
});

test('技能伤害同样扣血并可致阵亡', async () => {
  const { createMatch, setUnit, makeUnit, getUnit: gu } = await import('../src/state.ts');
  const { dealDamage, unitRef } = await import('../src/mutate.ts');
  const d = qun();
  const base = createMatch({ seed: 1, cards: d.cards, lords: d.lords, decks: { own: [], enemy: [] }, firstSide: 'own' });
  const ctx = { cards: d.cards, lords: d.lords };
  const s = startMatch(base, ctx).state;
  const victim = makeUnit(d.cards.get('shu_guanyu')!, 0, 850);
  victim.hp = 5; victim.maxHp = 5;              // 显式设定血量，不依赖卡面数值
  setUnit(s, 'enemy', 'front', 0, victim);
  const evs: import('../src/types.ts').GameEvent[] = [];
  dealDamage(s, d.cards, unitRef('enemy', 'front', 0), 4, evs, '技能');
  assert.equal(gu(s, 'enemy', 'front', 0)!.hp, 1, '4 点技能伤害：5 → 1');
  dealDamage(s, d.cards, unitRef('enemy', 'front', 0), 99, evs, '技能');
  assert.equal(gu(s, 'enemy', 'front', 0), null, '超量伤害应致阵亡并移出');
});


/* ============================================================
   on_kill 与击杀者引用（ADR-070）
   ============================================================ */

test('华雄「威震四方」：击杀时 +1/+1；亡语给击杀者 +1/+1', async () => {
  const { createMatch, setUnit, makeUnit, getUnit: gu } = await import('../src/state.ts');
  const { dealDamage, unitRef } = await import('../src/mutate.ts');
  const d = qun();
  const base = createMatch({ seed: 1, cards: d.cards, lords: d.lords, decks: { own: [], enemy: [] }, firstSide: 'own' });
  const ctxData = { cards: d.cards, lords: d.lords };
  const s = startMatch(base, ctxData).state;

  // 我方华雄 3/3 打敌方一个 1/1
  const hx = makeUnit(d.cards.get('qun_huaxiong')!, 0, 860);
  setUnit(s, 'own', 'front', 0, hx);
  const foe = makeUnit(d.cards.get('neutral_infantry')!, 0, 861);
  foe.hp = 1; foe.maxHp = 1; foe.baseMaxHp = 1;
  setUnit(s, 'enemy', 'front', 3, foe);

  const before = { atk: hx.atk, hp: hx.hp };
  const evs: import('../src/types.ts').GameEvent[] = [];
  // 2 点伤害打死 1 血目标，killerRef 指向华雄
  dealDamage(s, d.cards, unitRef('enemy', 'front', 3), 2, evs, '华雄', 0, { side: 'own', row: 'front', col: 0 });

  const hx2 = gu(s, 'own', 'front', 0)!;
  assert.equal(gu(s, 'enemy', 'front', 3), null, '目标应阵亡');
  assert.equal(hx2.atk, before.atk + 1, '击杀后攻击 +1');
  assert.equal(hx2.hp, before.hp + 1, '击杀后生命 +1');
  assert.ok(evs.some((e) => e.type === 'UNIT_DIED' && e.side === 'enemy'));

  // 再打死一个 → 华雄应变成 +2/+2；同时验证**亡语给击杀者**：
  // 让敌方华雄被我方单位击杀，我方单位应 +1/+1
  const base2 = createMatch({ seed: 2, cards: d.cards, lords: d.lords, decks: { own: [], enemy: [] }, firstSide: 'own' });
  const s2 = startMatch(base2, ctxData).state;
  const foeHx = makeUnit(d.cards.get('qun_huaxiong')!, 0, 862);
  foeHx.hp = 1; foeHx.maxHp = 1; foeHx.baseMaxHp = 1;
  setUnit(s2, 'enemy', 'front', 0, foeHx);
  const mine = makeUnit(d.cards.get('neutral_infantry')!, 0, 863);
  setUnit(s2, 'own', 'front', 0, mine);
  const a0 = mine.atk, h0 = mine.hp;
  const evs2: import('../src/types.ts').GameEvent[] = [];
  dealDamage(s2, d.cards, unitRef('enemy', 'front', 0), 5, evs2, '步兵', 0, { side: 'own', row: 'front', col: 0 });
  const mine2 = gu(s2, 'own', 'front', 0)!;
  assert.equal(mine2.atk, a0 + 1, '击杀者的攻击应 +1（华雄亡语）');
  assert.equal(mine2.hp, h0 + 1, '击杀者的生命应 +1（华雄亡语）');
});

test('马超「铁骑突袭」：仅首回合、仅击杀武将才禁敌方主公技', async () => {
  const { createMatch, setUnit, makeUnit, getUnit: gu } = await import('../src/state.ts');
  const { dealDamage, unitRef } = await import('../src/mutate.ts');
  const d = qun();
  const ctxData = { cards: d.cards, lords: d.lords };

  const kill = (opts: { turn: number; victimId: string }) => {
    const base = createMatch({ seed: 3, cards: d.cards, lords: d.lords, decks: { own: [], enemy: [] }, firstSide: 'own' });
    const s = startMatch(base, ctxData).state;
    s.turn = opts.turn;
    const mc = makeUnit(d.cards.get('shu_machao')!, 0, 870);
    setUnit(s, 'own', 'front', 0, mc);
    const v = makeUnit(d.cards.get(opts.victimId)!, 0, 871);
    v.hp = 1; v.maxHp = 1; v.baseMaxHp = 1;
    setUnit(s, 'enemy', 'front', 1, v);
    dealDamage(s, d.cards, unitRef('enemy', 'front', 1), 9, [], '马超', 0, { side: 'own', row: 'front', col: 0 });
    return s.sides.enemy.lord.statuses?.jin_yong;
  };

  assert.ok(kill({ turn: 1, victimId: 'shu_zhangfei' }), '首回合击杀武将 → 敌主帅应被禁用主公技');
  assert.equal(kill({ turn: 2, victimId: 'shu_zhangfei' }), undefined, '非首回合不应触发');
  assert.equal(kill({ turn: 1, victimId: 'shu_zhugeliang' }), undefined,
    '击杀谋臣（诸葛亮 1/6，攻击 ≤1 → 谋臣）不该触发 —— 文案只认「武将」');
});

/* ============================================================
   驱散 remove_status（ADR-066）
   ============================================================ */

test('remove_status：移除全部层数并发 STATUS_EXPIRED；关键词状态一并摘掉', async () => {
  const { createMatch, setUnit, makeUnit, getUnit: gu } = await import('../src/state.ts');
  const { runEffects } = await import('../src/effects.ts');
  const d = qun();
  const base = createMatch({ seed: 1, cards: d.cards, lords: d.lords, decks: { own: [], enemy: [] }, firstSide: 'own' });
  const ctxData = { cards: d.cards, lords: d.lords };
  const s = startMatch(base, ctxData).state;

  const u = makeUnit(d.cards.get('neutral_infantry')!, 0, 870);
  u.statuses.zhen_she = { stacks: 3 };
  u.kw.push('jia_dun');
  u.statuses.jia_dun_status = { stacks: 1 };
  s.sides.own.rows.front[1] = u;

  const events: import('../src/types.ts').GameEvent[] = [];
  const rng = createRng(3);
  // 移除「震慑」全部层数
  runEffects(s, d.cards, [{ action: 'remove_status', status: 'zhen_she' } as never],
    { side: 'own', chosen: { kind: 'unit', side: 'own', row: 'front', col: 1 } } as never, rng, events);

  assert.equal(gu(s, 'own', 'front', 1)!.statuses.zhen_she, undefined, '震慑应被清掉');
  assert.ok(events.some((e) => e.type === 'STATUS_EXPIRED' && e.status === 'zhen_she'),
    '应发 STATUS_EXPIRED');

  // 移除通过效果施加的「架盾」状态（如典韦「古之恶来」）：
  // 只清状态，**不动卡面上的固有关键词** —— 那是卡的属性，不是可驱散的效果。
  const u3 = makeUnit(d.cards.get('neutral_shieldman')!, 0, 872);   // 自带 jia_dun 关键词
  u3.statuses.jia_dun_status = { stacks: 1 };
  s.sides.own.rows.front[3] = u3;
  const events2: import('../src/types.ts').GameEvent[] = [];
  runEffects(s, d.cards, [{ action: 'remove_status', status: 'jia_dun_status' } as never],
    { side: 'own', chosen: { kind: 'unit', side: 'own', row: 'front', col: 3 } } as never, rng, events2);
  assert.equal(gu(s, 'own', 'front', 3)!.statuses.jia_dun_status, undefined, '状态应被移除');
  assert.ok(gu(s, 'own', 'front', 3)!.kw.includes('jia_dun'),
    '卡面固有「架盾」关键词不应被驱散');

  // 部分移除：只扣指定层数，未扣完不发 STATUS_EXPIRED
  const u2 = makeUnit(d.cards.get('neutral_infantry')!, 0, 871);
  u2.statuses.zhen_she = { stacks: 3 };
  s.sides.own.rows.front[2] = u2;
  const events3: import('../src/types.ts').GameEvent[] = [];
  runEffects(s, d.cards, [{ action: 'remove_status', status: 'zhen_she', stacks: 1 } as never],
    { side: 'own', chosen: { kind: 'unit', side: 'own', row: 'front', col: 2 } } as never, rng, events3);
  assert.equal(gu(s, 'own', 'front', 2)!.statuses.zhen_she.stacks, 2, '只扣 1 层');
  assert.ok(!events3.some((e) => e.type === 'STATUS_EXPIRED'), '未清空不应发 EXPIRED');

  // 目标身上没有该状态 → 空操作，不报错
  const events4: import('../src/types.ts').GameEvent[] = [];
  runEffects(s, d.cards, [{ action: 'remove_status', status: 'hun_luan' } as never],
    { side: 'own', chosen: { kind: 'unit', side: 'own', row: 'front', col: 2 } } as never, rng, events4);
  assert.equal(events4.length, 0);
});

test('动作守卫：ACTIONS 里注册但未实现的，必须显式登记（防「静默空转」）', async () => {
  const { ACTIONS } = await import('../src/constants.ts');
  const { IMPLEMENTED_ACTIONS } = await import('../src/effects.ts');
  const missing = [...ACTIONS].filter((a) => !IMPLEMENTED_ACTIONS.has(a)).sort();
  // 已知尚未实现：move（换位）、random_pick（随机取牌）；当前无卡使用。
  // 若实现了就把它们加进 IMPLEMENTED_ACTIONS 并更新这里。
  assert.deepEqual(missing, ['move', 'random_pick'],
    `ACTIONS 与已实现集合不一致：${missing.join('、')} —— 用了它们的卡会静默空转`);
});

test('关键词的两套载体等价：状态形式的「架盾/先攻/奇袭」必须与关键词同样生效（ADR-066）', async () => {
  const { createMatch, setUnit, makeUnit, getUnit: gu } = await import('../src/state.ts');
  const { canAttack, legalTargets } = await import('../src/rules.ts');
  const { shieldUnits, hasTrait } = await import('../src/state.ts');
  const d = qun();
  const base = createMatch({ seed: 1, cards: d.cards, lords: d.lords, decks: { own: [], enemy: [] }, firstSide: 'own' });
  const ctxData = { cards: d.cards, lords: d.lords };
  const s = startMatch(base, ctxData).state;

  // 一张**没有**任何关键词的白板，只靠状态获得能力
  const g = makeUnit(d.cards.get('neutral_infantry')!, 0, 880);
  g.kw = [];
  g.statuses.jia_dun_status = { stacks: 1 };
  s.sides.enemy.rows.front[0] = g;

  assert.equal(hasTrait(g, 'jia_dun'), true, '状态形式的架盾应被 hasTrait 认到');
  assert.equal(shieldUnits(s, 'enemy').length, 1, '架盾（状态形式）应产生嘲讽');
  // 我方打手
  const a = makeUnit(d.cards.get('neutral_infantry')!, 0, 881);
  s.sides.own.rows.front[1] = a;
  const t = legalTargets(s, 'own', 'front', 1);
  assert.deepEqual(t.targets.map((x: { col?: number }) => x.col), [0],
    '有架盾时只能打架盾单位');

  // 状态形式的先攻：入场当回合即可攻击
  const f = makeUnit(d.cards.get('neutral_infantry')!, s.turn, 882);
  f.kw = [];
  f.statuses.xian_gong_status = { stacks: 1 };
  s.sides.own.rows.front[2] = f;
  assert.equal(canAttack(s, 'own', 'front', 2).ok, true, '状态形式的先攻应当回合可攻击');

  // 状态形式的奇袭：不可被指定为目标
  const q = makeUnit(d.cards.get('neutral_infantry')!, 0, 883);
  q.kw = [];
  q.statuses.qi_xi_status = { stacks: 1 };
  s.sides.enemy.rows.front[3] = q;
  const t2 = legalTargets(s, 'own', 'front', 1);
  assert.ok(!t2.targets.some((x: { col?: number }) => x.col === 3), '奇袭（状态形式）不应可被指定');
});

/* ============================================================
   同名上限（ADR-065）
   ============================================================ */

test('同名上限：基础兵 3 张，其余人物与将领 1 张', async () => {
  const { maxCopiesOf, BASIC_TROOP_COPIES, UNIQUE_COPIES } = await import('../src/deck.ts');

  // 三张基础兵 = type: troop
  for (const id of ['neutral_infantry', 'neutral_archer', 'neutral_shieldman']) {
    const c = data.cards.get(id)!;
    assert.equal(c.type, 'troop', `${id} 应为 troop`);
    assert.equal(c.cost, 1, `${id} 应为 1 费`);
    assert.equal(maxCopiesOf(c), BASIC_TROOP_COPIES, `${id} 同名上限应为 3`);
  }
  // 其余人物 / 将领独一无二
  for (const id of ['shu_guanyu', 'wei_caozhang', 'wu_zhouyu']) {
    const c = data.cards.get(id);
    if (!c) continue;
    assert.equal(maxCopiesOf(c), UNIQUE_COPIES, `${id} 同名上限应为 1`);
  }
  assert.equal(maxCopiesOf(undefined), UNIQUE_COPIES);

  // 校验器要拦住超限：盾兵 4 张、关羽 2 张
  const d2 = loadData({ cards: CARDS, heroes: HEROES }, { own: 'shu_liubei', enemy: 'wei_caocao' });
  const deck = [...Array(4).fill('neutral_shieldman'), 'shu_guanyu', 'shu_guanyu'];
  while (deck.length < 30) deck.push('neutral_infantry');
  const chk = validateDeck(d2, 'shu', deck);
  assert.ok(chk.errors.some((e) => /盾兵 同名上限 3/.test(e.message)), '盾兵超 3 张应报错');
  assert.ok(chk.errors.some((e) => /关羽 同名上限 1/.test(e.message)), '关羽超 1 张应报错');
});

/* ============================================================
   战场单位的攻击全链路（设计者要求确认）
   ============================================================ */

test('回合数与统率同步：双方各行动一次才推进（ADR-061/064）', async () => {
  const { createMatch } = await import('../src/state.ts');
  const d = qun();
  const base = createMatch({
    seed: 5, cards: d.cards, lords: d.lords,
    decks: { own: Array(30).fill('neutral_infantry'), enemy: Array(30).fill('neutral_infantry') },
    firstSide: 'own',
  });
  const ctx = { cards: d.cards, lords: d.lords };
  let s = startMatch(base, ctx).state;

  // 完整回合 1：双方都是起始统率，谁都不额外白拿
  assert.equal(s.turn, 1);
  assert.equal(s.halfTurn, 1);
  assert.equal(s.sides.own.command.max, COMMAND.START);
  assert.equal(s.sides.enemy.command.max, COMMAND.START);

  // 后手方开始行动 —— 同一个完整回合，turn 与统率都不动
  s = applyAction(s, ctx, { type: 'END_TURN' }).state;
  assert.equal(s.halfTurn, 2);
  assert.equal(s.turn, 1, '后手方还没行动完 → 仍是第 1 回合');
  assert.equal(s.sides.enemy.command.max, COMMAND.START);

  // 回到先手方 = 完整回合结束 → turn +1，且**双方**统率一起 +1
  s = applyAction(s, ctx, { type: 'END_TURN' }).state;
  assert.equal(s.halfTurn, 3);
  assert.equal(s.turn, 2);
  assert.equal(s.sides.own.command.max, COMMAND.START + 1);
  assert.equal(s.sides.enemy.command.max, COMMAND.START + 1, '双方上限必须一致');
});

test('战场单位攻击全链路：入场当回合不能攻击 → 下回合可攻击 → 打完后本回合不能再攻击', async () => {
  const { createMatch, setUnit, makeUnit, getUnit: gu } = await import('../src/state.ts');
  const d = qun();
  const base = createMatch({ seed: 1, cards: d.cards, lords: d.lords, decks: { own: [], enemy: [] }, firstSide: 'own' });
  const ctx = { cards: d.cards, lords: d.lords };
  let s = startMatch(base, ctx).state;

  // ① 本回合入场 → 召唤失调，不能攻击
  // 注意：改属性必须连 baseAtk / baseMaxHp 一起改 ——
  // applyMods()（ADR-037）会用 base + mods 重算 atk/maxHp，
  // 只改 atk/hp/maxHp 会在下一次光环重算时被打回原形。
  const a = makeUnit(d.cards.get('qun_yuanshao')!, s.turn, 900);
  a.baseAtk = 3; a.baseMaxHp = 4; a.atk = 3; a.maxHp = 4; a.hp = 4;
  setUnit(s, 'own', 'front', 0, a);
  assert.equal(canAttack(s, 'own', 'front', 0).ok, false, '入场当回合不能攻击');
  assert.match(canAttack(s, 'own', 'front', 0).reason ?? '', /入场/);

  // ② 走完一个完整回合：我 → 敌 → 我
  s = applyAction(s, ctx, { type: 'END_TURN' }).state;
  s = applyAction(s, ctx, { type: 'END_TURN' }).state;
  assert.equal(s.active, 'own');
  assert.equal(canAttack(s, 'own', 'front', 0).ok, true, '过一个完整回合后应可攻击');

  // 敌方放一个 2/5 作靶子
  const t = makeUnit(d.cards.get('neutral_infantry')!, s.turn, 901);
  t.baseAtk = 2; t.baseMaxHp = 5; t.atk = 2; t.maxHp = 5; t.hp = 5;
  setUnit(s, 'enemy', 'front', 0, t);

  // ③ 攻击：我造成 3，**同时**吃它 2 点反击（ADR-062）
  const r = applyAction(s, ctx, { type: 'ATTACK', from: { row: 'front', col: 0 }, to: { kind: 'unit', row: 'front', col: 0 } });
  assert.equal(r.ok, true);
  assert.equal(gu(r.state, 'enemy', 'front', 0)!.hp, 2, '目标 5-3');
  assert.equal(gu(r.state, 'own', 'front', 0)!.hp, 2, '攻击者 4-2（反击）');

  // ④ 本回合已攻击 → 不能再攻击
  const again = canAttack(r.state, 'own', 'front', 0);
  assert.equal(again.ok, false);
  assert.match(again.reason ?? '', /已攻击/);

  // ⑤ 再过一回合 → 又能攻击
  let s2 = applyAction(r.state, ctx, { type: 'END_TURN' }).state;
  s2 = applyAction(s2, ctx, { type: 'END_TURN' }).state;
  assert.equal(canAttack(s2, 'own', 'front', 0).ok, true, '新回合恢复可攻击');
});

test('先攻：入场当回合即可攻击（与反击无关，ADR-055/062）', async () => {
  const { createMatch, setUnit, makeUnit, getUnit: gu } = await import('../src/state.ts');
  const d = qun();
  const base = createMatch({ seed: 1, cards: d.cards, lords: d.lords, decks: { own: [], enemy: [] }, firstSide: 'own' });
  const ctx = { cards: d.cards, lords: d.lords };
  const s = startMatch(base, ctx).state;

  const t0 = makeUnit(d.cards.get('neutral_infantry')!, 0, 902);
  t0.baseAtk = 2; t0.baseMaxHp = 2; t0.atk = 2; t0.maxHp = 2; t0.hp = 2;
  setUnit(s, 'enemy', 'front', 0, t0);

  const a = makeUnit(d.cards.get('wei_zhangyan')!, s.turn, 903);   // 张燕：关键词「先攻」
  setUnit(s, 'own', 'front', 0, a);
  assert.ok(a.kw.includes('xian_gong'), '张燕应带先攻关键词');
  assert.equal(canAttack(s, 'own', 'front', 0).ok, true, '先攻单位入场当回合即可攻击');

  // 打死目标也照样吃反击（同时结算）
  a.baseAtk = 9; a.baseMaxHp = 5; a.atk = 9; a.maxHp = 5; a.hp = 5;
  const r = applyAction(s, ctx, { type: 'ATTACK', from: { row: 'front', col: 0 }, to: { kind: 'unit', row: 'front', col: 0 } });
  assert.equal(gu(r.state, 'enemy', 'front', 0), null, '目标应阵亡');
  assert.equal(gu(r.state, 'own', 'front', 0)!.hp, 3, '打死目标仍吃 2 点反击');
});
