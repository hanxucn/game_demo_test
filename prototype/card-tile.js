/* ============================================================
   CardTile —— 卡牌瓦片的**唯一实现**（markup + 样式 + 文案）

   这个 UI 原先有三份互不相同的实现：
     · deck-builder.html  → `.card / .cardhead / .card-tags / .card-details / .cardfoot`
     · card-test.html     → `.card / .card-head / .tags / .description / .card-foot`
     · battlefield 第 2 步 → `.crow` 行列表（信息密度高，但和上面两套长得不一样）
   三份的 class 名、CSS、效果文案生成逻辑各写一遍 —— 改一处忘一处就是漂移。
   2026-09-27 统一到这里（ADR-096），三个页面都调 `CardTile.render()`：
   deck-builder 与 card-test 删掉了各自的瓦片 CSS，第 2 步由行列表换成瓦片网格。

   为什么 class 用 `ct-` 前缀：三个页面各自都定义过 `.card` / `.stats` / `.name` /
   `.desc` 这类通用名，直接复用会互相污染。`ct-` 命名空间让这份样式可以无冲突地
   注入任何页面；页面想改配色就覆盖 `--ct-*` 变量即可，不用改这里。

   用法：
     container.innerHTML = shown.map(c => CardTile.render(c, {
       count: 0, cap: 3, owned: 3,          // owned 可选：没有就只显示「当前 n/cap」
       selected: false,                      // 高亮（卡牌测试页的"已选"）
       action: { attr: 'data-add', label: '加入', disabled: false },  // null = 不画按钮
     })).join('');
   ============================================================ */
window.CardTile = (function () {
  var FAC_NAME = { shu: '蜀', wei: '魏', wu: '吴', qun: '群雄', neutral: '中立' };
  var TYPE_NAME = {
    troop: '兵种', general: '武将', strategist: '谋臣', event: '事件',
    tactic: '战法', token: '衍生物', elite: '精英', special: '特殊', status: '状态',
  };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // 关键词 id → 中文名。惰性建表：调用方可能在 GameData 之前加载本文件。
  var kwMap = null;
  function keywordNames(card) {
    if (!kwMap) {
      kwMap = {};
      ((window.GameData && window.GameData.keywords) || []).forEach(function (k) {
        if (k && k.id) kwMap[k.id] = k.name || k.id;
      });
    }
    return (card.keywords || []).map(function (k) { return kwMap[k] || k; });
  }

  /** 一张卡的展示用文本：技能文案优先 → 关键词 → 记忆点 */
  function effectText(card) {
    var texts = (card.skills || [])
      // 「技能名：技能文本」—— PR #12（teammate）为卡牌测试页与构筑页**各补过一次**；
      // 现在这段逻辑只此一处，改一次三页都生效（ADR-096 把两份实现收成了一份）。
      .map(function (s) {
        if (s.name && s.text) return s.name + '：' + s.text;
        return s.name || s.text;
      })
      .filter(Boolean);
    if (texts.length) return texts.join('；');
    var kw = keywordNames(card);
    if (kw.length) return '关键词：' + kw.join('、');
    if (card.memo) return card.memo;
    return '暂无效果描述';
  }

  /* ---------- 样式（幂等注入一次） ---------- */

  var STYLE_ID = 'ct-styles';
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      // 网格容器：三个页面共用同一个列宽策略
      '.ct-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px;align-content:start}',
      // 瓦片本体。配色走变量，页面可覆盖；默认值 = 构筑页那套（设计者认可的参考外观）
      '.ct-tile{display:flex;flex-direction:column;min-width:0;padding:10px;'
        + 'border:1px solid var(--ct-line,#55584e);border-radius:4px;background:var(--ct-bg,#2c2e2a);'
        + 'color:var(--ct-ink,#eee);font-size:13px;line-height:1.35}',
      '.ct-tile.is-dim{opacity:.42}',
      '.ct-tile.is-selected{border-color:var(--ct-gold,#d5b16a);box-shadow:inset 0 0 0 1px var(--ct-gold,#d5b16a)}',
      '.ct-head{display:flex;justify-content:space-between;gap:8px;align-items:baseline}',
      '.ct-name{font-weight:700}',
      '.ct-cost{flex:0 0 auto;color:var(--ct-gold,#d5b16a);font-weight:700}',
      '.ct-tags{display:flex;gap:5px;margin-top:7px;flex-wrap:wrap}',
      '.ct-tag{padding:2px 7px;border:1px solid #676a60;border-radius:3px;background:#373a34;'
        + 'color:#d8dbd1;font-size:11px;line-height:1.4}',
      '.ct-tag.ct-faction{border-color:#8c7040;background:#493b25;color:#eed59e}',
      '.ct-body{display:flex;align-items:flex-end;gap:8px;min-height:52px;margin:7px 0}',
      // ⚠️ min-width:0：`.ct-desc` 里是长中文串，grid/flex 子项默认 min-width:auto
      //    会按内容撑宽，瓦片列就压不住了
      '.ct-desc{flex:1;min-width:0;color:var(--ct-muted,#a3a79c);font-size:12px;line-height:1.45;'
        + 'overflow-wrap:anywhere}',
      '.ct-stats{display:flex;flex:0 0 auto;gap:5px}',
      '.ct-stat{min-width:32px;padding:4px 5px;border:1px solid #5d6057;border-radius:3px;'
        + 'background:#222420;text-align:center;font-size:12px;font-weight:700}',
      '.ct-stat.ct-atk{color:#f0c46e}',
      '.ct-stat.ct-hp{color:#ef9088}',
      '.ct-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:auto}',
      '.ct-count{color:var(--ct-muted,#a3a79c);font-size:12px}',
      '.ct-btn{padding:4px 8px;font:inherit;font-size:12px;color:inherit;background:#30322e;'
        + 'border:1px solid var(--ct-line,#55584e);border-radius:4px;cursor:pointer}',
      '.ct-btn:hover{border-color:var(--ct-gold,#d5b16a)}',
      '.ct-btn:disabled{opacity:.42;cursor:not-allowed;border-color:var(--ct-line,#55584e)}',
      '.ct-empty{color:var(--ct-muted,#a3a79c);padding:20px 0}',
    ].join('');
    document.head.appendChild(style);
  }

  /* ---------- 渲染 ---------- */

  /**
   * @param {object} card   卡牌定义（CardDef：cost/type/faction/attack/health/skills/keywords/memo）
   * @param {object} [opts]
   *   count/cap  当前张数与上限（显示「当前 n/cap」）
   *   owned      拥有张数（可选；给了才显示「拥有 N 张 · 」—— 这是服务端 user_cards 的数据，
   *              本地模式没有，所以是可选项而不是必填）
   *   selected   高亮该瓦片
   *   dim        置灰
   *   action     { attr, label, disabled } —— null 表示不画按钮
   */
  function render(card, opts) {
    ensureStyles();
    opts = opts || {};
    var cls = 'ct-tile';
    if (opts.selected) cls += ' is-selected';
    if (opts.dim) cls += ' is-dim';
    if (opts.extraClass) cls += ' ' + opts.extraClass;

    var hasStats = card.attack != null || card.health != null;
    var stats = hasStats
      ? '<div class="ct-stats">'
        + (card.attack != null ? '<span class="ct-stat ct-atk">攻 ' + card.attack + '</span>' : '')
        + (card.health != null ? '<span class="ct-stat ct-hp">血 ' + card.health + '</span>' : '')
        + '</div>'
      : '';

    var count = opts.count;
    var countText = '';
    if (count != null) {
      countText = (opts.owned != null ? '拥有 ' + opts.owned + ' 张 · ' : '')
        + '当前 ' + count + '/' + opts.cap;
    } else if (opts.owned != null) {
      countText = '拥有 ' + opts.owned + ' 张';
    }

    var button = '';
    if (opts.action) {
      var a = opts.action;
      button = '<button class="ct-btn" ' + a.attr + '="' + esc(card.id) + '"'
        + (a.disabled ? ' disabled' : '') + '>' + esc(a.label || '加入') + '</button>';
    }

    return '<article class="' + cls + '" data-ct-card="' + esc(card.id) + '">'
      + '<div class="ct-head"><span class="ct-name">' + esc(card.name) + '</span>'
      + '<span class="ct-cost">' + (card.cost != null ? card.cost : 0) + '费</span></div>'
      + '<div class="ct-tags">'
      + '<span class="ct-tag ct-faction">' + esc(FAC_NAME[card.faction] || card.faction) + '</span>'
      + '<span class="ct-tag">' + esc(TYPE_NAME[card.type] || card.type) + '</span>'
      + '</div>'
      + '<div class="ct-body"><div class="ct-desc">' + esc(effectText(card)) + '</div>' + stats + '</div>'
      + '<div class="ct-foot"><span class="ct-count">' + esc(countText) + '</span>' + button + '</div>'
      + '</article>';
  }

  /** 列表为空时的占位（三处文案不同，故做成参数） */
  function empty(text) { ensureStyles(); return '<div class="ct-empty">' + esc(text) + '</div>'; }

  return {
    GRID_CLASS: 'ct-grid',
    render: render,
    empty: empty,
    ensureStyles: ensureStyles,
    esc: esc,
    effectText: effectText,
    keywordNames: keywordNames,
    factionName: function (f) { return FAC_NAME[f] || f; },
    typeName: function (t) { return TYPE_NAME[t] || t; },
  };
})();
