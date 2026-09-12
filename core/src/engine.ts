/**
 * 引擎主循环：applyAction
 *
 * 这是 core 唯一的写入口。客户端与服务器都调用它，拿到 { state, events }。
 * 客户端只消费 events 播放动画；服务器用同一个引擎做权威裁决。
 */

import { COMMAND, MATCH } from './constants.ts';
import { createRng } from './rng.ts';
import {
  allUnits, cloneState, getUnit, hasKeyword, makeUnit, nextUidSeq, other, setUnit, statusStacks,
} from './state.ts';
import {
  canPlayCard, effectiveAttack, legalPlacements, legalTargets,
} from './rules.ts';
import {
  dealDamage, discardOverflow, drawCard, gainArmor, healTarget, killUnit, lordRef,
  resolveTurnEndStatuses, resolveTurnStartStatuses, unitRef, type TargetRef,
} from './mutate.ts';
import { runEffects } from './effects.ts';
import type {
  Action, ApplyResult, CardDef, EngineContext, GameEvent, MatchState, Side, Unit,
} from './types.ts';

/** 开局：创建对局后调用一次，进入第一回合 */
export function startMatch(state: MatchState, ctx: EngineContext): ApplyResult {
  const events: GameEvent[] = [];
  const next = cloneState(state);
  const rng = createRng(next.rngState);
  startTurn(next, ctx, events, rng);
  next.rngState = rng.getState();
  return { ok: true, state: next, events };
}

/** 唯一写入口 */
export function applyAction(state: MatchState, ctx: EngineContext, action: Action): ApplyResult {
  if (state.winner) {
    return { ok: false, state, events: [{ type: 'REJECTED', reason: '对局已结束', action }], error: '对局已结束' };
  }
  const events: GameEvent[] = [];
  const next = cloneState(state);
  const rng = createRng(next.rngState);
  let ok = true;
  let error: string | undefined;

  try {
    switch (action.type) {
      case 'PLAY_CARD': ok = playCard(next, ctx, action, events, rng); break;
      case 'ATTACK': ok = attack(next, ctx, action, events, rng); break;
      case 'USE_LORD_SKILL': ok = useLordSkill(next, ctx, action, events, rng); break;
      case 'USE_SKILL': ok = useUnitSkill(next, ctx, action, events, rng); break;
      case 'END_TURN': endTurn(next, ctx, events, rng); break;
      default: ok = false;
    }
  } catch (e) {
    ok = false;
    error = (e as Error).message;
  }

  if (!ok) {
    error = error ?? '动作不合法';
    events.push({ type: 'REJECTED', reason: error, action });
    return { ok: false, state, events, error };
  }

  next.rngState = rng.getState();
  return { ok: true, state: next, events };
}

/* ============================================================
   回合流程
   ============================================================ */

function startTurn(state: MatchState, ctx: EngineContext, events: GameEvent[], rng: ReturnType<typeof createRng>): void {
  state.turn += 1;
  const side = state.active;
  const s = state.sides[side];

  s.command.max = Math.min(COMMAND.MAX, s.command.max + 1);
  s.command.cur = s.command.max;
  s.lord.skillUsedThisTurn = false;
  for (const ref of allUnits(state, side)) ref.unit.attackedThisTurn = 0;

  events.push({ type: 'TURN_START', side, turn: state.turn, command: { ...s.command } });

  drawCard(state, ctx.cards, side, events);
  resolveTurnStartStatuses(state, ctx.cards, side, events);
}

function endTurn(state: MatchState, ctx: EngineContext, events: GameEvent[], rng: ReturnType<typeof createRng>): void {
  const side = state.active;
  resolveTurnEndStatuses(state, ctx.cards, side, events);
  const dropped = discardOverflow(state, side);
  dropped.forEach((c) => events.push({ type: 'CARD_PLAYED', side, card: c }));   // 弃牌也用同一事件，客户端可区分
  events.push({ type: 'TURN_END', side, turn: state.turn });

  if (state.turn >= MATCH.TURN_LIMIT) {
    const own = state.sides.own.lord.hp;
    const enemy = state.sides.enemy.lord.hp;
    state.winner = own === enemy ? 'draw' : own > enemy ? 'own' : 'enemy';
    events.push({ type: 'GAME_OVER', winner: state.winner });
    return;
  }

  state.active = other(side);
  startTurn(state, ctx, events, rng);
}

/* ============================================================
   出牌
   ============================================================ */

function playCard(
  state: MatchState, ctx: EngineContext,
  action: Extract<Action, { type: 'PLAY_CARD' }>,
  events: GameEvent[], rng: ReturnType<typeof createRng>,
): boolean {
  const side = state.active;
  const s = state.sides[side];
  const card = s.hand[action.cardIndex];
  if (!card) return false;

  const isCharacter = ['troop', 'general', 'strategist'].includes(card.type);
  const slot = isCharacter ? { row: action.row as 'front' | 'back', col: action.col as number } : undefined;
  const check = canPlayCard(state, side, card, slot);
  if (!check.ok) return false;

  s.command.cur -= card.cost;
  s.hand.splice(action.cardIndex, 1);
  events.push({ type: 'CARD_PLAYED', side, card, row: slot?.row, col: slot?.col, handIndex: action.cardIndex });

  if (isCharacter && slot) {
    const u = makeUnit(card, state.turn, nextUidSeq(state));
    setUnit(state, side, slot.row, slot.col, u);
    events.push({ type: 'UNIT_SUMMONED', side, row: slot.row, col: slot.col, unit: u });
    // 入场效果（战吼）
    const onPlay = (card.skills ?? []).filter((sk) => sk.trigger === 'on_play');
    for (const sk of onPlay) {
      runEffects(state, ctx.cards, sk.effects, { side, source: u, chosenRow: slot.row, chosenCol: slot.col }, rng, events);
    }
    if (card.effects?.length) {
      runEffects(state, ctx.cards, card.effects, { side, source: u }, rng, events);
    }
  } else {
    // 非人物卡：直接执行效果
    runEffects(state, ctx.cards, card.effects, { side }, rng, events);
    s.discard.push(card);
  }
  return true;
}

/* ============================================================
   攻击
   ============================================================ */

function attack(
  state: MatchState, ctx: EngineContext,
  action: Extract<Action, { type: 'ATTACK' }>,
  events: GameEvent[], rng: ReturnType<typeof createRng>,
): boolean {
  const side = state.active;
  const { from, to } = action;
  const attacker = getUnit(state, side, from.row, from.col);
  if (!attacker) return false;

  const legal = legalTargets(state, side, from.row, from.col);
  if (!legal.targets.length) return false;

  // 混乱：在合法目标中随机
  let target = legal.targets.find((t) =>
    t.kind === to.kind &&
    (t.kind === 'lord' || (t.row === (to as { row: string }).row && t.col === (to as { col: number }).col)),
  );
  if (statusStacks(attacker, 'hun_luan') > 0) {
    target = legal.targets[rng.int(legal.targets.length)];
  }
  if (!target) return false;

  const dmg = effectiveAttack(state, side, from.row, from.col);
  const hasWuShuang = hasKeyword(attacker, 'wu_shuang');
  const hasXianGong = hasKeyword(attacker, 'xian_gong');
  const hasYinXue = hasKeyword(attacker, 'yin_xue');
  const foe = other(side);

  events.push({ type: 'ATTACK_DECLARED', side, from: { ...from }, to: target });

  if (target.kind === 'lord') {
    const dealt = dealDamage(state, ctx.cards, lordRef(foe), dmg, events, attacker.name);
    if (hasYinXue) healTarget(state, lordRef(side), dealt, events);
  } else {
    const tRow = target.row as 'front' | 'back';
    const tCol = target.col as number;
    const targetUnit = getUnit(state, foe, tRow, tCol);
    const retaliate = targetUnit?.atk ?? 0;

    const dealt = dealDamage(state, ctx.cards, unitRef(foe, tRow, tCol), dmg, events, attacker.name);
    const targetDied = !getUnit(state, foe, tRow, tCol);

    // 反击：无双免疫；先攻若击杀则不反击
    if (!targetDied && !hasWuShuang && !hasXianGong) {
      dealDamage(state, ctx.cards, unitRef(side, from.row, from.col), retaliate, events, targetUnit?.name ?? '反击');
    }
    if (hasYinXue) healTarget(state, lordRef(side), dealt, events);
  }

  attacker.attackedThisTurn += 1;

  // 奇袭：攻击后失去
  if (hasKeyword(attacker, 'qi_xi')) {
    attacker.kw = attacker.kw.filter((k) => k !== 'qi_xi');
    delete attacker.statuses.qi_xi;
    events.push({ type: 'STATUS_EXPIRED', side, row: from.row, col: from.col, status: 'qi_xi' });
  }

  // 攻击者自身可能已阵亡
  const still = getUnit(state, side, from.row, from.col);
  if (still && still.hp <= 0) {
    killUnit(state, ctx.cards, { side, row: from.row, col: from.col, unit: still }, events);
  }
  return true;
}

/* ============================================================
   技能
   ============================================================ */

/** 主公技内置实现（当数据未提供 skillDef 时按技能名兜底） */
const LORD_SKILLS: Record<string, (state: MatchState, ctx: EngineContext, side: Side, target: TargetRef | undefined, events: GameEvent[]) => void> = {
  仁德: (state, ctx, side, target, events) => {
    if (target) healTarget(state, target, 2, events);
  },
  号令: (state, ctx, side, target, events) => {
    if (target?.kind === 'unit') {
      const u = getUnit(state, target.side, target.row, target.col);
      if (u) {
        u.statuses.zhen_fen = (u.statuses.zhen_fen ?? 0) + 2;
        events.push({ type: 'STATUS_APPLIED', side: target.side, row: target.row, col: target.col, status: 'zhen_fen', stacks: 2 });
      }
    }
  },
  坐断东南: (state, ctx, side, _t, events) => { gainArmor(state, side, 2, events); },
  暴虐: (state, ctx, side, _t, events) => {
    drawCard(state, ctx.cards, side, events);
    dealDamage(state, ctx.cards, lordRef(side), 1, events, '暴虐');
  },
};

function useLordSkill(
  state: MatchState, ctx: EngineContext,
  action: Extract<Action, { type: 'USE_LORD_SKILL' }>,
  events: GameEvent[], rng: ReturnType<typeof createRng>,
): boolean {
  const side = state.active;
  const lord = state.sides[side].lord;
  if (lord.skillUsedThisTurn) return false;
  if (state.sides[side].command.cur < 1) return false;

  const target: TargetRef | undefined = action.target
    ? action.target.row !== undefined
      ? unitRef(action.target.side, action.target.row, action.target.col as number)
      : lordRef(action.target.side)
    : undefined;

  const impl = lord.skillDef
    ? null
    : LORD_SKILLS[lord.skill];

  if (!impl && !lord.skillDef) return false;

  state.sides[side].command.cur -= 1;
  lord.skillUsedThisTurn = true;
  events.push({ type: 'LORD_SKILL_USED', side, skill: lord.skill });

  if (lord.skillDef) {
    runEffects(state, ctx.cards, lord.skillDef.effects, { side, chosen: target }, rng, events);
  } else if (impl) {
    impl(state, ctx, side, target, events);
  }
  return true;
}

function useUnitSkill(
  state: MatchState, ctx: EngineContext,
  action: Extract<Action, { type: 'USE_SKILL' }>,
  events: GameEvent[], rng: ReturnType<typeof createRng>,
): boolean {
  const side = state.active;
  const u = getUnit(state, side, action.row, action.col);
  if (!u) return false;
  if (statusStacks(u, 'zhen_she') > 0) return false;
  const skill = (u.skills ?? []).find((sk) => sk.kind === 'active');
  if (!skill) return false;
  const cost = skill.cost ?? 0;
  if (state.sides[side].command.cur < cost) return false;

  state.sides[side].command.cur -= cost;
  const target: TargetRef | undefined = action.target
    ? action.target.row !== undefined
      ? unitRef(action.target.side, action.target.row, action.target.col as number)
      : lordRef(action.target.side)
    : undefined;
  runEffects(state, ctx.cards, skill.effects, { side, source: u, chosen: target }, rng, events);
  return true;
}
