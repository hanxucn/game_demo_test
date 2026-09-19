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
    },
  });
}

/* ============================================================
   渲染
   ============================================================ */

function renderAll() {
  var st = session.state;
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

function renderPanel(st) {
  var s = st.sides.own;
  $('#cmd-num').innerHTML = s.command.cur + '<small> / ' + s.command.max + '</small>';
  $('#turn-num').textContent = st.turn;
  $('#hand-num').textContent = s.hand.length;
  $('#deck-num').textContent = s.deck.length;
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
          // 不能攻击的单位置灰（已攻击过 / 本回合入场 / 被震慑）
          if (side === 'own' && !Core.canAttack(st, 'own', row, col).ok) wrap.classList.add('is-tired');
          wrap.appendChild(CR.mini(u, { row: row, hurt: u.hp < u.maxHp }));
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
  list.forEach(function (c, i) {
    var wrap = document.createElement('div');
    wrap.className = 'hcard-wrap';
    wrap.dataset.cardIndex = String(i);
    var off = i - mid;
    wrap.style.setProperty('--rot', (off * 3.2) + 'deg');
    wrap.style.setProperty('--lift', (Math.abs(off) * 1.8) + 'px');
    wrap.style.zIndex = 10 + i;
    wrap.appendChild(CR.big(viewCard(c)));

    if (isCharacter(c)) {
      // 人物卡：按住拖到战场
      wrap.addEventListener('pointerdown', function (e) { startDrag(e, i, c, wrap); });
      wrap.addEventListener('click', function (e) {
        e.stopPropagation();
        if (busy || session.state.winner || session.state.active !== 'own') return;
        onHandPick(i);
      });
    } else {
      // 非人物卡：点击直接打出
      wrap.addEventListener('click', function (e) {
        e.stopPropagation();
        if (busy || session.state.winner || session.state.active !== 'own') return;
        if (onHandPick(i)) return;                       // 主公技正在等选一张手牌
        doAction({ type: 'PLAY_CARD', cardIndex: i });
      });
    }
    hand.appendChild(wrap);
  });
}

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
    index: index, card: card, wrap: wrap, ghost: ghost,
    dx: e.clientX - rect.left, dy: e.clientY - rect.top,
  };

  Core.legalPlacements(session.state, 'own').forEach(function (s) {
    var el = document.querySelector('.slot[data-side="own"][data-row="' + s.row + '"][data-col="' + s.col + '"]');
    if (el) el.classList.add('is-placeable');
  });
  showDetail('拖到战场放置', card.name + '（' + card.cost + ' 费）', '绿色格子为可放置位置');

  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragEnd);
  window.addEventListener('pointercancel', onDragEnd);
}

function onDragMove(e) {
  if (!drag) return;
  drag.ghost.style.left = (e.clientX - drag.dx) + 'px';
  drag.ghost.style.top = (e.clientY - drag.dy) + 'px';

  var slot = slotAt(e.clientX, e.clientY);
  $all('.slot.is-hover').forEach(function (el) { el.classList.remove('is-hover'); });
  if (slot && slot.classList.contains('is-placeable')) slot.classList.add('is-hover');
}

function onDragEnd(e) {
  if (!drag) return;
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragEnd);
  window.removeEventListener('pointercancel', onDragEnd);

  var slot = slotAt(e.clientX, e.clientY);
  var valid = slot && slot.classList.contains('is-placeable');
  var d = drag;
  drag = null;

  d.ghost.remove();
  d.wrap.classList.remove('is-dragging');
  $all('.slot.is-placeable, .slot.is-hover').forEach(function (el) {
    el.classList.remove('is-placeable', 'is-hover');
  });

  if (valid && slot) {
    doAction({
      type: 'PLAY_CARD', cardIndex: d.index,
      row: slot.dataset.row, col: Number(slot.dataset.col),
    });
  } else {
    clearMarks();
    showDetail('取消放置', d.card.name, '拖到绿色格子才能放置');
  }
}

/** 找到坐标下的格子（拖拽幽灵元素设了 pointer-events:none，不会拦截） */
function slotAt(x, y) {
  var el = document.elementFromPoint(x, y);
  while (el && !el.classList.contains('slot')) el = el.parentElement;
  return el;
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
      pendingSkill = null;
      doAction({ type: 'USE_LORD_SKILL', target: { side: side, row: row, col: col } });
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
    } else if (session.state.active === 'enemy') {
      setTimeout(runAiTurn, 350);
    }
  });
}

/* ============================================================
   事件日志（做卡牌测试最关键的一环：能看见"这张卡到底做了什么"）
   ============================================================ */

var LOG_MAX = 300;
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
    case 'ATTACK_DECLARED': return { cls: '', text: who + ' 第' + (e.from.col + 1) + '格 攻击 ' + (e.to && e.to.kind === 'lord' ? '敌方主将' : '第' + (e.to.col + 1) + '格') };
    case 'DAMAGE': return { cls: 'dmg', text: '　→ ' + (e.target.kind === 'lord' ? who + '主将' : '') + '<b>-' + e.amount + '</b>' + (e.source ? '（' + e.source + '）' : '') };
    case 'HEAL': return { cls: 'heal', text: '　→ <b>+' + e.amount + '</b> 治疗' };
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
  var queue = events.slice();
  (function next() {
    if (!queue.length) { done(); return; }
    var e = queue.shift();
    var wait = animate(e);
    if (wait > 0) setTimeout(next, wait); else next();
  })();
}

function unitEl(side, row, col) {
  return document.querySelector('.slot[data-side="' + side + '"][data-row="' + row + '"][data-col="' + col + '"] .unit-wrap');
}
function lordEl(side) { return document.getElementById('lord-' + side); }

function animate(e) {
  switch (e.type) {
    case 'CARD_PLAYED': {
      if (e.row === undefined) return 0;
      var handEl = document.querySelector('.hcard-wrap[data-card-index="' + e.handIndex + '"]');
      var slotEl = document.querySelector('.slot[data-side="' + e.side + '"][data-row="' + e.row + '"][data-col="' + e.col + '"]');
      if (handEl && slotEl) { CR.flyTo(handEl, slotEl, null); return 430; }
      return 0;
    }
    case 'ATTACK_DECLARED': {
      var from = unitEl(e.side, e.from.row, e.from.col);
      var to = e.to && e.to.kind === 'lord' ? lordEl(e.to.side)
             : e.to ? unitEl(e.to.side, e.to.row, e.to.col) : null;
      if (from && to) { CR.attack(from, to, null); return 300; }
      return 0;
    }
    case 'DAMAGE': {
      var el = e.target.kind === 'lord' ? lordEl(e.target.side)
             : unitEl(e.target.side, e.target.row, e.target.col);
      if (el) {
        el.classList.add('cr-hit');
        setTimeout(function () { el.classList.remove('cr-hit'); }, 300);
        floatNumber(el, '-' + e.amount, 'cr-dmg');
      }
      return 230;
    }
    case 'HEAL': {
      var he = e.target.kind === 'lord' ? lordEl(e.target.side)
             : unitEl(e.target.side, e.target.row, e.target.col);
      if (he) floatNumber(he, '+' + e.amount, 'cr-heal');
      return 200;
    }
    case 'ARMOR_GAINED': {
      var le = lordEl(e.side);
      if (le) floatNumber(le, '◈+' + e.amount, 'cr-armor');
      return 200;
    }
    case 'STATUS_APPLIED': {
      var se = unitEl(e.side, e.row, e.col);
      if (se) floatNumber(se, e.status, 'cr-status');
      return 180;
    }
    case 'UNIT_DIED': {
      var de = unitEl(e.side, e.row, e.col);
      if (de) { CR.die(de, null); return 400; }
      return 0;
    }
    case 'TURN_START': {
      banner('第 ' + e.turn + ' 回合', e.side === 'own' ? '我方' : '敌方');
      return 320;
    }
    case 'FATIGUE': {
      var fe = lordEl(e.side);
      if (fe) floatNumber(fe, '粮尽 -' + e.amount, 'cr-dmg');
      return 260;
    }
    default:
      return 0;
  }
}

function floatNumber(el, text, cls) {
  var n = document.createElement('div');
  n.className = cls;
  n.textContent = text;
  n.style.left = '50%';
  n.style.top = '14%';
  el.style.position = 'relative';
  el.appendChild(n);
  setTimeout(function () { n.remove(); }, 760);
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

function runAiTurn() {
  if (busy || session.state.winner || session.state.active !== 'enemy') return;
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
    if (session.state.active === 'enemy') setTimeout(runAiTurn, 320);
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
