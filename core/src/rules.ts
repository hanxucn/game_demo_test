/**
 * 规则引擎：攻击合法性、部署合法性、有效攻击力
 *
 * 对应 docs/gdd/02-battlefield.md §3 的 4 条规则：
 *   ① 近战只能攻击同列
 *   ② 目标列前军为空 → 打该列后军（穿透）
 *   ③ 该列两排皆空 → 可打主将（破阵斩将）
 *   ④ 架盾最高优先级（可跨列；仅前军生效；不阻挡打主将）
 */

import { BOARD, DECK } from './constants.ts';
import {
  allUnits, getUnit, hasCap, hasKeyword, other, shieldUnits, statusStacks, unitCount,
} from './state.ts';
import type { CardDef, MatchState, Row, Side, Unit } from './types.ts';

export interface Target {
  kind: 'unit' | 'lord';
  side: Side;
  row?: Row;
  col?: number;
}

export interface TargetResult {
  targets: Target[];
  why: string;
}

export interface Check {
  ok: boolean;
  reason?: string;
}

/** 是否近战（非神射、非谋臣） */
export const isMelee = (u: Unit): boolean =>
  u.type !== 'strategist' && !hasKeyword(u, 'shen_she');

/** 能否普通攻击（与目标无关的限制） */
export function canAttack(state: MatchState, side: Side, row: Row, col: number): Check {
  const u = getUnit(state, side, row, col);
  if (!u) return { ok: false, reason: '该格没有人物卡' };
  if (u.type === 'strategist') return { ok: false, reason: '谋臣不能普通攻击' };
  if (hasCap(u, 'block_action') || hasCap(u, 'block_attack')) {
    return { ok: false, reason: '当前状态无法普通攻击' };
  }
  const maxAttacks = hasKeyword(u, 'lian_ji') ? 2 : 1;
  if (u.attackedThisTurn >= maxAttacks) {
    return { ok: false, reason: `本回合已攻击 ${u.attackedThisTurn} 次` };
  }
  if (u.enteredTurn === state.turn && !hasKeyword(u, 'ji_xing')) {
    return { ok: false, reason: '本回合入场，无法攻击（疾行除外）' };
  }
  return { ok: true };
}

/** 有效攻击力（含振奋/虚弱/结阵） */
export function effectiveAttack(state: MatchState, side: Side, row: Row, col: number): number {
  const u = getUnit(state, side, row, col);
  if (!u) return 0;
  let atk = u.atk;
  atk += statusStacks(u, 'zhen_fen');
  atk -= statusStacks(u, 'xu_ruo');
  if (hasKeyword(u, 'jie_zhen')) {
    const cols = [col - 1, col, col + 1];
    const hasAllyInfantry = allUnits(state, side).some(({ row: r, col: c, unit }) =>
      unit.uid !== u.uid && unit.troopKind === 'infantry' && cols.includes(c) && (r === 'front' || r === 'back'),
    );
    if (hasAllyInfantry) atk += 1;
  }
  return Math.max(0, atk);
}

/**
 * 计算合法攻击目标（docs/gdd/02-battlefield.md §3.2 / §3.3）
 */
export function legalTargets(state: MatchState, side: Side, row: Row, col: number): TargetResult {
  const u = getUnit(state, side, row, col);
  if (!u) return { targets: [], why: '空格' };
  if (u.type === 'strategist') return { targets: [], why: '谋臣不能普通攻击' };

  const gate = canAttack(state, side, row, col);
  if (!gate.ok) return { targets: [], why: gate.reason as string };

  const foe = other(side);
  const targets: Target[] = [];

  // 规则 ④：架盾最高优先级（可跨列）
  const shields = shieldUnits(state, foe);
  if (shields.length) {
    shields.forEach((s) => targets.push({ kind: 'unit', side: foe, row: s.row, col: s.col }));
    return {
      targets,
      why: `敌方存在「架盾」（列${shields.map((s) => s.col + 1).join('、')}前军）→ 必须先攻击它（可跨列）`,
    };
  }

  // 弓箭手「神射」：可攻击任意列的人物卡
  if (hasKeyword(u, 'shen_she')) {
    for (const r of BOARD.ROWS) {
      state.sides[foe].rows[r].forEach((x, c) => {
        if (x && !hasKeyword(x, 'qi_xi')) targets.push({ kind: 'unit', side: foe, row: r, col: c });
      });
    }
    const ownColClear = !state.sides[foe].rows.front[col] && !state.sides[foe].rows.back[col];
    if (ownColClear) targets.push({ kind: 'lord', side: foe });
    return {
      targets,
      why: '「神射」：可攻击任意列的人物卡' +
        (ownColClear ? '；本列两排皆空 → 可攻击主将' : '；本列有敌方单位 → 不能攻击主将'),
    };
  }

  // 近战：被自己人挡住
  if (row === 'back' && state.sides[side].rows.front[col]) {
    return { targets: [], why: '位于后军且同列前方有友方单位 → 被自己人挡住，无法攻击' };
  }

  // 规则 ①②③：同列 → 前军 → 后军（穿透）→ 主将
  const front = state.sides[foe].rows.front[col];
  if (front) {
    if (hasKeyword(front, 'qi_xi')) return { targets: [], why: '该列敌方前军处于「奇袭」，不能被指定为目标' };
    targets.push({ kind: 'unit', side: foe, row: 'front', col });
    return { targets, why: `同列（列${col + 1}）敌方前军有人物卡 → 目标只能是它` };
  }
  const back = state.sides[foe].rows.back[col];
  if (back) {
    if (hasKeyword(back, 'qi_xi')) return { targets: [], why: '该列敌方后军处于「奇袭」，不能被指定为目标' };
    targets.push({ kind: 'unit', side: foe, row: 'back', col });
    return { targets, why: `同列（列${col + 1}）前军为空 → 穿透攻击该列后军` };
  }
  targets.push({ kind: 'lord', side: foe });
  return { targets, why: `同列（列${col + 1}）两排皆空 → 可攻击敌方主将（破阵斩将）` };
}

/** 可部署的格子 */
export function legalPlacements(state: MatchState, side: Side): Array<{ row: Row; col: number }> {
  const out: Array<{ row: Row; col: number }> = [];
  if (unitCount(state, side) >= BOARD.MAX_UNITS) return out;
  for (const row of BOARD.ROWS) {
    for (let col = 0; col < BOARD.COLS; col++) {
      if (!state.sides[side].rows[row][col]) out.push({ row, col });
    }
  }
  return out;
}

/** 能否打出这张牌 */
export function canPlayCard(
  state: MatchState,
  side: Side,
  card: CardDef,
  slot?: { row: Row; col: number },
  costOverride?: number,          // 手牌费用修正后的实际费用（ADR-038）
): Check {
  const s = state.sides[side];
  const cost = costOverride ?? card.cost;
  if (cost > s.command.cur) {
    return { ok: false, reason: `统率值不足（需要 ${cost}，当前 ${s.command.cur}）` };
  }
  if (card.type === 'troop' || card.type === 'general' || card.type === 'strategist') {
    if (!slot) return { ok: false, reason: '人物卡需要指定部署位置' };
    if (state.sides[side].rows[slot.row][slot.col]) return { ok: false, reason: '该格已有单位' };
    if (unitCount(state, side) >= BOARD.MAX_UNITS) return { ok: false, reason: '战场已满' };
  }
  return { ok: true };
}

/** 手牌上限检查（回合结束用） */
export const handOverflow = (state: MatchState, side: Side): number =>
  Math.max(0, state.sides[side].hand.length - DECK.HAND_LIMIT);
