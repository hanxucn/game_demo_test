/**
 * 对局状态：创建、克隆、查询
 *
 * 设计原则：
 *  - 状态是**纯数据**（无函数），可 structuredClone、可序列化、可存快照
 *  - 所有变更由 engine 产生新状态（不可变更新）
 */

import { createRng } from './rng.ts';
import { BOARD, COMMAND, DECK, LORD_HP } from './constants.ts';
import { STATUSES, type StatusCap } from './constants.ts';
import { resolveInjectCard } from './jiuling.ts';
import type {
  CardDef, Faction, HandCard, JiulingDef, LordDef, MatchState, Row, Side, SideState,
  StatusInstance, Unit,
} from './types.ts';

export interface CreateMatchOptions {
  seed?: number;
  lords: Record<Side, LordDef>;
  decks: Record<Side, string[]>;
  cards: Map<string, CardDef>;
  /** 先手方；缺省 'own'（createMatch 是纯构造器，自己不做随机） */
  firstSide?: Side;
  /** 按 GDD 03 §1 第④步掷点定先手（用本对局的确定性 Rng）；优先于 firstSide */
  rollFirst?: boolean;
  /** 双方酒令 id（GDD 03 §1 第②步；不传则该局无酒令） */
  jiulings?: Partial<Record<Side, string>>;
  /** 酒令表；提供后才能生效 deck_inject 等 hook */
  jiulingDefs?: Map<string, JiulingDef>;
  /** 内测/复盘用：跳过「后手补传国玉玺」 */
  skipYuxi?: boolean;
}

/** 后手补偿卡（GDD 03 §1.2） */
export const YUXI_ID = 'neutral_chuanguo_yuxi';

/** 掷点定先手（GDD 03 §1 第④步）：双方各掷 D6，平局重掷。确定性 Rng */
export function rollFirstSide(rng: ReturnType<typeof createRng>): { side: Side; own: number; enemy: number } {
  for (let i = 0; i < 100; i++) {
    const own = rng.int(6) + 1;
    const enemy = rng.int(6) + 1;
    if (own !== enemy) return { side: own > enemy ? 'own' : 'enemy', own, enemy };
  }
  return { side: 'own', own: 6, enemy: 1 };   // 理论上不可达；兜底保证确定性
}

/**
 * 新建对局（GDD 03 §1 的 ①②④⑤ 步）。
 *
 * ③ 换牌不在这里——它是玩家的独立动作，见 core/src/setup.ts 的 mulligan()。
 * 本函数负责：任命主公 → 洗牌 → 发起手 → 接酒令 → 注入卡 → 后手补玉玺 → 定先手。
 */
export function createMatch(opts: CreateMatchOptions): MatchState {
  const {
    seed = 1, lords, decks, cards, jiulings, jiulingDefs, skipYuxi = false,
  } = opts;
  const rng = createRng(seed);

  // 掷点（可选）：只在开局显式要求时消耗 Rng，保证 createMatch 在缺省下是纯构造
  const firstSide: Side = opts.rollFirst ? rollFirstSide(rng).side : (opts.firstSide ?? 'own');

  // 阵营卡池（酒令 deck_inject 用）
  const pool = [...cards.values()];

  const makeSide = (side: Side): SideState => {
    const lordCard = lords[side];
    const deck = rng.shuffle([...decks[side]]);

    const handSize = side === firstSide ? DECK.HAND_START_FIRST : DECK.HAND_START_SECOND;
    const hand: HandCard[] = [];
    for (let i = 0; i < handSize && deck.length; i++) {
      const id = deck.pop() as string;
      const c = cards.get(id);
      if (c) hand.push({ card: c, mods: [] });
    }

    // 酒令「煮酒论英雄」：开局把一张本阵营高费卡直接放进手牌，加 ban 压到第 unlock_turn 回合。
    // 放手里（而非牌库）才能保证 ban 一定挂上，且「占一格手牌」正是设计要的代价（GDD 11 §3.2 #4）。
    const jid = jiulings?.[side];
    const jdef = jid ? jiulingDefs?.get(jid) : undefined;
    if (jdef?.hook === 'deck_inject') {
      const injected = resolveInjectCard(jdef, lordCard.faction as Faction, pool);
      if (injected) {
        // ban 从 unlock_turn-1 开始倒数，每方自己回合结束减 1 → 该方第 unlock_turn 回合可用
        const turns = Math.max(0, (jdef.unlock_turn ?? 1) - 1);
        hand.push({
          card: injected,
          mods: turns > 0 ? [{ id: jdef.id, kind: 'ban', turns }] : [],
        });
      }
    }

    // 后手补「传国玉玺」×1（GDD 03 §1.2）
    if (!skipYuxi && side !== firstSide) {
      const yuxi = cards.get(YUXI_ID);
      if (yuxi && !hand.some((h) => h.card.id === YUXI_ID)) {
        hand.push({ card: yuxi, mods: [] });
      }
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
      jiuling: jid,
      jiulingUsed: {},
      mulliganDone: false,
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

export const statusStacks = (u: Unit | null, id: string): number => u?.statuses[id]?.stacks ?? 0;

/** 主公身上的某状态层数（ADR-040） */
export const lordStatusStacks = (l: { statuses?: Record<string, StatusInstance> } | null, id: string): number =>
  l?.statuses?.[id]?.stacks ?? 0;

/** 状态剩余回合数；undefined = 永久或不存在 */
export const statusTurns = (u: Unit | null, id: string): number | undefined => u?.statuses[id]?.turns;

/** 该单位是否具备某项状态能力（ADR-034）——引擎只查能力，不认状态 id */
export function hasCap(u: Unit | null, cap: StatusCap): boolean {
  if (!u) return false;
  return hasCapOn(u.statuses, cap);
}

/** 状态集合层面判定能力（ADR-040：主公也可承载状态） */
export function hasCapOn(
  statuses: Record<string, StatusInstance> | undefined, cap: StatusCap,
): boolean {
  for (const [id, inst] of Object.entries(statuses ?? {})) {
    if (inst.stacks <= 0) continue;
    if (STATUSES[id]?.caps?.includes(cap)) return true;
  }
  return false;
}

/** 某项能力在状态集合中的累计层数（如「参谋」加成主公技次数） */
export function capStacks(
  statuses: Record<string, StatusInstance> | undefined, cap: StatusCap,
): number {
  let n = 0;
  for (const [id, inst] of Object.entries(statuses ?? {})) {
    if (inst.stacks > 0 && STATUSES[id]?.caps?.includes(cap)) n += inst.stacks;
  }
  return n;
}

/** 该单位身上所有生效状态的 id */
export const activeStatuses = (u: Unit | null): string[] =>
  Object.entries(u?.statuses ?? {}).filter(([, v]) => v.stacks > 0).map(([k]) => k);

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
    baseAtk: card.attack ?? 0,
    baseMaxHp: card.health ?? 1,
    mods: [],
    atk: card.attack ?? 0,
    hp: card.health ?? 1,
    maxHp: card.health ?? 1,
    troopKind: card.troopKind,
    kw: [...(card.keywords ?? [])],
    tags: [...(card.tags ?? [])],
    statuses: {},
    skills: card.skills ? structuredClone(card.skills) : undefined,
    attackedThisTurn: 0,
    enteredTurn: turn,
  };
}

/**
 * 重算派生属性（ADR-037）
 *
 * 最终属性 = 基础值 + Σ mods。生命上限变化时当前生命**等量增减**，
 * 并夹在 [1, 上限]——光环失效不会导致单位死亡。
 */
export function applyMods(u: Unit): void {
  const dAtk = u.mods.reduce((s, m) => s + (m.attack ?? 0), 0);
  const dHp = u.mods.reduce((s, m) => s + (m.health ?? 0), 0);
  const newMax = Math.max(1, u.baseMaxHp + dHp);
  const delta = newMax - u.maxHp;
  u.atk = Math.max(0, u.baseAtk + dAtk);
  u.maxHp = newMax;
  if (u.hp > 0) u.hp = Math.max(1, Math.min(newMax, u.hp + delta));
}

/** 取下一个单位序号（由状态驱动，保证可复现） */
export function nextUidSeq(state: MatchState): number {
  state.uidSeq += 1;
  return state.uidSeq;
}
