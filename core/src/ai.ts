/**
 * 简易启发式 AI（PvE 用）
 *
 * 设计目标：能跑通一局、行为可预测、零随机依赖（除 core 的 Rng）。
 * 不做搜索，只做贪心决策——足够验证引擎，也够 demo 用。
 */

import { BOARD } from './constants.ts';
import { allUnits, getUnit, other } from './state.ts';
import { canAttack, canPlayCard, effectiveAttack, legalPlacements, legalTargets } from './rules.ts';
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
    const u = ref.unit;
    const skill = (u.skills ?? []).find((sk) => sk.kind === 'active');
    if (!skill) continue;
    if (state.sides[side].command.cur < (skill.cost ?? 0)) continue;
    const target = allUnits(state, foe).sort((a, b) => a.unit.hp - b.unit.hp)[0];
    if (target) {
      return { type: 'USE_SKILL', row: ref.row, col: ref.col, target: { side: foe, row: target.row, col: target.col } };
    }
  }

  // ⑤ 用主公技（仅当有明确收益时）
  if (!state.sides[side].lord.skillUsedThisTurn && state.sides[side].command.cur >= 1) {
    const skill = state.sides[side].lord.skill;
    if (skill === '坐断东南') return { type: 'USE_LORD_SKILL' };
    if (skill === '仁德') {
      const wounded = allUnits(state, side).filter((r) => r.unit.hp < r.unit.maxHp)
        .sort((a, b) => (a.unit.hp - a.unit.maxHp) - (b.unit.hp - b.unit.maxHp))[0];
      if (wounded) return { type: 'USE_LORD_SKILL', target: { side, row: wounded.row, col: wounded.col } };
    }
    if (skill === '号令') {
      const attacker = allUnits(state, side).filter((r) => canAttack(state, side, r.row, r.col).ok)
        .sort((a, b) => b.unit.atk - a.unit.atk)[0];
      if (attacker) return { type: 'USE_LORD_SKILL', target: { side, row: attacker.row, col: attacker.col } };
    }
  }

  // ⑥ 出牌（能出的最贵的卡）
  const playable = state.sides[side].hand
    .map((c: CardDef, i: number) => ({ c, i }))
    .filter(({ c }) => canPlayCard(state, side, c, { row: 'front', col: 0 }).ok || !isCharacter(c))
    .sort((a, b) => b.c.cost - a.c.cost);

  for (const { c, i } of playable) {
    if (!isCharacter(c)) return { type: 'PLAY_CARD', cardIndex: i };
    const spots = legalPlacements(state, side);
    if (!spots.length) continue;
    // 谋臣放后军，其他放前军
    const wantBack = c.type === 'strategist';
    const slot = spots.find((s) => (wantBack ? s.row === 'back' : s.row === 'front')) ?? spots[0];
    return { type: 'PLAY_CARD', cardIndex: i, row: slot.row, col: slot.col };
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
