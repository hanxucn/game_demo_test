/**
 * 卡组风格画像（ADR-084）
 *
 * 用户要求的两条相反策略 ——「速攻打脸少解牌」与「后期运营多站场」——
 * 不可能用同一套权重同时满足，所以先给**卡组**本身定一个风格，再据此调评估权重。
 *
 * 画像的取样口径是「整副牌」而不是「牌库里剩下的牌」：
 * 打出过的卡会离开牌库/手牌，若只看剩余牌，画像会随对局漂移（打着打着从快攻变控制）。
 * 因此把 牌库 + 手牌 + 弃牌堆 + 场上单位 一起还原成开局那 30 张。
 */

import type { CardDef, EngineContext, MatchState, Side } from '../types.ts';
import { allEffects, cardReachesLord, isCharacterCard } from './cards.ts';

export type AiStyle = 'aggro' | 'midrange' | 'control';

/** 评估权重（`eval.ts` 消费） */
export interface EvalWeights {
  /** 主将每 1 点有效血量（血 + 甲）的价值 —— 决定「打脸」的吸引力 */
  face: number;
  /** 场面每 1 点战力当量的价值 —— 决定「解场/换牌」的吸引力 */
  board: number;
  /**
   * **本回合还没用掉的攻击机会**（每点攻击力）的价值
   *
   * 用来打破「谁去解场」的平局：我方 3/3 与 4/5 面对对方 2/2 时，
   * 谁去打都只掉 2 血 —— 单纯按血量算两边**完全同分**，AI 只能按格子顺序瞎选。
   * 但打完剩下那个还要去打主将：留下 4/5 能多打 1 点。把"没行动的攻击力"计入评分，
   * AI 就会把解场交给刚好够用的那个，把大攻留给主将（设计者实机要求）。
   *
   * 取值必须**小于 `face`** —— 否则 AI 会为了"留着攻击机会"而不敢打脸，变成一味空过。
   */
  ready: number;
  /** 单位数量差（以多打少）每 1 个的价值 */
  width: number;
  /** 手牌每 1 点价值 */
  hand: number;
  /** 未花掉的统率值（每点）—— 统率每回合清零，囤着就是浪费 */
  mana: number;
  /** 被斩杀风险的惩罚系数 */
  threat: number;
  /** 牌库见底（粮尽）的惩罚系数 */
  fatigue: number;
}

export interface DeckProfile {
  style: AiStyle;
  /** 平均费用 */
  avgCost: number;
  /** 1–2 费占比 */
  cheapRatio: number;
  /** 5 费以上占比 */
  heavyRatio: number;
  /** 能打到脸的牌张数 */
  reach: number;
  /** 解牌张数 */
  removal: number;
  /** 人物卡张数 */
  units: number;
  weights: EvalWeights;
}

/**
 * 三套预设权重
 *
 * 只调三档，不做连续插值 —— 连续插值看起来"更精细"，实际上无法用测试固定行为，
 * 出了问题也说不清是哪一档偏了。
 *
 * **口径**：以「1 点场面战力当量 = 1.0」为锚，打脸权重是它的几分之一。
 * 依据是本作的实际数值 —— 主将 30 血、单位 4–8 点当量、一局 8–15 个完整回合。
 * 1 点打脸 ≈ 1/30 的胜势，而清掉一个 2 费人物 ≈ 5 点当量（含它之后的持续输出），
 * 所以「能白吃就解场」在数值上本来就该赢过糊脸（用户第 1 条策略）。
 * 后期越拖，打脸越不值钱；快攻则相反 —— 这是第 5、6 条策略的实现方式。
 */
export const STYLE_WEIGHTS: Record<AiStyle, EvalWeights> = {
  // 速攻：打脸优先，场面价值打折，手牌不值钱（抢的是回合数，不是卡差）
  aggro:    { face: 0.70, board: 0.85, ready: 0.35, width: 0.30, hand: 0.40, mana: 0.06, threat: 0.50, fatigue: 0.8 },
  // 中速：换牌与打脸并重，略微偏向解场
  midrange: { face: 0.45, board: 1.00, ready: 0.22, width: 0.50, hand: 0.55, mana: 0.06, threat: 0.90, fatigue: 1.0 },
  // 后期：站场与卡差优先，打脸只在不亏的前提下做
  control:  { face: 0.32, board: 1.15, ready: 0.16, width: 0.70, hand: 0.75, mana: 0.06, threat: 1.20, fatigue: 1.0 },
};

/** 开局那 30 张（还原：牌库 + 手牌 + 弃牌 + 场上） */
function fullDeckOf(state: MatchState, side: Side, ctx: EngineContext): CardDef[] {
  const s = state.sides[side];
  const out: CardDef[] = [];
  const push = (id: string): void => {
    const c = ctx.cards.get(id);
    if (c) out.push(c);
  };
  for (const id of s.deck) push(id);
  for (const hc of s.hand) out.push(hc.card);
  for (const c of s.discard) out.push(c);
  for (const row of Object.keys(s.rows) as Array<keyof typeof s.rows>) {
    for (const u of s.rows[row]) if (u) out.push(ctx.cards.get(u.cardId) ?? ({ id: u.cardId } as CardDef));
  }
  return out;
}

/** 给一副牌算画像 */
export function profileCards(cards: readonly CardDef[]): DeckProfile {
  const n = Math.max(1, cards.length);
  const cost = cards.reduce((a, c) => a + (c.cost ?? 0), 0) / n;
  const cheap = cards.filter((c) => (c.cost ?? 0) <= 2).length / n;
  const heavy = cards.filter((c) => (c.cost ?? 0) >= 5).length / n;
  const reach = cards.filter(cardReachesLord).length;
  const removal = cards.filter((c) => !isCharacterCard(c) && allEffects(c).some((e) => e.action === 'destroy'
    || (e.action === 'damage' && e.target?.side !== 'ally' && e.target?.side !== 'self'))).length;
  const units = cards.filter(isCharacterCard).length;

  // 判档只看**曲线**，不看单张强卡：一副 3.2 平均费但塞了两张火攻的牌仍是中速
  let style: AiStyle = 'midrange';
  if (cost <= 2.5 || cheap >= 0.5) style = 'aggro';
  else if (cost >= 3.6 || heavy >= 0.32) style = 'control';

  return {
    style,
    avgCost: cost,
    cheapRatio: cheap,
    heavyRatio: heavy,
    reach,
    removal,
    units,
    weights: { ...STYLE_WEIGHTS[style] },
  };
}

/** 当前对局中某一方的画像（每回合重算一次即可；这里直接按需算，30 张的遍历可忽略） */
export function profileFor(state: MatchState, side: Side, ctx: EngineContext): DeckProfile {
  return profileCards(fullDeckOf(state, side, ctx));
}
