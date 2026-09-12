#!/usr/bin/env node
/**
 * 战场规则断言测试
 *
 * 直接加载 prototype/rules.js（纯逻辑，零 DOM），用
 * docs/gdd/02-battlefield.md §3 的用例逐条断言。
 *
 * 用法：node prototype/rules-check.mjs
 */

import { readFileSync } from 'node:fs';

const code = readFileSync(new URL('./rules.js', import.meta.url), 'utf8');
new Function(code)();                 // 在 Node 里执行 UMD 包装，挂到 globalThis.Rules
const { CARDS, setState, legalTargets, legalPlacements, deploy, resetState } = globalThis.Rules;

const mk = (id) => Object.assign({}, CARDS[id]);
const emptyRow = () => [null, null, null, null, null];

function makeState(o) {
  return {
    own: {
      lord: { name: '刘备', faction: 'shu', hp: 30, armor: 0, skill: '仁德' },
      rows: { front: o.ownFront || emptyRow(), back: o.ownBack || emptyRow() },
    },
    enemy: {
      lord: { name: '曹操', faction: 'wei', hp: 30, armor: 0, skill: '号令' },
      rows: { front: o.enemyFront || emptyRow(), back: o.enemyBack || emptyRow() },
    },
    hand: [],
    turn: 1,
    command: { cur: 1, max: 1 },
  };
}

let pass = 0;
let fail = 0;

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}\n      期望 ${e}\n      实际 ${a}`);
  }
}

const t = (x) => x.map(({ kind, side, row, col }) =>
  `${kind}:${side}${row ? '.' + row : ''}${col !== undefined ? '.' + col : ''}`);

console.log('\n【规则 ① 近战只能攻击同列】');
setState(makeState({
  ownFront: [mk('infantry'), null, null, null, null],
  enemyFront: [mk('infantry'), null, null, null, null],
}));
check('同列前军 → 目标为该前军', t(legalTargets('own', 'front', 0).targets), ['unit:enemy.front.0']);

console.log('\n【规则 ② 前空打后（穿透）】');
setState(makeState({
  ownFront: [mk('infantry'), null, null, null, null],
  enemyBack: [mk('archer'), null, null, null, null],
}));
check('前军空 → 穿透攻击该列后军', t(legalTargets('own', 'front', 0).targets), ['unit:enemy.back.0']);

console.log('\n【规则 ③ 两排皆空 → 攻击主将】');
setState(makeState({ ownFront: [mk('infantry'), null, null, null, null] }));
check('本列两排皆空 → 可攻击主将', t(legalTargets('own', 'front', 0).targets), ['lord:enemy']);

console.log('\n【规则 ④ 架盾最高优先级】');
setState(makeState({
  ownFront: [mk('infantry'), null, null, null, null],
  enemyFront: [mk('infantry'), null, null, mk('shield'), null],
}));
check('敌方有架盾 → 只能打架盾（可跨列）', t(legalTargets('own', 'front', 0).targets), ['unit:enemy.front.3']);

setState(makeState({
  ownFront: [mk('infantry'), null, null, null, null],
  enemyFront: [mk('infantry'), null, null, null, null],
  enemyBack: [null, null, null, mk('shield'), null],
}));
check('架盾在后军 → 不生效，正常打同列前军', t(legalTargets('own', 'front', 0).targets), ['unit:enemy.front.0']);

console.log('\n【神射（弓箭手）】');
setState(makeState({
  ownBack: [null, mk('archer'), null, null, null],
  enemyFront: [null, null, mk('infantry'), null, null],
  enemyBack: [null, mk('infantry'), null, null, mk('archer')],
}));
check('可攻击任意列的人物卡', t(legalTargets('own', 'back', 1).targets), [
  'unit:enemy.front.2', 'unit:enemy.back.1', 'unit:enemy.back.4',
]);

setState(makeState({
  ownBack: [null, mk('archer'), null, null, null],
  enemyFront: [null, null, null, mk('shield'), null],
  enemyBack: [null, mk('infantry'), null, null, null],
}));
check('架盾优先于神射', t(legalTargets('own', 'back', 1).targets), ['unit:enemy.front.3']);

console.log('\n【限制条件】');
setState(makeState({
  ownFront: [mk('infantry'), null, null, null, null],
  ownBack: [mk('infantry'), null, null, null, null],
  enemyFront: [mk('infantry'), null, null, null, null],
}));
check('后军近战被自己人挡住 → 无目标', t(legalTargets('own', 'back', 0).targets), []);

setState(makeState({
  ownBack: [null, null, mk('strategist_ph'), null, null],
  enemyFront: [null, null, mk('infantry'), null, null],
}));
check('谋臣不能普通攻击 → 无目标', t(legalTargets('own', 'back', 2).targets), []);

console.log('\n【部署】');
setState(makeState({
  ownFront: [mk('infantry'), null, null, null, null],
  ownBack: [null, null, mk('archer'), null, null],
}));
check('可部署格子 = 每方 10 格 - 已占用 2 = 8', legalPlacements('own').length, 8);

console.log('\n【部署动作】');
setState(makeState({}));
check('部署到空格 → 成功', deploy('own', 'front', 0, mk('infantry')), true);
check('重复部署同一格 → 失败', deploy('own', 'front', 0, mk('shield')), false);
check('部署后该格不再出现在可部署列表', legalPlacements('own').indexOf('front.0') < 0
  && legalPlacements('own').length === 9, true);

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
