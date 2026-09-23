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

  /** 卡面技能摘要：优先「技能名 + 文案」，无技能则退回记忆点 */
  function skillBrief(card) {
    var sk = (card.skills || [])[0];
    if (sk && (sk.name || sk.text)) {
      return '<b>' + (sk.name || '技能') + '</b>' + (sk.text ? '　' + sk.text : '');
    }
    return card.memo || '';
  }

  /** 战场卡只放得下一个技能名 */
  function skillName(card) {
    var sk = (card.skills || [])[0];
    return sk && sk.name ? sk.name : '';
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

  /* ---------- 卡背（翻面，ADR-059） ---------- */
  function backFace(card, opts) {
    var el = document.createElement('div');
    el.className = 'cr-card cr-board cr-flipped';
    el.dataset.cardId = card.id || '';
    el.innerHTML = '<div class="cr-back">' +
      '<div class="cr-back-glyph">酒</div>' +
      '<div class="cr-back-tag">翻面</div>' +
      '</div>';
    return el;
  }

  /* ---------- 通用卡面 ---------- */
  function build(card, opts) {
    opts = opts || {};
    // 翻面单位表现为卡背：不显示攻血与技能，只保留"下回合翻回"的提示
    if (opts.board && opts.flipped) return backFace(card, opts);
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

    if (opts.board) {
      // 战场卡只有 42×59：全文放不下，先把**技能名**摆出来（血攻圆圈上方那条），
      // 完整文案走悬浮详情面板（见 battlefield.engine.js 的 hover 绑定）。
      if (isCharacter(card)) {
        var sn = skillName(card);
        if (sn) html += '<div class="cr-skillname">' + sn + '</div>';
      }
    } else {
      // 手牌 56×78：显示技能名 + 文案（原先进来时 opts.desc 从没被传过，
      // 所以这段描述一直没渲染出来 —— 设计者反馈"看不到技能描述"）
      if (!isCharacter(card)) html += '<div class="cr-type">' + typeLabel(card) + '</div>';
      if (opts.desc) {
        var brief = skillBrief(card);
        if (brief) html += '<div class="cr-desc">' + brief + '</div>';
      }
    }

    el.innerHTML = html;
    // 战场卡带上血量快照：播动画时据此逐点扣血，
    // 免得"飘字已经 -3 了、卡面血量还停在原值"（结算完才 renderAll）。
    if (opts.board && isCharacter(card)) {
      el.dataset.hp = String(card.hp != null ? card.hp : 0);
      el.dataset.maxHp = String(card.maxHp != null ? card.maxHp : (card.hp != null ? card.hp : 0));
    }
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
  /**
   * 让元素成为"定位祖先"，好让飘字/特效挂上去。
   *
   * ⚠️ 不能无条件写 `el.style.position = 'relative'`（ADR-074 修的真 bug）：
   * 战场上的 `.unit-wrap` 本身是 `position: absolute; inset: 0`，
   * 被内联的 relative 一覆盖就退化成静态流里的空方块 —— **高度塌成 0，整张卡当场消失**。
   * 症状是"打了一下之后那张卡就看不见了"，而且只要挂过一次飘字就永久生效，
   * 于是"技能看不出来发动、数值跳动看不清"。只在 static 时才补 relative。
   */
  function ensurePositioned(el) {
    if (!el || !el.style) return;
    var pos = window.getComputedStyle ? window.getComputedStyle(el).position : '';
    if (pos === 'static' || pos === '') el.style.position = 'relative';
  }

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
        ensurePositioned(toEl);
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
        ensurePositioned(targetEl);
        targetEl.appendChild(dmg);
        setTimeout(function () { dmg.remove(); }, 760);
      }
    }, 170);
  }

  /** 死亡：过曝 → 灰化下沉，并炸开一圈尘光 */
  function die(el, done) {
    var burst = document.createElement('div');
    burst.className = 'cr-death-burst';
    ensurePositioned(el);
    el.appendChild(burst);
    el.classList.add('cr-dying');
    setTimeout(function () {
      burst.remove();
      el.classList.remove('cr-dying');
      if (done) done();
    }, 500);
  }

  /** 飘字：伤害/治疗/护甲/状态。cls 见 card-render.css 的 .cr-float.is-* */
  /**
   * 飘字。ADR-074：加两个参数 ——
   *   · `life`：停留时长。原先写死 960ms，节奏放慢后数字先消失、动画还在跑；
   *   · 同元素上已有的飘字会自动**错开**，否则五雷轰顶那种连击会叠成一坨看不清。
   */
  function float(el, text, cls, source, life) {
    if (!el) return;
    var n = document.createElement('div');
    n.className = 'cr-float ' + (cls || 'is-dmg');
    n.innerHTML = text + (source ? '<span class="cr-src">' + source + '</span>' : '');
    ensurePositioned(el);
    var live = el.querySelectorAll(':scope > .cr-float');
    var stack = Math.min(live.length, 4);
    if (stack) n.style.setProperty('--stack', String(stack));
    el.appendChild(n);
    setTimeout(function () { n.remove(); }, life || 960);
  }

  /** 技能释放：目标处爆开光环；wholeBoard=true 时整块战场闪一下（群体技） */
  function spell(el, color, wholeBoard) {
    if (wholeBoard) {
      var c = document.getElementById('canvas');
      if (c) {
        c.style.setProperty('--spell-c', color || 'rgba(190,140,255,.5)');
        c.classList.add('cr-board-spell');
        setTimeout(function () { c.classList.remove('cr-board-spell'); }, 620);
      }
      return;
    }
    if (!el) return;
    var f = document.createElement('div');
    f.className = 'cr-spell';
    if (color) f.style.setProperty('--spell-c', color);
    ensurePositioned(el);
    el.appendChild(f);
    setTimeout(function () { f.remove(); }, 660);
  }

  /** 卡面血量本地扣减：返回扣减后的值（数据仍以 core 为准，此处只为看得见掉血） */
  function tickHp(el, delta) {
    var node = el && (el.querySelector('.cr-stat.hp') || el.querySelector('.cr-hero-hp'));
    if (!node) return null;
    var cur = parseInt(String(node.textContent).replace(/[^0-9-]/g, ''), 10);
    if (isNaN(cur)) return null;
    var next = Math.max(0, cur + delta);
    node.textContent = node.classList.contains('cr-hero-hp') ? '♥' + next : String(next);
    if (delta < 0) node.classList.add('is-hurt');
    return next;
  }

  return {
    hero: hero,
    big: function (card, opts) { return build(card, opts); },
    mini: function (card, opts) {
      return build(card, Object.assign({}, opts || {}, { board: true }));
    },
    lord: lord,
    flyTo: flyTo, attack: attack, die: die,
    float: float, spell: spell, tickHp: tickHp,
    hash: hash, glyphOf: glyphOf, factionGlyph: factionGlyph,
    isCharacter: isCharacter, typeLabel: typeLabel,
  };
})();
