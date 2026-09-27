/* ============================================================
   卡组构筑页（独立入口）

   ⚠️ 这是**第二个入口**，能力与战场页的「第 2 步：构筑卡组」是同一套：
     · 卡池来自 `Core.cardPool()`（引擎的阵营/公共池判定）
     · 同名上限来自 `Core.maxCopiesOf()`（基础兵 3 / 其余 1，ADR-065）
     · 卡组合法性来自 `Core.validateDeck()`
     · 存取一律经 `window.DeckStore`（服务端在不在由它判）
   从前这里每个规则都自己写了一份（上限写死 3/1、卡池来自 /api/users/.../cards、
   `api()` 还是先 r.json() 再判 r.ok），于是同一个规则在引擎、服务端、这个页面
   各有一份实现 —— 改一处忘一处就是静默漂移。现在页面**不判断规则**。

   数据源也不再依赖服务端：`data.bundle.js` + `core.bundle.js` 就是完整的卡牌目录，
   所以没有服务端时这个页面照样能用（只是卡组存本地浏览器）。
   ============================================================ */
(function () {
  var Core = window.Core;
  var GD = window.GameData;
  var Store = window.DeckStore;
  var Tile = window.CardTile;

  var state = {
    faction: 'shu', pool: [], saved: [], deck: new Map(), owned: {},
    editing: null, typeFilter: '', costFilter: null, search: '',
  };
  var data = null;                 // LoadedData（cardPool / validateDeck 要）
  var mode = 'probing';

  var $ = function (id) { return document.getElementById(id); };
  // 转义 / 效果文案 / 名称映射统一来自 CardTile，本文件不再各写一份
  var esc = Tile.esc;

  var TYPE_NAME = { troop: '兵种', general: '武将', strategist: '谋臣', tactic: '战法', event: '事件' };
  var FAC_NAME = { shu: '蜀', wei: '魏', wu: '吴', qun: '群雄', neutral: '中立' };

  var MAX = Core.DECK.SIZE;        // 张数也问引擎（core/src/constants.ts 的 DECK.SIZE）

  /** 实际能放几张 = min(同名上限, 拥有数)。
   *  上限来自 core（规则），拥有数来自服务端（玩家状态）；本地模式没有拥有数 → 只看上限。 */
  function capOf(c) {
    var cap = Core.maxCopiesOf(c);
    var owned = state.owned[c.id];
    return owned == null ? cap : Math.min(cap, owned);
  }

  function lordOf(faction) {
    var hs = (GD && GD.heroes) || [];
    for (var i = 0; i < hs.length; i++) {
      if (hs[i].faction === faction && hs[i].type === 'lord') return hs[i].id;
    }
    return null;
  }

  /** 按当前阵营重建数据（主公跟着阵营走，与 setup.js 的 dataForFactions 同做法） */
  function rebuild() {
    data = Core.loadData({ cards: GD.cards, heroes: GD.heroes }, {
      own: lordOf(state.faction),
      enemy: lordOf(state.faction === 'shu' ? 'wei' : 'shu'),
    });
  }

  /** 不与已保存卡组重名的默认名（连建几套不会得到一串同名条目，看着像没建成） */
  function uniqueName(base) {
    var taken = {};
    state.saved.forEach(function (d) { taken[d.name] = true; });
    if (!taken[base]) return base;
    for (var i = 2; i < 999; i += 1) {
      if (!taken[base + ' ' + i]) return base + ' ' + i;
    }
    return base;
  }

  function card(id) { return data.cards.get(id); }
  function deckIds() {
    var ids = [];
    state.deck.forEach(function (q, id) { for (var i = 0; i < q; i++) ids.push(id); });
    return ids;
  }

  /* ---------- 渲染 ---------- */

  function renderFilters() {
    var types = [['', '全部'], ['troop', '兵种'], ['general', '武将'], ['strategist', '谋臣'], ['tactic', '战法'], ['event', '事件']];
    $('type-filters').innerHTML = types.map(function (t) {
      return '<button class="' + (state.typeFilter === t[0] ? 'active' : '') + '" data-type-filter="' + t[0] + '">' + t[1] + '</button>';
    }).join('');
    var costs = [null, 0, 1, 2, 3, 4, 5, 6, 7, 8];
    $('cost-filters').innerHTML = costs.map(function (v) {
      return '<button class="' + (state.costFilter === v ? 'active' : '') + '" data-cost-filter="' + (v === null ? 'all' : v) + '">'
        + (v === null ? '全部' : v + '费') + '</button>';
    }).join('');
  }

  function renderCards() {
    var q = state.search.toLowerCase();
    var total = deckIds().length;
    var shown = state.pool.filter(function (c) {
      if (state.typeFilter && c.type !== state.typeFilter) return false;
      if (state.costFilter !== null && c.cost !== state.costFilter) return false;
      if (q && (String(c.name) + ' ' + c.id).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    $('cards').innerHTML = shown.map(function (c) {
      var n = state.deck.get(c.id) || 0;
      var cap = capOf(c);                             // min(引擎上限, 服务端拥有数)
      var disabled = n >= cap || total >= MAX;
      return Tile.render(c, {
        count: n, cap: cap,
        owned: state.owned[c.id],                     // 本地模式没有 → 不显示「拥有 N 张」
        action: {
          attr: 'data-add',
          label: n >= cap ? '已满' : (total >= MAX ? '卡组满' : '加入'),
          disabled: disabled,
        },
      });
    }).join('') || Tile.empty('当前阵营没有符合条件的卡牌');
  }

  function renderDeck() {
    var entries = [];
    state.deck.forEach(function (q, id) { entries.push([id, q]); });
    var total = deckIds().length;
    $('count').textContent = total + ' / ' + MAX;
    $('deck').innerHTML = entries.map(function (e) {
      var c = card(e[0]);
      return '<div class="deckrow"><span><b>' + esc(c.name) + '</b>'
        + '<small class="deck-card-info"> ' + c.cost + '费 · ' + (FAC_NAME[c.faction] || c.faction)
        + ' · ' + (TYPE_NAME[c.type] || c.type) + '</small></span>'
        + '<span class="actions"><button data-minus="' + c.id + '">−</button> ' + e[1]
        + ' <button data-plus="' + c.id + '">+</button></span></div>';
    }).join('') || '<div class="empty">点击左侧卡牌加入卡组</div>';

    // 合法性一律问 Core（含同名上限、阵营池、张数）
    var chk = Core.validateDeck(data, state.faction, deckIds());
    var summary;
    if (total < MAX) {
      // 还没配满时，主信息是"还差几张"；只有 size 以外的问题（阵营/同名上限）才值得单独列，
      // 否则会得到「✗ 卡组必须 30 张，当前 0 张」+「⚠ 只有 0 种卡」这种对"还没开始配"过吵的两行
      var others = chk.errors.filter(function (e) { return e.kind !== 'size'; });
      summary = '还需要 ' + (MAX - total) + ' 张卡牌。'
        + others.slice(0, 2).map(function (e) { return '　✗ ' + e.message; }).join('');
    } else if (chk.ok && !chk.warnings.length) {
      summary = '✓ 卡组合法';
    } else {
      summary = chk.errors.slice(0, 3).map(function (e) { return '✗ ' + e.message; })
        .concat(chk.warnings.slice(0, 2).map(function (w) { return '⚠ ' + w.message; }))
        .join('　');
    }
    $('summary').textContent = summary;
    var saveBtn = $('save');
    if (saveBtn) {
      saveBtn.disabled = !chk.ok;
      saveBtn.textContent = state.editing ? '更新此卡组' : '保存卡组';
    }
    var asBtn = $('save-as');
    if (asBtn) asBtn.disabled = !chk.ok;
  }

  function render() { renderFilters(); renderCards(); renderDeck(); }

  /** 收藏数（「拥有 N 张」）。服务端才有；本地模式拿到空对象 → 瓦片不显示这一项。 */
  function loadCollection() {
    return Store.collection(state.faction).then(function (owned) {
      state.owned = owned || {};
      renderCards();
    }).catch(function () { state.owned = {}; });
  }

  function setStatus(message, bad) {
    $('status').textContent = message;
    $('status').className = bad ? 'notice bad' : 'notice ok';
  }

  /* ---------- 已保存卡组（经 DeckStore，两种模式通用） ---------- */

  function refreshSaved() {
    return Store.init().then(function (m) {
      mode = m;
      return Store.list();
    }).then(function (decks) {
      state.saved = decks || [];
      renderSaved();
    }).catch(function (e) { setStatus('读取卡组列表失败：' + e.message, true); });
  }

  function renderSaved() {
    var modeLine = mode === 'server'
      ? '<span style="color:#8dca9e">已连接服务端（server/game.db）</span>'
      : '<span style="color:#d5b16a">本地模式 · 卡组已存进这个浏览器（保存没问题，只是不跨浏览器／跨端口）</span>';
    $('saved').innerHTML = '<h2>已保存卡组'
      + (state.saved.length ? '（' + state.saved.length + ' 套）' : '')
      + '　' + modeLine + '</h2>'
      + (state.saved.map(function (d) {
        return '<div class="savedrow"><span class="saved-name">' + esc(d.name) + ' · '
          + (FAC_NAME[d.faction] || d.faction) + ' · ' + d.revision + ' 版'
          + (d.synced ? '' : ' · 仅本机') + '</span>'
          + '<span class="saved-actions"><button data-load="' + esc(d.id) + '">载入</button>'
          + '<button class="danger" data-delete="' + esc(d.id) + '">删除</button></span></div>';
      }).join('') || '<div class="empty">还没有保存的卡组</div>');
  }

  function loadDeck(id) {
    return Store.get(id).then(function (d) {
      if (!d) throw new Error('卡组不存在');
      state.editing = d.id;
      state.faction = d.faction;
      state.deck = new Map(d.cards.map(function (x) { return [x.cardId, x.quantity]; }));
      $('faction').value = d.faction;
      $('deck-name').value = d.name;
      rebuild();
      state.pool = Core.cardPool(data, state.faction);
      setStatus('已载入「' + d.name + '」');
      render();
    });
  }

  function saveDeck() {
    var chk = Core.validateDeck(data, state.faction, deckIds());
    if (!chk.ok) { setStatus('卡组不合格：' + chk.errors[0].message, true); return; }
    var cards = [];
    state.deck.forEach(function (q, id) { cards.push({ cardId: id, quantity: q }); });
    $('save').disabled = true;
    Store.save({
      name: ($('deck-name').value || '').trim() || '未命名卡组',
      faction: state.faction,
      cards: cards,
    }, state.editing).then(function (d) {
      state.editing = d.id;
      setStatus(mode === 'local' ? '已保存到本地浏览器（这套只在本机）' : '已保存到服务端');
      renderDeck();          // 保存按钮的文案跟着 editing 变（保存卡组 ⇄ 更新此卡组）
      return refreshSaved();
    }).catch(function (e) { setStatus('保存失败：' + e.message, true); renderDeck(); });
  }

  function deleteDeck(id, name) {
    if (!window.confirm('确定删除卡组「' + name + '」吗？此操作无法撤销。')) return;
    Store.remove(id).then(function () {
      if (state.editing === id) { state.editing = null; state.deck.clear(); $('deck-name').value = '我的卡组'; render(); }
      setStatus('已删除「' + name + '」');
      return refreshSaved();
    }).catch(function (e) { setStatus('删除失败：' + e.message, true); });
  }

  /* ---------- 筛选器（把 HTML 里的 <select id="type"> 换成平铺按钮） ---------- */

  function installFilters() {
    var type = $('type');
    type.outerHTML = '<div class="filter-row"><span class="filter-label">类型</span><div id="type-filters" class="filter-buttons"></div></div>'
      + '<div class="filter-row"><span class="filter-label">费用</span><div id="cost-filters" class="filter-buttons"></div></div>';
    var style = document.createElement('style');
    style.textContent = '.filter-row{display:flex;align-items:flex-start;gap:8px;margin:0 0 8px}'
      + '.filter-label{flex:0 0 34px;color:var(--muted);font-size:12px;padding:6px 0}'
      + '.filter-buttons{display:flex;gap:5px;flex-wrap:wrap}.filter-buttons button{padding:5px 9px;font-size:12px}'
      + '.filter-buttons button.active{background:var(--gold);border-color:#bd9855;color:#241c10;font-weight:700}';
    document.head.appendChild(style);
  }

  /* ---------- 事件 ---------- */

  $('faction').addEventListener('change', function (e) {
    state.faction = e.target.value;
    state.deck.clear(); state.editing = null;
    rebuild();
    state.pool = Core.cardPool(data, state.faction);
    render();
    loadCollection();                   // 收藏数跟着阵营走
  });
  $('search').addEventListener('input', function (e) {
    state.search = e.target.value;
    renderCards();                       // 只重渲列表，输入框不失焦
  });
  installFilters();
  $('type-filters').addEventListener('click', function (e) {
    if (e.target.dataset.typeFilter !== undefined) { state.typeFilter = e.target.dataset.typeFilter; render(); }
  });
  $('cost-filters').addEventListener('click', function (e) {
    if (e.target.dataset.costFilter !== undefined) {
      state.costFilter = e.target.dataset.costFilter === 'all' ? null : Number(e.target.dataset.costFilter);
      render();
    }
  });
  $('cards').addEventListener('click', function (e) {
    var id = e.target.dataset.add;
    if (!id) return;
    var c = card(id), cap = capOf(c), n = state.deck.get(id) || 0;
    if (n < cap && deckIds().length < MAX) state.deck.set(id, n + 1);
    render();
  });
  $('deck').addEventListener('click', function (e) {
    var id = e.target.dataset.plus || e.target.dataset.minus;
    if (!id) return;
    var n = state.deck.get(id) || 0;
    if (e.target.dataset.plus) state.deck.set(id, n + 1);
    else if (n <= 1) state.deck.delete(id);
    else state.deck.set(id, n - 1);
    render();
  });
  $('saved').addEventListener('click', function (e) {
    if (e.target.dataset.load) loadDeck(e.target.dataset.load).catch(function (err) { setStatus(err.message, true); });
    if (e.target.dataset.delete) {
      var hit = state.saved.filter(function (d) { return d.id === e.target.dataset.delete; })[0];
      deleteDeck(e.target.dataset.delete, hit ? hit.name : '该卡组');
    }
  });
  $('new').addEventListener('click', function () {
    state.editing = null; state.deck.clear();
    $('deck-name').value = uniqueName('我的卡组');
    setStatus('已新建空卡组（保存时会新建一套，不会覆盖已保存的）');
    render();
  });
  // 另存为：把这套复制成新的一套（editingId 置空 → 走新建），名字自动去重
  $('save-as').addEventListener('click', function () {
    state.editing = null;
    $('deck-name').value = uniqueName(String($('deck-name').value || '我的卡组').replace(/ \d+$/, ''));
    render();
    saveDeck();
  });
  $('save').addEventListener('click', saveDeck);

  /* ---------- 启动 ---------- */

  rebuild();
  state.pool = Core.cardPool(data, state.faction);
  render();
  loadCollection();
  Store.init().then(function (m) {
    mode = m;
    setStatus(m === 'server'
      ? '已连接服务端（卡组存 server/game.db）'
      : '本地模式：卡组会存进这个浏览器 —— 保存照常可用，只是不跨浏览器／跨端口');
    return refreshSaved();
  }).catch(function (e) { setStatus('初始化失败：' + e.message, true); });
})();
