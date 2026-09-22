/**
 * 状态变更原语（低层）
 *
 * effects.ts 与 engine.ts 都通过这里改动状态，保证：
 *  - 所有伤害/治疗/死亡都走同一套结算顺序（docs/gdd/10-skills-statuses.md §4）
 *  - 所有变更都产生事件（客户端只消费事件）
 */

import { BOARD, DECK, STATUSES } from './constants.ts';
import { createRng } from './rng.ts';
import { allUnits, applyMods, getUnit, hasCap, hasCapOn, hasKeyword, hasTrait, makeUnit, nextUidSeq, other, setUnit, statusStacks } from './state.ts';
import type { CardDef, CardType, GameEvent, HandCard, MatchState, Row, Side, SkillDef, Unit } from './types.ts';

export type TargetRef =
  | { kind: 'unit'; side: Side; row: Row; col: number }
  | { kind: 'lord'; side: Side }
  | { kind: 'hand'; side: Side; index: number };   // 手牌（ADR-038）

export const unitRef = (side: Side, row: Row, col: number): TargetRef => ({ kind: 'unit', side, row, col });
export const lordRef = (side: Side): TargetRef => ({ kind: 'lord', side });
export const handRef = (side: Side, index: number): TargetRef => ({ kind: 'hand', side, index });

/** 手牌实际费用 = 卡面费用 + Σ 费用修正（ADR-038），下限 0 */
export function effectiveCost(hc: HandCard, ruleDelta = 0): number {
  const delta = hc.mods.filter((m) => m.kind === 'cost').reduce((s, m) => s + (m.value ?? 0), 0);
  return Math.max(0, (hc.card.cost ?? 0) + ruleDelta + delta);   // 缺 cost 不该算出 NaN
}

/** 该手牌是否被禁止上场 */
export const isBanned = (hc: HandCard): boolean => hc.mods.some((m) => m.kind === 'ban');

/**
 * 查找该单位的守护者（ADR-039）
 *
 * 遍历其身上的守护状态，取出 srcUid 对应的存活单位。
 * 排除「自我守护」与已阵亡的守护者。
 *
 * ADR-071：**跳过 `guard_scope: 'lord'` 的守护状态** —— 那是「护主」
 * （祖茂「替主」），只拦主帅伤害，不该顺手把单位伤害也接管。
 */
export function findGuard(
  state: MatchState, u: Unit,
): { side: Side; row: Row; col: number; unit: Unit } | null {
  for (const [id, inst] of Object.entries(u.statuses)) {
    if (inst.stacks <= 0 || !inst.srcUid) continue;
    const def = STATUSES[id];
    if (!def?.caps?.includes('redirect_damage')) continue;
    if (def.guard_scope === 'lord') continue;
    for (const side of ['own', 'enemy'] as Side[]) {
      for (const row of ['front', 'back'] as Row[]) {
        for (let col = 0; col < BOARD.COLS; col++) {
          const g = state.sides[side].rows[row][col];
          if (g && g.uid === inst.srcUid && g.uid !== u.uid && g.hp > 0) {
            return { side, row, col, unit: g };
          }
        }
      }
    }
  }
  return null;
}

/**
 * 查找该方主帅的守护者（ADR-071，祖茂「替主」）
 *
 * 主帅不是 `Unit`，无法走 `findGuard`。这里反过来扫**主帅身上的守护状态**
 * （`shou_hu` / `hu_zhu`），用 `srcUid` 找出替他挨打的存活单位。
 * 守护者的状态由来源技能的光环维持 —— 守护者一死，光环重算时一并消失。
 */
export function findLordGuard(
  state: MatchState, side: Side,
): { side: Side; row: Row; col: number; unit: Unit } | null {
  const lord = state.sides[side].lord;
  for (const [id, inst] of Object.entries(lord.statuses ?? {})) {
    if (inst.stacks <= 0 || !inst.srcUid) continue;
    if (!STATUSES[id]?.caps?.includes('redirect_damage')) continue;
    for (const s of ['own', 'enemy'] as Side[]) {
      for (const row of ['front', 'back'] as Row[]) {
        for (let col = 0; col < BOARD.COLS; col++) {
          const g = state.sides[s].rows[row][col];
          if (g && g.uid === inst.srcUid && g.hp > 0) return { side: s, row, col, unit: g };
        }
      }
    }
  }
  return null;
}

/** 目标当前生命 */
export function refHp(state: MatchState, ref: TargetRef): number {
  if (ref.kind === 'lord') return state.sides[ref.side].lord.hp;
  if (ref.kind === 'hand') return 0;                 // 手牌无生命（ADR-038）
  return getUnit(state, ref.side, ref.row, ref.col)?.hp ?? 0;
}

/** 目标是否仍存在 */
export function refAlive(state: MatchState, ref: TargetRef): boolean {
  if (ref.kind === 'lord') return state.sides[ref.side].lord.hp > 0;
  if (ref.kind === 'hand') return false;             // 手牌不是"存活对象"（ADR-038）
  const u = getUnit(state, ref.side, ref.row, ref.col);
  return !!u && u.hp > 0;
}

/* ============================================================
   抽牌 / 粮尽
   ============================================================ */

/**
 * 「抽到时释放」解析器（ADR-050）。
 *
 * 依赖方向是 effects → mutate，所以 mutate 不能直接调 runEffects；
 * 这里留一个挂载点，由 effects.ts 在模块加载时注册。返回 true = 已自动释放（不进手牌）。
 */
export type OnDrawResolver = (
  state: MatchState, cards: Map<string, CardDef>, side: Side,
  card: CardDef, events: GameEvent[], rng: ReturnType<typeof createRng>,
) => boolean;

let onDrawResolver: OnDrawResolver | null = null;

export function registerOnDrawResolver(fn: OnDrawResolver): void {
  onDrawResolver = fn;
}

/**
 * 「亡语」解析器（ADR-050）。
 *
 * 原实现只硬编码了 damage / draw 两种动作，其余（send_to_deck、summon、apply_status…）
 * **静默不生效**——袁绍「遗毒」就是这么被吃掉的。改为统一交给 DSL 解释器。
 */
export type OnDeathResolver = (
  state: MatchState, cards: Map<string, CardDef>, side: Side,
  unit: Unit, skills: SkillDef[], events: GameEvent[],
  rng: ReturnType<typeof createRng>,
  /** 击杀者（华雄「亡语：击杀华雄的角色获得 +1/+1」需要它，ADR-070） */
  killer?: { side: Side; row: Row; col: number } | null,
) => void;

let onDeathResolver: OnDeathResolver | null = null;

/** 「击杀时」解算器（ADR-070）：由 effects.ts 注册，避免 mutate ↔ effects 循环依赖 */
export type OnKillResolver = (
  state: MatchState, cards: Map<string, CardDef>,
  killer: { side: Side; row: Row; col: number },
  victim: { name: string; side: Side; row: Row; col: number; type: CardType },
  events: GameEvent[], rng: ReturnType<typeof createRng>,
) => void;

let onKillResolver: OnKillResolver | null = null;

export function registerOnKillResolver(fn: OnKillResolver): void {
  onKillResolver = fn;
}

export function registerOnDeathResolver(fn: OnDeathResolver): void {
  onDeathResolver = fn;
}

export function drawCard(
  state: MatchState,
  cards: Map<string, CardDef>,
  side: Side,
  events: GameEvent[],
  rng?: ReturnType<typeof createRng>,
): void {
  const s = state.sides[side];
  if (s.deck.length === 0) {
    // 粮尽：递增伤害
    s.fatigue += 1;
    events.push({ type: 'FATIGUE', side, amount: s.fatigue, hp: Math.max(0, s.lord.hp - s.fatigue) });
    dealDamage(state, cards, lordRef(side), s.fatigue, events, 'fatigue');
    return;
  }
  // 断抽（ADR-041）：该方主帅带 block_draw 状态时抽牌无效
  if (hasCapOn(state.sides[side].lord.statuses, 'block_draw')) {
    events.push({ type: 'DRAW_BLOCKED', side });
    return;
  }
  const id = s.deck.pop() as string;
  const card = cards.get(id);
  if (!card) return;
  events.push({ type: 'CARD_DRAWN', side, card, deckLeft: s.deck.length });

  // 「抽到时释放」（ADR-050，如「万箭齐发」）：不进手牌，直接结算并进弃牌堆。
  // rng 未传入时退回由 state.rngState 临时派生——确定可复现，但随机质量略降（见 ADR-050）
  if (onDrawResolver) {
    const r = rng ?? createRng(state.rngState);
    if (onDrawResolver(state, cards, side, card, events, r)) {
      s.discard.push(card);
      events.push({ type: 'CARD_AUTO_CAST', side, card });
      return;
    }
  }

  s.hand.push({ card, mods: [] });            // ADR-038：包成手牌实例
  // 手牌上限：超出部分在回合结束时弃置（见 engine.endTurn）
}

/* ============================================================
   伤害 / 治疗
   ============================================================ */

/**
 * 造成伤害（完整结算：武圣 → 护甲 → 扣血 → 死亡）
 * @returns 实际造成的伤害
 */
export function dealDamage(
  state: MatchState,
  cards: Map<string, CardDef>,
  ref: TargetRef,
  amount: number,
  events: GameEvent[],
  source: string,
  depth = 0,
  /** 造成伤害的单位（用于把「击杀者」传给 killUnit → on_kill，ADR-070） */
  killerRef?: { side: Side; row: Row; col: number } | null,
): number {
  if (amount <= 0 || !refAlive(state, ref)) return 0;

  if (ref.kind === 'lord') {
    const lord = state.sides[ref.side].lord;
    // 「护主」守护（ADR-071，祖茂「替主」）：主帅的伤害转由守护者承受。
    // 必须在扣护甲/扣血之前判定 —— 否则主帅已经掉了血，转移就成了补刀。
    const lguard = findLordGuard(state, ref.side);
    if (lguard && depth < 3) {
      events.push({ type: 'DAMAGE_REDIRECTED', side: ref.side, lord: true,
                    to: lguard.side, guardName: lguard.unit.name });
      return dealDamage(state, cards, unitRef(lguard.side, lguard.row, lguard.col),
                        amount, events, source, depth + 1, killerRef);
    }
    let dmg = amount;
    if (lord.armor > 0) {
      const absorbed = Math.min(lord.armor, dmg);
      lord.armor -= absorbed;
      dmg -= absorbed;
    }
    lord.hp -= dmg;
    events.push({ type: 'DAMAGE', target: ref, amount, source });
    if (lord.hp <= 0) {
      lord.hp = 0;
      checkWinner(state, events);
    }
    return amount;
  }

  if (ref.kind !== 'unit') return 0;                // 手牌不受伤害（ADR-038）
  const u = getUnit(state, ref.side, ref.row, ref.col);
  if (!u) return 0;

  // 伤害重定向（ADR-039）：守护状态把伤害整体转给守护者
  const guard = findGuard(state, u);
  if (guard && depth < 3) {
    events.push({ type: 'DAMAGE_REDIRECTED', side: ref.side, row: ref.row, col: ref.col,
                  to: guard.side, guardName: guard.unit.name });
    return dealDamage(state, cards, unitRef(guard.side, guard.row, guard.col),
                      amount, events, source, depth + 1, killerRef);
  }

  // 免疫伤害（武圣等，能力驱动 ADR-034）：消耗后失效
  if (hasCap(u, 'immune_damage')) {
    const id = Object.keys(u.statuses).find((k) => STATUSES[k]?.caps?.includes('immune_damage'))!;
    delete u.statuses[id];
    u.kw = u.kw.filter((k) => k !== id);
    events.push({ type: 'STATUS_EXPIRED', side: ref.side, row: ref.row, col: ref.col, status: id });
    return 0;
  }

  u.hp -= amount;
  events.push({ type: 'DAMAGE', target: ref, amount, source });

  // 免死判定（ADR-039）：致命伤害时按 on_lethal 技能掷骰，成功则以 1 血存活
  if (u.hp <= 0 && tryLethalSave(state, u, ref, events)) return amount;

  if (u.hp <= 0) killUnit(state, cards, { side: ref.side, row: ref.row, col: ref.col, unit: u }, events, killerRef);
  return amount;
}

/**
 * 免死判定（ADR-039）
 *
 * 在**扣血后、移出战场前**判定——免疫是"扣血前取消"，免死是"归零后抬回 1 血"。
 * 使用由 state.rngState 派生的确定性 RNG，保证回放可复现。
 */
function tryLethalSave(
  state: MatchState, u: Unit, ref: Extract<TargetRef, { kind: 'unit' }>, events: GameEvent[],
): boolean {
  const saves = (u.skills ?? []).filter((sk) => sk.trigger === 'on_lethal');
  if (!saves.length) return false;
  const usedOnce = (u as Unit & { lethalUsed?: boolean }).lethalUsed;
  const rng = createRng(state.rngState);
  for (const sk of saves) {
    if (sk.frequency === 'once' && usedOnce) continue;
    const chance = sk.chance ?? 1;
    const roll = rng.next();
    if (roll < chance) {
      state.rngState = rng.getState();
      u.hp = 1;
      (u as Unit & { lethalUsed?: boolean }).lethalUsed = true;
      events.push({ type: 'UNIT_SURVIVED', side: ref.side, row: ref.row, col: ref.col, unit: u });
      return true;
    }
  }
  state.rngState = rng.getState();
  return false;
}

/**
 * 受到伤害触发技（时机表第 16 步，ADR-031/036）
 * 由 engine 在伤害结算后统一调用，避免 mutate 反向依赖 effects。
 */
export function collectDamaged(
  state: MatchState, side: Side, uid: string,
): { row: Row; col: number; unit: Unit } | null {
  for (const ref of allUnits(state, side)) if (ref.unit.uid === uid) return ref;
  return null;
}

export function healTarget(
  state: MatchState,
  ref: TargetRef,
  amount: number,
  events: GameEvent[],
): void {
  if (amount <= 0 || !refAlive(state, ref)) return;
  if (ref.kind === 'lord') {
    const lord = state.sides[ref.side].lord;
    lord.hp = Math.min(lord.maxHp, lord.hp + amount);
    events.push({ type: 'HEAL', target: ref, amount, hp: lord.hp });
    return;
  }
  if (ref.kind !== 'unit') return;                   // 手牌不可被治疗（ADR-038）
  const u = getUnit(state, ref.side, ref.row, ref.col);
  if (!u) return;
  u.hp = Math.min(u.maxHp, u.hp + amount);
  events.push({ type: 'HEAL', target: ref, amount, hp: u.hp });
}

export function gainArmor(state: MatchState, side: Side, amount: number, events: GameEvent[]): void {
  const lord = state.sides[side].lord;
  lord.armor += amount;
  events.push({ type: 'ARMOR_GAINED', side, amount, armor: lord.armor });
}

/* ============================================================
   状态
   ============================================================ */

/**
 * 移除状态（驱散，ADR-066）
 *
 * 与 applyStatus 对称：`stacks` 省略时移除**全部层数**；给了就只扣那么多层，
 * 扣到 0 才真正删除。只在「状态彻底消失」时发 STATUS_EXPIRED ——
 * 部分削减也发的话客户端会误判成"状态没了"。
 *
 * 返回实际移除了几层，便于调用方/测试核对。
 */
export function removeStatus(
  state: MatchState,
  ref: TargetRef,
  status: string,
  events: GameEvent[],
  stacks?: number,
): number {
  if (ref.kind === 'hand') return 0;

  if (ref.kind === 'lord') {
    const lord = state.sides[ref.side].lord;
    const inst = lord.statuses?.[status];
    if (!inst) return 0;
    const removed = stacks === undefined ? inst.stacks : Math.min(stacks, inst.stacks);
    if (stacks === undefined || removed >= inst.stacks) {
      delete lord.statuses![status];
      // 主公没有 row/col，用专用事件（STATUS_EXPIRED 要求坐标）
      events.push({ type: 'LORD_STATUS_EXPIRED', side: ref.side, status });
    } else {
      inst.stacks -= removed;
    }
    return removed;
  }

  const u = getUnit(state, ref.side, ref.row, ref.col);
  if (!u) return 0;
  const inst = u.statuses[status];
  if (!inst) return 0;

  const removed = stacks === undefined ? inst.stacks : Math.min(stacks, inst.stacks);
  if (stacks === undefined || removed >= inst.stacks) {
    delete u.statuses[status];
    // 关键词携带的状态（架盾/圣盾/先攻）同时要把关键词去掉，
    // 否则会出现"状态没了但关键词还在"的幽灵效果。
    u.kw = u.kw.filter((k) => k !== status);
    events.push({ type: 'STATUS_EXPIRED', side: ref.side, row: ref.row, col: ref.col, status });
  } else {
    inst.stacks -= removed;
  }
  return removed;
}

export function applyStatus(
  state: MatchState,
  ref: TargetRef,
  status: string,
  stacks: number,
  events: GameEvent[],
  turns?: number,
  srcUid?: string,
  auraId?: string,
): void {
  if (ref.kind === 'hand') return;                    // 手牌用 HandMod（ADR-038）
  const def = STATUSES[status];

  // 主公状态（ADR-040）
  if (ref.kind === 'lord') {
    const lord = state.sides[ref.side].lord;
    lord.statuses = lord.statuses ?? {};
    if (def?.kind === 'debuff' && hasCapOn(lord.statuses, 'immune_debuff')) return;
    const prevL = lord.statuses[status];
    const numericL = def?.numeric ?? true;
    // 光环施加的状态（ADR-071）：生命周期由光环决定 —— 每次 recomputeAuras 都先清后加。
    // 若还按 `duration: 'turns'` 记 1 回合，它会在**自己回合结束**的那一刻被清掉，
    // 而「护主」要挡的恰恰是**对手回合**的伤害，等于形同虚设。
    const turnsL = auraId !== undefined && turns === undefined ? undefined
      : turns !== undefined ? turns
      : def?.duration === 'permanent' || def?.duration === 'until_consumed' ? undefined
      : def?.duration === 'turns' || def?.duration === 'this_turn' ? 1 : undefined;
    lord.statuses[status] = {
      stacks: numericL ? (prevL?.stacks ?? 0) + stacks : Math.max(1, stacks),
      turns: turnsL, srcUid, auraId,
    };
    events.push({ type: 'STATUS_APPLIED', side: ref.side, status, stacks, turns: turnsL });
    return;
  }

  const u = getUnit(state, ref.side, ref.row, ref.col);
  if (!u) return;

  // 免疫负面：带 immune_debuff 能力的单位，负面状态施加无效（ADR-034）
  if (def?.kind === 'debuff' && hasCap(u, 'immune_debuff')) {
    events.push({ type: 'STATUS_BLOCKED', side: ref.side, row: ref.row, col: ref.col, status, reason: '免疫' });
    return;
  }

  const numeric = def?.numeric ?? true;
  const prev = u.statuses[status];
  const nextStacks = numeric ? (prev?.stacks ?? 0) + stacks : Math.max(1, stacks);
  // 持续时间：调用方指定优先；否则按状态定义（permanent → 永久）。
  // 光环施加的状态同上：交给光环管生命周期，不吃回合到期（ADR-071）。
  const nextTurns = auraId !== undefined && turns === undefined ? undefined
    : turns !== undefined ? turns
    : prev?.turns !== undefined ? Math.max(prev.turns, 1)
    : def?.duration === 'permanent' || def?.duration === 'until_consumed' ? undefined
    : def?.duration === 'turns' || def?.duration === 'this_turn' ? 1
    : undefined;
  u.statuses[status] = { stacks: nextStacks, turns: nextTurns, srcUid, auraId };
  events.push({ type: 'STATUS_APPLIED', side: ref.side, row: ref.row, col: ref.col, status, stacks, turns: nextTurns });
}

/* ============================================================
   召唤 / 死亡
   ============================================================ */

export function summonUnit(
  state: MatchState,
  cards: Map<string, CardDef>,
  side: Side,
  row: Row,
  col: number,
  cardId: string,
  events: GameEvent[],
): Unit | null {
  const card = cards.get(cardId);
  if (!card) return null;
  if (state.sides[side].rows[row][col]) return null;
  const u = makeUnit(card, state.turn, nextUidSeq(state));
  setUnit(state, side, row, col, u);
  events.push({ type: 'UNIT_SUMMONED', side, row, col, unit: u });
  return u;
}

export interface UnitRefFull { side: Side; row: Row; col: number; unit: Unit }

/** 死亡结算：移除 → 亡语（忠义 / 遗计）→ 胜负检查 */
export function killUnit(
  state: MatchState,
  cards: Map<string, CardDef>,
  ref: UnitRefFull,
  events: GameEvent[],
  /** 击杀者（谁把它打死的）。供 on_kill 触发技与「亡语给击杀者加成」用（ADR-070） */
  killer?: { side: Side; row: Row; col: number } | null,
): void {
  const { side, row, col, unit } = ref;
  if (!getUnit(state, side, row, col)) return;

  setUnit(state, side, row, col, null);
  events.push({ type: 'UNIT_DIED', side, row, col, unit });

  // 遗计：阵亡时抽 1 张
  if (hasTrait(unit, 'yi_ji')) drawCard(state, cards, side, events);

  // 忠义：触发卡牌自定义的 on_death 效果（统一走 DSL，ADR-050）
  const card = cards.get(unit.cardId);
  const deathSkills = (card?.skills ?? []).filter((sk) => sk.trigger === 'on_death');
  if (deathSkills.length && onDeathResolver) {
    // rng 由 state 派生：killUnit 的调用链（伤害结算）里没有现成的 rng。
    // 与 on_draw 同理，确定可复现；外层 rng 写回时会以自身状态为准（见 ADR-050）
    onDeathResolver(state, cards, side, unit, deathSkills, events, createRng(state.rngState), killer);
  }

  // on_kill（ADR-070）：击杀者的「每次击杀时」触发技。
  // 华雄「威震四方」靠它每次击杀获得 +1/+1。
  // 走挂载点而不是直接 import runEffects —— 否则 mutate ↔ effects 形成循环依赖。
  if (killer && onKillResolver) {
    onKillResolver(state, cards, killer, { name: unit.name, side, row, col, type: unit.type }, events, createRng(state.rngState));
  }
}

/* ============================================================
   胜负
   ============================================================ */

export function checkWinner(state: MatchState, events: GameEvent[]): void {
  if (state.winner) return;
  const ownDead = state.sides.own.lord.hp <= 0;
  const enemyDead = state.sides.enemy.lord.hp <= 0;
  if (!ownDead && !enemyDead) return;
  // ADR-054：无平局。双方同时阵亡的极端情况按「同时判负」处理为敌方胜（不会出现在正常对局）
  state.winner = ownDead ? 'enemy' : 'own';
  events.push({ type: 'GAME_OVER', winner: state.winner });
}

/* ============================================================
   回合开始 / 结束的状态结算
   ============================================================ */

export function resolveTurnStartStatuses(
  state: MatchState,
  cards: Map<string, CardDef>,
  side: Side,
  events: GameEvent[],
): void {
  for (const ref of allUnits(state, side)) {
    const heal = statusStacks(ref.unit, 'ji_jiu');
    if (heal > 0) healTarget(state, unitRef(ref.side, ref.row, ref.col), heal, events);
  }
}

export function resolveTurnEndStatuses(
  state: MatchState,
  cards: Map<string, CardDef>,
  side: Side,
  events: GameEvent[],
): void {
  for (const ref of allUnits(state, side)) {
    const poison = statusStacks(ref.unit, 'zhong_du');
    if (poison > 0) {
      dealDamage(state, cards, unitRef(ref.side, ref.row, ref.col), poison, events, '中毒');
    }
  }
}

/**
 * 临时属性修正到期（时机表第 21 步，ADR-037）
 * 与状态递减同一步：有 turns 的 mod 减 1，减到 0 移除并重算派生属性。
 */
export function expireMods(state: MatchState, side: Side): void {
  for (const ref of allUnits(state, side)) {
    const u = ref.unit;
    const before = u.mods.length;
    u.mods = u.mods.filter((m) => {
      if (m.kind !== 'temp' || m.turns === undefined) return true;
      m.turns -= 1;
      return m.turns > 0;
    });
    if (u.mods.length !== before) applyMods(u);
  }
}

/**
 * 手牌修正到期（时机表第 21 步，ADR-038）
 * 与属性修正同构：有 turns 的减 1，减到 0 移除。
 */
/** 最近被弃的牌（ADR-040）：供 value_from_discarded 读取 */
export interface LastDiscarded { card: CardDef; side: Side }
export function setLastDiscarded(state: MatchState, card: CardDef, side: Side): void {
  (state as MatchState & { lastDiscarded?: LastDiscarded }).lastDiscarded = { card, side };
}

export function expireHandMods(state: MatchState, side: Side): void {
  for (const hc of state.sides[side].hand) {
    if (!hc.mods.length) continue;
    hc.mods = hc.mods.filter((m) => {
      if (m.turns === undefined) return true;
      m.turns -= 1;
      return m.turns > 0;
    });
  }
}

/**
 * 清除临时效果（时机表第 21 步，ADR-034）
 *
 * ⚠️ 必须在 `turn_end` 触发技**之后**调用——否则「持续 1 回合」的混乱
 * 会在自己的回合结束技生效前就被清掉。中毒结算与触发技都在第 20 步。
 */
export function expireStatuses(
  state: MatchState,
  side: Side,
  events: GameEvent[],
): void {
  // 主公状态递减（ADR-040）
  const lord = state.sides[side].lord;
  if (lord.statuses) {
    for (const [id, inst] of Object.entries(lord.statuses)) {
      if (inst.turns === undefined) continue;
      inst.turns -= 1;
      if (inst.turns <= 0) {
        delete lord.statuses[id];
        events.push({ type: 'LORD_STATUS_EXPIRED', side, status: id });
      }
    }
  }
  for (const ref of allUnits(state, side)) {
    for (const [id, inst] of Object.entries(ref.unit.statuses)) {
      if (inst.turns === undefined) continue;               // 永久 / 直到消耗
      inst.turns -= 1;
      if (inst.turns <= 0) {
        delete ref.unit.statuses[id];
        events.push({ type: 'STATUS_EXPIRED', side: ref.side, row: ref.row, col: ref.col, status: id });
      }
    }
  }
}

/** 回合结束时弃牌至上限 */
export function discardOverflow(state: MatchState, side: Side): CardDef[] {
  const s = state.sides[side];
  const dropped: CardDef[] = [];
  while (s.hand.length > DECK.HAND_LIMIT) {
    const c = s.hand.pop();
    if (c) { s.discard.push(c.card); dropped.push(c.card); }
  }
  return dropped;
}
