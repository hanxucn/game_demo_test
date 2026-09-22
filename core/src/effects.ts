/**
 * 效果 DSL 解释器
 *
 * 对应 docs/gdd/13-balance-data-model.md §7。
 * 卡牌、事件、战法、技能全部通过这套 DSL 表达——**加卡不改代码**。
 */

import { BOARD } from './constants.ts';
import { allUnits, applyMods, getUnit, hasCap, makeUnit, nextUidSeq, other, setUnit } from './state.ts';
import { effectiveCost, handRef, isBanned, removeStatus } from './mutate.ts';
import type { Rng } from './rng.ts';
import type { CardDef, CardEffect, EffectCondition, GameEvent, HandCard, MatchState, Row, Side, TargetSelector, Unit } from './types.ts';
import {
  applyStatus, dealDamage, drawCard, gainArmor, healTarget, lordRef, registerOnDeathResolver,
  registerOnDrawResolver,
  summonUnit, unitRef,
  type TargetRef,
} from './mutate.ts';

/**
 * 「抽到时释放」（ADR-050）：带 `trigger: 'on_draw'` 技能的卡被抽到时不进手牌，
 * 直接结算其效果并进弃牌堆。由 mutate.drawCard 通过挂载点回调。
 */
registerOnDrawResolver((state, cards, side, card, events, rng) => {
  const sk = (card.skills ?? []).find((k) => k.trigger === 'on_draw');
  if (!sk) return false;
  runEffects(state, cards, sk.effects ?? [], { side }, rng, events);
  return true;
});

/** 亡语解析器：把 on_death 技能交给 DSL 解释器（ADR-050） */
registerOnDeathResolver((state, cards, side, unit, skills, events, rng) => {
  for (const sk of skills) {
    runEffects(state, cards, sk.effects ?? [], { side, source: unit }, rng, events);
  }
});

export interface EffectContext {
  side: Side;            // 效果来源方
  source?: Unit;         // 来源单位（人物卡的技能）
  chosen?: TargetRef;    // 玩家选择的目标
  chosenRow?: 'front' | 'back';
  chosenCol?: number;
  /** 本次结算中发生的事件标记（killed / clash_won…），供条件判定读取（ADR-033） */
  flags?: string[];
  /** 光环收集模式（ADR-037）：非空时 modify 写入修正层而非直接改数值 */
  auraId?: string;
  /** discard mode:'choose' 时，指定弃掉手牌的第几张（ADR-049） */
  handIndex?: number;
}

/** 目标当前生命（主将/单位通用） */
const hpOf = (s: MatchState, t: TargetRef): number =>
  t.kind === 'lord' ? s.sides[t.side].lord.hp
  : t.kind === 'hand' ? 0
  : (getUnit(s, t.side, t.row, t.col)?.hp ?? 0);

/** 两个目标引用是否指向同一个对象 */
const sameTarget = (a: TargetRef, b: TargetRef): boolean =>
  a.kind === b.kind && a.side === b.side && (
    a.kind === 'lord' ||
    (a.kind === 'hand' && b.kind === 'hand' && a.index === b.index) ||
    (a.kind === 'unit' && b.kind === 'unit' && a.row === b.row && a.col === b.col)
  );

/** 手牌过滤（ADR-038）：目前只支持按类型筛 */
const matchesHandFilter = (
  hc: HandCard, f: NonNullable<TargetSelector['filter']> | undefined,
): boolean => {
  if (!f?.type) return true;
  if (f.type === 'character') return ['troop', 'general', 'strategist'].includes(hc.card.type);
  return hc.card.type === f.type;
};

const matchesFilter = (
  u: Unit, f: NonNullable<TargetSelector['filter']>, row: string,
  srcCost?: number, srcAtk?: number,
): boolean => {
  if (!f) return true;
  if (f.type) {
    if (f.type === 'character') { if (!['troop', 'general', 'strategist'].includes(u.type)) return false; }
    else if (u.type !== f.type) return false;
  }
  if (f.keyword && !u.kw.includes(f.keyword)) return false;
  if (f.tag && !(u.tags ?? []).includes(f.tag)) return false;
  if (f.faction && u.faction !== f.faction) return false;
  if (f.row && row !== f.row) return false;
  if (typeof f.health_max === 'number' && u.hp > f.health_max) return false;
  if (f.has_status && !((u.statuses[f.has_status]?.stacks ?? 0) > 0)) return false;
  if (typeof f.cost_max === 'number' && u.cost > f.cost_max) return false;
  if (typeof f.cost_min === 'number' && u.cost < f.cost_min) return false;
  if (f.troopKind && u.troopKind !== f.troopKind) return false;   // 兵种过滤（ADR-042）
  if (f.cost_below_source && srcCost !== undefined && u.cost >= srcCost) return false;
  // 攻击力低于来源单位（张飞「咆哮」：所有攻击力低于张飞的敌军）
  if (f.attack_below_source && srcAtk !== undefined && u.atk >= srcAtk) return false;
  // 指定具体卡（关平「勇武」亡语：使**关羽**获得圣盾）
  if (f.card_id && u.cardId !== f.card_id) return false;
  return true;
};

const cmp = (a: number, op: string, b: number): boolean =>
  op === '>=' ? a >= b : op === '<=' ? a <= b : op === '==' ? a === b
  : op === '>' ? a > b : op === '<' ? a < b : op === '!=' ? a !== b : false;

/**
 * 条件判定（ADR-033）。全部基于**当前局面的动态查询**，无隐藏状态。
 * `killed` 由本次效果结算过程写入 ctx.flags，供同一张卡的后续效果读取。
 */
function checkCondition(
  state: MatchState, cond: EffectCondition | undefined, ctx: EffectContext, rng: Rng,
): boolean {
  if (!cond) return true;
  if (cond.exists) {
    return resolveTargets(state, { ...cond.exists, count: 'all' }, ctx, rng).length > 0;
  }
  if (cond.count) {
    const n = resolveTargets(state, { ...cond.count.selector, count: 'all' }, ctx, rng).length;
    return cmp(n, cond.count.op, cond.count.value);
  }
  if (cond.count_vs) {
    const l = resolveTargets(state, { ...cond.count_vs.left, count: 'all' }, ctx, rng).length;
    const r = resolveTargets(state, { ...cond.count_vs.right, count: 'all' }, ctx, rng).length;
    return cmp(l, cond.count_vs.op, r);
  }
  if (cond.event) return (ctx.flags ?? []).includes(cond.event);
  // 按「所选目标属于哪一方」分支：ctx 的 side 是施法方，chosen.side 是目标方
  if (cond.chosen_side) {
    const t = ctx.chosen;
    if (!t) return false;
    const targetSide = t.side;
    return cond.chosen_side === 'ally' ? targetSide === ctx.side : targetSide !== ctx.side;
  }
  return true;
}

/**
 * 执行某一方所有单位的指定时机触发技（ADR-031）
 *
 * 时机表见 docs/gdd/10-skills-statuses.md §4：
 *   · 第 3 步  回合开始类效果 → turn_start
 *   · 第 20 步 回合结束类效果 → turn_end
 * 触发顺序按战场从左到右、前排到后排（确定性，保证回放可复现）。
 */
export function runTriggerSkills(
  state: MatchState,
  cards: Map<string, CardDef>,
  side: Side,
  trigger: string,
  rng: Rng,
  events: GameEvent[],
): void {
  for (const ref of allUnits(state, side)) {
    const u = ref.unit;
    if (u.hp <= 0) continue;
    for (const sk of (u.skills ?? []).filter((s) => s.trigger === trigger)) {
      runEffects(state, cards, sk.effects, { side, source: u }, rng, events);
    }
  }
}

/**
 * 卡牌自身费用规则（ADR-040）：每次计算费用时重新判定条件
 */
export function costRuleDelta(
  state: MatchState, card: CardDef, side: Side, rng: Rng,
): number {
  if (!card.cost_rule) return 0;
  return checkCondition(state, card.cost_rule.condition, { side }, rng) ? card.cost_rule.value : 0;
}

/**
 * 光环重算（ADR-037）
 *
 * ① 清除全部 aura 修正 → ② 遍历双方存活单位重新收集 → ③ 重写派生属性。
 * 必须在入场后、死亡后、回合开始、临时效果清除后各调用一次。
 */
export function recomputeAuras(
  state: MatchState,
  cards: Map<string, CardDef>,
  rng: Rng,
  events: GameEvent[],
): void {
  const sides: Side[] = ['own', 'enemy'];
  for (const side of sides) {
    // 清除上次光环留下的痕迹：属性修正、光环施加的状态、光环施加的手牌修正
    for (const ref of allUnits(state, side)) {
      ref.unit.mods = ref.unit.mods.filter((m) => m.kind !== 'aura');
      for (const [id, inst] of Object.entries(ref.unit.statuses)) {
        if (inst.auraId) delete ref.unit.statuses[id];
      }
    }
    for (const hc of state.sides[side].hand) {
      hc.mods = hc.mods.filter((m) => !m.auraId);
    }
    const lord = state.sides[side].lord;
    for (const [id, inst] of Object.entries(lord.statuses ?? {})) {
      if (inst.auraId) delete lord.statuses![id];
    }
  }
  for (const side of sides) {
    for (const ref of allUnits(state, side)) {
      const u = ref.unit;
      if (u.hp <= 0) continue;
      for (const sk of (u.skills ?? []).filter((s) => s.kind === 'aura')) {
        runEffects(state, cards, sk.effects,
          { side, source: u, auraId: `${u.uid}#${sk.id}` }, rng, events);
      }
    }
  }
  for (const side of sides) {
    for (const ref of allUnits(state, side)) applyMods(ref.unit);
  }
}

/**
 * 出牌事件触发（ADR-041）：任何卡被打出后，双方存活单位的 on_card_played 技能触发
 */
export function runCardPlayedTriggers(
  state: MatchState, cards: Map<string, CardDef>, played: CardDef,
  rng: Rng, events: GameEvent[],
): void {
  for (const side of ['own', 'enemy'] as Side[]) {
    for (const ref of allUnits(state, side)) {
      const u = ref.unit;
      if (u.hp <= 0) continue;
      for (const sk of (u.skills ?? []).filter((x) => x.trigger === 'on_card_played')) {
        // 条件里可用 played_type 过滤：只有指定类型的牌被打出时才触发
        const want: string | undefined = sk.target?.filter?.type;
        if (want === 'character') {
          if (!['troop', 'general', 'strategist'].includes(played.type)) continue;
        } else if (want && played.type !== want) continue;
        runEffects(state, cards, sk.effects, { side, source: u }, rng, events);
      }
    }
  }
}

/**
 * 仇敌标记联动（ADR-041）：被标记单位受伤时，运行标记者的 on_mark_damaged 技能
 */
export function runMarkDamaged(
  state: MatchState, cards: Map<string, CardDef>, victim: Unit, amount: number,
  rng: Rng, events: GameEvent[],
): void {
  const inst = victim.statuses.chou_di;
  if (!inst?.srcUid) return;
  for (const side of ['own', 'enemy'] as Side[]) {
    for (const ref of allUnits(state, side)) {
      const marker = ref.unit;
      if (marker.uid !== inst.srcUid || marker.hp <= 0) continue;
      for (const sk of (marker.skills ?? []).filter((x) => x.trigger === 'on_mark_damaged')) {
        runEffects(state, cards, sk.effects,
          { side, source: marker, flags: [`mark_amount:${amount}`] }, rng, events);
      }
    }
  }
}

/**
 * 阵亡联动（ADR-041）：被标记单位阵亡时，运行标记者的 on_mark_death 技能
 */
export function runMarkDeath(
  state: MatchState, cards: Map<string, CardDef>, dead: Unit, rng: Rng, events: GameEvent[],
): void {
  const inst = dead.statuses.chou_di_shou ?? dead.statuses.zhen_wang;
  if (!inst?.srcUid) return;
  for (const side of ['own', 'enemy'] as Side[]) {
    for (const ref of allUnits(state, side)) {
      const marker = ref.unit;
      if (marker.uid !== inst.srcUid || marker.hp <= 0) continue;
      for (const sk of (marker.skills ?? []).filter((x) => x.trigger === 'on_mark_death')) {
        runEffects(state, cards, sk.effects, { side, source: marker }, rng, events);
      }
    }
  }
}

/**
 * 执行**单个单位**的指定时机触发技（ADR-036）
 * 用于 on_attack / on_damaged 这类"由某个单位自己引发"的时机。
 */
export function runUnitTrigger(
  state: MatchState,
  cards: Map<string, CardDef>,
  unit: Unit,
  trigger: string,
  rng: Rng,
  events: GameEvent[],
): void {
  if (unit.hp <= 0) return;
  const side = findSide(state, unit.uid);
  if (!side) return;
  for (const sk of (unit.skills ?? []).filter((x) => x.trigger === trigger)) {
    runEffects(state, cards, sk.effects, { side, source: unit }, rng, events);
  }
}

/** 反查单位属于哪一方 */
function findSide(state: MatchState, uid: string): Side | null {
  for (const side of ['own', 'enemy'] as Side[]) {
    for (const r of BOARD.ROWS) {
      if (state.sides[side].rows[r].some((u) => u?.uid === uid)) return side;
    }
  }
  return null;
}

/** 定位某单位的列号（相邻判定用） */
function findCol(state: MatchState, side: Side, uid: string): number {
  for (const r of BOARD.ROWS) {
    const i = state.sides[side].rows[r].findIndex((u) => u?.uid === uid);
    if (i >= 0) return i;
  }
  return -1;
}

/** 某方场上最高的统率值（供拼点使用） */
function topCost(state: MatchState, side: Side): number {
  let max = 0;
  for (const r of BOARD.ROWS) {
    for (const u of state.sides[side].rows[r]) if (u && u.cost > max) max = u.cost;
  }
  return max;
}

/** 解析选择器 → 目标列表 */
export function resolveTargets(
  state: MatchState,
  selector: TargetSelector | undefined,
  ctx: EffectContext,
  rng: Rng,
): TargetRef[] {
  if (!selector) return ctx.chosen ? [ctx.chosen] : [];

  // zone: 'hand' —— 作用于手牌而非场上（ADR-038）
  if (selector.zone === 'hand') {
    const sideSel = selector.side ?? 'enemy';
    const hs: Side[] = sideSel === 'both' ? ['own', 'enemy']
      : sideSel === 'self' || sideSel === 'ally' ? [ctx.side] : [other(ctx.side)];
    const out: TargetRef[] = [];
    for (const sd of hs) {
      state.sides[sd].hand.forEach((hc, i) => {
        if (matchesHandFilter(hc, selector.filter)) out.push(handRef(sd, i));
      });
    }
    const n = selector.count === 'all' ? out.length : (selector.count ?? 1);
    if (selector.mode === 'random') {
      const copy = [...out], picked: TargetRef[] = [];
      for (let i = 0; i < n && copy.length; i++) picked.push(copy.splice(rng.int(copy.length), 1)[0]!);
      return picked;
    }
    return n === out.length ? out : out.slice(0, n);
  }

  // lord: true —— 目标为该方主帅（ADR-036）
  if (selector.lord) {
    const sideSel = selector.side ?? 'enemy';
    const ls: Side[] = sideSel === 'both' ? ['own', 'enemy']
      : sideSel === 'self' || sideSel === 'ally' ? [ctx.side] : [other(ctx.side)];
    return ls.map((x) => lordRef(x));
  }

  // source: true —— 只解析「来源单位自身」
  if (selector.source) {
    const src = ctx.source;
    if (!src) return [];
    for (const r of BOARD.ROWS) {
      for (let c = 0; c < BOARD.COLS; c++) {
        if (state.sides[ctx.side].rows[r][c]?.uid === src.uid) return [unitRef(ctx.side, r, c)];
      }
    }
    return [];
  }

  const sideSel = selector.side ?? 'enemy';
  const sides: Side[] =
    sideSel === 'both' ? ['own', 'enemy'] :
    sideSel === 'self' ? [ctx.side] :
    sideSel === 'ally' ? [ctx.side] :
    [other(ctx.side)];

  // 混乱（random_target，ADR-034）：目标池扩为**全场**，不分敌我
  const confused = hasCap(ctx.source ?? null, 'random_target');
  const poolSides: Side[] = confused ? ['own', 'enemy'] : sides;

  const pool: TargetRef[] = [];
  for (const s of poolSides) {
    for (const r of BOARD.ROWS) {
      state.sides[s].rows[r].forEach((u, c) => {
        if (!u) return;
        if (hasCap(u, 'untargetable')) return;          // 免疫/翻面：不能被指定为目标
        // 单挑锁定（ADR-041）：决斗中的单位不被第三方选中
        if (hasCap(u, 'duel_lock') && ctx.source && !hasCap(ctx.source, 'duel_lock')) return;
        if (matchesFilter(u, selector.filter ?? {}, r, ctx.source?.cost, ctx.source?.atk)) pool.push(unitRef(s, r, c));
      });
    }
  }
  // include_lord（ADR-051）：把该方主将也放进候选池，供「随机打敌方任意目标（含主将）」使用
  if (selector.filter?.include_lord) {
    for (const s of poolSides) {
      if (state.sides[s].lord.hp > 0) pool.push(lordRef(s));
    }
  }

  // 相邻（adjacent_to: self）：只保留与来源单位同列或左右相邻列的单位
  let finalPool = pool;
  if (selector.filter?.adjacent_to === 'self' && ctx.source) {
    const srcCol = ctx.source ? findCol(state, ctx.side, ctx.source.uid) : -1;
    finalPool = srcCol < 0 ? [] : pool.filter((t) =>
      t.kind === 'unit' && Math.abs(t.col - srcCol) <= 1);
  }

  const sel: TargetSelector = confused ? { ...selector, mode: 'random' } : selector;

  if (sel.mode === 'random' && finalPool.length) {
    const n = sel.count === 'all' ? finalPool.length : (sel.count ?? 1);
    const picked: TargetRef[] = [];
    const copy = [...finalPool];
    for (let i = 0; i < n && copy.length; i++) {
      picked.push(copy.splice(rng.int(copy.length), 1)[0] as TargetRef);
    }
    return picked;
  }

  if (sel.count === 'all') return finalPool;
  const n = sel.count ?? 1;
  if (sel.mode === 'first') return finalPool.slice(0, n);
  if (sel.mode === 'lowest_health') {
    return [...finalPool].sort((a, b) => hpOf(state, a) - hpOf(state, b)).slice(0, n);
  }
  // mode === 'choose'：若调用方给了 chosen 且它在合法池内，就用它；否则取前 n 个（供 AI 使用）
  if (ctx.chosen && pool.some((t) => sameTarget(t, ctx.chosen as TargetRef))) {
    return [ctx.chosen];
  }
  return pool.slice(0, n);
}

/** 执行效果列表 */
/**
 * 已在 `runEffects` 里实现的动作（ADR-066）。
 *
 * `ACTIONS` 是**注册表**（DSL 允许出现的名字），不等于**已实现**。
 * 两者不一致时，用该动作的卡会静默空转 —— 华佗「青囊」的 remove_status
 * 就这样空转了整整一轮。校验器现在拿它逐卡核对，杜绝再犯。
 */
export const IMPLEMENTED_ACTIONS: ReadonlySet<string> = new Set([
  'damage', 'heal', 'draw', 'summon', 'apply_status', 'remove_status',
  'destroy', 'modify', 'gain_armor', 'gain_command', 'cost_modifier', 'transform',
  'discard', 'return_to_hand', 'clash', 'flip', 'scry', 'ban_play', 'steal_card', 'survive',
  'extra_attack', 'take_control', 'copy_skill', 'force_attack',
  'add_to_deck', 'send_to_deck', 'cycle_to_deck',
]);

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
    // 概率：掷一次骰子，不中则跳过（ADR-033）
    if (typeof eff.chance === 'number' && rng.next() >= eff.chance) continue;
    // 条件：结算前查一次局面（ADR-033）
    if (!checkCondition(state, eff.condition, ctx, rng)) continue;

    // 动态取值：数值 = 命中集合的大小（ADR-033）
    const dyn = (sel?: TargetSelector): number | undefined =>
      sel ? resolveTargets(state, { ...sel, count: 'all' }, ctx, rng).length : undefined;
    const dynAtk = dyn(eff.attack_from), dynHp = dyn(eff.health_from);
    const dynVal = dyn(eff.value_from);
    // 取「最近被弃牌」的属性（ADR-040）
    const discardVal = (() => {
      if (!eff.value_from_discarded) return undefined;
      const last = (state as MatchState & { lastDiscarded?: { card: CardDef } }).lastDiscarded;
      if (!last) return undefined;
      return eff.value_from_discarded === 'cost' ? last.card.cost : (last.card.health ?? 0);
    })();
    const flagVal = eff.value_from_flag
      ? Number((ctx.flags ?? []).find((f) => f.startsWith(`${eff.value_from_flag}:`))?.split(':')[1])
      : undefined;
    const val = flagVal ?? discardVal ?? dynVal ?? eff.value ?? 0;   // 事件标记 > 弃牌属性 > 动态取值 > 固定值

    const targets = eff.target ? resolveTargets(state, eff.target, ctx, rng) : [];
    switch (eff.action) {
      case 'damage': {
        // count > 1 时重复结算，且每次**重新解析目标**（随机目标因此可命中不同单位）
        const times = eff.count ?? 1;
        for (let i = 0; i < times; i++) {
          const list = i === 0
            ? (targets.length ? targets : (ctx.chosen ? [ctx.chosen] : []))
            : (eff.target ? resolveTargets(state, eff.target, ctx, rng)
                          : (ctx.chosen ? [ctx.chosen] : []));
          for (const t of list) {
            const before = hpOf(state, t);
            const victim = t.kind === 'unit' ? getUnit(state, t.side, t.row, t.col) : null;
            dealDamage(state, cards, t, val, events, ctx.source?.name ?? '效果');
            // 记录"本次造成了击杀"，供同一张卡的后续效果做条件判定
            if (before > 0 && hpOf(state, t) <= 0) {
              ctx.flags = ctx.flags ?? [];
              if (!ctx.flags.includes('killed')) ctx.flags.push('killed');
            }
            // 时机表第 16 步：受到伤害触发技（存活才触发）
            if (victim && victim.hp > 0) runUnitTrigger(state, cards, victim, 'on_damaged', rng, events);
            // 仇敌标记联动（ADR-041）：无论是否存活都触发
            if (victim) runMarkDamaged(state, cards, victim, val, rng, events);
          }
        }
        break;
      }
      case 'heal': {
        const list = targets.length ? targets : (ctx.chosen ? [ctx.chosen] : []);
        for (const t of list) healTarget(state, t, val, events);
        break;
      }
      case 'draw': {
        for (let i = 0; i < (dynVal ?? eff.value ?? 1); i++) drawCard(state, cards, ctx.side, events);
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
      case 'discard': {
        // 弃牌（ADR-033）：作用对象是「一方的手牌」，不是场上单位
        const n = eff.count ?? 1;
        const sel = eff.target?.side ?? 'enemy';
        const sides: Side[] = sel === 'both' ? ['own', 'enemy']
          : sel === 'self' || sel === 'ally' ? [ctx.side] : [other(ctx.side)];
        for (const side of sides) {
          for (let i = 0; i < n && state.sides[side].hand.length; i++) {
            // mode: 'choose' → 用 ctx.handIndex 指定的那张（ADR-049）；
            // 未指定或越界则退回随机，绝不静默失败
            const want = eff.mode === 'choose' && side === ctx.side ? ctx.handIndex : undefined;
            const idx = typeof want === 'number' && want >= 0 && want < state.sides[side].hand.length
              ? want
              : rng.int(state.sides[side].hand.length);
            const [hc] = state.sides[side].hand.splice(idx, 1);
            if (!hc) continue;
            state.sides[side].discard.push(hc.card);
            (state as MatchState & { lastDiscarded?: unknown }).lastDiscarded = { card: hc.card, side };
            events.push({ type: 'CARD_DISCARDED', side, card: hc.card });
          }
        }
        break;
      }
      case 'add_to_deck': {
        // 往指定方的牌库**随机位置**插入 N 张指定卡（ADR-050，「万箭齐发」）
        const who: Side = eff.target?.side === 'enemy' ? other(ctx.side) : ctx.side;
        const def = cards.get(String(eff.unit ?? ''));
        if (!def) { events.push({ type: 'REJECTED', reason: `add_to_deck 的卡不存在：${eff.unit}` } as never); break; }
        const n = eff.count ?? 1;
        // to:'hand' → 直接进手牌（"获得一张"）；默认进牌库随机位置（"加入牌组"）
        if (eff.to === 'hand') {
          for (let i = 0; i < n; i++) {
            state.sides[who].hand.push({ card: def, mods: [] });
          }
        } else {
          for (let i = 0; i < n; i++) {
            const deck = state.sides[who].deck;
            deck.splice(rng.int(deck.length + 1), 0, def.id);
          }
        }
        events.push({ type: 'DECK_ADDED', side: who, card: def, count: n, to: eff.to === 'hand' ? 'hand' : 'deck' } as never);
        break;
      }
      case 'send_to_deck': {
        // 把「自己牌库里剩下的指定牌」全部塞进对方牌库（ADR-050，袁绍亡语）
        const to: Side = eff.target?.side === 'enemy' ? other(ctx.side) : ctx.side;
        const cid = String(eff.unit ?? '');
        const from = state.sides[ctx.side].deck;
        const moved: string[] = [];
        for (let i = from.length - 1; i >= 0; i--) {
          if (from[i] === cid) { from.splice(i, 1); moved.push(cid); }
        }
        for (const id of moved) {
          const deck = state.sides[to].deck;
          deck.splice(rng.int(deck.length + 1), 0, id);
        }
        events.push({ type: 'DECK_SENT', side: to, cardId: cid, count: moved.length });
        break;
      }
      case 'cycle_to_deck': {
        // 把手牌放回牌库**随机位置**，然后抽 1 张（ADR-050，孙权「坐断东南」置换模式）
        // 与 discard 的区别：牌回牌库可再抽到，不是永久损失
        const h = state.sides[ctx.side].hand;
        const idx = typeof ctx.handIndex === 'number' && ctx.handIndex >= 0 && ctx.handIndex < h.length
          ? ctx.handIndex : (h.length ? rng.int(h.length) : -1);
        if (idx < 0) break;
        const [hc] = h.splice(idx, 1);
        if (!hc) break;
        const deck = state.sides[ctx.side].deck;
        deck.splice(rng.int(deck.length + 1), 0, hc.card.id);
        events.push({ type: 'CARD_RETURNED_TO_DECK', side: ctx.side, card: hc.card });
        drawCard(state, cards, ctx.side, events, rng);
        break;
      }
      case 'return_to_hand': {
        // 返回手牌（ADR-033）：把场上单位收回其拥有者手牌
        for (const t of targets) {
          if (t.kind !== 'unit') continue;
          const u = getUnit(state, t.side, t.row, t.col);
          if (!u) continue;
          const def = cards.get(u.cardId);
          state.sides[t.side].rows[t.row][t.col] = null;
          if (def) state.sides[t.side].hand.push({ card: def, mods: [] });
          events.push({ type: 'UNIT_RETURNED', side: t.side, row: t.row, col: t.col, unit: u });
        }
        break;
      }
      case 'clash': {
        // 拼点（ADR-033/034）：双方各掷点，结果写入 flags 供后续 condition 判定
        //   mode: 'roll' —— 各掷 1–6；mode: 'cost' —— 比统率值（同值则掷点决胜）
        const foe = eff.target?.side === 'self' || eff.target?.side === 'ally'
          ? ctx.side : other(ctx.side);
        const mine = ctx.source?.cost ?? 0;
        const his = topCost(state, foe);
        const mode = eff.clashMode ?? 'roll';
        const a = mode === 'cost' ? mine : rng.int(6) + 1;
        const b = mode === 'cost' ? his : rng.int(6) + 1;
        const win = mode === 'cost' && a !== b ? a > b : a >= b;
        ctx.flags = ctx.flags ?? [];
        ctx.flags.push(win ? 'clash_won' : 'clash_lost');
        events.push({ type: 'CLASH', side: ctx.side, mine: a, theirs: b, won: win });
        break;
      }
      case 'cost_modifier': {
        // 手牌费用修正（ADR-038）：作用于 zone:'hand' 选出的手牌
        const value = eff.value ?? 0;
        const turns = typeof eff.duration === 'number' ? eff.duration
          : eff.duration === 'this_turn' ? 1 : undefined;
        for (const t of targets) {
          if (t.kind !== 'hand') continue;
          const hc = state.sides[t.side].hand[t.index];
          if (!hc) continue;
          hc.mods.push({ id: `cost#${nextUidSeq(state)}`, kind: 'cost', value, turns, auraId: ctx.auraId });
          events.push({ type: 'HAND_MODIFIED', side: t.side, index: t.index, kind: 'cost', value, turns });
        }
        break;
      }
      case 'ban_play': {
        // 禁止上场（ADR-038）：被禁的手牌无法打出，直到到期
        const turns = typeof eff.duration === 'number' ? eff.duration
          : eff.duration === 'this_turn' ? 1 : undefined;
        for (const t of targets) {
          if (t.kind !== 'hand') continue;
          const hc = state.sides[t.side].hand[t.index];
          if (!hc) continue;
          hc.mods.push({ id: `ban#${nextUidSeq(state)}`, kind: 'ban', turns, auraId: ctx.auraId });
          events.push({ type: 'HAND_MODIFIED', side: t.side, index: t.index, kind: 'ban', turns });
        }
        break;
      }
      case 'steal_card': {
        // 夺取手牌（ADR-038）：从目标方手牌随机取一张，收进己方手牌或强制上场
        const from: Side = eff.target?.side === 'self' || eff.target?.side === 'ally'
          ? ctx.side : other(ctx.side);
        const n = eff.count ?? 1;
        for (let i = 0; i < n && state.sides[from].hand.length; i++) {
          const idx = rng.int(state.sides[from].hand.length);
          const [hc] = state.sides[from].hand.splice(idx, 1);
          if (!hc) continue;
          const def = hc.card;
          const isChar = ['troop', 'general', 'strategist'].includes(def.type);
          if (eff.to === 'board' && isChar) {
            // 强制上场：放到己方随机空格
            const empties: Array<{ row: 'front' | 'back'; col: number }> = [];
            for (const r of BOARD.ROWS) {
              for (let c = 0; c < BOARD.COLS; c++) {
                if (!state.sides[ctx.side].rows[r][c]) empties.push({ row: r, col: c });
              }
            }
            if (empties.length) {
              const slot = empties[rng.int(empties.length)]!;
              const u = makeUnit(def, state.turn, nextUidSeq(state));
              setUnit(state, ctx.side, slot.row, slot.col, u);
              events.push({ type: 'UNIT_SUMMONED', side: ctx.side, row: slot.row, col: slot.col, unit: u });
              continue;
            }
          }
          state.sides[ctx.side].hand.push({ card: def, mods: [] });
          events.push({ type: 'CARD_STOLEN', from, to: ctx.side, card: def });
        }
        break;
      }
      case 'transform': {
        // 进化（ADR-042）：把目标单位换成另一张卡的定义，保留伤害/状态/攻击次数
        const toId = String(eff.to ?? '');
        const toCard = cards.get(toId);
        if (!toCard) {
          // 不静默失败：进化目标卡必须存在于卡表（数据错误要能看见）
          events.push({ type: 'REJECTED', reason: `进化目标卡不存在：${toId}` } as never);
          break;
        }
        for (const t of targets) {
          if (t.kind !== 'unit') continue;
          const u = getUnit(state, t.side, t.row, t.col);
          if (!u) continue;
          const fromId = u.cardId;
          const taken = u.maxHp - u.hp;                    // 已受伤害，进化后保留
          u.cardId = toCard.id;
          u.name = toCard.name;
          u.baseAtk = toCard.attack ?? 0;
          u.baseMaxHp = toCard.health ?? 1;
          u.kw = [...(toCard.keywords ?? [])];             // 关键词替换
          u.skills = toCard.skills ? structuredClone(toCard.skills) : undefined;
          u.troopKind = toCard.troopKind;
          applyMods(u);
          u.hp = Math.max(1, u.maxHp - taken);             // 保留伤害（不白送治疗）
          // 攻击次数不重置：attackedThisTurn 保持原值
          events.push({ type: 'UNIT_TRANSFORMED', side: t.side, row: t.row, col: t.col,
                        from: fromId, to: toCard.id, unit: u });
        }
        break;
      }
      case 'survive': {
        // 免死（ADR-039）：把单位从濒死抬回 1 血（由 killUnit 在致命伤害时调用）
        for (const t of targets) {
          if (t.kind !== 'unit') continue;
          const u = getUnit(state, t.side, t.row, t.col);
          if (!u) continue;
          u.hp = 1;
          events.push({ type: 'UNIT_SURVIVED', side: t.side, row: t.row, col: t.col, unit: u });
        }
        break;
      }
      case 'extra_attack': {
        // 额外行动（ADR-041）：重置攻击次数，允许本回合再攻击一次
        for (const t of targets) {
          if (t.kind !== 'unit') continue;
          const u = getUnit(state, t.side, t.row, t.col);
          if (!u) continue;
          u.attackedThisTurn = Math.max(0, u.attackedThisTurn - 1);
          events.push({ type: 'EXTRA_ATTACK', side: t.side, row: t.row, col: t.col });
        }
        break;
      }
      case 'take_control': {
        // 控制权转移（ADR-041）：把目标单位移到己方随机空格，turns 后归还
        const backSide: Side = eff.target?.side === 'self' || eff.target?.side === 'ally'
          ? ctx.side : other(ctx.side);
        for (const t of targets) {
          if (t.kind !== 'unit') continue;
          const u = getUnit(state, t.side, t.row, t.col);
          if (!u) continue;
          const empties: Array<{ row: Row; col: number }> = [];
          for (const r of BOARD.ROWS) {
            for (let c = 0; c < BOARD.COLS; c++) if (!state.sides[ctx.side].rows[r][c]) empties.push({ row: r, col: c });
          }
          if (!empties.length) continue;
          state.sides[t.side].rows[t.row][t.col] = null;
          const slot = empties[rng.int(empties.length)]!;
          setUnit(state, ctx.side, slot.row, slot.col, u);
          events.push({ type: 'CONTROL_TAKEN', from: backSide, to: ctx.side, unit: u });
        }
        break;
      }
      case 'copy_skill': {
        // 复制技能（ADR-041）：把目标单位的一个技能复制给来源单位
        const src = ctx.source;
        if (!src) break;
        for (const t of targets) {
          if (t.kind !== 'unit') continue;
          const u = getUnit(state, t.side, t.row, t.col);
          const sk = (u?.skills ?? []).find((x) => x.kind === 'active') ?? u?.skills?.[0];
          if (!u || !sk) continue;
          src.skills = src.skills ?? [];
          if (!src.skills.some((x) => x.id === sk.id)) {
            src.skills.push(structuredClone(sk));
            events.push({ type: 'SKILL_COPIED', side: ctx.side, from: u.name, skill: sk.name });
          }
        }
        break;
      }
      case 'force_attack': {
        // 强制攻击（ADR-041）：令目标单位立刻攻击其友方（由敌方操控）
        for (const t of targets) {
          if (t.kind !== 'unit') continue;
          const u = getUnit(state, t.side, t.row, t.col);
          if (!u || u.hp <= 0) continue;
          const foes = allUnits(state, other(t.side)).filter((x) => x.unit.hp > 0);
          if (!foes.length) continue;
          const victim = foes[rng.int(foes.length)]!;
          dealDamage(state, cards, unitRef(victim.side, victim.row, victim.col),
                     u.atk, events, u.name);
          events.push({ type: 'FORCED_ATTACK', side: t.side, row: t.row, col: t.col });
        }
        break;
      }
      case 'flip': {
        // 翻面（ADR-059）：当回合不能行动、不能被指定为目标；下个回合开始翻回正面
        for (const t of targets) {
          if (t.kind !== 'unit') continue;
          applyStatus(state, t, 'fan_mian', 1, events);
          const u = getUnit(state, t.side, t.row, t.col);
          if (u) events.push({ type: 'UNIT_FLIPPED', side: t.side, row: t.row, col: t.col, to: 'back', unit: u });
        }
        break;
      }
      case 'scry': {
        // 卡池操作（ADR-036）：查看/移动牌库顶或底的牌
        const who: Side = eff.target?.side === 'self' || eff.target?.side === 'ally'
          ? ctx.side : other(ctx.side);
        const deck = state.sides[who].deck;
        const n = eff.count ?? 1;
        const fromTop = (eff.from ?? 'top') === 'top';
        for (let i = 0; i < n && deck.length; i++) {
          const id = fromTop ? deck.shift()! : deck.pop()!;
          if (eff.to === 'deck_bottom') deck.push(id);
          else if (eff.to === 'deck_top') deck.unshift(id);
          else { const def = cards.get(id); if (def) state.sides[who].hand.push({ card: def, mods: [] }); }
          events.push({ type: 'CARD_SCRYED', side: who, cardId: id, from: fromTop ? 'top' : 'bottom' });
        }
        break;
      }
      case 'apply_status': {
        // count > 1 时重复结算，且每次**重新解析目标**（与 damage 同构，ADR-056）。
        // 张角「五雷轰顶」需要「5 次雷击各 50% 概率震慑」——原先 count 被忽略，
        // 而估值公式（ADR-046）却已按次数计价，两边不一致，此处补齐。
        const times = eff.count ?? 1;
        const turns = typeof eff.duration === 'number' ? eff.duration
          : eff.duration === 'this_turn' ? 1 : undefined;
        const srcUid = eff.status_source === 'self' ? ctx.source?.uid : undefined;
        for (let i = 0; i < times; i++) {
          const list = i === 0
            ? (targets.length ? targets : (ctx.chosen ? [ctx.chosen] : []))
            : (eff.target ? resolveTargets(state, eff.target, ctx, rng)
                          : (ctx.chosen ? [ctx.chosen] : []));
          for (const t of list) {
            applyStatus(state, t, eff.status as string, eff.stacks ?? 1, events, turns, srcUid, ctx.auraId);
          }
        }
        break;
      }
      case 'remove_status': {
        // 驱散（ADR-066）：与 apply_status 同构 —— count 次结算，每次重新解析目标。
        // 省略 value/stacks = 移除该状态的全部层数（华佗「青囊」即此用法）。
        const times = eff.count ?? 1;
        for (let i = 0; i < times; i++) {
          const list = i === 0
            ? (targets.length ? targets : (ctx.chosen ? [ctx.chosen] : []))
            : (eff.target ? resolveTargets(state, eff.target, ctx, rng)
                          : (ctx.chosen ? [ctx.chosen] : []));
          for (const t of list) {
            removeStatus(state, t, eff.status as string, events, eff.stacks ?? eff.value ?? undefined);
          }
        }
        break;
      }
      case 'gain_armor':
        gainArmor(state, ctx.side, eff.value ?? 1, events);
        break;
      case 'gain_command': {
        // 本回合临时统率（gain_command）
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
          // modify：attack / health 可单独指定（ADR-030）；都没给则退回 value 同时加
          const dAtk = dynAtk ?? eff.attack ?? (eff.health === undefined ? eff.value : 0) ?? 0;
          const dHp = dynHp ?? eff.health ?? (eff.attack === undefined ? eff.value : 0) ?? 0;
          if (!dAtk && !dHp) continue;

          // 光环模式（ADR-037）：写入修正层，由重算统一生效，不在此处直接改数值
          if (ctx.auraId) {
            u.mods.push({ id: ctx.auraId, kind: 'aura',
                          attack: dAtk || undefined, health: dHp || undefined });
            continue;
          }

          // 普通模式：写入修正层后立即重算
          const turns = typeof eff.duration === 'number' ? eff.duration
            : eff.duration === 'this_turn' ? 1 : undefined;
          u.mods.push({
            id: `mod#${nextUidSeq(state)}`,
            kind: turns === undefined ? 'permanent' : 'temp',
            attack: dAtk || undefined, health: dHp || undefined, turns,
          });
          applyMods(u);
          events.push({ type: 'STAT_MODIFIED', side: t.side, row: t.row, col: t.col,
                        attack: dAtk || undefined, health: dHp || undefined,
                        duration: eff.duration });
        }
        break;
      }
      default:
        // 未实现的动作：记录但不崩溃（校验器会告警）
        break;
    }
  }
}
