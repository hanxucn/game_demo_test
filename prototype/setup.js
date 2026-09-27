/* ============================================================
   开局流程：阵营 → 构筑 → 换牌

   规则 100% 来自 core（validateDeck / cardPool / mulligan / createMatch），
   本文件只做三件事：渲染、收集玩家选择、把结果交给战场。
   不允许在这里出现任何规则判断（能否带某张卡、卡组合不合法，全部问 Core）。

   卡组的存取一律经 `window.DeckStore`（见 deck-store.js）—— 服务端在不在由它判，
   本文件不出现 fetch / localStorage，也不需要知道卡组存在 SQLite 还是浏览器里。

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
  var Tile = window.CardTile;      // 卡牌瓦片（与构筑页 / 卡牌测试页共用一份实现）

  var DESIGN_W = 736;
  var MAX = Core.DECK.SIZE;      // 卡组张数问引擎（core/src/constants.ts），不写死
  var data = null;
  var matchData = null;   // 按所选阵营重建的数据（主公正确）
  var onStart = null;
  var step = 0;                  // 0 阵营 / 1 构筑 / 2 换牌
  var ownFaction = 'shu';
  var enemyFaction = 'wei';
  var deck = [];                 // 己方卡组（id 数组，可重复）
  var costFilter = null;
  var typeFilter = null;
  var search = '';               // 卡池搜索（名称 / id）
  var baseState = null;          // createMatch 之后、mulligan 之前
  var mulliganOut = {};          // 下标 → true（要换掉）

  // —— 卡组持久化：一律走 DeckStore，本文件**不直接碰 fetch / localStorage** ——
  //    这样「服务端在不在」只由 DeckStore 判一次，两种模式的降级不会各写一遍。
  var savedDecks = [];           // 已保存卡组摘要
  var storeMode = 'probing';     // 'probing' | 'server' | 'local'
  var pendingLocal = 0;          // 离线攒下、尚未同步到服务端的卡组数
  var deckName = '我的卡组';
  var editingId = null;          // 正在编辑的已保存卡组 id（保存走覆盖，null 则新建）
  var notice = '';               // 保存 / 删除 / 载入后的反馈
  var noticeBad = false;
  var owned = {};                // cardId → 拥有张数（只有服务端有；本地模式为空对象）

  var $ = function (s) { return document.querySelector(s); };
  var esc = Tile.esc;             // 与另外两个页面共用同一份转义

  var TYPE_NAME = {
    troop: '兵种', general: '武将', strategist: '谋臣',
    event: '事件', tactic: '战法', token: '衍生物', elite: '精英', special: '特殊', status: '状态',
  };
  var FAC_NAME = { shu: '蜀', wei: '魏', wu: '吴', qun: '群雄', neutral: '中立' };


  /**
   * 阵营 → 主公 id（从 GameData.heroes 里找 type==='lord' 的那条）。
   * 必须在开局时按**实际所选阵营**重建 lords —— 原先 battlefield.engine.js 里
   * 把 loadData 的主公写死成 刘备/曹操，导致选吴也照样出刘备。
   */
  function lordIdOf(faction) {
    var hs = (window.GameData && window.GameData.heroes) || [];
    for (var i = 0; i < hs.length; i++) {
      if (hs[i].faction === faction && hs[i].type === 'lord') return hs[i].id;
    }
    return null;
  }

  /** 按当前所选阵营重建一份数据（cards 与阵营无关，lords 必须跟着阵营走） */
  function dataForFactions() {
    return Core.loadData(
      { cards: window.GameData.cards, heroes: window.GameData.heroes },
      { own: lordIdOf(ownFaction), enemy: lordIdOf(enemyFaction) },
    );
  }

  /** 一张卡的展示用文本 —— 与另外两个页面共用 CardTile 的实现（含关键词中文名映射） */
  var cardText = Tile.effectText;

  /** 实际能放几张 = min(同名上限, 拥有数)。
   *  上限来自 core（规则），拥有数来自服务端（玩家状态）；本地模式没有拥有数 → 只看上限。 */
  function capOf(c) {
    var cap = Core.maxCopiesOf(c);
    var n = owned[c.id];
    return n == null ? cap : Math.min(cap, n);
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
    // 三家的主公都在原始数据包里；data.lords 只有 {own, enemy} 两个占位，
    // 而这一步恰恰还没选阵营 —— 所以必须读 GameData.heroes。
    var heroes = (window.GameData && window.GameData.heroes) || [];

    function lordOf(f) {
      for (var i = 0; i < heroes.length; i++) {
        if (heroes[i].faction === f && heroes[i].type === 'lord') return heroes[i];
      }
      return null;
    }
    function pick(sel, which) {
      return fs.map(function (f) {
        var l = lordOf(f);
        var sk = l && l.skills && l.skills[0];
        return '<button class="fcard fac-' + f + (sel === f ? ' on' : '') + '"'
          + ' data-set="' + which + '" data-f="' + f + '">'
          + '<b class="fname">' + FAC_NAME[f] + '</b>'
          + '<span class="flord">' + (l ? l.name + ' · ' + l.hp + ' 血' : '') + '</span>'
          + '<span class="fskill">' + (sk ? sk.name : '') + '</span>'
          + '</button>';
      }).join('');
    }

    return '<div class="s-panel is-narrow">'
      + '<h2>《酒话三国》</h2>'
      + '<div class="sub">选择双方阵营 · 主公由阵营自动任命</div>'
      + steps(0)
      + '<div class="frow"><span class="lab">我方</span>' + pick(ownFaction, 'own') + '</div>'
      + '<div class="frow"><span class="lab">敌方</span>' + pick(enemyFaction, 'enemy') + '</div>'
      + '<div class="rules">'
      + '· 卡组 30 张，' + copiesRuleText() + '<br>'
      + '· 可用卡池 = <b>本方阵营</b> + <b>公共池</b>（中立 + 群雄），群雄不是可选阵营<br>'
      + '· 主公由阵营自动任命，不进卡组<br>'
      + '· 先手由掷点决定，后手第 1 回合多抽 1 张（补偿先手优势）'
      + '</div>'
      + '<div class="acts" style="margin-top:16px">'
      + '<button class="primary" data-act="toDeck">下一步：构筑卡组</button></div>'
      + '</div>';
  }

  /* ---------- 第 2 步：构筑 ---------- */
  function pool() { return Core.cardPool(data, ownFaction); }

  /* ---------- 卡组存取：全部委托给 DeckStore ---------- */

  function refreshSavedDecks() {
    if (!window.DeckStore) return Promise.resolve();
    return window.DeckStore.init().then(function (m) {
      storeMode = m;
      pendingLocal = window.DeckStore.pendingCount();
      // 收藏数（「拥有 N 张」）只有服务端有；本地模式拿到空对象 → 瓦片不显示这一项
      return window.DeckStore.collection(ownFaction).then(function (own) {
        owned = own || {};
        // 不按阵营过滤：别的阵营的卡组也列出来（置灰），玩家能看到自己有哪些牌组
        return window.DeckStore.list();
      });
    }).then(function (decks) {
      savedDecks = decks || [];
      if (step === 1) render();
    }).catch(function () { savedDecks = []; owned = {}; });
  }

  function loadSavedDeck(id) {
    return window.DeckStore.get(id).then(function (saved) {
      if (!saved) throw new Error('卡组不存在');
      if (saved.faction !== ownFaction) {
        throw new Error('该卡组属于' + (FAC_NAME[saved.faction] || saved.faction) + '，当前阵营不可用');
      }
      deck = window.DeckStore.toIds(saved);
      deckName = saved.name;
      editingId = saved.id;            // 载入后保存 = 覆盖这套
      notice = '已载入「' + saved.name + '」（' + deck.length + ' 张）';
      noticeBad = false;
      render();
    });
  }

  function saveDeck() {
    // 规则一律问 Core：不合法就不该写进任何存储
    var chk = Core.validateDeck(data, ownFaction, deck);
    if (!chk.ok) {
      notice = '卡组不合格，无法保存：' + (chk.errors[0] ? chk.errors[0].message : '');
      noticeBad = true;
      render();
      return;
    }
    var payload = {
      name: (deckName || '').trim() || '未命名卡组',
      faction: ownFaction,
      cards: window.DeckStore.toCards(deck),
    };
    notice = '保存中…'; noticeBad = false; render();
    window.DeckStore.save(payload, editingId).then(function (d) {
      editingId = d.id;
      deckName = d.name;
      notice = storeMode === 'local'
        ? '已保存到本地浏览器（服务端未启动）'
        : '已保存到服务端';
      noticeBad = false;
      return refreshSavedDecks();
    }).then(function () { render(); })
      .catch(function (e) {
        notice = '保存失败：' + e.message;
        noticeBad = true;
        render();
      });
  }

  function deleteDeck(id, name) {
    if (!window.confirm('确定删除卡组「' + name + '」吗？此操作无法撤销。')) return;
    window.DeckStore.remove(id).then(function () {
      if (editingId === id) { editingId = null; }   // 删的是当前编辑的 → 之后保存变为新建
      notice = '已删除「' + name + '」';
      noticeBad = false;
      return refreshSavedDecks();
    }).then(function () { render(); })
      .catch(function (e) { notice = '删除失败：' + e.message; noticeBad = true; render(); });
  }

  function pushLocalDecks() {
    notice = '上传中…'; render();
    window.DeckStore.pushLocal().then(function (r) {
      notice = r.failed.length
        ? ('已上传 ' + r.uploaded + ' 个，失败 ' + r.failed.length + ' 个：'
           + r.failed.map(function (f) { return f.name + '（' + f.error + '）'; }).join('；'))
        : ('已上传 ' + r.uploaded + ' 个本地卡组到服务端');
      noticeBad = r.failed.length > 0;
      return refreshSavedDecks();
    }).then(function () { render(); })
      .catch(function (e) { notice = '上传失败：' + e.message; noticeBad = true; render(); });
  }

  function countOf(id) { return deck.filter(function (x) { return x === id; }).length; }

  /**
   * 找一个不与已保存卡组重名的默认名：「我的卡组」→「我的卡组 2」→「我的卡组 3」。
   *
   * 为什么必须做：原先「新建」把名字固定写回「我的卡组」，于是连建几套不改名就是
   * 一串同名条目（实测三套全叫「我的卡组」），**看起来就像"只有一套 / 根本没建成"**。
   */
  function uniqueName(base) {
    var taken = {};
    savedDecks.forEach(function (d) { taken[d.name] = true; });
    if (!taken[base]) return base;
    for (var i = 2; i < 999; i += 1) {
      if (!taken[base + ' ' + i]) return base + ' ' + i;
    }
    return base;
  }

  /** 另存为：把当前这套复制成**新的一套**（editingId 置空 → 走新建），名字自动去重 */
  function saveDeckAs() {
    editingId = null;
    deckName = uniqueName(String(deckName || '我的卡组').replace(/ \d+$/, ''));
    notice = '';
    saveDeck();
  }

  /**
   * 同名上限的**文案也从 Core 生成**。
   * 原先第 1 步写死过「同名上限 2 张」，而 ADR-065 早已改成「基础兵 3 / 其余 1」——
   * 规则在引擎里、文案在 UI 里各存一份，就会这样悄悄脱节（整合时才发现）。
   */
  function copiesRuleText() {
    return '基础兵每种最多 ' + Core.maxCopiesOf({ type: 'troop' }) + ' 张，其余每种 '
      + Core.maxCopiesOf({ type: 'general' }) + ' 张';
  }

  /* ---------- 卡池 ---------- */

  /** 过滤 + 排序后的卡池。搜索/筛选变化时只重渲列表，以保住搜索框焦点。 */
  function shownPool() {
    var q = search.trim().toLowerCase();
    var shown = pool().filter(function (c) {
      if (costFilter !== null && c.cost !== costFilter) return false;
      if (typeFilter && c.type !== typeFilter) return false;
      if (q && (String(c.name) + ' ' + c.id).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var TO = { troop: 0, general: 1, strategist: 2, tactic: 3, event: 4 };
    shown.sort(function (a, b) {
      return a.cost - b.cost || (TO[a.type] || 9) - (TO[b.type] || 9)
        || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    });
    return shown;
  }

  function poolListHtml(shown) {
    return shown.map(function (c) {
      var n = countOf(c.id);
      var cap = capOf(c);                     // min(同名上限, 拥有数)
      var maxed = n >= cap;
      var full = deck.length >= MAX;
      return Tile.render(c, {
        count: n, cap: cap,
        owned: owned[c.id],                   // 本地模式没有 → 瓦片不显示「拥有 N 张」
        action: {
          attr: 'data-add',
          label: maxed ? '已满' : (full ? '卡组满' : '加入'),
          disabled: maxed || full,
        },
      });
    }).join('') || Tile.empty('没有符合条件的卡牌');
  }

  /** 只重渲卡池列表（搜索框打字时不能整块 render，否则输入框失焦） */
  function renderPool() {
    var list = $('#pool-list');
    if (!list) return;
    var shown = shownPool();
    list.innerHTML = poolListHtml(shown);
    var cnt = $('#pool-count');
    if (cnt) cnt.textContent = shown.length + ' 张';
    bindPoolRows($('#setup'));
  }

  /* ---------- 已保存卡组（含存储模式提示 / 未同步标记 / 删除） ---------- */

  function savedDecksHtml() {
    var modeLine = storeMode === 'server'
      ? '<span class="store-mode is-ok">服务端已连接 · 卡组存 server/game.db</span>'
      : storeMode === 'local'
        ? '<span class="store-mode is-local">本地模式 · 卡组已存进这个浏览器'
          + '（保存没问题，只是不跨浏览器、不跨端口）</span>'
        : '<span class="store-mode">正在检测服务端…</span>';

    var list = savedDecks.length
      ? '<div class="saved-deck-list">' + savedDecks.map(function (d) {
        var usable = d.faction === ownFaction;
        return '<span class="saved-item' + (usable ? '' : ' is-unavailable') + '">'
          + '<button class="saved-load" data-load-deck="' + esc(d.id) + '"' + (usable ? '' : ' disabled') + '>'
          + esc(d.name) + ' · ' + (FAC_NAME[d.faction] || d.faction)
          + (d.revision > 1 ? ' · ' + d.revision + ' 版' : '')
          + (d.synced ? '' : ' · 仅本机')
          + (usable ? '' : '（不可用）') + '</button>'
          + '<button class="saved-del" data-del-deck="' + esc(d.id) + '" title="删除这套卡组">✕</button>'
          + '</span>';
      }).join('') + '</div>'
      : '<div class="hint" style="margin:0">还没有保存的卡组 —— 左边的卡组凑满 30 张后点「保存卡组」</div>';

    // 离线攒下的卡组：服务端回来后给一个**显式**的上传入口，不自动覆盖也不自动丢弃
    var upload = (storeMode === 'server' && pendingLocal > 0)
      ? '<button class="saved-upload" data-act="pushLocal">上传 ' + pendingLocal + ' 个本地卡组到服务端</button>'
      : '';
    var pendingHint = (storeMode === 'local' && pendingLocal > 0)
      ? '<div class="hint" style="margin:6px 0 0">以上 ' + pendingLocal + ' 套已经保存好了，'
        + '只是只在本浏览器里。想让它们跨浏览器／跨机器，可启动 '
        + '<code>node server/index.mjs</code> 再上传到 server/game.db（可选，不是保存的前提）</div>'
      : '';

    return '<div class="saved-decks"><span class="saved-decks-label">已保存卡组'
      + (savedDecks.length ? '（' + savedDecks.length + ' 套）' : '')
      + '　' + modeLine + '</span>'
      + list + upload + pendingHint + '</div>';
  }

  function viewDeck() {
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

    var shown = shownPool();

    // 己方卡组按费用聚合
    var uniq = {};
    deck.forEach(function (id) { uniq[id] = (uniq[id] || 0) + 1; });
    var deckRows = Object.keys(uniq).map(function (id) {
      var c = data.cards.get(id);
      return { c: c, n: uniq[id] };
    }).sort(function (a, b) { return a.c.cost - b.c.cost; }).map(function (x) {
      // 紧凑行：卡组栏只有 32vh 高且排成多列，放不下卡池那种整行信息
      return '<div class="drow" data-del="' + x.c.id + '" title="点一下移除一张">'
        + '<span class="cst">' + x.c.cost + '</span>'
        + '<span class="nm">' + esc(x.c.name) + '</span>'
        + '<span class="n">×' + x.n + '</span>'
        + '</div>';
    }).join('') || '<div style="color:var(--dim);padding:8px">还没有卡牌，点上面加入，或按「自动组卡」</div>';

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
    if (notice) msg += '<div class="' + (noticeBad ? 'err' : 'ok') + '">' + esc(notice) + '</div>';
    if (chk.errors.length) {
      msg += chk.errors.slice(0, 4).map(function (e) { return '<div class="err">✗ ' + esc(e.message) + '</div>'; }).join('');
    }
    if (chk.warnings.length) {
      msg += chk.warnings.slice(0, 3).map(function (w) { return '<div class="warn">⚠ ' + esc(w.message) + '</div>'; }).join('');
    }
    if (!chk.errors.length && !chk.warnings.length && deck.length === MAX) {
      msg += '<div class="ok">✓ 卡组合法（30 张，' + copiesRuleText() + '）</div>';
    }

    return '<div class="s-panel is-tall">'
      + '<h2>构筑卡组 · ' + FAC_NAME[ownFaction] + ' vs ' + FAC_NAME[enemyFaction] + '</h2>' + steps(1)
      + savedDecksHtml()
      + '<div class="body">'
      // 卡池占满整宽并用共享瓦片（ADR-096）—— 瓦片要宽度才排得开列，故不再与卡组左右分栏
      + '<div class="col pool"><div class="hd"><span class="t">可用卡池</span>'
      + '<span class="filters">' + costBtns + '</span></div>'
      + '<div class="hd"><span class="filters">' + typeBtns + '</span>'
      + '<input id="pool-search" class="pool-search" placeholder="搜索名称 / ID" value="' + esc(search) + '">'
      + '<span id="pool-count" style="color:var(--dim)">' + shown.length + ' 张</span></div>'
      + '<div class="pool-scroll"><div id="pool-list" class="' + Tile.GRID_CLASS + '">'
      + poolListHtml(shown) + '</div></div></div>'
      + '<div class="col deck"><div class="hd"><span class="t">卡组</span>'
      + '<b style="color:' + (deck.length === MAX ? '#9fd0a4' : '#e08a7a') + '">' + deck.length + ' / ' + MAX + '</b>'
      + '<span class="acts">'
      + '<button data-act="auto">自动组卡</button>'
      + '<button data-act="clear">清空</button>'
      + '</span></div>'
      + '<div class="hd deckbar">'
      + '<input id="deck-name" class="deck-name" maxlength="32" placeholder="卡组名" value="' + esc(deckName) + '">'
      + '<button class="save" data-act="save"' + (chk.ok ? '' : ' disabled') + '>'
      + (editingId ? '更新此卡组' : '保存卡组') + '</button>'
      + '<button data-act="saveAs"' + (chk.ok ? '' : ' disabled')
      + ' title="把当前这套存成新的一套，不动原来那套">另存为</button>'
      + '<button data-act="newDeck" title="清空并开始建一套新的（不会删掉已保存的卡组）">新建</button>'
      + '</div>'
      + '<div class="curve">' + curve + '</div>'
      + '<div class="list decklist">' + deckRows + '</div>'
      + '<div class="msg">' + msg + '</div>'
      + '<div class="acts">'
      + '<button data-act="back">← 上一步</button>'
      + '<button class="primary" data-act="toMulligan"' + (chk.ok ? '' : ' disabled') + '>下一步：换牌</button>'
      + '</div></div></div></div>';   // acts + col.deck + body + .s-panel
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
    return '<div class="s-panel is-tall">'
      + '<h2>换牌</h2>' + steps(2)
      + '<div style="color:var(--dim);margin-bottom:8px">'
      + (first ? '你是<b>先手</b>（起手 3 张）' : '你是<b>后手</b>（起手 4 张 + 第 1 回合多抽 1 张）')
      + '　·　点卡牌标记要换掉的，换 N 张补 N 张　·　<b>每局只有一次机会</b>'
      + '</div>'
      + '<div class="handpick">' + picks + '</div>'
      + '<div class="msg">' + (n ? '将换掉 ' + n + ' 张' : '不换牌也可以直接开始') + '</div>'
      + '<div class="acts">'
      + '<button data-act="backDeck">← 回构筑</button>'
      + '<button class="primary" data-act="start">开始对局</button>'
      + '</div>'
      + '</div>';
  }

  /* ============================================================
     事件绑定
     ============================================================ */

  /** 卡池瓦片：点**整块**加卡（瓦片很大，只让「加入」按钮可点会让手感变差）。
   *  上限守卫照旧走 capOf —— 点满的瓦片不会加进去。列表重渲后必须重新绑。 */
  function bindPoolRows(el) {
    el.querySelectorAll('[data-ct-card]').forEach(function (tile) {
      tile.addEventListener('click', function () {
        var id = tile.dataset.ctCard;
        if (countOf(id) >= capOf(data.cards.get(id))) return;   // 上限由引擎给，UI 只照做
        if (deck.length >= MAX) return;
        deck.push(id);
        notice = '';
        render();
      });
    });
  }

  function bind() {
    var el = $('#setup');
    el.querySelectorAll('[data-set]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.set === 'own') ownFaction = b.dataset.f; else enemyFaction = b.dataset.f;
        deck = [];                       // 换阵营 → 卡池变了，清空卡组
        editingId = null;                // 别人阵营的卡组不能覆盖保存
        notice = '';
        render();
        if (step === 1) refreshSavedDecks();
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
    bindPoolRows(el);
    // 搜索：只重渲卡池列表，不整块 render —— 否则输入框每敲一个字就失焦
    var searchBox = $('#pool-search');
    if (searchBox) {
      searchBox.addEventListener('input', function () {
        search = searchBox.value;
        renderPool();
      });
    }
    var nameBox = $('#deck-name');
    if (nameBox) {
      nameBox.addEventListener('input', function () { deckName = nameBox.value; });
    }
    el.querySelectorAll('[data-del]').forEach(function (r) {
      r.addEventListener('click', function () {
        var i = deck.indexOf(r.dataset.del);
        if (i >= 0) deck.splice(i, 1);
        notice = '';
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
    el.querySelectorAll('[data-load-deck]').forEach(function (b) {
      b.addEventListener('click', function () {
        b.disabled = true;
        loadSavedDeck(b.dataset.loadDeck).catch(function (e) {
          notice = '载入失败：' + e.message;
          noticeBad = true;
          render();
        });
      });
    });
    el.querySelectorAll('[data-del-deck]').forEach(function (b) {
      b.addEventListener('click', function () {
        var d = savedDecks.filter(function (x) { return x.id === b.dataset.delDeck; })[0];
        deleteDeck(b.dataset.delDeck, d ? d.name : '该卡组');
      });
    });
    el.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () { act(b.dataset.act); });
    });
  }

  function act(name) {
    if (name === 'toDeck') { step = 1; notice = ''; render(); refreshSavedDecks(); return; }
    if (name === 'back') { step = 0; render(); return; }
    if (name === 'backDeck') { step = 1; render(); return; }
    if (name === 'auto') { deck = Core.autoDeck(data, ownFaction); notice = ''; render(); return; }
    if (name === 'clear') { deck = []; notice = ''; render(); return; }
    if (name === 'newDeck') {
      // 新建 = 清空 + 忘掉编辑身份（下次保存走新建而不是覆盖）。
      // 名字给一个**不重名**的默认值 —— 否则连建几套会得到一串同名条目，看着像没建成。
      deck = []; editingId = null; deckName = uniqueName('我的卡组');
      notice = '已新建空卡组（保存时会新建一套，不会覆盖已保存的）';
      noticeBad = false;
      render();
      return;
    }
    if (name === 'save') { saveDeck(); return; }
    if (name === 'saveAs') { saveDeckAs(); return; }
    if (name === 'pushLocal') { pushLocalDecks(); return; }

    if (name === 'toMulligan') {
      var chk = Core.validateDeck(data, ownFaction, deck);
      if (!chk.ok) return;
      // 先建对局拿到起手（换牌必须"先看牌再决定"，所以不能用 setupMatch 一步做完）
      matchData = dataForFactions();          // ← 主公跟着所选阵营走
      baseState = Core.createMatch({
        seed: (Date.now() % 100000) | 0,
        cards: matchData.cards,
        lords: matchData.lords,
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
      // 敌方 AI 也换一次 —— 交给 core 的 aiMulligan（ADR-086）：
      // 判据是「这张牌我第一个回合能不能用」，而不是"换掉最贵的 2 张"这种拍脑袋规则
      var foeOut = Core.aiMulligan(st, 'enemy', { cards: matchData.cards, lords: matchData.lords });
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
        cards: matchData.cards,
        lords: matchData.lords,      // 引擎必须用这份，否则又会退回写死的主公
      });
    }
  }

  window.Setup = {
    open: function (opts) {
      data = opts.data;
      onStart = opts.onStart;
      step = 0; deck = []; costFilter = null; typeFilter = null; search = '';
      baseState = null; mulliganOut = {};
      savedDecks = []; storeMode = 'probing'; pendingLocal = 0;
      deckName = '我的卡组'; editingId = null; notice = ''; noticeBad = false; owned = {};
      render();
      refreshSavedDecks();
    },
    /** 重开时回到构筑（保留上次的阵营与卡组） */
    reopen: function () { step = 1; notice = ''; render(); refreshSavedDecks(); },
  };
})();
