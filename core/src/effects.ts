/**
 * 效果 DSL 解释器
 *
 * 对应 docs/gdd/13-balance-data-model.md §7。
 * 卡牌、事件、战法、技能全部通过这套 DSL 表达——**加卡不改代码**。
 */

import { BOARD, STATUSES, TIMING } from './constants.ts';
import { allUnits, applyMods, getUnit, hasCap, hasTrait, makeUnit, nextUidSeq, other, setUnit } from './state.ts';
import { handRef, removeStatus } from './mutate.ts';
import { effectiveAttack } from './rules.ts';
import type { Rng } from './rng.ts';
import type { CardDef, CardEffect, EffectCondition, GameEvent, HandCard, MatchState, Row, Side, SkillDef, TargetSelector, Unit } from './types.ts';
import {
  applyStatus, dealDamage, drawCard, gainArmor, healTarget, killUnit, lordRef, registerOnDeathResolver,
  registerOnDrawResolver,
  registerOnKillResolver, summonUnit, unitRef,
  type TargetRef,
} from './mutate.ts';

/**
 * 「抽到时释放」（ADR-050）：带 `trigger: 'on_draw'` 技能的卡被抽到时不进手牌，
 * 直接结算其效果并进弃牌堆。由 mutate.drawCard 通过挂载点回调。
 */
registerOnDrawResolver((state, cards, side, card, events, rng) => {
  const sk = (card.skills ?? []).find((k) => k.trigger === 'on_draw');
  if (!sk) return false;
  emitSkillTriggered(state, side, null, sk, 'trigger', events);
  runEffects(state, cards, sk.effects ?? [], { side }, rng, events);
  return true;
});

/** 亡语解析器：把 on_death 技能交给 DSL 解释器（ADR-050） */
registerOnDeathResolver((state, cards, side, unit, skills, events, rng, killer) => {
  for (const sk of skills) {
    emitSkillTriggered(state, side, unit, sk, 'trigger', events);
    runEffects(state, cards, sk.effects ?? [],
      { side, source: unit, killer: killer ?? undefined }, rng, events);
  }
});

// 「击杀时」挂载点（ADR-070）：华雄「威震四方」每次击杀 +1/+1
registerOnKillResolver((state, cards, killer, victim, events, rng) => {
  const k = getUnit(state, killer.side, killer.row, killer.col);
  if (!k || k.hp <= 0) return;
  const card = cards.get(k.cardId);
  const killSkills = (card?.skills ?? []).filter((sk) => sk.trigger === 'on_kill');
  for (const sk of killSkills) {
    emitSkillTriggered(state, killer.side, k, sk, 'trigger', events);
    runEffects(state, cards, sk.effects ?? [],
      { side: killer.side, source: k, eventVictim: victim, victimType: victim.type } as EffectContext,
      rng, events);
  }
});

export interface EffectContext {
  side: Side;            // 效果来源方
  source?: Unit;         // 来源单位（人物卡的技能）
  chosen?: TargetRef;    // 玩家选择的目标（`TargetSelector.pick` 缺省 = 1）
  /** 玩家的第二个选择（ADR-071，程昱「审时度势」）；`pick: 2` 的选择器读它 */
  chosen2?: TargetRef;
  chosenRow?: 'front' | 'back';
  /** 本次结算的「被击杀者」（on_kill 用，供亡语/条件引用，ADR-070） */
  eventVictim?: { name: string; side: Side; row: Row; col: number };
  /** 本次结算的「击杀者」（亡语要指向它时用，ADR-070） */
  killer?: { side: Side; row: Row; col: number };
  /** 本次被击杀者的类型（victim_type 条件用） */
  victimType?: string;
  chosenCol?: number;
  /** 本次结算中发生的事件标记（killed / clash_won…），供条件判定读取（ADR-033） */
  flags?: string[];
  /** 本次效果结算中各事件发生的次数；用于“每次击杀”类条件效果。 */
  eventCounts?: Record<string, number>;
  /** 光环收集模式（ADR-037）：非空时 modify 写入修正层而非直接改数值 */
  auraId?: string;
  /** discard mode:'choose' 时，指定弃掉手牌的第几张（ADR-049） */
  handIndex?: number;
  /** 抉择分支下标（ADR-071）：未指定/越界一律取 modes[0] */
  modeIndex?: number;
}

/**
 * 按 `TargetSelector.pick` 取对应的玩家选择（ADR-071）。
 *
 * 只提供 `action.target` 时，`pick: 2` 会退回第一个选择 ——
 * 这样 AI、测试与尚未支持多目标的 UI 都不会因为少传一个参数而空转。
 */
const pickOf = (ctx: EffectContext, sel?: TargetSelector): TargetRef | undefined =>
  sel?.pick === 2 ? (ctx.chosen2 ?? ctx.chosen) : ctx.chosen;

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

/** 卡牌类型是否落在选择器的 `type` 条件里（'character' = 三类人物卡） */
const matchesCardType = (t: string, want?: string): boolean => {
  if (!want) return true;
  if (want === 'character') return ['troop', 'general', 'strategist'].includes(t);
  return t === want;
};

/** 手牌过滤（ADR-038）：类型 + 性别（ADR-071） */
const matchesHandFilter = (
  hc: HandCard, f: NonNullable<TargetSelector['filter']> | undefined,
): boolean => {
  if (!f) return true;
  if (!matchesCardType(hc.card.type, f.type as string | undefined)) return false;
  if (f.gender && hc.card.gender !== f.gender) return false;
  if (f.faction && hc.card.faction !== f.faction) return false;
  if (typeof f.cost_max === 'number' && hc.card.cost > f.cost_max) return false;
  if (typeof f.cost_min === 'number' && hc.card.cost < f.cost_min) return false;
  if (f.keyword && !(hc.card.keywords ?? []).includes(f.keyword)) return false;
  if (f.card_id && hc.card.id !== f.card_id) return false;
  return true;
};

const matchesFilter = (
  u: Unit, f: NonNullable<TargetSelector['filter']>, row: string,
  srcCost?: number, srcAtk?: number, srcUid?: string,
): boolean => {
  if (!f) return true;
  // 排除来源自身（ADR-071）：陆抗「手里或场上友方将领」不该把自己算成目标
  if (f.exclude_source && srcUid !== undefined && u.uid === srcUid) return false;
  if (f.type) {
    if (f.type === 'character') { if (!['troop', 'general', 'strategist'].includes(u.type)) return false; }
    else if (u.type !== f.type) return false;
  }
  // 性别（ADR-071，貂蝉「祸国倾城」只认「男性角色」）
  if (f.gender && u.gender !== f.gender) return false;
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
  // 条件的与 / 或组合（ADR-074）：先判组合，再与其余字段相与
  if (cond.all_of?.length && !cond.all_of.every((c) => checkCondition(state, c, ctx, rng))) return false;
  if (cond.any_of?.length && !cond.any_of.some((c) => checkCondition(state, c, ctx, rng))) return false;
  // 来源单位本回合的行为（ADR-074，司马懿「谋定后动」）
  if (cond.acted_this_turn !== undefined) {
    const src = ctx.source;
    if (!src || !!src.actedThisTurn !== cond.acted_this_turn) return false;
  }
  if (cond.dealt_damage_this_turn !== undefined) {
    const src = ctx.source;
    if (!src || !!src.dealtDamageThisTurn !== cond.dealt_damage_this_turn) return false;
  }
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
  if (typeof cond.turn_max === 'number' && state.turn > cond.turn_max) return false;
  if (cond.victim_type) {
    const v = ctx.eventVictim;
    if (!v) return false;
    // eventVictim 只带了 name/side/坐标，类型需要从场上或阵亡前记录里取；
    // 由 ctx 传入 victimType（见 mutate.killUnit 的 on_kill 调用）
    if ((ctx as { victimType?: string }).victimType !== cond.victim_type) return false;
  }
  if (cond.chosen_side) {
    const t = ctx.chosen;
    if (!t) return false;
    const targetSide = t.side;
    return cond.chosen_side === 'ally' ? targetSide === ctx.side : targetSide !== ctx.side;
  }
  return true;
}

/**
 * 发一条「技能发动」事件（ADR-074）
 *
 * 客户端原先只能从 DAMAGE / STATUS_APPLIED 这些**效果**事件反推，
 * 「咆哮」「五雷轰顶」这种技能生效时玩家看不出发生了什么。
 * 引擎在技能真正执行的前一刻发这条事件，客户端据此播技能名提示。
 */
export function emitSkillTriggered(
  state: MatchState,
  side: Side,
  source: Unit | null,
  sk: SkillDef,
  from: 'on_play' | 'active' | 'trigger' | 'aura' | 'lord_skill' | 'card',
  events: GameEvent[],
): void {
  let row: Row | undefined;
  let col: number | undefined;
  if (source) {
    const pos = findPos(state, side, source.uid);
    if (pos) { row = pos.row; col = pos.col; }
  }
  events.push({
    type: 'SKILL_TRIGGERED', side, row, col,
    unitName: source?.name ?? '', skillName: sk.name || sk.id || '(技能)',
    skillId: sk.id || '', kind: sk.kind, timing: sk.trigger, from,
  });
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
      emitSkillTriggered(state, side, u, sk, 'trigger', events);
      runEffects(state, cards, effectsOf(sk), { side, source: u }, rng, events);
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
        // 每个单位生命周期只播报一次（见 Unit.auraAnnounced 的说明），否则光环重算会刷屏
        u.auraAnnounced = u.auraAnnounced ?? [];
        if (!u.auraAnnounced.includes(sk.id)) {
          u.auraAnnounced.push(sk.id);
          emitSkillTriggered(state, side, u, sk, 'aura', events);
        }
        runEffects(state, cards, effectsOf(sk),
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
        emitSkillTriggered(state, side, u, sk, 'trigger', events);
        runEffects(state, cards, effectsOf(sk), { side, source: u }, rng, events);
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
    emitSkillTriggered(state, side, unit, sk, 'trigger', events);
    runEffects(state, cards, effectsOf(sk), { side, source: unit }, rng, events);
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

/** 选择器指向哪些「方」——手牌与场上共用（pick 无关） */
function handSides(selector: TargetSelector, ctx: EffectContext): Side[] {
  const sideSel = selector.side ?? 'enemy';
  return sideSel === 'both' ? ['own', 'enemy']
    : sideSel === 'self' || sideSel === 'ally' ? [ctx.side] : [other(ctx.side)];
}

/**
 * 按 `mode` / `count` 收窄一个已算好的候选池（ADR-033）。
 *
 * 抽出来是为了让「手牌」与「场上」两条路径共用同一套选取语义 ——
 * 原先手牌路径自己写了一份 random/slice，`pick` / `lowest_health` 都享受不到。
 */
function narrowByMode(
  state: MatchState, pool: TargetRef[], selector: TargetSelector, rng: Rng,
): TargetRef[] {
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
  // mode === 'choose' 的「玩家选择」由调用方先行处理（见 resolveTargets），
  // 走到这里说明没有合法选择（AI / 测试 / UI 未传目标）→ 取前 n 个兜底
  return pool.slice(0, n);
}

/** 解析选择器 → 目标列表 */
export function resolveTargets(
  state: MatchState,
  selector: TargetSelector | undefined,
  ctx: EffectContext,
  rng: Rng,
): TargetRef[] {
  // 「本次事件的另一方单位」：华雄亡语要指向击杀者（ADR-070）
  if (selector?.event) {
    const k = selector.event === 'killer' ? ctx.killer : ctx.eventVictim;
    if (!k) return [];
    return [{ kind: 'unit' as const, side: k.side, row: k.row, col: k.col }];
  }
  if (!selector) return ctx.chosen ? [ctx.chosen] : [];

  // zone: 'hand' —— 作用于手牌而非场上（ADR-038）
  if (selector.zone === 'hand') {
    const out: TargetRef[] = [];
    for (const sd of handSides(selector, ctx)) {
      state.sides[sd].hand.forEach((hc, i) => {
        if (matchesHandFilter(hc, selector.filter)) out.push(handRef(sd, i));
      });
    }
    const pick = pickOf(ctx, selector);
    if (selector.mode !== 'random' && pick && out.some((t) => sameTarget(t, pick))) return [pick];
    return narrowByMode(state, out, selector, rng);
  }

  // lord: true —— 目标为该方主帅（ADR-036）
  // ADR-071：支持 `filter.has_status` —— 祖茂「替主」的光环靠它做到**幂等**
  // （主帅已经有「护主」时不再重复施加，否则每次光环重算都会刷一条事件）。
  if (selector.lord) {
    const sideSel = selector.side ?? 'enemy';
    const ls: Side[] = sideSel === 'both' ? ['own', 'enemy']
      : sideSel === 'self' || sideSel === 'ally' ? [ctx.side] : [other(ctx.side)];
    const f = selector.filter;
    const kept = ls.filter((sd) => {
      if (!f) return true;
      const lord = state.sides[sd].lord;
      if (f.has_status && !((lord.statuses?.[f.has_status]?.stacks ?? 0) > 0)) return false;
      if (f.faction && lord.faction !== f.faction) return false;
      return true;
    });
    return kept.map((x) => lordRef(x));
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
        if (matchesFilter(u, selector.filter ?? {}, r, ctx.source?.cost, ctx.source?.atk, ctx.source?.uid)) pool.push(unitRef(s, r, c));
      });
    }
  }
  // zone: 'both'（ADR-071，陆抗「手里或场上」）：把该方手牌也并入候选池。
  // adjacent_to 用不到手牌（恒为 panel 外），末尾的相邻过滤会把它们自然剔掉。
  if (selector.zone === 'both') {
    for (const sd of poolSides) {
      state.sides[sd].hand.forEach((hc, i) => {
        if (matchesHandFilter(hc, selector.filter)) pool.push(handRef(sd, i));
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
  const pick = pickOf(ctx, sel);

  if (sel.mode === 'choose' && pick && finalPool.some((t) => sameTarget(t, pick))) {
    return [pick];
  }
  return narrowByMode(state, finalPool, sel, rng);
}

/** 定位某单位在战场上的位置（连环普攻需要来源坐标） */
function findPos(state: MatchState, side: Side, uid: string): { row: Row; col: number } | null {
  for (const r of BOARD.ROWS) {
    const i = state.sides[side].rows[r].findIndex((u) => u?.uid === uid);
    if (i >= 0) return { row: r, col: i };
  }
  return null;
}

/** 目标身上的某类状态 id 列表（驱散用，ADR-071） */
function statusIdsOfKind(
  state: MatchState, ref: TargetRef, kind: 'buff' | 'debuff',
): string[] {
  const bags = ref.kind === 'unit'
    ? getUnit(state, ref.side, ref.row, ref.col)?.statuses
    : ref.kind === 'lord' ? state.sides[ref.side].lord.statuses : undefined;
  return Object.entries(bags ?? {})
    .filter(([id, inst]) => inst.stacks > 0 && STATUSES[id]?.kind === kind)
    .map(([id]) => id);
}

/**
 * 攻击时触发技（时机表 8½，ADR-036 / ADR-071 / ADR-072）
 *
 * **必须拆成两趟**，因为 `condition.event === 'killed'` 的真假只有伤害结算完才知道：
 *
 * · `before` —— 伤害**之前**跑「非击杀条件」的效果。
 *   姜维「文武双全」/魏延「桀骜不驯」的「攻击时攻击力 +1」必须赶在算攻击力之前，
 *   否则这一下吃不到加成（ADR-071）。
 * · `after`  —— 伤害**之后**，且**确实击杀了**目标时，才跑「击杀条件」的效果。
 *   张辽「冲锋陷阵」的溢出伤害、关兴「额外行动」写的都是 `condition: {event: killed}`；
 *   原先统一排在伤害之前 → 条件**永远为假**、技能等于白板（ADR-072 修）。
 *
 * 按**效果**而不是按技能拆分：同一个技能里可以既有 buff 又有击杀奖励。
 */
export function runOnAttackPhase(
  state: MatchState,
  cards: Map<string, CardDef>,
  attacker: Unit,
  phase: 'before' | 'after',
  killed: boolean,
  rng: Rng,
  events: GameEvent[],
): void {
  if (attacker.hp <= 0) return;
  const side = findSide(state, attacker.uid);
  if (!side) return;
  for (const sk of (attacker.skills ?? []).filter((x) => x.trigger === TIMING.ON_ATTACK)) {
    const effs = (sk.effects ?? []).filter((e) =>
      phase === 'after'
        ? e.condition?.event === 'killed'
        : e.condition?.event !== 'killed');
    if (!effs.length) continue;
    emitSkillTriggered(state, side, attacker, sk, 'trigger', events);
    runEffects(state, cards, effs,
      { side, source: attacker, flags: killed ? ['killed'] : [] }, rng, events);
  }
}

/**
 * 一次**普通攻击**的完整结算（ADR-071）
 *
 * 原先这段逻辑整体躺在 `engine.ts` 的 `attack()` 里，只有 `ATTACK` 动作能走。
 * 张苞「父子将风」（战吼时挨个对攻<自己的敌方人物发动普攻，直到自己阵亡）
 * 需要**同一条**路径 —— 复制一份必然导致反击 / 圣盾 / 饮血 / 奇袭 / 触发技
 * 各写各的并逐渐漂移，所以抽到这里由 engine 与 DSL 的 `attack_each` 共用。
 *
 * 调用方负责合法性判定（`legalTargets`）与目标选择；本函数只管结算。
 *
 * @param opts.consumeAttack 是否计入「本回合已攻击次数」。ATTACK 动作为 true；
 *        `attack_each`（战吼发动的一串普攻）为 false —— 它不占用该单位本回合的攻击机会。
 */
export function resolveAttack(
  state: MatchState,
  cards: Map<string, CardDef>,
  side: Side,
  from: { row: Row; col: number },
  to: { kind: 'unit'; row: Row; col: number } | { kind: 'lord' },
  events: GameEvent[],
  rng: Rng,
  opts: { consumeAttack?: boolean } = {},
): boolean {
  const attacker = getUnit(state, side, from.row, from.col);
  if (!attacker || attacker.hp <= 0) return false;
  const foe = other(side);

  events.push({ type: 'ATTACK_DECLARED', side, from: { ...from }, to });

  // 时机表 8½-before：攻击时触发技里**非击杀条件**的部分（ADR-036 / ADR-071）
  //
  // ⚠️ 必须排在**算攻击力之前**：姜维「文武双全」与魏延「桀骜不驯」写的是
  // 「攻击时攻击力 +1」。原先触发技排在伤害结算之后，于是这一下吃不到加成，
  // 加成从**下一次**攻击才开始生效（还没写 duration 时会永久累积）。
  // 带 `condition: {event: killed}` 的效果**不在这里**跑 —— 见 8½-after。
  runOnAttackPhase(state, cards, attacker, 'before', false, rng, events);

  // 触发技可能把攻击者自己弄死（如张苞连环普攻途中被反击带走）
  const me = getUnit(state, side, from.row, from.col);
  if (!me || me.hp <= 0) return false;

  const dmg = effectiveAttack(state, side, from.row, from.col);
  const hasYinXue = hasTrait(me, 'yin_xue');

  // 本次普攻有没有**击杀**目标 —— 8½-after 的击杀奖励据此判定（ADR-072）
  let killed = false;
  /** 本次普攻实际造成的伤害合计（ADR-074：司马懿② 要判"有没有对敌方造成伤害"） */
  let dealtTotal = 0;

  if (to.kind === 'lord') {
    const dealt = dealDamage(state, cards, lordRef(foe), dmg, events, me.name, 0,
      { side, row: from.row, col: from.col });
    dealtTotal += dealt;
    killed = state.sides[foe].lord.hp <= 0;
    if (hasYinXue) healTarget(state, unitRef(side, from.row, from.col), dealt, events);   // 饮血：回该单位自身（ADR-057）
  } else {
    const tRow = to.row;
    const tCol = to.col;
    const targetUnit = getUnit(state, foe, tRow, tCol);
    // 反击力 = 目标的**有效**攻击力（含振奋/虚弱等，与攻击方算法对称，ADR-059）。
    // 必须在造成伤害**之前**取值：伤害不改变攻击力，但目标可能被打死而离场。
    const retaliate = effectiveAttack(state, foe, tRow, tCol);

    const dealt = dealDamage(state, cards, unitRef(foe, tRow, tCol), dmg, events, me.name, 0,
      { side, row: from.row, col: from.col });
    dealtTotal += dealt;

    // 时机表第 16 步：受到伤害触发技（on_damaged）
    const hit = getUnit(state, foe, tRow, tCol);
    if (hit && hit.hp > 0) runUnitTrigger(state, cards, hit, 'on_damaged', rng, events);
    if (hit) runMarkDamaged(state, cards, hit, dmg, rng, events);

    // 反击（ADR-062，设计者裁定）：**同时结算**，与炉石一致。
    // 只要目标有攻击力，攻击方就吃下这一下 —— **哪怕目标已被打死**。
    // 目标 0 攻则无伤害；攻击方身上的「圣盾」（immune_damage）会在 dealDamage 里
    // 消耗一层并免掉本次伤害，这才是唯一的免疫途径。
    if (retaliate > 0) {
      dealDamage(state, cards, unitRef(side, from.row, from.col), retaliate, events, targetUnit?.name ?? '反击');
      const back = getUnit(state, side, from.row, from.col);
      if (back && back.hp > 0) runUnitTrigger(state, cards, back, 'on_damaged', rng, events);
    }
    if (hasYinXue) healTarget(state, unitRef(side, from.row, from.col), dealt, events);   // 饮血：回该单位自身（ADR-057）
    // 目标死了就已被 killUnit 移出战场；免死（survive）留下的 1 血算"没死"
    const hitAfter = getUnit(state, foe, tRow, tCol);
    killed = !hitAfter || hitAfter.hp <= 0;
  }

  const after = getUnit(state, side, from.row, from.col);
  if (after) {
    if (opts.consumeAttack !== false) after.attackedThisTurn += 1;
    after.actedThisTurn = true;                    // ADR-074：司马懿要判"本回合有没有行动"
    if (dealtTotal > 0) after.dealtDamageThisTurn = true;

    // 奇袭：攻击后失去隐身（ADR-054 的新定义还要求"上场自动隐身"，尚未实现，见 Q-06-*）
    if (hasTrait(after, 'qi_xi')) {
      after.kw = after.kw.filter((k) => k !== 'qi_xi');
      delete after.statuses.qi_xi_status;
      events.push({ type: 'STATUS_EXPIRED', side, row: from.row, col: from.col, status: 'qi_xi' });
    }

    // 攻击者自身可能已阵亡
    if (after.hp <= 0) {
      killUnit(state, cards, { side, row: from.row, col: from.col, unit: after }, events);
      recomputeAuras(state, cards, rng, events);   // 第 19 步：死亡后光环重算
    }
  }

  // 时机表 8½-after：击杀奖励（ADR-072）。位置有两个硬约束：
  // ① 必须在**整个伤害交换之后** —— 攻击者若已被反击打死，就不该再拿到击杀奖励；
  // ② 必须在本回合攻击次数 `+1` 的**记账之后** —— 否则关兴「额外行动」刚把次数清零，
  //    立刻又被这次攻击的记账加回去，额外行动等于白给（这条被测试抓到过）。
  const survivor = getUnit(state, side, from.row, from.col);
  if (survivor && survivor.hp > 0) {
    runOnAttackPhase(state, cards, survivor, 'after', killed, rng, events);
  }
  return true;
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
  'sacrifice', 'attack_each', 'draw_until', 'mill',
]);

/**
 * 抉择分支的取值（ADR-071）
 *
 * 有 `modes` 时以 `modeIndex` 为准；缺省 / 越界 / 非整数一律取 `modes[0]`，
 * 保证 AI、测试与尚未接入分支选择的 UI 都能跑。
 */
export function effectsOf(sk: SkillDef, modeIndex?: number): CardEffect[] {
  if (sk.modes?.length) {
    const i = typeof modeIndex === 'number' && Number.isInteger(modeIndex)
      && modeIndex >= 0 && modeIndex < sk.modes.length ? modeIndex : 0;
    return sk.modes[i]!.effects ?? [];
  }
  return sk.effects ?? [];
}

export function runEffects(
  state: MatchState,
  cards: Map<string, CardDef>,
  effects: CardEffect[] | undefined,
  ctx: EffectContext,
  rng: Rng,
  events: GameEvent[],
): void {
  if (!effects?.length) return;

  /** 该效果「没有解析出目标」时的兜底：取 pick 对应的玩家选择（ADR-071） */
  const chosenFor = (sel?: TargetSelector): TargetRef[] => {
    const p = pickOf(ctx, sel);
    return p ? [p] : [];
  };

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
            ? (targets.length ? targets : chosenFor(eff.target))
            : (eff.target ? resolveTargets(state, eff.target, ctx, rng) : chosenFor(eff.target));
          for (const t of list) {
            const before = hpOf(state, t);
            const victim = t.kind === 'unit' ? getUnit(state, t.side, t.row, t.col) : null;
            dealDamage(state, cards, t, val, events, ctx.source?.name ?? '效果');
            // 记录"本次造成了击杀"，供同一张卡的后续效果做条件判定
            if (before > 0 && hpOf(state, t) <= 0) {
              ctx.flags = ctx.flags ?? [];
              if (!ctx.flags.includes('killed')) ctx.flags.push('killed');
              ctx.eventCounts = ctx.eventCounts ?? {};
              ctx.eventCounts.killed = (ctx.eventCounts.killed ?? 0) + 1;
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
        const list = targets.length ? targets : chosenFor(eff.target);
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
        // 条件为 event:killed 时，召唤次数按本次效果实际击杀数结算，
        // 避免多次雷击只在效果列表末尾触发一次召唤（如张角五雷轰顶）。
        const eventCount = eff.condition?.event ? ctx.eventCounts?.[eff.condition.event] : undefined;
        const n = eventCount ?? eff.count ?? 1;
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
        // ADR-071：目标也可以是**手牌**（陆抗「谦冲如常」写的是「手里或场上友方将领」）——
        // 手牌不是 Unit，技能挂在 `card.skills` 上，取值路径不同。
        const src = ctx.source;
        if (!src) break;
        for (const t of targets) {
          const unit = t.kind === 'unit' ? getUnit(state, t.side, t.row, t.col) : null;
          const hc = t.kind === 'hand' ? state.sides[t.side].hand[t.index] : null;
          const skills = unit?.skills ?? hc?.card.skills;
          const ownerName = unit?.name ?? hc?.card.name;
          if (!skills?.length || !ownerName) continue;
          const sk = skills.find((x) => x.kind === 'active') ?? skills[0];
          if (!sk) continue;
          src.skills = src.skills ?? [];
          if (!src.skills.some((x) => x.id === sk.id)) {
            src.skills.push(structuredClone(sk));
            events.push({ type: 'SKILL_COPIED', side: ctx.side, from: ownerName, skill: sk.name });
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
            ? (targets.length ? targets : chosenFor(eff.target))
            : (eff.target ? resolveTargets(state, eff.target, ctx, rng) : chosenFor(eff.target));
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
            ? (targets.length ? targets : chosenFor(eff.target))
            : (eff.target ? resolveTargets(state, eff.target, ctx, rng) : chosenFor(eff.target));
          for (const t of list) {
            // 按**类别**批量驱散（ADR-071，华佗「青囊」的「清除其负面效果状态」）。
            // 只认具体状态 id 时得把 debuff 逐个列出来，漏一个就漏清一个。
            if (eff.remove_kind) {
              for (const id of statusIdsOfKind(state, t, eff.remove_kind)) {
                removeStatus(state, t, id, events, eff.stacks ?? eff.value ?? undefined);
              }
              continue;
            }
            removeStatus(state, t, eff.status as string, events, eff.stacks ?? eff.value ?? undefined);
          }
        }
        break;
      }
      case 'sacrifice': {
        // 牺牲己方单位并**记录它的血量**（ADR-071，程昱「审时度势」）：
        // 后续效果用既有的 `value_from_flag` 取用 —— flagVal 的优先级高于固定值，
        // 所以此刻写进 ctx.flags 就够，不必再给 DSL 加新的取值通道。
        //   sacrificed_max_hp —— 卡面写的「血量最大值」（治疗量）
        //   sacrificed_hp     —— 牺牲时的**当前**血量（伤害量；受过伤则更小）
        for (const t of (targets.length ? targets : chosenFor(eff.target))) {
          if (t.kind !== 'unit') continue;
          const u = getUnit(state, t.side, t.row, t.col);
          if (!u) continue;
          ctx.flags = ctx.flags ?? [];
          ctx.flags.push(`sacrificed_max_hp:${u.maxHp}`, `sacrificed_hp:${u.hp}`);
          killUnit(state, cards, { side: t.side, row: t.row, col: t.col, unit: u }, events);
          recomputeAuras(state, cards, rng, events);      // 第 19 步：死亡后光环重算
        }
        break;
      }
      case 'attack_each': {
        // 挨个发动**真正的普通攻击**（ADR-071，张苞「父子将风」）：
        // 目标集由技能自己的选择器给出（"攻 < 自己的敌方人物"），
        // 每次结算走 resolveAttack —— 反击、圣盾、饮血、奇袭全部与普攻一致。
        // 自己阵亡即停止，后续目标一点伤害都不吃。
        const src = ctx.source;
        if (!src) break;
        const pos = findPos(state, ctx.side, src.uid);
        if (!pos) break;
        const queue = targets.filter((t) => t.kind === 'unit');
        for (const t of queue) {
          if (state.winner) break;
          const cur = getUnit(state, ctx.side, pos.row, pos.col);
          if (!cur || cur.hp <= 0) break;                       // 自己阵亡 → 立刻停手
          if (!getUnit(state, t.side, t.row, t.col)) continue;  // 目标已被前一次攻击带走
          resolveAttack(state, cards, ctx.side, pos,
            { kind: 'unit', row: t.row, col: t.col }, events, rng, { consumeAttack: false });
        }
        break;
      }
      case 'mill': {
        // 弃掉目标方**牌库**的 N 张（ADR-074，司马懿「谋定后动」②"使敌方卡池随机丢弃一张"）。
        // 与 discard 的区别：discard 动的是**手牌**，mill 动的是还没抽到的牌。
        const who: Side = eff.target?.side === 'self' || eff.target?.side === 'ally'
          ? ctx.side : other(ctx.side);
        const deck = state.sides[who].deck;
        const n = dynVal ?? eff.count ?? 1;
        const fromDeck = eff.from_deck ?? 'random';
        for (let i = 0; i < n && deck.length; i++) {
          const at = fromDeck === 'top' ? 0 : rng.int(deck.length);
          const [id] = deck.splice(at, 1);
          const def = id ? cards.get(id) : undefined;
          if (def) state.sides[who].discard.push(def);
          events.push({ type: 'CARD_MILLED', side: who, cardId: id ?? '', from: fromDeck });
        }
        break;
      }
      case 'draw_until': {
        // 一直抽，直到抽出一张**不是** `until_not_type` 的牌（ADR-071，姜维「文武双全」）。
        // 牌库耗尽时 drawCard 会走「粮尽」且**不发 CARD_DRAWN** → 循环自然结束（与粮尽交互正确）；
        // 「断抽」同理（只发 DRAW_BLOCKED）。上限只是防呆，正常永远走不到。
        const stopType = eff.until_not_type ?? 'tactic';
        for (let guard = 0; guard < 60; guard++) {
          if (state.winner) break;
          const mark = events.length;
          drawCard(state, cards, ctx.side, events, rng);
          const drawn = events.slice(mark).reverse()
            .find((e): e is Extract<GameEvent, { type: 'CARD_DRAWN' }> => e.type === 'CARD_DRAWN');
          if (!drawn) break;                                        // 粮尽 / 断抽
          if (!matchesCardType(drawn.card.type, stopType)) break;    // 抽到非该类牌 → 停
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
        const list = targets.length ? targets : chosenFor(eff.target);
        for (const t of list) {
          if (t.kind === 'unit') {
            dealDamage(state, cards, t, 9999, events, '摧毁');
          }
        }
        break;
      }
      case 'modify': {
        const list = targets.length ? targets : chosenFor(eff.target);
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
