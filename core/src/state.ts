/**
 * 对局状态：创建、克隆、查询
 *
 * 设计原则：
 *  - 状态是**纯数据**（无函数），可 structuredClone、可序列化、可存快照
 *  - 所有变更由 engine 产生新状态（不可变更新）
 */

import { createRng } from './rng.ts';
import { BOARD, COMMAND, DECK, LORD_HP } from './constants.ts';
import type {
  CardDef, Faction, LordDef, MatchState, Row, Side, SideState, Unit,
} from './types.ts';

export interface CreateMatchOptions {
  seed?: number;
  lords: Record<Side, LordDef>;
  decks: Record<Side, string[]>;
  cards: Map<string, CardDef>;
  firstSide?: Side;
}

/** 新建对局 */
export function createMatch(opts: CreateMatchOptions): MatchState {
  const { seed = 1, lords, decks, cards, firstSide = 'own' } = opts;
  const rng = createRng(seed);

  const makeSide = (side: Side): SideState => {
    const lordCard = lords[side];
    const deck = rng.shuffle([...decks[side]]);
    const handSize = side === firstSide ? DECK.HAND_START_FIRST : DECK.HAND_START_SECOND;
    const hand: CardDef[] = [];
    for (let i = 0; i < handSize && deck.length; i++) {
      const id = deck.pop() as string;
      const c = cards.get(id);
      if (c) hand.push(c);
    }
    return {
      lord: {
        id: lordCard.id,
        name: lordCard.name,
        faction: lordCard.faction as Faction,
        hp: LORD_HP,
        maxHp: LORD_HP,
        armor: 0,
        skill: lordCard.skill ?? '',
        skillDef: lordCard.skillDef,
        skillUsedThisTurn: false,
      },
      rows: {
        front: new Array<Unit | null>(BOARD.COLS).fill(null),
        back: new Array<Unit | null>(BOARD.COLS).fill(null),
      },
      hand,
      deck,
      discard: [],
      command: { cur: COMMAND.START, max: COMMAND.START },
      fatigue: 0,
    };
  };

  return {
    seed,
    uidSeq: 0,
    rngState: rng.getState(),
    turn: 0,
    active: firstSide,
    sides: { own: makeSide('own'), enemy: makeSide('enemy') },
    winner: null,
  };
}

export const cloneState = (s: MatchState): MatchState => structuredClone(s);

export const other = (side: Side): Side => (side === 'own' ? 'enemy' : 'own');

export const getUnit = (s: MatchState, side: Side, row: Row, col: number): Unit | null =>
  s.sides[side].rows[row][col] ?? null;

export function setUnit(s: MatchState, side: Side, row: Row, col: number, u: Unit | null): void {
  s.sides[side].rows[row][col] = u;
}

export interface UnitRef { side: Side; row: Row; col: number; unit: Unit }

export function allUnits(s: MatchState, side: Side): UnitRef[] {
  const out: UnitRef[] = [];
  for (const row of BOARD.ROWS) {
    s.sides[side].rows[row].forEach((unit, col) => {
      if (unit) out.push({ side, row, col, unit });
    });
  }
  return out;
}

export function findByUid(s: MatchState, uid: string): UnitRef | null {
  for (const side of ['own', 'enemy'] as Side[]) {
    for (const row of BOARD.ROWS) {
      const arr = s.sides[side].rows[row];
      for (let col = 0; col < arr.length; col++) {
        const u = arr[col];
        if (u && u.uid === uid) return { side, row, col, unit: u };
      }
    }
  }
  return null;
}

export const unitCount = (s: MatchState, side: Side): number => allUnits(s, side).length;

export const hasKeyword = (u: Unit | null, kw: string): boolean => !!u && u.kw.includes(kw);

export const statusStacks = (u: Unit | null, id: string): number => (u?.statuses[id] ?? 0);

/** 「架盾」生效单位（仅前军） */
export const shieldUnits = (s: MatchState, side: Side): UnitRef[] =>
  allUnits(s, side).filter(({ row, unit }) => row === 'front' && hasKeyword(unit, 'jia_dun') && unit.hp > 0);

export const lordAlive = (s: MatchState, side: Side): boolean => s.sides[side].lord.hp > 0;

/** 空列（两排皆空） */
export function openColumns(s: MatchState, side: Side): number[] {
  const out: number[] = [];
  for (let c = 0; c < BOARD.COLS; c++) {
    if (!s.sides[side].rows.front[c] && !s.sides[side].rows.back[c]) out.push(c);
  }
  return out;
}

/**
 * 由卡牌定义生成战场单位实例
 * uid 由状态内的 uidSeq 决定 —— 保证同一 seed + 同一操作序列产出完全相同的状态（回放可复现）
 */
export function makeUnit(card: CardDef, turn: number, seq: number): Unit {
  return {
    uid: `${card.id}#${seq}`,
    cardId: card.id,
    name: card.name,
    type: card.type,
    faction: card.faction,
    cost: card.cost,
    atk: card.attack ?? 0,
    hp: card.health ?? 1,
    maxHp: card.health ?? 1,
    troopKind: card.troopKind,
    kw: [...(card.keywords ?? [])],
    statuses: {},
    skills: card.skills ? structuredClone(card.skills) : undefined,
    attackedThisTurn: 0,
    enteredTurn: turn,
  };
}

/** 取下一个单位序号（由状态驱动，保证可复现） */
export function nextUidSeq(state: MatchState): number {
  state.uidSeq += 1;
  return state.uidSeq;
}
