(function () {
  var cards = CardTest.selectableCards(Core, GameData);
  var byId = new Map(cards.map(function (card) { return [card.id, card]; }));
  var selected = [];
  var factionNames = { shu:'蜀', wei:'魏', wu:'吴', qun:'群雄', neutral:'中立' };
  var typeNames = { troop:'兵种', general:'武将', strategist:'谋臣', tactic:'战法', event:'事件' };
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (value) { return String(value).replace(/[&<>"']/g, function (char) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char];
  }); };
  var effect = function (card) {
    return (card.skills || []).map(function (skill) { return skill.text || skill.name; }).filter(Boolean).join('；')
      || card.memo || (card.keywords || []).join('、') || '暂无效果描述';
  };

  function render() {
    var search = $('search').value.trim().toLowerCase();
    var faction = $('faction').value, type = $('type').value, cost = $('cost').value;
    var shown = cards.filter(function (card) {
      return (!faction || card.faction === faction) && (!type || card.type === type)
        && (!cost || card.cost === Number(cost))
        && (!search || (card.name + ' ' + card.id + ' ' + effect(card)).toLowerCase().includes(search));
    });
    $('count').textContent = '可用 ' + shown.length + ' 张';
    $('cards').innerHTML = shown.map(function (card) {
      var isSelected = selected.includes(card.id);
      var stats = card.attack != null && card.health != null ? '攻 ' + card.attack + '　血 ' + card.health : '';
      return '<article class="card' + (isSelected ? ' selected' : '') + '">'
        + '<div class="card-head"><strong>' + esc(card.name) + '</strong><span class="cost">' + card.cost + '费</span></div>'
        + '<div class="tags"><span class="tag faction">' + factionNames[card.faction] + '</span><span class="tag">' + typeNames[card.type] + '</span></div>'
        + '<div class="description">' + esc(effect(card)) + '</div>'
        + '<div class="card-foot"><span class="stats">' + stats + '</span><button data-card="' + esc(card.id) + '"'
        + (!isSelected && selected.length >= 10 ? ' disabled' : '') + '>' + (isSelected ? '移除' : '选择') + '</button></div></article>';
    }).join('') || '<div class="empty">没有符合条件的卡牌</div>';
    $('selected-count').textContent = selected.length + ' / 10';
    $('selected').innerHTML = selected.map(function (id) {
      var card = byId.get(id);
      return '<div class="selected-row"><span>' + esc(card.name) + ' · ' + card.cost + '费</span><button data-remove="'
        + esc(id) + '" aria-label="移除' + esc(card.name) + '">×</button></div>';
    }).join('') || '<div class="empty">尚未选择卡牌</div>';
    $('start').disabled = selected.length === 0;
    $('status').textContent = '';
  }

  ['search','faction','type','cost'].forEach(function (id) { $(id).addEventListener('input', render); });
  $('cards').addEventListener('click', function (event) {
    var button = event.target.closest('[data-card]');
    if (!button) return;
    var id = button.dataset.card, index = selected.indexOf(id);
    if (index >= 0) selected.splice(index, 1);
    else if (selected.length < 10) selected.push(id);
    render();
  });
  $('selected').addEventListener('click', function (event) {
    var button = event.target.closest('[data-remove]');
    if (!button) return;
    selected.splice(selected.indexOf(button.dataset.remove), 1);
    render();
  });
  $('start').addEventListener('click', function () {
    var query = new URLSearchParams({ test: selected.join(','), own: $('own').value, enemy: $('enemy').value });
    if ($('enemy-ai').checked) query.set('ai', '1');
    if (!CardTest.parseConfig('?' + query, Core, GameData)) {
      $('status').textContent = '请选择 1～10 张有效卡牌';
      return;
    }
    location.href = 'battlefield.html?' + query;
  });
  render();
})();
