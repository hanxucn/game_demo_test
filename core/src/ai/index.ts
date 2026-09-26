/**
 * 《酒话三国》对战 AI（ADR-084）
 *
 * 设计思想：**不在 AI 里重写规则**。
 *
 * 旧版 AI 是 163 行 if/else 的贪心：先看能不能斩杀、再一律打脸、再挑"最弱的敌人"打、
 * 然后随便丢个技能目标、最后把最贵的牌扔出去。它只能看见"攻/血/费用"这几个数字，
 * 于是出现了三类硬伤：
 *   · **换牌算不清**：不知道打完会不会被反击打死，也不知道对方死没死；
 *   · **指向乱选**：给技能硬塞一个"血最少的敌人"，引擎发现不合法就退回兜底目标，
 *     自增益技能于是加到了别人身上，甚至加到了敌人身上；
 *   · **没有风格**：速攻牌组与后期牌组用同一套判断，快攻不敢打脸、控制不肯换牌。
 *
 * 新版分三层：
 *   `options.ts`  列出引擎会接受的全部动作（含指向性技能的真实合法目标）
 *   `eval.ts`     给局面打分（血量 / 场面 / 人数 / 手牌 / 统率 / 被斩风险 / 粮尽）
 *   `index.ts`    把每个候选**真的交给引擎跑一遍**，拿跑完的局面打分，取最高分
 *
 * 因为用的是 `applyAction` 本身，反击、圣盾、饮血、亡语、触发技、光环重算
 * 全部自然生效 —— AI 看到的后果与真人玩家打出来的一模一样（第 7 条要求的根因）。
 *
 * 确定性：全过程不含 `Math.random()`，模拟用的是从 `state.rngState` 派生的引擎 RNG，
 * 因此同一局面永远给出同一动作，金种子回放不变量继续成立。
 */

import { applyAction } from '../engine.ts';
import { allUnits } from '../state.ts';
import { canAttack, canPlayCard, canUseUnitSkill, legalPlacements, legalTargets } from '../rules.ts';
import { isBanned } from '../mutate.ts';
import { evaluate } from './eval.ts';
import { generateOptions, type AiOption } from './options.ts';
import { profileFor, type DeckProfile } from './profile.ts';
import { isCharacterCard } from './cards.ts';
import type { Action, EngineContext, MatchState, Side } from '../types.ts';

/**
 * 每次决策最多模拟多少个候选。
 *
 * 一次 `applyAction` 在本项目的状态规模下约 0.05–0.15ms（含深拷贝），
 * 160 次 ≈ 10–20ms，对 320ms 一步的动画节奏完全无感；
 * 同时足以覆盖「全部攻击 × 全部目标 + 主要出牌 + 全部主动技」。
 */
export const SIM_BUDGET = 160;

/** 低于这个改善幅度的动作不值得做（等价于"空过"）—— 也保证搜索严格单调、不会来回摆 */
const PASS_EPS = 0.01;

export interface AiDecision {
  action: Action | null;
  profile: DeckProfile;
  /** 模拟过的候选数（诊断用） */
  sims: number;
  /** 决策后的自评得分（null = 空过） */
  score: number | null;
  /** 候选总数 */
  candidates: number;
  /** 除空过外的最优候选标签（报表用） */
  label?: string;
}

/**
 * 决策主入口：返回当前行动方的最优动作；`null` 表示"无事可做，请结束回合"。
 *
 * 返回 `null` 而不是 `END_TURN`，是沿用旧契约：调用方（原型 / 冒烟 / 测试）
 * 拿 null 就自己结束回合。
 */
export function decide(state: MatchState, ctx: EngineContext): AiDecision {
  const side = state.active;
  const profile = profileFor(state, side, ctx);
  const w = profile.weights;
  const baseline = evaluate(state, side, w);
  const empty: AiDecision = { action: null, profile, sims: 0, score: null, candidates: 0 };

  if (state.winner) return empty;

  let options: AiOption[];
  try {
    options = generateOptions(state, w);
  } catch {
    return { ...empty, action: fallbackAction(state, ctx) };
  }

  let best: AiOption | null = null;
  let bestScore = -Infinity;
  let sims = 0;

  for (const opt of options) {
    if (sims >= SIM_BUDGET) break;
    let after: MatchState;
    try {
      const res = applyAction(state, ctx, opt.action);
      if (!res.ok) continue;                 // 引擎拒收 → 直接丢弃（AI 绝不提非法动作）
      after = res.state;
    } catch {
      continue;                              // 单张卡的结算抛错不该拖垮整个 AI
    }
    sims += 1;

    // 斩杀：任何能直接结束对局的动作立刻执行，不必再看别的
    if (after.winner === side) {
      return { action: opt.action, profile, sims, score: Infinity, candidates: options.length, label: opt.label };
    }
    const score = evaluate(after, side, w);
    if (score > bestScore) { bestScore = score; best = opt; }
  }

  if (!best || bestScore <= baseline + PASS_EPS) return { ...empty, sims, candidates: options.length };
  return {
    action: best.action, profile, sims, score: bestScore,
    candidates: options.length, label: best.label,
  };
}

/** 给当前行动方选一个动作；`null` = 无牌可出、无攻击可做，应结束回合 */
export function chooseAction(state: MatchState, ctx: EngineContext): Action | null {
  return decide(state, ctx).action;
}

/**
 * 兜底动作（ADR-084）
 *
 * 只在候选生成阶段抛异常时使用：保证 AI 永远能给出一个**引擎会接受**的动作，
 * 而不是把异常抛进原型的动画循环里让整个回合卡死。不做任何评估。
 */
function fallbackAction(state: MatchState, ctx: EngineContext): Action | null {
  const side = state.active;
  for (const ref of allUnits(state, side)) {
    if (!canAttack(state, side, ref.row, ref.col).ok) continue;
    const targets = legalTargets(state, side, ref.row, ref.col).targets;
    if (targets.length) {
      return { type: 'ATTACK', from: { row: ref.row, col: ref.col }, to: { kind: 'lord' } };
    }
  }
  const spots = legalPlacements(state, side);
  const hand = state.sides[side].hand;
  for (let i = 0; i < hand.length; i++) {
    const hc = hand[i];
    if (!hc || isBanned(hc)) continue;
    if (isCharacterCard(hc.card)) {
      const slot = spots[0];
      if (slot && canPlayCard(state, side, hc.card, slot).ok) {
        return { type: 'PLAY_CARD', cardIndex: i, row: slot.row, col: slot.col };
      }
    } else if (canPlayCard(state, side, hc.card).ok) {
      return { type: 'PLAY_CARD', cardIndex: i };
    }
  }
  return null;
}

/* ============================================================
   回合推进（冒烟 / 回放 / 自动对局用）
   ============================================================ */

/** 自动推进一整个回合；返回本回合产生的动作序列 */
export function takeTurn(
  state: MatchState,
  ctx: EngineContext,
  apply: (s: MatchState, c: EngineContext, a: Action) => { ok: boolean; state: MatchState },
  maxActions = 40,
): { state: MatchState; actions: Action[] } {
  let cur = state;
  const actions: Action[] = [];
  for (let i = 0; i < maxActions; i++) {
    if (cur.winner) break;
    const action = chooseAction(cur, ctx);
    if (!action) break;
    const res = apply(cur, ctx, action);
    if (!res.ok) break;
    cur = res.state;
    actions.push(action);
  }
  const end = apply(cur, ctx, { type: 'END_TURN' });
  return { state: end.ok ? end.state : cur, actions };
}

/* ============================================================
   换牌（开局）
   ============================================================ */

/**
 * AI 换牌：把"现在打不出去、以后也用不上"的牌换掉。
 *
 * 判据只有一条：**这张牌在我第一个回合能不能用**。起手 1–2 费是节奏，
 * 5 费以上的牌留在手里等于少一张牌；但如果整手都是贵的，就只换最贵的两张
 * （全换等于把"高费炸弹"也扔了）。
 */
export function aiMulligan(state: MatchState, side: Side, ctx: EngineContext): number[] {
  const hand = state.sides[side].hand;
  if (!hand.length) return [];
  const profile = profileFor(state, side, ctx);
  // 速攻卡组更狠：4 费以上就换；中后期卡组容忍 4 费
  const tooExpensive = profile.style === 'aggro' ? 4 : 5;
  const keep = hand.map((hc) => (hc.card.cost ?? 0) <= 3);
  let out = hand.map((hc, i) => ({ i, cost: hc.card.cost ?? 0, keep: keep[i] as boolean }))
    .filter((x) => !x.keep && x.cost >= tooExpensive)
    .map((x) => x.i);
  if (!out.length && keep.every((k) => !k)) {
    // 整手都是贵的 → 换掉最贵的两张，保留一张能打的
    out = hand.map((hc, i) => ({ i, cost: hc.card.cost ?? 0 }))
      .sort((a, b) => b.cost - a.cost).slice(0, 2).map((x) => x.i);
  }
  return out;
}

/* ============================================================
   诊断导出（AI 报表 / 测试用）
   ============================================================ */

export { evaluate } from './eval.ts';
export { profileFor, profileCards, STYLE_WEIGHTS, type AiStyle, type DeckProfile, type EvalWeights } from './profile.ts';
export { generateOptions, type AiOption, type OptionKind } from './options.ts';
export { cardBudget, handCardValue, unitValueOf, isCharacterCard } from './cards.ts';
