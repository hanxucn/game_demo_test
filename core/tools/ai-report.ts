/**
 * AI 对局统计报表（ADR-084）
 *
 * 用法：
 *   npm run ai:report                 # 默认 20 局，蜀 vs 魏
 *   npm run ai:report -- --games 40 --seed 7 --verbose
 *   npm run ai:report -- --own shu --enemy wu
 *
 * 报表回答的是**"AI 到底在下什么棋"**，不是"谁赢了"：
 *   · 攻击里有多少打主将、多少打人物（ADR-052 记录旧 AI 是 90% 糊脸）
 *   · 有多少次是"换掉对方且自己活着"的赚牌、多少次是同归于尽
 *   · 双方各用了多少次人物主动技 / 主公技（第 7 条：技能必须双方平等生效）
 *   · 每步决策模拟了多少候选、耗时多少（性能预算）
 *   · 有没有出现过被引擎拒绝的动作（AI 提非法动作 = 严重缺陷）
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { applyAction, startMatch } from '../src/engine.ts';
import { aiMulligan, decide } from '../src/ai/index.ts';
import { loadData } from '../src/loader.ts';
import { autoDeck } from '../src/deck.ts';
import { setupMatch, mulligan } from '../src/setup.ts';
import { getUnit, other } from '../src/state.ts';
import { effectiveAttack } from '../src/rules.ts';
import type { Action, CardDef, EngineContext, MatchState, Side } from '../src/types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');

const arg = (name: string, def: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] as string : def;
};
const has = (name: string): boolean => process.argv.includes(`--${name}`);

function loadJson<T>(file: string): T {
  const p = join(DATA, file);
  if (!existsSync(p)) {
    console.error(`找不到 ${p}\n请先运行：python3 tools/yaml2json.py`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(p, 'utf8')) as T;
}

interface Stats {
  games: number;
  wins: Record<Side | 'draw', number>;
  turns: number[];
  actions: number;
  rejected: number;
  attacks: { unit: number; lord: number };
  kills: { clean: number; trade: number; failed: number };
  skills: Record<Side, number>;
  lordSkills: Record<Side, number>;
  cards: Record<Side, number>;
  sims: number;
  decisions: number;
  ms: number;
  maxTurn: number;
  /** 主将伤害来源占比（用于确认"打脸"不是唯一出路） */
  lordFaceDamage: number;
}

function playGame(
  seed: number, ownFaction: string, enemyFaction: string,
  ctx: EngineContext, data: ReturnType<typeof loadData>, acc: Stats, verbose: boolean,
): void {
  const { state: pre } = setupMatch({
    seed, cards: data.cards, lords: data.lords,
    decks: { own: autoDeck(data, ownFaction as 'shu'), enemy: autoDeck(data, enemyFaction as 'wei') },
  });
  // 双方 AI 各自换牌（与原型 setup.js 的流程一致）
  let base: MatchState = pre;
  for (const side of ['own', 'enemy'] as Side[]) {
    const idx = aiMulligan(base, side, ctx);
    const r = mulligan(base, side, idx, data.cards);
    if (r.ok) base = r.state;
  }
  let state: MatchState = startMatch(base, ctx).state;

  let guard = 0;
  while (!state.winner && guard < 6000) {
    const side = state.active;
    const t0 = performance.now();
    const d = decide(state, ctx);
    acc.ms += performance.now() - t0;
    acc.decisions += 1;
    acc.sims += d.sims;

    const action: Action = d.action ?? { type: 'END_TURN' };
    if (verbose && d.action) console.log(`  [${side}] ${d.label ?? ''}  (候选 ${d.candidates} / 模拟 ${d.sims})`);

    // 记账：攻击分类在动作执行前判定（执行后局面已变）
    if (action.type === 'ATTACK') {
      const from = getUnit(state, side, action.from.row, action.from.col);
      const dm = from ? effectiveAttack(state, side, action.from.row, action.from.col) : 0;
      if (action.to.kind === 'lord') {
        acc.attacks.lord += 1;
        acc.lordFaceDamage += dm;
      } else {
        acc.attacks.unit += 1;
        const foe = other(side);
        const t = getUnit(state, foe, action.to.row, action.to.col);
        const back = t ? effectiveAttack(state, foe, action.to.row, action.to.col) : 0;
        if (t && dm >= t.hp && back < (from?.hp ?? 0)) acc.kills.clean += 1;
        else if (t && dm >= t.hp) acc.kills.trade += 1;
        else acc.kills.failed += 1;
      }
    }
    if (action.type === 'USE_SKILL') acc.skills[side] += 1;
    if (action.type === 'USE_LORD_SKILL') acc.lordSkills[side] += 1;
    if (action.type === 'PLAY_CARD') acc.cards[side] += 1;

    const r = applyAction(state, ctx, action);
    if (!r.ok) {
      acc.rejected += 1;
      console.log(`  ✗ 动作被拒：${JSON.stringify(action)} → ${r.error ?? ''}`);
      const end = applyAction(state, ctx, { type: 'END_TURN' });
      state = end.state;
    } else {
      state = r.state;
    }
    acc.actions += 1;
    guard += 1;
  }

  acc.games += 1;
  acc.turns.push(state.turn);
  acc.maxTurn = Math.max(acc.maxTurn, state.turn);
  acc.wins[state.winner ?? 'draw'] += 1;
}

function main(): void {
  const games = Number(arg('games', '20'));
  const ownFaction = arg('own', 'shu');
  const enemyFaction = arg('enemy', 'wei');
  const seed0 = Number(arg('seed', '2026'));
  const verbose = has('verbose');

  const cards = loadJson<unknown>('cards.json');
  const heroes = loadJson<unknown>('heroes.json');
  const unwrap = <T,>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : ((v as { cards: T[] }).cards ?? []));
  const data = loadData(
    { cards: unwrap<CardDef>(cards), heroes: unwrap(heroes) },
    { own: 'shu_liubei', enemy: 'wei_caocao' },
  );
  const ctx: EngineContext = { cards: data.cards, lords: data.lords };

  const acc: Stats = {
    games: 0, wins: { own: 0, enemy: 0, draw: 0 }, turns: [], actions: 0, rejected: 0,
    attacks: { unit: 0, lord: 0 }, kills: { clean: 0, trade: 0, failed: 0 },
    skills: { own: 0, enemy: 0 }, lordSkills: { own: 0, enemy: 0 }, cards: { own: 0, enemy: 0 },
    sims: 0, decisions: 0, ms: 0, maxTurn: 0, lordFaceDamage: 0,
  };

  const t0 = performance.now();
  for (let g = 0; g < games; g++) {
    if (verbose) console.log(`\n── 第 ${g + 1} 局 seed=${seed0 + g}`);
    playGame(seed0 + g, ownFaction, enemyFaction, ctx, data, acc, verbose);
  }
  const wall = performance.now() - t0;

  const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const totalAttacks = acc.attacks.unit + acc.attacks.lord;
  const pct = (n: number, d: number): string => (d ? `${(100 * n / d).toFixed(1)}%` : '—');

  console.log(`\n═══ AI 对局报表（${games} 局 · ${ownFaction} vs ${enemyFaction} · seed ${seed0}）═══`);
  console.log(`胜率      己方 ${acc.wins.own} / 敌方 ${acc.wins.enemy} / 平 ${acc.wins.draw}`);
  console.log(`回合数    平均 ${avg(acc.turns).toFixed(1)}，最长 ${acc.maxTurn}`);
  console.log(`动作总数  ${acc.actions}（被引擎拒绝 ${acc.rejected}）`);
  console.log(`攻击      打人物 ${acc.attacks.unit}（${pct(acc.attacks.unit, totalAttacks)}） / 打主将 ${acc.attacks.lord}（${pct(acc.attacks.lord, totalAttacks)}）`);
  console.log(`  其中    白吃（击杀且自己存活）${acc.kills.clean} / 同归于尽 ${acc.kills.trade} / 未击杀 ${acc.kills.failed}`);
  console.log(`人物主动技 己方 ${acc.skills.own} / 敌方 ${acc.skills.enemy}`);
  console.log(`主公技    己方 ${acc.lordSkills.own} / 敌方 ${acc.lordSkills.enemy}`);
  console.log(`出牌      己方 ${acc.cards.own} / 敌方 ${acc.cards.enemy}`);
  console.log(`主将受到的普攻伤害 来自打脸 ${acc.lordFaceDamage}`);
  console.log(`决策      ${acc.decisions} 次，平均模拟 ${(acc.sims / Math.max(1, acc.decisions)).toFixed(1)} 个候选，`
    + `平均 ${(acc.ms / Math.max(1, acc.decisions)).toFixed(2)}ms/次`);
  console.log(`耗时      引擎+AI 合计 ${wall.toFixed(0)}ms（${(wall / Math.max(1, acc.games)).toFixed(0)}ms/局）`);
}

main();
