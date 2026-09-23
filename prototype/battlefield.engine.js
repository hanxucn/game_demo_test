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
var pendingSkill = null; // 等待选择目标的主公技（旧字段，保留兼容）
/**
 * 统一的「待选目标」状态（ADR-077）：主动技 / 主公技都用它，
 * 与 `pendingPlay`（出牌，可能有两段选择）分开。
 * 形状：{ targets: [{kind,side,row,col}], resolve: (t) => void }
 */
var pendingPick = null;
/**
 * 等待「战吼 / 卡级效果」选目标的出牌（BACKLOG §3）。
 * 形状：{ cardIndex, row, col, modeIndex, plan, idx, picks: {1: t, 2: t} }
 */
var pendingPlay = null;
/** 动画播放令牌 / 队列：供 skipAnimation 打断（ADR-077） */
var animToken = 0;
var animQueue = null;
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
    // ⚠️ 不能写 `c.attack || 0`：那会把"这张卡没有攻血"（战法/事件）变成 0/0，
    //    于是渲染层分不清"0 攻的谋臣"和"根本没有攻血的计策卡"（ADR-077）。
    //    衍生物（黄巾兵等）的攻血也靠这个判断才会画出来。
    atk: c.attack != null ? c.attack : null,
    hp: c.health != null ? c.health : null,
    kw: c.keywords || [],
    // skills / keywords 必须带上：详情面板靠它们显示技能全文与关键词释义，
    // 原先这里丢了 skills，于是「点手牌看详情」永远没有技能那一段。
    skills: c.skills, keywords: c.keywords,
    memo: c.memo, troopKind: c.troopKind, art: c.art,
  };
}

/* ============================================================
   对局生命周期
   ============================================================ */

/** 页面初始化：恢复上次选的速度档 */
function bootSpeed() { loadSpeed(); renderSpeedCtl(); }

function newGame() {
  // 开局流程（阵营 → 构筑 → 换牌）；规则全部由 Core 判定
  Setup.open({
    data: data,
    onStart: function (cfg) {
      session = {
        state: cfg.baseState,
        // 用 setup 按所选阵营算出的 cards/lords；全局 data 里的主公是占位（写死刘备/曹操）
        ctx: { cards: cfg.cards || data.cards, lords: cfg.lords || data.lords },
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

/**
 * 「本回合可行动数」实时计数（ADR-078）
 *
 * 卡与卡之间只差 4px，光靠边框颜色仍要一张张扫；给一个总数最省事。
 * 非自己回合时 attackedThisTurn 是上一轮的残留值，显示计数会误导 —— 改为提示等待。
 */
function renderReadyCount(st) {
  var el = document.getElementById('ready-count');
  if (!el) {
    var hud = $('#hud');
    if (!hud) return;
    el = document.createElement('div');
    el.id = 'ready-count';
    hud.appendChild(el);
  }
  var mine = Core.allUnits(st, 'own');
  if (st.active !== 'own' || st.winner) {
    el.className = 'is-wait';
    el.innerHTML = '⏳ 对手回合 —— 我的单位暂不可行动';
    return;
  }
  var ready = mine.filter(function (r) { return Core.canAttack(st, 'own', r.row, r.col).ok; }).length;
  var skills = mine.filter(function (r) {
    return !Core.canAttack(st, 'own', r.row, r.col).ok
      && Core.canUseUnitSkill(st, 'own', r.row, r.col).ok;
  }).length;
  el.className = ready ? 'is-ok' : 'is-none';
  el.innerHTML = '⚔ 可攻击 <b>' + ready + '</b> / ' + mine.length
    + (skills ? '　⚙ 仅技可用 ' + skills : '')
    + (ready ? '' : '　（都动过了）');
}

function renderAll() {
  var st = session.state;
  bindBoardClick();
  if (drawnThisAction) highlightNewHandCard();
  renderLords(st);
  renderPanel(st);
  renderBoard(st);
  renderLanes(st);
  renderHand(st);
  renderReadyCount(st);
  reportSizes();
}

function renderLords(st) {
  ['enemy', 'own'].forEach(function (side) {
    var l = st.sides[side].lord;
    var bar = document.getElementById('lord-' + side);
    // 主公技消耗从 skillDef.cost 读（ADR-049：三主公统一 2 费）——
    // 原先这里写死 1，界面上显示的「1」也是硬编码，与实际的 2 费对不上。
    var skillCost = (l.skillDef && l.skillDef.cost != null) ? l.skillDef.cost : 2;
    var canUse = side === 'own' && st.active === 'own' && !l.skillUsedThisTurn
              && st.sides.own.command.cur >= skillCost;
    bar.className = 'lord-bar ' + side;
    bar.innerHTML =
      '<span class="lb-portrait f-' + (l.faction || 'neutral') + '">' + (l.name || '').charAt(0) + '</span>' +
      '<span class="lb-name">' + l.name + '</span>' +
      '<span class="lb-hp">♥' + l.hp + '</span>' +
      (l.armor ? '<span class="lb-armor">◈' + l.armor + '</span>' : '') +
      (l.skill
        ? '<span class="lb-skill' + (canUse ? '' : ' is-disabled') + '" title="主公技：' + l.skill +
          '　' + skillTextOf(l.skillDef) + '（消耗 ' + skillCost + ' 统率 / 每回合 1 次）">'
          + l.skill + '<i>' + skillCost + '</i></span>'
        : '');

    var skillEl = bar.querySelector('.lb-skill');
    if (skillEl) {
      skillEl.addEventListener('click', function (e) {
        e.stopPropagation();
        onLordSkillClick(side);
      });
      // 悬停即看主公技全文（ADR-077：设计者反馈"看不到描述，不知道曹操是干什么的"）
      skillEl.addEventListener('pointerenter', function () {
        if (busy || drag) return;
        showDetail('主公技　' + l.name + ' 〈' + l.skill + '〉', skillTextOf(l.skillDef),
          '消耗 ' + skillCost + ' 统率 / 每回合 1 次' + (side === 'own' ? '　·　点击使用' : '　·　敌方主公技'));
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
  // 敌方手牌：右侧面板里排一排，同时在战场上以卡背正面呈现（对称于我方手牌）
  var backs = '';
  for (var k = 0; k < f.hand.length; k++) backs += '<i></i>';
  $('#foe-hand-backs').innerHTML = backs;

  var vis = '';
  for (var v = 0; v < f.hand.length; v++) {
    vis += '<i class="pback" style="animation-delay:' + (v * 26) + 'ms"></i>';
  }
  $('#foe-hand-visual').innerHTML = vis;
  $('#foe-deck-visual-num').textContent = f.deck.length;
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
          // 「本回合能不能动」要在卡上直接看得出来（ADR-078）：
          // 只有**当前行动方**的单位才标绿/置灰 —— 非行动方的 attackedThisTurn 是上一轮
          // 残留值，标出来反而是错的。
          var actState = null;
          if (side === st.active && !st.winner) {
            actState = Core.canAttack(st, side, row, col);
            // 三种状态：能动 / 不能攻击但技可用 / 完全不能动（ADR-078）。
            // 中间态很重要：谋臣往往"入场当回合不能攻击、但主动技立刻能用"，
            // 整卡压暗会让人以为它这回合什么都干不了。
            var canSkill = Core.canUseUnitSkill(st, side, row, col).ok;
            wrap.classList.add(actState.ok ? 'is-ready' : (canSkill ? 'is-skillready' : 'is-spent'));
            wrap.dataset.actWhy = actState.ok ? ''
              : (canSkill ? '本回合不能攻击，但可以使用主动技' : (actState.reason || '不可行动'));
          }
          if (side === 'own') {
            wrap.addEventListener('pointerdown', function (e) {
              if (e.target.closest('.cr-skillbtn')) return;   // 「技」按钮不拖拽
              if (drag) return;
              startUnitDrag(e, row, col, wrap);
            });
          }
          // 悬停即看技能全文：战场卡只有 42×59，读技能只能靠详情面板
          wrap.addEventListener('pointerenter', function () {
            if (busy || drag) return;
            showCardDetail(u);
            // 不能行动时，把**原因**一起说清楚（入场当回合 / 已攻击过 / 被震慑…）
            if (actState && !actState.ok) {
              var canSk = Core.canUseUnitSkill(st, side, row, col).ok;
              var d = document.createElement('div');
              d.className = 'why act-why';
              d.textContent = canSk
                ? '⚙ 本回合不能攻击（' + (actState.reason || '') + '），但「技」可用'
                : '⛔ 本回合不能行动：' + (actState.reason || '');
              $('#detail').appendChild(d);
            } else if (actState && actState.ok) {
              var d2 = document.createElement('div');
              d2.className = 'why act-why is-ok';
              d2.textContent = '⚔ 本回合可以攻击（点选或拖到目标）';
              $('#detail').appendChild(d2);
            }
          });
          wrap.addEventListener('click', function (e) {
            e.stopPropagation();
            // 点选已在 onDragEnd 里处理（见那里的注释）——这里只作兜底，避免重复。
            // ⚠️ 让路判定必须**认元素**：原先只看时间戳，于是"点自己人选中 → 立刻点敌人"
            //    会被这条兜底吞掉（实测三个攻击路径全部打不出去）。ADR-076 修。
            if (tapHandledEl === wrap && Date.now() - tapHandledAt < 400) return;
            onUnitClick(side, row, col, e);
          });
          slot.appendChild(wrap);
        } else {
          slot.classList.add('empty');
          slot.addEventListener('click', function (e) {
            e.stopPropagation();
            onSlotClick(e);
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
/* ---------- 攻击目标命中缓存（ADR-076）----------
   原先每次 pointermove / pointerup 都要跑一遍
   `document.elementFromPoint` + 向上遍历 DOM 找 `.unit-wrap` + 全文档
   `querySelectorAll` 抹 class。战场卡只有 42×59、格间距 4px，指针偏几个像素
   就落进"缝隙"，于是表现为「选不到敌人和主公」「点自己人经常失败」。
   现在：选中时把合法目标的位置**算一次**缓存下来，之后只做坐标比较，
   并给每个目标一个吸附半径 —— 落点靠近谁就命中谁。 */
var hitTargets = [];   // [{kind,side,row,col,left,top,right,bottom,cx,cy}]
var hitPad = 18;       // 吸附半径（屏幕像素）

/**
 * 同一目标上连续挨打时**合并成一个累加飘字**（ADR-077）
 *
 * 设计者反馈「谋略/计策造成的群体伤害飘的数值还是快，有时候会漏看到」。
 * 群体技（如五雷轰顶 5 连击）会在同一目标上连续打出好几个 -1，
 * 分开播就是一片数字乱飞。这里把 1.2 秒内的同类伤害累加成一个 "-3 ×3"，
 * 既看得清总数、也还知道被打了几下。
 */
var dmgAcc = new WeakMap();   // el -> { node, n, hits, cls, src, t }
function floatDamage(el, amount, cls, source, life) {
  if (!el) return;
  var now = Date.now();
  var a = dmgAcc.get(el);
  if (a && a.cls === cls && now - a.t < 1200 && a.node.isConnected) {
    a.n += amount; a.hits += 1; a.t = now;
    a.node.innerHTML = '-' + a.n
      + '<span class="cr-src">' + (a.src || source || '') + (a.hits > 1 ? ' ×' + a.hits : '') + '</span>';
    a.node.classList.toggle('is-big', a.n >= 4);
    a.node.style.setProperty('--float-life', life + 'ms');
    a.node.style.animation = 'none';
    void a.node.offsetWidth;          // 强制重排以重启动画
    a.node.style.animation = '';
    return;
  }
  CR.float(el, '-' + amount, cls + (amount >= 4 ? ' is-big' : ''), source, life);
  var node = el.querySelector('.cr-float:last-of-type');
  if (node) dmgAcc.set(el, { node: node, n: amount, hits: 1, cls: cls, src: source, t: now });
}

function rectOf(el, t) {
  var r = el.getBoundingClientRect();
  return {
    kind: t.kind, side: t.side, row: t.row, col: t.col,
    left: r.left, top: r.top, right: r.right, bottom: r.bottom,
    cx: r.left + r.width / 2, cy: r.top + r.height / 2,
  };
}

/** 离 (x,y) 最近的合法目标；超出吸附半径则返回 null */
function nearestHit(x, y) {
  var best = null, bestD = Infinity;
  hitTargets.forEach(function (t) {
    // 点到矩形的距离：落在矩形内为 0
    var dx = Math.max(t.left - x, 0, x - t.right);
    var dy = Math.max(t.top - y, 0, y - t.bottom);
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < bestD) { bestD = d; best = t; }
  });
  return (best && bestD <= hitPad) ? best : null;
}

/** 精确命中（点到哪张卡就是哪张，不吸附）—— 点击路径用 */
function exactHit(side, row, col) {
  for (var i = 0; i < hitTargets.length; i++) {
    var t = hitTargets[i];
    if (t.side === side && t.kind === 'unit' && t.row === row && t.col === col) return t;
    if (t.side === side && t.kind === 'lord' && row === undefined) return t;
  }
  return null;
}

/** 给战场背景挂一次吸附处理器（DOM 稳定，只挂一次） */
function bindBoardClick() {
  var boards = $('#boards');
  if (!boards || boards.dataset.snapBound) return;
  boards.dataset.snapBound = '1';
  boards.addEventListener('click', function (e) { onBoardClick(e); });
}

function renderLanes(st) {
  $all('.unit-wrap.is-target').forEach(function (el) { el.classList.remove('is-target'); });
  $('#lord-enemy').classList.remove('is-target');
  hitTargets = [];
  // 正在选技能目标时，高亮与命中缓存归它管，别被普攻目标覆盖（ADR-077）
  if (pendingPick) { highlightPickTargets(); return; }
  if (!sel) return;
  var res = Core.legalTargets(st, 'own', sel.row, sel.col);
  res.targets.forEach(function (t) {
    var el = t.kind === 'lord' ? $('#lord-enemy')
      : (function () {
          var slot = document.querySelector('.row[data-side="' + t.side + '"][data-row="' + t.row + '"] .slot[data-col="' + t.col + '"]');
          return slot && slot.querySelector('.unit-wrap');
        })();
    if (!el) return;
    el.classList.add('is-target');
    hitTargets.push(rectOf(el, t));
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
    wrap.appendChild(CR.big(viewCard(c), { desc: true }));   // desc: 卡面显示技能名+文案
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

    // 悬停 → 贴卡弹出技能详情（卡面太小放不下全文，详情面板又在右下角太远）
    wrap.addEventListener('pointerenter', function () {
      if (busy || drag) return;
      showCardTip(viewCard(c), wrap);
    });
    wrap.addEventListener('pointerleave', hideCardTip);

    // 两类卡都能"抓起来打出去"：
    //   人物卡 → 拖到绿色格子
    //   战法/事件卡 → 拖到战场任意处松手即释放（原先只能点击，设计师要求改成打出去）
    wrap.addEventListener('pointerdown', function (e) {
      hideCardTip();
      startDrag(e, i, c, wrap);
    });

    wrap.addEventListener('click', function (e) {
      e.stopPropagation();
      if (st.winner || st.active !== 'own') return;
      if (busy) skipAnimation();                          // ADR-077
      if (Date.now() - dragHandledAt < 300) return;      // 拖拽已在 pointerup 处理
      if (onHandPick(i)) return;
      if (isCharacter(c)) { showCardDetail(c); return; }  // 人物卡点击 = 看详情
      if (!playable) { showCardDetail(c); return; }       // 打不出 → 看详情
      beginPlay(i);                                        // 非人物卡：点击仍可释放（保留）
    });
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
/** 卡牌详情 HTML（详情面板与悬浮弹窗共用同一份内容） */
function cardDetailHTML(c) {
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
        : sk.kind === 'aura' ? '光环技' : '触发技')
        + (sk.trigger ? '·' + (TRIGGER_NAME[sk.trigger] || sk.trigger) : '') + '</span>' : '')
      + '<div class="why">' + (sk.text || '（无文案）') + '</div></div>');
  });
  if (c.memo) rows.push('<div class="sub" style="margin-top:6px">记忆点：' + c.memo + '</div>');
  return rows.join('');
}

function showCardDetail(c) {
  var el = $('#detail');
  el.innerHTML = cardDetailHTML(c);
  el.classList.add('show');
}

/* ---------- 悬浮技能弹窗 ----------
   手牌只有 56×78、战场卡 42×59，全文塞不进卡面；
   详情面板又在右下角、离卡很远。设计师要求"Hover 弹出技能详情"，
   所以做一个贴着卡出现的气泡，内容与详情面板同源。 */
var tipEl = null;

function ensureTip() {
  if (tipEl) return tipEl;
  tipEl = document.createElement('div');
  tipEl.id = 'card-tip';
  document.body.appendChild(tipEl);
  return tipEl;
}

function showCardTip(c, anchorEl) {
  if (!anchorEl || drag) { hideCardTip(); return; }
  var el = ensureTip();
  el.innerHTML = cardDetailHTML(c);
  el.classList.add('show');

  var a = anchorEl.getBoundingClientRect();
  var w = el.offsetWidth, h = el.offsetHeight;
  // 手牌在底部 → 气泡放上方；战场单位在中间 → 优先放右侧
  var left = a.left + a.width / 2 - w / 2;
  var top = a.top - h - 10;
  if (top < 8) { top = a.bottom + 10; left = a.right + 10; }
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
  el.style.left = left + 'px';
  el.style.top = top + 'px';
}

function hideCardTip() {
  if (tipEl) tipEl.classList.remove('show');
}

var TYPE_LABEL = {
  troop: '兵种', general: '武将', strategist: '谋臣', event: '事件',
  tactic: '战法', token: '衍生物', elite: '精英', special: '特殊',
};

/* ============================================================
   拖拽出牌
   ============================================================ */

function startDrag(e, index, card, wrap) {
  if (session.state.winner || session.state.active !== 'own') return;
  if (busy) skipAnimation();          // ADR-077：拖牌时若还在播动画，先跳过
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

  var isUnit = isCharacter(card);
  drag = {
    kind: 'card',
    isUnit: isUnit,
    index: index, card: card, wrap: wrap, ghost: ghost,
    dx: e.clientX - rect.left, dy: e.clientY - rect.top,
    sx: e.clientX, sy: e.clientY,
  };

  if (isUnit) {
    Core.legalPlacements(session.state, 'own').forEach(function (s) {
      var el = document.querySelector('.slot[data-side="own"][data-row="' + s.row + '"][data-col="' + s.col + '"]');
      if (el) el.classList.add('is-placeable');
    });
    showDetail('拖到战场放置', card.name + '（' + card.cost + ' 费）', '绿色格子为可放置位置');
  } else {
    // 战法 / 事件卡没有落点：把整块战场当作投放区
    var boards = $('#boards') || document.querySelector('.arena-inner');
    if (boards) boards.classList.add('is-spell-target');
    showDetail('拖到战场释放', card.name + '（' + card.cost + ' 费）', '拉到战场任意处松手即释放');
  }

  bindDragEvents();
}

/** 攻击拖拽：抓住战场上的单位，拖到敌方人物卡或主将上（与出牌同一套手感） */
function startUnitDrag(e, row, col, wrap) {
  if (session.state.winner || session.state.active !== 'own') return;
  if (busy) skipAnimation();          // ADR-077：动画中也能直接选下一张卡
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
  ghost.style.left = '0px';
  ghost.style.top = '0px';
  // 用 transform 移动幽灵：改 left/top 每帧都会触发布局，是"拖起来卡顿"的主因之一
  ghost.style.transform = 'translate3d(' + rect.left + 'px,' + rect.top + 'px,0)';
  document.body.appendChild(ghost);
  wrap.classList.add('is-dragging');

  drag = {
    kind: 'unit',
    row: row, col: col, wrap: wrap, ghost: ghost,
    dx: e.clientX - rect.left, dy: e.clientY - rect.top,
    sx: e.clientX, sy: e.clientY,
    origin: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },  // 箭头起点，算一次
    arrowTo: null,          // 当前悬停的合法目标
    raf: 0, pending: null,
  };
  drag.arrowFrom = wrap;

  // ⚠️ 关键改动（ADR-076）：**按下就选中**。
  // 原先要等到 pointerup 且位移 < 8px 才判为"点选"，而真人点击的抖动常超过 8px →
  // 被当成拖拽、松手不在目标上就被判"取消攻击"，于是"选自己人经常失败、要慢慢点"。
  // 现在选中与位移无关，拖拽只是"选好之后顺手打出去"的加速路径。
  // ⚠️ 必须带 kind:'unit'：`onUnitClick` / `onSlotClick` 的攻击分支都靠它判断
  //    （原先这个赋值发生在 onUnitClick 里，搬到 pointerdown 时漏了 kind，
  //      结果"选中了却打不出去"——实测时三个攻击路径全部 0 命中）
  sel = { kind: 'unit', row: row, col: col };
  renderLanes(session.state);
  arrowTo(wrap, e.clientX, e.clientY, false);
  var u = session.state.sides.own.rows[row][col];
  showDetail('已选中 ' + u.name, '攻击力 ' + Core.effectiveAttack(session.state, 'own', row, col)
    + '　生命 ' + u.hp + '/' + u.maxHp,
    '点（或拖到）高亮的敌人/敌方主公发起攻击；点空白处取消');

  bindDragEvents();
}

function bindDragEvents() {
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragEnd);
  window.addEventListener('pointercancel', onDragEnd);
}

function onDragMove(e) {
  if (!drag) return;
  // rAF 节流：pointermove 在 120Hz 触控板上可以一帧来好几次，全部处理就是"卡顿"
  drag.pending = { x: e.clientX, y: e.clientY };
  if (drag.raf) return;
  drag.raf = requestAnimationFrame(function () {
    drag.raf = 0;
    var p = drag.pending;
    if (!drag || !p) return;
    drag.ghost.style.transform =
      'translate3d(' + (p.x - drag.dx) + 'px,' + (p.y - drag.dy) + 'px,0)';

    if (drag.kind === 'unit') {
      // 拖拽攻击：命中判定走缓存坐标（不再 elementFromPoint），并给吸附半径
      var t = nearestHit(p.x, p.y);
      var el = t ? hitEl(t) : null;
      if (drag.hoverEl && drag.hoverEl !== el) drag.hoverEl.classList.remove('is-hover');
      if (el) el.classList.add('is-hover');
      drag.hoverEl = el;
      arrowToCached(drag.arrowFrom, p.x, p.y, !!t);
      return;
    }

    // 出牌拖拽：保持原有落点判定
    $all('.slot.is-hover, .unit-wrap.is-hover, .lord-bar.is-hover')
      .forEach(function (x) { x.classList.remove('is-hover'); });
    var d = dropAt(p.x, p.y);
    if (!d) return;
    if (drag.kind === 'card' && drag.isUnit && d.kind === 'slot' && d.el.classList.contains('is-placeable')) {
      d.el.classList.add('is-hover');
    } else if (drag.kind === 'card' && !drag.isUnit && d.kind === 'board') {
      d.el.classList.add('is-hover');
    }
  });
}

/** 由缓存项取回 DOM 元素（悬停高亮用） */
function hitEl(t) {
  if (t.kind === 'lord') return $('#lord-enemy');
  var slot = document.querySelector('.row[data-side="' + t.side + '"][data-row="' + t.row + '"] .slot[data-col="' + t.col + '"]');
  return slot && slot.querySelector('.unit-wrap');
}

function onDragEnd(e) {
  if (!drag) return;
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragEnd);
  window.removeEventListener('pointercancel', onDragEnd);

  var t = dropAt(e.clientX, e.clientY);
  var d = drag;
  drag = null;

  // ⚠️ 落点合法性必须在 clearDropHighlights() **之前**判定 ——
  // 它会把 is-placeable / is-target 一并抹掉，之后再查 classList 永远为假。
  // 曾因此导致"费用够也放不下去"（出牌 100% 失败）。
  var dropSlot = (t && t.kind === 'slot' && t.el.classList.contains('is-placeable')) ? t.el : null;
  var dropBoard = (t && t.kind === 'board') ? t.el : null;
  var dropUnit = (t && t.kind === 'unit' && t.el.classList.contains('is-target')) ? t.el : null;
  var dropLord = (t && t.kind === 'lord' && t.el.classList.contains('is-target')) ? t.el : null;

  d.ghost.remove();
  d.wrap.classList.remove('is-dragging');
  arrowHide();
  clearDropHighlights();

  if (d.kind === 'card') {
    if (d.isUnit && dropSlot) {
      dragHandledAt = Date.now();
      clearMarks();
      // 战吼可能需要玩家选目标 → 交给 Core.playTargetPlan 判定（BACKLOG §3）
      beginPlay(d.index, dropSlot.dataset.row, Number(dropSlot.dataset.col));
    } else if (!d.isUnit && dropBoard) {
      // 战法 / 事件卡：落到战场即释放（没有 row/col）
      dragHandledAt = Date.now();
      clearMarks();
      beginPlay(d.index);
    } else {
      clearMarks();
      showDetail('取消打出', d.card.name,
        d.isUnit ? '拖到绿色格子才能放置' : '拖到战场区域松手才能释放');
    }
    return;
  }

  // 攻击拖拽：合法性一律由 Core.legalTargets 判定（缓存里就是它算出来的）
  if (d.kind === 'unit') {
    if (d.raf) { cancelAnimationFrame(d.raf); d.raf = 0; }
    if (d.hoverEl) { d.hoverEl.classList.remove('is-hover'); d.hoverEl = null; }
    var hit = nearestHit(e.clientX, e.clientY);
    if (hit && pendingPick) { tapHandledAt = Date.now(); tapHandledEl = d.wrap; finishPick(hit); return; }
    if (hit) {
      tapHandledAt = Date.now(); tapHandledEl = d.wrap;
      doAction(hit.kind === 'lord'
        ? { type: 'ATTACK', from: { row: d.row, col: d.col }, to: { kind: 'lord' } }
        : { type: 'ATTACK', from: { row: d.row, col: d.col },
            to: { kind: 'unit', row: hit.row, col: hit.col } });
    } else {
      // ⚠️ ADR-076：松手没落在目标上**不再取消选中**。
      // 原先这里 clearMarks() + sel = null，等于"手抖一下就得重新点一次"，
      // 是"选自己卡牌攻击经常失败"的第二大来源。选中已经在 pointerdown 时完成，
      // 这里只提示"还没打出去"，玩家可以接着点目标；要取消就点空白处。
      tapHandledAt = Date.now(); tapHandledEl = d.wrap;
      var u2 = session.state.sides.own.rows[d.row][d.col];
      showDetail('已选中 ' + (u2 ? u2.name : ''),
        '还没选择攻击目标',
        '点（或拖到）高亮的敌人/敌方主公发起攻击；点空白处取消');
    }
    return;
  }
}

/* ---------- 指向箭头（ADR-065）----------
   抓住单位准备攻击时，从攻击者画一条弧线指向光标；落在合法目标上变绿。
   用视口坐标（指针事件给的就是视口坐标），所以 SVG 层是 position:fixed。 */
var arrowShown = false;
var tapHandledAt = 0;
/** 上一次被 pointerup 处理掉的单位元素 —— 点击兜底只对**它自己**让路（ADR-076） */
var tapHandledEl = null;
var dragHandledAt = 0;   // 上一次拖拽已处理的时间戳（避免随后的 click 重复触发）   // 上一次「点选」被 onDragEnd 处理的时间戳

function arrowEl() { return document.getElementById('arrow-layer'); }
function arrowPathEl() { return document.getElementById('arrow-path'); }

/** 箭头起点 = 单位卡中心 */
function arrowOrigin(el) {
  var r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** 箭头（起点已缓存版）：拖拽过程中每帧调用，避免重复 getBoundingClientRect */
function arrowToCached(fromEl, x, y, ok) {
  var layer = arrowEl(), path = arrowPathEl();
  if (!layer || !path || !fromEl || !drag || !drag.origin) { arrowTo(fromEl, x, y, ok); return; }
  var o = drag.origin;
  var mx = (o.x + x) / 2;
  var my = Math.min(o.y, y) - Math.abs(x - o.x) * 0.18 - 14;
  path.setAttribute('d', 'M' + o.x + ',' + o.y + ' Q' + mx + ',' + my + ' ' + x + ',' + y);
  path.setAttribute('marker-end', ok ? 'url(#arrow-head-ok)' : 'url(#arrow-head)');
  layer.classList.toggle('is-valid', !!ok);
  layer.classList.add('show');
  arrowShown = true;
}

/** 显示/更新箭头；ok=true 时变绿（命中合法目标） */
function arrowTo(fromEl, x, y, ok) {
  var layer = arrowEl(), path = arrowPathEl();
  if (!layer || !path || !fromEl) return;
  var o = arrowOrigin(fromEl);
  // 轻微上拱的二次曲线，比直线更接近炉石的"指向感"
  var mx = (o.x + x) / 2;
  var my = Math.min(o.y, y) - Math.abs(x - o.x) * 0.18 - 14;
  path.setAttribute('d', 'M' + o.x + ',' + o.y + ' Q' + mx + ',' + my + ' ' + x + ',' + y);
  path.setAttribute('marker-end', ok ? 'url(#arrow-head-ok)' : 'url(#arrow-head)');
  layer.classList.toggle('is-valid', !!ok);
  layer.classList.add('show');
  arrowShown = true;
}

function arrowHide() {
  if (!arrowShown) return;
  var layer = arrowEl();
  if (layer) layer.classList.remove('show', 'is-valid');
  arrowShown = false;
}

/** 光标下是不是一个"合法"落点（用于决定箭头颜色） */
function dropIsValid(x, y) {
  var t = dropAt(x, y);
  if (!t) return false;
  if (drag && drag.kind === 'unit') {
    return (t.kind === 'unit' || t.kind === 'lord') && t.el.classList.contains('is-target');
  }
  if (drag && drag.kind === 'card') {
    return t.kind === 'slot' && t.el.classList.contains('is-placeable');
  }
  if (sel && sel.kind === 'unit') {
    return (t.kind === 'unit' || t.kind === 'lord') && t.el.classList.contains('is-target');
  }
  return false;
}

/**
 * 清除拖拽留下的高亮。
 * ⚠️ 调用它会抹掉 is-placeable / is-target —— 任何"这个落点合法吗"的判断
 * 都必须排在它前面（见 onDragEnd）。这个先后顺序曾经弄反过，代价是出牌完全失效。
 */
function clearDropHighlights() {
  $all('.slot.is-placeable, .slot.is-hover, .unit-wrap.is-hover, .lord-bar.is-hover, .is-spell-target')
    .forEach(function (el) { el.classList.remove('is-placeable', 'is-hover', 'is-spell-target'); });
}

/** 落点解析：战场单位 / 主将条 / 格子（拖拽幽灵设了 pointer-events:none，不会拦截） */
function dropAt(x, y) {
  var el = document.elementFromPoint(x, y);
  var board = null;
  for (var n = el; n; n = n.parentElement) {
    if (!n.classList) continue;
    if (n.classList.contains('unit-wrap')) return { kind: 'unit', el: n };
    if (n.classList.contains('lord-bar')) return { kind: 'lord', el: n };
    if (n.classList.contains('slot')) return { kind: 'slot', el: n };
    // 战场区（法术卡的投放区）——要等走完整条链再决定，
    // 否则会盖住上面的 unit/lord/slot 判定
    if (!board && (n.id === 'boards' || n.classList.contains('arena-inner'))) board = n;
  }
  return board ? { kind: 'board', el: board } : null;
}

/* ============================================================
   选中 / 攻击
   ============================================================ */

function clearMarks() {
  $all('.unit-wrap.is-selected, .unit-wrap.is-target, .slot.is-placeable, .slot.is-hover, .lord-bar.is-target')
    .forEach(function (el) {
      el.classList.remove('is-selected', 'is-target', 'is-placeable', 'is-hover');
    });
  hitTargets = [];
  $('#detail').classList.remove('show');
  if (session) renderLanes(session.state);
}

/* ============================================================
   出牌前的选目标（BACKLOG §3）
   ------------------------------------------------------------
   要不要选、有几个选择、可选谁 —— **全部由 Core.playTargetPlan 判定**，
   这里只负责把结果画出来、把点击收回来。UI 不做任何规则判断。
   ============================================================ */

/** 落点是不是当前这一步想要的合法目标 */
function playChoiceHit(choice, side, row, col) {
  if (!choice) return false;
  return choice.targets.some(function (t) {
    if (t.side !== side) return false;
    if (t.kind === 'lord') return row === undefined || row === null;
    return t.row === row && t.col === col;
  });
}

function highlightPlayChoice() {
  var pp = pendingPlay;
  if (!pp) return;
  var choice = pp.plan.choices[pp.idx];
  if (!choice) return;
  clearMarks();
  choice.targets.forEach(function (t) {
    if (t.kind === 'lord') {
      var le = lordEl(t.side);
      if (le) le.classList.add('is-target');
      return;
    }
    var el = document.querySelector('.slot[data-side="' + t.side + '"][data-row="' + t.row +
      '"][data-col="' + t.col + '"] .unit-wrap');
    if (el) el.classList.add('is-target');
  });
  var hc = session.state.sides.own.hand[pp.cardIndex];
  var name = hc ? hc.card.name : '这张牌';
  var total = pp.plan.choices.length;
  var step = total > 1 ? '（第 ' + (pp.idx + 1) + '/' + total + ' 个选择）' : '';
  var extra = choice.includesHand ? '　—— 也可以不选，交给引擎从手牌里取' : '';
  if (!choice.targets.length) {
    // 没有场上目标（如陆抗只剩手牌路径）→ 直接打出，由引擎兜底
    finishPlay();
    return;
  }
  // ADR-077：出牌时要把**本卡的技能全文**摆在眼前 —— 设计者反馈
  // "出牌时候不知道具体技能描述"，而卡面只有 56×78 放不下文案。
  showDetail('选择目标' + step, name + '：请选择' + choice.label,
    '技能：' + cardSkillText(hc ? hc.card : null) + '　·　点高亮的' + choice.label
    + '（空白处或 Esc 取消）' + extra);
}

/** 把一张卡的技能文案拼成一段（出牌提示 / 详情里用） */
function cardSkillText(card) {
  if (!card) return '';
  var list = (card.skills || []).map(function (sk) {
    var nm = sk.name ? '〈' + sk.name + '〉' : '';
    return nm + (sk.text || '');
  }).filter(Boolean);
  if (list.length) return list.join('；');
  if (card.memo) return card.memo;
  return '（无技能）';
}

/** 进入待选状态；需要时可以带一个「先选分支」的结果 */
function beginPlay(cardIndex, row, col, modeIndex) {
  var hc = session.state.sides.own.hand[cardIndex];
  if (!hc) return;
  var plan = Core.playTargetPlan(session.state, 'own', hc.card, modeIndex);

  // 抉择：先让玩家点一个分支（见 showModePicker）
  if (plan.modes.length > 1 && modeIndex === undefined) {
    showModePicker(hc.card, plan.modes, function (mi) { beginPlay(cardIndex, row, col, mi); });
    return;
  }

  var choices = plan.choices.filter(function (c) { return c.targets.length; });
  if (!choices.length) {
    // 不需要选（或只剩手牌路径）→ 直接打出
    doAction({ type: 'PLAY_CARD', cardIndex: cardIndex, row: row, col: col, modeIndex: modeIndex });
    return;
  }
  pendingPlay = {
    cardIndex: cardIndex, row: row, col: col, modeIndex: modeIndex,
    plan: plan, idx: 0, picks: {},
  };
  // 让 idx 指向第一个真的有目标的 choice
  while (pendingPlay.idx < plan.choices.length && !plan.choices[pendingPlay.idx].targets.length) {
    pendingPlay.idx++;
  }
  highlightPlayChoice();
  startPlayArrow();
}

/** 收集到本次选择后，推进到下一个；都齐了就出牌 */
function recordPlayPick(side, row, col) {
  var pp = pendingPlay;
  if (!pp) return false;
  var choice = pp.plan.choices[pp.idx];
  if (!choice || !playChoiceHit(choice, side, row, col)) return false;
  pp.picks[choice.pick] = { side: side, row: row, col: col };
  pp.idx++;
  while (pp.idx < pp.plan.choices.length && !pp.plan.choices[pp.idx].targets.length) pp.idx++;
  if (pp.idx >= pp.plan.choices.length) { finishPlay(); return true; }
  highlightPlayChoice();
  return true;
}

function finishPlay() {
  var pp = pendingPlay;
  pendingPlay = null;
  stopPlayArrow();
  if (!pp) return;
  var action = { type: 'PLAY_CARD', cardIndex: pp.cardIndex, row: pp.row, col: pp.col };
  if (pp.modeIndex !== undefined) action.modeIndex = pp.modeIndex;
  if (pp.picks[1]) action.target = pp.picks[1];
  if (pp.picks[2]) action.target2 = pp.picks[2];
  doAction(action);
}

function cancelPlay() {
  pendingPlay = null;
  stopPlayArrow();
  clearMarks();
}

/* ---------- 待选期间的指向箭头（与攻击同一手感）---------- */
function onPlayPointerMove(e) {
  if (!pendingPlay) return;
  var hc = document.querySelector('.hcard-wrap[data-card-index="' + pendingPlay.cardIndex + '"]');
  if (!hc) return;
  var t = dropAt(e.clientX, e.clientY);
  var ok = false;
  var choice = pendingPlay.plan.choices[pendingPlay.idx];
  if (t && choice) {
    if (t.kind === 'unit') {
      ok = playChoiceHit(choice, t.el.parentElement.dataset.side,
        t.el.parentElement.dataset.row, Number(t.el.parentElement.dataset.col));
    } else if (t.kind === 'lord') {
      // 主公条没有 dataset.side，id 是 lord-<side>
      ok = playChoiceHit(choice, String(t.el.id || '').replace('lord-', ''), undefined, undefined);
    }
  }
  arrowTo(hc, e.clientX, e.clientY, ok);
}
function startPlayArrow() { window.addEventListener('pointermove', onPlayPointerMove); }
function stopPlayArrow() { window.removeEventListener('pointermove', onPlayPointerMove); arrowHide(); }

/* ---------- 抉择分支选择器（曹彰「猛袭」）---------- */
function showModePicker(card, modes, onPick) {
  var old = document.getElementById('play-modes');
  if (old) old.remove();
  // 必须是 <body> 直属节点：放进 #canvas 会被 transform: scale() 二次缩放（踩过的坑）
  var box = document.createElement('div');
  box.id = 'play-modes';
  box.innerHTML = '<h4>' + card.name + '：选择一项</h4>';
  modes.forEach(function (name, i) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = name;
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      box.remove();
      onPick(i);
    });
    box.appendChild(btn);
  });
  var cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'is-cancel';
  cancel.textContent = '取消';
  cancel.addEventListener('click', function (e) { e.stopPropagation(); box.remove(); });
  box.appendChild(cancel);
  document.body.appendChild(box);
  showDetail('选择技能分支', card.name, '点上面的按钮选择①或②');
}

function showDetail(title, sub, why) {
  var d = $('#detail');
  d.innerHTML = '<h4>' + title + '</h4>' +
    (sub ? '<div class="sub">' + sub + '</div>' : '') +
    (why ? '<div class="why">' + why + '</div>' : '');
  d.classList.add('show');
}

/**
 * 已选中单位时，把一次"落在空白处"的点击**吸附**到最近的合法目标上（ADR-076）。
 * @returns true = 已经打出去了（调用方不要再做取消选中的动作）
 */
function trySnapAttack(ev) {
  if (!sel || sel.kind !== 'unit' || !ev) return false;
  var hit = nearestHit(ev.clientX, ev.clientY);
  if (!hit) return false;
  doAction(hit.kind === 'lord'
    ? { type: 'ATTACK', from: { row: sel.row, col: sel.col }, to: { kind: 'lord' } }
    : { type: 'ATTACK', from: { row: sel.row, col: sel.col },
        to: { kind: 'unit', row: hit.row, col: hit.col } });
  return true;
}

function onSlotClick(ev) {
  if (busy) skipAnimation();
  if (busy) return;                    // 极端情况：跳过失败就不处理
  if (pendingPick) {
    var pt = ev && nearestHit(ev.clientX, ev.clientY);
    if (pt) { finishPick(pt); return; }
    cancelPick();
    return;
  }
  if (pendingPlay) { cancelPlay(); return; }   // 点空白 = 放弃这次出牌
  // 空格子 / 卡与卡之间的缝隙：只要**靠近**合法目标就打过去。
  // 这是"点不到敌人"最直接的兜底 —— 格间距只有 4px，真人很难精准点中卡面。
  if (trySnapAttack(ev)) return;
  clearMarks();
  sel = null;
  pendingSkill = null;
}

/**
 * 战场背景（含卡与卡之间的缝隙、行间空白）的兜底（ADR-076）。
 *
 * 原先只有**空格子**绑了 click，`.boards` 这层背景没有任何处理器 ——
 * 于是"点两敌人卡中间那道缝"什么都不会发生，玩家只觉得"点不到人"。
 * 这里同样先试吸附；没吸附到也不清选中（背景点击太容易误触，不该当成取消）。
 */
function onBoardClick(ev) {
  if (busy) skipAnimation();
  if (pendingPlay) return;
  trySnapAttack(ev);
}

/** 谋臣主动技：点卡上的「技」按钮。合法性由 Core.canUseUnitSkill 判定 */
function onUnitSkillClick(row, col, skill) {
  if (session.state.winner) return;
  if (busy) skipAnimation();
  var st = session.state;
  if (st.active !== 'own') { showDetail('主动技', skill.name, '现在不是你的回合'); return; }
  if (!skill.usable) { showDetail('主动技', skill.name, skill.why || '本回合不可用'); return; }

  var u = st.sides.own.rows[row][col];
  var def = (u.skills || []).filter(function (x) { return x.kind === 'active'; })[0];
  // ⚠️ 目标集一律由 core 给（ADR-077）：原先这里自己按 selector.side 枚举"该方所有单位"，
  //    **完全忽略 filter** —— 貂蝉（只认男性）、陆抗（排除自己）这类技能会高亮一堆非法目标，
  //    点了之后引擎又退回兜底目标，表现为"指向性技能的选择逻辑有问题，有些又没问题"。
  var plan = Core.unitSkillTargetPlan(st, 'own', row, col);
  var choice = plan.choices[0];
  if (choice) {
    if (!choice.targets.length) {
      showDetail('主动技', def.name, '没有合法目标' + (choice.includesHand ? '（可选目标在手里）' : ''));
      return;
    }
    beginTargetPick(choice.targets, function (t) {
      doAction({ type: 'USE_SKILL', row: row, col: col, target: { side: t.side, row: t.row, col: t.col } });
    }, {
      title: '选择目标',
      sub: def.name,
      why: '点击高亮的' + choice.label + '　·　' + skillTextOf(def),
    });
    return;
  }
  doAction({ type: 'USE_SKILL', row: row, col: col });
}

/** 取一段技能的可读文案（详情面板里用；没有 text 就退回"动作列表"） */
function skillTextOf(sk) {
  if (!sk) return '';
  if (sk.text) return sk.text;
  var effs = sk.effects || [];
  return effs.map(function (e) { return e.action; }).join(' / ');
}

/**
 * 统一的「选目标」入口（ADR-077）
 *
 * 卡牌战吼（pendingPlay）、主动技、主公技此前各写一套：
 * 前两者各自枚举目标、后者按 side 猜，选中判定也各不相同。
 * 现在都走这里 —— 目标集由 core 给，命中判定与拖拽攻击共用 `hitTargets` + 吸附半径。
 */
function beginTargetPick(targets, resolve, labels) {
  pendingPick = {
    targets: targets.map(function (t) { return { kind: t.kind || 'unit', side: t.side, row: t.row, col: t.col }; }),
    resolve: resolve,
  };
  sel = null;                      // 选技能目标时不再高亮普攻目标，避免两套高亮打架
  renderLanes(session.state);
  highlightPickTargets();
  showDetail(labels.title || '选择目标', labels.sub || '',
    (labels.why || '') + (pendingPick.targets.length ? '　（点空白处或按 Esc 取消）' : ''));
}

function highlightPickTargets() {
  if (!pendingPick) return;
  hitTargets = [];
  pendingPick.targets.forEach(function (t) {
    var el = t.kind === 'lord' ? lordEl(t.side)
      : (function () {
          var slot = document.querySelector('.row[data-side="' + t.side + '"][data-row="' + t.row + '"] .slot[data-col="' + t.col + '"]');
          return slot && slot.querySelector('.unit-wrap');
        })();
    if (!el) return;
    el.classList.add('is-target');
    hitTargets.push(rectOf(el, t));
  });
}

function cancelPick() {
  pendingPick = null;
  hitTargets = [];
  arrowHide();
  clearMarks();
  showDetail('已取消', '', '');
}

function finishPick(t) {
  var pick = pendingPick;
  pendingPick = null;
  hitTargets = [];
  if (pick) pick.resolve(t);
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

function onUnitClick(side, row, col, ev) {
  if (session.state.winner) return;
  if (busy) skipAnimation();          // ADR-077：动画中点任何东西都先跳过动画

  // ⓪-0 技能待选目标：精确点到就打，点偏了用吸附
  if (pendingPick) {
    var pt = exactHit(side, row, col) || (ev && nearestHit(ev.clientX, ev.clientY));
    if (pt) { finishPick(pt); return; }
    return;                                   // 点到非目标：保持待选，不乱取消
  }

  // ⓪ 出牌待选目标（战吼 / 卡级效果，BACKLOG §3）—— 优先级最高
  if (pendingPlay && recordPlayPick(side, row, col)) return;

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

  // ② 已选中我方单位 + 点敌方单位 → 攻击（精确命中；不做吸附，
  //    否则玩家点了一个"打不到的敌人"却被自动改打到别人，规则上无法解释）
  if (sel && sel.kind === 'unit' && side === 'enemy') {
    if (exactHit(side, row, col)) {
      doAction({ type: 'ATTACK', from: { row: sel.row, col: sel.col },
                 to: { kind: 'unit', row: row, col: col } });
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

  // 选中即出箭头（指向点击处），不必等鼠标再动一下 ——
  // 否则"选完了却看不到箭头"，会以为功能没生效。
  if (wrap && ev && ev.clientX != null) {
    arrowTo(wrap, ev.clientX, ev.clientY, dropIsValid(ev.clientX, ev.clientY));
  }
}

function onLordClick(side, bar) {
  if (session.state.winner) return;
  if (busy) skipAnimation();
  // 技能/出牌的待选目标可能是主将
  if (pendingPick && exactHit(side, undefined, undefined)) { finishPick(exactHit(side, undefined, undefined)); return; }
  if (pendingPlay && recordPlayPick(side, undefined, undefined)) return;
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
  if (busy) skipAnimation();          // ADR-077
  if (session.state.winner) return;
  var st = session.state;
  if (side !== 'own' || st.active !== 'own') return;

  var lord = st.sides.own.lord;
  var sk = lord.skillDef;
  if (!sk) { showDetail('主公技', lord.skill, '该主公没有可用的主公技'); return; }
  var cost = sk.cost || 2;
  var desc = skillTextOf(sk);            // ADR-077：主公技文案必须能看见

  if (lord.skillUsedThisTurn) { showDetail('主公技 ' + lord.skill, desc, '本回合已使用过'); return; }
  if (st.sides.own.command.cur < cost) {
    showDetail('主公技 ' + lord.skill, desc, '统率值不足（需要 ' + cost + '）');
    return;
  }

  // 要不要选目标由 core 判定（filter 一并生效）——UI 不再自己按 side 猜
  var plan = Core.lordSkillTargetPlan(st, 'own');
  var choice = plan.choices[0];
  if (choice && choice.targets.length) {
    beginTargetPick(choice.targets, function (t) {
      doAction({ type: 'USE_LORD_SKILL', target: { side: t.side, row: t.row, col: t.col } });
    }, {
      title: '选择目标（主公技）',
      sub: lord.skill + '　消耗 ' + cost + ' 统率',
      why: '技能：' + desc + '　·　点高亮的' + choice.label,
    });
    return;
  }

  // 不需要选目标（奸雄）——坐断东南要指定弃哪张手牌
  var needsHand = (sk.effects || []).some(function (e) {
    return e.action === 'cycle_to_deck' || (e.action === 'discard' && e.mode === 'choose');
  });
  if (needsHand) {
    var hand = st.sides.own.hand;
    if (!hand.length) { showDetail('主公技 ' + lord.skill, desc, '手牌为空，无法使用'); return; }
    pendingSkill = { handPick: true, action: { type: 'USE_LORD_SKILL' } };
    $all('.hcard-wrap').forEach(function (el) { el.classList.add('is-target'); });
    showDetail('选择手牌（主公技）', lord.skill + '　消耗 ' + cost + ' 统率',
      '技能：' + desc + '　·　点一张手牌');
    return;
  }

  doAction({ type: 'USE_LORD_SKILL' });
}

function onEscape() {
  if (pendingPick) { cancelPick(); return; }
  if (busy) return;
  if (pendingPlay) { cancelPlay(); return; }
  if (pendingSkill) { pendingSkill = null; clearMarks(); showDetail('已取消', '', ''); return; }
  if (sel) { sel = null; clearMarks(); arrowHide(); showDetail('已取消选择', '', ''); }
}

function onEndTurn() {
  if (session.state.winner) return;
  if (busy) skipAnimation();
  if (session.state.active !== 'own') return;
  doAction({ type: 'END_TURN' });
}

function doAction(action) {
  if (session.state.winner) return;
  // 动画播放中又来操作 → 先跳过动画再执行（ADR-077，替代原来的"点不动"）
  if (busy) skipAnimation();
  var res = Core.applyAction(session.state, session.ctx, action);
  if (!res.ok) {
    showDetail('操作无效', res.error || '', '');
    return;
  }
  session = { state: res.state, ctx: session.ctx };
  busy = true;
  arrowHide();                 // 动作已生效 → 指向箭头随选中一起收起
  pendingPlay = null;
  stopPlayArrow();
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
    // ADR-074：技能发动单独成行并高亮 —— 做卡牌测试时"哪个技能生效了"是第一条信息
    case 'SKILL_TRIGGERED': {
      var when = SKILL_WHEN[e.timing] || SKILL_FROM[e.from] || '';
      return {
        cls: e.from === 'aura' ? 'skill aura' : 'skill',
        text: '✦ ' + (e.unitName ? '<b>' + e.unitName + '</b> ' : '')
          + (when ? '<i>' + when + '</i> ' : '') + '〈<b>' + e.skillName + '</b>〉',
      };
    }
    case 'CARD_MILLED':
      return { cls: 'mill', text: who + ' 牌库被弃掉一张（' + (e.cardId || '') + '）' };
    case 'TURN_SKIPPED':
      return { cls: 'turn', text: who + ' 的回合被跳过（' + (e.reason || '') + '）' };
    // e.turn 现在是**完整回合数**（双方都行动完才 +1，ADR-064），
    // 不再是半回合计数 —— 原先这里要 Math.ceil(e.turn / 2)，现在直接用。
    case 'TURN_START': return { cls: 'turn', text: '—— 第 ' + e.turn + ' 回合 · ' + who + '（统率 ' + e.command.cur + '/' + e.command.max + '）——' };
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

/* ============================================================
   结算节奏（ADR-074）
   ------------------------------------------------------------
   设计者反馈："有些技能看不出来发动了，伤害等数值跳动太快，看不清发生了什么"。
   两个原因：
     ① 触发技 / 光环 / 亡语原先**没有事件**，客户端无从表现（现在引擎发 SKILL_TRIGGERED）；
     ② 事件之间的间隔太短（220~340ms），一串 AOE 或五雷轰顶一闪而过。
   这里给出三档速度，并把"读得清"作为默认档。
   ============================================================ */

/** 触发时机 → 中文（SKILL_TRIGGERED 横幅上的"什么时候"） */
var SKILL_WHEN = {
  on_play: '战吼', on_death: '亡语', on_attack: '攻击时', on_damaged: '受到伤害时',
  turn_start: '回合开始', turn_end: '回合结束', on_card_played: '出牌触发',
  on_kill: '击杀时', on_lethal: '濒死时', on_draw: '抽到时释放',
  on_mark_damaged: '仇敌受伤', on_mark_death: '仇敌阵亡',
};
var SKILL_FROM = { aura: '光环', active: '主动技', lord_skill: '主公技', trigger: '触发技', card: '卡牌' };

/** 大伤害时的震屏：让"这一下很疼"有个体感 */
function screenShake() {
  var st = document.getElementById('stage');
  if (!st) return;
  st.classList.add('is-shake');
  setTimeout(function () { st.classList.remove('is-shake'); }, paced(280));
}

/** 每档的时长倍率：慢 / 正常 / 快 */
var SPEED_STEPS = [
  { key: 'slow', label: '慢', rate: 2.0 },
  { key: 'normal', label: '正常', rate: 1.35 },
  { key: 'fast', label: '快', rate: 0.7 },
];
var speedIdx = 1;                    // 默认「正常」，但比原先慢 35%

function speedRate() { return SPEED_STEPS[speedIdx].rate; }
/** 把一个时长按当前档位换算成实际毫秒 */
function paced(ms) { return Math.round(ms * speedRate()); }

function setSpeed(i) {
  speedIdx = Math.max(0, Math.min(SPEED_STEPS.length - 1, i));
  try { localStorage.setItem('jh3g.speed', SPEED_STEPS[speedIdx].key); } catch (e) { /* 隐私模式 */ }
  renderSpeedCtl();
}
function loadSpeed() {
  try {
    var k = localStorage.getItem('jh3g.speed');
    var i = SPEED_STEPS.findIndex(function (x) { return x.key === k; });
    if (i >= 0) speedIdx = i;
  } catch (e) { /* 忽略 */ }
}
/** 速度切换按钮：挂在 HUD 右上角，必须是 <body> 里的固定定位元素 */
function renderSpeedCtl() {
  var box = document.getElementById('speed-ctl');
  if (!box) {
    box = document.createElement('div');
    box.id = 'speed-ctl';
    box.innerHTML = '<span class="lb">节奏</span>';
    SPEED_STEPS.forEach(function (st, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.dataset.i = String(i);
      b.textContent = st.label;
      b.addEventListener('click', function (e) { e.stopPropagation(); setSpeed(i); });
      box.appendChild(b);
    });
    document.body.appendChild(box);
  }
  $all('#speed-ctl button').forEach(function (b) {
    b.classList.toggle('is-on', Number(b.dataset.i) === speedIdx);
  });
}

/**
 * 屏幕中央的「技能发动」大提示（ADR-074）
 *
 * 卡面太小、战场太挤，只靠卡上的小字玩家会漏掉"是谁的哪个技能在生效"。
 * 每次技能发动都在中央打一条 时机 + 单位 + 〈技能名〉的横幅。
 */
var skillToastTimer = null;
function skillToast(title, sub, tone) {
  var el = document.getElementById('skill-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'skill-toast';
    document.body.appendChild(el);
  }
  el.innerHTML = '<i>' + title + '</i><b>' + sub + '</b>';
  el.className = 'show ' + (tone || '');
  clearTimeout(skillToastTimer);
  // 不按固定时长关：横幅要**跟着这次结算一起存在**，否则技能还在结算、提示已经没了。
  // 由 playEvents 播完队列时收起；这里的定时器只是兜底（万一队列异常中断）。
  skillToastTimer = setTimeout(hideSkillToast, paced(4000));
}
function hideSkillToast() {
  var el = document.getElementById('skill-toast');
  if (el) el.className = '';
  clearTimeout(skillToastTimer);
}

/**
 * 跳过当前正在播的结算动画（ADR-077）
 *
 * 设计者反馈「执行攻击动作时不能选择其他卡牌」：`busy` 会把整段动画期间的
 * 所有操作全部挡住，节奏调慢之后尤其难受。现在任意操作都能**打断动画**：
 * 立刻跳到结算完成的状态，然后照常执行新操作。
 */
function skipAnimation() {
  if (!busy) return;
  animToken += 1;          // 让旧的播放链失效（它自己会 return）
  animQueue = null;
  hideSkillToast();
  arrowHide();
  busy = false;
  renderAll();
}

function playEvents(events, done) {
  lastAttack = null;
  drawnThisAction = false;
  var token = ++animToken;
  animQueue = events.slice();
  hideSkillToast();
  (function next() {
    if (token !== animToken) return;                 // 已被 skipAnimation 打断
    if (!animQueue.length) {
      animQueue = null; hideSkillToast(); done(); return;
    }
    var e = animQueue.shift();
    // ⚠️ ADR-076：日志**逐条**写，和动画同步。
    // 原先进结算前就把整段结果一次性写进日志 —— 玩家想"回看刚才为什么掉血"时，
    // 日志里早就写着结局，反而对不上正在播的动画。
    logOne(e);
    var wait = animate(e);
    if (wait > 0) setTimeout(next, paced(wait)); else next();
  })();
}

/** 追加一条日志并高亮（与动画同步用） */
function logOne(e) {
  var el = $('#log');
  if (!el) return;
  var d = describeEvent(e);
  if (!d) return;
  el.insertAdjacentHTML('beforeend', '<div class="le fresh ' + (d.cls || '') + '">' + d.text + '</div>');
  var last = el.lastElementChild;
  if (last) setTimeout(function () { last.classList.remove('fresh'); }, paced(700));
  while (el.children.length > LOG_MAX) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
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
      // ADR-077：设计者反馈"抽牌没有动画，不看数量和日志不知道自己抽牌了"。
      // 原因：手牌 DOM 要等整段动画结束后的 renderAll 才更新，抽到的牌在那之前**根本不存在**，
      // 只有一条很轻的牌堆闪光。现在：牌堆闪光 + 卡背飞向手牌 + **立刻重画手牌**
      // （新牌当场出现并弹一下）+ 手牌区飘一张 "+1"。
      var pile = $(e.side === 'own' ? '#own-deck-pile' : '#foe-deck-pile');
      var hp2 = $(e.side === 'own' ? '#own-hand-pile' : '#foe-hand-pile');
      if (pile) {
        pile.classList.add('is-drawing');
        setTimeout(function () { pile.classList.remove('is-drawing'); }, paced(460));
      }
      if (pile && hp2) flyCardBack(pile, hp2);
      if (e.side === 'own') drawnThisAction = true;
      // 立刻把新手牌画出来，别等动画播完
      renderHand(session.state);
      renderPanel(session.state);
      var handBox = $('#hand');
      if (handBox) {
        handBox.classList.add('is-drawing');
        setTimeout(function () { handBox.classList.remove('is-drawing'); }, paced(420));
        var newCard = handBox.lastElementChild;
        if (newCard) {
          newCard.classList.add('cr-land-bounce');
          setTimeout(function () { newCard.classList.remove('cr-land-bounce'); }, paced(420));
        }
        CR.float(handBox, '+1 张', 'is-buff', '抽牌', paced(1200));
      }
      return 420;
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
        setTimeout(function () { el.classList.remove('cr-hit'); }, paced(320));
        CR.spell(el, f.cls === 'is-skill' ? 'rgba(200,150,255,.9)' : null);
        // 飘字带出处（普攻 / 反击 / 技能名 / 中毒…），同目标连续挨打会累加；
        // 停留时间随节奏档位拉长 + 本步延时加长，避免"数字一闪而过、漏看"
        floatDamage(el, e.amount, f.cls, f.label, paced(1750));
        CR.tickHp(el, -e.amount);          // 卡面血量当场掉下来
        if (e.amount >= 5) screenShake();
      }
      return 520;
    }
    case 'HEAL': {
      var he = e.target.kind === 'lord' ? lordEl(e.target.side)
             : unitEl(e.target.side, e.target.row, e.target.col);
      if (he) {
        CR.float(he, '+' + e.amount, 'is-heal', '治疗', paced(1000));
        CR.tickHp(he, e.amount);
      }
      return 300;
    }
    case 'ARMOR_GAINED': {
      var le = lordEl(e.side);
      if (le) CR.float(le, '◈+' + e.amount, 'is-armor', '护甲');
      return 240;
    }
    case 'STATUS_APPLIED': {
      var se = unitEl(e.side, e.row, e.col) || (e.row === undefined ? lordEl(e.side) : null);
      if (se) CR.float(se, statusName(e.status) + (e.stacks > 1 ? '×' + e.stacks : ''), 'is-status', '状态', paced(950));
      return 260;
    }
    case 'STAT_MODIFIED': {
      var me = unitEl(e.side, e.row, e.col);
      if (me) {
        var txt = (e.attack ? '攻' + (e.attack > 0 ? '+' : '') + e.attack : '')
                + (e.health ? ' 血' + (e.health > 0 ? '+' : '') + e.health : '');
        CR.float(me, txt.trim() || '属性变化', (e.attack > 0 || e.health > 0) ? 'is-buff' : 'is-nerf', '', paced(950));
      }
      return 240;
    }
    case 'SKILL_TRIGGERED': {
      // 引擎在技能真正执行前一刻发的（ADR-074）——玩家必须看得见"谁发动了什么"
      var from = e.from || 'trigger';
      var tone = from === 'aura' ? 'is-aura' : 'is-cast';
      var when = SKILL_WHEN[e.timing] || SKILL_FROM[from] || '';
      var el = e.row !== undefined ? unitEl(e.side, e.row, e.col) : null;
      if (el) {
        el.classList.add('cr-skill-cast');
        setTimeout(function () { el.classList.remove('cr-skill-cast'); }, paced(700));
        CR.spell(el, from === 'aura' ? 'rgba(255,215,130,.85)' : 'rgba(180,150,255,.9)');
        // 卡上再飘一条小字，方便"对上号"；光环只留描边（它是持续状态，每次都飘会刷屏）
        if (from !== 'aura') CR.float(el, '〈' + e.skillName + '〉', 'is-skillname', when, paced(1150));
      }
      // 中央横幅：即使单位在角落也能看见
      skillToast((e.unitName ? e.unitName + ' · ' : '') + (when || '技能'),
        '〈' + e.skillName + '〉', tone);
      return 300;                     // 横幅会一直留到结算结束，单事件不必等太久
    }
    case 'CARD_MILLED': {
      var mp = $(e.side === 'own' ? '#own-deck-pile' : '#foe-deck-pile');
      if (mp) {
        mp.classList.add('is-milled');
        setTimeout(function () { mp.classList.remove('is-milled'); }, paced(520));
        CR.float(mp, '−1', 'is-nerf', '牌库被拆');
      }
      return 260;
    }
    case 'TURN_SKIPPED': {
      var skipName = SIDE_NAME[e.side] || e.side;
      banner('回合被跳过', skipName + '因「' + (e.reason || '') + '」本回合无法行动');
      return 900;
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
      timerReset();                      // 新回合 → 倒计时归位
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
   回合倒计时（ADR-065）
   每方回合 1 分钟，到点自动结束该方回合。秒数取自 core 的
   MATCH.TURN_SECONDS —— 规则常量不放原型里。
   ============================================================ */

var turnSeconds = (Core.MATCH && Core.MATCH.TURN_SECONDS) || 60;
var turnLeft = turnSeconds;
var turnTimerId = null;

function timerReset() {
  turnLeft = turnSeconds;
  renderTimer();
}

function renderTimer() {
  var n = document.getElementById('turn-timer');
  var bar = document.getElementById('turn-timer-bar');
  if (!n) return;
  n.textContent = String(turnLeft);
  var low = turnLeft <= 10;
  n.classList.toggle('is-low', low);
  if (bar) {
    bar.style.transform = 'scaleX(' + (turnLeft / turnSeconds) + ')';
    bar.classList.toggle('is-low', low);
  }
}

function timerTick() {
  // 结算动画播放中不扣时间，避免"看着动画就被判超时"
  if (busy || !session || session.state.winner) return;
  turnLeft -= 1;
  if (turnLeft <= 0) {
    turnLeft = 0;
    renderTimer();
    autoEndTurn();
    return;
  }
  renderTimer();
}

/** 到点自动结束当前行动方的回合 */
function autoEndTurn() {
  if (busy || !session || session.state.winner) return;
  if (session.state.active === 'own') {
    showDetail('超时', '本回合时间到', '已自动结束回合');
    doAction({ type: 'END_TURN' });
  } else {
    // 敌方回合超时（AI 正常不会慢到这个程度）——直接替它结束
    runAiTurn(true);
  }
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

function runAiTurn(forceEnd) {
  if (busy || session.state.winner || !shouldAuto()) return;
  var action = forceEnd ? { type: 'END_TURN' }
    : (Core.chooseAction(session.state, session.ctx) || { type: 'END_TURN' });
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
  arrowHide();
  clearMarks();
  sel = null;
  pendingSkill = null;
});

// 点击选中单位后（非拖拽），箭头跟着光标走，命中合法目标变绿
window.addEventListener('pointermove', function (e) {
  if (drag) return;                       // 拖拽路径已在 onDragMove 里处理
  if (!sel || sel.kind !== 'unit') { arrowHide(); return; }
  var wrap = document.querySelector('.slot[data-side="own"][data-row="' + sel.row +
    '"][data-col="' + sel.col + '"] .unit-wrap');
  if (!wrap) { arrowHide(); return; }
  arrowTo(wrap, e.clientX, e.clientY, dropIsValid(e.clientX, e.clientY));
});
window.addEventListener('resize', reportSizes);
window.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' || e.key === 'Esc') onEscape();
});

// 倒计时：每方回合 1 分钟（ADR-065）
timerReset();
turnTimerId = setInterval(timerTick, 1000);

if (location.search.indexOf('clean') >= 0) {
  document.getElementById('hud').style.display = 'none';
  document.getElementById('detail').style.display = 'none';
}

// 节奏档位（ADR-074）：恢复上次选择，并把切换按钮挂上
bootSpeed();

// 双 AI 对打（?autoboth）：整局自动跑，用于连续观察机制与动画
if (location.search.indexOf('autoboth') >= 0) { /* 由 shouldAuto() 处理 */ }

newGame();
