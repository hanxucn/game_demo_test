/**
 * 简易启发式 AI（PvE 用）
 *
 * 设计目标：能跑通一局、行为可预测、零随机依赖（除 core 的 Rng）。
 * 不做搜索，只做贪心决策——足够验证引擎，也够 demo 用。
 */

import { BOARD } from './constants.ts';
import { allUnits, getUnit, other } from './state.ts';
import { canAttack, canPlayCard, canUseUnitSkill, effectiveAttack, legalPlacements, legalTargets } from './rules.ts';
import { isBanned } from './mutate.ts';
import type { Action, CardDef, EngineContext, MatchState, Row, Side } from './types.ts';

/** 给当前行动方选一个动作；返回 null 表示无牌可出，应结束回合 */
export function chooseAction(state: MatchState, ctx: EngineContext): Action | null {
  const side = state.active;
  const foe = other(side);
  const lordHp = state.sides[foe].lord.hp;
  const armor = state.sides[foe].lord.armor;

  // ① 能斩杀主将 → 打主将
  for (const ref of allUnits(state, side)) {
    if (!canAttack(state, side, ref.row, ref.col).ok) continue;
    const res = legalTargets(state, side, ref.row, ref.col);
    const canHitLord = res.targets.some((t) => t.kind === 'lord');
    if (canHitLord && effectiveAttack(state, side, ref.row, ref.col) >= lordHp + armor) {
      return { type: 'ATTACK', from: { row: ref.row, col: ref.col }, to: { kind: 'lord' } };
    }
  }

  // ② 能打主将 → 打主将（抢伤害）
  for (const ref of allUnits(state, side)) {
    if (!canAttack(state, side, ref.row, ref.col).ok) continue;
    const res = legalTargets(state, side, ref.row, ref.col);
    if (res.targets.some((t) => t.kind === 'lord')) {
      return { type: 'ATTACK', from: { row: ref.row, col: ref.col }, to: { kind: 'lord' } };
    }
  }

  // ③ 攻击最弱的敌方单位
  let best: Action | null = null;
  let bestScore = -Infinity;
  for (const ref of allUnits(state, side)) {
    if (!canAttack(state, side, ref.row, ref.col).ok) continue;
    const res = legalTargets(state, side, ref.row, ref.col);
    const dmg = effectiveAttack(state, side, ref.row, ref.col);
    for (const t of res.targets) {
      if (t.kind !== 'unit') continue;
      const target = getUnit(state, foe, t.row as Row, t.col as number);
      if (!target) continue;
      // 能击杀优先；否则打血量最低的
      const score = (dmg >= target.hp ? 100 : 0) + (10 - target.hp) + target.atk * 0.1;
      if (score > bestScore) {
        bestScore = score;
        best = { type: 'ATTACK', from: { row: ref.row, col: ref.col }, to: { kind: 'unit', row: t.row as Row, col: t.col as number } };
      }
    }
  }
  if (best) return best;

  // ④ 用谋臣主动技
  for (const ref of allUnits(state, side)) {
    if (!canUseUnitSkill(state, side, ref.row, ref.col).ok) continue;
    const target = allUnits(state, foe).sort((a, b) => a.unit.hp - b.unit.hp)[0];
    if (target) {
      return { type: 'USE_SKILL', row: ref.row, col: ref.col, target: { side: foe, row: target.row, col: target.col } };
    }
  }

  // ⑤ 主公技：**按数据判断**（ADR-049：主公技已从硬编码迁到 heroes.yaml 的 DSL）
  //
  // 原先按中文技能名硬编码（坐断东南/仁德/号令），主公技数据化后那些分支全部失效——
  // 表现为 AI 完全不用曹操「奸雄」，却把孙权「坐断东南」当无脑循环技狂放（每回合净弃 1 抽 1，白烧 2 统率）。
  const lord = state.sides[side].lord;
  const lsk = lord.skillDef;
  if (lsk && !lord.skillUsedThisTurn && state.sides[side].command.cur >= (lsk.cost ?? 2)) {
    const effs = lsk.effects ?? [];
    const healEff = effs.find((e) => e.action === 'heal');
    const selfDmg = effs.find((e) => e.action === 'damage' && e.target?.lord
      && (e.target?.side === 'self' || e.target?.side === 'ally'));
    const draws = effs.filter((e) => e.action === 'draw').reduce((a, e) => a + (e.value ?? 1), 0);
    const selfDiscard = effs.some((e) => e.action === 'discard'
      && (e.target?.side === 'self' || e.target?.side === 'ally'));
    const hand = state.sides[side].hand;

    if (healEff) {
      // 治疗型：只在真有伤兵时用，并优先救最危险的
      const wounded = allUnits(state, side)
        .filter((r) => r.unit.hp < r.unit.maxHp)
        .sort((a, b) => a.unit.hp - b.unit.hp)[0];
      if (wounded) {
        return { type: 'USE_LORD_SKILL', target: { side, row: wounded.row, col: wounded.col } };
      }
    } else if (selfDmg) {
      // 卖血换牌型（奸雄）：留足血量安全垫，且手牌/牌库要吃得下
      const dmg = selfDmg.value ?? 0;
      const safe = lord.hp - dmg > 12;                       // 自伤后仍留 >12 血
      const room = hand.length < 10 && state.sides[side].deck.length > 0;
      if (safe && room) return { type: 'USE_LORD_SKILL' };
    } else if (selfDiscard && draws === 0) {
      // 纯弃牌是亏的，不用
    } else if (selfDiscard && draws > 0) {
      // 弃 N 抽 N：净手牌不变，只赚手牌质量。AI 不会评估质量 →
      // 仅在手里有「明显该换掉」的牌（费用最低）时才用，并指定弃它
      const worst = hand.map((hc, i) => ({ hc, i })).sort((a, b) => a.hc.card.cost - b.hc.card.cost)[0];
      const avg = hand.reduce((a, hc) => a + hc.card.cost, 0) / Math.max(1, hand.length);
      if (worst && hand.length > 3 && worst.hc.card.cost < avg - 0.5
        && state.sides[side].deck.length > 0) {
        return { type: 'USE_LORD_SKILL', handIndex: worst.i };
      }
    } else {
      return { type: 'USE_LORD_SKILL' };
    }
  }

  // ⑥ 出牌：先给每张牌定好落点，再用 canPlayCard 做**完整**合法性检查（含费用）
  const spots = legalPlacements(state, side);
  const slotFor = (c: CardDef): { row: Row; col: number } | undefined => {
    if (!isCharacter(c)) return undefined;                 // 非人物卡不占格
    // 谋臣放后军，其他放前军；没有理想排就退而求其次
    const wantBack = c.type === 'strategist';
    return spots.find((sp) => (wantBack ? sp.row === 'back' : sp.row === 'front')) ?? spots[0];
  };

  const playable = state.sides[side].hand
    .map((hc, i: number) => ({ hc, c: hc.card, i }))
    .filter(({ hc }) => !isBanned(hc))                     // 被 ban（如酒令未解锁）的不出
    .map((x) => ({ ...x, slot: slotFor(x.c) }))
    .filter(({ c, slot }) => canPlayCard(state, side, c, slot).ok)
    .sort((a, b) => b.c.cost - a.c.cost);

  for (const { c, i, slot } of playable) {
    return slot
      ? { type: 'PLAY_CARD', cardIndex: i, row: slot.row, col: slot.col }
      : { type: 'PLAY_CARD', cardIndex: i };
  }

  return null;
}

const isCharacter = (c: CardDef): boolean =>
  ['troop', 'general', 'strategist'].includes(c.type);

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
