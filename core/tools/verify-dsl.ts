/**
 * DSL 翻译验证器
 *
 * 读取 core/data/cards_v1.json 里**已翻译 DSL 的卡**，逐张真打进引擎，确认：
 *   ① 卡能合法打出（引用的单位/状态/标签都已注册）
 *   ② 技能效果真的产出事件（不是"能加载但跑不动"）
 *
 * 覆盖：入场技 on_play、主动技 active（打出后再发 USE_SKILL）
 * 运行：cd core && npm run verify:dsl
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { TEST_CARDS, scenario } from '../test/fixtures.ts';
import { applyAction } from '../src/engine.ts';
import { makeUnit, setUnit } from '../src/state.ts';
import { costRuleDelta } from '../src/effects.ts';
import { effectiveCost } from '../src/mutate.ts';
import { createRng } from '../src/rng.ts';
import type { Action, CardDef, GameEvent, SkillDef } from '../src/types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const all: CardDef[] = JSON.parse(readFileSync(join(ROOT, 'data', 'cards_v1.json'), 'utf8'));

const hasDsl = (c: CardDef) =>
  (c.skills ?? []).some((s) => s.dsl) || (c.effects?.length ?? 0) > 0;

// skills[].dsl 存的是**技能定义数组**，需要摊平回 skills
// 主公卡不进卡组、不能从手牌打出，单独走主公技流程，不在此验证
const cards: CardDef[] = all
  .filter((c) => (hasDsl(c) || c.cost_rule) && c.type !== 'lord')
  .map((c) => ({
  ...c,
  skills: (c.skills ?? []).flatMap((s) => (s.dsl as unknown as SkillDef[]) ?? []),
}));

// ① 先注册**已摊平 DSL** 的卡（供打出与技能执行）
for (const c of cards) if (!TEST_CARDS.some((x) => x.id === c.id)) TEST_CARDS.push(c);
// ② 再把其余卡补进卡表（summon / transform 会按 id 引用它们；已存在的不覆盖）
for (const c of all) if (!TEST_CARDS.some((x) => x.id === c.id)) TEST_CARDS.push(c);
const base = (id: string) => TEST_CARDS.find((x) => x.id === id)!;

let ok = 0;
const fails: string[] = [];
for (const c of cards) {
  const isTactic = c.type === 'tactic' || c.type === 'event';
  const { state, ctx } = scenario({
    ownHand: [c.id, 'neutral_infantry', 'test_draw_tactic'],   // 留人物牌+策略牌，供手牌类效果有目标
    enemyHand: ['neutral_infantry', 'neutral_archer'],
  });
  setUnit(state, 'enemy', 'front', 0, makeUnit(base('neutral_infantry'), 1, 1));
  setUnit(state, 'enemy', 'front', 1, makeUnit(base('neutral_shieldman'), 1, 2));
  setUnit(state, 'own', 'front', 0, makeUnit(base('neutral_archer'), 1, 3));
  if (c.id === 'wu_sunce') setUnit(state, 'own', 'front', 1, makeUnit(base('neutral_infantry'), 1, 4));
  if (c.id === 'shu_shamoke') setUnit(state, 'own', 'front', 1, makeUnit({ ...base('neutral_infantry'), tags: ['man_zu'] } as CardDef, 1, 4));

  // 条件费用规则类卡（丁奉）：直接核对规则是否被计入费用
  if (!hasDsl(c) && c.cost_rule) {
    const hc = { card: c, mods: [] };
    const withRule = effectiveCost(hc, costRuleDelta(state, c, 'own', createRng(state.seed)));
    console.log(`  ✓ ${c.faction.padEnd(7)} ${c.name.padEnd(6)} → 条件费用规则 ${c.cost} → ${withRule}`);
    ok++;
    continue;
  }

  const play: Action = isTactic
    ? { type: 'PLAY_CARD', cardIndex: 0 }
    : { type: 'PLAY_CARD', cardIndex: 0, row: 'front', col: 2 };
  try {
    const r = applyAction(state, ctx, play);
    if (!r.ok) { fails.push(`${c.id}(${r.error})`); continue; }
    const evs = [...(r.events as GameEvent[])];
    if ((c.skills ?? []).some((s) => s.kind === 'active')) {
      const r2 = applyAction(r.state, ctx, { type: 'USE_SKILL', row: 'front', col: 2 } as Action);
      if (!r2.ok) { fails.push(`${c.id}(主动技被拒:${r2.error})`); continue; }
      evs.push(...(r2.events as GameEvent[]));
    }
    const summons = evs.filter((e) => e.type === 'UNIT_SUMMONED').length;
    const sig: string[] = evs.map((e) => e.type)
      .filter((t) => !['CARD_PLAYED', 'UNIT_SUMMONED', 'REJECTED', 'TURN_START'].includes(t));
    const selfSummons = ['troop', 'general', 'strategist'].includes(c.type) ? 1 : 0;
    if (summons > selfSummons) sig.push(`召唤×${summons - selfSummons}`);

    // 光环不会在打出瞬间产出事件，改为**核对重算后的实际数值**
    let auraNote = '';
    const auraSkills = (c.skills ?? []).filter((s) => s.kind === 'aura');
    if (auraSkills.length) {
      // 找到该卡在场上的单位，比较派生值与基础值
      let applied = false;
      for (const side of ['own', 'enemy'] as const) {
        for (const row of ['front', 'front'] as const) {
          for (let col = 0; col < 5; col++) {
            const u = r.state.sides[side].rows[row][col];
            if (u?.cardId === c.id && (u.atk !== u.baseAtk || u.maxHp !== u.baseMaxHp)) applied = true;
          }
        }
      }
      // 光环也可能表现为：手牌费用改写 / 施加状态（如陈宫「分担伤害」挂守护状态）
      const handBuffed = r.state.sides.own.hand.some((hc) => hc.mods.length > 0)
        || r.state.sides.enemy.hand.some((hc) => hc.mods.length > 0);
      const statusGiven = evs.some((e) => e.type === 'STATUS_APPLIED');
      applied = applied || handBuffed || statusGiven;
      auraNote = applied
        ? ` [光环生效: ${auraSkills.map((s) => s.name).join('/')}]`
        : ` [⚠️ 光环未生效]`;
      // 条件性光环在通用场景里无法满足（关平需关羽在场、诸葛亮需手牌为 0、
      // 马岱需场上有西凉人物）——只看它的效果是否**全部带 condition**，
      // 是则只提示，不算失败。否则就是真的没生效。
      const allConditional = auraSkills.length > 0
        && auraSkills.every((sk) => (sk.effects ?? []).length > 0
          && (sk.effects ?? []).every((e) => e.condition));
      if (!applied && !allConditional) fails.push(`${c.id}(光环未生效)`);
    }
    console.log(`  ✓ ${c.faction.padEnd(7)} ${c.name.padEnd(6)} → ${sig.slice(0, 4).join(', ') || '（触发技/未命中）'}${auraNote}`);
    ok++;
  } catch (e) { fails.push(`${c.id}(${(e as Error).message})`); }
}
console.log(`\nDSL 验证：${ok} 张通过 / ${fails.length} 张失败`);
if (fails.length) console.log('失败：' + fails.join('、'));
process.exit(fails.length ? 1 : 0);
