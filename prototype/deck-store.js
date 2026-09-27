/* ============================================================
   DeckStore —— 卡组持久化的**唯一知情者**

   它只回答一个问题：「卡组存哪儿，怎么取回来」。
   规则校验不在这里（那是 Core.validateDeck 的事），UI 也不在这里。

   两种模式，对调用方**完全透明**：
     · server —— 探测到 node server/index.mjs 在跑，卡组存 server/game.db
     · local  —— 没有服务端（tools/serve.sh 静态预览 / 直接双击 html），
                 卡组存浏览器 localStorage，功能不减，只是不跨机器

   为什么需要它：从前「卡组存哪儿」这件事散在 setup.js 与 deck-builder.js
   两处 fetch 里，于是两边各自实现了一遍探测与错误处理，还都踩了同一个坑
   —— 静态服务下 `/api/*` 返回的是 `404 text/html`（不是网络错误），
   直接 `r.json()` 会抛 `SyntaxError: Unexpected token '<'`。
   现在这个坑只在下面 probe() / api() 里各堵一次。

   ⚠️ localStorage 是按「源」隔离的：127.0.0.1 与 localhost、不同端口、
      file:// 与 http:// 各是一套库。tools/serve.sh 在 8099 被占时会自动
      跳端口 —— 那会换一个源，看不到原来的本地卡组。选本地模式就得接受这点。
   ============================================================ */
(function () {
  var USER = 'demo-user';
  var LS_KEY = 'jh3g.decks.v1';
  var PROBE_TIMEOUT = 2000;

  var mode = 'probing';        // 'probing' | 'server' | 'local'
  var modePromise = null;
  var localSeq = 0;

  /* ---------- 本地库（localStorage） ---------- */

  var hasLS = (function () {
    try {
      localStorage.setItem('__jh3g_probe__', '1');
      localStorage.removeItem('__jh3g_probe__');
      return true;
    } catch (e) { return false; }        // 隐私模式 / 被策略禁用
  })();

  function localRead() {
    if (!hasLS) return [];
    try {
      var parsed = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      return (parsed && Array.isArray(parsed.decks)) ? parsed.decks : [];
    } catch (e) { return []; }
  }
  function localWrite(decks) {
    if (!hasLS) return false;
    try { localStorage.setItem(LS_KEY, JSON.stringify({ v: 1, decks: decks })); return true; }
    catch (e) { return false; }          // 配额满
  }

  /** 本地卡组 id。前缀让它永远不会与服务端 uuid 撞车，可安全合并两份列表。 */
  function newLocalId() {
    localSeq += 1;
    return 'local-' + Date.now().toString(36) + '-' + localSeq.toString(36);
  }
  function isLocalId(id) { return String(id || '').indexOf('local-') === 0; }

  /* ---------- 形状归一：两种模式吐出**同一个形状** ---------- */

  function fromServer(row) {
    var out = {
      id: row.id,
      name: row.name,
      faction: row.faction,
      revision: row.revision,
      updatedAt: row.updated_at || row.updatedAt || '',
      synced: true,
    };
    if (row.cards) out.cards = row.cards.map(function (c) {
      return { cardId: c.cardId || c.card_id, quantity: Number(c.quantity) };
    });
    return out;
  }
  function fromLocal(row) {
    var out = {
      id: row.id,
      name: row.name,
      faction: row.faction,
      revision: row.revision,
      updatedAt: row.updatedAt || '',
      synced: !!row.synced,
    };
    if (row.cards) out.cards = row.cards.map(function (c) {
      return { cardId: c.cardId, quantity: Number(c.quantity) };
    });
    return out;
  }

  /* ---------- 探测服务端 ---------- */

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error('探测超时')); }, ms);
      promise.then(function (v) { clearTimeout(timer); resolve(v); },
        function (e) { clearTimeout(timer); reject(e); });
    });
  }

  function probe() {
    if (modePromise) return modePromise;
    modePromise = (function () {
      var req;
      try { req = withTimeout(fetch('/api/health', { cache: 'no-store' }), PROBE_TIMEOUT); }
      catch (e) { return Promise.reject(e); }        // file:// 下 fetch 可能同步抛
      return req;
    })()
      .then(function (r) {
        // ⚠️ 判据必须是 content-type，不能只看 r.ok：
        //    静态服务下 /api/* 是 404 text/html，是「有效响应但不是接口」。
        var ct = (r.headers.get('content-type') || '').toLowerCase();
        if (ct.indexOf('json') < 0) throw new Error('非 JSON 响应（多半只起了静态预览服务）');
        if (!r.ok) throw new Error('健康检查 ' + r.status);
        return r.json();
      })
      .then(function (body) {
        if (!body || body.ok !== true) throw new Error('健康检查响应异常');
        mode = 'server';
        return mode;
      })
      .catch(function () { mode = 'local'; return mode; });
    return modePromise;
  }

  /* ---------- 服务端调用（同样守住 content-type） ---------- */

  function api(path, options) {
    return fetch(path, options || {}).then(function (r) {
      var ct = (r.headers.get('content-type') || '').toLowerCase();
      if (ct.indexOf('json') < 0) throw new Error('服务端返回了非 JSON 响应');
      return r.json().then(function (body) {
        if (!r.ok) throw new Error((body && body.error) || ('请求失败 ' + r.status));
        return body;
      });
    });
  }
  function json(body, method) {
    return { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  }

  function localUpsert(payload, id) {
    var decks = localRead();
    var at = new Date().toISOString().replace('T', ' ').slice(0, 19);
    var idx = -1;
    for (var i = 0; i < decks.length; i++) if (decks[i].id === id) { idx = i; break; }
    var row = {
      id: idx >= 0 ? id : newLocalId(),
      name: payload.name,
      faction: payload.faction,
      revision: idx >= 0 ? (decks[idx].revision || 1) + 1 : 1,
      updatedAt: at,
      synced: false,                       // 本地建的 → 服务端还没有
      cards: payload.cards,
    };
    if (idx >= 0) decks[idx] = row; else decks.push(row);
    if (!localWrite(decks)) throw new Error('本地存储写入失败（可能是浏览器隐私模式或配额已满）');
    return fromLocal(row);
  }

  /* ---------- 对外接口 ---------- */

  var DeckStore = {
    /** 探测一次并缓存。返回 'server' | 'local' */
    init: function () { return probe(); },
    mode: function () { return mode; },

    /** 卡组摘要列表。服务端模式下会**一并列出**离线期间攒下的本地卡组（synced:false），不静默丢弃。 */
    list: function (faction) {
      return probe().then(function (m) {
        var localOnly = localRead().filter(function (d) { return !d.synced; }).map(fromLocal);
        if (m === 'local') return localOnly;
        return api('/api/users/' + USER + '/decks').then(function (body) {
          var seen = {}, merged = [];
          (body.decks || []).forEach(function (row) {
            var d = fromServer(row);
            if (!seen[d.id]) { seen[d.id] = 1; merged.push(d); }
          });
          localOnly.forEach(function (d) { if (!seen[d.id]) { seen[d.id] = 1; merged.push(d); } });
          return merged;
        });
      }).then(function (decks) {
        if (!faction) return decks;
        return decks.filter(function (d) { return d.faction === faction; });
      });
    },

    /** 卡组明细（含 cards）。 */
    get: function (id) {
      return probe().then(function (m) {
        if (m === 'local' || isLocalId(id)) {
          var hit = localRead().filter(function (d) { return d.id === id; })[0];
          return hit ? fromLocal(hit) : null;
        }
        return api('/api/users/' + USER + '/decks/' + encodeURIComponent(id)).then(fromServer);
      });
    },

    /** 新建（无 id）或覆盖（有 id）。payload = { name, faction, cards:[{cardId,quantity}] } */
    save: function (payload, id) {
      return probe().then(function (m) {
        if (m === 'local' || isLocalId(id)) return localUpsert(payload, id);
        var path = '/api/users/' + USER + '/decks' + (id ? '/' + encodeURIComponent(id) : '');
        return api(path, json(payload, id ? 'PUT' : 'POST')).then(fromServer);
      });
    },

    remove: function (id) {
      return probe().then(function (m) {
        if (m === 'local' || isLocalId(id)) {
          var decks = localRead().filter(function (d) { return d.id !== id; });
          if (!localWrite(decks)) throw new Error('本地存储写入失败');
          return { ok: true };
        }
        return api('/api/users/' + USER + '/decks/' + encodeURIComponent(id), { method: 'DELETE' });
      });
    },

    /* ---------- 离线卡组的去向（不自动覆盖、不自动丢弃） ---------- */

    /** 还没同步到服务端的本地卡组数 */
    pendingCount: function () {
      return localRead().filter(function (d) { return !d.synced; }).length;
    },

    /** 把本地卡组逐条上传到服务端；成功的从本地移除。返回 {uploaded, failed:[{name,error}]} */
    pushLocal: function () {
      return probe().then(function (m) {
        if (m !== 'server') throw new Error('服务端不在，无法上传');
        var pending = localRead().filter(function (d) { return !d.synced; });
        var uploaded = 0, failed = [], keep = [];
        return pending.reduce(function (chain, deck) {
          return chain.then(function () {
            return api('/api/users/' + USER + '/decks',
              json({ name: deck.name, faction: deck.faction, cards: deck.cards }, 'POST'))
              .then(function () { uploaded += 1; })
              .catch(function (e) { failed.push({ name: deck.name, error: e.message }); keep.push(deck); });
          });
        }, Promise.resolve()).then(function () {
          // 只把「没上传成功」的留在本地；已上传的从本地删掉（服务端成为唯一副本，避免两份互相盖）
          var rest = localRead().filter(function (d) { return d.synced; }).concat(keep);
          if (!localWrite(rest)) throw new Error('本地存储写入失败');
          return { uploaded: uploaded, failed: failed };
        });
      });
    },

    /* ---------- 收藏数（「拥有 N 张」的数据来源） ---------- */

    /**
     * 返回 `{ [cardId]: 拥有张数 }`。
     * **只有服务端有这份数据**（`user_cards` 表）；本地模式返回空对象，
     * 调用方据此决定要不要显示「拥有 N 张」这一项 —— 不假装知道。
     *
     * 注意它与「同名上限」是两回事：上限是**规则**（core 的 maxCopiesOf），
     * 拥有数是**玩家状态**（服务端）。实际能放几张 = min(上限, 拥有数)，
     * 与服务端 validateDeck 的判据一致。
     */
    collection: function (faction) {
      return probe().then(function (m) {
        if (m !== 'server') return {};
        return api('/api/users/' + USER + '/cards'
          + (faction ? '?faction=' + encodeURIComponent(faction) : ''))
          .then(function (body) {
            var out = {};
            (body.cards || []).forEach(function (c) { out[c.id] = Number(c.owned || 0); });
            return out;
          });
      }).catch(function () { return {}; });
    },

    /* ---------- 扁平数组 ↔ 明细 的互转（setup.js 的卡组是扁平 id 数组） ---------- */

    toIds: function (deck) {
      var ids = [];
      (deck.cards || []).forEach(function (c) {
        for (var i = 0; i < Number(c.quantity || 0); i++) ids.push(c.cardId);
      });
      return ids;
    },
    toCards: function (ids) {
      var order = [], count = {};
      ids.forEach(function (id) {
        if (count[id] === undefined) { count[id] = 0; order.push(id); }
        count[id] += 1;
      });
      return order.map(function (id) { return { cardId: id, quantity: count[id] }; });
    },
  };

  window.DeckStore = DeckStore;
})();
