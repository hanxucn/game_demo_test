/**
 * 冒烟测试：两个 AI 互打一局，打印可读的对局日志
 *
 * 用法：
 *   npm run smoke
 *   npm run smoke -- --seed 42 --turns 30 --verbose
 *
 * 完成标准（docs/PROJECT_STATE 里的验收项）：
 *   3 张基础兵种跑通"两个 AI 互打一局"，无异常、可复现
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { applyAction, startMatch } from '../src/engine.ts';
import { chooseAction } from '../src/ai/index.ts';
import { loadData } from '../src/loader.ts';
import { autoDeck } from '../src/deck.ts';
import { setupMatch } from '../src/setup.ts';
import type { Action, EngineContext, GameEvent, MatchState, Side } from '../src/types.ts';

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

/** 把事件翻译成一行可读文本 */
function describe(e: GameEvent): string | null {
  const who = (s: Side) => (s === 'own' ? '我方' : '敌方');
  switch (e.type) {
    case 'TURN_START': return `── 第 ${e.turn} 回合 · ${who(e.side)}（统率 ${e.command.cur}/${e.command.max}）`;
    case 'CARD_DRAWN': return `  抽牌：${e.card.name}（牌库剩 ${e.deckLeft}）`;
    case 'FATIGUE': return `  ⚠ 粮尽！${who(e.side)} 主将受到 ${e.amount} 点伤害`;
    case 'CARD_PLAYED': return `  出牌：${e.card.name}${e.row ? ` → ${e.row === 'front' ? '前军' : '后军'}列${(e.col ?? 0) + 1}` : ''}`;
    case 'ATTACK_DECLARED': return `  攻击：${e.from.row === 'front' ? '前军' : '后军'}列${e.from.col + 1}`;
    case 'DAMAGE': return `    伤害 ${e.amount}（${e.source}）`;
    case 'UNIT_DIED': return `    ✝ ${e.unit.name} 阵亡`;
    case 'HEAL': return `    治疗 → ${e.hp}`;
    case 'ARMOR_GAINED': return `    护甲 +${e.amount}（现 ${e.armor}）`;
    case 'STATUS_APPLIED': return `    状态：${e.status} ×${e.stacks}`;
    case 'LORD_SKILL_USED': return `  主公技：${e.skill}`;
    case 'GAME_OVER': return `\n═══ 对局结束：${e.winner === 'draw' ? '平局' : who(e.winner) + '胜利'} ═══`;
    case 'REJECTED': return `  ✗ 动作被拒：${e.reason}`;
    default: return null;
  }
}

function main(): void {
  const seed = Number(arg('seed', '2026'));
  const maxTurns = Number(arg('turns', '40'));
  const verbose = has('verbose');

  const cards = loadJson<unknown>('cards.json');
  const heroes = loadJson<unknown>('heroes.json');
  const unwrap = <T,>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : ((v as { cards: T[] }).cards ?? []));
  const data = loadData(
    { cards: unwrap(cards), heroes: unwrap(heroes) },
    { own: 'shu_liubei', enemy: 'wei_caocao' },
  );

  // 完整开局：掷点先手 → 换牌 → 开打（GDD 03 §1）
  const { state: base, log: setupLog } = setupMatch({
    seed,
    cards: data.cards,
    lords: data.lords,
    decks: { own: autoDeck(data, 'shu'), enemy: autoDeck(data, 'wei') },
    mulliganIndices: { own: [], enemy: [] },
  });
  const ctx: EngineContext = { cards: data.cards, lords: data.lords };
  let state: MatchState = startMatch(base, ctx).state;

  console.log(`\n《酒话三国》引擎冒烟测试  seed=${seed}`);
  console.log(`主公：${state.sides.own.lord.name} vs ${state.sides.enemy.lord.name}`);
  console.log(`先手：${state.active === 'own' ? '己方' : '敌方'}`);
  for (const l of setupLog) console.log(`  · ${l}`);
  console.log(`卡组：${state.sides.own.deck.length + state.sides.own.hand.length} vs ${state.sides.enemy.deck.length + state.sides.enemy.hand.length}\n`);

  let actions = 0;
  const log: Action[] = [];

  while (!state.winner && state.turn <= maxTurns) {
    const action = chooseAction(state, ctx);
    const a: Action = action ?? { type: 'END_TURN' };
    const r = applyAction(state, ctx, a);
    if (!r.ok) {
      console.log(`  ✗ 动作失败：${JSON.stringify(a)} → ${r.error}`);
      const end = applyAction(state, ctx, { type: 'END_TURN' });
      state = end.state;
      continue;
    }
    state = r.state;
    log.push(a);
    actions += 1;
    if (verbose) {
      for (const e of r.events) {
        const line = describe(e);
        if (line) console.log(line);
      }
    }
  }

  console.log('─'.repeat(46));
  console.log(`回合数：${state.turn}    动作数：${actions}`);
  console.log(`我方主将：${state.sides.own.lord.name} ${state.sides.own.lord.hp} 血${state.sides.own.lord.armor ? ` + ${state.sides.own.lord.armor} 甲` : ''}`);
  console.log(`敌方主将：${state.sides.enemy.lord.name} ${state.sides.enemy.lord.hp} 血${state.sides.enemy.lord.armor ? ` + ${state.sides.enemy.lord.armor} 甲` : ''}`);
  console.log(`结果：${state.winner === null ? '未分胜负（达到回合上限）' : state.winner === 'draw' ? '平局' : state.winner === 'own' ? '我方胜利' : '敌方胜利'}`);

  // 回放校验：用同一 seed 重放全部动作，状态必须一致
  // 用完全相同的开局参数重建（含掷点/酒令/换牌），才能逐动作比对
  const { state: replayBase } = setupMatch({
    seed,
    cards: data.cards,
    lords: data.lords,
    decks: { own: autoDeck(data, 'shu'), enemy: autoDeck(data, 'wei') },
    mulliganIndices: { own: [], enemy: [] },
  });
  let replay: MatchState = startMatch(replayBase, ctx).state;
  for (const a of log) {
    const r = applyAction(replay, ctx, a);
    if (r.ok) replay = r.state;
  }
  const same = JSON.stringify(replay) === JSON.stringify(state);
  console.log(`回放校验：${same ? '✓ 完全一致' : '✗ 不一致（存在非确定性！）'}\n`);
  process.exit(same ? 0 : 1);
}

main();
