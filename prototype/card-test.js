(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CardTest = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var factions = ['shu', 'wei', 'wu'];
  var types = ['troop', 'general', 'strategist', 'tactic', 'event'];
  var testSequence = 0;

  function selectableCards(core, gameData) {
    return gameData.cards.filter(function (card) {
      return types.indexOf(card.type) >= 0 && core.isDeckable(card)
        && !(card.skills || []).some(function (skill) { return skill.pending === true; });
    });
  }

  function parseConfig(search, core, gameData) {
    var params = new URLSearchParams(search);
    var ids = (params.get('test') || '').split(',').filter(Boolean);
    var allowed = new Set(selectableCards(core, gameData).map(function (card) { return card.id; }));
    var ownFaction = params.get('own') || 'shu';
    var enemyFaction = params.get('enemy') || 'wei';
    if (ids.length < 1 || ids.length > 10 || new Set(ids).size !== ids.length
      || ids.some(function (id) { return !allowed.has(id); })) return null;
    if (!factions.includes(ownFaction) || !factions.includes(enemyFaction)) return null;
    return { ids: ids, ownFaction: ownFaction, enemyFaction: enemyFaction, enemyAi: params.get('ai') === '1' };
  }

  function createSession(core, gameData, config) {
    var lordId = function (faction) {
      var lord = gameData.heroes.find(function (hero) {
        return hero.type === 'lord' && hero.faction === faction;
      });
      if (!lord) throw new Error('找不到' + faction + '阵营主公');
      return lord.id;
    };
    var data = core.loadData(
      { cards: gameData.cards, heroes: gameData.heroes },
      { own: lordId(config.ownFaction), enemy: lordId(config.enemyFaction) },
    );
    var dummy = data.cards.get('neutral_infantry');
    if (!dummy) throw new Error('缺少测试用基础兵');
    var ownDeck = Array.from({ length: 30 }, function (_, index) {
      return config.ids[index % config.ids.length];
    });
    var enemyDeck = Array(30).fill(dummy.id);
    var state = core.createMatch({
      seed: 1, cards: data.cards, lords: data.lords,
      decks: { own: ownDeck, enemy: enemyDeck }, firstSide: 'own', secondCompensation: 'none',
    });
    state.sides.own.command = { cur: 10, max: 10 };
    var ctx = { cards: data.cards, lords: data.lords };
    var started = core.startMatch(state, ctx);
    state = started.state;
    state.sides.own.hand = config.ids.map(function (id) {
      return { card: data.cards.get(id), mods: [] };
    });
    state.uidSeq += 1;
    state.sides.own.rows.front[0] = core.makeUnit(dummy, state.turn, state.uidSeq);
    // 测试场景始终保留基础兵，同时随机放入一个敌方武将和一个谋臣，
    // 方便验证指向性技能、伤害目标和人物类型筛选。随机仍走 core RNG，
    // 只用变化的测试序号作为种子，不把 Math.random 引入规则层。
    var enemyRng = Core.createRng((Date.now() + (++testSequence * 0x9e3779b9)) >>> 0);
    var enemyPool = data.cards instanceof Map ? Array.from(data.cards.values()) : gameData.cards;
    var enemyGeneral = enemyPool.filter(function (card) {
      return card.faction === config.enemyFaction && card.type === 'general'
        && card.attack != null && card.health != null
        && !(card.skills || []).some(function (skill) { return skill.pending === true; });
    });
    var enemyStrategist = enemyPool.filter(function (card) {
      return card.faction === config.enemyFaction && card.type === 'strategist'
        && card.attack != null && card.health != null
        && !(card.skills || []).some(function (skill) { return skill.pending === true; });
    });
    var general = enemyRng.pick(enemyGeneral);
    var strategist = enemyRng.pick(enemyStrategist);
    var enemyUnits = [dummy, dummy, dummy, general, strategist];
    enemyUnits.forEach(function (card, index) {
      var col = index + 2;
      state.uidSeq += 1;
      state.sides.enemy.rows.front[col] = core.makeUnit(card, state.turn, state.uidSeq);
    });
    return {
      state: state, ctx: ctx,
      events: started.events.filter(function (event) {
        return !(event.type === 'CARD_DRAWN' && event.side === 'own');
      }),
      meta: { ownFaction: config.ownFaction, enemyFaction: config.enemyFaction,
        enemyGeneral: general.id, enemyStrategist: strategist.id },
    };
  }

  return { selectableCards: selectableCards, parseConfig: parseConfig, createSession: createSession };
});
