/**
 * AI 的卡牌理解层（ADR-084）
 *
 * 这一层只回答「这张卡/这个人值多少、它想干什么」，不碰任何规则结算 ——
 * 结算永远交给 `applyAction`。把估值与结算分开，是为了让 AI 的**判断**可以独立调，
 * 而**结果**永远与真人玩家走同一条引擎路径。
 */

import { NON_DECK_TYPES } from '../constants.ts';
import type { CardDef, CardEffect, HandCard, Unit } from '../types.ts';

/** 人物卡三型（可以上场站场的那三类） */
export const CHARACTER_TYPES: readonly string[] = ['troop', 'general', 'strategist'];

export const isCharacterCard = (c: CardDef): boolean => CHARACTER_TYPES.includes(c.type);

/** 摊平一个技能的全部效果（有抉择分支时把所有分支都算上） */
export function skillEffects(sk: { modes?: Array<{ effects?: CardEffect[] }>; effects?: CardEffect[] }): CardEffect[] {
  if (sk.modes?.length) return sk.modes.flatMap((m) => m.effects ?? []);
  return sk.effects ?? [];
}

/** 摊平一张卡的全部效果（卡级 + 技能级 + 抉择分支） */
export function allEffects(card: CardDef): CardEffect[] {
  const out: CardEffect[] = [...(card.effects ?? [])];
  for (const sk of card.skills ?? []) out.push(...skillEffects(sk));
  return out;
}

/**
 * 卡牌总价值预算（GDD 13：`属性点 + 关键词 + 技能 ≈ 2 × 费用 + 1`）。
 *
 * AI 用**预算**而不是**卡面数值**来估价，才不会把「低属性强技能」的高费卡
 * （公孙瓒、袁绍这类）当成废牌扔掉。
 */
export const cardBudget = (cost: number): number => 2 * cost + 1;

/**
 * 关键词战力当量
 *
 * 只登记**引擎已实现**的关键词：神射 / 奇袭 / 忠义 在 `KEYWORDS` 里 `implemented: false`，
 * 计进去会让 AI 高估一批实际是白板的卡（这正是 `06-keywords.md` 警告过的坑）。
 */
const KEYWORD_VALUE: Record<string, number> = {
  jia_dun: 1.2,      // 架盾：逼对手先打它，等于给全队挡刀
  sheng_dun: 1.1,    // 圣盾：免疫一次伤害
  lian_ji: 1.0,      // 连击：每回合两次普攻
  xian_gong: 0.9,    // 先攻：入场即可攻击
  yi_ji: 0.7,        // 遗计：亡语
  yin_xue: 0.6,      // 饮血：伤害转治疗
};

/** 按「是否拥有某特性」的判定函数累加关键词价值（特性判定由调用方给，含状态式关键词） */
export function keywordValueOf(has: (kw: string) => boolean): number {
  let v = 0;
  for (const [kw, w] of Object.entries(KEYWORD_VALUE)) if (has(kw)) v += w;
  return v;
}

/**
 * 一个**场上单位**的战力当量。
 *
 * 拆成四段：当前身体（攻 + 血）+ 关键词 + 技能预算残差 + **卡牌本身的价值**。
 * 技能残差 = 卡牌预算 − 卡面属性点 − 关键词，> 0 说明这张卡把预算花在了技能上，
 * 即便它现在是个 0/3 的谋臣也不能当空气 —— 它下回合能放火计。
 */
export function unitValueOf(
  u: Unit,
  has: (kw: string) => boolean,
  skillWeight = 0.6,
): number {
  const body = u.atk + Math.max(0, u.hp);
  const kw = keywordValueOf(has);
  const residual = Math.max(0, cardBudget(u.cost) - (u.baseAtk + u.baseMaxHp) - kw);
  return body + kw + residual * skillWeight + cardEquityOf(u);
}

/**
 * **卡牌本身**的价值（ADR-084 修正）
 *
 * 2/1 的衍生物（西凉铁骑，0 费升格）去换对方 2/2 的真卡（蔡瑁，2 费），
 * 只按「攻 + 血」算是 3 换 4.6 —— 只赚一点点，于是 AI 宁可去打脸。
 * 真实收益却远不止：**对手是拿牌库里的牌换掉了我一个白送的衍生物**，
 * 这是纯粹的卡差，与"我少掉 1 点血"根本不是一个量级。
 *
 * 判据复用 `NON_DECK_TYPES`（与组卡规则同一个真源）：进不了卡组的类型
 * （衍生物 / 精英 / 状态 / 特殊）没有卡差，能进卡组的才有。
 * 不写死任何卡名 —— 以后加新的召唤物类型只改数据。
 */
export const CARD_EQUITY = 2.0;

export function cardEquityOf(u: Pick<Unit, 'type'>): number {
  return (NON_DECK_TYPES as readonly string[]).includes(u.type) ? 0 : CARD_EQUITY;
}

/** 一张**手牌**的价值：同样用预算，但打折 —— 手牌还没站上场，慢一拍 */
export const handCardValue = (hc: HandCard, ratio = 0.5): number =>
  cardBudget(hc.card.cost ?? 0) * ratio;

/** 该效果是不是「对敌方造成负面」的（伤害 / 摧毁 / 控制 / 弃牌…） */
const OFFENSIVE = new Set([
  'damage', 'destroy', 'sacrifice', 'ban_play', 'steal_card', 'take_control',
  'return_to_hand', 'flip', 'force_attack', 'mill', 'clash',
]);

/**
 * 这个选择器指向的是**敌人**吗（ADR-084）
 *
 * 判定顺序：动作语义优先于 `side` 字段。仁德写的是 `side: 'both'`（可选敌我），
 * 但它是 `heal` —— 治疗敌人是纯亏，所以按动作判成"选自己人"。
 */
export function picksEnemySide(action: string, sides: readonly string[]): 'ally' | 'enemy' | 'either' {
  if (OFFENSIVE.has(action)) return 'enemy';
  if (action === 'heal' || action === 'survive' || action === 'copy_skill') return 'ally';
  if (action === 'modify') return 'ally';                     // 增益：给敌人是资敌
  if (action === 'remove_status') return 'ally';              // 驱散：默认清自己的负面
  if (action === 'apply_status') return 'enemy';              // 施加状态：默认上给敌人
  const has = (s: string) => sides.includes(s);
  if (has('ally') && !has('enemy')) return 'ally';
  if (has('enemy') && !has('ally')) return 'enemy';
  return 'either';
}

/** 这张卡能否直接打到主将（直伤 / 摧毁 / 强制攻击主将…）—— 速攻画像与斩杀判断用 */
export function cardReachesLord(card: CardDef): boolean {
  return allEffects(card).some((e) =>
    OFFENSIVE.has(e.action)
    && (e.target?.lord === true || e.target?.side === 'enemy' || e.target?.filter?.include_lord === true
        || e.action === 'damage' && e.target === undefined));
}

/** 这张卡是不是「解牌」（能清掉对方场上的人） */
export function cardIsRemoval(card: CardDef): boolean {
  return allEffects(card).some((e) =>
    (e.action === 'damage' || e.action === 'destroy')
    && (e.target?.side === 'enemy' || e.target?.side === undefined || e.target?.side === 'both'));
}
