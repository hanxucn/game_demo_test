/**
 * 常量表：关键词、状态、结算时机
 * 对应 docs/gdd/06-keywords.md 与 docs/gdd/10-skills-statuses.md
 */

import type { Row } from './types.ts';

/**
 * 战场：**一行 8 格**（ADR-051）。
 *
 * 原设计是 5 列 × 2 排（前后军），现已改为单排——「同列」「穿透」「前后军」概念全部作废。
 * `back` 这一排在数据模型里保留（值为空、任何迭代都不会读它），
 * 以免一次性改动过大；后续清理时可整体删除。
 */
export const BOARD = {
  COLS: 8,
  ROWS: ['front'] as Row[],
  MAX_UNITS: 8,
};

export const LORD_HP = 30;

export const COMMAND = { START: 1, MAX: 10 };

/** 主公技默认统率消耗（数据未给 cost 时兜底）；ADR-049 起统一 2 */
export const LORD_SKILL_COST = 2;

export const DECK = {
  SIZE: 30,
  HAND_START_FIRST: 3,
  HAND_START_SECOND: 4,
  HAND_LIMIT: 10,
  DRAW_PER_TURN: 1,
};

/**
 * 对局终止（ADR-054）：**只有主将阵亡一种结束方式，没有回合上限、没有平局**。
 *
 * 依据：每回合至少抽 1 张；牌库抽空后触发「粮尽」递增伤害（1、2、3…），
 * 必然会把某一方主将扣死——所以对局一定会自然收束，不需要人为设上限。
 */
export const MATCH = {
  TURN_LIMIT: Infinity,
  /**
   * 每方回合时限（秒）。到点自动结束该方回合（ADR-065）。
   * 放在 core 而不是原型里 —— 它与「回合上限」「统率上限」同属对局规则常量。
   */
  TURN_SECONDS: 60,
};

/** 关键词表（implemented=false 表示引擎尚未实现，校验器会告警） */
/**
 * 关键词表（ADR-054：定义由设计者逐条给出，2026-09-12）
 *
 * `implemented: false` 表示**定义已定、引擎尚未实现**——校验器会对使用者告警，
 * 避免"卡面写了但实际不生效"的静默白板。
 */
export const KEYWORDS: Record<string, { name: string; implemented: boolean; note: string }> = {
  jia_dun:   { name: '架盾', implemented: true,
               note: '嘲讽：敌方普通攻击必须先打它（ADR-051）' },
  xian_gong: { name: '先攻', implemented: true,
               note: '入场当回合即可行动攻击（ADR-055 设计者澄清：这就是它的全部含义，与「疾行」是同一个）' },
  lian_ji:   { name: '连击', implemented: true,
               note: '当前回合普通攻击可执行 2 次' },
  yi_ji:     { name: '遗计', implemented: true,
               note: '类亡语：阵亡时触发该卡定义的 on_death 逻辑' },
  yin_xue:   { name: '饮血', implemented: true,
               note: '对敌人造成的伤害，为该单位自身恢复等量生命（ADR-057 设计者定稿：回自己，不回主将）' },
  sheng_dun: { name: '圣盾', implemented: true,
               note: '拥有一个圣盾状态，可免疫一次伤害；伤害被免疫后该状态消耗掉（ADR-057 设计者定稿）' },
  shen_she:  { name: '神射', implemented: false,
               note: '对随机敌人造成远程伤害，且不受对方攻击影响（待实现）' },
  qi_xi:     { name: '奇袭', implemented: false,
               note: '上场先隐身（不能被选定）；下回合可选择行动攻击，执行过行动后隐身消失（待实现）' },
  zhong_yi:  { name: '忠义', implemented: false,
               note: '免疫混乱、离间等状态（待实现。注：原实现误做成"阵亡触发亡语"，已纠正）' },
};

/** 已取消的关键词（保留列表以免数据误用） */
export const RETIRED_KEYWORDS: Record<string, string> = {
  ji_xing: '疾行 —— 与「先攻」是同一个东西（设计者裁定），已合并，请改用 xian_gong',
  wu_shuang: '无双 —— 设计者：暂时没有这个状态',
  wu_sheng: '武圣 —— 设计者：废弃此名（关羽的技能名用「水淹七军」）；其"免疫一次伤害"的机制改名为「圣盾」',
  jie_zhen: '结阵 —— 设计者：移除该效果（引擎里"相邻有友方步兵时 +1 攻"是 AI 自己推的，从未被设计）',
};


/**
 * 归属标签注册表（ADR-029）
 * 与关键词/状态同理：数据里引用未注册的标签，校验直接报错。
 */
export const TAGS: Record<string, { name: string; note: string }> = {
  xi_liang:  { name: '西凉', note: '西凉出身：马腾、马超、马岱' },
  man_zu:    { name: '蛮族', note: '南方异族：沙摩柯' },
  huang_jin: { name: '黄巾', note: '黄巾军出身或其旧部' },
  shi_zu:    { name: '士族', note: '士族门阀：袁绍及其士族兵' },
  cao_clan:  { name: '曹氏宗亲', note: '曹操宗族人物：曹昂、曹休、曹彰、曹仁、曹丕等' },
};

export const FORBIDDEN_KEYWORD_COMBOS: string[][] = [
  ['jia_dun', 'qi_xi'],
];

/**
 * 状态能力（ADR-034）
 *
 * 引擎**只查能力、不认状态 id**——新增状态只需在数据里声明能力，无需改代码。
 */
export type StatusCap =
  | 'block_attack'      // 不能普通攻击
  | 'block_skill'       // 不能使用主动技
  | 'block_action'      // 完全无法行动（攻击与技能都封）
  | 'untargetable'      // 不能被指定为目标（含攻击与效果）
  | 'random_target'     // 攻击与技能的目标在**全场**随机（混乱）
  | 'immune_debuff'     // 免疫负面状态（负面 debuff 施加无效）
  | 'immune_damage'     // 免疫伤害（一次性，触发后消耗）
  | 'redirect_damage'   // 伤害重定向：伤害转由状态的 srcUid 承受（ADR-039）
  | 'block_lord_skill'  // 该方主帅不能使用主公技（ADR-040）
  | 'extra_lord_skill'   // 该方主帅每回合主公技次数 +stacks（ADR-040）
  | 'block_draw'         // 该方不能抽牌（灾年，ADR-041）
  | 'duel_lock'          // 单挑锁定：不可被第三方选中（许褚，ADR-041）
  | 'mark_damage'        // 被标记：受到伤害时触发标记者的联动（法正，ADR-041）
  | 'skip_turn';         // 该方整个回合被跳过（ADR-074，休养生息「下一回合不进行任何活动」）

export interface StatusDef {
  name: string;
  kind: 'buff' | 'debuff';
  numeric: boolean;
  duration: 'permanent' | 'turns' | 'until_consumed' | 'conditional' | 'this_turn';
  scope?: 'character' | 'lord';
  note: string;
  caps?: StatusCap[];    // 能力列表：引擎据此判定行为
  /**
   * 守护范围（ADR-071）：只有这个状态挂在**谁**身上、以及它拦截**谁**的伤害。
   *   · 'any'（默认）—— `shou_hu`：被守护者受到的伤害都转给 srcUid（陈宫「忠烈」）
   *   · 'lord'        —— `hu_zhu`：只有**该方主帅**受到的伤害才转给 srcUid（祖茂「替主」）
   * 见 `mutate.findGuard` / `mutate.findLordGuard`。
   */
  guard_scope?: 'any' | 'lord';
}

export const STATUSES: Record<string, StatusDef> = {
  zhen_fen:   { name: '振奋', kind: 'buff',   numeric: true,  duration: 'permanent', note: '攻击 +N' },
  ji_jiu:     { name: '急救', kind: 'buff',   numeric: true,  duration: 'permanent', note: '回合开始恢复 N 点生命' },
  jia_dun_status: { name: '架盾', kind: 'buff',   numeric: false, duration: 'conditional', note: '嘲讽（ADR-051）' },
  xian_gong_status: { name: '先攻', kind: 'buff',   numeric: false, duration: 'permanent',
                note: '入场当回合即可行动攻击（ADR-055）' },
  qi_xi_status: { name: '奇袭', kind: 'buff',   numeric: false, duration: 'until_consumed', note: '不能被指定为目标' },
  sheng_dun_status:   { name: '圣盾', kind: 'buff',   numeric: false, duration: 'until_consumed', caps: ['immune_damage'],
                note: '免疫一次伤害' },
  hu_jia:     { name: '护甲', kind: 'buff',   numeric: true,  duration: 'permanent', scope: 'lord', note: '吸收伤害' },
  zhen_she:   { name: '震慑', kind: 'debuff', numeric: false, duration: 'turns', caps: ['block_action'],
                note: '不能普攻，也不能使用主动技' },
  hun_luan:   { name: '混乱', kind: 'debuff', numeric: false, duration: 'turns', caps: ['random_target'],
                note: '普攻与主动技的目标在**全场**中随机（不分敌我）' },
  zhen_wang:  { name: '阵亡标记', kind: 'debuff', numeric: false, duration: 'permanent',
                note: '被标记：阵亡时为标记者触发效果' },
  duan_chou:  { name: '断抽', kind: 'debuff', numeric: false, duration: 'turns', caps: ['block_draw'],
                note: '该方本回合不能抽牌' },
  jue_dou:    { name: '决斗', kind: 'debuff', numeric: false, duration: 'turns', caps: ['duel_lock'],
                note: '单挑中：第三方无法对其出手' },
  chou_di:    { name: '仇敌', kind: 'debuff', numeric: false, duration: 'permanent', caps: ['mark_damage'],
                note: '被法正标记：受到伤害时为其指定友方回血' },
  jin_yan:    { name: '进言', kind: 'debuff', numeric: false, duration: 'turns', caps: ['block_lord_skill'],
                note: '该方主帅不能使用主公技' },
  can_mou:    { name: '参谋', kind: 'buff',   numeric: true,  duration: 'permanent', scope: 'lord',
                caps: ['extra_lord_skill'], note: '该方主帅每回合主公技次数 +N' },
  shou_hu:    { name: '守护', kind: 'buff',   numeric: false, duration: 'turns', caps: ['redirect_damage'],
                guard_scope: 'any',
                note: '受到的伤害转由守护者承受（援护/分担/护驾共用）' },
  hu_zhu:     { name: '护主', kind: 'buff',   numeric: false, duration: 'turns', caps: ['redirect_damage'],
                guard_scope: 'lord',
                note: '只把**该方主帅**受到的伤害转给守护者（祖茂「替主」，ADR-071）' },
  kong_cheng: { name: '空城', kind: 'buff',   numeric: false, duration: 'turns', scope: 'lord',
                caps: ['untargetable'],
                note: '该方主帅**不能被普通攻击指定为目标**（空城计，ADR-074）。只挡攻击，不挡效果' },
  xiu_zheng:  { name: '休整', kind: 'debuff', numeric: false, duration: 'until_consumed', scope: 'lord',
                caps: ['skip_turn'],
                note: '该方下一个回合整个被跳过（休养生息「下一回合不进行任何活动」，ADR-074）' },
  jin_yong:   { name: '禁用', kind: 'debuff', numeric: false, duration: 'turns', caps: ['block_skill'],
                note: '不能使用主动技与触发技（silence）' },
  jin_gu:     { name: '禁锢', kind: 'debuff', numeric: false, duration: 'turns',
                caps: ['block_attack', 'block_skill'],
                note: '不能普攻也不能用主动技（陈宫「忠烈」对敌军分支，ADR-069）' },
  jin_gong:   { name: '无法攻击', kind: 'debuff', numeric: false, duration: 'turns',
                caps: ['block_attack'],
                note: '本回合不能普通攻击' },
  mian_yi:    { name: '免疫', kind: 'buff',   numeric: false, duration: 'turns', caps: ['immune_debuff', 'untargetable'],
                note: '免疫负面状态，且不能被指定为目标' },
  fan_mian:   { name: '翻面', kind: 'debuff', numeric: false, duration: 'conditional',
                caps: ['block_action', 'untargetable'],
                note: '被翻面：当回合不能行动、不能被指定为目标；自己的下个回合开始时翻回正面（ADR-059）' },
  zhong_du:   { name: '中毒', kind: 'debuff', numeric: true,  duration: 'permanent', note: '回合结束失去 N 生命' },
  xu_ruo:     { name: '虚弱', kind: 'debuff', numeric: true,  duration: 'turns', note: '攻击 −N' },
  duan_liang: { name: '断粮', kind: 'debuff', numeric: true,  duration: 'turns', scope: 'lord', note: '统率上限 −N' },
};

export const TIMING = {
  TURN_START: 'turn_start',
  DRAW: 'draw',
  ON_PLAY: 'on_play',
  ON_DEATH: 'on_death',
  ON_DAMAGED: 'on_damaged',
  TURN_END: 'turn_end',
  ON_ATTACK: 'on_attack',
  ON_DEFEND: 'on_defend',
  ON_LETHAL: 'on_lethal',
  ON_CARD_PLAYED: 'on_card_played',
  ON_MARK_DAMAGED: 'on_mark_damaged',
  ON_MARK_DEATH: 'on_mark_death',
  ON_KILL: 'on_kill',          // 击杀者视角：每次击杀时（ADR-070）
} as const;

export const ACTIONS = [
  'damage', 'heal', 'draw', 'summon', 'apply_status', 'remove_status',
  'move', 'destroy', 'modify', 'gain_armor', 'gain_command', 'cost_modifier', 'transform', 'random_pick',
  'discard', 'return_to_hand', 'clash', 'flip', 'scry', 'ban_play', 'steal_card', 'survive',
  'extra_attack', 'take_control', 'copy_skill', 'force_attack',
  'add_to_deck',   // 往牌库随机位置塞 N 张指定卡（ADR-050）
  'send_to_deck',  // 把牌库里剩下的指定牌全塞给对方（ADR-050）
  'cycle_to_deck', // 手牌放回牌库随机位置再抽 1 张（ADR-050）
  'sacrifice',     // 牺牲一个己方单位，把它的 maxHp/hp 写进 flags（ADR-071，程昱）
  'attack_each',   // 挨个发动**真正的普攻**（含反击），自己阵亡即停（ADR-071，张苞）
  'draw_until',    // 一直抽到抽出一张「非某类型」的牌为止（ADR-071，姜维）
  'mill',          // 弃掉目标方牌库的 N 张牌（ADR-074，司马懿「谋定后动」②）
  'discover',      // 从牌库随机展示候选牌并由玩家选择（曹丕）
] as const;

/** 稀有度（ADR-068）：普通 / 精英。精英卡允许强于同费预算 */
export const RARITIES = ['common', 'elite'] as const;

export const CARD_TYPES = ['troop', 'general', 'strategist', 'event', 'tactic', 'elite', 'special',
  'lord',     // 主将卡：开局置于主将位，不进卡组（ADR-044）
  'token',    // 衍生物：只能由效果召唤，不可组入卡组（ADR-044）
  'status',   // 状态卡：持续性全局效果，置于状态区（ADR-044）
] as const;

/** 不可组入卡组的类型（由规则或效果放入场） */
export const NON_DECK_TYPES = ['elite', 'lord', 'token', 'status', 'special'] as const;
