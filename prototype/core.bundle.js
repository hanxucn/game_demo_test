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
    LORD_SKILL_COST: () => LORD_SKILL_COST,
    MATCH: () => MATCH,
    MAX_COPIES: () => MAX_COPIES,
    NON_DECK_TYPES: () => NON_DECK_TYPES,
    PLAYABLE_FACTIONS: () => PLAYABLE_FACTIONS,
    PUBLIC_POOL: () => PUBLIC_POOL,
    RETIRED_KEYWORDS: () => RETIRED_KEYWORDS,
    STATUSES: () => STATUSES,
    SUGGESTED_CURVE: () => SUGGESTED_CURVE,
    TAGS: () => TAGS,
    TIMING: () => TIMING,
    activeStatuses: () => activeStatuses,
    allUnits: () => allUnits,
    applyAction: () => applyAction,
    applyMods: () => applyMods,
    applyStatus: () => applyStatus,
    autoDeck: () => autoDeck,
    canAttack: () => canAttack,
    canPlayCard: () => canPlayCard,
    canUseUnitSkill: () => canUseUnitSkill,
    capStacks: () => capStacks,
    cardPool: () => cardPool,
    checkWinner: () => checkWinner,
    chooseAction: () => chooseAction,
    cloneState: () => cloneState,
    collectDamaged: () => collectDamaged,
    createMatch: () => createMatch,
    createRng: () => createRng,
    dealDamage: () => dealDamage,
    discardOverflow: () => discardOverflow,
    drawCard: () => drawCard,
    effectiveAttack: () => effectiveAttack,
    effectiveCost: () => effectiveCost,
    expireHandMods: () => expireHandMods,
    expireMods: () => expireMods,
    expireStatuses: () => expireStatuses,
    findByUid: () => findByUid,
    findGuard: () => findGuard,
    formatSummary: () => formatSummary,
    gainArmor: () => gainArmor,
    getUnit: () => getUnit,
    handLimit: () => handLimit,
    handOverflow: () => handOverflow,
    handRef: () => handRef,
    hasCap: () => hasCap,
    hasCapOn: () => hasCapOn,
    hasKeyword: () => hasKeyword,
    hashSeed: () => hashSeed,
    healTarget: () => healTarget,
    isBanned: () => isBanned,
    isDeckable: () => isDeckable,
    isMelee: () => isMelee,
    isPlayableBy: () => isPlayableBy,
    killUnit: () => killUnit,
    legalPlacements: () => legalPlacements,
    legalTargets: () => legalTargets,
    loadData: () => loadData,
    lordAlive: () => lordAlive,
    lordRef: () => lordRef,
    lordStatusStacks: () => lordStatusStacks,
    makeUnit: () => makeUnit,
    mulligan: () => mulligan,
    newMatch: () => newMatch,
    nextUidSeq: () => nextUidSeq,
    openColumns: () => openColumns,
    other: () => other,
    refAlive: () => refAlive,
    refHp: () => refHp,
    registerOnDeathResolver: () => registerOnDeathResolver,
    registerOnDrawResolver: () => registerOnDrawResolver,
    resolveTargets: () => resolveTargets,
    resolveTurnEndStatuses: () => resolveTurnEndStatuses,
    resolveTurnStartStatuses: () => resolveTurnStartStatuses,
    rollFirstSide: () => rollFirstSide,
    runEffects: () => runEffects,
    setLastDiscarded: () => setLastDiscarded,
    setUnit: () => setUnit,
    setupMatch: () => setupMatch,
    shieldUnits: () => shieldUnits,
    startHandSize: () => startHandSize,
    startMatch: () => startMatch,
    statusStacks: () => statusStacks,
    statusTurns: () => statusTurns,
    summarizeMatch: () => summarizeMatch,
    summonUnit: () => summonUnit,
    takeTurn: () => takeTurn,
    unitCount: () => unitCount,
    unitRef: () => unitRef,
    validateDeck: () => validateDeck
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
    COLS: 8,
    ROWS: ["front"],
    MAX_UNITS: 8
  };
  var LORD_HP = 30;
  var COMMAND = { START: 1, MAX: 10 };
  var LORD_SKILL_COST = 2;
  var DECK = {
    SIZE: 30,
    HAND_START_FIRST: 3,
    HAND_START_SECOND: 4,
    HAND_LIMIT: 10,
    DRAW_PER_TURN: 1
  };
  var MATCH = { TURN_LIMIT: Infinity };
  var KEYWORDS = {
    jia_dun: {
      name: "\u67B6\u76FE",
      implemented: true,
      note: "\u5632\u8BBD\uFF1A\u654C\u65B9\u666E\u901A\u653B\u51FB\u5FC5\u987B\u5148\u6253\u5B83\uFF08ADR-051\uFF09"
    },
    xian_gong: {
      name: "\u5148\u653B",
      implemented: true,
      note: "\u5165\u573A\u5F53\u56DE\u5408\u5373\u53EF\u884C\u52A8\u653B\u51FB\uFF08ADR-055 \u8BBE\u8BA1\u8005\u6F84\u6E05\uFF1A\u8FD9\u5C31\u662F\u5B83\u7684\u5168\u90E8\u542B\u4E49\uFF0C\u4E0E\u300C\u75BE\u884C\u300D\u662F\u540C\u4E00\u4E2A\uFF09"
    },
    lian_ji: {
      name: "\u8FDE\u51FB",
      implemented: true,
      note: "\u5F53\u524D\u56DE\u5408\u666E\u901A\u653B\u51FB\u53EF\u6267\u884C 2 \u6B21"
    },
    yi_ji: {
      name: "\u9057\u8BA1",
      implemented: true,
      note: "\u7C7B\u4EA1\u8BED\uFF1A\u9635\u4EA1\u65F6\u89E6\u53D1\u8BE5\u5361\u5B9A\u4E49\u7684 on_death \u903B\u8F91"
    },
    yin_xue: {
      name: "\u996E\u8840",
      implemented: false,
      note: "\u5BF9\u654C\u4EBA\u9020\u6210\u7684\u4F24\u5BB3\uFF0C\u4E3A\u81EA\u5DF1\u6062\u590D\u4E00\u5B9A\u6570\u91CF\u751F\u547D\uFF08\u5F85\u5B9E\u73B0\uFF09"
    },
    wu_sheng: {
      name: "\u6B66\u5723",
      implemented: false,
      note: '\u26A0\uFE0F \u5B9A\u4E49\u672A\u7ECF\u786E\u8BA4\uFF1A\u624B\u5199\u7A3F\u91CC\u300C\u6B66\u5723\u300D\u53EA\u4F5C\u4E3A\u5173\u7FBD\u7684\u4E24\u4E2A\u5019\u9009\u6280\u80FD\u540D\u4E4B\u4E00\u51FA\u73B0\uFF0C\u5E76\u672A\u5B9A\u4E49\u673A\u5236\uFF1B"\u514D\u75AB\u4E00\u6B21\u4F24\u5BB3"\u662F\u521D\u59CB\u63D0\u4EA4 GDD \u91CC AI \u5199\u7684\uFF08\u5F85\u8BBE\u8BA1\u8005\u5B9A\u4E49\uFF0CQ-06-4\uFF09'
    },
    shen_she: {
      name: "\u795E\u5C04",
      implemented: false,
      note: "\u5BF9\u968F\u673A\u654C\u4EBA\u9020\u6210\u8FDC\u7A0B\u4F24\u5BB3\uFF0C\u4E14\u4E0D\u53D7\u5BF9\u65B9\u653B\u51FB\u5F71\u54CD\uFF08\u5F85\u5B9E\u73B0\uFF09"
    },
    qi_xi: {
      name: "\u5947\u88AD",
      implemented: false,
      note: "\u4E0A\u573A\u5148\u9690\u8EAB\uFF08\u4E0D\u80FD\u88AB\u9009\u5B9A\uFF09\uFF1B\u4E0B\u56DE\u5408\u53EF\u9009\u62E9\u884C\u52A8\u653B\u51FB\uFF0C\u6267\u884C\u8FC7\u884C\u52A8\u540E\u9690\u8EAB\u6D88\u5931\uFF08\u5F85\u5B9E\u73B0\uFF09"
    },
    zhong_yi: {
      name: "\u5FE0\u4E49",
      implemented: false,
      note: '\u514D\u75AB\u6DF7\u4E71\u3001\u79BB\u95F4\u7B49\u72B6\u6001\uFF08\u5F85\u5B9E\u73B0\u3002\u6CE8\uFF1A\u539F\u5B9E\u73B0\u8BEF\u505A\u6210"\u9635\u4EA1\u89E6\u53D1\u4EA1\u8BED"\uFF0C\u5DF2\u7EA0\u6B63\uFF09'
    },
    jie_zhen: {
      name: "\u7ED3\u9635",
      implemented: false,
      note: '\u26A0\uFE0F \u8BBE\u8BA1\u8005\u5C1A\u672A\u8BBE\u8BA1\u5177\u4F53\u673A\u5236\uFF0C\u5148\u4FDD\u7559\u540D\u5B57\uFF08\u5F53\u524D\u5F15\u64CE\u91CC\u7684"\u76F8\u90BB\u6B65\u5175+1\u653B"\u662F AI \u65E7\u63A8\u5B9A\uFF0C\u4E0D\u53EF\u7528\uFF09'
    }
  };
  var RETIRED_KEYWORDS = {
    ji_xing: "\u75BE\u884C \u2014\u2014 \u4E0E\u300C\u5148\u653B\u300D\u662F\u540C\u4E00\u4E2A\u4E1C\u897F\uFF08\u8BBE\u8BA1\u8005\u88C1\u5B9A\uFF09\uFF0C\u5DF2\u5408\u5E76\uFF0C\u8BF7\u6539\u7528 xian_gong",
    wu_shuang: "\u65E0\u53CC \u2014\u2014 \u8BBE\u8BA1\u8005\uFF1A\u6682\u65F6\u6CA1\u6709\u8FD9\u4E2A\u72B6\u6001"
  };
  var TAGS = {
    xi_liang: { name: "\u897F\u51C9", note: "\u897F\u51C9\u51FA\u8EAB\uFF1A\u9A6C\u817E\u3001\u9A6C\u8D85\u3001\u9A6C\u5CB1" },
    man_zu: { name: "\u86EE\u65CF", note: "\u5357\u65B9\u5F02\u65CF\uFF1A\u6C99\u6469\u67EF" },
    huang_jin: { name: "\u9EC4\u5DFE", note: "\u9EC4\u5DFE\u519B\u51FA\u8EAB\u6216\u5176\u65E7\u90E8" },
    shi_zu: { name: "\u58EB\u65CF", note: "\u58EB\u65CF\u95E8\u9600\uFF1A\u8881\u7ECD\u53CA\u5176\u58EB\u65CF\u5175" }
  };
  var FORBIDDEN_KEYWORD_COMBOS = [
    ["jia_dun", "qi_xi"]
  ];
  var STATUSES = {
    zhen_fen: { name: "\u632F\u594B", kind: "buff", numeric: true, duration: "permanent", note: "\u653B\u51FB +N" },
    ji_jiu: { name: "\u6025\u6551", kind: "buff", numeric: true, duration: "permanent", note: "\u56DE\u5408\u5F00\u59CB\u6062\u590D N \u70B9\u751F\u547D" },
    jia_dun_status: { name: "\u67B6\u76FE", kind: "buff", numeric: false, duration: "conditional", note: "\u5632\u8BBD\uFF08ADR-051\uFF09" },
    xian_gong_status: {
      name: "\u5148\u653B",
      kind: "buff",
      numeric: false,
      duration: "permanent",
      note: "\u5165\u573A\u5F53\u56DE\u5408\u5373\u53EF\u884C\u52A8\u653B\u51FB\uFF08ADR-055\uFF09"
    },
    qi_xi_status: { name: "\u5947\u88AD", kind: "buff", numeric: false, duration: "until_consumed", note: "\u4E0D\u80FD\u88AB\u6307\u5B9A\u4E3A\u76EE\u6807" },
    wu_sheng_status: {
      name: "\u6B66\u5723",
      kind: "buff",
      numeric: false,
      duration: "until_consumed",
      caps: ["immune_damage"],
      note: "\u514D\u75AB\u4E00\u6B21\u4F24\u5BB3"
    },
    hu_jia: { name: "\u62A4\u7532", kind: "buff", numeric: true, duration: "permanent", scope: "lord", note: "\u5438\u6536\u4F24\u5BB3" },
    zhen_she: {
      name: "\u9707\u6151",
      kind: "debuff",
      numeric: false,
      duration: "turns",
      caps: ["block_action"],
      note: "\u4E0D\u80FD\u666E\u653B\uFF0C\u4E5F\u4E0D\u80FD\u4F7F\u7528\u4E3B\u52A8\u6280"
    },
    hun_luan: {
      name: "\u6DF7\u4E71",
      kind: "debuff",
      numeric: false,
      duration: "turns",
      caps: ["random_target"],
      note: "\u666E\u653B\u4E0E\u4E3B\u52A8\u6280\u7684\u76EE\u6807\u5728**\u5168\u573A**\u4E2D\u968F\u673A\uFF08\u4E0D\u5206\u654C\u6211\uFF09"
    },
    zhen_wang: {
      name: "\u9635\u4EA1\u6807\u8BB0",
      kind: "debuff",
      numeric: false,
      duration: "permanent",
      note: "\u88AB\u6807\u8BB0\uFF1A\u9635\u4EA1\u65F6\u4E3A\u6807\u8BB0\u8005\u89E6\u53D1\u6548\u679C"
    },
    duan_chou: {
      name: "\u65AD\u62BD",
      kind: "debuff",
      numeric: false,
      duration: "turns",
      caps: ["block_draw"],
      note: "\u8BE5\u65B9\u672C\u56DE\u5408\u4E0D\u80FD\u62BD\u724C"
    },
    jue_dou: {
      name: "\u51B3\u6597",
      kind: "debuff",
      numeric: false,
      duration: "turns",
      caps: ["duel_lock"],
      note: "\u5355\u6311\u4E2D\uFF1A\u7B2C\u4E09\u65B9\u65E0\u6CD5\u5BF9\u5176\u51FA\u624B"
    },
    chou_di: {
      name: "\u4EC7\u654C",
      kind: "debuff",
      numeric: false,
      duration: "permanent",
      caps: ["mark_damage"],
      note: "\u88AB\u6CD5\u6B63\u6807\u8BB0\uFF1A\u53D7\u5230\u4F24\u5BB3\u65F6\u4E3A\u5176\u6307\u5B9A\u53CB\u65B9\u56DE\u8840"
    },
    jin_yan: {
      name: "\u8FDB\u8A00",
      kind: "debuff",
      numeric: false,
      duration: "turns",
      caps: ["block_lord_skill"],
      note: "\u8BE5\u65B9\u4E3B\u5E05\u4E0D\u80FD\u4F7F\u7528\u4E3B\u516C\u6280"
    },
    can_mou: {
      name: "\u53C2\u8C0B",
      kind: "buff",
      numeric: true,
      duration: "permanent",
      scope: "lord",
      caps: ["extra_lord_skill"],
      note: "\u8BE5\u65B9\u4E3B\u5E05\u6BCF\u56DE\u5408\u4E3B\u516C\u6280\u6B21\u6570 +N"
    },
    shou_hu: {
      name: "\u5B88\u62A4",
      kind: "buff",
      numeric: false,
      duration: "turns",
      caps: ["redirect_damage"],
      note: "\u53D7\u5230\u7684\u4F24\u5BB3\u8F6C\u7531\u5B88\u62A4\u8005\u627F\u53D7\uFF08\u63F4\u62A4/\u5206\u62C5/\u62A4\u9A7E\u5171\u7528\uFF09"
    },
    jin_yong: {
      name: "\u7981\u7528",
      kind: "debuff",
      numeric: false,
      duration: "turns",
      caps: ["block_skill"],
      note: "\u4E0D\u80FD\u4F7F\u7528\u4E3B\u52A8\u6280\u4E0E\u89E6\u53D1\u6280\uFF08silence\uFF09"
    },
    mian_yi: {
      name: "\u514D\u75AB",
      kind: "buff",
      numeric: false,
      duration: "turns",
      caps: ["immune_debuff", "untargetable"],
      note: "\u514D\u75AB\u8D1F\u9762\u72B6\u6001\uFF0C\u4E14\u4E0D\u80FD\u88AB\u6307\u5B9A\u4E3A\u76EE\u6807"
    },
    fan_mian: {
      name: "\u7FFB\u9762",
      kind: "debuff",
      numeric: false,
      duration: "conditional",
      caps: ["block_action", "untargetable"],
      note: "\u7FFB\u9762\u671F\u95F4\u65E0\u6CD5\u884C\u52A8\u4E5F\u4E0D\u80FD\u88AB\u9009\u4E2D\uFF0C\u9700\u7279\u5B9A\u6761\u4EF6\u7FFB\u56DE\u6B63\u9762\uFF0C\u4E0B\u56DE\u5408\u624D\u80FD\u884C\u52A8"
    },
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
    ON_DEFEND: "on_defend",
    ON_LETHAL: "on_lethal",
    ON_CARD_PLAYED: "on_card_played",
    ON_MARK_DAMAGED: "on_mark_damaged",
    ON_MARK_DEATH: "on_mark_death"
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
    "random_pick",
    "discard",
    "return_to_hand",
    "clash",
    "flip",
    "scry",
    "ban_play",
    "steal_card",
    "survive",
    "extra_attack",
    "take_control",
    "copy_skill",
    "force_attack",
    "add_to_deck",
    // 往牌库随机位置塞 N 张指定卡（ADR-050）
    "send_to_deck",
    // 把牌库里剩下的指定牌全塞给对方（ADR-050）
    "cycle_to_deck"
    // 手牌放回牌库随机位置再抽 1 张（ADR-050）
  ];
  var CARD_TYPES = [
    "troop",
    "general",
    "strategist",
    "event",
    "tactic",
    "elite",
    "special",
    "lord",
    // 主将卡：开局置于主将位，不进卡组（ADR-044）
    "token",
    // 衍生物：只能由效果召唤，不可组入卡组（ADR-044）
    "status"
    // 状态卡：持续性全局效果，置于状态区（ADR-044）
  ];
  var NON_DECK_TYPES = ["elite", "lord", "token", "status", "special"];

  // src/state.ts
  function rollFirstSide(rng) {
    for (let i = 0; i < 100; i++) {
      const own = rng.int(6) + 1;
      const enemy = rng.int(6) + 1;
      if (own !== enemy) return { side: own > enemy ? "own" : "enemy", own, enemy };
    }
    return { side: "own", own: 6, enemy: 1 };
  }
  function createMatch(opts) {
    const {
      seed = 1,
      lords,
      decks,
      cards,
      secondCompensation = "extra_draw"
    } = opts;
    const rng = createRng(seed);
    const firstSide = opts.rollFirst ? rollFirstSide(rng).side : opts.firstSide ?? "own";
    const makeSide = (side) => {
      const lordCard = lords[side];
      const deck = rng.shuffle([...decks[side]]);
      const handSize = side === firstSide ? DECK.HAND_START_FIRST : DECK.HAND_START_SECOND;
      const hand = [];
      for (let i = 0; i < handSize && deck.length; i++) {
        const id = deck.pop();
        const c = cards.get(id);
        if (c) hand.push({ card: c, mods: [] });
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
          // ADR-051：仅 front 一排参与游戏（8 格）；back 保留为空壳以免大改
          front: new Array(BOARD.COLS).fill(null),
          back: new Array(BOARD.COLS).fill(null)
        },
        hand,
        deck,
        discard: [],
        command: { cur: COMMAND.START, max: COMMAND.START },
        fatigue: 0,
        mulliganDone: false
      };
    };
    return {
      seed,
      uidSeq: 0,
      rngState: rng.getState(),
      turn: 0,
      active: firstSide,
      secondCompensation,
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
  var statusStacks = (u, id) => u?.statuses[id]?.stacks ?? 0;
  var lordStatusStacks = (l, id) => l?.statuses?.[id]?.stacks ?? 0;
  var statusTurns = (u, id) => u?.statuses[id]?.turns;
  function hasCap(u, cap) {
    if (!u) return false;
    return hasCapOn(u.statuses, cap);
  }
  function hasCapOn(statuses, cap) {
    for (const [id, inst] of Object.entries(statuses ?? {})) {
      if (inst.stacks <= 0) continue;
      if (STATUSES[id]?.caps?.includes(cap)) return true;
    }
    return false;
  }
  function capStacks(statuses, cap) {
    let n = 0;
    for (const [id, inst] of Object.entries(statuses ?? {})) {
      if (inst.stacks > 0 && STATUSES[id]?.caps?.includes(cap)) n += inst.stacks;
    }
    return n;
  }
  var activeStatuses = (u) => Object.entries(u?.statuses ?? {}).filter(([, v]) => v.stacks > 0).map(([k]) => k);
  var shieldUnits = (s, side) => allUnits(s, side).filter(({ unit }) => hasKeyword(unit, "jia_dun") && unit.hp > 0);
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
      baseAtk: card.attack ?? 0,
      baseMaxHp: card.health ?? 1,
      mods: [],
      atk: card.attack ?? 0,
      hp: card.health ?? 1,
      maxHp: card.health ?? 1,
      troopKind: card.troopKind,
      kw: [...card.keywords ?? []],
      tags: [...card.tags ?? []],
      statuses: {},
      skills: card.skills ? structuredClone(card.skills) : void 0,
      attackedThisTurn: 0,
      enteredTurn: turn,
      skillUsesThisTurn: {},
      skillsUsedOnce: []
    };
  }
  function applyMods(u) {
    const dAtk = u.mods.reduce((s, m) => s + (m.attack ?? 0), 0);
    const dHp = u.mods.reduce((s, m) => s + (m.health ?? 0), 0);
    const newMax = Math.max(1, u.baseMaxHp + dHp);
    const delta = newMax - u.maxHp;
    u.atk = Math.max(0, u.baseAtk + dAtk);
    u.maxHp = newMax;
    if (u.hp > 0) u.hp = Math.max(1, Math.min(newMax, u.hp + delta));
  }
  function nextUidSeq(state) {
    state.uidSeq += 1;
    return state.uidSeq;
  }

  // src/rules.ts
  var isMelee = (u) => u.type !== "strategist" && !hasKeyword(u, "shen_she");
  function canUseUnitSkill(state, side, row, col) {
    const u = getUnit(state, side, row, col);
    if (!u) return { ok: false, reason: "\u8BE5\u683C\u6CA1\u6709\u5355\u4F4D" };
    if (hasCap(u, "block_action") || hasCap(u, "block_skill")) return { ok: false, reason: "\u88AB\u7981\u7528\u6280\u80FD" };
    const skill = (u.skills ?? []).find((sk) => sk.kind === "active");
    if (!skill) return { ok: false, reason: "\u6CA1\u6709\u4E3B\u52A8\u6280" };
    const key = skill.id || skill.name || "0";
    const freq = skill.frequency ?? "once_per_turn";
    if (freq === "once" && u.skillsUsedOnce.includes(key)) return { ok: false, reason: "\u672C\u5C40\u5DF2\u7528\u8FC7" };
    if (freq === "once_per_turn" && (u.skillUsesThisTurn[key] ?? 0) >= 1) {
      return { ok: false, reason: "\u672C\u56DE\u5408\u5DF2\u7528\u8FC7" };
    }
    if (state.sides[side].command.cur < (skill.cost ?? 0)) return { ok: false, reason: "\u7EDF\u7387\u503C\u4E0D\u8DB3" };
    return { ok: true, skill };
  }
  function canAttack(state, side, row, col) {
    const u = getUnit(state, side, row, col);
    if (!u) return { ok: false, reason: "\u8BE5\u683C\u6CA1\u6709\u4EBA\u7269\u5361" };
    if (hasCap(u, "block_action") || hasCap(u, "block_attack")) {
      return { ok: false, reason: "\u5F53\u524D\u72B6\u6001\u65E0\u6CD5\u666E\u901A\u653B\u51FB" };
    }
    const maxAttacks = hasKeyword(u, "lian_ji") ? 2 : 1;
    if (u.attackedThisTurn >= maxAttacks) {
      return { ok: false, reason: `\u672C\u56DE\u5408\u5DF2\u653B\u51FB ${u.attackedThisTurn} \u6B21` };
    }
    if (u.enteredTurn === state.turn && !hasKeyword(u, "xian_gong")) {
      return { ok: false, reason: "\u672C\u56DE\u5408\u5165\u573A\uFF0C\u65E0\u6CD5\u653B\u51FB\uFF08\u300C\u5148\u653B\u300D\u9664\u5916\uFF09" };
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
    const gate = canAttack(state, side, row, col);
    if (!gate.ok) return { targets: [], why: gate.reason };
    const foe = other(side);
    const shields = shieldUnits(state, foe);
    if (shields.length) {
      return {
        targets: shields.map((sh) => ({ kind: "unit", side: foe, row: sh.row, col: sh.col })),
        why: `\u654C\u65B9\u5B58\u5728\u300C\u67B6\u76FE\u300D${shields.map((sh) => `\u7B2C${sh.col + 1}\u683C`).join("\u3001")} \u2192 \u5FC5\u987B\u5148\u653B\u51FB\u5B83\uFF08\u5632\u8BBD\uFF09`
      };
    }
    const targets = allUnits(state, foe).filter(({ unit }) => unit.hp > 0 && !hasCap(unit, "untargetable") && !hasKeyword(unit, "qi_xi")).map(({ row: r, col: c }) => ({ kind: "unit", side: foe, row: r, col: c }));
    targets.push({ kind: "lord", side: foe });
    return {
      targets,
      why: "\u65E0\u654C\u65B9\u67B6\u76FE \u2192 \u53EF\u81EA\u7531\u9009\u62E9\u4EFB\u610F\u654C\u65B9\u4EBA\u7269\uFF0C\u6216\u76F4\u63A5\u653B\u51FB\u654C\u65B9\u4E3B\u5C06"
    };
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
  function canPlayCard(state, side, card, slot, costOverride) {
    const s = state.sides[side];
    const cost = costOverride ?? card.cost ?? 0;
    if (cost > s.command.cur) {
      return { ok: false, reason: `\u7EDF\u7387\u503C\u4E0D\u8DB3\uFF08\u9700\u8981 ${cost}\uFF0C\u5F53\u524D ${s.command.cur}\uFF09` };
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
  var handRef = (side, index) => ({ kind: "hand", side, index });
  function effectiveCost(hc, ruleDelta = 0) {
    const delta = hc.mods.filter((m) => m.kind === "cost").reduce((s, m) => s + (m.value ?? 0), 0);
    return Math.max(0, (hc.card.cost ?? 0) + ruleDelta + delta);
  }
  var isBanned = (hc) => hc.mods.some((m) => m.kind === "ban");
  function findGuard(state, u) {
    for (const [id, inst] of Object.entries(u.statuses)) {
      if (inst.stacks <= 0 || !inst.srcUid) continue;
      if (!STATUSES[id]?.caps?.includes("redirect_damage")) continue;
      for (const side of ["own", "enemy"]) {
        for (const row of ["front", "back"]) {
          for (let col = 0; col < BOARD.COLS; col++) {
            const g = state.sides[side].rows[row][col];
            if (g && g.uid === inst.srcUid && g.uid !== u.uid && g.hp > 0) {
              return { side, row, col, unit: g };
            }
          }
        }
      }
    }
    return null;
  }
  function refHp(state, ref) {
    if (ref.kind === "lord") return state.sides[ref.side].lord.hp;
    if (ref.kind === "hand") return 0;
    return getUnit(state, ref.side, ref.row, ref.col)?.hp ?? 0;
  }
  function refAlive(state, ref) {
    if (ref.kind === "lord") return state.sides[ref.side].lord.hp > 0;
    if (ref.kind === "hand") return false;
    const u = getUnit(state, ref.side, ref.row, ref.col);
    return !!u && u.hp > 0;
  }
  var onDrawResolver = null;
  function registerOnDrawResolver(fn) {
    onDrawResolver = fn;
  }
  var onDeathResolver = null;
  function registerOnDeathResolver(fn) {
    onDeathResolver = fn;
  }
  function drawCard(state, cards, side, events, rng) {
    const s = state.sides[side];
    if (s.deck.length === 0) {
      s.fatigue += 1;
      events.push({ type: "FATIGUE", side, amount: s.fatigue, hp: Math.max(0, s.lord.hp - s.fatigue) });
      dealDamage(state, cards, lordRef(side), s.fatigue, events, "fatigue");
      return;
    }
    if (hasCapOn(state.sides[side].lord.statuses, "block_draw")) {
      events.push({ type: "DRAW_BLOCKED", side });
      return;
    }
    const id = s.deck.pop();
    const card = cards.get(id);
    if (!card) return;
    events.push({ type: "CARD_DRAWN", side, card, deckLeft: s.deck.length });
    if (onDrawResolver) {
      const r = rng ?? createRng(state.rngState);
      if (onDrawResolver(state, cards, side, card, events, r)) {
        s.discard.push(card);
        events.push({ type: "CARD_AUTO_CAST", side, card });
        return;
      }
    }
    s.hand.push({ card, mods: [] });
  }
  function dealDamage(state, cards, ref, amount, events, source, depth = 0) {
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
    if (ref.kind !== "unit") return 0;
    const u = getUnit(state, ref.side, ref.row, ref.col);
    if (!u) return 0;
    const guard = findGuard(state, u);
    if (guard && depth < 3) {
      events.push({
        type: "DAMAGE_REDIRECTED",
        side: ref.side,
        row: ref.row,
        col: ref.col,
        to: guard.side,
        guardName: guard.unit.name
      });
      return dealDamage(
        state,
        cards,
        unitRef(guard.side, guard.row, guard.col),
        amount,
        events,
        source,
        depth + 1
      );
    }
    if (hasCap(u, "immune_damage")) {
      const id = Object.keys(u.statuses).find((k) => STATUSES[k]?.caps?.includes("immune_damage"));
      delete u.statuses[id];
      u.kw = u.kw.filter((k) => k !== id);
      events.push({ type: "STATUS_EXPIRED", side: ref.side, row: ref.row, col: ref.col, status: id });
      return 0;
    }
    u.hp -= amount;
    events.push({ type: "DAMAGE", target: ref, amount, source });
    if (u.hp <= 0 && tryLethalSave(state, u, ref, events)) return amount;
    if (u.hp <= 0) killUnit(state, cards, { side: ref.side, row: ref.row, col: ref.col, unit: u }, events);
    return amount;
  }
  function tryLethalSave(state, u, ref, events) {
    const saves = (u.skills ?? []).filter((sk) => sk.trigger === "on_lethal");
    if (!saves.length) return false;
    const usedOnce = u.lethalUsed;
    const rng = createRng(state.rngState);
    for (const sk of saves) {
      if (sk.frequency === "once" && usedOnce) continue;
      const chance = sk.chance ?? 1;
      const roll = rng.next();
      if (roll < chance) {
        state.rngState = rng.getState();
        u.hp = 1;
        u.lethalUsed = true;
        events.push({ type: "UNIT_SURVIVED", side: ref.side, row: ref.row, col: ref.col, unit: u });
        return true;
      }
    }
    state.rngState = rng.getState();
    return false;
  }
  function collectDamaged(state, side, uid) {
    for (const ref of allUnits(state, side)) if (ref.unit.uid === uid) return ref;
    return null;
  }
  function healTarget(state, ref, amount, events) {
    if (amount <= 0 || !refAlive(state, ref)) return;
    if (ref.kind === "lord") {
      const lord = state.sides[ref.side].lord;
      lord.hp = Math.min(lord.maxHp, lord.hp + amount);
      events.push({ type: "HEAL", target: ref, amount, hp: lord.hp });
      return;
    }
    if (ref.kind !== "unit") return;
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
  function applyStatus(state, ref, status, stacks, events, turns, srcUid, auraId) {
    if (ref.kind === "hand") return;
    const def = STATUSES[status];
    if (ref.kind === "lord") {
      const lord = state.sides[ref.side].lord;
      lord.statuses = lord.statuses ?? {};
      if (def?.kind === "debuff" && hasCapOn(lord.statuses, "immune_debuff")) return;
      const prevL = lord.statuses[status];
      const numericL = def?.numeric ?? true;
      const turnsL = turns !== void 0 ? turns : def?.duration === "permanent" || def?.duration === "until_consumed" ? void 0 : def?.duration === "turns" || def?.duration === "this_turn" ? 1 : void 0;
      lord.statuses[status] = {
        stacks: numericL ? (prevL?.stacks ?? 0) + stacks : Math.max(1, stacks),
        turns: turnsL,
        srcUid,
        auraId
      };
      events.push({ type: "STATUS_APPLIED", side: ref.side, status, stacks, turns: turnsL });
      return;
    }
    const u = getUnit(state, ref.side, ref.row, ref.col);
    if (!u) return;
    if (def?.kind === "debuff" && hasCap(u, "immune_debuff")) {
      events.push({ type: "STATUS_BLOCKED", side: ref.side, row: ref.row, col: ref.col, status, reason: "\u514D\u75AB" });
      return;
    }
    const numeric = def?.numeric ?? true;
    const prev = u.statuses[status];
    const nextStacks = numeric ? (prev?.stacks ?? 0) + stacks : Math.max(1, stacks);
    const nextTurns = turns !== void 0 ? turns : prev?.turns !== void 0 ? Math.max(prev.turns, 1) : def?.duration === "permanent" || def?.duration === "until_consumed" ? void 0 : def?.duration === "turns" || def?.duration === "this_turn" ? 1 : void 0;
    u.statuses[status] = { stacks: nextStacks, turns: nextTurns, srcUid, auraId };
    events.push({ type: "STATUS_APPLIED", side: ref.side, row: ref.row, col: ref.col, status, stacks, turns: nextTurns });
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
    if (deathSkills.length && onDeathResolver) {
      onDeathResolver(state, cards, side, unit, deathSkills, events, createRng(state.rngState));
    }
  }
  function checkWinner(state, events) {
    if (state.winner) return;
    const ownDead = state.sides.own.lord.hp <= 0;
    const enemyDead = state.sides.enemy.lord.hp <= 0;
    if (!ownDead && !enemyDead) return;
    state.winner = ownDead ? "enemy" : "own";
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
  }
  function expireMods(state, side) {
    for (const ref of allUnits(state, side)) {
      const u = ref.unit;
      const before = u.mods.length;
      u.mods = u.mods.filter((m) => {
        if (m.kind !== "temp" || m.turns === void 0) return true;
        m.turns -= 1;
        return m.turns > 0;
      });
      if (u.mods.length !== before) applyMods(u);
    }
  }
  function setLastDiscarded(state, card, side) {
    state.lastDiscarded = { card, side };
  }
  function expireHandMods(state, side) {
    for (const hc of state.sides[side].hand) {
      if (!hc.mods.length) continue;
      hc.mods = hc.mods.filter((m) => {
        if (m.turns === void 0) return true;
        m.turns -= 1;
        return m.turns > 0;
      });
    }
  }
  function expireStatuses(state, side, events) {
    const lord = state.sides[side].lord;
    if (lord.statuses) {
      for (const [id, inst] of Object.entries(lord.statuses)) {
        if (inst.turns === void 0) continue;
        inst.turns -= 1;
        if (inst.turns <= 0) {
          delete lord.statuses[id];
          events.push({ type: "LORD_STATUS_EXPIRED", side, status: id });
        }
      }
    }
    for (const ref of allUnits(state, side)) {
      for (const [id, inst] of Object.entries(ref.unit.statuses)) {
        if (inst.turns === void 0) continue;
        inst.turns -= 1;
        if (inst.turns <= 0) {
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
        s.discard.push(c.card);
        dropped.push(c.card);
      }
    }
    return dropped;
  }

  // src/effects.ts
  registerOnDrawResolver((state, cards, side, card, events, rng) => {
    const sk = (card.skills ?? []).find((k) => k.trigger === "on_draw");
    if (!sk) return false;
    runEffects(state, cards, sk.effects ?? [], { side }, rng, events);
    return true;
  });
  registerOnDeathResolver((state, cards, side, unit, skills, events, rng) => {
    for (const sk of skills) {
      runEffects(state, cards, sk.effects ?? [], { side, source: unit }, rng, events);
    }
  });
  var hpOf = (s, t) => t.kind === "lord" ? s.sides[t.side].lord.hp : t.kind === "hand" ? 0 : getUnit(s, t.side, t.row, t.col)?.hp ?? 0;
  var sameTarget = (a, b) => a.kind === b.kind && a.side === b.side && (a.kind === "lord" || a.kind === "hand" && b.kind === "hand" && a.index === b.index || a.kind === "unit" && b.kind === "unit" && a.row === b.row && a.col === b.col);
  var matchesHandFilter = (hc, f) => {
    if (!f?.type) return true;
    if (f.type === "character") return ["troop", "general", "strategist"].includes(hc.card.type);
    return hc.card.type === f.type;
  };
  var matchesFilter = (u, f, row, srcCost) => {
    if (!f) return true;
    if (f.type) {
      if (f.type === "character") {
        if (!["troop", "general", "strategist"].includes(u.type)) return false;
      } else if (u.type !== f.type) return false;
    }
    if (f.keyword && !u.kw.includes(f.keyword)) return false;
    if (f.tag && !(u.tags ?? []).includes(f.tag)) return false;
    if (f.faction && u.faction !== f.faction) return false;
    if (f.row && row !== f.row) return false;
    if (typeof f.health_max === "number" && u.hp > f.health_max) return false;
    if (f.has_status && !((u.statuses[f.has_status]?.stacks ?? 0) > 0)) return false;
    if (typeof f.cost_max === "number" && u.cost > f.cost_max) return false;
    if (typeof f.cost_min === "number" && u.cost < f.cost_min) return false;
    if (f.troopKind && u.troopKind !== f.troopKind) return false;
    if (f.cost_below_source && srcCost !== void 0 && u.cost >= srcCost) return false;
    return true;
  };
  var cmp = (a, op, b) => op === ">=" ? a >= b : op === "<=" ? a <= b : op === "==" ? a === b : op === ">" ? a > b : op === "<" ? a < b : op === "!=" ? a !== b : false;
  function checkCondition(state, cond, ctx, rng) {
    if (!cond) return true;
    if (cond.exists) {
      return resolveTargets(state, { ...cond.exists, count: "all" }, ctx, rng).length > 0;
    }
    if (cond.count) {
      const n = resolveTargets(state, { ...cond.count.selector, count: "all" }, ctx, rng).length;
      return cmp(n, cond.count.op, cond.count.value);
    }
    if (cond.count_vs) {
      const l = resolveTargets(state, { ...cond.count_vs.left, count: "all" }, ctx, rng).length;
      const r = resolveTargets(state, { ...cond.count_vs.right, count: "all" }, ctx, rng).length;
      return cmp(l, cond.count_vs.op, r);
    }
    if (cond.event) return (ctx.flags ?? []).includes(cond.event);
    return true;
  }
  function runTriggerSkills(state, cards, side, trigger, rng, events) {
    for (const ref of allUnits(state, side)) {
      const u = ref.unit;
      if (u.hp <= 0) continue;
      for (const sk of (u.skills ?? []).filter((s) => s.trigger === trigger)) {
        runEffects(state, cards, sk.effects, { side, source: u }, rng, events);
      }
    }
  }
  function costRuleDelta(state, card, side, rng) {
    if (!card.cost_rule) return 0;
    return checkCondition(state, card.cost_rule.condition, { side }, rng) ? card.cost_rule.value : 0;
  }
  function recomputeAuras(state, cards, rng, events) {
    const sides = ["own", "enemy"];
    for (const side of sides) {
      for (const ref of allUnits(state, side)) {
        ref.unit.mods = ref.unit.mods.filter((m) => m.kind !== "aura");
        for (const [id, inst] of Object.entries(ref.unit.statuses)) {
          if (inst.auraId) delete ref.unit.statuses[id];
        }
      }
      for (const hc of state.sides[side].hand) {
        hc.mods = hc.mods.filter((m) => !m.auraId);
      }
      const lord = state.sides[side].lord;
      for (const [id, inst] of Object.entries(lord.statuses ?? {})) {
        if (inst.auraId) delete lord.statuses[id];
      }
    }
    for (const side of sides) {
      for (const ref of allUnits(state, side)) {
        const u = ref.unit;
        if (u.hp <= 0) continue;
        for (const sk of (u.skills ?? []).filter((s) => s.kind === "aura")) {
          runEffects(
            state,
            cards,
            sk.effects,
            { side, source: u, auraId: `${u.uid}#${sk.id}` },
            rng,
            events
          );
        }
      }
    }
    for (const side of sides) {
      for (const ref of allUnits(state, side)) applyMods(ref.unit);
    }
  }
  function runCardPlayedTriggers(state, cards, played, rng, events) {
    for (const side of ["own", "enemy"]) {
      for (const ref of allUnits(state, side)) {
        const u = ref.unit;
        if (u.hp <= 0) continue;
        for (const sk of (u.skills ?? []).filter((x) => x.trigger === "on_card_played")) {
          const want = sk.target?.filter?.type;
          if (want === "character") {
            if (!["troop", "general", "strategist"].includes(played.type)) continue;
          } else if (want && played.type !== want) continue;
          runEffects(state, cards, sk.effects, { side, source: u }, rng, events);
        }
      }
    }
  }
  function runMarkDamaged(state, cards, victim, amount, rng, events) {
    const inst = victim.statuses.chou_di;
    if (!inst?.srcUid) return;
    for (const side of ["own", "enemy"]) {
      for (const ref of allUnits(state, side)) {
        const marker = ref.unit;
        if (marker.uid !== inst.srcUid || marker.hp <= 0) continue;
        for (const sk of (marker.skills ?? []).filter((x) => x.trigger === "on_mark_damaged")) {
          runEffects(
            state,
            cards,
            sk.effects,
            { side, source: marker, flags: [`mark_amount:${amount}`] },
            rng,
            events
          );
        }
      }
    }
  }
  function runUnitTrigger(state, cards, unit, trigger, rng, events) {
    if (unit.hp <= 0) return;
    const side = findSide(state, unit.uid);
    if (!side) return;
    for (const sk of (unit.skills ?? []).filter((x) => x.trigger === trigger)) {
      runEffects(state, cards, sk.effects, { side, source: unit }, rng, events);
    }
  }
  function findSide(state, uid) {
    for (const side of ["own", "enemy"]) {
      for (const r of BOARD.ROWS) {
        if (state.sides[side].rows[r].some((u) => u?.uid === uid)) return side;
      }
    }
    return null;
  }
  function findCol(state, side, uid) {
    for (const r of BOARD.ROWS) {
      const i = state.sides[side].rows[r].findIndex((u) => u?.uid === uid);
      if (i >= 0) return i;
    }
    return -1;
  }
  function topCost(state, side) {
    let max = 0;
    for (const r of BOARD.ROWS) {
      for (const u of state.sides[side].rows[r]) if (u && u.cost > max) max = u.cost;
    }
    return max;
  }
  function resolveTargets(state, selector, ctx, rng) {
    if (!selector) return ctx.chosen ? [ctx.chosen] : [];
    if (selector.zone === "hand") {
      const sideSel2 = selector.side ?? "enemy";
      const hs = sideSel2 === "both" ? ["own", "enemy"] : sideSel2 === "self" || sideSel2 === "ally" ? [ctx.side] : [other(ctx.side)];
      const out = [];
      for (const sd of hs) {
        state.sides[sd].hand.forEach((hc, i) => {
          if (matchesHandFilter(hc, selector.filter)) out.push(handRef(sd, i));
        });
      }
      const n2 = selector.count === "all" ? out.length : selector.count ?? 1;
      if (selector.mode === "random") {
        const copy = [...out], picked = [];
        for (let i = 0; i < n2 && copy.length; i++) picked.push(copy.splice(rng.int(copy.length), 1)[0]);
        return picked;
      }
      return n2 === out.length ? out : out.slice(0, n2);
    }
    if (selector.lord) {
      const sideSel2 = selector.side ?? "enemy";
      const ls = sideSel2 === "both" ? ["own", "enemy"] : sideSel2 === "self" || sideSel2 === "ally" ? [ctx.side] : [other(ctx.side)];
      return ls.map((x) => lordRef(x));
    }
    if (selector.source) {
      const src = ctx.source;
      if (!src) return [];
      for (const r of BOARD.ROWS) {
        for (let c = 0; c < BOARD.COLS; c++) {
          if (state.sides[ctx.side].rows[r][c]?.uid === src.uid) return [unitRef(ctx.side, r, c)];
        }
      }
      return [];
    }
    const sideSel = selector.side ?? "enemy";
    const sides = sideSel === "both" ? ["own", "enemy"] : sideSel === "self" ? [ctx.side] : sideSel === "ally" ? [ctx.side] : [other(ctx.side)];
    const confused = hasCap(ctx.source ?? null, "random_target");
    const poolSides = confused ? ["own", "enemy"] : sides;
    const pool = [];
    for (const s of poolSides) {
      for (const r of BOARD.ROWS) {
        state.sides[s].rows[r].forEach((u, c) => {
          if (!u) return;
          if (hasCap(u, "untargetable")) return;
          if (hasCap(u, "duel_lock") && ctx.source && !hasCap(ctx.source, "duel_lock")) return;
          if (matchesFilter(u, selector.filter ?? {}, r, ctx.source?.cost)) pool.push(unitRef(s, r, c));
        });
      }
    }
    if (selector.filter?.include_lord) {
      for (const s of poolSides) {
        if (state.sides[s].lord.hp > 0) pool.push(lordRef(s));
      }
    }
    let finalPool = pool;
    if (selector.filter?.adjacent_to === "self" && ctx.source) {
      const srcCol = ctx.source ? findCol(state, ctx.side, ctx.source.uid) : -1;
      finalPool = srcCol < 0 ? [] : pool.filter((t) => t.kind === "unit" && Math.abs(t.col - srcCol) <= 1);
    }
    const sel = confused ? { ...selector, mode: "random" } : selector;
    if (sel.mode === "random" && finalPool.length) {
      const n2 = sel.count === "all" ? finalPool.length : sel.count ?? 1;
      const picked = [];
      const copy = [...finalPool];
      for (let i = 0; i < n2 && copy.length; i++) {
        picked.push(copy.splice(rng.int(copy.length), 1)[0]);
      }
      return picked;
    }
    if (sel.count === "all") return finalPool;
    const n = sel.count ?? 1;
    if (sel.mode === "first") return finalPool.slice(0, n);
    if (sel.mode === "lowest_health") {
      return [...finalPool].sort((a, b) => hpOf(state, a) - hpOf(state, b)).slice(0, n);
    }
    if (ctx.chosen && pool.some((t) => sameTarget(t, ctx.chosen))) {
      return [ctx.chosen];
    }
    return pool.slice(0, n);
  }
  function runEffects(state, cards, effects, ctx, rng, events) {
    if (!effects?.length) return;
    for (const eff of effects) {
      if (typeof eff.chance === "number" && rng.next() >= eff.chance) continue;
      if (!checkCondition(state, eff.condition, ctx, rng)) continue;
      const dyn = (sel) => sel ? resolveTargets(state, { ...sel, count: "all" }, ctx, rng).length : void 0;
      const dynAtk = dyn(eff.attack_from), dynHp = dyn(eff.health_from);
      const dynVal = dyn(eff.value_from);
      const discardVal = (() => {
        if (!eff.value_from_discarded) return void 0;
        const last = state.lastDiscarded;
        if (!last) return void 0;
        return eff.value_from_discarded === "cost" ? last.card.cost : last.card.health ?? 0;
      })();
      const flagVal = eff.value_from_flag ? Number((ctx.flags ?? []).find((f) => f.startsWith(`${eff.value_from_flag}:`))?.split(":")[1]) : void 0;
      const val = flagVal ?? discardVal ?? dynVal ?? eff.value ?? 0;
      const targets = eff.target ? resolveTargets(state, eff.target, ctx, rng) : [];
      switch (eff.action) {
        case "damage": {
          const times = eff.count ?? 1;
          for (let i = 0; i < times; i++) {
            const list = i === 0 ? targets.length ? targets : ctx.chosen ? [ctx.chosen] : [] : eff.target ? resolveTargets(state, eff.target, ctx, rng) : ctx.chosen ? [ctx.chosen] : [];
            for (const t of list) {
              const before = hpOf(state, t);
              const victim = t.kind === "unit" ? getUnit(state, t.side, t.row, t.col) : null;
              dealDamage(state, cards, t, val, events, ctx.source?.name ?? "\u6548\u679C");
              if (before > 0 && hpOf(state, t) <= 0) {
                ctx.flags = ctx.flags ?? [];
                if (!ctx.flags.includes("killed")) ctx.flags.push("killed");
              }
              if (victim && victim.hp > 0) runUnitTrigger(state, cards, victim, "on_damaged", rng, events);
              if (victim) runMarkDamaged(state, cards, victim, val, rng, events);
            }
          }
          break;
        }
        case "heal": {
          const list = targets.length ? targets : ctx.chosen ? [ctx.chosen] : [];
          for (const t of list) healTarget(state, t, val, events);
          break;
        }
        case "draw": {
          for (let i = 0; i < (dynVal ?? eff.value ?? 1); i++) drawCard(state, cards, ctx.side, events);
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
        case "discard": {
          const n = eff.count ?? 1;
          const sel = eff.target?.side ?? "enemy";
          const sides = sel === "both" ? ["own", "enemy"] : sel === "self" || sel === "ally" ? [ctx.side] : [other(ctx.side)];
          for (const side of sides) {
            for (let i = 0; i < n && state.sides[side].hand.length; i++) {
              const want = eff.mode === "choose" && side === ctx.side ? ctx.handIndex : void 0;
              const idx = typeof want === "number" && want >= 0 && want < state.sides[side].hand.length ? want : rng.int(state.sides[side].hand.length);
              const [hc] = state.sides[side].hand.splice(idx, 1);
              if (!hc) continue;
              state.sides[side].discard.push(hc.card);
              state.lastDiscarded = { card: hc.card, side };
              events.push({ type: "CARD_DISCARDED", side, card: hc.card });
            }
          }
          break;
        }
        case "add_to_deck": {
          const who = eff.target?.side === "enemy" ? other(ctx.side) : ctx.side;
          const def = cards.get(String(eff.unit ?? ""));
          if (!def) {
            events.push({ type: "REJECTED", reason: `add_to_deck \u7684\u5361\u4E0D\u5B58\u5728\uFF1A${eff.unit}` });
            break;
          }
          const n = eff.count ?? 1;
          for (let i = 0; i < n; i++) {
            const deck = state.sides[who].deck;
            deck.splice(rng.int(deck.length + 1), 0, def.id);
          }
          events.push({ type: "DECK_ADDED", side: who, card: def, count: n });
          break;
        }
        case "send_to_deck": {
          const to = eff.target?.side === "enemy" ? other(ctx.side) : ctx.side;
          const cid = String(eff.unit ?? "");
          const from = state.sides[ctx.side].deck;
          const moved = [];
          for (let i = from.length - 1; i >= 0; i--) {
            if (from[i] === cid) {
              from.splice(i, 1);
              moved.push(cid);
            }
          }
          for (const id of moved) {
            const deck = state.sides[to].deck;
            deck.splice(rng.int(deck.length + 1), 0, id);
          }
          events.push({ type: "DECK_SENT", side: to, cardId: cid, count: moved.length });
          break;
        }
        case "cycle_to_deck": {
          const h = state.sides[ctx.side].hand;
          const idx = typeof ctx.handIndex === "number" && ctx.handIndex >= 0 && ctx.handIndex < h.length ? ctx.handIndex : h.length ? rng.int(h.length) : -1;
          if (idx < 0) break;
          const [hc] = h.splice(idx, 1);
          if (!hc) break;
          const deck = state.sides[ctx.side].deck;
          deck.splice(rng.int(deck.length + 1), 0, hc.card.id);
          events.push({ type: "CARD_RETURNED_TO_DECK", side: ctx.side, card: hc.card });
          drawCard(state, cards, ctx.side, events, rng);
          break;
        }
        case "return_to_hand": {
          for (const t of targets) {
            if (t.kind !== "unit") continue;
            const u = getUnit(state, t.side, t.row, t.col);
            if (!u) continue;
            const def = cards.get(u.cardId);
            state.sides[t.side].rows[t.row][t.col] = null;
            if (def) state.sides[t.side].hand.push({ card: def, mods: [] });
            events.push({ type: "UNIT_RETURNED", side: t.side, row: t.row, col: t.col, unit: u });
          }
          break;
        }
        case "clash": {
          const foe = eff.target?.side === "self" || eff.target?.side === "ally" ? ctx.side : other(ctx.side);
          const mine = ctx.source?.cost ?? 0;
          const his = topCost(state, foe);
          const mode = eff.clashMode ?? "roll";
          const a = mode === "cost" ? mine : rng.int(6) + 1;
          const b = mode === "cost" ? his : rng.int(6) + 1;
          const win = mode === "cost" && a !== b ? a > b : a >= b;
          ctx.flags = ctx.flags ?? [];
          ctx.flags.push(win ? "clash_won" : "clash_lost");
          events.push({ type: "CLASH", side: ctx.side, mine: a, theirs: b, won: win });
          break;
        }
        case "cost_modifier": {
          const value = eff.value ?? 0;
          const turns = typeof eff.duration === "number" ? eff.duration : eff.duration === "this_turn" ? 1 : void 0;
          for (const t of targets) {
            if (t.kind !== "hand") continue;
            const hc = state.sides[t.side].hand[t.index];
            if (!hc) continue;
            hc.mods.push({ id: `cost#${nextUidSeq(state)}`, kind: "cost", value, turns, auraId: ctx.auraId });
            events.push({ type: "HAND_MODIFIED", side: t.side, index: t.index, kind: "cost", value, turns });
          }
          break;
        }
        case "ban_play": {
          const turns = typeof eff.duration === "number" ? eff.duration : eff.duration === "this_turn" ? 1 : void 0;
          for (const t of targets) {
            if (t.kind !== "hand") continue;
            const hc = state.sides[t.side].hand[t.index];
            if (!hc) continue;
            hc.mods.push({ id: `ban#${nextUidSeq(state)}`, kind: "ban", turns, auraId: ctx.auraId });
            events.push({ type: "HAND_MODIFIED", side: t.side, index: t.index, kind: "ban", turns });
          }
          break;
        }
        case "steal_card": {
          const from = eff.target?.side === "self" || eff.target?.side === "ally" ? ctx.side : other(ctx.side);
          const n = eff.count ?? 1;
          for (let i = 0; i < n && state.sides[from].hand.length; i++) {
            const idx = rng.int(state.sides[from].hand.length);
            const [hc] = state.sides[from].hand.splice(idx, 1);
            if (!hc) continue;
            const def = hc.card;
            const isChar = ["troop", "general", "strategist"].includes(def.type);
            if (eff.to === "board" && isChar) {
              const empties = [];
              for (const r of BOARD.ROWS) {
                for (let c = 0; c < BOARD.COLS; c++) {
                  if (!state.sides[ctx.side].rows[r][c]) empties.push({ row: r, col: c });
                }
              }
              if (empties.length) {
                const slot = empties[rng.int(empties.length)];
                const u = makeUnit(def, state.turn, nextUidSeq(state));
                setUnit(state, ctx.side, slot.row, slot.col, u);
                events.push({ type: "UNIT_SUMMONED", side: ctx.side, row: slot.row, col: slot.col, unit: u });
                continue;
              }
            }
            state.sides[ctx.side].hand.push({ card: def, mods: [] });
            events.push({ type: "CARD_STOLEN", from, to: ctx.side, card: def });
          }
          break;
        }
        case "transform": {
          const toId = String(eff.to ?? "");
          const toCard = cards.get(toId);
          if (!toCard) {
            events.push({ type: "REJECTED", reason: `\u8FDB\u5316\u76EE\u6807\u5361\u4E0D\u5B58\u5728\uFF1A${toId}` });
            break;
          }
          for (const t of targets) {
            if (t.kind !== "unit") continue;
            const u = getUnit(state, t.side, t.row, t.col);
            if (!u) continue;
            const fromId = u.cardId;
            const taken = u.maxHp - u.hp;
            u.cardId = toCard.id;
            u.name = toCard.name;
            u.baseAtk = toCard.attack ?? 0;
            u.baseMaxHp = toCard.health ?? 1;
            u.kw = [...toCard.keywords ?? []];
            u.skills = toCard.skills ? structuredClone(toCard.skills) : void 0;
            u.troopKind = toCard.troopKind;
            applyMods(u);
            u.hp = Math.max(1, u.maxHp - taken);
            events.push({
              type: "UNIT_TRANSFORMED",
              side: t.side,
              row: t.row,
              col: t.col,
              from: fromId,
              to: toCard.id,
              unit: u
            });
          }
          break;
        }
        case "survive": {
          for (const t of targets) {
            if (t.kind !== "unit") continue;
            const u = getUnit(state, t.side, t.row, t.col);
            if (!u) continue;
            u.hp = 1;
            events.push({ type: "UNIT_SURVIVED", side: t.side, row: t.row, col: t.col, unit: u });
          }
          break;
        }
        case "extra_attack": {
          for (const t of targets) {
            if (t.kind !== "unit") continue;
            const u = getUnit(state, t.side, t.row, t.col);
            if (!u) continue;
            u.attackedThisTurn = Math.max(0, u.attackedThisTurn - 1);
            events.push({ type: "EXTRA_ATTACK", side: t.side, row: t.row, col: t.col });
          }
          break;
        }
        case "take_control": {
          const backSide = eff.target?.side === "self" || eff.target?.side === "ally" ? ctx.side : other(ctx.side);
          for (const t of targets) {
            if (t.kind !== "unit") continue;
            const u = getUnit(state, t.side, t.row, t.col);
            if (!u) continue;
            const empties = [];
            for (const r of BOARD.ROWS) {
              for (let c = 0; c < BOARD.COLS; c++) if (!state.sides[ctx.side].rows[r][c]) empties.push({ row: r, col: c });
            }
            if (!empties.length) continue;
            state.sides[t.side].rows[t.row][t.col] = null;
            const slot = empties[rng.int(empties.length)];
            setUnit(state, ctx.side, slot.row, slot.col, u);
            events.push({ type: "CONTROL_TAKEN", from: backSide, to: ctx.side, unit: u });
          }
          break;
        }
        case "copy_skill": {
          const src = ctx.source;
          if (!src) break;
          for (const t of targets) {
            if (t.kind !== "unit") continue;
            const u = getUnit(state, t.side, t.row, t.col);
            const sk = (u?.skills ?? []).find((x) => x.kind === "active") ?? u?.skills?.[0];
            if (!u || !sk) continue;
            src.skills = src.skills ?? [];
            if (!src.skills.some((x) => x.id === sk.id)) {
              src.skills.push(structuredClone(sk));
              events.push({ type: "SKILL_COPIED", side: ctx.side, from: u.name, skill: sk.name });
            }
          }
          break;
        }
        case "force_attack": {
          for (const t of targets) {
            if (t.kind !== "unit") continue;
            const u = getUnit(state, t.side, t.row, t.col);
            if (!u || u.hp <= 0) continue;
            const foes = allUnits(state, other(t.side)).filter((x) => x.unit.hp > 0);
            if (!foes.length) continue;
            const victim = foes[rng.int(foes.length)];
            dealDamage(
              state,
              cards,
              unitRef(victim.side, victim.row, victim.col),
              u.atk,
              events,
              u.name
            );
            events.push({ type: "FORCED_ATTACK", side: t.side, row: t.row, col: t.col });
          }
          break;
        }
        case "flip": {
          for (const t of targets) {
            if (t.kind !== "unit") continue;
            applyStatus(state, t, "fan_mian", 1, events);
          }
          break;
        }
        case "scry": {
          const who = eff.target?.side === "self" || eff.target?.side === "ally" ? ctx.side : other(ctx.side);
          const deck = state.sides[who].deck;
          const n = eff.count ?? 1;
          const fromTop = (eff.from ?? "top") === "top";
          for (let i = 0; i < n && deck.length; i++) {
            const id = fromTop ? deck.shift() : deck.pop();
            if (eff.to === "deck_bottom") deck.push(id);
            else if (eff.to === "deck_top") deck.unshift(id);
            else {
              const def = cards.get(id);
              if (def) state.sides[who].hand.push({ card: def, mods: [] });
            }
            events.push({ type: "CARD_SCRYED", side: who, cardId: id, from: fromTop ? "top" : "bottom" });
          }
          break;
        }
        case "apply_status": {
          const list = targets.length ? targets : ctx.chosen ? [ctx.chosen] : [];
          const turns = typeof eff.duration === "number" ? eff.duration : eff.duration === "this_turn" ? 1 : void 0;
          const srcUid = eff.status_source === "self" ? ctx.source?.uid : void 0;
          for (const t of list) {
            applyStatus(state, t, eff.status, eff.stacks ?? 1, events, turns, srcUid, ctx.auraId);
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
            const dAtk = dynAtk ?? eff.attack ?? (eff.health === void 0 ? eff.value : 0) ?? 0;
            const dHp = dynHp ?? eff.health ?? (eff.attack === void 0 ? eff.value : 0) ?? 0;
            if (!dAtk && !dHp) continue;
            if (ctx.auraId) {
              u.mods.push({
                id: ctx.auraId,
                kind: "aura",
                attack: dAtk || void 0,
                health: dHp || void 0
              });
              continue;
            }
            const turns = typeof eff.duration === "number" ? eff.duration : eff.duration === "this_turn" ? 1 : void 0;
            u.mods.push({
              id: `mod#${nextUidSeq(state)}`,
              kind: turns === void 0 ? "permanent" : "temp",
              attack: dAtk || void 0,
              health: dHp || void 0,
              turns
            });
            applyMods(u);
            events.push({
              type: "STAT_MODIFIED",
              side: t.side,
              row: t.row,
              col: t.col,
              attack: dAtk || void 0,
              health: dHp || void 0,
              duration: eff.duration
            });
          }
          break;
        }
        default:
          break;
      }
    }
  }

  // src/engine.ts
  function useLordSkill(state, ctx, action, events, rng) {
    const side = state.active;
    const lord = state.sides[side].lord;
    const skill = lord.skillDef;
    if (!skill || skill.kind !== "active") return false;
    if (hasCapOn(lord.statuses, "block_lord_skill")) return false;
    if (lord.skillUsedThisTurn && capStacks(lord.statuses, "extra_lord_skill") <= 0) return false;
    const cost = skill.cost ?? LORD_SKILL_COST;
    if (state.sides[side].command.cur < cost) return false;
    const target = action.target ? action.target.row !== void 0 ? unitRef(action.target.side, action.target.row, action.target.col) : lordRef(action.target.side) : void 0;
    state.sides[side].command.cur -= cost;
    if (capStacks(lord.statuses, "extra_lord_skill") > 0 && lord.skillUsedThisTurn) {
      const bonus = Object.entries(lord.statuses ?? {}).find(([id, st]) => st.stacks > 0 && STATUSES[id]?.caps?.includes("extra_lord_skill"));
      if (bonus) bonus[1].stacks -= 1;
    } else {
      lord.skillUsedThisTurn = true;
    }
    events.push({ type: "LORD_SKILL_USED", side, skill: lord.skill });
    runEffects(
      state,
      ctx.cards,
      skill.effects,
      { side, chosen: target, handIndex: action.handIndex },
      rng,
      events
    );
    return true;
  }
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
    const duan = lordStatusStacks(s.lord, "duan_liang");
    s.command.cur = Math.max(0, s.command.max - duan);
    s.lord.skillUsedThisTurn = false;
    for (const ref of allUnits(state, side)) {
      ref.unit.attackedThisTurn = 0;
      ref.unit.skillUsesThisTurn = {};
    }
    events.push({ type: "TURN_START", side, turn: state.turn, command: { ...s.command } });
    drawCard(state, ctx.cards, side, events);
    if (state.secondCompensation === "extra_draw" && state.turn === 2) {
      drawCard(state, ctx.cards, side, events);
    }
    resolveTurnStartStatuses(state, ctx.cards, side, events);
    recomputeAuras(state, ctx.cards, rng, events);
    runTriggerSkills(state, ctx.cards, side, TIMING.TURN_START, rng, events);
  }
  function endTurn(state, ctx, events, rng) {
    const side = state.active;
    resolveTurnEndStatuses(state, ctx.cards, side, events);
    runTriggerSkills(state, ctx.cards, side, TIMING.TURN_END, rng, events);
    expireStatuses(state, side, events);
    expireMods(state, side);
    expireHandMods(state, side);
    recomputeAuras(state, ctx.cards, rng, events);
    const dropped = discardOverflow(state, side);
    dropped.forEach((c) => events.push({ type: "CARD_PLAYED", side, card: c }));
    events.push({ type: "TURN_END", side, turn: state.turn });
    state.active = other(side);
    startTurn(state, ctx, events, rng);
  }
  function playCard(state, ctx, action, events, rng) {
    const side = state.active;
    const s = state.sides[side];
    const hc = s.hand[action.cardIndex];
    if (!hc) return false;
    if (isBanned(hc)) return false;
    const card = hc.card;
    const cost = effectiveCost(hc, costRuleDelta(state, card, side, rng));
    const isCharacter2 = ["troop", "general", "strategist"].includes(card.type);
    const slot = isCharacter2 ? { row: action.row, col: action.col } : void 0;
    const check = canPlayCard(state, side, card, slot, cost);
    if (!check.ok) return false;
    s.command.cur -= cost;
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
      recomputeAuras(state, ctx.cards, rng, events);
      runCardPlayedTriggers(state, ctx.cards, card, rng, events);
      recomputeAuras(state, ctx.cards, rng, events);
    } else {
      runEffects(state, ctx.cards, card.effects, { side }, rng, events);
      s.discard.push(card);
      runCardPlayedTriggers(state, ctx.cards, card, rng, events);
      recomputeAuras(state, ctx.cards, rng, events);
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
    const hasYinXue = hasKeyword(attacker, "yin_xue");
    const foe = other(side);
    events.push({ type: "ATTACK_DECLARED", side, from: { ...from }, to: target });
    runUnitTrigger(state, ctx.cards, attacker, "on_attack", rng, events);
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
      const hit = getUnit(state, foe, tRow, tCol);
      if (hit && hit.hp > 0) runUnitTrigger(state, ctx.cards, hit, "on_damaged", rng, events);
      if (hit) runMarkDamaged(state, ctx.cards, hit, dmg, rng, events);
      if (!targetDied && !hasWuShuang) {
        dealDamage(state, ctx.cards, unitRef(side, from.row, from.col), retaliate, events, targetUnit?.name ?? "\u53CD\u51FB");
        const back = getUnit(state, side, from.row, from.col);
        if (back && back.hp > 0) runUnitTrigger(state, ctx.cards, back, "on_damaged", rng, events);
      }
      if (hasYinXue) healTarget(state, lordRef(side), dealt, events);
    }
    attacker.attackedThisTurn += 1;
    if (hasKeyword(attacker, "qi_xi")) {
      attacker.kw = attacker.kw.filter((k) => k !== "qi_xi");
      delete attacker.statuses.qi_xi_status;
      events.push({ type: "STATUS_EXPIRED", side, row: from.row, col: from.col, status: "qi_xi" });
    }
    const still = getUnit(state, side, from.row, from.col);
    if (still && still.hp <= 0) {
      killUnit(state, ctx.cards, { side, row: from.row, col: from.col, unit: still }, events);
      recomputeAuras(state, ctx.cards, rng, events);
    }
    return true;
  }
  function useUnitSkill(state, ctx, action, events, rng) {
    const side = state.active;
    const u = getUnit(state, side, action.row, action.col);
    if (!u) return false;
    const check = canUseUnitSkill(state, side, action.row, action.col);
    if (!check.ok) return false;
    const skill = check.skill;
    const key = skill.id || skill.name || "0";
    u.skillUsesThisTurn[key] = (u.skillUsesThisTurn[key] ?? 0) + 1;
    if ((skill.frequency ?? "once_per_turn") === "once") u.skillsUsedOnce.push(key);
    state.sides[side].command.cur -= skill.cost ?? 0;
    const target = action.target ? action.target.row !== void 0 ? unitRef(action.target.side, action.target.row, action.target.col) : lordRef(action.target.side) : void 0;
    runEffects(
      state,
      ctx.cards,
      skill.effects,
      { side, source: u, chosen: target, handIndex: action.handIndex },
      rng,
      events
    );
    return true;
  }

  // src/result.ts
  function summarize(state, side) {
    const s = state.sides[side];
    const units = allUnits(state, side);
    return {
      side,
      lordName: s.lord.name,
      lordHp: s.lord.hp,
      lordMaxHp: s.lord.maxHp,
      lordArmor: s.lord.armor,
      units: units.length,
      totalAttack: units.reduce((a, r) => a + r.unit.atk, 0),
      deckLeft: s.deck.length,
      handLeft: s.hand.length,
      discard: s.discard.length,
      damageTaken: s.lord.maxHp - s.lord.hp
    };
  }
  function summarizeMatch(state) {
    const sides = { own: summarize(state, "own"), enemy: summarize(state, "enemy") };
    const result = state.winner ?? "draw";
    let reason = "\u672A\u7ED3\u675F";
    if (state.winner) {
      const lordDead = state.sides.own.lord.hp <= 0 || state.sides.enemy.lord.hp <= 0;
      reason = lordDead ? "\u4E3B\u5C06\u9635\u4EA1" : state.turn >= MATCH.TURN_LIMIT ? "\u56DE\u5408\u4E0A\u9650" : "\u4E3B\u5C06\u9635\u4EA1";
    }
    const winnerName = !state.winner ? "\u2014" : state.winner === "draw" ? "\u5E73\u5C40" : state.sides[state.winner].lord.name;
    return { result, reason, turns: state.turn, sides, winnerName };
  }
  function formatSummary(sum) {
    const { own, enemy } = sum.sides;
    return [
      `\u7ED3\u679C\uFF1A${sum.winnerName === "\u5E73\u5C40" ? "\u5E73\u5C40" : `${sum.winnerName} \u80DC`}\uFF08${sum.reason}\uFF0C\u7B2C ${sum.turns} \u56DE\u5408\uFF09`,
      `  \u5DF1\u65B9 ${own.lordName} ${own.lordHp}/${own.lordMaxHp}${own.lordArmor ? `+${own.lordArmor}\u7532` : ""} | \u573A\u4E0A ${own.units} \u4EBA \u5171 ${own.totalAttack} \u653B | \u724C\u5E93 ${own.deckLeft} \u624B ${own.handLeft} \u5F03 ${own.discard}`,
      `  \u654C\u65B9 ${enemy.lordName} ${enemy.lordHp}/${enemy.lordMaxHp}${enemy.lordArmor ? `+${enemy.lordArmor}\u7532` : ""} | \u573A\u4E0A ${enemy.units} \u4EBA \u5171 ${enemy.totalAttack} \u653B | \u724C\u5E93 ${enemy.deckLeft} \u624B ${enemy.handLeft} \u5F03 ${enemy.discard}`
    ].join("\n");
  }

  // src/setup.ts
  function mulligan(state, side, indices, cards) {
    const s = state.sides[side];
    if (s.mulliganDone) {
      return { ok: false, state, reason: "\u672C\u5C40\u5DF2\u6362\u8FC7\u724C\uFF08\u6BCF\u5F20\u4EC5\u4E00\u6B21\u673A\u4F1A\uFF09", replaced: [], drawn: [] };
    }
    const uniq = [...new Set(indices)].sort((a, b) => a - b);
    for (const i of uniq) {
      if (i < 0 || i >= s.hand.length) {
        return { ok: false, state, reason: `\u624B\u724C\u4E0B\u6807\u8D8A\u754C\uFF1A${i}`, replaced: [], drawn: [] };
      }
    }
    const next = cloneState(state);
    const ns = next.sides[side];
    const rng = createRng(next.rngState);
    const replaced = [];
    const drawn = [];
    for (const i of [...uniq].sort((a, b) => b - a)) {
      const hc = ns.hand.splice(i, 1)[0];
      if (hc) {
        replaced.push(hc.card);
        ns.deck.push(hc.card.id);
      }
    }
    rng.shuffle(ns.deck);
    for (let k = 0; k < replaced.length; k++) {
      const id = ns.deck.pop();
      if (!id) break;
      const c = cards.get(id);
      if (!c) continue;
      drawn.push(c);
      ns.hand.push({ card: c, mods: [] });
    }
    ns.mulliganDone = true;
    next.rngState = rng.getState();
    return { ok: true, state: next, replaced, drawn };
  }
  var startHandSize = (side, firstSide) => side === firstSide ? DECK.HAND_START_FIRST : DECK.HAND_START_SECOND;
  var handLimit = () => DECK.HAND_LIMIT;
  function setupMatch(opts) {
    const log = [];
    let state = createMatch({
      seed: opts.seed,
      lords: opts.lords,
      decks: opts.decks,
      cards: opts.cards,
      firstSide: opts.firstSide,
      rollFirst: opts.firstSide === void 0,
      // 未指定 → 按 GDD 掷点
      secondCompensation: opts.secondCompensation
    });
    log.push(`\u4E3B\u516C\uFF1A\u5DF1\u65B9 ${state.sides.own.lord.name} / \u654C\u65B9 ${state.sides.enemy.lord.name}`);
    log.push(`\u5148\u624B\uFF1A${state.active === "own" ? "\u5DF1\u65B9" : "\u654C\u65B9"}`);
    for (const side of ["own", "enemy"]) {
      const idx = opts.mulliganIndices?.[side];
      if (idx === void 0) {
        log.push(`${side} \u672A\u6362\u724C`);
        continue;
      }
      const r = mulligan(state, side, idx, opts.cards);
      if (!r.ok) {
        log.push(`${side} \u6362\u724C\u5931\u8D25\uFF1A${r.reason ?? ""}`);
        continue;
      }
      state = r.state;
      log.push(`${side} \u6362\u724C ${r.replaced.length} \u5F20\uFF1A${r.replaced.map((c) => c.name).join("\u3001") || "\u4E0D\u6362"}`);
    }
    return { state, log };
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
      const raw = bundle.heroes.find((h) => h.id === id);
      if (!raw) throw new Error(`\u627E\u4E0D\u5230\u4E3B\u516C\uFF1A${id}`);
      const sk = raw.skills?.[0];
      if (!sk) throw new Error(`\u4E3B\u516C ${id} \u6CA1\u6709\u4E3B\u516C\u6280\uFF08heroes.yaml \u7684 skills[0]\uFF09`);
      return { ...raw, skill: sk.name, skillDef: sk };
    };
    return {
      cards,
      lords: { own: findLord(lordIds.own), enemy: findLord(lordIds.enemy) },
      byFaction
    };
  }

  // src/deck.ts
  var MAX_COPIES = 2;
  var PUBLIC_POOL = ["neutral", "qun"];
  var PLAYABLE_FACTIONS = ["shu", "wei", "wu"];
  var isDeckable = (c) => !NON_DECK_TYPES.includes(c.type);
  var isPlayableBy = (c, faction) => isDeckable(c) && (c.faction === faction || PUBLIC_POOL.includes(c.faction));
  function cardPool(data, faction) {
    return PUBLIC_POOL.reduce(
      (acc, f) => acc.concat(data.byFaction.get(f) ?? []),
      [...data.byFaction.get(faction) ?? []]
    ).filter((c) => isPlayableBy(c, faction));
  }
  var SUGGESTED_CURVE = { 1: 4, 2: 7, 3: 7, 4: 6, 5: 4, 6: 2 };
  function computeStats(cards) {
    const curve = {};
    let units = 0;
    for (const c of cards) {
      curve[c.cost] = (curve[c.cost] ?? 0) + 1;
      if (["troop", "general", "strategist"].includes(c.type)) units += 1;
    }
    const size = cards.length;
    return {
      size,
      unique: new Set(cards.map((c) => c.id)).size,
      curve,
      avgCost: size ? cards.reduce((a, c) => a + c.cost, 0) / size : 0,
      units,
      nonUnits: size - units
    };
  }
  function validateDeck(data, faction, deckIds) {
    const errors = [];
    const warnings = [];
    const cards = [];
    for (const id of deckIds) {
      const c = data.cards.get(id);
      if (!c) {
        errors.push({ kind: "unknown", message: `\u5361\u7EC4\u91CC\u6709\u4E0D\u5B58\u5728\u7684\u5361\uFF1A${id}` });
        continue;
      }
      if (c.type === "lord") {
        errors.push({ kind: "lord", message: `\u4E3B\u516C\u5361\u4E0D\u8FDB\u5361\u7EC4\uFF0C\u5F00\u5C40\u81EA\u52A8\u4EFB\u547D\uFF1A${c.name}` });
        continue;
      }
      if (!isDeckable(c)) {
        errors.push({ kind: "type", message: `${c.name}\uFF08${c.type}\uFF09\u4E0D\u53EF\u7EC4\u5165\u5361\u7EC4` });
        continue;
      }
      if (!isPlayableBy(c, faction)) {
        errors.push({
          kind: "faction",
          message: `${c.name} \u5C5E\u4E8E ${c.faction}\uFF0C\u4E0D\u80FD\u8FDB ${faction} \u5361\u7EC4\uFF08\u53EA\u5141\u8BB8\u672C\u65B9\u9635\u8425 + ${PUBLIC_POOL.join("/")}\uFF09`
        });
        continue;
      }
      cards.push(c);
    }
    if (deckIds.length !== DECK.SIZE) {
      errors.push({ kind: "size", message: `\u5361\u7EC4\u5FC5\u987B ${DECK.SIZE} \u5F20\uFF0C\u5F53\u524D ${deckIds.length} \u5F20` });
    }
    const copies = /* @__PURE__ */ new Map();
    for (const c of cards) copies.set(c.id, (copies.get(c.id) ?? 0) + 1);
    for (const [id, n] of copies) {
      if (n > MAX_COPIES) {
        const c = data.cards.get(id);
        errors.push({ kind: "copies", message: `${c?.name ?? id} \u540C\u540D\u4E0A\u9650 ${MAX_COPIES} \u5F20\uFF0C\u5F53\u524D ${n} \u5F20` });
      }
    }
    const stats = computeStats(cards);
    const cheap = (stats.curve[1] ?? 0) + (stats.curve[2] ?? 0);
    if (stats.size >= DECK.SIZE && cheap < 5) {
      warnings.push({ kind: "curve", message: `1\u20132 \u8D39\u53EA\u6709 ${cheap} \u5F20\uFF0C\u524D\u671F\u5BB9\u6613\u7A7A\u8FC7\uFF08\u5EFA\u8BAE \u22655\uFF09` });
    }
    const top = Object.entries(stats.curve).filter(([k]) => Number(k) >= 7).reduce((a, [, n]) => a + n, 0);
    if (stats.size >= DECK.SIZE && top > 6) {
      warnings.push({ kind: "curve", message: `7 \u8D39\u4EE5\u4E0A ${top} \u5F20\uFF0C\u5361\u624B\u98CE\u9669\u9AD8\uFF08\u5EFA\u8BAE \u22646\uFF09` });
    }
    if (stats.size >= DECK.SIZE && stats.units < 14) {
      warnings.push({ kind: "curve", message: `\u4EBA\u7269\u5361\u53EA\u6709 ${stats.units} \u5F20\uFF0C\u7AD9\u573A\u80FD\u529B\u504F\u5F31\uFF08\u5EFA\u8BAE \u226514\uFF09` });
    }
    if (stats.unique < 15) {
      warnings.push({ kind: "duplicate", message: `\u53EA\u6709 ${stats.unique} \u79CD\u5361\uFF0C\u5361\u7EC4\u8FC7\u4E8E\u5355\u4E00` });
    }
    return { ok: errors.length === 0, errors, warnings, stats };
  }
  function autoDeck(data, faction, seed = 1) {
    const pool = cardPool(data, faction);
    if (!pool.length) throw new Error(`\u9635\u8425 ${faction} \u6CA1\u6709\u53EF\u7528\u5361\u724C`);
    const buckets = /* @__PURE__ */ new Map();
    for (const c of [...pool].sort((a, b) => a.id < b.id ? -1 : 1)) {
      const b = buckets.get(c.cost) ?? [];
      b.push(c);
      buckets.set(c.cost, b);
    }
    const used = /* @__PURE__ */ new Map();
    const deck = [];
    const take = (c) => {
      const n = used.get(c.id) ?? 0;
      if (n >= MAX_COPIES) return false;
      used.set(c.id, n + 1);
      deck.push(c.id);
      return true;
    };
    const costs = [...Object.keys(SUGGESTED_CURVE).map(Number), ...[...buckets.keys()].filter((k) => !(k in SUGGESTED_CURVE))].sort((a, b) => a - b);
    const offset = seed % Math.max(1, pool.length);
    let cursor = offset;
    for (const cost of costs) {
      const want = SUGGESTED_CURVE[cost] ?? 0;
      const bucket = buckets.get(cost) ?? [];
      if (!bucket.length) continue;
      let placed = 0;
      let guard2 = 0;
      while (placed < want && guard2 < bucket.length * MAX_COPIES + bucket.length) {
        const c = bucket[cursor % bucket.length];
        cursor += 1;
        guard2 += 1;
        if (take(c)) placed += 1;
      }
    }
    const flat = [...pool].sort((a, b) => a.id < b.id ? -1 : 1);
    let guard = 0;
    while (deck.length < DECK.SIZE && guard < flat.length * MAX_COPIES + flat.length) {
      const c = flat[cursor % flat.length];
      cursor += 1;
      guard += 1;
      take(c);
    }
    if (deck.length < DECK.SIZE) {
      throw new Error(`\u9635\u8425 ${faction} \u5361\u6C60\u4E0D\u8DB3\u4EE5\u7EC4\u51FA ${DECK.SIZE} \u5F20\u5361\u7EC4\uFF08\u5F53\u524D ${deck.length} \u5F20\uFF0C\u6C60\u5B50\u4EC5 ${pool.length} \u79CD\uFF09`);
    }
    return deck.slice(0, DECK.SIZE);
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
      if (!canUseUnitSkill(state, side, ref.row, ref.col).ok) continue;
      const target = allUnits(state, foe).sort((a, b) => a.unit.hp - b.unit.hp)[0];
      if (target) {
        return { type: "USE_SKILL", row: ref.row, col: ref.col, target: { side: foe, row: target.row, col: target.col } };
      }
    }
    const lord = state.sides[side].lord;
    const lsk = lord.skillDef;
    if (lsk && !lord.skillUsedThisTurn && state.sides[side].command.cur >= (lsk.cost ?? 2)) {
      const effs = lsk.effects ?? [];
      const healEff = effs.find((e) => e.action === "heal");
      const selfDmg = effs.find((e) => e.action === "damage" && e.target?.lord && (e.target?.side === "self" || e.target?.side === "ally"));
      const draws = effs.filter((e) => e.action === "draw").reduce((a, e) => a + (e.value ?? 1), 0);
      const selfDiscard = effs.some((e) => e.action === "discard" && (e.target?.side === "self" || e.target?.side === "ally"));
      const hand = state.sides[side].hand;
      if (healEff) {
        const wounded = allUnits(state, side).filter((r) => r.unit.hp < r.unit.maxHp).sort((a, b) => a.unit.hp - b.unit.hp)[0];
        if (wounded) {
          return { type: "USE_LORD_SKILL", target: { side, row: wounded.row, col: wounded.col } };
        }
      } else if (selfDmg) {
        const dmg = selfDmg.value ?? 0;
        const safe = lord.hp - dmg > 12;
        const room = hand.length < 10 && state.sides[side].deck.length > 0;
        if (safe && room) return { type: "USE_LORD_SKILL" };
      } else if (selfDiscard && draws === 0) {
      } else if (selfDiscard && draws > 0) {
        const worst = hand.map((hc, i) => ({ hc, i })).sort((a, b) => a.hc.card.cost - b.hc.card.cost)[0];
        const avg = hand.reduce((a, hc) => a + hc.card.cost, 0) / Math.max(1, hand.length);
        if (worst && hand.length > 3 && worst.hc.card.cost < avg - 0.5 && state.sides[side].deck.length > 0) {
          return { type: "USE_LORD_SKILL", handIndex: worst.i };
        }
      } else {
        return { type: "USE_LORD_SKILL" };
      }
    }
    const spots = legalPlacements(state, side);
    const slotFor = (c) => {
      if (!isCharacter(c)) return void 0;
      return spots[0];
    };
    const playable = state.sides[side].hand.map((hc, i) => ({ hc, c: hc.card, i })).filter(({ hc }) => !isBanned(hc)).map((x) => ({ ...x, slot: slotFor(x.c) })).filter(({ c, slot }) => canPlayCard(state, side, c, slot).ok).sort((a, b) => b.c.cost - a.c.cost);
    for (const { c, i, slot } of playable) {
      return slot ? { type: "PLAY_CARD", cardIndex: i, row: slot.row, col: slot.col } : { type: "PLAY_CARD", cardIndex: i };
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
