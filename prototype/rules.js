/**
 * 战场规则（纯逻辑，零 DOM 依赖）
 *
 * 对应 docs/gdd/02-battlefield.md §3 的 4 条攻击规则。
 * 用 UMD 风格导出，便于：
 *   - 浏览器经典脚本直接 <script src="rules.js">
 *   - Node 测试用 new Function(code)() 加载（见 rules-check.mjs）
 */
(function (root) {
  'use strict';

  /* ---------- 关键词表（对应 data/keywords.yaml） ---------- */
  const KW = {
    zhong_yi:  { name: '忠义', short: '忠' },
    yi_ji:     { name: '遗计', short: '遗' },
    ji_xing:   { name: '疾行', short: '疾' },
    jia_dun:   { name: '架盾', short: '盾' },
    wu_sheng:  { name: '武圣', short: '圣' },
    shen_she:  { name: '神射', short: '射' },
    lian_ji:   { name: '连击', short: '连' },
    yin_xue:   { name: '饮血', short: '饮' },
    qi_xi:     { name: '奇袭', short: '袭' },
    xian_gong: { name: '先攻', short: '先' },
    jie_zhen:  { name: '结阵', short: '阵' },
    wu_shuang: { name: '无双', short: '无' },
  };

  /* ---------- 卡牌表（仅含已确认卡 + 明确标注的占位卡） ---------- */
  const CARDS = {
    infantry: {
      id: 'neutral_infantry', name: '步兵', type: 'troop', troopKind: 'infantry',
      cost: 1, atk: 2, hp: 1, kw: ['jie_zhen'],
      memo: '相邻有友方步兵时，本次攻击 +1（2→3）',
    },
    shield: {
      id: 'neutral_shieldman', name: '盾兵', type: 'troop', troopKind: 'shield',
      cost: 1, atk: 1, hp: 2, kw: ['jia_dun'],
      memo: '仅前军生效：敌方必须先打掉它才能攻击其他人',
    },
    archer: {
      id: 'neutral_archer', name: '弓箭手', type: 'troop', troopKind: 'archer',
      cost: 1, atk: 1, hp: 1, kw: ['shen_she'],
      memo: '可攻击任意列的人物卡，无视距离',
    },
    general_ph: {
      id: 'ph_general', name: '占位武将', type: 'general', faction: 'shu',
      cost: 5, atk: 5, hp: 5, kw: ['xian_gong'],
      memo: '【占位】仅验证布局与卡面，数值非最终设计',
    },
    strategist_ph: {
      id: 'ph_strategist', name: '占位谋臣', type: 'strategist', faction: 'wei',
      cost: 4, atk: 0, hp: 3, kw: [],
      memo: '【占位】谋臣不能普通攻击，靠主动技输出',
    },
    tactic_ph: {
      id: 'ph_tactic', name: '占位战法', type: 'tactic', faction: 'neutral',
      cost: 3, memo: '【占位】验证手牌与画廊卡面',
    },
    yuxi: {
      id: 'neutral_chuanguo_yuxi', name: '传国玉玺', type: 'special', faction: 'neutral',
      cost: 0, memo: '0 费，本回合统率 +1',
    },
  };

  /* ---------- 初始局面（演示用） ---------- */
  function initialState() {
    const empty = () => [null, null, null, null, null];
    const mk = (id, extra) => Object.assign({}, CARDS[id], extra || {});
    return {
      own: {
        lord: { name: '刘备', faction: 'shu', hp: 30, armor: 2, skill: '仁德' },
        rows: {
          front: [mk('infantry'), mk('infantry'), null, mk('shield'), null],
          back: [mk('general_ph'), null, mk('archer'), null, mk('strategist_ph')],
        },
      },
      enemy: {
        lord: { name: '曹操', faction: 'wei', hp: 26, armor: 0, skill: '号令' },
        rows: {
          front: [null, mk('shield'), null, mk('infantry'), null],
          back: [null, null, mk('archer'), null, mk('strategist_ph')],
        },
      },
      hand: [
        Object.assign({}, CARDS.infantry, { uid: 'h1' }),
        Object.assign({}, CARDS.archer, { uid: 'h2' }),
        Object.assign({}, CARDS.general_ph, { uid: 'h3' }),
        Object.assign({}, CARDS.tactic_ph, { uid: 'h4' }),
        Object.assign({}, CARDS.yuxi, { uid: 'h5' }),
      ],
      turn: 4,
      command: { cur: 3, max: 4 },
    };
  }

  /* ---------- 状态容器 ---------- */
  let state = initialState();
  const getState = () => state;
  const setState = (s) => { state = s; };
  const resetState = () => { state = initialState(); return state; };

  const ROWS = ['front', 'back'];
  const COLS = [0, 1, 2, 3, 4];
  const other = (side) => (side === 'own' ? 'enemy' : 'own');

  /** 敌方场上生效的「架盾」单位（仅前军生效） */
  function shieldUnits(side) {
    const out = [];
    state[side].rows.front.forEach((u, col) => {
      if (u && u.kw.indexOf('jia_dun') >= 0) out.push({ row: 'front', col: col, unit: u });
    });
    return out;
  }

  /**
   * 计算合法攻击目标
   * @returns {{targets: Array, why: string}}
   */
  function legalTargets(side, row, col) {
    const u = state[side].rows[row][col];
    if (!u) return { targets: [], why: '空格' };
    if (u.type === 'strategist') return { targets: [], why: '谋臣不能普通攻击' };

    const foe = other(side);
    const targets = [];

    // 规则 ④：架盾最高优先级（可跨列）
    const shields = shieldUnits(foe);
    if (shields.length) {
      shields.forEach((s) => targets.push({ kind: 'unit', side: foe, row: s.row, col: s.col }));
      return {
        targets: targets,
        why: '敌方存在「架盾」（列' + shields.map((s) => s.col + 1).join('、') +
             '前军）→ 必须先攻击它（可跨列）',
      };
    }

    // 弓箭手「神射」：可攻击任意列的人物卡
    if (u.kw.indexOf('shen_she') >= 0) {
      ROWS.forEach((r) => {
        state[foe].rows[r].forEach((x, c) => {
          if (x) targets.push({ kind: 'unit', side: foe, row: r, col: c });
        });
      });
      const ownColClear = !state[foe].rows.front[col] && !state[foe].rows.back[col];
      if (ownColClear) targets.push({ kind: 'lord', side: foe });
      return {
        targets: targets,
        why: '「神射」：可攻击任意列的人物卡' +
             (ownColClear ? '；本列两排皆空 → 可攻击主将' : '；本列有敌方单位 → 不能攻击主将'),
      };
    }

    // 近战：被自己人挡住
    if (row === 'back' && state[side].rows.front[col]) {
      return { targets: [], why: '位于后军且同列前方有友方单位 → 被自己人挡住，无法攻击' };
    }

    // 规则 ①②③：同列 → 前军 → 后军（穿透）→ 主将
    if (state[foe].rows.front[col]) {
      targets.push({ kind: 'unit', side: foe, row: 'front', col: col });
      return { targets: targets, why: '同列（列' + (col + 1) + '）敌方前军有人物卡 → 目标只能是它' };
    }
    if (state[foe].rows.back[col]) {
      targets.push({ kind: 'unit', side: foe, row: 'back', col: col });
      return { targets: targets, why: '同列（列' + (col + 1) + '）前军为空 → 穿透攻击该列后军' };
    }
    targets.push({ kind: 'lord', side: foe });
    return { targets: targets, why: '同列（列' + (col + 1) + '）两排皆空 → 可攻击敌方主将（破阵斩将）' };
  }

  /** 可部署格子 */
  function legalPlacements(side) {
    const out = [];
    ROWS.forEach((r) => COLS.forEach((c) => {
      if (!state[side].rows[r][c]) out.push({ row: r, col: c });
    }));
    return out;
  }

  /** 部署：把卡放到指定格 */
  function deploy(side, row, col, card) {
    if (state[side].rows[row][col]) return false;
    state[side].rows[row][col] = card;
    return true;
  }

  root.Rules = {
    KW: KW, CARDS: CARDS,
    initialState: initialState,
    getState: getState, setState: setState, resetState: resetState,
    shieldUnits: shieldUnits,
    legalTargets: legalTargets,
    legalPlacements: legalPlacements,
    deploy: deploy,
    ROWS: ROWS, COLS: COLS, other: other,
  };
})(typeof window !== 'undefined' ? window : globalThis);
