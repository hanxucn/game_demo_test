/* 探针自动驱动：按 ?step=faction|deck|mulligan|battle|autoplay 走到对应界面。
   autoplay 会持续走真实点击路径（出牌 → 攻击 → 结束回合），
   用来连续触发普攻/反击/技能/阵亡动画，截图核对用。 */
(function () {
  var step = (location.search.match(/step=(\w+)/) || [])[1] || 'faction';
  if (step === 'autoplay') step = 'battle';   // 兼容旧写法；自动对打改由 ?autoboth 触发
  function click(sel) { var e = document.querySelector(sel); if (e) e.click(); }
  function clickText(t) {
    var all = document.querySelectorAll('#setup button, #setup .crow');
    for (var i = 0; i < all.length; i++) if (all[i].textContent.trim() === t) { all[i].click(); return true; }
    return false;
  }
  setTimeout(function () {
    click('[data-act="toDeck"]');
    if (step === 'faction') return;
    setTimeout(function () {
      clickText('自动组卡');
      if (step === 'deck') return;
      setTimeout(function () {
        click('[data-act="toMulligan"]');
        if (step === 'mulligan') return;
        setTimeout(function () { click('[data-act="start"]'); }, 150);
      }, 250);
    }, 250);
  }, 350);
})();

/* 自动对打交给引擎：加 ?autoboth 即由 AI 接管我方（见 battlefield.engine.js 的 AUTO_BOTH）。
   这里刻意不做"模拟点击"驱动 —— 出牌是 pointerdown 拖拽，JS 的 .click() 触发不了，
   靠合成指针事件很脆；引擎级 autoboth 稳定得多。 */

/* 布局诊断：把画布与各子块高度写进 <title>，供 --dump-dom 读取 */
setTimeout(function () {
  var c = document.getElementById('canvas');
  if (!c) return;
  var out = ['canvas.scrollH=' + c.scrollHeight + ' clientH=' + c.clientHeight];
  [].forEach.call(c.children, function (el) {
    if (el.offsetHeight) out.push((el.id || el.className) + '=' + el.offsetHeight + '/' + el.scrollHeight);
  });
  document.title = 'DIAGMARK ' + out.join(' | ');
}, 1500);

/* ---------- 动效样张：?showcase 时持续注入各类飘字/光效，便于截图核对视觉 ---------- */
(function () {
  if (location.search.indexOf('showcase') < 0) return;

  var SAMPLES = [
    { t: '-3', c: 'is-dmg',     s: '普通攻击' },
    { t: '-2', c: 'is-counter', s: '反击' },
    { t: '-6', c: 'is-skill is-big', s: '火攻' },
    { t: '-1', c: 'is-status',  s: '中毒' },
    { t: '-2', c: 'is-fatigue', s: '粮尽' },
    { t: '+4', c: 'is-heal',    s: '治疗' },
    { t: '◈+2', c: 'is-armor',  s: '护甲' },
    { t: '攻+2', c: 'is-buff',  s: '振奋' },
    { t: '震慑×2', c: 'is-status', s: '状态' },
  ];

  function inject() {
    var hosts = [].slice.call(document.querySelectorAll('.unit-wrap, .lord-bar, #lord-enemy'));
    if (!hosts.length) { setTimeout(inject, 400); return; }
    var k = 0;
    hosts.slice(0, SAMPLES.length).forEach(function (el) {
      var s = SAMPLES[k++];
      if (s && window.CR) CR.float(el, s.t, s.c, s.s);
    });
    // 技能光效 + 阵亡各演示一次
    if (window.CR && hosts[0]) CR.spell(hosts[0], 'rgba(200,150,255,.9)');
    var live = document.querySelector('.slot[data-side="enemy"] .unit-wrap');
    if (window.CR && live && !live.dataset.demoDied) {
      live.dataset.demoDied = '1';
      CR.die(live, null);
    }
  }
  setInterval(inject, 500);
  setTimeout(inject, 2000);
})();
