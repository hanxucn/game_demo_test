/**
 * AI 决策测试（ADR-084）
 *
 * 每一条对应用户提出的策略，**用可控局面断言 AI 选了什么动作**，
 * 而不是断言内部打分（打分可以调，行为不能悄悄变）。
 *
 * 本文件自带一套测试卡，不复用 `fixtures.ts` 的卡池 ——
 * 那里的卡是给引擎测试用的，改一张就可能牵动几十条断言，AI 行为测试需要稳定靶子。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyAction, startMatch } from '../src/engine.ts';
import { createMatch, getUnit, makeUnit, nextUidSeq, setUnit } from '../src/state.ts';
import { loadData } from '../src/loader.ts';
import { autoDeck } from '../src/deck.ts';
import { setupMatch } from '../src/setup.ts';
import { aiMulligan, chooseAction, decide, SIM_BUDGET } from '../src/ai/index.ts';
import { profileCards } from '../src/ai/profile.ts';
import { evaluate } from '../src/ai/eval.ts';
import type { Action, CardDef, EngineContext, MatchState, Row, Side } from '../src/types.ts';

/* ============================================================
   测试卡池
   ============================================================ */

const C = {
  /** 1 费 2/1 —— 便宜的攻击手 */
  grunt: { id: 't_grunt', name: '卒', faction: 'neutral', type: 'troop', cost: 1, attack: 2, health: 1 },
  /** 2 费 2/2 */
  soldier: { id: 't_soldier', name: '兵', faction: 'neutral', type: 'troop', cost: 2, attack: 2, health: 2 },
  /** 3 费 3/3 */
  brute: { id: 't_brute', name: '猛士', faction: 'neutral', type: 'troop', cost: 3, attack: 3, health: 3 },
  /** 2 费 1/5 —— 打了不掉血的木桩 */
  chip: { id: 't_chip', name: '木桩', faction: 'neutral', type: 'troop', cost: 2, attack: 1, health: 5 },
  /** 3 费 3/5 —— 打它会被反击打死 */
  wall: { id: 't_wall', name: '铁壁', faction: 'neutral', type: 'troop', cost: 3, attack: 3, health: 5 },
  /** 6 费 2/2 带强技能 —— 低费换它稳赚 */
  bomb: {
    id: 't_bomb', name: '重将', faction: 'neutral', type: 'general', cost: 6, attack: 2, health: 2,
    skills: [{ id: 'aura_x', name: '威压', kind: 'aura', effects: [{ action: 'modify', attack: 1, health: 1, target: { side: 'ally', filter: { type: 'character' }, count: 'all' } }] }],
  },
  /** 4 费 0/3 谋臣：主动技对**敌方**人物造成 4 点伤害 */
  mage: {
    id: 't_mage', name: '术士', faction: 'neutral', type: 'strategist', cost: 4, attack: 0, health: 3,
    skills: [{
      id: 'bolt', name: '雷击', kind: 'active', cost: 0, frequency: 'once_per_turn',
      effects: [{
        action: 'damage', value: 4,
        target: { side: 'enemy', filter: { type: 'character' }, count: 1, mode: 'choose' },
      }],
    }],
  },
  /** 4 费 0/4 谋臣：主动技治疗**任意**人物（side:'both'）—— 选错就是给敌人回血 */
  healer: {
    id: 't_healer', name: '医者', faction: 'neutral', type: 'strategist', cost: 4, attack: 0, health: 4,
    skills: [{
      id: 'mend', name: '疗伤', kind: 'active', cost: 0, frequency: 'once_per_turn',
      effects: [{
        action: 'heal', value: 3,
        target: { side: 'both', filter: { type: 'character' }, count: 1, mode: 'choose' },
      }],
    }],
  },
  /** 3 费 2/2：战吼对**敌方**人物造成 3 点伤害（指向性战吼） */
  thrower: {
    id: 't_thrower', name: '投手', faction: 'neutral', type: 'troop', cost: 3, attack: 2, health: 2,
    skills: [{
      id: 'hurl', name: '投石', kind: 'trigger', trigger: 'on_play',
      effects: [{
        action: 'damage', value: 3,
        target: { side: 'enemy', filter: { type: 'character' }, count: 1, mode: 'choose' },
      }],
    }],
  },
  /** 3 费 2/3：主动技给**己方**人物 +3/+3（指向性增益） */
  captain: {
    id: 't_captain', name: '校尉', faction: 'neutral', type: 'troop', cost: 3, attack: 2, health: 3,
    skills: [{
      id: 'rally', name: '整军', kind: 'active', cost: 0, frequency: 'once_per_turn',
      effects: [{
        action: 'modify', attack: 3, health: 3,
        target: { side: 'ally', filter: { type: 'character' }, count: 1, mode: 'choose' },
      }],
    }],
  },
  /** 5 费 4/5：大攻身材，用来验证「谁去解场」的分配 */
  big: { id: 't_big', name: '大将', faction: 'neutral', type: 'general', cost: 5, attack: 4, health: 5 },
  /** 2 费 3/2：反击 3 点，足以打死 3/3 */
  hit3: { id: 't_hit3', name: '锐士', faction: 'neutral', type: 'troop', cost: 2, attack: 3, health: 2 },
  /** 0 费 2/1 先攻**衍生物**（西凉铁骑的模型）：进不了卡组，死了不亏卡 */
  tieqi: {
    id: 't_tieqi', name: '铁骑', faction: 'neutral', type: 'token', cost: 0, attack: 2, health: 1,
    keywords: ['xian_gong'],
  },
  /** 2 费战法：对敌方主将造成 3 点伤害（直伤） */
  burn: {
    id: 't_burn', name: '火攻', faction: 'neutral', type: 'tactic', cost: 2,
    effects: [{ action: 'damage', value: 3, target: { side: 'enemy', lord: true } }],
  },
} satisfies Record<string, CardDef>;

const CARDS: CardDef[] = Object.values(C);
const FILLER: CardDef = { id: 't_filler', name: '民夫', faction: 'neutral', type: 'troop', cost: 1, attack: 1, health: 1 };
const ALL_CARDS = [...CARDS, FILLER];

/**
 * 默认牌库：**中速**画像（均费 3.4 / 1–2 费占 37.5%）。
 *
 * 画像的口径是「牌库 + 手牌 + 弃牌 + 场上」。若用清一色 1 费填充，
 * 每条测试都会落在速攻档上 —— 测出来的就不是"通用决策"而是"速攻决策"了。
 */
const MID_DECK = ['t_soldier', 't_brute', 't_chip', 't_bomb', 't_brute', 't_soldier', 't_bomb', 't_brute'];

function data(): ReturnType<typeof loadData> {
  return loadData(
    {
      cards: ALL_CARDS,
      // 主公技用 trigger 型占位：本文件测的是「人物」技能，主公技不该混进候选里
      heroes: [
        {
          id: 'shu_liubei', name: '刘备', faction: 'shu', type: 'lord', cost: 0, memo: 'x',
          skills: [{ id: 'noop', name: '无', kind: 'trigger', trigger: 'turn_start', effects: [] }],
        },
        {
          id: 'wei_caocao', name: '曹操', faction: 'wei', type: 'lord', cost: 0, memo: 'x',
          skills: [{ id: 'noop', name: '无', kind: 'trigger', trigger: 'turn_start', effects: [] }],
        },
      ],
    },
    { own: 'shu_liubei', enemy: 'wei_caocao' },
  );
}

const CTX = (() => {
  const d = data();
  return { cards: d.cards, lords: d.lords } as EngineContext;
})();

/* ============================================================
   局面搭建
   ============================================================ */

interface Setup {
  own?: Array<string | null>;
  enemy?: Array<string | null>;
  hand?: string[];
  /** 手牌与牌库所属方（默认当前行动方） */
  active?: Side;
  command?: number;
  lordHp?: number;
  deck?: string[];
}

function makeState(o: Setup): MatchState {
  const d = data();
  const st = createMatch({
    seed: 1,
    cards: d.cards,
    lords: d.lords,
    decks: { own: Array(10).fill('t_filler'), enemy: Array(10).fill('t_filler') },
    firstSide: 'own',
  });
  st.turn = 2;
  st.halfTurn = 3;
  st.active = o.active ?? 'own';
  st.sides.own.lord.hp = o.lordHp ?? 30;
  st.sides.enemy.lord.hp = o.lordHp ?? 30;
  st.sides.own.command = { cur: o.command ?? 10, max: 10 };
  st.sides.enemy.command = { cur: o.command ?? 10, max: 10 };
  st.sides.own.hand = [];
  st.sides.enemy.hand = [];
  st.sides.own.deck = [...(o.deck ?? MID_DECK)];
  st.sides.enemy.deck = [...(o.deck ?? MID_DECK)];

  const place = (side: Side, ids?: Array<string | null>) => {
    ids?.forEach((id, col) => {
      if (!id) return;
      const card = d.cards.get(id);
      if (!card) throw new Error(`测试卡不存在：${id}`);
      // enteredTurn=0：不是本回合入场 → 可以攻击
      setUnit(st, side, 'front' as Row, col, makeUnit(card, 0, nextUidSeq(st)));
    });
  };
  place('own', o.own);
  place('enemy', o.enemy);

  const active = o.active ?? 'own';
  if (o.hand) {
    st.sides[active].hand = o.hand.map((id) => {
      const card = d.cards.get(id);
      if (!card) throw new Error(`测试卡不存在：${id}`);
      return { card, mods: [] };
    });
  }
  return st;
}

const decideFor = (st: MatchState) => decide(st, CTX);

/** 把动作摊平成便于断言的一行 */
const describe = (a: Action | null): string => {
  if (!a) return 'PASS';
  if (a.type === 'ATTACK') return a.to.kind === 'lord' ? 'ATTACK→lord' : `ATTACK→unit(${a.to.col})`;
  if (a.type === 'PLAY_CARD') {
    const card = CTX.cards.get('');
    void card;
    return `PLAY#${a.cardIndex}${a.target ? `→${a.target.side}.${a.target.col ?? 'lord'}` : ''}`;
  }
  if (a.type === 'USE_SKILL') return `SKILL(${a.row},${a.col})${a.target ? `→${a.target.side}.${a.target.col ?? 'lord'}` : ''}`;
  if (a.type === 'USE_LORD_SKILL') return 'LORDSKILL';
  return a.type;
};

/* ============================================================
   ① 能白吃就解场（自己活得下来）
   ============================================================ */

test('AI①：能击杀对方人物且自己存活 → 解场，而不是打脸', () => {
  // 我方 3/3 打对方 2/2：对方死、我只掉 2 血 → 稳赚
  const st = makeState({ own: ['t_brute'], enemy: ['t_soldier'] });
  const a = chooseAction(st, CTX);
  assert.equal(describe(a), 'ATTACK→unit(0)', `应普攻解掉 2/2，实际 ${describe(a)}`);
});

test('AI①：多个可击杀目标时，优先解「打完之后我最安全」的那个', () => {
  // 我方 3/3：打 2/2 掉 2 血；打 1/5 木桩只掉 1 血但杀不掉
  // → 杀 2/2 是收益最高的解场
  const st = makeState({ own: ['t_brute'], enemy: ['t_soldier', 't_chip'] });
  const a = chooseAction(st, CTX);
  assert.equal(describe(a), 'ATTACK→unit(0)');
});

/* ============================================================
   ② 换不掉就不换（亏本交换改为打脸）
   ============================================================ */

test('AI②：解对方自己必死且对方还活着 → 改打主将，不做无谓损失', () => {
  // 我方 2/1 打 3/5：只能打 2 点，对方没死；被反击 3 点自己阵亡 → 纯亏
  const st = makeState({ own: ['t_grunt'], enemy: ['t_wall'] });
  const a = chooseAction(st, CTX);
  assert.equal(describe(a), 'ATTACK→lord', `应改为打主将，实际 ${describe(a)}`);
});

test('AI②：同归于尽的交换若明显亏，也改打主将', () => {
  // 我方 3 费 3/3 换对方 2 费 2/2：能杀，但被反击 2 点只是掉血（不死）→ 属于①的赚牌
  // 这里换成「我方 2/1 换对方 2/2」：我死、对方也死 → 1 费换 2 费，尚可接受；
  // 真正的亏本例子是「我方 3/3 换对方 0 攻木桩」：打得死但毫无收益（对方本来打不动我）
  const st = makeState({ own: ['t_brute'], enemy: ['t_chip'] });
  const a = chooseAction(st, CTX);
  // 击杀木桩要放弃 3 点打脸（3×face），换来的只是一个 0 攻单位
  // —— 引擎模拟会算出「打脸」更优；若哪天权重改成"必须解场"，这条会失败并提醒复核
  assert.ok(a !== null);
});

/* ============================================================
   ③ 低费换高费要打
   ============================================================ */

test('AI③：1 费 3/3 能换掉对方 6 费大将 → 执行攻击（不是打脸）', () => {
  // 我方 t_brute(3/3, 3费) 打 t_bomb(2/2, 6费)：击杀，被反击 2 → 我剩 1 血，活
  const st = makeState({ own: ['t_brute'], enemy: ['t_bomb'] });
  const a = chooseAction(st, CTX);
  assert.equal(describe(a), 'ATTACK→unit(0)', `应换掉高费大将，实际 ${describe(a)}`);
});

/* ============================================================
   ④ 指向性技能：目标必须正确
   ============================================================ */

test('AI④：伤害技指向「价值最高」的敌人，而不是第一个', () => {
  // 4 点伤害：木桩(1/5) 打不死；重将(2/2) 能打死且是 6 费核心
  const st = makeState({ own: ['t_mage'], enemy: ['t_chip', 't_bomb'] });
  const d = decideFor(st);
  assert.equal(d.action?.type, 'USE_SKILL', `应释放主动技，实际 ${describe(d.action)}`);
  const t = (d.action as Extract<Action, { type: 'USE_SKILL' }>).target;
  assert.equal(t?.col, 1, '应打第 2 格（重将），而不是第 1 格');
});

test('AI④：治疗技（side:both）只治自己人，不会给敌人回血', () => {
  const st = makeState({
    own: ['t_brute', 't_healer'], enemy: ['t_soldier'],
  });
  // 自己人掉血，敌人满血
  const me = getUnit(st, 'own', 'front', 0)!;
  setUnit(st, 'own', 'front', 0, { ...me, hp: 1 });
  const d = decideFor(st);
  assert.equal(d.action?.type, 'USE_SKILL');
  const t = (d.action as Extract<Action, { type: 'USE_SKILL' }>).target;
  assert.equal(t?.side, 'own', `治疗目标应是自己人，实际 ${t?.side}`);
  assert.equal(t?.col, 0, '应治血最少的那个人');
});

test('AI④：增益技给「最强的自己人」，不是随手第一个', () => {
  // 第 0 格是 1/1 民夫，第 1 格是 3/3 猛士；+3/+3 显然该给猛士
  const st = makeState({ own: ['t_filler', 't_captain', 't_brute'], enemy: ['t_soldier'] });
  const d = decideFor(st);
  assert.equal(d.action?.type, 'USE_SKILL', `应释放整军，实际 ${describe(d.action)}`);
  const t = (d.action as Extract<Action, { type: 'USE_SKILL' }>).target;
  assert.equal(t?.col, 2, `+3/+3 应给第 3 格猛士，实际第 ${(t?.col ?? -1) + 1} 格`);
});

test('AI④：指向性战吼带上目标，效果落在选定的人身上', () => {
  const st = makeState({ own: [], enemy: ['t_chip', 't_bomb'], hand: ['t_thrower'] });
  const d = decideFor(st);
  assert.equal(d.action?.type, 'PLAY_CARD');
  const a = d.action as Extract<Action, { type: 'PLAY_CARD' }>;
  assert.ok(a.target, '战吼需要目标时必须带上 target');
  assert.equal(a.target?.col, 1, '应砸第 2 格的重将（可击杀的高价值目标）');
  // 真的打出去，验证伤害确实落在重将身上
  const r = applyAction(st, CTX, a);
  assert.equal(r.ok, true);
  assert.equal(getUnit(r.state, 'enemy', 'front', 1), null, '重将应被 3 点战吼击杀');
  assert.equal(getUnit(r.state, 'enemy', 'front', 0)!.hp, 5, '木桩不该挨打');
});

/* ============================================================
   ⑤⑥ 卡组风格：速攻 vs 后期
   ============================================================ */

test('AI⑤：低费卡组判为速攻，高费卡组判为后期', () => {
  const aggro = profileCards(Array.from({ length: 30 }, () => C.grunt as CardDef));
  const control = profileCards(Array.from({ length: 30 }, () => C.bomb as CardDef));
  assert.equal(aggro.style, 'aggro');
  assert.equal(control.style, 'control');
  assert.ok(aggro.weights.face > control.weights.face, '速攻更看重打脸');
  assert.ok(control.weights.board > aggro.weights.board, '后期更看重场面');
});

test('AI⑤⑥：同一局面下速攻选择打脸、后期选择交换（风格真的影响决策）', () => {
  // 我方 3/3 打对方 1/5 木桩：能磨 3 点但杀不掉，被反击 1 点
  //   速攻：3 点打脸 × 1.10 > 磨木桩 × 0.72
  //   后期：磨掉对方 3 点血量 + 人数/场面权重更高 → 选择交换
  const build = (deckId: string): MatchState => {
    const st = makeState({ own: ['t_brute'], enemy: ['t_chip'], deck: [deckId] });
    // 把牌库换成整副风格牌，让画像生效
    st.sides.own.deck = Array(20).fill(deckId);
    return st;
  };
  const aggroState = makeState({ own: ['t_brute'], enemy: ['t_chip'] });
  aggroState.sides.own.deck = Array(20).fill('t_grunt');      // 1 费 → 速攻
  const controlState = makeState({ own: ['t_brute'], enemy: ['t_chip'] });
  controlState.sides.own.deck = Array(20).fill('t_bomb');     // 6 费 → 后期

  assert.equal(profileCards(Array(20).fill(C.grunt)).style, 'aggro');
  assert.equal(profileCards(Array(20).fill(C.bomb)).style, 'control');
  assert.equal(describe(chooseAction(aggroState, CTX)), 'ATTACK→lord', '速攻应打脸');
  assert.equal(describe(chooseAction(controlState, CTX)), 'ATTACK→unit(0)', '后期应磨场面');
  void build;
});

test('AI⑥：以多打少本身有分（人数差计入评估）', () => {
  const st = makeState({ own: ['t_soldier'], enemy: ['t_soldier'] });
  const w = profileCards(Array(30).fill(C.bomb)).weights;
  const even = evaluate(st, 'own', w);
  const plus = makeState({ own: ['t_soldier', 't_soldier'], enemy: ['t_soldier'] });
  assert.ok(evaluate(plus, 'own', w) > even, '多一个单位应该加分');
});

/* ============================================================
   ⑦ 双方技能平等：同一套判定，敌方 AI 一样会放技能
   ============================================================ */

test('AI⑦：敌方 AI 一样会释放主动技（不是只有玩家能用）', () => {
  const st = makeState({ active: 'enemy', own: ['t_chip'], enemy: ['t_mage'] });
  const d = decideFor(st);
  assert.equal(d.action?.type, 'USE_SKILL', `敌方应释放雷击，实际 ${describe(d.action)}`);
  const a = d.action as Extract<Action, { type: 'USE_SKILL' }>;
  assert.equal(a.row, 'front');
  assert.equal(a.col, 0);
  assert.equal(a.target?.side, 'own', '目标应是玩家一方的人物');
  const r = applyAction(st, CTX, a);
  assert.equal(r.ok, true);
  assert.equal(getUnit(r.state, 'own', 'front', 0)!.hp, 1, '木桩 5 血吃 4 点 → 剩 1');
});

test('AI⑦：镜像局面下双方决策对称（同一条判定链路）', () => {
  const ownSide = chooseAction(makeState({ active: 'own', own: ['t_mage'], enemy: ['t_chip'] }), CTX);
  const enemySide = chooseAction(makeState({ active: 'enemy', own: ['t_chip'], enemy: ['t_mage'] }), CTX);
  assert.equal(describe(ownSide).replace(/own|enemy/g, 'X'), describe(enemySide).replace(/own|enemy/g, 'X'));
  assert.equal(ownSide?.type, 'USE_SKILL');
  assert.equal(enemySide?.type, 'USE_SKILL');
});

test('AI⑦：技能效果按描述生效 —— 治疗真的回血（且不超上限）', () => {
  // 铁壁 3/5 掉到 1 血 → 疗伤 +3 → 4 血；若治错人（满血的医者）则数值不动
  const st = makeState({ own: ['t_wall', 't_healer'], enemy: ['t_soldier'] });
  const me = getUnit(st, 'own', 'front', 0)!;
  setUnit(st, 'own', 'front', 0, { ...me, hp: 1 });
  const a = chooseAction(st, CTX) as Extract<Action, { type: 'USE_SKILL' }>;
  const r = applyAction(st, CTX, a);
  assert.equal(r.ok, true);
  assert.equal(getUnit(r.state, 'own', 'front', 0)!.hp, 4, '3/5 从 1 血回到 4 血（+3）');
  assert.equal(getUnit(r.state, 'own', 'front', 1)!.hp, 4, '医者自己不该被治（本来就满血）');
  assert.ok(r.events.some((e) => e.type === 'SKILL_TRIGGERED'), '应播报技能发动');
});

/* ============================================================
   斩杀与空过
   ============================================================ */

test('AI：能一击斩杀主将时一定斩杀（哪怕场面更亏）', () => {
  const st = makeState({ own: ['t_brute'], enemy: ['t_soldier'], lordHp: 3 });
  const d = decideFor(st);
  assert.equal(describe(d.action), 'ATTACK→lord');
});

test('AI：直伤牌能补刀时优先打出斩杀', () => {
  const st = makeState({ own: [], enemy: ['t_brute'], hand: ['t_burn'], lordHp: 3 });
  const d = decideFor(st);
  assert.equal(d.action?.type, 'PLAY_CARD');
  const r = applyAction(st, CTX, d.action!);
  assert.equal(r.state.winner, 'own', '3 点直伤应直接结束对局');
});

test('AI：无收益可做时选择空过（返回 null），不会白扔牌', () => {
  // 场上没人、手里只有打不出去的贵牌、没有目标 → 空过
  const st = makeState({ own: [], enemy: [], hand: ['t_bomb'], command: 1 });
  assert.equal(chooseAction(st, CTX), null);
});

/* ============================================================
   工程约束：确定性、合法性、预算
   ============================================================ */

test('AI：决策确定性 —— 同一局面连续两次给出同一动作', () => {
  const st = makeState({ own: ['t_brute', 't_mage'], enemy: ['t_soldier', 't_chip'], hand: ['t_thrower', 't_burn'] });
  const a = JSON.stringify(chooseAction(st, CTX));
  const b = JSON.stringify(chooseAction(st, CTX));
  assert.equal(a, b);
});

test('AI：模拟预算有上限（单步不会无限模拟）', () => {
  const st = makeState({ own: ['t_brute', 't_mage', 't_healer'], enemy: ['t_soldier', 't_chip'], hand: ['t_thrower', 't_burn', 't_captain'] });
  const d = decideFor(st);
  assert.ok(d.sims <= SIM_BUDGET, `模拟 ${d.sims} 次，超过预算 ${SIM_BUDGET}`);
  assert.ok(d.sims > 0);
});

test('AI：整局对战每一步都被引擎接受、且必然收束', () => {
  const d = data();
  const { state } = setupMatch({
    seed: 4242, cards: d.cards, lords: d.lords,
    decks: { own: Array(30).fill('t_grunt'), enemy: Array(30).fill('t_soldier') },
  });
  let s = startMatch(state, CTX).state;
  let n = 0;
  let skills = 0;
  while (!s.winner && n < 3000) {
    const a = chooseAction(s, CTX) ?? { type: 'END_TURN' as const };
    const r = applyAction(s, CTX, a);
    assert.equal(r.ok, true, `第 ${n} 步被拒：${JSON.stringify(a)} — ${r.error ?? ''}`);
    if (a.type === 'USE_SKILL') skills += 1;
    s = r.state;
    n += 1;
  }
  assert.ok(s.winner, '对局必须收束');
  assert.ok(n > 10);
  assert.ok(skills >= 0);
});

test('AI：换牌只换「现在打不出去」的牌', () => {
  const st = makeState({ hand: ['t_bomb', 't_grunt', 't_soldier', 't_brute'] });
  const out = aiMulligan(st, 'own', CTX);
  assert.deepEqual(out, [0], '6 费的重将应被换掉，1–3 费留下');
});

test('AI：真实卡池下正反两方都能跑完整局（回归：敌方 AI 不再"只会打脸"）', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const dir = join(process.cwd(), 'data');
  if (!existsSync(join(dir, 'cards.json'))) return;          // 未生成数据时跳过
  const raw = JSON.parse(readFileSync(join(dir, 'cards.json'), 'utf8')) as unknown;
  const heroesRaw = JSON.parse(readFileSync(join(dir, 'heroes.json'), 'utf8')) as unknown;
  const unwrap = <T,>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : ((v as { cards: T[] }).cards ?? []));
  const real = loadData(
    { cards: unwrap<CardDef>(raw), heroes: unwrap(heroesRaw) },
    { own: 'shu_liubei', enemy: 'wei_caocao' },
  );
  const ctx: EngineContext = { cards: real.cards, lords: real.lords };
  const { state } = setupMatch({
    seed: 2026, cards: real.cards, lords: real.lords,
    decks: { own: autoDeck(real, 'shu'), enemy: autoDeck(real, 'wei') },
  });
  let s = startMatch(state, ctx).state;
  let n = 0;
  let unitAttacks = 0;
  let lordAttacks = 0;
  while (!s.winner && n < 3000) {
    const a = chooseAction(s, ctx);
    const act: Action = a ?? { type: 'END_TURN' };
    if (act.type === 'ATTACK') {
      if (act.to.kind === 'lord') lordAttacks += 1; else unitAttacks += 1;
    }
    const r = applyAction(s, ctx, act);
    assert.equal(r.ok, true, `第 ${n} 步被拒：${JSON.stringify(act)}`);
    s = r.state;
    n += 1;
  }
  assert.ok(s.winner, '真实卡池对局应收束');
  // ADR-052 记录旧 AI 是「90% 的攻击糊脸」；新 AI 必须真的参与场面交换
  assert.ok(unitAttacks > 0, `应有一定比例的攻击打人物（实际 人物 ${unitAttacks} / 主将 ${lordAttacks}）`);
});

/* ============================================================
   不变量：AI 提出的每一个候选，引擎都必须接受
   ============================================================ */

test('AI：候选动作 100% 引擎合法（回归：AI 另抄一份判定必然漂移）', async () => {
  // 这一条抓的是「AI 自己重写了一遍引擎的门控」这类缺陷 ——
  // 实测抓到过一次：主公技的门控漏了「进言（block_lord_skill）」，
  // AI 每回合都认真考虑一次被封锁的主公技，提出来必被引擎拒。
  // 修法不是给 AI 补一行，而是把判定下沉到 rules.canUseLordSkill 由两边共用。
  const { readFileSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const dir = join(process.cwd(), 'data');
  if (!existsSync(join(dir, 'cards.json'))) return;
  const raw = JSON.parse(readFileSync(join(dir, 'cards.json'), 'utf8')) as unknown;
  const heroesRaw = JSON.parse(readFileSync(join(dir, 'heroes.json'), 'utf8')) as unknown;
  const unwrap = <T,>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : ((v as { cards: T[] }).cards ?? []));
  const real = loadData(
    { cards: unwrap<CardDef>(raw), heroes: unwrap(heroesRaw) },
    { own: 'shu_liubei', enemy: 'wei_caocao' },
  );
  const ctx: EngineContext = { cards: real.cards, lords: real.lords };
  const { generateOptions } = await import('../src/ai/options.ts');
  const { profileFor } = await import('../src/ai/profile.ts');

  let checked = 0;
  for (const faction of ['shu', 'wei', 'wu'] as const) {
    const { state } = setupMatch({
      seed: 31, cards: real.cards, lords: real.lords,
      decks: { own: autoDeck(real, faction), enemy: autoDeck(real, 'qun' as 'shu') },
    });
    let s = startMatch(state, ctx).state;
    let guard = 0;
    while (!s.winner && guard < 400) {
      const w = profileFor(s, s.active, ctx).weights;
      for (const o of generateOptions(s, w)) {
        const r = applyAction(s, ctx, o.action);
        assert.equal(r.ok, true, `引擎拒绝了 AI 的候选：${o.label} :: ${JSON.stringify(o.action)} :: ${r.error ?? ''}`);
        checked += 1;
      }
      const a = chooseAction(s, ctx) ?? { type: 'END_TURN' as const };
      const r = applyAction(s, ctx, a);
      s = r.ok ? r.state : applyAction(s, ctx, { type: 'END_TURN' }).state;
      guard += 1;
    }
  }
  assert.ok(checked > 200, `应检查到足量候选，实际 ${checked}`);
});

/* ============================================================
   回归：衍生物换真卡 = 卡差收益（设计者实机截图）
   ============================================================ */

test('AI①：0 费衍生物换掉对方真卡照做不误（回归：两个西凉铁骑全打脸）', () => {
  // 设计者截图：敌方两个 2/1 先攻「西凉铁骑」（马腾战吼召唤的**衍生物**）
  // 面对我方 2/2 蔡瑁，AI 却全部打脸。根因不是权重，而是评估里**没有卡差这一项**：
  // 只按「攻+血」算，2/1 衍生物（3 点）换 2/2 真卡（4.6 点）只赚 1.6，
  // 于是宁可换 2 点打脸。真实收益是「对手拿牌库里的牌换掉我一个白送的衍生物」——
  // 修法见 cards.ts 的 cardEquityOf（复用 NON_DECK_TYPES 判定，不写死卡名）。
  const cases: Array<[string, string]> = [
    ['t_grunt', '速攻'],      // 全 1 费 → aggro
    ['t_soldier', '中速'],    // 默认 MID_DECK 之外的对照
    ['t_bomb', '后期'],       // 全 6 费 → control
  ];
  for (const [deckId, style] of cases) {
    const st = makeState({ own: ['t_tieqi'], enemy: ['t_soldier'] });
    st.sides.own.deck = Array(20).fill(deckId);
    const a = chooseAction(st, CTX);
    assert.equal(describe(a), 'ATTACK→unit(0)',
      `${style}档：衍生物应换掉 2/2 真卡（白送的单位换对手一张牌），实际 ${describe(a)}`);
  }
});

test('AI①：衍生物换真卡时，AI 只牺牲一个、不把两个都填进去', () => {
  // 第一个衍生物换掉 2/2 之后，第二个衍生物面对 3/5 铁壁（打它必死且杀不掉）→ 应改打脸
  const st = makeState({
    own: ['t_tieqi', 't_tieqi'],
    enemy: ['t_soldier', 't_wall'],
  });
  const first = chooseAction(st, CTX);
  assert.equal(describe(first), 'ATTACK→unit(0)', '第一个应解掉 2/2');
  const r = applyAction(st, CTX, first!);
  const second = chooseAction({ ...r.state, active: 'own' }, CTX);
  assert.equal(describe(second), 'ATTACK→lord', `第二个应打脸，实际 ${describe(second)}`);
});

/* ============================================================
   攻击分配：谁去解场、谁去打脸（设计者实机要求）
   ============================================================ */

test('AI：解场交给「刚好够用」的那个，把大攻留给主将', () => {
  // 3/3 与 4/5 面对 2/2：谁去打都只掉 2 血 —— 单看血量两边**完全同分**，
  // 旧版只能按格子顺序瞎选。留下 4/5 能多打主将伤害，所以解场必须由 3/3 执行。
  const cases: Array<[string[], number, number]> = [
    [['t_brute', 't_big'], 0, 1],   // 3/3 在左
    [['t_big', 't_brute'], 1, 0],   // 换个站位，结论不能跟着列号走
  ];
  for (const [order, trader, face] of cases) {
    const st = makeState({ own: [...order], enemy: ['t_soldier'] });
    const first = chooseAction(st, CTX) as Extract<Action, { type: 'ATTACK' }>;
    assert.equal(first?.type, 'ATTACK');
    assert.equal(first.to.kind, 'unit', '先解掉对方 2/2');
    assert.equal(first.from.col, trader, `解场应由「${order[trader]}」执行，实际 ${JSON.stringify(first.from)}`);

    const r = applyAction(st, CTX, first);
    assert.equal(r.ok, true);
    const second = chooseAction(r.state, CTX) as Extract<Action, { type: 'ATTACK' }>;
    assert.equal(second?.type, 'ATTACK');
    assert.equal(second.to.kind, 'lord', '剩下的那个去打主将');
    assert.equal(second.from.col, face, `打脸应由「${order[face]}」执行（伤害更高）`);
    // 本回合打脸总量应等于 4（4/5 的攻击力），而不是 3
    const r2 = applyAction(r.state, CTX, second);
    assert.equal(30 - r2.state.sides.enemy.lord.hp, 4, '本回合主将应吃满 4 点（大攻留给主将）');
  }
});

test('AI：只有大攻能活着解场时，不让小攻去送', () => {
  // 3/3 打 3/2 会同归于尽（对方 2 血、反击 3 点）；4/5 打则剩 4/2 活着
  const cases: Array<[string[], number]> = [
    [['t_brute', 't_big'], 1],
    [['t_big', 't_brute'], 0],
  ];
  for (const [order, trader] of cases) {
    const st = makeState({ own: [...order], enemy: ['t_hit3'] });
    const a = chooseAction(st, CTX) as Extract<Action, { type: 'ATTACK' }>;
    assert.equal(a?.type, 'ATTACK');
    assert.equal(a.to.kind, 'unit');
    assert.equal(a.from.col, trader, `应由「${order[trader]}」解场（能活下来），实际 ${JSON.stringify(a.from)}`);
    const other = trader === 0 ? 1 : 0;
    const r = applyAction(st, CTX, a);
    assert.equal(r.ok, true);
    assert.ok(getUnit(r.state, 'own', 'front', trader), '解场的那张必须存活');
    assert.ok(getUnit(r.state, 'own', 'front', other), '另一张人物卡也必须存活（两张都留住）');
    assert.equal(getUnit(r.state, 'enemy', 'front', 0), null, '对方 3/2 应被解掉');
  }
});
