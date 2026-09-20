/* ============================================================
   开局流程：阵营 → 构筑 → 换牌

   规则 100% 来自 core（validateDeck / cardPool / mulligan / createMatch），
   本文件只做三件事：渲染、收集玩家选择、把结果交给战场。
   不允许在这里出现任何规则判断（能否带某张卡、卡组合不合法，全部问 Core）。

   对外接口：
     Setup.open({ data, onStart })
       data    —— Core.loadData(...) 的结果
       onStart —— function(cfg)  cfg = {
                    ownFaction, enemyFaction,
                    ownDeck, enemyDeck,        // 卡 id 数组
                    ownMulligan,               // 要换掉的手牌下标
                    baseState,                 // createMatch + mulligan 之后的 MatchState
                  }
   ============================================================ */
(function () {
  var Core = window.Core;
  var GD = window.GameData;

  var DESIGN_W = 736;
  var data = null;
  var onStart = null;
  var step = 0;                  // 0 阵营 / 1 构筑 / 2 换牌
  var ownFaction = 'shu';
  var enemyFaction = 'wei';
  var deck = [];                 // 己方卡组（id 数组，可重复）
  var costFilter = null;
  var typeFilter = null;
  var baseState = null;          // createMatch 之后、mulligan 之前
  var mulliganOut = {};          // 下标 → true（要换掉）

  var $ = function (s) { return document.querySelector(s); };
  var esc = function (t) {
    return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  var TYPE_NAME = {
    troop: '兵种', general: '武将', strategist: '谋臣',
    event: '事件', tactic: '战法', token: '衍生物', elite: '精英', special: '特殊', status: '状态',
  };
  var FAC_NAME = { shu: '蜀', wei: '魏', wu: '吴', qun: '群雄', neutral: '中立' };

  /** 一张卡的展示用文本（技能文案优先，没技能就显示关键词或备忘） */
  function cardText(c) {
    var sk = (c.skills || [])[0];
    if (sk && sk.text) return sk.text;
    if ((c.keywords || []).length) return '关键词：' + c.keywords.join('、');
    if (c.memo) return c.memo;
    return '';
  }

  /* ============================================================
     渲染
     ============================================================ */

  function render() {
    var el = $('#setup');
    if (step === 0) el.innerHTML = viewFaction();
    else if (step === 1) el.innerHTML = viewDeck();
    else el.innerHTML = viewMulligan();
    el.classList.add('show');
    document.body.classList.add('is-setup');   // 隐藏调试面板，避免盖住开局界面
    bind();
  }

  function steps(cur) {
    var names = ['选择阵营', '构筑卡组', '换牌'];
    return '<div class="steps">' + names.map(function (n, i) {
      return '<span class="' + (i === cur ? 'on' : '') + '">' + (i + 1) + '. ' + n + '</span>';
    }).join('<span>→</span>') + '</div>';
  }

  /* ---------- 第 1 步：阵营 ---------- */
  function viewFaction() {
    var fs = Core.PLAYABLE_FACTIONS;
    function pick(sel, which) {
      return fs.map(function (f) {
        return '<button data-set="' + which + '" data-f="' + f + '" class="' + (sel === f ? 'on' : '') + '">'
          + FAC_NAME[f] + '</button>';
      }).join('');
    }
    return '<h2>《酒话三国》· 对局设置</h2>' + steps(0)
      + '<div style="margin:10px 0 4px">我方阵营：<span class="filters">' + pick(ownFaction, 'own') + '</span></div>'
      + '<div style="margin:6px 0 4px">敌方阵营：<span class="filters">' + pick(enemyFaction, 'enemy') + '</span></div>'
      + '<div style="color:var(--dim);margin-top:10px;line-height:1.7">'
      + '· 卡组 30 张，同名上限 2 张<br>'
      + '· 可用卡池 = <b>本方阵营</b> + <b>公共池</b>（中立 + 群雄），群雄不是可选阵营<br>'
      + '· 主公由阵营自动任命，不进卡组<br>'
      + '· 先手由掷点决定，后手第 1 回合多抽 1 张（补偿先手优势）'
      + '</div>'
      + '<div class="acts" style="margin-topauto;margin-top:16px">'
      + '<button class="primary" data-act="toDeck">下一步：构筑卡组</button></div>';
  }

  /* ---------- 第 2 步：构筑 ---------- */
  function pool() { return Core.cardPool(data, ownFaction); }

  function countOf(id) { return deck.filter(function (x) { return x === id; }).length; }

  function viewDeck() {
    var all = pool();
    var shown = all.filter(function (c) {
      if (costFilter !== null && c.cost !== costFilter) return false;
      if (typeFilter && c.type !== typeFilter) return false;
      return true;
    });
    // 排序：费用 → 类型 → 名称
    var TO = { troop: 0, general: 1, strategist: 2, tactic: 3, event: 4 };
    shown.sort(function (a, b) {
      return a.cost - b.cost || (TO[a.type] || 9) - (TO[b.type] || 9)
        || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    });

    var costs = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    var costBtns = '<button data-cost="all" class="' + (costFilter === null ? 'on' : '') + '">全部</button>'
      + costs.map(function (k) {
        return '<button data-cost="' + k + '" class="' + (costFilter === k ? 'on' : '') + '">' + k + '费</button>';
      }).join('');
    var typeBtns = '<button data-type="all" class="' + (typeFilter === null ? 'on' : '') + '">全类型</button>'
      + ['troop', 'general', 'strategist', 'tactic', 'event'].map(function (t) {
        return '<button data-type="' + t + '" class="' + (typeFilter === t ? 'on' : '') + '">'
          + TYPE_NAME[t] + '</button>';
      }).join('');

    var rows = shown.map(function (c) {
      var n = countOf(c.id);
      var maxed = n >= Core.MAX_COPIES;
      return '<div class="crow' + (maxed ? ' maxed' : '') + '" data-add="' + c.id + '" title="' + esc(cardText(c)) + '">'
        + '<span class="cst">' + c.cost + '</span>'
        + '<span class="nm">' + esc(c.name) + '</span>'
        + '<span class="st">' + (c.attack != null ? c.attack + '/' + c.health : '—') + '</span>'
        + '<span class="kind">' + (TYPE_NAME[c.type] || c.type) + '</span>'
        + '<span class="tx">' + esc(cardText(c).slice(0, 40)) + '</span>'
        + '<span class="n">' + (n ? n : '') + '</span>'
        + '</div>';
    }).join('');

    // 己方卡组按费用聚合
    var uniq = {};
    deck.forEach(function (id) { uniq[id] = (uniq[id] || 0) + 1; });
    var deckRows = Object.keys(uniq).map(function (id) {
      var c = data.cards.get(id);
      return { c: c, n: uniq[id] };
    }).sort(function (a, b) { return a.c.cost - b.c.cost; }).map(function (x) {
      return '<div class="crow" data-del="' + x.c.id + '">'
        + '<span class="cst">' + x.c.cost + '</span>'
        + '<span class="nm">' + esc(x.c.name) + '</span>'
        + '<span class="st">' + (x.c.attack != null ? x.c.attack + '/' + x.c.health : '—') + '</span>'
        + '<span class="tx"></span>'
        + '<span class="n">×' + x.n + '</span>'
        + '</div>';
    }).join('') || '<div style="color:var(--dim);padding:8px">还没有卡牌，点左边加入，或按「自动组卡」</div>';

    // 曲线（直接用引擎的建议曲线做对照）
    var hist = {};
    deck.forEach(function (id) { var k = data.cards.get(id).cost; hist[k] = (hist[k] || 0) + 1; });
    var maxN = Math.max(1, Math.max.apply(null, costs.map(function (k) { return hist[k] || 0; })));
    var curve = costs.map(function (k) {
      var n = hist[k] || 0, want = Core.SUGGESTED_CURVE[k] || 0;
      var h = Math.round(n / maxN * 34);
      return '<div class="bar' + (n > want + 2 ? ' over' : '') + '"><i style="height:' + h + 'px"></i>'
        + '<b>' + k + '</b></div>';
    }).join('');

    var chk = Core.validateDeck(data, ownFaction, deck);
    var msg = '';
    if (chk.errors.length) {
      msg += chk.errors.slice(0, 4).map(function (e) { return '<div class="err">✗ ' + esc(e.message) + '</div>'; }).join('');
    }
    if (chk.warnings.length) {
      msg += chk.warnings.slice(0, 3).map(function (w) { return '<div class="warn">⚠ ' + esc(w.message) + '</div>'; }).join('');
    }
    if (!chk.errors.length && !chk.warnings.length && deck.length === 30) {
      msg += '<div class="ok">✓ 卡组合法（30 张，同名 ≤2）</div>';
    }

    return '<h2>构筑卡组 · ' + FAC_NAME[ownFaction] + ' vs ' + FAC_NAME[enemyFaction] + '</h2>' + steps(1)
      + '<div class="body">'
      + '<div class="col pool"><div class="hd"><span class="t">可用卡池</span>'
      + '<span class="filters">' + costBtns + '</span></div>'
      + '<div class="hd"><span class="filters">' + typeBtns + '</span>'
      + '<span style="color:var(--dim)">' + shown.length + ' 张</span></div>'
      + '<div class="list" id="pool-list">' + rows + '</div></div>'
      + '<div class="col deck"><div class="hd"><span class="t">卡组</span>'
      + '<b style="color:' + (deck.length === 30 ? '#9fd0a4' : '#e08a7a') + '">' + deck.length + ' / 30</b>'
      + '<span class="acts">'
      + '<button data-act="auto">自动组卡</button>'
      + '<button data-act="clear">清空</button>'
      + '</span></div>'
      + '<div class="curve">' + curve + '</div>'
      + '<div class="list">' + deckRows + '</div>'
      + '<div class="msg">' + msg + '</div>'
      + '<div class="acts">'
      + '<button data-act="back">← 上一步</button>'
      + '<button class="primary" data-act="toMulligan"' + (chk.ok ? '' : ' disabled') + '>下一步：换牌</button>'
      + '</div></div></div>';
  }

  /* ---------- 第 3 步：换牌 ---------- */
  function viewMulligan() {
    var hand = baseState.sides.own.hand;
    var first = baseState.active === 'own';
    var picks = hand.map(function (hc, i) {
      var c = hc.card;
      var out = mulliganOut[i];
      return '<div class="pick' + (out ? ' out' : '') + '" data-pick="' + i + '">'
        + '<div class="pn">' + esc(c.name) + '</div>'
        + '<div class="ps">' + c.cost + ' 费　' + (c.attack != null ? c.attack + '/' + c.health : TYPE_NAME[c.type]) + '</div>'
        + '<div class="pt">' + esc(cardText(c).slice(0, 60)) + '</div>'
        + '<div class="pflag">' + (out ? '换掉' : '') + '</div>'
        + '</div>';
    }).join('');
    var n = Object.keys(mulliganOut).length;
    return '<h2>换牌</h2>' + steps(2)
      + '<div style="color:var(--dim);margin-bottom:8px">'
      + (first ? '你是<b>先手</b>（起手 3 张）' : '你是<b>后手</b>（起手 4 张 + 第 1 回合多抽 1 张）')
      + '　·　点卡牌标记要换掉的，换 N 张补 N 张　·　<b>每局只有一次机会</b>'
      + '</div>'
      + '<div class="handpick">' + picks + '</div>'
      + '<div class="msg">' + (n ? '将换掉 ' + n + ' 张' : '不换牌也可以直接开始') + '</div>'
      + '<div class="acts">'
      + '<button data-act="backDeck">← 回构筑</button>'
      + '<button class="primary" data-act="start">开始对局</button>'
      + '</div>';
  }

  /* ============================================================
     事件绑定
     ============================================================ */

  function bind() {
    var el = $('#setup');
    el.querySelectorAll('[data-set]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.set === 'own') ownFaction = b.dataset.f; else enemyFaction = b.dataset.f;
        deck = [];                       // 换阵营 → 卡池变了，清空卡组
        render();
      });
    });
    el.querySelectorAll('[data-cost]').forEach(function (b) {
      b.addEventListener('click', function () {
        costFilter = b.dataset.cost === 'all' ? null : Number(b.dataset.cost);
        render();
      });
    });
    el.querySelectorAll('[data-type]').forEach(function (b) {
      b.addEventListener('click', function () {
        typeFilter = b.dataset.type === 'all' ? null : b.dataset.type;
        render();
      });
    });
    el.querySelectorAll('[data-add]').forEach(function (r) {
      r.addEventListener('click', function () {
        var id = r.dataset.add;
        if (countOf(id) >= Core.MAX_COPIES) return;      // 上限由引擎给，UI 只照做
        if (deck.length >= 30) return;
        deck.push(id);
        render();
      });
    });
    el.querySelectorAll('[data-del]').forEach(function (r) {
      r.addEventListener('click', function () {
        var i = deck.indexOf(r.dataset.del);
        if (i >= 0) deck.splice(i, 1);
        render();
      });
    });
    el.querySelectorAll('[data-pick]').forEach(function (r) {
      r.addEventListener('click', function () {
        var i = Number(r.dataset.pick);
        if (mulliganOut[i]) delete mulliganOut[i]; else mulliganOut[i] = true;
        render();
      });
    });
    el.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () { act(b.dataset.act); });
    });
  }

  function act(name) {
    if (name === 'toDeck') { step = 1; render(); return; }
    if (name === 'back') { step = 0; render(); return; }
    if (name === 'backDeck') { step = 1; render(); return; }
    if (name === 'auto') { deck = Core.autoDeck(data, ownFaction); render(); return; }
    if (name === 'clear') { deck = []; render(); return; }

    if (name === 'toMulligan') {
      var chk = Core.validateDeck(data, ownFaction, deck);
      if (!chk.ok) return;
      // 先建对局拿到起手（换牌必须"先看牌再决定"，所以不能用 setupMatch 一步做完）
      baseState = Core.createMatch({
        seed: (Date.now() % 100000) | 0,
        cards: data.cards,
        lords: data.lords,
        decks: { own: deck.slice(), enemy: Core.autoDeck(data, enemyFaction) },
        rollFirst: true,                     // GDD 03 §1：掷点定先手
      });
      mulliganOut = {};
      step = 2;
      render();
      return;
    }

    if (name === 'start') {
      var indices = Object.keys(mulliganOut).map(Number);
      var res = Core.mulligan(baseState, 'own', indices, data.cards);
      var st = res.ok ? res.state : baseState;
      // 敌方 AI 也换一次（换掉最贵的 2 张，简单启发式）
      var foeHand = st.sides.enemy.hand;
      var foeOut = foeHand.map(function (hc, i) { return { i: i, cost: hc.card.cost }; })
        .sort(function (a, b) { return b.cost - a.cost; }).slice(0, 2).map(function (x) { return x.i; });
      var res2 = Core.mulligan(st, 'enemy', foeOut, data.cards);
      if (res2.ok) st = res2.state;

      $('#setup').classList.remove('show');
      document.body.classList.remove('is-setup');
      onStart({
        ownFaction: ownFaction,
        enemyFaction: enemyFaction,
        ownDeck: deck.slice(),
        ownMulligan: indices,
        baseState: st,
      });
    }
  }

  window.Setup = {
    open: function (opts) {
      data = opts.data;
      onStart = opts.onStart;
      step = 0; deck = []; costFilter = null; typeFilter = null;
      baseState = null; mulliganOut = {};
      render();
    },
    /** 重开时回到构筑（保留上次的阵营与卡组） */
    reopen: function () { step = 1; render(); },
  };
})();
