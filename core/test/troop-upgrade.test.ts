import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyAction, upgradeStatus } from '../src/engine.ts';
import { canAttack } from '../src/rules.ts';
import { getUnit, makeUnit, setUnit } from '../src/state.ts';
import { scenario } from './fixtures.ts';
import type { CardDef } from '../src/types.ts';

const upgradeTarget: CardDef = {
  id: 'test_special_infantry', name: '测试精兵', faction: 'neutral', type: 'troop',
  cost: 2, attack: 4, health: 4, troopKind: 'infantry', upgradeFrom: 'infantry',
  keywords: ['xian_gong'], memo: '测试升变目标', gender: 'unknown',
};

test('普通步兵造成 2 点实际伤害后可升变，目标不入组也不消耗卡牌', () => {
  const { state, ctx } = scenario({ own: { front: ['neutral_infantry'] }, enemy: { front: ['test_champion'] } });
  ctx.cards.set(upgradeTarget.id, upgradeTarget);
  const enemy = getUnit(state, 'enemy', 'front', 0)!;
  enemy.baseAtk = 0;
  enemy.atk = 0;
  enemy.hp = 5;

  const hit1 = applyAction(state, ctx, { type: 'ATTACK', from: { row: 'front', col: 0 }, to: { kind: 'unit', row: 'front', col: 0 } });
  assert.equal(hit1.ok, true);
  const unit = getUnit(hit1.state, 'own', 'front', 0)!;
  assert.equal(unit.upgradeProgress?.damage, 2);
  hit1.state.sides.own.hand = [{ card: upgradeTarget, mods: [] }];
  hit1.state.sides.own.deck = [upgradeTarget.id];

  const upgraded = applyAction(hit1.state, ctx, { type: 'UPGRADE_UNIT', row: 'front', col: 0, toCardId: upgradeTarget.id });
  assert.equal(upgraded.ok, true, upgraded.error ?? '升变动作被拒绝');
  const result = getUnit(upgraded.state, 'own', 'front', 0)!;
  assert.equal(result.cardId, upgradeTarget.id);
  assert.equal(result.hp, result.maxHp, 'BDSB 升变恢复为目标形态满血');
  assert.equal(result.attackedThisTurn, 0, '升变为先攻兵时返还一次本回合普攻机会');
  assert.equal(upgraded.state.sides.own.hand.length, 1, '升变不消耗同名手牌');
  assert.deepEqual(upgraded.state.sides.own.deck, [upgradeTarget.id], '升变不消耗牌库同名卡');
});

test('先攻兵再次升变为先攻兵时，也返还一次本回合普攻机会', () => {
  const { state, ctx } = scenario({ own: { front: ['neutral_infantry'] } });
  ctx.cards.set(upgradeTarget.id, upgradeTarget);
  const source = getUnit(state, 'own', 'front', 0)!;
  source.kw = ['xian_gong'];
  source.upgradeProgress = { damage: 2, shieldSurvival: 0, basicKills: 0, characterKills: 0, heroHits: 0 };
  source.attackedThisTurn = 1;

  const upgraded = applyAction(state, ctx, {
    type: 'UPGRADE_UNIT', row: 'front', col: 0, toCardId: upgradeTarget.id,
  });
  assert.equal(upgraded.ok, true, upgraded.error ?? '先攻兵升变应当成功');
  assert.equal(getUnit(upgraded.state, 'own', 'front', 0)?.attackedThisTurn, 0,
    '先攻兵升变为先攻兵也应返还一次普攻机会');
});

test('升级选项允许所有兵种选择群雄兵，但不显示陷阵盾兵', () => {
  const { state, ctx } = scenario({ own: { front: ['neutral_shieldman'] } });
  ctx.cards.set('qun_test_xianzhenying', {
    id: 'qun_test_xianzhenying', name: '测试陷阵营', faction: 'qun', type: 'troop', cost: 2,
    attack: 3, health: 5, troopKind: 'shield', upgradeFrom: 'shield', keywords: ['jia_dun'], memo: '测试',
  });
  ctx.cards.set('elite_xianzhen_dun', {
    id: 'elite_xianzhen_dun', name: '陷阵盾兵', faction: 'neutral', type: 'troop', cost: 2,
    attack: 2, health: 2, troopKind: 'shield', upgradeFrom: 'shield', keywords: ['jia_dun'], memo: '测试',
  });
  const shield = getUnit(state, 'own', 'front', 0)!;
  shield.upgradeProgress = { damage: 0, shieldSurvival: 2, basicKills: 0, characterKills: 0, heroHits: 0 };
  const status = upgradeStatus(state, ctx.cards, 'own', 'front', 0)!;
  assert.ok(status.options.some((c) => c.id === 'qun_test_xianzhenying'), '盾兵应可升级为群雄陷阵营');
  assert.equal(status.options.some((c) => c.id === 'elite_xianzhen_dun'), false, '陷阵盾兵不是升级选项');
});

test('升级为带无法攻击光环的兵种后立即禁止普通攻击', () => {
  const { state, ctx } = scenario({ own: { front: ['neutral_archer'] }, enemy: { front: ['neutral_infantry'] } });
  const blockedArcher: CardDef = {
    id: 'qun_test_blocked_archer', name: '测试弩兵', faction: 'qun', type: 'troop', cost: 2,
    attack: 2, health: 2, troopKind: 'archer', upgradeFrom: 'archer', keywords: ['zhan_ji'], memo: '测试',
    skills: [{ id: 'test_block_attack', name: '强弩', kind: 'aura', effects: [{
      action: 'apply_status', status: 'jin_gong', target: { source: true },
    }] }],
  };
  ctx.cards.set(blockedArcher.id, blockedArcher);
  const archer = getUnit(state, 'own', 'front', 0)!;
  archer.upgradeProgress = { damage: 0, shieldSurvival: 0, basicKills: 0, characterKills: 0, heroHits: 1 };
  const target = blockedArcher;
  const upgraded = applyAction(state, ctx, { type: 'UPGRADE_UNIT', row: 'front', col: 0, toCardId: target.id });
  assert.equal(upgraded.ok, true, upgraded.error ?? '升变动作被拒绝');
  assert.equal(upgraded.state.sides.own.rows.front[0]?.statuses.jin_gong?.stacks, 1);
  const gate = canAttack(upgraded.state, 'own', 'front', 0);
  assert.equal(gate.ok, false);
  assert.match(gate.reason ?? '', /无法普通攻击|无法攻击/);
});

test('升级进度调整为步兵 2 点伤害、弓兵命中人物 1 次', () => {
  const { state, ctx } = scenario({ own: { front: ['neutral_infantry', 'neutral_archer'] } });
  const infantry = getUnit(state, 'own', 'front', 0)!;
  const archer = getUnit(state, 'own', 'front', 1)!;
  infantry.upgradeProgress!.damage = 1;
  archer.upgradeProgress!.heroHits = 0;
  assert.equal(upgradeStatus(state, ctx.cards, 'own', 'front', 0)!.ready, false);
  infantry.upgradeProgress!.damage = 2;
  assert.equal(upgradeStatus(state, ctx.cards, 'own', 'front', 0)!.ready, true);
  assert.equal(upgradeStatus(state, ctx.cards, 'own', 'front', 1)!.ready, false);
  archer.upgradeProgress!.heroHits = 1;
  assert.equal(upgradeStatus(state, ctx.cards, 'own', 'front', 1)!.ready, true);
});

test('盾兵只在敌方回合结束且存活时累计升变进度', () => {
  const { state, ctx } = scenario({ own: { front: ['neutral_shieldman'] } });
  const shield = getUnit(state, 'own', 'front', 0)!;
  shield.hp = 3;
  const endOwn = applyAction(state, ctx, { type: 'END_TURN' });
  const endEnemy = applyAction(endOwn.state, ctx, { type: 'END_TURN' });
  assert.equal(getUnit(endEnemy.state, 'own', 'front', 0)?.upgradeProgress?.shieldSurvival, 1);
  const endOwn2 = applyAction(endEnemy.state, ctx, { type: 'END_TURN' });
  const endEnemy2 = applyAction(endOwn2.state, ctx, { type: 'END_TURN' });
  assert.equal(getUnit(endEnemy2.state, 'own', 'front', 0)?.upgradeProgress?.shieldSurvival, 2);
});

test('骑兵击杀特殊兵不计入基础兵进度', () => {
  const { state, ctx } = scenario({ enemy: { front: ['neutral_archer'] } });
  const cavalryCard: CardDef = { id: 'neutral_cavalry', name: '骑兵', faction: 'neutral', type: 'troop', cost: 3,
    attack: 2, health: 3, troopKind: 'cavalry', memo: '' };
  ctx.cards.set(cavalryCard.id, cavalryCard);
  setUnit(state, 'own', 'front', 0, makeUnit(cavalryCard, 0, 88));
  const cavalry = getUnit(state, 'own', 'front', 0)!;
  // 测试夹具没有新卡时直接注入一张同兵种单位，模拟特殊弓兵。
  const special = makeUnit({ id: 'special_archer', name: '特殊弓兵', faction: 'neutral', type: 'troop', cost: 2,
    attack: 0, health: 1, troopKind: 'archer', upgradeFrom: 'archer', memo: '' } as CardDef, 0, 99);
  setUnit(state, 'enemy', 'front', 0, special);
  const r = applyAction(state, ctx, { type: 'ATTACK', from: { row: 'front', col: 0 }, to: { kind: 'unit', row: 'front', col: 0 } });
  assert.equal(r.ok, true);
  assert.equal(getUnit(r.state, 'own', 'front', 0)?.upgradeProgress?.basicKills, 0);
  void cavalry;
});
