/**
 * core 的类型定义
 *
 * 铁律：core 只依赖这里的类型，**不引用任何引擎（Cocos）类型**。
 * 客户端把 core 产出的 Event 翻译成动画即可。
 */

export type Side = 'own' | 'enemy';
export type Row = 'front' | 'back';
export type CardType =
  | 'troop' | 'general' | 'strategist' | 'event' | 'tactic' | 'elite' | 'special'
  | 'lord'      // 主公卡（不进卡组，见 ADR-014）
  | 'token'     // 衍生物（召唤产生，不进卡组）
  | 'status';   // 属性/状态卡（如「架盾」）
export type Faction = 'shu' | 'wei' | 'wu' | 'qun' | 'neutral';

/* ============================================================
   卡牌数据（来自 data/*.yaml，见 docs/gdd/05-cards.md）
   ============================================================ */

/** 效果条件（ADR-033）：四种写法见 docs/gdd/13-balance-data-model.md §7.6 */
export interface EffectCondition {
  exists?: TargetSelector;                                   // 该集合非空
  count?: { selector: TargetSelector; op: CompareOp; value: number };   // 数量与定值比
  count_vs?: { left: TargetSelector; right: TargetSelector; op: CompareOp };  // 两集合互比
  event?: 'killed' | 'clash_won' | 'clash_lost';             // 本次结算中的事件
  /** 所选目标属于哪一方（陈宫「忠烈」：选敌将 vs 选友将走不同分支，ADR-069） */
  chosen_side?: 'ally' | 'enemy';
  /** 完整回合数上限（马超「首回合击杀」= turn_max:1，ADR-070） */
  turn_max?: number;
  /** 本次被击杀者的卡牌类型（马超只认「武将」，ADR-070） */
  victim_type?: 'troop' | 'general' | 'strategist';
}

export type CompareOp = '>=' | '<=' | '==' | '>' | '<' | '!=';

export interface CardEffect {
  action: string;
  value?: number;
  chance?: number;               // 概率 0–1（ADR-033）
  condition?: EffectCondition;   // 条件（ADR-033）
  clashMode?: 'roll' | 'cost';   // clash 的比法
  from?: 'top' | 'bottom';       // scry 的取牌端
  status_source?: 'self';        // apply_status 时把来源单位记为状态的 srcUid（ADR-039）
  value_from_discarded?: 'cost' | 'health';   // 取「最近被弃牌」的属性作为数值（ADR-040）
  value_from_flag?: string;                   // 取 flags 中 "<name>:N" 的 N 作为数值（ADR-041）        // apply_status 时把来源单位记为状态的 srcUid（ADR-039）
  attack_from?: TargetSelector;  // 动态取值：攻击 = 该集合数量
  health_from?: TargetSelector;  // 动态取值：生命 = 该集合数量
  value_from?: TargetSelector;   // 动态取值：value = 该集合数量（damage/heal/draw 等通用）
  attack?: number;               // modify 专用：单独修正攻击（ADR-030）
  health?: number;               // modify 专用：单独修正生命上限
  status?: string;
  stacks?: number;
  duration?: string | number;
  unit?: string;                 // summon 的召唤物 id；scry 的 'top' | 'bottom'
  count?: number;
  position?: string;
  to?: 'hand' | 'deck_top' | 'deck_bottom' | 'discard' | 'board';   // scry/steal 的落点
  // transform：进化目标卡 id（写在 to 上，与 scry 的落点区分由 action 决定）
  target?: TargetSelector;
  /** discard 专用：'choose' 表示由调用方通过 ctx.handIndex 指定弃哪张 */
  mode?: 'choose' | 'random';
}

export interface TargetSelector {
  side?: 'ally' | 'enemy' | 'both' | 'self';
  zone?: 'board' | 'hand';       // 作用区域，默认 board（ADR-038）
  source?: boolean;              // true = 只选「来源单位自身」（ADR-033）
  /** 本次事件里的另一方单位（华雄亡语：使**击杀者**获得 +1/+1，ADR-070） */
  event?: 'killer' | 'victim';
  lord?: boolean;                // true = 选该方主帅（ADR-036）
  filter?: {
    type?: CardType | 'character';
    keyword?: string;
    tag?: string;                  // 归属标签，见 data/tags.yaml（ADR-029）
    faction?: Faction;
    lane?: number;
    row?: Row;
    health_max?: number;
    cost_max?: number;             // 统帅值上限（绝对，含）
    cost_min?: number;             // 统帅值下限（绝对，含）——与 cost_max 配合可写出互斥分支
    cost_below_source?: boolean;   // 统帅值低于来源单位（相对，"低于自己统帅的敌军"）ADR-036
    attack_below_source?: boolean; // 攻击力低于来源单位（张飞「咆哮」）ADR-069
    card_id?: string;              // 指定具体卡（关平亡语指定「关羽」）ADR-069
    troopKind?: 'infantry' | 'shield' | 'archer';   // 兵种（进化卡按兵种选目标，ADR-042）
    has_status?: string;
    adjacent_to?: 'self';          // 相邻单位（"相邻的己方人物"）
    include_lord?: boolean;        // 候选池额外纳入该方主将（ADR-051，弓兵射箭「含主将」）
  };
  count?: number | 'all';
  mode?: 'choose' | 'random' | 'first' | 'lowest_health';
  require_empty?: boolean;
}

export interface SkillDef {
  id: string;
  name: string;
  kind: 'active' | 'trigger' | 'aura';
  /** 效果 DSL（翻译后的可执行定义，见 docs/gdd/13-balance-data-model.md §7） */
  dsl?: SkillDef[];
  cost?: number;
  frequency?: 'once_per_turn' | 'unlimited' | 'once';
  trigger?: string;              // TIMING 常量
  chance?: number;               // 技能级概率（免死等，ADR-039）
  target?: TargetSelector;
  effects?: CardEffect[];
  /** 卡面技能文案（来自手写卡；仅用于显示与校验，不参与结算） */
  text?: string;
}

export interface CardDef {
  /**
   * 稀有度（ADR-068）：普通卡必须贴合同费预算；
   * **精英卡（橙卡）允许强于预算** —— 设计者明确"有些卡稍强是预期的，类似炉石的橙卡"。
   * 校验器据此把"偏离预算"从 error 降为提示。
   */
  rarity?: 'common' | 'elite';
  id: string;
  name: string;
  faction: Faction;
  type: CardType;
  cost: number;
  attack?: number;
  health?: number;
  troopKind?: 'infantry' | 'shield' | 'archer';
  keywords?: string[];
  tags?: string[];               // 归属标签：西凉/蛮族/黄巾/士族（ADR-029）
  skills?: SkillDef[];
  bonds?: string[];
  effects?: CardEffect[];        // 非人物卡的直接效果
  cost_rule?: { condition: EffectCondition; value: number };   // 条件费用规则（ADR-040）
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

/** 状态实例（ADR-034）：层数 + 剩余回合数 */
export interface StatusInstance {
  stacks: number;                // 数值型的层数；标志型恒为 1
  turns?: number;                // 剩余回合数；undefined = 永久
  srcUid?: string;               // 状态来源单位（守护类状态据此找到「谁替我挨打」，ADR-039）
  auraId?: string;               // 由哪个光环施加（重算时先清后加，避免累加，ADR-041）
}

/** 属性修正项（ADR-037）：最终属性 = 基础值 + Σ mods */
export interface StatMod {
  id: string;                    // 来源技能 id；重算时按来源整体替换
  kind: 'aura' | 'temp' | 'permanent';
  attack?: number;
  health?: number;
  turns?: number;                // 'temp' 专用：剩余回合
}

/** 手牌实例（ADR-038）：包住共享的卡牌定义，承载"这张手牌"的独立状态 */
export interface HandCard {
  card: CardDef;                 // 卡牌定义（共享、不可变）
  mods: HandMod[];               // 手牌级修正
}

/** 手牌修正项（ADR-038，与 Unit.mods 同构） */
export interface HandMod {
  id: string;
  kind: 'cost' | 'ban';          // cost: 费用增减；ban: 禁止上场
  value?: number;                // cost 专用
  turns?: number;                // 剩余回合；undefined = 永久
  auraId?: string;               // 由哪个光环施加（重算时先清后加，ADR-041）
}

export interface Unit {
  uid: string;
  cardId: string;
  name: string;
  type: CardType;
  faction: Faction;
  cost: number;
  baseAtk: number;               // 卡面基础攻击（ADR-037）
  baseMaxHp: number;             // 卡面基础上限
  mods: StatMod[];               // 修正层
  atk: number;                   // 派生值 = baseAtk + Σmods.attack
  hp: number;
  maxHp: number;                 // 派生值 = baseMaxHp + Σmods.health
  troopKind?: string;
  kw: string[];
  tags: string[];                // 归属标签（ADR-029）
  statuses: Record<string, StatusInstance>;   // 状态实例（ADR-034）
  skills?: SkillDef[];
  attackedThisTurn: number;
  enteredTurn: number;
  /** 本回合各主动技已使用次数，key = 技能 id 或下标（GDD 10 §1.1 频率限制） */
  skillUsesThisTurn: Record<string, number>;
  /** 本局已用过的「一局一次」技能键 */
  skillsUsedOnce: string[];
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
  statuses?: Record<string, StatusInstance>;   // 主公状态（ADR-040）
  skillUsesPerTurn?: number;                   // 主公技每回合可用次数（默认 1）
}

export interface SideState {
  lord: Lord;
  rows: { front: Array<Unit | null>; back: Array<Unit | null> };
  hand: HandCard[];
  deck: string[];
  discard: CardDef[];
  command: { cur: number; max: number };
  fatigue: number;
  /** 本局是否已用过换牌机会（GDD 03 §1 第③步） */
  mulliganDone: boolean;
}

export interface MatchState {
  seed: number;
  uidSeq: number;
  rngState: number;
  /**
   * **完整回合数**（双方各行动一次 = 一个完整回合，ADR-064）。
   * 只在双方都行动完后 +1 —— 与统率值上限的增长严格同步。
   * 需要"半回合"粒度时用 halfTurn。
   */
  turn: number;
  /** 半回合数：每有一方开始行动就 +1（先手 = 1，后手 = 2，先手 = 3 …） */
  halfTurn: number;
  active: Side;
  sides: Record<Side, SideState>;
  winner: Side | 'draw' | null;
  /** 后手补偿方式（ADR-053） */
  secondCompensation?: 'none' | 'extra_draw';
}

/* ============================================================
   动作
   ============================================================ */

export type Action =
  | { type: 'PLAY_CARD'; cardIndex: number; row?: Row; col?: number;
      /** 战吼（on_play）需要玩家选目标时，在此带上所选目标（ADR-069） */
      target?: { side: Side; row: Row; col: number } }
  | { type: 'ATTACK'; from: { row: Row; col: number }; to: { kind: 'unit'; row: Row; col: number } | { kind: 'lord' } }
  | { type: 'USE_LORD_SKILL'; target?: { side: Side; row?: Row; col?: number }; handIndex?: number }
  | { type: 'USE_SKILL'; row: Row; col: number; target?: { side: Side; row?: Row; col?: number }; handIndex?: number }
  | { type: 'END_TURN' };

/* ============================================================
   事件流（客户端只消费这个）
   ============================================================ */

export type GameEvent =
  | { type: 'TURN_START'; side: Side; turn: number; halfTurn: number; command: { cur: number; max: number } }
  | { type: 'TURN_END'; side: Side; turn: number; halfTurn: number }
  | { type: 'CARD_DRAWN'; side: Side; card: CardDef; deckLeft: number }
  | { type: 'CARD_AUTO_CAST'; side: Side; card: CardDef }
  | { type: 'DECK_ADDED'; side: Side; card: CardDef; count: number; to?: 'hand' | 'deck' }
  | { type: 'DECK_SENT'; side: Side; cardId: string; count: number }
  | { type: 'CARD_RETURNED_TO_DECK'; side: Side; card: CardDef }
  | { type: 'FATIGUE'; side: Side; amount: number; hp: number }
  | { type: 'CARD_PLAYED'; side: Side; card: CardDef; row?: Row; col?: number; handIndex?: number }
  | { type: 'UNIT_SUMMONED'; side: Side; row: Row; col: number; unit: Unit }
  | { type: 'ATTACK_DECLARED'; side: Side; from: { row: Row; col: number }; to: unknown }
  | { type: 'DAMAGE'; target: { kind: 'unit' | 'lord'; side: Side; row?: Row; col?: number }; amount: number; source: string }
  | { type: 'HEAL'; target: { kind: 'unit' | 'lord'; side: Side; row?: Row; col?: number }; amount: number; hp: number }
  | { type: 'ARMOR_GAINED'; side: Side; amount: number; armor: number }
  | { type: 'STATUS_APPLIED'; side: Side; row?: Row; col?: number; status: string; stacks: number; turns?: number }
  | { type: 'UNIT_TRANSFORMED'; side: Side; row: Row; col: number; from: string; to: string; unit: Unit }
  | { type: 'DRAW_BLOCKED'; side: Side }
  | { type: 'EXTRA_ATTACK'; side: Side; row: Row; col: number }
  | { type: 'CONTROL_TAKEN'; from: Side; to: Side; unit: Unit }
  | { type: 'SKILL_COPIED'; side: Side; from: string; skill: string }
  | { type: 'FORCED_ATTACK'; side: Side; row: Row; col: number }
  | { type: 'LORD_STATUS_EXPIRED'; side: Side; status: string }
  | { type: 'DAMAGE_REDIRECTED'; side: Side; row: Row; col: number; to: Side; guardName: string }
  | { type: 'UNIT_SURVIVED'; side: Side; row: Row; col: number; unit: Unit }
  | { type: 'UNIT_FLIPPED'; side: Side; row: Row; col: number; to: 'front' | 'back'; unit: Unit }
  | { type: 'HAND_MODIFIED'; side: Side; index: number; kind: 'cost' | 'ban'; value?: number; turns?: number }
  | { type: 'CARD_STOLEN'; from: Side; to: Side; card: CardDef }
  | { type: 'CARD_SCRYED'; side: Side; cardId: string; from: 'top' | 'bottom' }
  | { type: 'CLASH'; side: Side; mine: number; theirs: number; won: boolean }
  | { type: 'STATUS_BLOCKED'; side: Side; row?: Row; col?: number; status: string; reason: string }
  | { type: 'CARD_DISCARDED'; side: Side; card: CardDef }
  | { type: 'UNIT_RETURNED'; side: Side; row: Row; col: number; unit: Unit }
  | { type: 'STAT_MODIFIED'; side: Side; row: Row; col: number;
      attack?: number; health?: number; value?: number; duration?: string | number }
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
