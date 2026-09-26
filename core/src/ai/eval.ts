/**
 * 局面评估（ADR-084）
 *
 * AI 的「棋感」全在这个函数里：给定一个局面，算出它对 `side` 有多好。
 * 搜索层（`index.ts`）只负责「把每个候选动作真的跑一遍引擎，再拿这个函数给结果打分」——
 * 于是所有规则细节（反击、圣盾、饮血、亡语、触发技）都天然被算进去，
 * 不需要在 AI 里重写一份战斗结算。
 *
 * 七项构成（对应设计者提出的 7 条策略）：
 *   ① 主将血量（打脸的收益）        ② 场面战力（换牌/解场的收益）
 *   ③ 单位数量差（以多打少）        ④ 手牌价值（卡差）
 *   ⑤ 未花掉的统率（浪费 mana 是亏）⑥ 被斩杀风险（对手场攻逼近我血线）
 *   ⑦ 粮尽（牌库见底的递增伤害）
 */

import { allUnits, hasTrait, other } from '../state.ts';
import { canAttack, effectiveAttack } from '../rules.ts';
import { handCardValue, unitValueOf } from './cards.ts';
import type { EvalWeights } from './profile.ts';
import type { MatchState, Side } from '../types.ts';

/** 胜负的绝对权重：任何斩杀/被斩杀都压过所有小分项 */
const WIN = 1e6;

/**
 * 对手血线越低，「打脸」越值钱（收尾直觉）。
 *
 * 没有这一项时，AI 会在对手 3 血时仍然慢悠悠换牌 —— 因为换牌的分一直比打脸高。
 * 20 血起算，逼近 0 血时收益翻倍。
 */
const finisherScale = (foeEff: number): number => 1 + Math.max(0, 20 - foeEff) / 20;

/** 评估 `state` 对 `side` 的优劣：越大越好 */
export function evaluate(state: MatchState, side: Side, w: EvalWeights): number {
  if (state.winner === side) return WIN;
  if (state.winner) return -WIN;

  const foe = other(side);
  const me = state.sides[side];
  const them = state.sides[foe];
  let score = 0;

  // ① 主将有效血量（含护甲）
  const myEff = me.lord.hp + me.lord.armor;
  const foeEff = them.lord.hp + them.lord.armor;
  score += (myEff - foeEff) * w.face * finisherScale(foeEff);

  // ② ③ 场面：战力当量 + 人数差
  const mine = allUnits(state, side);
  const theirs = allUnits(state, foe);
  let myBoard = 0;
  let foeBoard = 0;
  let incoming = 0;
  for (const r of mine) myBoard += unitValueOf(r.unit, (k) => hasTrait(r.unit, k));
  for (const r of theirs) {
    foeBoard += unitValueOf(r.unit, (k) => hasTrait(r.unit, k));
    incoming += effectiveAttack(state, foe, r.row, r.col);      // 对手下回合的场攻
  }
  score += (myBoard - foeBoard) * w.board;
  score += (mine.length - theirs.length) * w.width;

  // ④ 手牌（含手牌级费用修正）
  let handVal = 0;
  for (const hc of me.hand) handVal += handCardValue(hc);
  score += handVal * w.hand;

  // ⑤ 未花掉的统率：统率每回合清零，不用就是白扔
  score += me.command.cur * w.mana;

  // ⑤′ 还没用掉的**攻击机会**：同样是"过期作废"的资源，而且它决定"谁去解场"。
  //     只算**当前行动方** —— 非行动方的 `attackedThisTurn` 是上一轮的残留值，
  //     拿它判断"还能不能打"是错的（ADR-078 的 UI 三态边框踩过同一个坑）。
  let ready = 0;
  for (const r of mine) {
    if (canAttack(state, side, r.row, r.col).ok) ready += effectiveAttack(state, side, r.row, r.col);
  }
  score += ready * w.ready;

  // ⑥ 被斩杀风险：对手**场上**的普攻已经能覆盖我的血线时重罚。
  //    只算场攻（不含手牌里的直伤）——手牌是隐藏信息，AI 不该偷看。
  const overkill = incoming - myEff;
  if (overkill >= 0 && incoming > 0) score -= (overkill + 4) * w.threat;
  else if (overkill > -6) score -= (6 + overkill) * 0.25 * w.threat;

  // ⑦ 粮尽：牌库见底的一方每回合吃递增伤害
  if (me.deck.length === 0) score -= (me.fatigue + 1) * 1.5 * w.fatigue;
  if (them.deck.length === 0) score += (them.fatigue + 1) * 1.5 * w.fatigue;

  return score;
}
