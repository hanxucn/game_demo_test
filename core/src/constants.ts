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
  wu_sheng:  { name: '武圣', implemented: true, note: '免疫一次伤害' },
  shen_she:  { name: '神射', implemented: true, note: '可攻击任意列的人物卡' },
  lian_ji:   { name: '连击', implemented: true, note: '每回合可攻击 2 次' },
  yin_xue:   { name: '饮血', implemented: true, note: '造成伤害时为己方主将回复等量生命' },
  qi_xi:     { name: '奇袭', implemented: true, note: '不能被指定为攻击目标；攻击后失去' },
  xian_gong: { name: '先攻', implemented: true, note: '先结算伤害，目标阵亡则不受反击' },
  jie_zhen:  { name: '结阵', implemented: true, note: '相邻有友方步兵时本次普攻 +1' },
  wu_shuang: { name: '无双', implemented: true, note: '攻击时不受到反击伤害' },
};

export const FORBIDDEN_KEYWORD_COMBOS: string[][] = [
  ['jia_dun', 'qi_xi'],
];

export interface StatusDef {
  name: string;
  kind: 'buff' | 'debuff';
  numeric: boolean;
  duration: 'permanent' | 'turns' | 'until_consumed' | 'conditional' | 'this_turn';
  scope?: 'character' | 'lord';
  note: string;
}

export const STATUSES: Record<string, StatusDef> = {
  zhen_fen:   { name: '振奋', kind: 'buff',   numeric: true,  duration: 'permanent', note: '攻击 +N' },
  ji_jiu:     { name: '急救', kind: 'buff',   numeric: true,  duration: 'permanent', note: '回合开始恢复 N 点生命' },
  jia_dun:    { name: '架盾', kind: 'buff',   numeric: false, duration: 'conditional', note: '仅前军生效' },
  xian_gong:  { name: '先攻', kind: 'buff',   numeric: false, duration: 'permanent', note: '先结算伤害' },
  qi_xi:      { name: '奇袭', kind: 'buff',   numeric: false, duration: 'until_consumed', note: '不能被指定为目标' },
  wu_sheng:   { name: '武圣', kind: 'buff',   numeric: false, duration: 'until_consumed', note: '免疫一次伤害' },
  hu_jia:     { name: '护甲', kind: 'buff',   numeric: true,  duration: 'permanent', scope: 'lord', note: '吸收伤害' },
  zhen_she:   { name: '震慑', kind: 'debuff', numeric: false, duration: 'turns', note: '不能普攻与主动技' },
  hun_luan:   { name: '混乱', kind: 'debuff', numeric: false, duration: 'turns', note: '目标随机' },
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
} as const;

export const ACTIONS = [
  'damage', 'heal', 'draw', 'summon', 'apply_status', 'remove_status',
  'move', 'destroy', 'modify', 'gain_armor', 'gain_command', 'cost_modifier', 'transform', 'random_pick',
] as const;

export const CARD_TYPES = ['troop', 'general', 'strategist', 'event', 'tactic', 'elite', 'special'] as const;
