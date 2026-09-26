/**
 * 金种子回放测试
 *
 * 核心不变量：**同一 seed + 同一动作序列 = 完全相同的最终状态**。
 * 这是"回放 / 断线重连 / 服务端校验"的基础，也是 core 必须确定性的原因。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyAction, startMatch } from '../src/engine.ts';
import { createMatch } from '../src/state.ts';
import { chooseAction, takeTurn } from '../src/ai/index.ts';
import { loadTestData } from './fixtures.ts';
import type { Action, EngineContext, MatchState } from '../src/types.ts';

function setup(seed: number): { state: MatchState; ctx: EngineContext } {
  const data = loadTestData();
  const base = createMatch({
    seed,
    cards: data.cards,
    lords: data.lords,
    decks: {
      own: Array(30).fill('neutral_infantry'),
      enemy: Array(30).fill('neutral_shieldman'),
    },
  });
  const ctx: EngineContext = { cards: data.cards, lords: data.lords };
  const started = startMatch(base, ctx);
  return { state: started.state, ctx };
}

test('确定性：同一 seed 两次开局状态完全一致', () => {
  const a = setup(12345);
  const b = setup(12345);
  assert.deepEqual(a.state, b.state);
});

test('确定性：同一动作序列产出相同状态与事件', () => {
  const runOnce = () => {
    const { state, ctx } = setup(777);
    const events = [];
    let cur = state;
    for (let i = 0; i < 12; i++) {
      const action = chooseAction(cur, ctx);
      if (!action) { const r = applyAction(cur, ctx, { type: 'END_TURN' }); cur = r.state; events.push(...r.events); continue; }
      const r = applyAction(cur, ctx, action);
      cur = r.state;
      events.push(...r.events);
    }
    return { state: cur, eventTypes: events.map((e) => e.type).join(',') };
  };
  const a = runOnce();
  const b = runOnce();
  assert.deepEqual(a.state, b.state);
  assert.equal(a.eventTypes, b.eventTypes);
});

test('不同 seed 会产出不同开局（洗牌生效）', () => {
  const mixed = (): string[] => {
    const ids = ['neutral_infantry', 'neutral_shieldman', 'neutral_archer', 'test_champion'];
    return Array.from({ length: 30 }, (_, i) => ids[i % ids.length] as string);
  };
  const build = (seed: number) => {
    const data = loadTestData();
    const base = createMatch({
      seed, cards: data.cards, lords: data.lords,
      decks: { own: mixed(), enemy: mixed() },
    });
    const ctx: EngineContext = { cards: data.cards, lords: data.lords };
    return startMatch(base, ctx).state;
  };
  const a = build(1);
  const b = build(2);
  assert.notDeepEqual(a.sides.own.deck, b.sides.own.deck);
  assert.notEqual(a.rngState, b.rngState);
});

test('两个 AI 能打完一局：无异常、有胜负或达到回合上限', () => {
  const { state, ctx } = setup(2026);
  let cur = state;
  let turns = 0;
  const allActions: Action[] = [];

  while (!cur.winner && turns < 60) {
    const res = takeTurn(cur, ctx, (s, c, a) => {
      const r = applyAction(s, c, a);
      return { ok: r.ok, state: r.state };
    });
    allActions.push(...res.actions);
    cur = res.state;
    turns += 1;
    if (cur.turn >= 40) break;
  }

  assert.ok(allActions.length > 0, 'AI 应该产生了动作');
  assert.ok(cur.winner !== null || cur.turn >= 40, '对局应结束或达到回合上限');
  assert.ok(cur.sides.own.lord.hp >= 0 && cur.sides.enemy.lord.hp >= 0);
});

test('回放：记录动作后重放，最终状态一致', () => {
  const { state, ctx } = setup(99);
  // 第一次：跑若干回合并记录
  let cur = state;
  const log: Action[] = [];
  for (let i = 0; i < 20; i++) {
    const action = chooseAction(cur, ctx);
    const a: Action = action ?? { type: 'END_TURN' };
    const r = applyAction(cur, ctx, a);
    if (!r.ok) break;
    cur = r.state;
    log.push(a);
  }

  // 第二次：从同一起点重放同一序列
  let replay = setup(99).state;
  for (const a of log) {
    const r = applyAction(replay, ctx, a);
    assert.equal(r.ok, true, `重放失败于动作 ${JSON.stringify(a)}`);
    replay = r.state;
  }
  assert.deepEqual(replay, cur);
});
