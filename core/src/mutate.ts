/**
 * 状态变更原语（低层）
 *
 * effects.ts 与 engine.ts 都通过这里改动状态，保证：
 *  - 所有伤害/治疗/死亡都走同一套结算顺序（docs/gdd/10-skills-statuses.md §4）
 *  - 所有变更都产生事件（客户端只消费事件）
 */

import { DECK, STATUSES } from './constants.ts';
import { allUnits, getUnit, hasKeyword, makeUnit, nextUidSeq, other, setUnit, statusStacks } from './state.ts';
import type { CardDef, GameEvent, MatchState, Row, Side, Unit } from './types.ts';

export type TargetRef =
  | { kind: 'unit'; side: Side; row: Row; col: number }
  | { kind: 'lord'; side: Side };

export const unitRef = (side: Side, row: Row, col: number): TargetRef => ({ kind: 'unit', side, row, col });
export const lordRef = (side: Side): TargetRef => ({ kind: 'lord', side });

/** 目标当前生命 */
export function refHp(state: MatchState, ref: TargetRef): number {
  return ref.kind === 'lord'
    ? state.sides[ref.side].lord.hp
    : (getUnit(state, ref.side, ref.row, ref.col)?.hp ?? 0);
}

/** 目标是否仍存在 */
export function refAlive(state: MatchState, ref: TargetRef): boolean {
  if (ref.kind === 'lord') return state.sides[ref.side].lord.hp > 0;
  const u = getUnit(state, ref.side, ref.row, ref.col);
  return !!u && u.hp > 0;
}

/* ============================================================
   抽牌 / 粮尽
   ============================================================ */

export function drawCard(
  state: MatchState,
  cards: Map<string, CardDef>,
  side: Side,
  events: GameEvent[],
): void {
  const s = state.sides[side];
  if (s.deck.length === 0) {
    // 粮尽：递增伤害
    s.fatigue += 1;
    events.push({ type: 'FATIGUE', side, amount: s.fatigue, hp: Math.max(0, s.lord.hp - s.fatigue) });
    dealDamage(state, cards, lordRef(side), s.fatigue, events, 'fatigue');
    return;
  }
  const id = s.deck.pop() as string;
  const card = cards.get(id);
  if (!card) return;
  s.hand.push(card);
  events.push({ type: 'CARD_DRAWN', side, card, deckLeft: s.deck.length });
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
): number {
  if (amount <= 0 || !refAlive(state, ref)) return 0;

  if (ref.kind === 'lord') {
    const lord = state.sides[ref.side].lord;
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

  const u = getUnit(state, ref.side, ref.row, ref.col);
  if (!u) return 0;

  // 武圣：免疫一次伤害
  if (statusStacks(u, 'wu_sheng') > 0) {
    delete u.statuses.wu_sheng;
    u.kw = u.kw.filter((k) => k !== 'wu_sheng');
    events.push({ type: 'STATUS_EXPIRED', side: ref.side, row: ref.row, col: ref.col, status: 'wu_sheng' });
    return 0;
  }

  u.hp -= amount;
  events.push({ type: 'DAMAGE', target: ref, amount, source });
  if (u.hp <= 0) killUnit(state, cards, { side: ref.side, row: ref.row, col: ref.col, unit: u }, events);
  return amount;
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

export function applyStatus(
  state: MatchState,
  ref: TargetRef,
  status: string,
  stacks: number,
  events: GameEvent[],
): void {
  if (ref.kind !== 'unit') return;                    // v1 状态只作用于人物卡
  const u = getUnit(state, ref.side, ref.row, ref.col);
  if (!u) return;
  const def = STATUSES[status];
  const numeric = def?.numeric ?? true;
  u.statuses[status] = numeric ? (u.statuses[status] ?? 0) + stacks : Math.max(1, stacks);
  events.push({ type: 'STATUS_APPLIED', side: ref.side, row: ref.row, col: ref.col, status, stacks });
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
): void {
  const { side, row, col, unit } = ref;
  if (!getUnit(state, side, row, col)) return;

  setUnit(state, side, row, col, null);
  events.push({ type: 'UNIT_DIED', side, row, col, unit });

  // 遗计：阵亡时抽 1 张
  if (hasKeyword(unit, 'yi_ji')) drawCard(state, cards, side, events);

  // 忠义：触发卡牌自定义的 on_death 效果
  const card = cards.get(unit.cardId);
  const deathSkills = (card?.skills ?? []).filter((sk) => sk.trigger === 'on_death');
  for (const sk of deathSkills) {
    for (const eff of sk.effects ?? []) {
      if (eff.action === 'damage') {
        const foe = other(side);
        for (const t of allUnits(state, foe)) {
          dealDamage(state, cards, unitRef(t.side, t.row, t.col), eff.value ?? 0, events, unit.name);
        }
      } else if (eff.action === 'draw') {
        for (let i = 0; i < (eff.value ?? 1); i++) drawCard(state, cards, side, events);
      }
    }
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
  state.winner = ownDead && enemyDead ? 'draw' : ownDead ? 'enemy' : 'own';
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
  // 清除"回合数"型减益
  for (const ref of allUnits(state, side)) {
    for (const [id, def] of Object.entries(STATUSES)) {
      if (def.duration === 'turns' && ref.unit.statuses[id]) {
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
    if (c) { s.discard.push(c); dropped.push(c); }
  }
  return dropped;
}
