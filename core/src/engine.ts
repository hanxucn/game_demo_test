function useLordSkill(
  state: MatchState, ctx: EngineContext,
  action: Extract<Action, { type: 'USE_LORD_SKILL' }>,
  events: GameEvent[], rng: ReturnType<typeof createRng>,
): boolean {
  const side = state.active;
  const lord = state.sides[side].lord;
  const skill = lord.skillDef;
  // 主公技一律走数据（ADR-049）：heroes.yaml 的 skills[0]，与卡牌同一套 DSL。
  // 原先按中文技能名硬编码在 LORD_SKILLS 表里，改技能必须改代码。
  if (!skill || skill.kind !== 'active') return false;

  // 主公技门控（ADR-040）：被「进言」封锁则不可用；「参谋」提升每回合可用次数
  if (hasCapOn(lord.statuses, 'block_lord_skill')) return false;
  if (lord.skillUsedThisTurn && capStacks(lord.statuses, 'extra_lord_skill') <= 0) return false;

  // 费用来自数据（ADR-049：三主公统一 2），不再硬编码 1
  const cost = skill.cost ?? LORD_SKILL_COST;
  if (state.sides[side].command.cur < cost) return false;

  const target: TargetRef | undefined = action.target
    ? action.target.row !== undefined
      ? unitRef(action.target.side, action.target.row, action.target.col as number)
      : lordRef(action.target.side)
    : undefined;

  state.sides[side].command.cur -= cost;
  // 有「参谋」加成时先消耗加成次数，再消耗基础次数
  if (capStacks(lord.statuses, 'extra_lord_skill') > 0 && lord.skillUsedThisTurn) {
    const bonus = Object.entries(lord.statuses ?? {})
      .find(([id, st]) => st.stacks > 0 && STATUSES[id]?.caps?.includes('extra_lord_skill'));
    if (bonus) bonus[1].stacks -= 1;
  } else {
    lord.skillUsedThisTurn = true;
  }
  events.push({ type: 'LORD_SKILL_USED', side, skill: lord.skill });
  runEffects(state, ctx.cards, skill.effects,
             { side, chosen: target, handIndex: action.handIndex }, rng, events);
  return true;
}

/**
 * 引擎主循环：applyAction
 *
 * 这是 core 唯一的写入口。客户端与服务器都调用它，拿到 { state, events }。
 * 客户端只消费 events 播放动画；服务器用同一个引擎做权威裁决。
 */

import { COMMAND, LORD_SKILL_COST, MATCH, STATUSES, TIMING } from './constants.ts';
import { createRng } from './rng.ts';
import {
  capStacks,
  hasCap,
  hasCapOn,
  lordStatusStacks,
  allUnits, cloneState, getUnit, hasKeyword, makeUnit, nextUidSeq, other, setUnit, statusStacks,
} from './state.ts';
import {
  canPlayCard, canUseUnitSkill, effectiveAttack, legalPlacements, legalTargets,
} from './rules.ts';
import {
  dealDamage, discardOverflow, drawCard, effectiveCost, expireHandMods, expireMods, expireStatuses,
  gainArmor, healTarget, isBanned, killUnit, lordRef,
  resolveTurnEndStatuses, resolveTurnStartStatuses, unitRef, type TargetRef,
} from './mutate.ts';
import { costRuleDelta, recomputeAuras, runCardPlayedTriggers, runEffects, runMarkDamaged, runTriggerSkills, runUnitTrigger } from './effects.ts';
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
  // 断粮：主公状态「断粮」按层数削减本回合统率上限（ADR-040）
  const duan = lordStatusStacks(s.lord, 'duan_liang');
  s.command.cur = Math.max(0, s.command.max - duan);
  s.lord.skillUsedThisTurn = false;
  for (const ref of allUnits(state, side)) {
    ref.unit.attackedThisTurn = 0;
    ref.unit.skillUsesThisTurn = {};              // 主动技频率每回合重置（GDD 10 §1.1）
  }

  events.push({ type: 'TURN_START', side, turn: state.turn, command: { ...s.command } });

  drawCard(state, ctx.cards, side, events);
  // 后手补偿（ADR-053）：该方第 1 回合额外抽 1 张
  if (state.secondCompensation === 'extra_draw' && state.turn === 2) {
    drawCard(state, ctx.cards, side, events);
  }
  // ADR-059：翻面的单位在**自己的回合开始时翻回正面并能行动**
  // （翻面 = 当回合不能行动 + 不能被指定为目标；下个回合开始即恢复）
  for (const ref of allUnits(state, side)) {
    if (ref.unit.statuses.fan_mian) {
      delete ref.unit.statuses.fan_mian;
      events.push({ type: 'UNIT_FLIPPED', side, row: ref.row, col: ref.col, to: 'front', unit: ref.unit });
    }
  }
  resolveTurnStartStatuses(state, ctx.cards, side, events);
  recomputeAuras(state, ctx.cards, rng, events);                              // 第 3 步 ②光环重算
  runTriggerSkills(state, ctx.cards, side, TIMING.TURN_START, rng, events);   // 第 3 步 ③回合开始技
}

function endTurn(state: MatchState, ctx: EngineContext, events: GameEvent[], rng: ReturnType<typeof createRng>): void {
  const side = state.active;
  resolveTurnEndStatuses(state, ctx.cards, side, events);                     // 第 20 步 ①中毒
  runTriggerSkills(state, ctx.cards, side, TIMING.TURN_END, rng, events);     // 第 20 步 ②回合结束技
  expireStatuses(state, side, events);                                        // 第 21 步 清除临时效果
  expireMods(state, side);                                                     // 第 21 步 临时属性修正到期
  expireHandMods(state, side);                                                 // 第 21 步 手牌修正到期
  recomputeAuras(state, ctx.cards, rng, events);                              // 第 21 步后重算
  const dropped = discardOverflow(state, side);
  dropped.forEach((c) => events.push({ type: 'CARD_PLAYED', side, card: c }));   // 弃牌也用同一事件，客户端可区分
  events.push({ type: 'TURN_END', side, turn: state.turn });

  // ADR-054：不设回合上限、不判平局——对局只能由主将阵亡结束（粮尽保证必然收束）

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
  const hc = s.hand[action.cardIndex];
  if (!hc) return false;
  if (isBanned(hc)) return false;                 // 被禁止上场（ADR-038）
  const card = hc.card;
  const cost = effectiveCost(hc, costRuleDelta(state, card, side, rng));  // 费用 = 卡面 + cost_rule + mods

  const isCharacter = ['troop', 'general', 'strategist'].includes(card.type);
  const slot = isCharacter ? { row: action.row as 'front' | 'back', col: action.col as number } : undefined;
  const check = canPlayCard(state, side, card, slot, cost);
  if (!check.ok) return false;

  s.command.cur -= cost;
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
    // 时机表第 7 步：入场后光环重算（ADR-037）
    recomputeAuras(state, ctx.cards, rng, events);
    runCardPlayedTriggers(state, ctx.cards, card, rng, events);   // ADR-041
    recomputeAuras(state, ctx.cards, rng, events);
  } else {
    // 非人物卡：直接执行效果
    runEffects(state, ctx.cards, card.effects, { side }, rng, events);
    s.discard.push(card);
    runCardPlayedTriggers(state, ctx.cards, card, rng, events);   // ADR-041
    recomputeAuras(state, ctx.cards, rng, events);
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
  const hasWuShuang = hasKeyword(attacker, 'wu_shuang');   // 「无双」已取消（ADR-054），无卡使用；保留分支待清理
  const hasYinXue = hasKeyword(attacker, 'yin_xue');
  const foe = other(side);

  events.push({ type: 'ATTACK_DECLARED', side, from: { ...from }, to: target });

  // 时机表第 8 步后：攻击时触发技（on_attack，ADR-036）
  runUnitTrigger(state, ctx.cards, attacker, 'on_attack', rng, events);

  if (target.kind === 'lord') {
    const dealt = dealDamage(state, ctx.cards, lordRef(foe), dmg, events, attacker.name);
    if (hasYinXue) healTarget(state, unitRef(side, from.row, from.col), dealt, events);   // 饮血：回该单位自身（ADR-057）
  } else {
    const tRow = target.row as 'front' | 'back';
    const tCol = target.col as number;
    const targetUnit = getUnit(state, foe, tRow, tCol);
    // 反击力 = 目标的**有效**攻击力（含振奋/虚弱等，与攻击方算法对称，ADR-059）
    const retaliate = effectiveAttack(state, foe, tRow, tCol);

    const dealt = dealDamage(state, ctx.cards, unitRef(foe, tRow, tCol), dmg, events, attacker.name);
    const targetDied = !getUnit(state, foe, tRow, tCol);

    // 时机表第 16 步：受到伤害触发技（on_damaged）
    const hit = getUnit(state, foe, tRow, tCol);
    if (hit && hit.hp > 0) runUnitTrigger(state, ctx.cards, hit, 'on_damaged', rng, events);
    if (hit) runMarkDamaged(state, ctx.cards, hit, dmg, rng, events);

    // 反击：目标存活则反击。
    // 注：「无双」（攻击不受反击）已取消（ADR-054）。
    // 「先攻」**不含**"击杀不遭反击"——那是初始提交 GDD 里 AI 编的定义，
    // 手写稿四处「获得先攻/上场时先攻」均指"入场当回合即可行动"（ADR-055）。
    if (!targetDied && !hasWuShuang) {
      dealDamage(state, ctx.cards, unitRef(side, from.row, from.col), retaliate, events, targetUnit?.name ?? '反击');
      const back = getUnit(state, side, from.row, from.col);
      if (back && back.hp > 0) runUnitTrigger(state, ctx.cards, back, 'on_damaged', rng, events);
    }
    if (hasYinXue) healTarget(state, unitRef(side, from.row, from.col), dealt, events);   // 饮血：回该单位自身（ADR-057）
  }

  attacker.attackedThisTurn += 1;

  // 奇袭：攻击后失去隐身（ADR-054 的新定义还要求"上场自动隐身"，尚未实现，见 Q-06-*）
  if (hasKeyword(attacker, 'qi_xi')) {
    attacker.kw = attacker.kw.filter((k) => k !== 'qi_xi');
    delete attacker.statuses.qi_xi_status;
    events.push({ type: 'STATUS_EXPIRED', side, row: from.row, col: from.col, status: 'qi_xi' });
  }

  // 攻击者自身可能已阵亡
  const still = getUnit(state, side, from.row, from.col);
  if (still && still.hp <= 0) {
    killUnit(state, ctx.cards, { side, row: from.row, col: from.col, unit: still }, events);
    recomputeAuras(state, ctx.cards, rng, events);   // 第 19 步：死亡后光环重算
  }
  return true;
}

/* ============================================================
   技能
   ============================================================ */

function useUnitSkill(
  state: MatchState, ctx: EngineContext,
  action: Extract<Action, { type: 'USE_SKILL' }>,
  events: GameEvent[], rng: ReturnType<typeof createRng>,
): boolean {
  const side = state.active;
  const u = getUnit(state, side, action.row, action.col);
  if (!u) return false;
  // 频率 / 震慑 / 费用共用 rules.ts 的判定（AI 与引擎必须同源）
  const check = canUseUnitSkill(state, side, action.row, action.col);
  if (!check.ok) return false;
  const skill = check.skill!;

  const key = skill.id || skill.name || '0';
  u.skillUsesThisTurn[key] = (u.skillUsesThisTurn[key] ?? 0) + 1;
  if ((skill.frequency ?? 'once_per_turn') === 'once') u.skillsUsedOnce.push(key);
  state.sides[side].command.cur -= skill.cost ?? 0;
  const target: TargetRef | undefined = action.target
    ? action.target.row !== undefined
      ? unitRef(action.target.side, action.target.row, action.target.col as number)
      : lordRef(action.target.side)
    : undefined;
  runEffects(state, ctx.cards, skill.effects,
             { side, source: u, chosen: target, handIndex: action.handIndex }, rng, events);
  return true;
}
