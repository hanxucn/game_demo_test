/**
 * core 的类型定义
 *
 * 铁律：core 只依赖这里的类型，**不引用任何引擎（Cocos）类型**。
 * 客户端把 core 产出的 Event 翻译成动画即可。
 */

export type Side = 'own' | 'enemy';
export type Row = 'front' | 'back';
export type CardType = 'troop' | 'general' | 'strategist' | 'event' | 'tactic' | 'elite' | 'special';
export type Faction = 'shu' | 'wei' | 'wu' | 'qun' | 'neutral';

/* ============================================================
   卡牌数据（来自 data/*.yaml，见 docs/gdd/05-cards.md）
   ============================================================ */

export interface CardEffect {
  action: string;
  value?: number;
  status?: string;
  stacks?: number;
  duration?: string | number;
  unit?: string;
  count?: number;
  position?: string;
  target?: TargetSelector;
}

export interface TargetSelector {
  side?: 'ally' | 'enemy' | 'both' | 'self';
  filter?: {
    type?: CardType | 'character';
    keyword?: string;
    faction?: Faction;
    lane?: number;
    row?: Row;
    health_max?: number;
    has_status?: string;
  };
  count?: number | 'all';
  mode?: 'choose' | 'random' | 'first' | 'lowest_health';
  require_empty?: boolean;
}

export interface SkillDef {
  id: string;
  name: string;
  kind: 'active' | 'trigger' | 'aura';
  cost?: number;
  frequency?: 'once_per_turn' | 'unlimited' | 'once';
  trigger?: string;              // TIMING 常量
  target?: TargetSelector;
  effects?: CardEffect[];
}

export interface CardDef {
  id: string;
  name: string;
  faction: Faction;
  type: CardType;
  cost: number;
  attack?: number;
  health?: number;
  troopKind?: 'infantry' | 'shield' | 'archer';
  keywords?: string[];
  skills?: SkillDef[];
  bonds?: string[];
  effects?: CardEffect[];        // 非人物卡的直接效果
  upgradeTarget?: unknown;
  memo?: string;
  flavor?: string;
  art?: string;
}

export interface LordDef extends CardDef {
  skill?: string;                // 主公技显示名
  skillDef?: SkillDef;
}

/* ============================================================
   对局状态
   ============================================================ */

export interface Unit {
  uid: string;
  cardId: string;
  name: string;
  type: CardType;
  faction: Faction;
  cost: number;
  atk: number;
  hp: number;
  maxHp: number;
  troopKind?: string;
  kw: string[];
  statuses: Record<string, number>;
  skills?: SkillDef[];
  attackedThisTurn: number;
  enteredTurn: number;
}

export interface Lord {
  id: string;
  name: string;
  faction: Faction;
  hp: number;
  maxHp: number;
  armor: number;
  skill: string;
  skillDef?: SkillDef;
  skillUsedThisTurn: boolean;
}

export interface SideState {
  lord: Lord;
  rows: { front: Array<Unit | null>; back: Array<Unit | null> };
  hand: CardDef[];
  deck: string[];
  discard: CardDef[];
  command: { cur: number; max: number };
  fatigue: number;
}

export interface MatchState {
  seed: number;
  uidSeq: number;
  rngState: number;
  turn: number;
  active: Side;
  sides: Record<Side, SideState>;
  winner: Side | 'draw' | null;
}

/* ============================================================
   动作
   ============================================================ */

export type Action =
  | { type: 'PLAY_CARD'; cardIndex: number; row?: Row; col?: number }
  | { type: 'ATTACK'; from: { row: Row; col: number }; to: { kind: 'unit'; row: Row; col: number } | { kind: 'lord' } }
  | { type: 'USE_LORD_SKILL'; target?: { side: Side; row?: Row; col?: number } }
  | { type: 'USE_SKILL'; row: Row; col: number; target?: { side: Side; row?: Row; col?: number } }
  | { type: 'END_TURN' };

/* ============================================================
   事件流（客户端只消费这个）
   ============================================================ */

export type GameEvent =
  | { type: 'TURN_START'; side: Side; turn: number; command: { cur: number; max: number } }
  | { type: 'TURN_END'; side: Side; turn: number }
  | { type: 'CARD_DRAWN'; side: Side; card: CardDef; deckLeft: number }
  | { type: 'FATIGUE'; side: Side; amount: number; hp: number }
  | { type: 'CARD_PLAYED'; side: Side; card: CardDef; row?: Row; col?: number; handIndex?: number }
  | { type: 'UNIT_SUMMONED'; side: Side; row: Row; col: number; unit: Unit }
  | { type: 'ATTACK_DECLARED'; side: Side; from: { row: Row; col: number }; to: unknown }
  | { type: 'DAMAGE'; target: { kind: 'unit' | 'lord'; side: Side; row?: Row; col?: number }; amount: number; source: string }
  | { type: 'HEAL'; target: { kind: 'unit' | 'lord'; side: Side; row?: Row; col?: number }; amount: number; hp: number }
  | { type: 'ARMOR_GAINED'; side: Side; amount: number; armor: number }
  | { type: 'STATUS_APPLIED'; side: Side; row?: Row; col?: number; status: string; stacks: number }
  | { type: 'STATUS_EXPIRED'; side: Side; row: Row; col: number; status: string }
  | { type: 'UNIT_DIED'; side: Side; row: Row; col: number; unit: Unit }
  | { type: 'LORD_SKILL_USED'; side: Side; skill: string }
  | { type: 'GAME_OVER'; winner: Side | 'draw' }
  | { type: 'REJECTED'; reason: string; action: Action };

export interface ApplyResult {
  ok: boolean;
  state: MatchState;
  events: GameEvent[];
  error?: string;
}

/** 引擎上下文：卡牌索引（不放进 state，避免快照体积膨胀） */
export interface EngineContext {
  cards: Map<string, CardDef>;
  lords: Record<Side, LordDef>;
}
