/**
 * 常量表：关键词、状态、结算时机
 * 对应 docs/gdd/06-keywords.md 与 docs/gdd/10-skills-statuses.md
 */

import type { Row } from './types.ts';

export const BOARD = {
  COLS: 5,
  ROWS: ['front', 'back'] as Row[],
  MAX_UNITS: 10,
};

export const LORD_HP = 30;

export const COMMAND = { START: 1, MAX: 10 };

export const DECK = {
  SIZE: 30,
  HAND_START_FIRST: 3,
  HAND_START_SECOND: 4,
  HAND_LIMIT: 10,
  DRAW_PER_TURN: 1,
};

export const MATCH = { TURN_LIMIT: 40 };

/** 关键词表（implemented=false 表示引擎尚未实现，校验器会告警） */
export const KEYWORDS: Record<string, { name: string; implemented: boolean; note: string }> = {
  zhong_yi:  { name: '忠义', implemented: true, note: '阵亡时触发卡牌定义的 on_death 效果' },
  yi_ji:     { name: '遗计', implemented: true, note: '阵亡时抽 1 张牌' },
  ji_xing:   { name: '疾行', implemented: true, note: '入场当回合即可攻击' },
  jia_dun:   { name: '架盾', implemented: true, note: '仅前军生效的全局嘲讽' },
  wu_sheng_status: { name: '武圣', implemented: true, note: '免疫一次伤害' },
  shen_she:  { name: '神射', implemented: true, note: '可攻击任意列的人物卡' },
  lian_ji:   { name: '连击', implemented: true, note: '每回合可攻击 2 次' },
  yin_xue:   { name: '饮血', implemented: true, note: '造成伤害时为己方主将回复等量生命' },
  qi_xi_status: { name: '奇袭', implemented: true, note: '不能被指定为攻击目标；攻击后失去' },
  xian_gong: { name: '先攻', implemented: true, note: '先结算伤害，目标阵亡则不受反击' },
  jie_zhen:  { name: '结阵', implemented: true, note: '相邻有友方步兵时本次普攻 +1' },
  wu_shuang: { name: '无双', implemented: true, note: '攻击时不受到反击伤害' },
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
  | 'mark_damage';       // 被标记：受到伤害时触发标记者的联动（法正，ADR-041）

export interface StatusDef {
  name: string;
  kind: 'buff' | 'debuff';
  numeric: boolean;
  duration: 'permanent' | 'turns' | 'until_consumed' | 'conditional' | 'this_turn';
  scope?: 'character' | 'lord';
  note: string;
  caps?: StatusCap[];    // 能力列表：引擎据此判定行为
}

export const STATUSES: Record<string, StatusDef> = {
  zhen_fen:   { name: '振奋', kind: 'buff',   numeric: true,  duration: 'permanent', note: '攻击 +N' },
  ji_jiu:     { name: '急救', kind: 'buff',   numeric: true,  duration: 'permanent', note: '回合开始恢复 N 点生命' },
  jia_dun_status: { name: '架盾', kind: 'buff',   numeric: false, duration: 'conditional', note: '仅前军生效' },
  xian_gong_status: { name: '先攻', kind: 'buff',   numeric: false, duration: 'permanent', note: '先结算伤害' },
  qi_xi_status: { name: '奇袭', kind: 'buff',   numeric: false, duration: 'until_consumed', note: '不能被指定为目标' },
  wu_sheng_status:   { name: '武圣', kind: 'buff',   numeric: false, duration: 'until_consumed', caps: ['immune_damage'],
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
                note: '受到的伤害转由守护者承受（援护/分担/护驾共用）' },
  jin_yong:   { name: '禁用', kind: 'debuff', numeric: false, duration: 'turns', caps: ['block_skill'],
                note: '不能使用主动技与触发技（silence）' },
  mian_yi:    { name: '免疫', kind: 'buff',   numeric: false, duration: 'turns', caps: ['immune_debuff', 'untargetable'],
                note: '免疫负面状态，且不能被指定为目标' },
  fan_mian:   { name: '翻面', kind: 'debuff', numeric: false, duration: 'conditional', caps: ['block_action', 'untargetable'],
                note: '翻面期间无法行动也不能被选中，需特定条件翻回正面，下回合才能行动' },
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
} as const;

export const ACTIONS = [
  'damage', 'heal', 'draw', 'summon', 'apply_status', 'remove_status',
  'move', 'destroy', 'modify', 'gain_armor', 'gain_command', 'cost_modifier', 'transform', 'random_pick',
  'discard', 'return_to_hand', 'clash', 'flip', 'scry', 'ban_play', 'steal_card', 'survive',
  'extra_attack', 'take_control', 'copy_skill', 'force_attack',
] as const;

export const CARD_TYPES = ['troop', 'general', 'strategist', 'event', 'tactic', 'elite', 'special',
  'lord',     // 主将卡：开局置于主将位，不进卡组（ADR-044）
  'token',    // 衍生物：只能由效果召唤，不可组入卡组（ADR-044）
  'status',   // 状态卡：持续性全局效果，置于状态区（ADR-044）
] as const;

/** 不可组入卡组的类型（由规则或效果放入场） */
export const NON_DECK_TYPES = ['elite', 'lord', 'token', 'status', 'special'] as const;
