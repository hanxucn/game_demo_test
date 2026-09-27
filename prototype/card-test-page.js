(function () {
  var cards = CardTest.selectableCards(Core, GameData);
  var byId = new Map(cards.map(function (card) { return [card.id, card]; }));
  var selected = [];
  var $ = function (id) { return document.getElementById(id); };
  // 转义 / 效果文案 / 卡名与阵营映射统一来自 CardTile —— 本页不再各写一份
  var Tile = window.CardTile;
  var esc = Tile.esc;
  var effect = Tile.effectText;

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
      // 这里是"挑 1~10 张来测"，不是配 30 张卡组 —— 所以不传 count/cap/owned
      return Tile.render(card, {
        selected: isSelected,
        action: {
          attr: 'data-card',
          label: isSelected ? '移除' : '选择',
          disabled: !isSelected && selected.length >= 10,
        },
      });
    }).join('') || Tile.empty('没有符合条件的卡牌');
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
