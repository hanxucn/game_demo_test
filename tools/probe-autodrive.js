/* 探针自动驱动：按 ?step=faction|deck|mulligan|battle 走到对应界面 */
(function () {
  var step = (location.search.match(/step=(\w+)/) || [])[1] || 'faction';
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

/* 布局诊断：把画布与各子块高度写进 <title>，供 --dump-dom 读取 */
setTimeout(function () {
  var c = document.getElementById('canvas');
  if (!c) return;
  var out = ['canvas.scrollH=' + c.scrollHeight + ' clientH=' + c.clientHeight];
  [].forEach.call(c.children, function (el) {
    if (el.offsetHeight) out.push((el.id || el.className) + '=' + el.offsetHeight + '/' + el.scrollHeight);
  });
  var ar = document.querySelector('.arena');
  if (ar) [].forEach.call(ar.children, function (el) {
    out.push('  arena>' + (el.id || el.className) + '=' + el.offsetHeight + '/' + el.scrollHeight);
  });
  document.title = 'DIAGMARK ' + out.join(' | ');
}, 1500);
