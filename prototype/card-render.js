/**
 * 卡面渲染器（经典脚本，file:// 可直接用）
 *
 * 依赖：rules.js（提供 window.Rules.KW）
 * 样式：card-render.css
 *
 * 统一尺寸：所有卡牌 56 × 78 pt，由外层容器决定尺寸。
 *
 *   CardRender.big(card)          // 手牌 / 详情：显示费用、纹章、描述
 *   CardRender.mini(card, opts)   // 战场：只留立绘 + 名称 + 关键词 + 攻血
 *   CardRender.lord(lord)         // 主公卡：立绘 + 名称 + 生命 + 护甲 + 主公技
 *
 * 立绘：card.art 存在 → <img>；否则「大字 + 阵营渐变 + 纹理」占位
 *       （按 id 哈希做 ±22° 色相偏移，使同阵营的卡也互不相同）
 */
window.CardRender = (function () {
  'use strict';

  // 关键词名优先取 core 的注册表；兼容旧的原型规则模块
  var KW = {};
  if (window.Core && window.Core.KEYWORDS) {
    Object.keys(window.Core.KEYWORDS).forEach(function (id) {
      var n = window.Core.KEYWORDS[id].name;
      KW[id] = { name: n, short: n.charAt(0) };
    });
  } else if (window.Rules && window.Rules.KW) {
    KW = window.Rules.KW;
  }

  /* ---------- 工具 ---------- */
  function hash(str) {
    var h = 0;
    for (var i = 0; i < (str || '').length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h;
  }

  function factionClass(card) {
    return 'f-' + (card.faction || 'neutral');
  }

  function glyphOf(card) {
    var n = (card.name || '?').trim();
    return n.charAt(0) || '?';
  }

  function factionGlyph(f) {
    return { shu: '蜀', wei: '魏', wu: '吴', qun: '群', neutral: '中' }[f] || '中';
  }

  function typeLabel(card) {
    return {
      troop: '兵种', general: '武将', strategist: '谋臣',
      event: '事件', tactic: '战法', elite: '精锐', special: '特殊',
    }[card.type] || '';
  }

  function isCharacter(card) {
    return card.type === 'troop' || card.type === 'general' || card.type === 'strategist';
  }

  /* ---------- 立绘层 ---------- */
  function portraitHTML(card) {
    if (card.art) {
      return '<div class="cr-portrait"><img class="cr-art" src="' + card.art + '" alt=""></div>';
    }
    var h = hash(card.id || card.name || 'x');
    var hue = (h % 44) - 22;
    var angle = 100 + (h % 80);
    return (
      '<div class="cr-portrait">' +
        '<div class="cr-portrait-bg" style="filter:hue-rotate(' + hue + 'deg)"></div>' +
        '<div class="cr-portrait-tex" style="--tex-angle:' + angle + 'deg"></div>' +
        '<div class="cr-glyph">' + glyphOf(card) + '</div>' +
      '</div>'
    );
  }

  /* ---------- 关键词 chip ---------- */
  function keywordsHTML(card, row) {
    var list = card.kw || [];
    if (!list.length) return '';
    var html = list.map(function (k) {
      var meta = KW[k] || { name: k };
      return '<i title="' + meta.name + '">' + meta.name + '</i>';
    }).join('');
    return '<div class="cr-kw">' + html + '</div>';
  }

  /* ---------- 状态标记（卡头） ---------- */
  /** opts.statuses = [{ id, name, stacks, turns }]，在名称行右侧显示 */
  function statusHTML(opts) {
    var list = opts.statuses || [];
    if (!list.length) return '';
    var html = list.map(function (st) {
      var n = st.stacks > 1 ? st.stacks : '';
      var t = st.turns != null ? '（剩 ' + st.turns + ' 回合）' : '';
      return '<i class="cr-st" data-st="' + st.id + '" title="' + st.name + t + '">'
        + st.name + n + '</i>';
    }).join('');
    return '<div class="cr-status">' + html + '</div>';
  }

  /* ---------- 通用卡面 ---------- */
  function build(card, opts) {
    opts = opts || {};
    var el = document.createElement('div');
    var cls = 'cr-card ' + (opts.board ? 'cr-board' : 'cr-hand') + ' ' + factionClass(card);
    if (opts.selected) cls += ' is-selected';
    el.className = cls;
    el.dataset.cardId = card.id || '';

    var html = portraitHTML(card);
    var costInline = opts.board ? '' :
      '<b class="cr-costnum">' + (card.cost != null ? card.cost : 0) + '</b>';
    html += '<div class="cr-name">' + costInline + (card.name || '') + '</div>';
    html += statusHTML(opts);
    html += keywordsHTML(card, opts.row);

    // 主动技可用标记（点它使用）——仅在战场卡上显示
    if (opts.board && opts.skill) {
      html += '<div class="cr-skillbtn' + (opts.skillUsable ? '' : ' is-off') + '" title="'
        + opts.skill + (opts.skillUsable ? '（点击使用）' : '（本回合不可用）') + '">技</div>';
    }

    if (isCharacter(card)) {
      html += '<div class="cr-stat atk">' + (card.atk != null ? card.atk : 0) + '</div>';
      html += '<div class="cr-stat hp' + (opts.hurt ? ' is-hurt' : '') + '">' +
        (card.hp != null ? card.hp : 0) + '</div>';
    }

    if (!opts.board) {
      // 56×78 的卡面放不下可读的描述文字 → 描述改由悬浮/点击的详情面板展示
      if (!isCharacter(card)) html += '<div class="cr-type">' + typeLabel(card) + '</div>';
      if (opts.desc && card.memo) html += '<div class="cr-desc">' + card.memo + '</div>';
    }

    el.innerHTML = html;
    return el;
  }

  /* ---------- 主公（人物样式，不是卡牌） ---------- */
  function hero(l, opts) {
    opts = opts || {};
    var el = document.createElement('div');
    el.className = 'cr-hero ' + factionClass(l);
    if (opts.selected) el.classList.add('is-selected');
    if (opts.target) el.classList.add('is-target');
    el.innerHTML =
      portraitHTML(l) +
      '<div class="cr-hero-frame"></div>' +
      (l.skill ? '<div class="cr-hero-skill" title="主公技：' + l.skill + '">' + l.skill.charAt(0) + '</div>' : '') +
      '<div class="cr-hero-plate">' +
        '<span class="cr-hero-name">' + (l.name || '') + '</span>' +
        '<span class="cr-hero-stats">' +
          '<span class="cr-hero-hp">♥' + (l.hp != null ? l.hp : 0) + '</span>' +
          (l.armor ? '<span class="cr-hero-armor">◈' + l.armor + '</span>' : '') +
        '</span>' +
      '</div>';
    return el;
  }

  /* ---------- 主公卡（旧版，保留兼容） ---------- */
  function lord(l, opts) {
    opts = opts || {};
    var el = document.createElement('div');
    el.className = 'cr-card cr-lord ' + factionClass(l);
    if (opts.selected) el.classList.add('is-selected');
    if (opts.target) el.classList.add('is-target');

    el.innerHTML =
      portraitHTML(l) +
      '<div class="cr-name">' + (l.name || '') + '</div>' +
      (l.armor ? '<div class="cr-lord-armor">◈ ' + l.armor + '</div>' : '') +
      '<div class="cr-lord-hp">♥ ' + (l.hp != null ? l.hp : 0) + '</div>' +
      (l.skill ? '<div class="cr-lord-skill">' + l.skill + '</div>' : '');
    return el;
  }

  /* ---------- 动画辅助 ---------- */

  /** 出牌：从手牌位置飞到目标格 */
  function flyTo(fromEl, toEl, done) {
    var a = fromEl.getBoundingClientRect();
    var b = toEl.getBoundingClientRect();
    var ghost = fromEl.cloneNode(true);
    ghost.classList.add('cr-flying');
    ghost.style.left = a.left + 'px';
    ghost.style.top = a.top + 'px';
    ghost.style.width = a.width + 'px';
    ghost.style.height = a.height + 'px';
    document.body.appendChild(ghost);

    var dx = (b.left + b.width / 2) - (a.left + a.width / 2);
    var dy = (b.top + b.height / 2) - (a.top + a.height / 2);
    var scale = b.height / a.height;

    void ghost.offsetWidth;
    ghost.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + scale + ')';

    setTimeout(function () {
      ghost.remove();
      if (toEl) {
        var flash = document.createElement('div');
        flash.className = 'cr-land-flash';
        toEl.style.position = 'relative';
        toEl.appendChild(flash);
        setTimeout(function () { flash.remove(); }, 460);
        toEl.classList.add('cr-land-bounce');
        setTimeout(function () { toEl.classList.remove('cr-land-bounce'); }, 320);
      }
      if (done) done();
    }, 400);
  }

  /** 攻击：冲刺 → 抖动 → 伤害数字 */
  function attack(attackerEl, targetEl, damage) {
    var a = attackerEl.getBoundingClientRect();
    var t = targetEl.getBoundingClientRect();
    var dx = (t.left + t.width / 2) - (a.left + a.width / 2);
    var dy = (t.top + t.height / 2) - (a.top + a.height / 2);
    attackerEl.style.setProperty('--lx', (dx * 0.6) + 'px');
    attackerEl.style.setProperty('--ly', (dy * 0.6) + 'px');
    attackerEl.classList.add('cr-lunge');
    setTimeout(function () { attackerEl.classList.remove('cr-lunge'); }, 360);

    setTimeout(function () {
      targetEl.classList.add('cr-hit');
      setTimeout(function () { targetEl.classList.remove('cr-hit'); }, 320);
      if (damage != null) {
        var dmg = document.createElement('div');
        dmg.className = 'cr-dmg';
        dmg.textContent = '-' + damage;
        dmg.style.left = '50%';
        dmg.style.top = '12%';
        targetEl.style.position = 'relative';
        targetEl.appendChild(dmg);
        setTimeout(function () { dmg.remove(); }, 760);
      }
    }, 170);
  }

  /** 死亡 */
  function die(el, done) {
    el.classList.add('cr-dying');
    setTimeout(function () {
      el.classList.remove('cr-dying');
      if (done) done();
    }, 400);
  }

  return {
    hero: hero,
    big: function (card, opts) { return build(card, opts); },
    mini: function (card, opts) {
      return build(card, Object.assign({}, opts || {}, { board: true }));
    },
    lord: lord,
    flyTo: flyTo, attack: attack, die: die,
    hash: hash, glyphOf: glyphOf, factionGlyph: factionGlyph,
    isCharacter: isCharacter, typeLabel: typeLabel,
  };
})();
