/* ============================================================
   战场演示（引擎驱动版）

   规则 100% 来自 core —— 本文件只负责三件事：
     ① 把 core 的状态渲染成 DOM
     ② 把 core 的事件流翻译成动画
     ③ 把用户输入翻译成 Action

   ⚠️ 本文件不允许出现任何规则判断（谁能打谁、伤害多少、费用够不够）。
      全部通过 Core.legalTargets / Core.applyAction 决定。
   ============================================================ */

var Core = window.Core;
var CR = window.CardRender;
var GD = window.GameData;

var DESIGN_W = 736, DESIGN_H = 414;
var ROWS = ['front'];        // ADR-051：单排
var COLS = [0, 1, 2, 3, 4, 5, 6, 7];   // 一行 8 格
var CHARACTER_TYPES = ['troop', 'general', 'strategist'];

var data = Core.loadData(
  { cards: GD.cards, heroes: GD.heroes },
  { own: 'shu_liubei', enemy: 'wei_caocao' },
);

var session = null;      // { state, ctx }
var sel = null;          // 已选中的我方单位 { row, col }
var drag = null;         // 拖拽中的卡牌
var pendingSkill = null; // 等待选择目标的主公技
var busy = false;

var $ = function (s) { return document.querySelector(s); };
var $all = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
var isCharacter = function (c) { return CHARACTER_TYPES.indexOf(c.type) >= 0; };

/* ---------- 状态与技能辅助 ---------- */

var STATUS_NAME = null;
function statusName(id) {
  if (!STATUS_NAME) {
    STATUS_NAME = {};
    (GD.statuses || []).forEach(function (st) { STATUS_NAME[st.id] = st.name; });
  }
  return STATUS_NAME[id] || id;
}

/** 把 Unit.statuses 转成卡面标记用的数组 */
function statusList(u) {
  var out = [];
  var sts = u.statuses || {};
  Object.keys(sts).forEach(function (id) {
    var inst = sts[id];
    if (!inst || !inst.stacks) return;
    out.push({ id: id, name: statusName(id), stacks: inst.stacks, turns: inst.turns });
  });
  // 关键词里带状态的（如架盾/圣盾）也标出来
  (u.kw || []).forEach(function (k) {
    var map = { jia_dun: 'jia_dun_status', sheng_dun: 'sheng_dun_status', xian_gong: 'xian_gong_status' };
    var sid = map[k];
    if (sid && !out.some(function (x) { return x.id === sid; })) {
      out.push({ id: sid, name: statusName(sid), stacks: 1 });
    }
  });
  return out;
}

/** 该单位有可用主动技吗（用引擎的共享判定，UI 不做规则判断） */
function unitSkillState(st, side, row, col) {
  var u = st.sides[side].rows[row][col];
  if (!u) return null;
  var sk = (u.skills || []).filter(function (x) { return x.kind === 'active'; })[0];
  if (!sk) return null;
  var can = Core.canUseUnitSkill(st, side, row, col);
  return { name: sk.name, usable: can.ok, why: can.reason || '' };
}

/* ---------- 视图适配 ---------- */
function viewCard(c) {
  return {
    id: c.id, name: c.name, type: c.type, faction: c.faction, cost: c.cost,
    atk: c.attack || 0, hp: c.health || 0, kw: c.keywords || [],
    memo: c.memo, troopKind: c.troopKind, art: c.art,
  };
}

/* ============================================================
   对局生命周期
   ============================================================ */

function newGame() {
  // 开局流程（阵营 → 构筑 → 换牌）；规则全部由 Core 判定
  Setup.open({
    data: data,
    onStart: function (cfg) {
      session = {
        state: cfg.baseState,
        ctx: { cards: data.cards, lords: data.lords },
        meta: { ownFaction: cfg.ownFaction, enemyFaction: cfg.enemyFaction },
      };
      sel = null; drag = null; pendingSkill = null; busy = false;
      logClear();
      var started = Core.startMatch(session.state, session.ctx);
      session = { state: started.state, ctx: session.ctx, meta: session.meta };
      logEvents(started.events);
      renderAll();
      banner('对局开始',
        session.state.sides.own.lord.name + ' vs ' + session.state.sides.enemy.lord.name +
        '（先手：' + (session.state.active === 'own' ? '我方' : '敌方') + '）');
      // 先手若是 AI（敌方恒为 AI；双 AI 模式我方也是）→ 自动开打
      if (shouldAuto()) setTimeout(runAiTurn, 500);
    },
  });
}

/* ============================================================
   渲染
   ============================================================ */

function renderAll() {
  var st = session.state;
  if (drawnThisAction) highlightNewHandCard();
  renderLords(st);
  renderPanel(st);
  renderBoard(st);
  renderLanes(st);
  renderHand(st);
  reportSizes();
}

function renderLords(st) {
  ['enemy', 'own'].forEach(function (side) {
    var l = st.sides[side].lord;
    var bar = document.getElementById('lord-' + side);
    var canUse = side === 'own' && st.active === 'own' && !l.skillUsedThisTurn && st.sides.own.command.cur >= 1;
    bar.className = 'lord-bar ' + side;
    bar.innerHTML =
      '<span class="lb-portrait f-' + (l.faction || 'neutral') + '">' + (l.name || '').charAt(0) + '</span>' +
      '<span class="lb-name">' + l.name + '</span>' +
      '<span class="lb-hp">♥' + l.hp + '</span>' +
      (l.armor ? '<span class="lb-armor">◈' + l.armor + '</span>' : '') +
      (l.skill
        ? '<span class="lb-skill' + (canUse ? '' : ' is-disabled') + '" title="主公技：' + l.skill +
          '（消耗 1 统率 / 每回合 1 次）">' + l.skill + '<i>1</i></span>'
        : '');

    var skillEl = bar.querySelector('.lb-skill');
    if (skillEl) {
      skillEl.addEventListener('click', function (e) {
        e.stopPropagation();
        onLordSkillClick(side);
      });
    }
    bar.addEventListener('click', function (e) {
      e.stopPropagation();
      onLordClick(side, bar);
    });
  });
}

/** 起牌后把最新一张手牌弹一下，明确"刚抽到的是这张" */
function highlightNewHandCard() {
  var cards = $all('#hand .hcard-wrap');
  var el = cards[cards.length - 1];
  if (!el) return;
  el.classList.add('cr-land-bounce');
  setTimeout(function () { el.classList.remove('cr-land-bounce'); }, 420);
}

function renderPanel(st) {
  var s = st.sides.own;
  var f = st.sides.enemy;
  $('#cmd-num').innerHTML = s.command.cur + '<small> / ' + s.command.max + '</small>';
  $('#turn-num').textContent = st.turn;
  $('#hand-num').textContent = s.hand.length;
  $('#deck-num').textContent = s.deck.length;
  // 敌方牌库/手牌：只给张数（不泄露内容），手牌另用一排卡背表示
  $('#foe-deck-num').textContent = f.deck.length;
  $('#foe-hand-num').textContent = f.hand.length;
  var backs = '';
  for (var k = 0; k < f.hand.length; k++) {
    backs += '<i style="animation-delay:' + (k * 30) + 'ms"></i>';
  }
  $('#foe-hand-backs').innerHTML = backs;
  var pips = '';
  for (var i = 0; i < 10; i++) pips += '<div class="pip' + (i < s.command.cur ? ' on' : '') + '"></div>';
  $('#cmd-pips').innerHTML = pips;
  $('#turn-side').textContent = st.active === 'own' ? '我方回合' : '敌方回合';
  $('#turn-side').className = 'turn-side ' + st.active;
}

function renderBoard(st) {
  ROWS.forEach(function (row) {
    ['enemy', 'own'].forEach(function (side) {
      var rowEl = document.querySelector('.row[data-side="' + side + '"][data-row="' + row + '"]');
      rowEl.innerHTML = '';
      COLS.forEach(function (col) {
        var slot = document.createElement('div');
        slot.className = 'slot';
        slot.dataset.side = side; slot.dataset.row = row; slot.dataset.col = String(col);

        var u = st.sides[side].rows[row][col];
        if (u) {
          var wrap = document.createElement('div');
          wrap.className = 'unit-wrap';
          wrap.dataset.uid = u.uid;
          // 拖拽攻击的落点解析靠这三个坐标（dropAt → ATTACK 的 to）
          wrap.dataset.side = side; wrap.dataset.row = row; wrap.dataset.col = String(col);
          // 不能攻击的单位置灰（已攻击过 / 本回合入场 / 被震慑）
          if (side === 'own' && !Core.canAttack(st, 'own', row, col).ok) wrap.classList.add('is-tired');
          var flipped = !!(u.statuses && u.statuses.fan_mian);
          var skill = (side === 'own' && !flipped) ? unitSkillState(st, 'own', row, col) : null;
          wrap.appendChild(CR.mini(u, {
            row: row, hurt: u.hp < u.maxHp,
            flipped: !!(u.statuses && u.statuses.fan_mian),
            statuses: statusList(u),
            skill: skill ? skill.name : null,
            skillUsable: skill ? skill.usable : false,
          }));
          if (skill) {
            var sb = wrap.querySelector('.cr-skillbtn');
            if (sb) sb.addEventListener('click', function (e) {
              e.stopPropagation();
              onUnitSkillClick(row, col, skill);
            });
          }
          if (side === 'own') {
            wrap.addEventListener('pointerdown', function (e) {
              if (e.target.closest('.cr-skillbtn')) return;   // 「技」按钮不拖拽
              if (drag) return;
              startUnitDrag(e, row, col, wrap);
            });
          }
          wrap.addEventListener('click', function (e) {
            e.stopPropagation();
            onUnitClick(side, row, col);
          });
          slot.appendChild(wrap);
        } else {
          slot.classList.add('empty');
          slot.addEventListener('click', function (e) {
            e.stopPropagation();
            onSlotClick();
          });
        }
        rowEl.appendChild(slot);
      });
    });
  });
}

/**
 * 目标高亮（ADR-051：列概念已取消，原先的「列光束」作废）。
 * 选中自己的单位后，把所有合法目标（含主将）描边高亮。
 */
function renderLanes(st) {
  $all('.unit-wrap.is-target').forEach(function (el) { el.classList.remove('is-target'); });
  $('#lord-enemy').classList.remove('is-target');
  if (!sel) return;
  var res = Core.legalTargets(st, 'own', sel.row, sel.col);
  res.targets.forEach(function (t) {
    if (t.kind === 'lord') { $('#lord-enemy').classList.add('is-target'); return; }
    var slot = document.querySelector('.row[data-side="' + t.side + '"][data-row="' + t.row + '"] .slot[data-col="' + t.col + '"]');
    var wrap = slot && slot.querySelector('.unit-wrap');
    if (wrap) wrap.classList.add('is-target');
  });
}

function renderHand(st) {
  var hand = $('#hand');
  hand.innerHTML = '';
  var list = st.sides.own.hand;
  var mid = (list.length - 1) / 2;
  var cmd = st.sides.own.command.cur;
  var myTurn = st.active === 'own' && !st.winner;

  list.forEach(function (hc, i) {
    // ⚠️ ADR-038：手牌是 HandCard 实例 {card, mods}，不是 CardDef。
    // 原型原先直接当 CardDef 用（显示 0 费、名字空白、人物卡被误判为非人物卡）。
    var c = hc.card;
    var wrap = document.createElement('div');
    wrap.className = 'hcard-wrap';
    wrap.dataset.cardIndex = String(i);
    var off = i - mid;
    wrap.style.setProperty('--rot', (off * 3.2) + 'deg');
    wrap.style.setProperty('--lift', (Math.abs(off) * 1.8) + 'px');
    wrap.style.zIndex = 10 + i;

    // ADR-058：统率值不足 → 置灰并标注还差几点（费用判定由引擎给，UI 只显示）
    var cost = c.cost != null ? c.cost : 0;
    var affordable = cmd >= cost;
    var playable = myTurn && affordable;
    wrap.appendChild(CR.big(viewCard(c)));
    if (!affordable) {
      wrap.classList.add('is-poor');
      var tag = document.createElement('div');
      tag.className = 'hcard-cost';
      tag.textContent = '需 ' + cost + '（差 ' + (cost - cmd) + '）';
      wrap.appendChild(tag);
    } else if (cost > 0) {
      var tag2 = document.createElement('div');
      tag2.className = 'hcard-cost ok';
      tag2.textContent = '需 ' + cost + ' → 余 ' + (cmd - cost);
      wrap.appendChild(tag2);
    }

    if (isCharacter(c)) {
      // 人物卡：按住拖到战场；单击看详情
      wrap.addEventListener('pointerdown', function (e) { startDrag(e, i, c, wrap); });
      wrap.addEventListener('click', function (e) {
        e.stopPropagation();
        if (busy || st.winner || st.active !== 'own') return;
        if (onHandPick(i)) return;
        showCardDetail(c);
      });
    } else {
      wrap.addEventListener('click', function (e) {
        e.stopPropagation();
        if (busy || st.winner || st.active !== 'own') return;
        if (onHandPick(i)) return;
        if (!playable) { showCardDetail(c); return; }   // 打不出 → 改看详情
        doAction({ type: 'PLAY_CARD', cardIndex: i });
      });
    }
    hand.appendChild(wrap);
  });
}

/* ============================================================
   卡牌 / 技能详情（ADR-058：点卡或点技能名弹出）
   ============================================================ */

var KW_DESC = {
  jia_dun: '嘲讽：敌方普通攻击必须先打它。',
  xian_gong: '入场当回合即可行动攻击。',
  lian_ji: '当前回合普通攻击可执行两次。',
  yi_ji: '类亡语：阵亡时触发该卡定义的亡语逻辑。',
  yin_xue: '对敌人造成的伤害，为该单位自身恢复等量生命。',
  sheng_dun: '拥有圣盾状态，可免疫一次伤害。',
  shen_she: '对随机敌人造成远程伤害，不受对方攻击影响。',
  qi_xi: '上场先隐身（不能被选定），下个回合行动后隐身消失。',
  zhong_yi: '免疫混乱、离间等状态。',
  jie_zhen: '（设计者尚未设计具体机制）',
};
var TRIGGER_NAME = {
  on_play: '入场', on_death: '阵亡', turn_start: '回合开始', turn_end: '回合结束',
  on_attack: '攻击时', on_damaged: '受伤时', on_card_played: '打出牌时', on_draw: '抽到时',
};

/** 弹出卡牌详情：费用/攻血、关键词释义、每个技能的完整文案 */
function showCardDetail(c) {
  var el = $('#detail');
  var rows = [];
  rows.push('<h4>' + c.name + '　<span class="sub">' + (c.cost != null ? c.cost + ' 费' : '') +
    (c.attack != null ? '　' + c.attack + '/' + c.health : '') +
    '　' + (TYPE_LABEL[c.type] || c.type || '') + '</span></h4>');
  var kws = c.keywords || c.kw || [];
  if (kws.length) {
    rows.push('<div class="sub">关键词：' + kws.map(function (k) {
      return '<b>' + statusName(k) + '</b>（' + (KW_DESC[k] || '—') + '）';
    }).join('　') + '</div>');
  }
  (c.skills || []).forEach(function (sk) {
    if (!sk.name && !sk.text) return;
    rows.push('<div class="sk"><b class="skname">' + (sk.name || '（无名技能）') + '</b>'
      + (sk.kind ? '<span class="sub">　' + (sk.kind === 'active' ? '主动技'
        : sk.kind === 'aura' ? '光环' : '触发技')
        + (sk.trigger ? '·' + (TRIGGER_NAME[sk.trigger] || sk.trigger) : '') + '</span>' : '')
      + '<div class="why">' + (sk.text || '（无文案）') + '</div></div>');
  });
  if (c.memo) rows.push('<div class="sub" style="margin-top:6px">记忆点：' + c.memo + '</div>');
  el.innerHTML = rows.join('');
  el.classList.add('show');
}

var TYPE_LABEL = {
  troop: '兵种', general: '武将', strategist: '谋臣', event: '事件',
  tactic: '战法', token: '衍生物', elite: '精英', special: '特殊',
};

/* ============================================================
   拖拽出牌
   ============================================================ */

function startDrag(e, index, card, wrap) {
  if (busy || session.state.winner || session.state.active !== 'own') return;
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();

  var rect = wrap.getBoundingClientRect();
  var ghost = wrap.cloneNode(true);
  ghost.classList.add('drag-ghost');
  ghost.style.width = rect.width + 'px';
  ghost.style.height = rect.height + 'px';
  ghost.style.left = rect.left + 'px';
  ghost.style.top = rect.top + 'px';
  document.body.appendChild(ghost);
  wrap.classList.add('is-dragging');

  drag = {
    kind: 'card',
    index: index, card: card, wrap: wrap, ghost: ghost,
    dx: e.clientX - rect.left, dy: e.clientY - rect.top,
  };

  Core.legalPlacements(session.state, 'own').forEach(function (s) {
    var el = document.querySelector('.slot[data-side="own"][data-row="' + s.row + '"][data-col="' + s.col + '"]');
    if (el) el.classList.add('is-placeable');
  });
  showDetail('拖到战场放置', card.name + '（' + card.cost + ' 费）', '绿色格子为可放置位置');

  bindDragEvents();
}

/** 攻击拖拽：抓住战场上的单位，拖到敌方人物卡或主将上（与出牌同一套手感） */
function startUnitDrag(e, row, col, wrap) {
  if (busy || session.state.winner || session.state.active !== 'own') return;
  if (e.button !== undefined && e.button !== 0) return;

  var chk = Core.canAttack(session.state, 'own', row, col);
  var legal = Core.legalTargets(session.state, 'own', row, col);
  // 不能攻击就不进入拖拽，交给 click 去走"看详情"
  if (!chk.ok || !legal.targets.length) return;
  e.preventDefault();

  var rect = wrap.getBoundingClientRect();
  var ghost = wrap.cloneNode(true);
  ghost.classList.add('drag-ghost');
  ghost.style.width = rect.width + 'px';
  ghost.style.height = rect.height + 'px';
  ghost.style.left = rect.left + 'px';
  ghost.style.top = rect.top + 'px';
  document.body.appendChild(ghost);
  wrap.classList.add('is-dragging');

  drag = {
    kind: 'unit',
    row: row, col: col, wrap: wrap, ghost: ghost,
    dx: e.clientX - rect.left, dy: e.clientY - rect.top,
  };

  sel = { row: row, col: col };
  renderLanes(session.state);            // 复用点击选中时的高亮（函数名是 renderLanes）
  var u = session.state.sides.own.rows[row][col];
  showDetail('拖到目标发起攻击', u.name + ' ' + u.atk + '/' + u.hp,
    '可拖到高亮的敌方人物卡或其主将上');

  bindDragEvents();
}

function bindDragEvents() {
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragEnd);
  window.addEventListener('pointercancel', onDragEnd);
}

function onDragMove(e) {
  if (!drag) return;
  drag.ghost.style.left = (e.clientX - drag.dx) + 'px';
  drag.ghost.style.top = (e.clientY - drag.dy) + 'px';

  $all('.slot.is-hover, .unit-wrap.is-hover, .lord-bar.is-hover').forEach(function (el) {
    el.classList.remove('is-hover');
  });
  var t = dropAt(e.clientX, e.clientY);
  if (!t) return;
  if (drag.kind === 'card' && t.kind === 'slot' && t.el.classList.contains('is-placeable')) {
    t.el.classList.add('is-hover');
  } else if (drag.kind === 'unit' && (t.kind === 'unit' || t.kind === 'lord')) {
    if (t.el.classList.contains('is-target')) t.el.classList.add('is-hover');
  }
}

function onDragEnd(e) {
  if (!drag) return;
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragEnd);
  window.removeEventListener('pointercancel', onDragEnd);

  var t = dropAt(e.clientX, e.clientY);
  var d = drag;
  drag = null;

  d.ghost.remove();
  d.wrap.classList.remove('is-dragging');
  $all('.slot.is-placeable, .slot.is-hover, .unit-wrap.is-hover, .lord-bar.is-hover').forEach(function (el) {
    el.classList.remove('is-placeable', 'is-hover');
  });

  if (d.kind === 'card') {
    if (t && t.kind === 'slot' && t.el.classList.contains('is-placeable')) {
      doAction({
        type: 'PLAY_CARD', cardIndex: d.index,
        row: t.el.dataset.row, col: Number(t.el.dataset.col),
      });
    } else {
      clearMarks();
      showDetail('取消放置', d.card.name, '拖到绿色格子才能放置');
    }
    return;
  }

  // 攻击拖拽：落点必须是高亮过的合法目标，合法性一律由 Core.legalTargets 判定
  if (t && t.kind === 'unit' && t.el.classList.contains('is-target')) {
    doAction({
      type: 'ATTACK', from: { row: d.row, col: d.col },
      to: { kind: 'unit', row: t.el.dataset.row, col: Number(t.el.dataset.col) },
    });
  } else if (t && t.kind === 'lord' && t.el.classList.contains('is-target')) {
    doAction({ type: 'ATTACK', from: { row: d.row, col: d.col }, to: { kind: 'lord' } });
  } else {
    clearMarks();
    sel = null;
    showDetail('取消攻击', '', '拖到高亮的敌方人物卡或其主将上才能攻击');
  }
}

/** 落点解析：战场单位 / 主将条 / 格子（拖拽幽灵设了 pointer-events:none，不会拦截） */
function dropAt(x, y) {
  var el = document.elementFromPoint(x, y);
  for (var n = el; n; n = n.parentElement) {
    if (!n.classList) continue;
    if (n.classList.contains('unit-wrap')) return { kind: 'unit', el: n };
    if (n.classList.contains('lord-bar')) return { kind: 'lord', el: n };
    if (n.classList.contains('slot')) return { kind: 'slot', el: n };
  }
  return null;
}

/* ============================================================
   选中 / 攻击
   ============================================================ */

function clearMarks() {
  $all('.unit-wrap.is-selected, .unit-wrap.is-target, .slot.is-placeable, .slot.is-hover, .lord-bar.is-target')
    .forEach(function (el) {
      el.classList.remove('is-selected', 'is-target', 'is-placeable', 'is-hover');
    });
  $('#detail').classList.remove('show');
  if (session) renderLanes(session.state);
}

function showDetail(title, sub, why) {
  var d = $('#detail');
  d.innerHTML = '<h4>' + title + '</h4>' +
    (sub ? '<div class="sub">' + sub + '</div>' : '') +
    (why ? '<div class="why">' + why + '</div>' : '');
  d.classList.add('show');
}

function onSlotClick() {
  if (busy) return;
  clearMarks();
  sel = null;
  pendingSkill = null;
}

/** 谋臣主动技：点卡上的「技」按钮。合法性由 Core.canUseUnitSkill 判定 */
function onUnitSkillClick(row, col, skill) {
  if (busy || session.state.winner) return;
  var st = session.state;
  if (st.active !== 'own') { showDetail('主动技', skill.name, '现在不是你的回合'); return; }
  if (!skill.usable) { showDetail('主动技', skill.name, skill.why || '本回合不可用'); return; }

  var u = st.sides.own.rows[row][col];
  var def = (u.skills || []).filter(function (x) { return x.kind === 'active'; })[0];
  var needTarget = (def.effects || []).some(function (e) {
    return e.target && e.target.count === 1 && e.target.mode === 'choose';
  });
  if (needTarget) {
    var t0 = (def.effects || []).filter(function (e) { return e.target && e.target.count === 1 && e.target.mode === 'choose'; })[0].target;
    var sides = t0.side === 'both' ? ['own', 'enemy'] : [t0.side === 'enemy' ? 'enemy' : 'own'];
    var targets = [];
    sides.forEach(function (sd) {
      Core.allUnits(st, sd).forEach(function (r) { targets.push({ side: sd, row: r.row, col: r.col }); });
    });
    if (!targets.length) { showDetail('主动技', def.name, '没有合法目标'); return; }
    pendingSkill = { targets: targets, useSkill: { row: row, col: col } };
    targets.forEach(function (t) {
      var el = unitEl(t.side, t.row, t.col);
      if (el) el.classList.add('is-target');
    });
    showDetail('选择目标', def.name, '点击一名合法目标');
    return;
  }
  doAction({ type: 'USE_SKILL', row: row, col: col });
}

/** 主公技「选一张手牌」模式（如孙权坐断东南）。返回 true 表示已消费这次点击 */
function onHandPick(index) {
  if (!pendingSkill || !pendingSkill.handPick) return false;
  var action = pendingSkill.action || { type: 'USE_LORD_SKILL' };
  pendingSkill = null;
  var a = {};
  for (var k in action) a[k] = action[k];
  a.handIndex = index;
  doAction(a);
  return true;
}

function onUnitClick(side, row, col) {
  if (busy || session.state.winner) return;

  // ① 主公技等待选目标（ADR-051：仁德可指定敌我任何人，故不再限定 side==='own'）
  if (pendingSkill && pendingSkill.targets) {
    var okSkill = pendingSkill.targets.some(function (t) {
      return t.side === side && t.row === row && t.col === col;
    });
    if (okSkill) {
      var act = pendingSkill.useSkill
        ? { type: 'USE_SKILL', row: pendingSkill.useSkill.row, col: pendingSkill.useSkill.col,
            target: { side: side, row: row, col: col } }
        : { type: 'USE_LORD_SKILL', target: { side: side, row: row, col: col } };
      pendingSkill = null;
      doAction(act);
      return;
    }
  }

  // ② 已选中我方单位 + 点敌方单位 → 攻击
  if (sel && sel.kind === 'unit' && side === 'enemy') {
    var hit = $all('.unit-wrap.is-target').some(function (el) {
      var d = el.parentElement.dataset;
      return d.side === side && d.row === row && Number(d.col) === col;   // ← dataset 是字符串，必须转数字
    });
    if (hit) {
      doAction({ type: 'ATTACK', from: { row: sel.row, col: sel.col }, to: { kind: 'unit', row: row, col: col } });
      return;
    }
  }

  clearMarks();
  var st = session.state;

  // ③ 点敌方 / 非我方回合 → 只看信息
  if (side === 'enemy' || st.active !== 'own') {
    var u0 = st.sides[side].rows[row][col];
    if (u0) showDetail(side === 'enemy' ? '敌方单位' : '我方单位',
      u0.name + '（列' + (col + 1) + '·' + (row === 'front' ? '前军' : '后军') + '）',
      '攻击 ' + u0.atk + ' / 生命 ' + u0.hp + '/' + u0.maxHp + (u0.kw.length ? '｜' + u0.kw.join('、') : ''));
    return;
  }

  // ④ 选我方单位 → 高亮合法目标
  sel = { kind: 'unit', row: row, col: col };
  var wrap = document.querySelector('.slot[data-side="own"][data-row="' + row + '"][data-col="' + col + '"] .unit-wrap');
  if (wrap) wrap.classList.add('is-selected');

  var res = Core.legalTargets(st, 'own', row, col);
  res.targets.forEach(function (t) {
    if (t.kind === 'lord') {
      var lordEl = document.getElementById('lord-' + t.side);
      if (lordEl) lordEl.classList.add('is-target');
      return;
    }
    var el = document.querySelector('.slot[data-side="' + t.side + '"][data-row="' + t.row + '"][data-col="' + t.col + '"] .unit-wrap');
    if (el) el.classList.add('is-target');
  });
  renderLanes(st);

  var u = st.sides.own.rows[row][col];
  if (!res.targets.length) showDetail('无法攻击', u.name, res.why);
  else showDetail('选择攻击目标', u.name + '（攻击力 ' + Core.effectiveAttack(st, 'own', row, col) + '）', res.why);
}

function onLordClick(side, bar) {
  if (busy || session.state.winner) return;
  if (sel && sel.kind === 'unit' && side === 'enemy' && bar.classList.contains('is-target')) {
    doAction({ type: 'ATTACK', from: { row: sel.row, col: sel.col }, to: { kind: 'lord' } });
    return;
  }
  clearMarks();
  var l = session.state.sides[side].lord;
  showDetail(side === 'enemy' ? '敌方主公' : '我方主公',
    l.name + '　♥ ' + l.hp + (l.armor ? '　◈ ' + l.armor : ''),
    '主公技：' + l.skill + '（消耗 ' + ((l.skillDef && l.skillDef.cost) || 2) + ' 统率 / 每回合 1 次）');
}

/**
 * 主公技：费用与是否需要选目标都**从数据读**（ADR-049/051）。
 *
 * 原先按中文技能名硬编码（仁德/号令），主公技数据化后那些分支全部失效；
 * 现在只看 skillDef.cost 与 effects[].target 的形状。
 */
function onLordSkillClick(side) {
  if (busy || session.state.winner) return;
  var st = session.state;
  if (side !== 'own' || st.active !== 'own') return;

  var lord = st.sides.own.lord;
  var sk = lord.skillDef;
  if (!sk) { showDetail('主公技', lord.skill, '该主公没有可用的主公技'); return; }
  var cost = sk.cost || 2;

  if (lord.skillUsedThisTurn) { showDetail('主公技', lord.skill, '本回合已使用过'); return; }
  if (st.sides.own.command.cur < cost) {
    showDetail('主公技', lord.skill, '统率值不足（需要 ' + cost + '）');
    return;
  }

  // 需要选目标吗？看效果里有没有带 count:1 + mode:'choose' 的选择器
  var picks = (sk.effects || []).filter(function (e) {
    return e.target && e.target.count === 1 && e.target.mode === 'choose';
  });
  if (picks.length) {
    clearMarks();
    var sel0 = picks[0].target;
    // side:'both' → 敌我都能选（仁德）；否则按 selector 的 side
    var sides = sel0.side === 'both' ? ['own', 'enemy'] : [sel0.side === 'enemy' ? 'enemy' : 'own'];
    var targets = [];
    sides.forEach(function (sd) {
      Core.allUnits(st, sd).forEach(function (r) {
        targets.push({ side: sd, row: r.row, col: r.col });
      });
    });
    if (!targets.length) { showDetail('主公技', lord.skill, '场上没有可选人物'); return; }
    pendingSkill = { targets: targets };
    targets.forEach(function (t) {
      var el = document.querySelector('.slot[data-side="' + t.side + '"][data-row="' + t.row + '"][data-col="' + t.col + '"] .unit-wrap');
      if (el) el.classList.add('is-target');
    });
    showDetail('选择目标', lord.skill + '（消耗 ' + cost + ' 统率）',
      sel0.side === 'both' ? '点击任意一名场上人物（敌我皆可）' : '点击一名符合条件的己方人物');
    return;
  }

  // 不需要选目标（奸雄/坐断东南）——坐断东南要指定弃哪张手牌
  var needsHand = (sk.effects || []).some(function (e) {
    return e.action === 'cycle_to_deck' || (e.action === 'discard' && e.mode === 'choose');
  });
  if (needsHand) {
    var hand = st.sides.own.hand;
    if (!hand.length) { showDetail('主公技', lord.skill, '手牌为空，无法使用'); return; }
    // 进入「选一张手牌」模式：给手牌加高亮，由 onHandClick 处理
    pendingSkill = { handPick: true, action: { type: 'USE_LORD_SKILL' } };
    $all('.hcard-wrap').forEach(function (el) { el.classList.add('is-target'); });
    showDetail('选择手牌', lord.skill + '（消耗 ' + cost + ' 统率）', '点击一张手牌放回牌组随机位置，再随机抽一张');
    return;
  }

  doAction({ type: 'USE_LORD_SKILL' });
}

function onEndTurn() {
  if (busy || session.state.winner) return;
  if (session.state.active !== 'own') return;
  doAction({ type: 'END_TURN' });
}

function doAction(action) {
  if (busy || session.state.winner) return;
  var res = Core.applyAction(session.state, session.ctx, action);
  if (!res.ok) {
    showDetail('操作无效', res.error || '', '');
    return;
  }
  session = { state: res.state, ctx: session.ctx };
  busy = true;
  clearMarks();
  sel = null; pendingSkill = null;
  playEvents(res.events, function () {
    busy = false;
    renderAll();
    if (session.state.winner) {
      banner('对局结束', session.state.winner === 'own' ? '我方胜利' : session.state.winner === 'enemy' ? '敌方胜利' : '平局');
    } else if (shouldAuto()) {
      setTimeout(runAiTurn, 350);
    }
  });
}

/* ============================================================
   事件日志（做卡牌测试最关键的一环：能看见"这张卡到底做了什么"）
   ============================================================ */

var LOG_MAX = 300;
var lastAttack = null;        // 本次攻击，用于在"没有反击"时说明原因
var drawnThisAction = false;  // 本次结算抽过牌 → renderAll 后高亮最新手牌
var SIDE_NAME = { own: '我方', enemy: '敌方' };
var STATUS_NAME = null;

function statusName(id) {
  if (!STATUS_NAME) {
    STATUS_NAME = {};
    (GD.statuses || []).forEach(function (st) { STATUS_NAME[st.id] = st.name; });
  }
  return STATUS_NAME[id] || id;
}

/** 把一个事件翻成一行可读中文；返回 null 表示不记 */
function describeEvent(e) {
  var who = SIDE_NAME[e.side] || e.side || '';
  switch (e.type) {
    case 'TURN_START': return { cls: 'turn', text: '—— 第 ' + Math.ceil(e.turn / 2) + ' 回合 · ' + who + '（统率 ' + e.command.cur + '/' + e.command.max + '）——' };
    case 'CARD_DRAWN': return { cls: '', text: who + ' 抽到 <b>' + e.card.name + '</b>（牌库剩 ' + e.deckLeft + '）' };
    case 'CARD_AUTO_CAST': return { cls: 'eff', text: who + ' <b>' + e.card.name + '</b> 抽到时自动释放！' };
    case 'DECK_ADDED': return { cls: 'eff', text: who + ' 牌库加入 ' + e.count + ' 张 <b>' + e.card.name + '</b>' };
    case 'DECK_SENT': return { cls: 'eff', text: '把 ' + e.count + ' 张 ' + e.cardId + ' 塞进' + who + '牌库' };
    case 'CARD_RETURNED_TO_DECK': return { cls: '', text: who + ' 把 <b>' + e.card.name + '</b> 洗回牌库' };
    case 'CARD_PLAYED': return { cls: '', text: who + ' 打出 <b>' + e.card.name + '</b>' + (e.col != null ? '（第' + (e.col + 1) + '格）' : '') };
    case 'UNIT_SUMMONED': return { cls: '', text: '　' + who + ' 上场 <b>' + e.unit.name + '</b> ' + e.unit.atk + '/' + e.unit.hp + '（第' + (e.col + 1) + '格）' };
    case 'UNIT_TRANSFORMED': return { cls: 'eff', text: '　' + who + ' 进化：' + e.from + ' → <b>' + (e.unit ? e.unit.name : e.to) + '</b>' };
    case 'ATTACK_DECLARED': return { cls: '', text: who + ' 第' + (e.from.col + 1) + '格 攻击 ' + (e.to && e.to.kind === 'lord' ? (SIDE_NAME[e.to.side] || '') + '主将' : '第' + (e.to.col + 1) + '格') };
    case 'DAMAGE': {
      // DAMAGE 事件没有顶层 side，挨打的是谁只能看 target.side。
      // 早先误用 who（＝undefined）→ 日志成了没头没尾的"→ -2"，也分不清打的是谁。
      var tgt = e.target.kind === 'lord'
        ? (SIDE_NAME[e.target.side] || '') + '主将'
        : (SIDE_NAME[e.target.side] || '') + '第' + (e.target.col + 1) + '格';
      return { cls: 'dmg', text: '　→ ' + tgt + ' <b>-' + e.amount + '</b>' + (e.source ? '（' + e.source + '）' : '') };
    }
    case 'HEAL': {
      var htg = e.target.kind === 'lord'
        ? (SIDE_NAME[e.target.side] || '') + '主将'
        : (SIDE_NAME[e.target.side] || '') + '第' + (e.target.col + 1) + '格';
      return { cls: 'heal', text: '　→ ' + htg + ' <b>+' + e.amount + '</b> 治疗' };
    }
    case 'UNIT_DIED': return { cls: 'death', text: '　✝ ' + who + ' <b>' + e.unit.name + '</b> 阵亡' };
    case 'STATUS_APPLIED': return { cls: 'eff', text: '　' + who + ' 获得状态 <b>' + statusName(e.status) + '</b>' + (e.stacks > 1 ? ' ×' + e.stacks : '') };
    case 'STATUS_EXPIRED': return { cls: '', text: '　' + who + ' 状态 <b>' + statusName(e.status) + '</b> 到期' };
    case 'STAT_MODIFIED': return { cls: 'eff', text: '　' + who + ' 属性变化 ' + (e.attack ? '攻' + (e.attack > 0 ? '+' : '') + e.attack : '') + (e.health ? ' 血' + (e.health > 0 ? '+' : '') + e.health : '') };
    case 'ARMOR_GAINED': return { cls: 'eff', text: '　' + who + ' 获得护甲 <b>' + e.amount + '</b>（共 ' + e.armor + '）' };
    case 'LORD_SKILL_USED': return { cls: 'lord', text: who + ' 发动主公技 <b>' + e.skill + '</b>' };
    case 'CARD_DISCARDED': return { cls: '', text: who + ' 弃掉 <b>' + e.card.name + '</b>' };
    case 'CARD_STOLEN': return { cls: 'eff', text: (SIDE_NAME[e.from] || '') + ' 的一张 <b>' + e.card.name + '</b> 被夺走' };
    case 'CARD_SCRYED': return { cls: 'eff', text: who + ' 牌库操作：' + e.cardId + '（' + (e.from === 'top' ? '顶' : '底') + '）' };
    case 'CLASH': return { cls: 'eff', text: '拼点 ' + who + ' ' + e.mine + ' vs ' + e.theirs + ' → ' + (e.won ? '胜' : '负') };
    case 'FATIGUE': return { cls: 'dmg', text: '　' + who + ' <b>粮尽</b>！受到 ' + e.amount + ' 点伤害' };
    case 'DRAW_BLOCKED': return { cls: 'eff', text: '　' + who + ' 抽牌被封锁（断抽）' };
    case 'DAMAGE_REDIRECTED': return { cls: 'eff', text: '　伤害被 <b>' + e.guardName + '</b> 守护转移' };
    case 'UNIT_RETURNED': return { cls: '', text: '　' + who + ' <b>' + e.unit.name + '</b> 被收回手牌' };
    case 'FORCED_ATTACK': return { cls: 'eff', text: '　' + who + ' 第' + (e.col + 1) + '格 被强制攻击' };
    case 'EXTRA_ATTACK': return { cls: 'eff', text: '　' + who + ' 第' + (e.col + 1) + '格 获得额外攻击' };
    case 'UNIT_SURVIVED': return { cls: 'eff', text: '　✦ ' + who + ' <b>' + e.unit.name + '</b> 免死存活（1 血）' };
    case 'UNIT_FLIPPED': return { cls: 'eff', text: '　' + who + ' <b>' + e.unit.name + '</b> ' + (e.to === 'back' ? '翻面（下回合翻回）' : '翻回正面') };
    case 'SKILL_COPIED': return { cls: 'eff', text: '　' + who + ' 复制了技能 <b>' + e.skill + '</b>' };
    case 'STATUS_BLOCKED': return { cls: '', text: '　' + who + ' 的状态 ' + statusName(e.status) + ' 被挡下（' + e.reason + '）' };
    case 'LORD_STATUS_EXPIRED': return { cls: '', text: '　' + who + ' 主将状态 ' + statusName(e.status) + ' 到期' };
    case 'CONTROL_TAKEN': return { cls: 'eff', text: '　<b>' + e.unit.name + '</b> 控制权 ' + (SIDE_NAME[e.from] || '') + ' → ' + (SIDE_NAME[e.to] || '') };
    case 'HAND_MODIFIED': return { cls: 'eff', text: '　' + who + ' 手牌被修改（' + e.kind + ' ' + (e.value || '') + '）' };
    case 'TURN_END': return null;
    case 'REJECTED': return { cls: 'err', text: '⚠ 动作被拒：' + e.reason };
    case 'GAME_OVER': return { cls: 'turn', text: '＝ 对局结束：' + (e.winner === 'own' ? '我方胜利' : e.winner === 'enemy' ? '敌方胜利' : '平局') + ' ＝' };
    default: return { cls: 'eff', text: '[' + e.type + ']' };
  }
}

function logClear() {
  var el = $('#log');
  if (el) { el.innerHTML = ''; el.classList.add('show'); }
}

function logEvents(events) {
  var el = $('#log');
  if (!el) return;
  var html = '';
  events.forEach(function (e) {
    var d = describeEvent(e);
    if (!d) return;
    html += '<div class="le ' + (d.cls || '') + '">' + d.text + '</div>';
  });
  if (!html) return;
  el.insertAdjacentHTML('beforeend', html);
  while (el.children.length > LOG_MAX) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}

function playEvents(events, done) {
  logEvents(events);
  lastAttack = null;
  drawnThisAction = false;
  var queue = events.slice();
  (function next() {
    if (!queue.length) { done(); return; }
    var e = queue.shift();
    var wait = animate(e);
    if (wait > 0) setTimeout(next, wait); else next();
  })();
}

/** 读卡面上某个数字（攻/血），用于判断"会不会有反击" */
function statOf(el, sel) {
  var n = el && el.querySelector(sel);
  if (!n) return null;
  var v = parseInt(String(n.textContent).replace(/[^0-9-]/g, ''), 10);
  return isNaN(v) ? null : v;
}

/** 一张卡背从牌堆飞到手牌（起牌的可见反馈） */
function flyCardBack(fromEl, toEl) {
  var a = fromEl.getBoundingClientRect();
  var b = toEl.getBoundingClientRect();
  var g = document.createElement('div');
  g.className = 'cr-flying';
  g.style.cssText = 'width:15px;height:21px;border-radius:2px;'
    + 'background:linear-gradient(135deg,#5a4a2e 0%,#2a1f12 55%,#3a2c1a 100%);'
    + 'box-shadow:inset 0 0 0 1px #8a7048;';
  g.style.left = a.left + 'px';
  g.style.top = a.top + 'px';
  document.body.appendChild(g);
  var dx = (b.left + b.width / 2) - (a.left + a.width / 2);
  var dy = (b.top + b.height / 2) - (a.top + a.height / 2);
  void g.offsetWidth;
  g.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(1.35)';
  setTimeout(function () { g.remove(); }, 400);
}

function unitEl(side, row, col) {
  return document.querySelector('.slot[data-side="' + side + '"][data-row="' + row + '"][data-col="' + col + '"] .unit-wrap');
}
function lordEl(side) { return document.getElementById('lord-' + side); }

/* ---------- 伤害来源分类 ----------
   事件里的 source 是：攻击者单位名（普攻）/「反击」/「中毒」/「摧毁」/
   「fatigue」/ 战法或事件卡名。做卡牌测试时"这一下是谁打的"最关键，
   所以按来源分色 + 在飘字下标出出处。 */
var CARD_TYPE_BY_NAME = null;
function cardTypeByName(name) {
  if (!CARD_TYPE_BY_NAME) {
    CARD_TYPE_BY_NAME = {};
    (GD.cards || []).forEach(function (c) { CARD_TYPE_BY_NAME[c.name] = c.type; });
  }
  return CARD_TYPE_BY_NAME[name];
}

function damageFlavor(e) {
  var src = e.source || '';
  if (src === '反击') return { cls: 'is-counter', label: '反击' };
  if (src === 'fatigue' || src === '粮尽') return { cls: 'is-fatigue', label: '粮尽' };
  if (src === '中毒') return { cls: 'is-status', label: '中毒' };
  var t = cardTypeByName(src);
  if (t === 'tactic' || t === 'event' || src === '摧毁' || src === '效果') {
    return { cls: 'is-skill', label: src };
  }
  return { cls: 'is-dmg', label: src || '攻击' };
}

/** 把刚上场的单位立刻插进格子：否则它要等整段动画播完才出现，
 *  后续的伤害/阵亡动画就找不到元素（renderAll 在事件全部播完才跑）。 */
function insertUnitNow(e) {
  var slot = document.querySelector('.slot[data-side="' + e.side + '"][data-row="' + e.row + '"][data-col="' + e.col + '"]');
  if (!slot || !e.unit) return null;
  var wrap = slot.querySelector('.unit-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'unit-wrap';
    slot.appendChild(wrap);
  }
  wrap.innerHTML = '';
  wrap.dataset.uid = e.unit.uid;
  wrap.appendChild(CR.mini(e.unit, { row: e.row, hurt: false, statuses: statusList(e.unit) }));
  var flash = document.createElement('div');
  flash.className = 'cr-land-flash';
  wrap.appendChild(flash);
  wrap.classList.add('cr-land-bounce');
  setTimeout(function () { flash.remove(); wrap.classList.remove('cr-land-bounce'); }, 460);
  return wrap;
}

function animate(e) {
  switch (e.type) {
    case 'CARD_DRAWN': {
      // 起牌原先是"日志里多一行"，肉眼几乎察觉不到 —— 现改为
      // 牌堆闪光 + 一张卡背从牌堆飞向手牌，并记下待高亮的手牌序号。
      var pile = $(e.side === 'own' ? '#own-deck-pile' : '#foe-deck-pile');
      var hp2 = $(e.side === 'own' ? '#own-hand-pile' : '#foe-hand-pile');
      if (pile) {
        pile.classList.add('is-drawing');
        setTimeout(function () { pile.classList.remove('is-drawing'); }, 460);
      }
      if (pile && hp2) flyCardBack(pile, hp2);
      if (e.side === 'own') drawnThisAction = true;
      return 300;
    }
    case 'CARD_PLAYED': {
      if (e.row === undefined) {
        // 战法 / 事件卡：没有落点，用整块战场闪光表示"技能释放"
        CR.spell(null, null, true);
        return 340;
      }
      var handEl = document.querySelector('.hcard-wrap[data-card-index="' + e.handIndex + '"]');
      var slotEl = document.querySelector('.slot[data-side="' + e.side + '"][data-row="' + e.row + '"][data-col="' + e.col + '"]');
      if (handEl && slotEl) { CR.flyTo(handEl, slotEl, null); return 430; }
      return 0;
    }
    case 'UNIT_SUMMONED': {
      insertUnitNow(e);
      return 240;
    }
    case 'UNIT_TRANSFORMED': {
      var te = unitEl(e.side, e.row, e.col);
      if (te && e.unit) {
        te.innerHTML = '';
        te.appendChild(CR.mini(e.unit, { row: e.row, hurt: e.unit.hp < e.unit.maxHp, statuses: statusList(e.unit) }));
        CR.spell(te, 'rgba(255,225,150,.95)');
      }
      return 320;
    }
    case 'ATTACK_DECLARED': {
      var from = unitEl(e.side, e.from.row, e.from.col);
      var to = e.to && e.to.kind === 'lord' ? lordEl(e.to.side)
             : e.to ? unitEl(e.to.side, e.to.row, e.to.col) : null;
      if (from && to) CR.attack(from, to, null);
      // ADR-062：反击是**同时结算**的，打死目标也照样吃它这一下；
      // 唯一没有反击的情形是目标 0 攻。玩家看不到数字时会以为规则没生效，
      // 故这里主动说明原因。
      if (from && to && e.to && e.to.kind === 'unit') {
        var atk = statOf(to, '.cr-stat.atk');
        var rec = { attackerEl: from, targetEl: to, targetAtk: atk, seen: false, killed: false };
        lastAttack = rec;
        setTimeout(function () {
          if (lastAttack !== rec || rec.seen || rec.killed) return;
          if (atk === 0) CR.float(from, '无反击', 'is-nerf', '对方 0 攻');
        }, 760);
      }
      return 300;
    }
    case 'DAMAGE': {
      var el = e.target.kind === 'lord' ? lordEl(e.target.side)
             : unitEl(e.target.side, e.target.row, e.target.col);
      var f = damageFlavor(e);
      if (e.source === '反击' && lastAttack) lastAttack.seen = true;
      if (el) {
        el.classList.add('cr-hit');
        setTimeout(function () { el.classList.remove('cr-hit'); }, 320);
        CR.spell(el, f.cls === 'is-skill' ? 'rgba(200,150,255,.9)' : null);
        CR.float(el, '-' + e.amount, f.cls + (e.amount >= 4 ? ' is-big' : ''), f.label);
        CR.tickHp(el, -e.amount);          // 卡面血量当场掉下来
      }
      return 300;
    }
    case 'HEAL': {
      var he = e.target.kind === 'lord' ? lordEl(e.target.side)
             : unitEl(e.target.side, e.target.row, e.target.col);
      if (he) {
        CR.float(he, '+' + e.amount, 'is-heal', '治疗');
        CR.tickHp(he, e.amount);
      }
      return 260;
    }
    case 'ARMOR_GAINED': {
      var le = lordEl(e.side);
      if (le) CR.float(le, '◈+' + e.amount, 'is-armor', '护甲');
      return 240;
    }
    case 'STATUS_APPLIED': {
      var se = unitEl(e.side, e.row, e.col);
      if (se) CR.float(se, statusName(e.status) + (e.stacks > 1 ? '×' + e.stacks : ''), 'is-status', '状态');
      return 220;
    }
    case 'STAT_MODIFIED': {
      var me = unitEl(e.side, e.row, e.col);
      if (me) {
        var txt = (e.attack ? '攻' + (e.attack > 0 ? '+' : '') + e.attack : '')
                + (e.health ? ' 血' + (e.health > 0 ? '+' : '') + e.health : '');
        CR.float(me, txt.trim() || '属性变化', (e.attack > 0 || e.health > 0) ? 'is-buff' : 'is-nerf');
      }
      return 220;
    }
    case 'STATUS_EXPIRED': {
      // 圣盾（immune_damage）触发时 dealDamage 直接返回 0、只发 STATUS_EXPIRED，
      // 不产生 DAMAGE 事件 —— 不提示的话玩家会以为"这一下怎么没掉血"。
      if (e.status === 'sheng_dun_status' || e.status === 'sheng_dun') {
        var sde = unitEl(e.side, e.row, e.col);
        if (sde) CR.float(sde, '圣盾', 'is-buff', '免疫本次伤害');
        return 320;
      }
      return 0;
    }
    case 'UNIT_FLIPPED': {
      var fe2 = unitEl(e.side, e.row, e.col);
      if (fe2) CR.float(fe2, e.to === 'back' ? '翻面' : '翻回正面', 'is-nerf');
      return 240;
    }
    case 'UNIT_SURVIVED': {
      var ve = unitEl(e.side, e.row, e.col);
      if (ve) CR.float(ve, '免死', 'is-buff', '1 血存活');
      return 300;
    }
    case 'DAMAGE_REDIRECTED': {
      var ge = unitEl(e.side, e.row, e.col);
      if (ge) CR.float(ge, '守护', 'is-buff', e.guardName);
      return 240;
    }
    case 'UNIT_DIED': {
      var de = unitEl(e.side, e.row, e.col);
      if (de) {
        CR.float(de, '✝', 'is-dmg', e.unit ? e.unit.name : '');
        CR.die(de, null);
        if (lastAttack && lastAttack.targetEl === de) lastAttack.killed = true;
        return 520;
      }
      return 0;
    }
    case 'TURN_START': {
      banner('第 ' + e.turn + ' 回合', e.side === 'own' ? '我方' : '敌方');
      return 320;
    }
    case 'LORD_SKILL_USED': {
      var lse = lordEl(e.side);
      if (lse) {
        CR.spell(lse, 'rgba(255,220,140,.95)');
        CR.float(lse, e.skill, 'is-buff', '主公技');
      }
      return 380;
    }
    case 'FATIGUE': {
      var fte = lordEl(e.side);
      if (fte) {
        CR.float(fte, '-' + e.amount, 'is-fatigue', '粮尽');
        CR.tickHp(fte, -e.amount);
      }
      return 260;
    }
    case 'CLASH': {
      var ce = lordEl(e.side);
      if (ce) CR.float(ce, e.mine + ' vs ' + e.theirs, e.won ? 'is-buff' : 'is-nerf', '拼点');
      return 320;
    }
    default:
      return 0;
  }
}

function banner(title, sub) {
  var b = document.getElementById('banner');
  b.innerHTML = '<b>' + title + '</b>' + (sub ? '<span>' + sub + '</span>' : '');
  b.classList.add('show');
  setTimeout(function () { b.classList.remove('show'); }, 900);
}

/* ============================================================
   AI 对手
   ============================================================ */

/** 双 AI 对打：我方也交给 AI。用于自动跑完整局，
 *  连续触发普攻/反击/技能/阵亡动画，也方便观察机制与平衡。 */
var AUTO_BOTH = location.search.indexOf('autoboth') >= 0;

/** 当前该由 AI 接管吗（敌方回合恒为真；我方仅双 AI 模式） */
function shouldAuto() {
  return session.state.active === 'enemy' || AUTO_BOTH;
}

function runAiTurn() {
  if (busy || session.state.winner || !shouldAuto()) return;
  var action = Core.chooseAction(session.state, session.ctx) || { type: 'END_TURN' };
  var res = Core.applyAction(session.state, session.ctx, action);
  if (!res.ok) {
    var end = Core.applyAction(session.state, session.ctx, { type: 'END_TURN' });
    session = { state: end.state, ctx: session.ctx };
    busy = true;
    playEvents(end.events, function () { busy = false; renderAll(); });
    return;
  }
  session = { state: res.state, ctx: session.ctx };
  busy = true;
  playEvents(res.events, function () {
    busy = false;
    renderAll();
    if (session.state.winner) {
      banner('对局结束', session.state.winner === 'own' ? '我方胜利' : '敌方胜利');
      return;
    }
    if (shouldAuto()) setTimeout(runAiTurn, 320);
  });
}

/* ============================================================
   尺寸与适配
   ============================================================ */

var NOSCALE = location.search.indexOf('noscale') >= 0;

function fitStage() {
  var canvas = $('#canvas');
  if (NOSCALE) {
    canvas.style.transform = 'none';
    canvas.style.left = '0px'; canvas.style.top = '0px';
    window.__scale = 1; return 1;
  }
  var s = Math.min(window.innerWidth / DESIGN_W, window.innerHeight / DESIGN_H);
  canvas.style.transform = 'scale(' + s + ')';
  window.__scale = s;
  return s;
}

function reportSizes() {
  var s = fitStage();
  var slot = document.querySelector('.slot');
  var hcard = document.querySelector('.hcard-wrap');
  if (!slot || !hcard) return;
  var cw = (slot.getBoundingClientRect().width / s).toFixed(0);
  var ch = (slot.getBoundingClientRect().height / s).toFixed(0);
  var used = $('#canvas').scrollHeight;
  $('#fit-report').innerHTML = used > DESIGN_H
    ? '<span class="warn">⚠ 内容 ' + used + 'pt 超出 ' + DESIGN_H + 'pt</span>'
    : '<span class="ok">✓ 内容 ' + used + 'pt / ' + DESIGN_H + 'pt</span>';
  $('#size-report').innerHTML = '卡牌 ' + cw + '×' + ch + 'pt｜缩放 ' + (s * 100).toFixed(0) + '%';
}

/* ============================================================
   启动
   ============================================================ */

document.querySelector('.panel .btn').addEventListener('click', onEndTurn);
$('#btn-reset').addEventListener('click', function () { newGame(); });
$('#btn-ai').addEventListener('click', function () {
  if (session.state.active === 'enemy') runAiTurn();
});
$('#btn-auto').addEventListener('click', function () {
  AUTO_BOTH = !AUTO_BOTH;
  this.classList.toggle('is-on', AUTO_BOTH);
  this.textContent = AUTO_BOTH ? '双 AI 对打 ●' : '双 AI 对打';
  if (AUTO_BOTH && !busy && !session.state.winner) setTimeout(runAiTurn, 200);
});
document.addEventListener('click', function () {
  if (busy || drag) return;
  clearMarks();
  sel = null;
  pendingSkill = null;
});
window.addEventListener('resize', reportSizes);

if (location.search.indexOf('clean') >= 0) {
  document.getElementById('hud').style.display = 'none';
  document.getElementById('detail').style.display = 'none';
}

newGame();
