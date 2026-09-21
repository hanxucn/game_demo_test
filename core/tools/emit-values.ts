/**
 * 计算每张卡的数值核算块（value block），供归档与校验。
 *
 * 为什么单独一步：`value` 是**派生数据**（由 `cardValue()` 依当前度量算出），
 * 不能手写，也不该和卡面数据混在一起维护。所以：
 *   ① 本工具把结果写成 core/data/card-values.json（产物，可随时重算）
 *   ② tools/promote-cards.py --values 再把它并入 data/cards.yaml 的 `value:` 字段
 *   ③ core/tools/validate.ts 会**比对**cards.yaml 里的 value 块与实时计算结果，
 *      不一致就报错——这样派生的 value 块永远不会静默过期
 *
 * 用法（正常由 tools/build-cards.sh 串起来跑）：
 *   python3 tools/yaml2json.py
 *   node --experimental-strip-types core/tools/emit-values.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { budgetOf, cardValue } from './validate.ts';
import type { CardDef } from '../src/types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CARDS = join(ROOT, 'data', 'cards.json');
const OUT = join(ROOT, 'data', 'card-values.json');

/** 偏离预算的判定档位（与 validate.ts 保持一致） */
export type ValueLevel = 'ok' | 'watch' | 'off';
const level = (diff: number): ValueLevel =>
  Math.abs(diff) > 3 ? 'off' : Math.abs(diff) > 1.5 ? 'watch' : 'ok';

export interface ValueBlock {
  stats: number;
  keywords: number;
  skills: number;
  total: number;
  budget: number;
  diff: number;
  level: ValueLevel;
}

function main(): void {
  const cards = JSON.parse(readFileSync(CARDS, 'utf8')) as CardDef[];
  const byId = new Map(cards.map((c) => [c.id, c]));

  const out: Record<string, ValueBlock> = {};
  const tally = { ok: 0, watch: 0, off: 0 };
  for (const c of cards) {
    const v = cardValue(c, { cards: byId });
    const budget = budgetOf(c.cost);
    const diff = Number((v.total - budget).toFixed(2));
    const lv = level(diff);
    tally[lv] += 1;
    out[c.id] = {
      stats: v.stats,
      keywords: Number(v.keywords.toFixed(2)),
      skills: Number(v.skills.toFixed(2)),
      total: Number(v.total.toFixed(2)),
      budget,
      diff,
      level: lv,
    };
  }

  writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n', 'utf8');
  console.log(`✓ ${OUT.replace(`${ROOT}/`, '')}  ${cards.length} 张`);
  console.log(`  在容差内 ${tally.ok} / 需复核 ${tally.watch} / 超差 ${tally.off}`);
}

main();
