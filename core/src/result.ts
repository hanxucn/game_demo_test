/**
 * 对局结束：胜负判定与对局摘要
 *
 * 胜负本身由 core/src/mutate.ts 的 checkWinner 在状态变更时判定（主将阵亡即结束），
 * 或在 MATCH.TURN_LIMIT 到达时按主将剩余血量比较（core/src/engine.ts 的 endTurn）。
 * 这里负责把结束状态整理成一份可读摘要——客户端结算界面与服务端战报都用它。
 */

import { MATCH } from './constants.ts';
import { allUnits } from './state.ts';
import type { MatchState, Side } from './types.ts';

export type MatchResult = 'own' | 'enemy' | 'draw';

export interface SideSummary {
  side: Side;
  lordName: string;
  lordHp: number;
  lordMaxHp: number;
  lordArmor: number;
  /** 存活单位数 */
  units: number;
  /** 场上单位总攻击力 */
  totalAttack: number;
  /** 牌库剩余 */
  deckLeft: number;
  handLeft: number;
  discard: number;
  /** 已损失的主将血量 */
  damageTaken: number;
}

export interface MatchSummary {
  result: MatchResult;
  /** 结束原因 */
  reason: '主将阵亡' | '回合上限' | '未结束';
  turns: number;
  sides: Record<Side, SideSummary>;
  /** 胜方 */
  winnerName: string;
}

function summarize(state: MatchState, side: Side): SideSummary {
  const s = state.sides[side];
  const units = allUnits(state, side);
  return {
    side,
    lordName: s.lord.name,
    lordHp: s.lord.hp,
    lordMaxHp: s.lord.maxHp,
    lordArmor: s.lord.armor,
    units: units.length,
    totalAttack: units.reduce((a, r) => a + r.unit.atk, 0),
    deckLeft: s.deck.length,
    handLeft: s.hand.length,
    discard: s.discard.length,
    damageTaken: s.lord.maxHp - s.lord.hp,
  };
}

/** 整理对局摘要；未结束时 result 为 null 的替代品（reason='未结束'） */
export function summarizeMatch(state: MatchState): MatchSummary {
  const sides = { own: summarize(state, 'own'), enemy: summarize(state, 'enemy') };
  const result: MatchResult = state.winner ?? 'draw';

  // 结束原因：主将阵亡优先；否则看是否到了回合上限
  let reason: MatchSummary['reason'] = '未结束';
  if (state.winner) {
    const lordDead = state.sides.own.lord.hp <= 0 || state.sides.enemy.lord.hp <= 0;
    reason = lordDead ? '主将阵亡' : state.turn >= MATCH.TURN_LIMIT ? '回合上限' : '主将阵亡';
  }

  const winnerName = !state.winner
    ? '—'
    : state.winner === 'draw'
      ? '平局'
      : state.sides[state.winner].lord.name;

  return { result, reason, turns: state.turn, sides, winnerName };
}

/** 单行战报，便于日志与 smoke 输出 */
export function formatSummary(sum: MatchSummary): string {
  const { own, enemy } = sum.sides;
  return [
    `结果：${sum.winnerName === '平局' ? '平局' : `${sum.winnerName} 胜`}（${sum.reason}，第 ${sum.turns} 回合）`,
    `  己方 ${own.lordName} ${own.lordHp}/${own.lordMaxHp}${own.lordArmor ? `+${own.lordArmor}甲` : ''}` +
      ` | 场上 ${own.units} 人 共 ${own.totalAttack} 攻 | 牌库 ${own.deckLeft} 手 ${own.handLeft} 弃 ${own.discard}`,
    `  敌方 ${enemy.lordName} ${enemy.lordHp}/${enemy.lordMaxHp}${enemy.lordArmor ? `+${enemy.lordArmor}甲` : ''}` +
      ` | 场上 ${enemy.units} 人 共 ${enemy.totalAttack} 攻 | 牌库 ${enemy.deckLeft} 手 ${enemy.handLeft} 弃 ${enemy.discard}`,
  ].join('\n');
}
