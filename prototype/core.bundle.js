"use strict";
var Core = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/index.ts
  var index_exports = {};
  __export(index_exports, {
    ACTIONS: () => ACTIONS,
    BOARD: () => BOARD,
    CARD_TYPES: () => CARD_TYPES,
    COMMAND: () => COMMAND,
    DECK: () => DECK,
    FORBIDDEN_KEYWORD_COMBOS: () => FORBIDDEN_KEYWORD_COMBOS,
    KEYWORDS: () => KEYWORDS,
    LORD_HP: () => LORD_HP,
    MATCH: () => MATCH,
    STATUSES: () => STATUSES,
    TIMING: () => TIMING,
    allUnits: () => allUnits,
    applyAction: () => applyAction,
    applyStatus: () => applyStatus,
    autoDeck: () => autoDeck,
    canAttack: () => canAttack,
    canPlayCard: () => canPlayCard,
    checkWinner: () => checkWinner,
    chooseAction: () => chooseAction,
    cloneState: () => cloneState,
    createMatch: () => createMatch,
    createRng: () => createRng,
    dealDamage: () => dealDamage,
    discardOverflow: () => discardOverflow,
    drawCard: () => drawCard,
    effectiveAttack: () => effectiveAttack,
    findByUid: () => findByUid,
    gainArmor: () => gainArmor,
    getUnit: () => getUnit,
    handOverflow: () => handOverflow,
    hasKeyword: () => hasKeyword,
    hashSeed: () => hashSeed,
    healTarget: () => healTarget,
    isMelee: () => isMelee,
    killUnit: () => killUnit,
    legalPlacements: () => legalPlacements,
    legalTargets: () => legalTargets,
    loadData: () => loadData,
    lordAlive: () => lordAlive,
    lordRef: () => lordRef,
    makeUnit: () => makeUnit,
    newMatch: () => newMatch,
    nextUidSeq: () => nextUidSeq,
    openColumns: () => openColumns,
    other: () => other,
    refAlive: () => refAlive,
    refHp: () => refHp,
    resolveTargets: () => resolveTargets,
    resolveTurnEndStatuses: () => resolveTurnEndStatuses,
    resolveTurnStartStatuses: () => resolveTurnStartStatuses,
    runEffects: () => runEffects,
    setUnit: () => setUnit,
    shieldUnits: () => shieldUnits,
    startMatch: () => startMatch,
    statusStacks: () => statusStacks,
    summonUnit: () => summonUnit,
    takeTurn: () => takeTurn,
    unitCount: () => unitCount,
    unitRef: () => unitRef
  });

  // src/rng.ts
  function createRng(seed) {
    let s = seed >>> 0;
    const next = () => {
      s = s + 1831565813 >>> 0;
      let t = s;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    return {
      getState: () => s,
      setState: (v) => {
        s = v >>> 0;
      },
      next,
      int: (n) => Math.floor(next() * n),
      pick: (arr) => arr[Math.floor(next() * arr.length)],
      shuffle: (arr) => {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(next() * (i + 1));
          const tmp = arr[i];
          arr[i] = arr[j];
          arr[j] = tmp;
        }
        return arr;
      }
    };
  }
  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  // src/constants.ts
  var BOARD = {
    COLS: 5,
    ROWS: ["front", "back"],
    MAX_UNITS: 10
  };
  var LORD_HP = 30;
  var COMMAND = { START: 1, MAX: 10 };
  var DECK = {
    SIZE: 30,
    HAND_START_FIRST: 3,
    HAND_START_SECOND: 4,
    HAND_LIMIT: 10,
    DRAW_PER_TURN: 1
  };
  var MATCH = { TURN_LIMIT: 40 };
  var KEYWORDS = {
    zhong_yi: { name: "\u5FE0\u4E49", implemented: true, note: "\u9635\u4EA1\u65F6\u89E6\u53D1\u5361\u724C\u5B9A\u4E49\u7684 on_death \u6548\u679C" },
    yi_ji: { name: "\u9057\u8BA1", implemented: true, note: "\u9635\u4EA1\u65F6\u62BD 1 \u5F20\u724C" },
    ji_xing: { name: "\u75BE\u884C", implemented: true, note: "\u5165\u573A\u5F53\u56DE\u5408\u5373\u53EF\u653B\u51FB" },
    jia_dun: { name: "\u67B6\u76FE", implemented: true, note: "\u4EC5\u524D\u519B\u751F\u6548\u7684\u5168\u5C40\u5632\u8BBD" },
    wu_sheng: { name: "\u6B66\u5723", implemented: true, note: "\u514D\u75AB\u4E00\u6B21\u4F24\u5BB3" },
    shen_she: { name: "\u795E\u5C04", implemented: true, note: "\u53EF\u653B\u51FB\u4EFB\u610F\u5217\u7684\u4EBA\u7269\u5361" },
    lian_ji: { name: "\u8FDE\u51FB", implemented: true, note: "\u6BCF\u56DE\u5408\u53EF\u653B\u51FB 2 \u6B21" },
    yin_xue: { name: "\u996E\u8840", implemented: true, note: "\u9020\u6210\u4F24\u5BB3\u65F6\u4E3A\u5DF1\u65B9\u4E3B\u5C06\u56DE\u590D\u7B49\u91CF\u751F\u547D" },
    qi_xi: { name: "\u5947\u88AD", implemented: true, note: "\u4E0D\u80FD\u88AB\u6307\u5B9A\u4E3A\u653B\u51FB\u76EE\u6807\uFF1B\u653B\u51FB\u540E\u5931\u53BB" },
    xian_gong: { name: "\u5148\u653B", implemented: true, note: "\u5148\u7ED3\u7B97\u4F24\u5BB3\uFF0C\u76EE\u6807\u9635\u4EA1\u5219\u4E0D\u53D7\u53CD\u51FB" },
    jie_zhen: { name: "\u7ED3\u9635", implemented: true, note: "\u76F8\u90BB\u6709\u53CB\u65B9\u6B65\u5175\u65F6\u672C\u6B21\u666E\u653B +1" },
    wu_shuang: { name: "\u65E0\u53CC", implemented: true, note: "\u653B\u51FB\u65F6\u4E0D\u53D7\u5230\u53CD\u51FB\u4F24\u5BB3" }
  };
  var FORBIDDEN_KEYWORD_COMBOS = [
    ["jia_dun", "qi_xi"]
  ];
  var STATUSES = {
    zhen_fen: { name: "\u632F\u594B", kind: "buff", numeric: true, duration: "permanent", note: "\u653B\u51FB +N" },
    ji_jiu: { name: "\u6025\u6551", kind: "buff", numeric: true, duration: "permanent", note: "\u56DE\u5408\u5F00\u59CB\u6062\u590D N \u70B9\u751F\u547D" },
    jia_dun: { name: "\u67B6\u76FE", kind: "buff", numeric: false, duration: "conditional", note: "\u4EC5\u524D\u519B\u751F\u6548" },
    xian_gong: { name: "\u5148\u653B", kind: "buff", numeric: false, duration: "permanent", note: "\u5148\u7ED3\u7B97\u4F24\u5BB3" },
    qi_xi: { name: "\u5947\u88AD", kind: "buff", numeric: false, duration: "until_consumed", note: "\u4E0D\u80FD\u88AB\u6307\u5B9A\u4E3A\u76EE\u6807" },
    wu_sheng: { name: "\u6B66\u5723", kind: "buff", numeric: false, duration: "until_consumed", note: "\u514D\u75AB\u4E00\u6B21\u4F24\u5BB3" },
    hu_jia: { name: "\u62A4\u7532", kind: "buff", numeric: true, duration: "permanent", scope: "lord", note: "\u5438\u6536\u4F24\u5BB3" },
    zhen_she: { name: "\u9707\u6151", kind: "debuff", numeric: false, duration: "turns", note: "\u4E0D\u80FD\u666E\u653B\u4E0E\u4E3B\u52A8\u6280" },
    hun_luan: { name: "\u6DF7\u4E71", kind: "debuff", numeric: false, duration: "turns", note: "\u76EE\u6807\u968F\u673A" },
    zhong_du: { name: "\u4E2D\u6BD2", kind: "debuff", numeric: true, duration: "permanent", note: "\u56DE\u5408\u7ED3\u675F\u5931\u53BB N \u751F\u547D" },
    xu_ruo: { name: "\u865A\u5F31", kind: "debuff", numeric: true, duration: "turns", note: "\u653B\u51FB \u2212N" },
    duan_liang: { name: "\u65AD\u7CAE", kind: "debuff", numeric: true, duration: "turns", scope: "lord", note: "\u7EDF\u7387\u4E0A\u9650 \u2212N" }
  };
  var TIMING = {
    TURN_START: "turn_start",
    DRAW: "draw",
    ON_PLAY: "on_play",
    ON_DEATH: "on_death",
    ON_DAMAGED: "on_damaged",
    TURN_END: "turn_end",
    ON_ATTACK: "on_attack",
    ON_DEFEND: "on_defend"
  };
  var ACTIONS = [
    "damage",
    "heal",
    "draw",
    "summon",
    "apply_status",
    "remove_status",
    "move",
    "destroy",
    "modify",
    "gain_armor",
    "gain_command",
    "cost_modifier",
    "transform",
    "random_pick"
  ];
  var CARD_TYPES = ["troop", "general", "strategist", "event", "tactic", "elite", "special"];

  // src/state.ts
  function createMatch(opts) {
    const { seed = 1, lords, decks, cards, firstSide = "own" } = opts;
    const rng = createRng(seed);
    const makeSide = (side) => {
      const lordCard = lords[side];
      const deck = rng.shuffle([...decks[side]]);
      const handSize = side === firstSide ? DECK.HAND_START_FIRST : DECK.HAND_START_SECOND;
      const hand = [];
      for (let i = 0; i < handSize && deck.length; i++) {
        const id = deck.pop();
        const c = cards.get(id);
        if (c) hand.push(c);
      }
      return {
        lord: {
          id: lordCard.id,
          name: lordCard.name,
          faction: lordCard.faction,
          hp: LORD_HP,
          maxHp: LORD_HP,
          armor: 0,
          skill: lordCard.skill ?? "",
          skillDef: lordCard.skillDef,
          skillUsedThisTurn: false
        },
        rows: {
          front: new Array(BOARD.COLS).fill(null),
          back: new Array(BOARD.COLS).fill(null)
        },
        hand,
        deck,
        discard: [],
        command: { cur: COMMAND.START, max: COMMAND.START },
        fatigue: 0
      };
    };
    return {
      seed,
      uidSeq: 0,
      rngState: rng.getState(),
      turn: 0,
      active: firstSide,
      sides: { own: makeSide("own"), enemy: makeSide("enemy") },
      winner: null
    };
  }
  var cloneState = (s) => structuredClone(s);
  var other = (side) => side === "own" ? "enemy" : "own";
  var getUnit = (s, side, row, col) => s.sides[side].rows[row][col] ?? null;
  function setUnit(s, side, row, col, u) {
    s.sides[side].rows[row][col] = u;
  }
  function allUnits(s, side) {
    const out = [];
    for (const row of BOARD.ROWS) {
      s.sides[side].rows[row].forEach((unit, col) => {
        if (unit) out.push({ side, row, col, unit });
      });
    }
    return out;
  }
  function findByUid(s, uid) {
    for (const side of ["own", "enemy"]) {
      for (const row of BOARD.ROWS) {
        const arr = s.sides[side].rows[row];
        for (let col = 0; col < arr.length; col++) {
          const u = arr[col];
          if (u && u.uid === uid) return { side, row, col, unit: u };
        }
      }
    }
    return null;
  }
  var unitCount = (s, side) => allUnits(s, side).length;
  var hasKeyword = (u, kw) => !!u && u.kw.includes(kw);
  var statusStacks = (u, id) => u?.statuses[id] ?? 0;
  var shieldUnits = (s, side) => allUnits(s, side).filter(({ row, unit }) => row === "front" && hasKeyword(unit, "jia_dun") && unit.hp > 0);
  var lordAlive = (s, side) => s.sides[side].lord.hp > 0;
  function openColumns(s, side) {
    const out = [];
    for (let c = 0; c < BOARD.COLS; c++) {
      if (!s.sides[side].rows.front[c] && !s.sides[side].rows.back[c]) out.push(c);
    }
    return out;
  }
  function makeUnit(card, turn, seq) {
    return {
      uid: `${card.id}#${seq}`,
      cardId: card.id,
      name: card.name,
      type: card.type,
      faction: card.faction,
      cost: card.cost,
      atk: card.attack ?? 0,
      hp: card.health ?? 1,
      maxHp: card.health ?? 1,
      troopKind: card.troopKind,
      kw: [...card.keywords ?? []],
      statuses: {},
      skills: card.skills ? structuredClone(card.skills) : void 0,
      attackedThisTurn: 0,
      enteredTurn: turn
    };
  }
  function nextUidSeq(state) {
    state.uidSeq += 1;
    return state.uidSeq;
  }

  // src/rules.ts
  var isMelee = (u) => u.type !== "strategist" && !hasKeyword(u, "shen_she");
  function canAttack(state, side, row, col) {
    const u = getUnit(state, side, row, col);
    if (!u) return { ok: false, reason: "\u8BE5\u683C\u6CA1\u6709\u4EBA\u7269\u5361" };
    if (u.type === "strategist") return { ok: false, reason: "\u8C0B\u81E3\u4E0D\u80FD\u666E\u901A\u653B\u51FB" };
    if (statusStacks(u, "zhen_she") > 0) return { ok: false, reason: "\u88AB\u9707\u6151\uFF0C\u65E0\u6CD5\u884C\u52A8" };
    const maxAttacks = hasKeyword(u, "lian_ji") ? 2 : 1;
    if (u.attackedThisTurn >= maxAttacks) {
      return { ok: false, reason: `\u672C\u56DE\u5408\u5DF2\u653B\u51FB ${u.attackedThisTurn} \u6B21` };
    }
    if (u.enteredTurn === state.turn && !hasKeyword(u, "ji_xing")) {
      return { ok: false, reason: "\u672C\u56DE\u5408\u5165\u573A\uFF0C\u65E0\u6CD5\u653B\u51FB\uFF08\u75BE\u884C\u9664\u5916\uFF09" };
    }
    return { ok: true };
  }
  function effectiveAttack(state, side, row, col) {
    const u = getUnit(state, side, row, col);
    if (!u) return 0;
    let atk = u.atk;
    atk += statusStacks(u, "zhen_fen");
    atk -= statusStacks(u, "xu_ruo");
    if (hasKeyword(u, "jie_zhen")) {
      const cols = [col - 1, col, col + 1];
      const hasAllyInfantry = allUnits(state, side).some(
        ({ row: r, col: c, unit }) => unit.uid !== u.uid && unit.troopKind === "infantry" && cols.includes(c) && (r === "front" || r === "back")
      );
      if (hasAllyInfantry) atk += 1;
    }
    return Math.max(0, atk);
  }
  function legalTargets(state, side, row, col) {
    const u = getUnit(state, side, row, col);
    if (!u) return { targets: [], why: "\u7A7A\u683C" };
    if (u.type === "strategist") return { targets: [], why: "\u8C0B\u81E3\u4E0D\u80FD\u666E\u901A\u653B\u51FB" };
    const gate = canAttack(state, side, row, col);
    if (!gate.ok) return { targets: [], why: gate.reason };
    const foe = other(side);
    const targets = [];
    const shields = shieldUnits(state, foe);
    if (shields.length) {
      shields.forEach((s) => targets.push({ kind: "unit", side: foe, row: s.row, col: s.col }));
      return {
        targets,
        why: `\u654C\u65B9\u5B58\u5728\u300C\u67B6\u76FE\u300D\uFF08\u5217${shields.map((s) => s.col + 1).join("\u3001")}\u524D\u519B\uFF09\u2192 \u5FC5\u987B\u5148\u653B\u51FB\u5B83\uFF08\u53EF\u8DE8\u5217\uFF09`
      };
    }
    if (hasKeyword(u, "shen_she")) {
      for (const r of BOARD.ROWS) {
        state.sides[foe].rows[r].forEach((x, c) => {
          if (x && !hasKeyword(x, "qi_xi")) targets.push({ kind: "unit", side: foe, row: r, col: c });
        });
      }
      const ownColClear = !state.sides[foe].rows.front[col] && !state.sides[foe].rows.back[col];
      if (ownColClear) targets.push({ kind: "lord", side: foe });
      return {
        targets,
        why: "\u300C\u795E\u5C04\u300D\uFF1A\u53EF\u653B\u51FB\u4EFB\u610F\u5217\u7684\u4EBA\u7269\u5361" + (ownColClear ? "\uFF1B\u672C\u5217\u4E24\u6392\u7686\u7A7A \u2192 \u53EF\u653B\u51FB\u4E3B\u5C06" : "\uFF1B\u672C\u5217\u6709\u654C\u65B9\u5355\u4F4D \u2192 \u4E0D\u80FD\u653B\u51FB\u4E3B\u5C06")
      };
    }
    if (row === "back" && state.sides[side].rows.front[col]) {
      return { targets: [], why: "\u4F4D\u4E8E\u540E\u519B\u4E14\u540C\u5217\u524D\u65B9\u6709\u53CB\u65B9\u5355\u4F4D \u2192 \u88AB\u81EA\u5DF1\u4EBA\u6321\u4F4F\uFF0C\u65E0\u6CD5\u653B\u51FB" };
    }
    const front = state.sides[foe].rows.front[col];
    if (front) {
      if (hasKeyword(front, "qi_xi")) return { targets: [], why: "\u8BE5\u5217\u654C\u65B9\u524D\u519B\u5904\u4E8E\u300C\u5947\u88AD\u300D\uFF0C\u4E0D\u80FD\u88AB\u6307\u5B9A\u4E3A\u76EE\u6807" };
      targets.push({ kind: "unit", side: foe, row: "front", col });
      return { targets, why: `\u540C\u5217\uFF08\u5217${col + 1}\uFF09\u654C\u65B9\u524D\u519B\u6709\u4EBA\u7269\u5361 \u2192 \u76EE\u6807\u53EA\u80FD\u662F\u5B83` };
    }
    const back = state.sides[foe].rows.back[col];
    if (back) {
      if (hasKeyword(back, "qi_xi")) return { targets: [], why: "\u8BE5\u5217\u654C\u65B9\u540E\u519B\u5904\u4E8E\u300C\u5947\u88AD\u300D\uFF0C\u4E0D\u80FD\u88AB\u6307\u5B9A\u4E3A\u76EE\u6807" };
      targets.push({ kind: "unit", side: foe, row: "back", col });
      return { targets, why: `\u540C\u5217\uFF08\u5217${col + 1}\uFF09\u524D\u519B\u4E3A\u7A7A \u2192 \u7A7F\u900F\u653B\u51FB\u8BE5\u5217\u540E\u519B` };
    }
    targets.push({ kind: "lord", side: foe });
    return { targets, why: `\u540C\u5217\uFF08\u5217${col + 1}\uFF09\u4E24\u6392\u7686\u7A7A \u2192 \u53EF\u653B\u51FB\u654C\u65B9\u4E3B\u5C06\uFF08\u7834\u9635\u65A9\u5C06\uFF09` };
  }
  function legalPlacements(state, side) {
    const out = [];
    if (unitCount(state, side) >= BOARD.MAX_UNITS) return out;
    for (const row of BOARD.ROWS) {
      for (let col = 0; col < BOARD.COLS; col++) {
        if (!state.sides[side].rows[row][col]) out.push({ row, col });
      }
    }
    return out;
  }
  function canPlayCard(state, side, card, slot) {
    const s = state.sides[side];
    if (card.cost > s.command.cur) {
      return { ok: false, reason: `\u7EDF\u7387\u503C\u4E0D\u8DB3\uFF08\u9700\u8981 ${card.cost}\uFF0C\u5F53\u524D ${s.command.cur}\uFF09` };
    }
    if (card.type === "troop" || card.type === "general" || card.type === "strategist") {
      if (!slot) return { ok: false, reason: "\u4EBA\u7269\u5361\u9700\u8981\u6307\u5B9A\u90E8\u7F72\u4F4D\u7F6E" };
      if (state.sides[side].rows[slot.row][slot.col]) return { ok: false, reason: "\u8BE5\u683C\u5DF2\u6709\u5355\u4F4D" };
      if (unitCount(state, side) >= BOARD.MAX_UNITS) return { ok: false, reason: "\u6218\u573A\u5DF2\u6EE1" };
    }
    return { ok: true };
  }
  var handOverflow = (state, side) => Math.max(0, state.sides[side].hand.length - DECK.HAND_LIMIT);

  // src/mutate.ts
  var unitRef = (side, row, col) => ({ kind: "unit", side, row, col });
  var lordRef = (side) => ({ kind: "lord", side });
  function refHp(state, ref) {
    return ref.kind === "lord" ? state.sides[ref.side].lord.hp : getUnit(state, ref.side, ref.row, ref.col)?.hp ?? 0;
  }
  function refAlive(state, ref) {
    if (ref.kind === "lord") return state.sides[ref.side].lord.hp > 0;
    const u = getUnit(state, ref.side, ref.row, ref.col);
    return !!u && u.hp > 0;
  }
  function drawCard(state, cards, side, events) {
    const s = state.sides[side];
    if (s.deck.length === 0) {
      s.fatigue += 1;
      events.push({ type: "FATIGUE", side, amount: s.fatigue, hp: Math.max(0, s.lord.hp - s.fatigue) });
      dealDamage(state, cards, lordRef(side), s.fatigue, events, "fatigue");
      return;
    }
    const id = s.deck.pop();
    const card = cards.get(id);
    if (!card) return;
    s.hand.push(card);
    events.push({ type: "CARD_DRAWN", side, card, deckLeft: s.deck.length });
  }
  function dealDamage(state, cards, ref, amount, events, source) {
    if (amount <= 0 || !refAlive(state, ref)) return 0;
    if (ref.kind === "lord") {
      const lord = state.sides[ref.side].lord;
      let dmg = amount;
      if (lord.armor > 0) {
        const absorbed = Math.min(lord.armor, dmg);
        lord.armor -= absorbed;
        dmg -= absorbed;
      }
      lord.hp -= dmg;
      events.push({ type: "DAMAGE", target: ref, amount, source });
      if (lord.hp <= 0) {
        lord.hp = 0;
        checkWinner(state, events);
      }
      return amount;
    }
    const u = getUnit(state, ref.side, ref.row, ref.col);
    if (!u) return 0;
    if (statusStacks(u, "wu_sheng") > 0) {
      delete u.statuses.wu_sheng;
      u.kw = u.kw.filter((k) => k !== "wu_sheng");
      events.push({ type: "STATUS_EXPIRED", side: ref.side, row: ref.row, col: ref.col, status: "wu_sheng" });
      return 0;
    }
    u.hp -= amount;
    events.push({ type: "DAMAGE", target: ref, amount, source });
    if (u.hp <= 0) killUnit(state, cards, { side: ref.side, row: ref.row, col: ref.col, unit: u }, events);
    return amount;
  }
  function healTarget(state, ref, amount, events) {
    if (amount <= 0 || !refAlive(state, ref)) return;
    if (ref.kind === "lord") {
      const lord = state.sides[ref.side].lord;
      lord.hp = Math.min(lord.maxHp, lord.hp + amount);
      events.push({ type: "HEAL", target: ref, amount, hp: lord.hp });
      return;
    }
    const u = getUnit(state, ref.side, ref.row, ref.col);
    if (!u) return;
    u.hp = Math.min(u.maxHp, u.hp + amount);
    events.push({ type: "HEAL", target: ref, amount, hp: u.hp });
  }
  function gainArmor(state, side, amount, events) {
    const lord = state.sides[side].lord;
    lord.armor += amount;
    events.push({ type: "ARMOR_GAINED", side, amount, armor: lord.armor });
  }
  function applyStatus(state, ref, status, stacks, events) {
    if (ref.kind !== "unit") return;
    const u = getUnit(state, ref.side, ref.row, ref.col);
    if (!u) return;
    const def = STATUSES[status];
    const numeric = def?.numeric ?? true;
    u.statuses[status] = numeric ? (u.statuses[status] ?? 0) + stacks : Math.max(1, stacks);
    events.push({ type: "STATUS_APPLIED", side: ref.side, row: ref.row, col: ref.col, status, stacks });
  }
  function summonUnit(state, cards, side, row, col, cardId, events) {
    const card = cards.get(cardId);
    if (!card) return null;
    if (state.sides[side].rows[row][col]) return null;
    const u = makeUnit(card, state.turn, nextUidSeq(state));
    setUnit(state, side, row, col, u);
    events.push({ type: "UNIT_SUMMONED", side, row, col, unit: u });
    return u;
  }
  function killUnit(state, cards, ref, events) {
    const { side, row, col, unit } = ref;
    if (!getUnit(state, side, row, col)) return;
    setUnit(state, side, row, col, null);
    events.push({ type: "UNIT_DIED", side, row, col, unit });
    if (hasKeyword(unit, "yi_ji")) drawCard(state, cards, side, events);
    const card = cards.get(unit.cardId);
    const deathSkills = (card?.skills ?? []).filter((sk) => sk.trigger === "on_death");
    for (const sk of deathSkills) {
      for (const eff of sk.effects ?? []) {
        if (eff.action === "damage") {
          const foe = other(side);
          for (const t of allUnits(state, foe)) {
            dealDamage(state, cards, unitRef(t.side, t.row, t.col), eff.value ?? 0, events, unit.name);
          }
        } else if (eff.action === "draw") {
          for (let i = 0; i < (eff.value ?? 1); i++) drawCard(state, cards, side, events);
        }
      }
    }
  }
  function checkWinner(state, events) {
    if (state.winner) return;
    const ownDead = state.sides.own.lord.hp <= 0;
    const enemyDead = state.sides.enemy.lord.hp <= 0;
    if (!ownDead && !enemyDead) return;
    state.winner = ownDead && enemyDead ? "draw" : ownDead ? "enemy" : "own";
    events.push({ type: "GAME_OVER", winner: state.winner });
  }
  function resolveTurnStartStatuses(state, cards, side, events) {
    for (const ref of allUnits(state, side)) {
      const heal = statusStacks(ref.unit, "ji_jiu");
      if (heal > 0) healTarget(state, unitRef(ref.side, ref.row, ref.col), heal, events);
    }
  }
  function resolveTurnEndStatuses(state, cards, side, events) {
    for (const ref of allUnits(state, side)) {
      const poison = statusStacks(ref.unit, "zhong_du");
      if (poison > 0) {
        dealDamage(state, cards, unitRef(ref.side, ref.row, ref.col), poison, events, "\u4E2D\u6BD2");
      }
    }
    for (const ref of allUnits(state, side)) {
      for (const [id, def] of Object.entries(STATUSES)) {
        if (def.duration === "turns" && ref.unit.statuses[id]) {
          delete ref.unit.statuses[id];
          events.push({ type: "STATUS_EXPIRED", side: ref.side, row: ref.row, col: ref.col, status: id });
        }
      }
    }
  }
  function discardOverflow(state, side) {
    const s = state.sides[side];
    const dropped = [];
    while (s.hand.length > DECK.HAND_LIMIT) {
      const c = s.hand.pop();
      if (c) {
        s.discard.push(c);
        dropped.push(c);
      }
    }
    return dropped;
  }

  // src/effects.ts
  var hpOf = (s, t) => t.kind === "lord" ? s.sides[t.side].lord.hp : getUnit(s, t.side, t.row, t.col)?.hp ?? 0;
  var sameTarget = (a, b) => a.kind === b.kind && a.side === b.side && (a.kind === "lord" || b.kind === "unit" && a.row === b.row && a.col === b.col);
  var matchesFilter = (u, f, row) => {
    if (!f) return true;
    if (f.type) {
      if (f.type === "character") {
        if (!["troop", "general", "strategist"].includes(u.type)) return false;
      } else if (u.type !== f.type) return false;
    }
    if (f.keyword && !u.kw.includes(f.keyword)) return false;
    if (f.faction && u.faction !== f.faction) return false;
    if (f.row && row !== f.row) return false;
    if (typeof f.health_max === "number" && u.hp > f.health_max) return false;
    if (f.has_status && !(u.statuses[f.has_status] > 0)) return false;
    return true;
  };
  function resolveTargets(state, selector, ctx, rng) {
    if (!selector) return ctx.chosen ? [ctx.chosen] : [];
    const sideSel = selector.side ?? "enemy";
    const sides = sideSel === "both" ? ["own", "enemy"] : sideSel === "self" ? [ctx.side] : sideSel === "ally" ? [ctx.side] : [other(ctx.side)];
    const pool = [];
    for (const s of sides) {
      for (const r of BOARD.ROWS) {
        state.sides[s].rows[r].forEach((u, c) => {
          if (u && matchesFilter(u, selector.filter ?? {}, r)) pool.push(unitRef(s, r, c));
        });
      }
    }
    if (selector.mode === "random" && pool.length) {
      const n2 = selector.count === "all" ? pool.length : selector.count ?? 1;
      const picked = [];
      const copy = [...pool];
      for (let i = 0; i < n2 && copy.length; i++) {
        picked.push(copy.splice(rng.int(copy.length), 1)[0]);
      }
      return picked;
    }
    if (selector.count === "all") return pool;
    const n = selector.count ?? 1;
    if (selector.mode === "first") return pool.slice(0, n);
    if (selector.mode === "lowest_health") {
      return [...pool].sort((a, b) => hpOf(state, a) - hpOf(state, b)).slice(0, n);
    }
    if (ctx.chosen && pool.some((t) => sameTarget(t, ctx.chosen))) {
      return [ctx.chosen];
    }
    return pool.slice(0, n);
  }
  function runEffects(state, cards, effects, ctx, rng, events) {
    if (!effects?.length) return;
    for (const eff of effects) {
      const targets = eff.target ? resolveTargets(state, eff.target, ctx, rng) : [];
      switch (eff.action) {
        case "damage": {
          const list = targets.length ? targets : ctx.chosen ? [ctx.chosen] : [];
          for (const t of list) dealDamage(state, cards, t, eff.value ?? 0, events, ctx.source?.name ?? "\u6548\u679C");
          break;
        }
        case "heal": {
          const list = targets.length ? targets : ctx.chosen ? [ctx.chosen] : [];
          for (const t of list) healTarget(state, t, eff.value ?? 0, events);
          break;
        }
        case "draw": {
          for (let i = 0; i < (eff.value ?? 1); i++) drawCard(state, cards, ctx.side, events);
          break;
        }
        case "summon": {
          const empties = [];
          for (const r of BOARD.ROWS) {
            for (let c = 0; c < BOARD.COLS; c++) {
              if (!state.sides[ctx.side].rows[r][c]) empties.push({ row: r, col: c });
            }
          }
          const n = eff.count ?? 1;
          for (let i = 0; i < n && empties.length; i++) {
            const idx = eff.position === "random" ? rng.int(empties.length) : 0;
            const slot = empties.splice(idx, 1)[0];
            if (eff.unit) summonUnit(state, cards, ctx.side, slot.row, slot.col, eff.unit, events);
          }
          break;
        }
        case "apply_status": {
          const list = targets.length ? targets : ctx.chosen ? [ctx.chosen] : [];
          for (const t of list) {
            applyStatus(state, t, eff.status, eff.stacks ?? 1, events);
          }
          break;
        }
        case "gain_armor":
          gainArmor(state, ctx.side, eff.value ?? 1, events);
          break;
        case "gain_command": {
          const cmd = state.sides[ctx.side].command;
          cmd.cur = Math.min(cmd.max, cmd.cur + (eff.value ?? 1));
          break;
        }
        case "destroy": {
          const list = targets.length ? targets : ctx.chosen ? [ctx.chosen] : [];
          for (const t of list) {
            if (t.kind === "unit") {
              dealDamage(state, cards, t, 9999, events, "\u6467\u6BC1");
            }
          }
          break;
        }
        case "modify": {
          const list = targets.length ? targets : ctx.chosen ? [ctx.chosen] : [];
          for (const t of list) {
            if (t.kind !== "unit") continue;
            const u = getUnit(state, t.side, t.row, t.col);
            if (!u) continue;
            if (typeof eff.value === "number") {
              u.atk += eff.value;
              u.hp += eff.value;
              u.maxHp += eff.value;
            }
          }
          break;
        }
        default:
          break;
      }
    }
  }

  // src/engine.ts
  function startMatch(state, ctx) {
    const events = [];
    const next = cloneState(state);
    const rng = createRng(next.rngState);
    startTurn(next, ctx, events, rng);
    next.rngState = rng.getState();
    return { ok: true, state: next, events };
  }
  function applyAction(state, ctx, action) {
    if (state.winner) {
      return { ok: false, state, events: [{ type: "REJECTED", reason: "\u5BF9\u5C40\u5DF2\u7ED3\u675F", action }], error: "\u5BF9\u5C40\u5DF2\u7ED3\u675F" };
    }
    const events = [];
    const next = cloneState(state);
    const rng = createRng(next.rngState);
    let ok = true;
    let error;
    try {
      switch (action.type) {
        case "PLAY_CARD":
          ok = playCard(next, ctx, action, events, rng);
          break;
        case "ATTACK":
          ok = attack(next, ctx, action, events, rng);
          break;
        case "USE_LORD_SKILL":
          ok = useLordSkill(next, ctx, action, events, rng);
          break;
        case "USE_SKILL":
          ok = useUnitSkill(next, ctx, action, events, rng);
          break;
        case "END_TURN":
          endTurn(next, ctx, events, rng);
          break;
        default:
          ok = false;
      }
    } catch (e) {
      ok = false;
      error = e.message;
    }
    if (!ok) {
      error = error ?? "\u52A8\u4F5C\u4E0D\u5408\u6CD5";
      events.push({ type: "REJECTED", reason: error, action });
      return { ok: false, state, events, error };
    }
    next.rngState = rng.getState();
    return { ok: true, state: next, events };
  }
  function startTurn(state, ctx, events, rng) {
    state.turn += 1;
    const side = state.active;
    const s = state.sides[side];
    s.command.max = Math.min(COMMAND.MAX, s.command.max + 1);
    s.command.cur = s.command.max;
    s.lord.skillUsedThisTurn = false;
    for (const ref of allUnits(state, side)) ref.unit.attackedThisTurn = 0;
    events.push({ type: "TURN_START", side, turn: state.turn, command: { ...s.command } });
    drawCard(state, ctx.cards, side, events);
    resolveTurnStartStatuses(state, ctx.cards, side, events);
  }
  function endTurn(state, ctx, events, rng) {
    const side = state.active;
    resolveTurnEndStatuses(state, ctx.cards, side, events);
    const dropped = discardOverflow(state, side);
    dropped.forEach((c) => events.push({ type: "CARD_PLAYED", side, card: c }));
    events.push({ type: "TURN_END", side, turn: state.turn });
    if (state.turn >= MATCH.TURN_LIMIT) {
      const own = state.sides.own.lord.hp;
      const enemy = state.sides.enemy.lord.hp;
      state.winner = own === enemy ? "draw" : own > enemy ? "own" : "enemy";
      events.push({ type: "GAME_OVER", winner: state.winner });
      return;
    }
    state.active = other(side);
    startTurn(state, ctx, events, rng);
  }
  function playCard(state, ctx, action, events, rng) {
    const side = state.active;
    const s = state.sides[side];
    const card = s.hand[action.cardIndex];
    if (!card) return false;
    const isCharacter2 = ["troop", "general", "strategist"].includes(card.type);
    const slot = isCharacter2 ? { row: action.row, col: action.col } : void 0;
    const check = canPlayCard(state, side, card, slot);
    if (!check.ok) return false;
    s.command.cur -= card.cost;
    s.hand.splice(action.cardIndex, 1);
    events.push({ type: "CARD_PLAYED", side, card, row: slot?.row, col: slot?.col, handIndex: action.cardIndex });
    if (isCharacter2 && slot) {
      const u = makeUnit(card, state.turn, nextUidSeq(state));
      setUnit(state, side, slot.row, slot.col, u);
      events.push({ type: "UNIT_SUMMONED", side, row: slot.row, col: slot.col, unit: u });
      const onPlay = (card.skills ?? []).filter((sk) => sk.trigger === "on_play");
      for (const sk of onPlay) {
        runEffects(state, ctx.cards, sk.effects, { side, source: u, chosenRow: slot.row, chosenCol: slot.col }, rng, events);
      }
      if (card.effects?.length) {
        runEffects(state, ctx.cards, card.effects, { side, source: u }, rng, events);
      }
    } else {
      runEffects(state, ctx.cards, card.effects, { side }, rng, events);
      s.discard.push(card);
    }
    return true;
  }
  function attack(state, ctx, action, events, rng) {
    const side = state.active;
    const { from, to } = action;
    const attacker = getUnit(state, side, from.row, from.col);
    if (!attacker) return false;
    const legal = legalTargets(state, side, from.row, from.col);
    if (!legal.targets.length) return false;
    let target = legal.targets.find(
      (t) => t.kind === to.kind && (t.kind === "lord" || t.row === to.row && t.col === to.col)
    );
    if (statusStacks(attacker, "hun_luan") > 0) {
      target = legal.targets[rng.int(legal.targets.length)];
    }
    if (!target) return false;
    const dmg = effectiveAttack(state, side, from.row, from.col);
    const hasWuShuang = hasKeyword(attacker, "wu_shuang");
    const hasXianGong = hasKeyword(attacker, "xian_gong");
    const hasYinXue = hasKeyword(attacker, "yin_xue");
    const foe = other(side);
    events.push({ type: "ATTACK_DECLARED", side, from: { ...from }, to: target });
    if (target.kind === "lord") {
      const dealt = dealDamage(state, ctx.cards, lordRef(foe), dmg, events, attacker.name);
      if (hasYinXue) healTarget(state, lordRef(side), dealt, events);
    } else {
      const tRow = target.row;
      const tCol = target.col;
      const targetUnit = getUnit(state, foe, tRow, tCol);
      const retaliate = targetUnit?.atk ?? 0;
      const dealt = dealDamage(state, ctx.cards, unitRef(foe, tRow, tCol), dmg, events, attacker.name);
      const targetDied = !getUnit(state, foe, tRow, tCol);
      if (!targetDied && !hasWuShuang && !hasXianGong) {
        dealDamage(state, ctx.cards, unitRef(side, from.row, from.col), retaliate, events, targetUnit?.name ?? "\u53CD\u51FB");
      }
      if (hasYinXue) healTarget(state, lordRef(side), dealt, events);
    }
    attacker.attackedThisTurn += 1;
    if (hasKeyword(attacker, "qi_xi")) {
      attacker.kw = attacker.kw.filter((k) => k !== "qi_xi");
      delete attacker.statuses.qi_xi;
      events.push({ type: "STATUS_EXPIRED", side, row: from.row, col: from.col, status: "qi_xi" });
    }
    const still = getUnit(state, side, from.row, from.col);
    if (still && still.hp <= 0) {
      killUnit(state, ctx.cards, { side, row: from.row, col: from.col, unit: still }, events);
    }
    return true;
  }
  var LORD_SKILLS = {
    \u4EC1\u5FB7: (state, ctx, side, target, events) => {
      if (target) healTarget(state, target, 2, events);
    },
    \u53F7\u4EE4: (state, ctx, side, target, events) => {
      if (target?.kind === "unit") {
        const u = getUnit(state, target.side, target.row, target.col);
        if (u) {
          u.statuses.zhen_fen = (u.statuses.zhen_fen ?? 0) + 2;
          events.push({ type: "STATUS_APPLIED", side: target.side, row: target.row, col: target.col, status: "zhen_fen", stacks: 2 });
        }
      }
    },
    \u5750\u65AD\u4E1C\u5357: (state, ctx, side, _t, events) => {
      gainArmor(state, side, 2, events);
    },
    \u66B4\u8650: (state, ctx, side, _t, events) => {
      drawCard(state, ctx.cards, side, events);
      dealDamage(state, ctx.cards, lordRef(side), 1, events, "\u66B4\u8650");
    }
  };
  function useLordSkill(state, ctx, action, events, rng) {
    const side = state.active;
    const lord = state.sides[side].lord;
    if (lord.skillUsedThisTurn) return false;
    if (state.sides[side].command.cur < 1) return false;
    const target = action.target ? action.target.row !== void 0 ? unitRef(action.target.side, action.target.row, action.target.col) : lordRef(action.target.side) : void 0;
    const impl = lord.skillDef ? null : LORD_SKILLS[lord.skill];
    if (!impl && !lord.skillDef) return false;
    state.sides[side].command.cur -= 1;
    lord.skillUsedThisTurn = true;
    events.push({ type: "LORD_SKILL_USED", side, skill: lord.skill });
    if (lord.skillDef) {
      runEffects(state, ctx.cards, lord.skillDef.effects, { side, chosen: target }, rng, events);
    } else if (impl) {
      impl(state, ctx, side, target, events);
    }
    return true;
  }
  function useUnitSkill(state, ctx, action, events, rng) {
    const side = state.active;
    const u = getUnit(state, side, action.row, action.col);
    if (!u) return false;
    if (statusStacks(u, "zhen_she") > 0) return false;
    const skill = (u.skills ?? []).find((sk) => sk.kind === "active");
    if (!skill) return false;
    const cost = skill.cost ?? 0;
    if (state.sides[side].command.cur < cost) return false;
    state.sides[side].command.cur -= cost;
    const target = action.target ? action.target.row !== void 0 ? unitRef(action.target.side, action.target.row, action.target.col) : lordRef(action.target.side) : void 0;
    runEffects(state, ctx.cards, skill.effects, { side, source: u, chosen: target }, rng, events);
    return true;
  }

  // src/loader.ts
  function loadData(bundle, lordIds) {
    const cards = /* @__PURE__ */ new Map();
    const byFaction = /* @__PURE__ */ new Map();
    for (const c of bundle.cards) {
      cards.set(c.id, c);
      const list = byFaction.get(c.faction) ?? [];
      list.push(c);
      byFaction.set(c.faction, list);
    }
    for (const h of bundle.heroes) cards.set(h.id, h);
    const findLord = (id) => {
      const l = bundle.heroes.find((h) => h.id === id);
      if (!l) throw new Error(`\u627E\u4E0D\u5230\u4E3B\u516C\uFF1A${id}`);
      return l;
    };
    return {
      cards,
      lords: { own: findLord(lordIds.own), enemy: findLord(lordIds.enemy) },
      byFaction
    };
  }
  function autoDeck(data, faction, seed = 1) {
    const pool = (data.byFaction.get(faction) ?? []).filter((c) => c.type !== "elite");
    const neutral = data.byFaction.get("neutral") ?? [];
    const all = [...pool, ...neutral].filter((c) => c.type !== "elite" && c.cost <= 8);
    if (!all.length) throw new Error(`\u9635\u8425 ${faction} \u6CA1\u6709\u53EF\u7528\u5361\u724C`);
    const curve = { 1: 6, 2: 8, 3: 6, 4: 5, 5: 3, 6: 2 };
    const deck = [];
    const buckets = /* @__PURE__ */ new Map();
    for (const c of all) {
      const b = buckets.get(c.cost) ?? [];
      b.push(c);
      buckets.set(c.cost, b);
    }
    let i = 0;
    for (const [costStr, want] of Object.entries(curve)) {
      const cost = Number(costStr);
      const bucket = buckets.get(cost) ?? all;
      for (let k = 0; k < want; k++) {
        deck.push(bucket[i++ % bucket.length].id);
      }
    }
    while (deck.length < 30) deck.push(all[deck.length % all.length].id);
    return deck.slice(0, 30);
  }

  // src/ai.ts
  function chooseAction(state, ctx) {
    const side = state.active;
    const foe = other(side);
    const lordHp = state.sides[foe].lord.hp;
    const armor = state.sides[foe].lord.armor;
    for (const ref of allUnits(state, side)) {
      if (!canAttack(state, side, ref.row, ref.col).ok) continue;
      const res = legalTargets(state, side, ref.row, ref.col);
      const canHitLord = res.targets.some((t) => t.kind === "lord");
      if (canHitLord && effectiveAttack(state, side, ref.row, ref.col) >= lordHp + armor) {
        return { type: "ATTACK", from: { row: ref.row, col: ref.col }, to: { kind: "lord" } };
      }
    }
    for (const ref of allUnits(state, side)) {
      if (!canAttack(state, side, ref.row, ref.col).ok) continue;
      const res = legalTargets(state, side, ref.row, ref.col);
      if (res.targets.some((t) => t.kind === "lord")) {
        return { type: "ATTACK", from: { row: ref.row, col: ref.col }, to: { kind: "lord" } };
      }
    }
    let best = null;
    let bestScore = -Infinity;
    for (const ref of allUnits(state, side)) {
      if (!canAttack(state, side, ref.row, ref.col).ok) continue;
      const res = legalTargets(state, side, ref.row, ref.col);
      const dmg = effectiveAttack(state, side, ref.row, ref.col);
      for (const t of res.targets) {
        if (t.kind !== "unit") continue;
        const target = getUnit(state, foe, t.row, t.col);
        if (!target) continue;
        const score = (dmg >= target.hp ? 100 : 0) + (10 - target.hp) + target.atk * 0.1;
        if (score > bestScore) {
          bestScore = score;
          best = { type: "ATTACK", from: { row: ref.row, col: ref.col }, to: { kind: "unit", row: t.row, col: t.col } };
        }
      }
    }
    if (best) return best;
    for (const ref of allUnits(state, side)) {
      const u = ref.unit;
      const skill = (u.skills ?? []).find((sk) => sk.kind === "active");
      if (!skill) continue;
      if (state.sides[side].command.cur < (skill.cost ?? 0)) continue;
      const target = allUnits(state, foe).sort((a, b) => a.unit.hp - b.unit.hp)[0];
      if (target) {
        return { type: "USE_SKILL", row: ref.row, col: ref.col, target: { side: foe, row: target.row, col: target.col } };
      }
    }
    if (!state.sides[side].lord.skillUsedThisTurn && state.sides[side].command.cur >= 1) {
      const skill = state.sides[side].lord.skill;
      if (skill === "\u5750\u65AD\u4E1C\u5357") return { type: "USE_LORD_SKILL" };
      if (skill === "\u4EC1\u5FB7") {
        const wounded = allUnits(state, side).filter((r) => r.unit.hp < r.unit.maxHp).sort((a, b) => a.unit.hp - a.unit.maxHp - (b.unit.hp - b.unit.maxHp))[0];
        if (wounded) return { type: "USE_LORD_SKILL", target: { side, row: wounded.row, col: wounded.col } };
      }
      if (skill === "\u53F7\u4EE4") {
        const attacker = allUnits(state, side).filter((r) => canAttack(state, side, r.row, r.col).ok).sort((a, b) => b.unit.atk - a.unit.atk)[0];
        if (attacker) return { type: "USE_LORD_SKILL", target: { side, row: attacker.row, col: attacker.col } };
      }
    }
    const playable = state.sides[side].hand.map((c, i) => ({ c, i })).filter(({ c }) => canPlayCard(state, side, c, { row: "front", col: 0 }).ok || !isCharacter(c)).sort((a, b) => b.c.cost - a.c.cost);
    for (const { c, i } of playable) {
      if (!isCharacter(c)) return { type: "PLAY_CARD", cardIndex: i };
      const spots = legalPlacements(state, side);
      if (!spots.length) continue;
      const wantBack = c.type === "strategist";
      const slot = spots.find((s) => wantBack ? s.row === "back" : s.row === "front") ?? spots[0];
      return { type: "PLAY_CARD", cardIndex: i, row: slot.row, col: slot.col };
    }
    return null;
  }
  var isCharacter = (c) => ["troop", "general", "strategist"].includes(c.type);
  function takeTurn(state, ctx, apply, maxActions = 40) {
    let cur = state;
    const actions = [];
    for (let i = 0; i < maxActions; i++) {
      if (cur.winner) break;
      const action = chooseAction(cur, ctx);
      if (!action) break;
      const res = apply(cur, ctx, action);
      if (!res.ok) break;
      cur = res.state;
      actions.push(action);
    }
    const end = apply(cur, ctx, { type: "END_TURN" });
    return { state: end.ok ? end.state : cur, actions };
  }

  // src/index.ts
  function newMatch(opts) {
    const state = createMatch(opts);
    const ctx = { cards: opts.cards, lords: opts.lords };
    const started = startMatch(state, ctx);
    return { state: started.state, ctx, events: started.events };
  }
  return __toCommonJS(index_exports);
})();
