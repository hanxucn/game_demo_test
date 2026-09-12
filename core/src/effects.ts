/**
 * 效果 DSL 解释器
 *
 * 对应 docs/gdd/13-balance-data-model.md §7。
 * 卡牌、事件、战法、技能全部通过这套 DSL 表达——**加卡不改代码**。
 */

import { BOARD } from './constants.ts';
import { allUnits, getUnit, other } from './state.ts';
import type { Rng } from './rng.ts';
import type { CardDef, CardEffect, GameEvent, MatchState, Side, TargetSelector, Unit } from './types.ts';
import {
  applyStatus, dealDamage, drawCard, gainArmor, healTarget, lordRef, summonUnit, unitRef,
  type TargetRef,
} from './mutate.ts';

export interface EffectContext {
  side: Side;            // 效果来源方
  source?: Unit;         // 来源单位（人物卡的技能）
  chosen?: TargetRef;    // 玩家选择的目标
  chosenRow?: 'front' | 'back';
  chosenCol?: number;
}

/** 目标当前生命（主将/单位通用） */
const hpOf = (s: MatchState, t: TargetRef): number =>
  t.kind === 'lord' ? s.sides[t.side].lord.hp : (getUnit(s, t.side, t.row, t.col)?.hp ?? 0);

/** 两个目标引用是否指向同一个对象 */
const sameTarget = (a: TargetRef, b: TargetRef): boolean =>
  a.kind === b.kind && a.side === b.side && (
    a.kind === 'lord' ||
    (b.kind === 'unit' && a.row === b.row && a.col === b.col)
  );

const matchesFilter = (u: Unit, f: NonNullable<TargetSelector['filter']>, row: string): boolean => {
  if (!f) return true;
  if (f.type) {
    if (f.type === 'character') { if (!['troop', 'general', 'strategist'].includes(u.type)) return false; }
    else if (u.type !== f.type) return false;
  }
  if (f.keyword && !u.kw.includes(f.keyword)) return false;
  if (f.faction && u.faction !== f.faction) return false;
  if (f.row && row !== f.row) return false;
  if (typeof f.health_max === 'number' && u.hp > f.health_max) return false;
  if (f.has_status && !(u.statuses[f.has_status] > 0)) return false;
  return true;
};

/** 解析选择器 → 目标列表 */
export function resolveTargets(
  state: MatchState,
  selector: TargetSelector | undefined,
  ctx: EffectContext,
  rng: Rng,
): TargetRef[] {
  if (!selector) return ctx.chosen ? [ctx.chosen] : [];

  const sideSel = selector.side ?? 'enemy';
  const sides: Side[] =
    sideSel === 'both' ? ['own', 'enemy'] :
    sideSel === 'self' ? [ctx.side] :
    sideSel === 'ally' ? [ctx.side] :
    [other(ctx.side)];

  const pool: TargetRef[] = [];
  for (const s of sides) {
    for (const r of BOARD.ROWS) {
      state.sides[s].rows[r].forEach((u, c) => {
        if (u && matchesFilter(u, selector.filter ?? {}, r)) pool.push(unitRef(s, r, c));
      });
    }
  }

  if (selector.mode === 'random' && pool.length) {
    const n = selector.count === 'all' ? pool.length : (selector.count ?? 1);
    const picked: TargetRef[] = [];
    const copy = [...pool];
    for (let i = 0; i < n && copy.length; i++) {
      picked.push(copy.splice(rng.int(copy.length), 1)[0] as TargetRef);
    }
    return picked;
  }

  if (selector.count === 'all') return pool;
  const n = selector.count ?? 1;
  if (selector.mode === 'first') return pool.slice(0, n);
  if (selector.mode === 'lowest_health') {
    return [...pool].sort((a, b) => hpOf(state, a) - hpOf(state, b)).slice(0, n);
  }
  // mode === 'choose'：若调用方给了 chosen 且它在合法池内，就用它；否则取前 n 个（供 AI 使用）
  if (ctx.chosen && pool.some((t) => sameTarget(t, ctx.chosen as TargetRef))) {
    return [ctx.chosen];
  }
  return pool.slice(0, n);
}

/** 执行效果列表 */
export function runEffects(
  state: MatchState,
  cards: Map<string, CardDef>,
  effects: CardEffect[] | undefined,
  ctx: EffectContext,
  rng: Rng,
  events: GameEvent[],
): void {
  if (!effects?.length) return;

  for (const eff of effects) {
    const targets = eff.target ? resolveTargets(state, eff.target, ctx, rng) : [];
    switch (eff.action) {
      case 'damage': {
        const list = targets.length ? targets : (ctx.chosen ? [ctx.chosen] : []);
        for (const t of list) dealDamage(state, cards, t, eff.value ?? 0, events, ctx.source?.name ?? '效果');
        break;
      }
      case 'heal': {
        const list = targets.length ? targets : (ctx.chosen ? [ctx.chosen] : []);
        for (const t of list) healTarget(state, t, eff.value ?? 0, events);
        break;
      }
      case 'draw': {
        for (let i = 0; i < (eff.value ?? 1); i++) drawCard(state, cards, ctx.side, events);
        break;
      }
      case 'summon': {
        const empties: Array<{ row: 'front' | 'back'; col: number }> = [];
        for (const r of BOARD.ROWS) {
          for (let c = 0; c < BOARD.COLS; c++) {
            if (!state.sides[ctx.side].rows[r][c]) empties.push({ row: r, col: c });
          }
        }
        const n = eff.count ?? 1;
        for (let i = 0; i < n && empties.length; i++) {
          const idx = eff.position === 'random' ? rng.int(empties.length) : 0;
          const slot = empties.splice(idx, 1)[0]!;
          if (eff.unit) summonUnit(state, cards, ctx.side, slot.row, slot.col, eff.unit, events);
        }
        break;
      }
      case 'apply_status': {
        const list = targets.length ? targets : (ctx.chosen ? [ctx.chosen] : []);
        for (const t of list) {
          applyStatus(state, t, eff.status as string, eff.stacks ?? 1, events);
        }
        break;
      }
      case 'gain_armor':
        gainArmor(state, ctx.side, eff.value ?? 1, events);
        break;
      case 'gain_command': {
        // 本回合临时统率（传国玉玺等）
        const cmd = state.sides[ctx.side].command;
        cmd.cur = Math.min(cmd.max, cmd.cur + (eff.value ?? 1));
        break;
      }
      case 'destroy': {
        const list = targets.length ? targets : (ctx.chosen ? [ctx.chosen] : []);
        for (const t of list) {
          if (t.kind === 'unit') {
            dealDamage(state, cards, t, 9999, events, '摧毁');
          }
        }
        break;
      }
      case 'modify': {
        const list = targets.length ? targets : (ctx.chosen ? [ctx.chosen] : []);
        for (const t of list) {
          if (t.kind !== 'unit') continue;
          const u = getUnit(state, t.side, t.row, t.col);
          if (!u) continue;
          // 简化：直接改 atk/hp（用于 buff 类效果）
          if (typeof eff.value === 'number') {
            u.atk += eff.value;
            u.hp += eff.value;
            u.maxHp += eff.value;
          }
        }
        break;
      }
      default:
        // 未实现的动作：记录但不崩溃（校验器会告警）
        break;
    }
  }
}
