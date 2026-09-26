#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SERVER_DIR = resolve(ROOT, 'server');
const DB_FILE = resolve(SERVER_DIR, 'game.db');
const PORT = Number(process.env.PORT || 8099);
const DEMO_USER = 'demo-user';
const DECK_SIZE = 30;
const PUBLIC_POOL = new Set(['neutral', 'qun']);
const DECKABLE_TYPES = new Set(['troop', 'general', 'strategist', 'event', 'tactic']);

await mkdir(SERVER_DIR, { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec(await readFile(resolve(SERVER_DIR, 'schema.sql'), 'utf8'));

const cardSource = JSON.parse(await readFile(resolve(ROOT, 'core/data/cards.json'), 'utf8'));
const user = db.prepare('SELECT id FROM users WHERE id = ?').get(DEMO_USER);
if (!user) {
  db.prepare('INSERT INTO users (id, nickname, platform, platform_uid) VALUES (?, ?, ?, ?)')
    .run(DEMO_USER, 'Demo 玩家', 'demo', 'demo-user');
}

function implemented(card) {
  // 卡牌数据已经由 core 的 DSL 测试和校验流程筛选；这里只排除明确标记
  // pending 的占位卡，不能用“技能 id 为空”推断未实现，事件/战法的 DSL
  // 数据允许没有技能 id。
  return !(card.skills || []).some((skill) => skill.pending === true);
}

function syncCards() {
  const upsert = db.prepare(`INSERT INTO cards
    (id, name, faction, type, cost, deckable, implemented, enabled, definition_json, checksum)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, faction=excluded.faction,
      type=excluded.type, cost=excluded.cost, deckable=excluded.deckable,
      implemented=excluded.implemented, definition_json=excluded.definition_json,
      checksum=excluded.checksum, updated_at=CURRENT_TIMESTAMP`);
  const addOwned = db.prepare(`INSERT INTO user_cards (user_id, card_id, quantity)
    VALUES (?, ?, ?) ON CONFLICT(user_id, card_id) DO NOTHING`);
  db.exec('BEGIN');
  try {
    for (const card of cardSource) {
      const json = JSON.stringify(card);
      const deckable = DECKABLE_TYPES.has(card.type);
      const ready = deckable && implemented(card);
      const quantity = card.type === 'troop' ? 3 : 1;
      upsert.run(card.id, card.name, card.faction, card.type, card.cost ?? 0,
        deckable ? 1 : 0, ready ? 1 : 0, json, createHash('sha256').update(json).digest('hex'));
      if (ready) addOwned.run(DEMO_USER, card.id, quantity);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
syncCards();

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}
function error(res, status, message) { send(res, status, { error: message }); }
function cardRows(faction, withOwnership = false) {
  const where = faction ? `AND (c.faction = ? OR c.faction IN ('neutral', 'qun'))` : '';
  const args = faction ? [DEMO_USER, faction] : [DEMO_USER];
  const sql = `SELECT c.id, c.name, c.faction, c.type, c.cost, c.implemented,
    c.deckable, c.definition_json, ${withOwnership ? 'COALESCE(uc.quantity, 0)' : '0'} AS owned
    FROM cards c LEFT JOIN user_cards uc ON uc.card_id = c.id AND uc.user_id = ?
    WHERE c.enabled = 1 AND c.deckable = 1 ${where} ORDER BY c.cost, c.type, c.name`;
  return db.prepare(sql).all(...args).map((row) => {
    const definition = JSON.parse(row.definition_json);
    const { definition_json: _, ...summary } = row;
    return {
      ...summary,
      attack: definition.attack,
      health: definition.health,
      skills: definition.skills || [],
      keywords: definition.keywords || [],
      memo: definition.memo || '',
    };
  });
}
function deckRows(deckId) {
  const deck = db.prepare('SELECT * FROM user_decks WHERE id = ? AND user_id = ?').get(deckId, DEMO_USER);
  if (!deck) return null;
  const cards = db.prepare(`SELECT dc.card_id AS cardId, dc.quantity, c.name, c.cost, c.faction, c.type
    FROM user_deck_cards dc JOIN cards c ON c.id = dc.card_id WHERE dc.deck_id = ? ORDER BY c.cost, c.name`)
    .all(deckId);
  return { ...deck, cards };
}
function parseBody(req) {
  return new Promise((resolveBody, reject) => { let raw = ''; req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => { try { resolveBody(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('请求 JSON 无效')); } });
    req.on('error', reject); });
}
function validateDeck(input) {
  if (!['shu', 'wei', 'wu'].includes(input.faction)) throw new Error('阵营必须是 shu、wei 或 wu');
  if (!Array.isArray(input.cards)) throw new Error('cards 必须是数组');
  const cards = input.cards.map((item) => ({ cardId: String(item.cardId || ''), quantity: Number(item.quantity) }));
  if (cards.some((x) => !x.cardId || !Number.isInteger(x.quantity) || x.quantity < 1)) throw new Error('卡牌数量必须是正整数');
  if (cards.some((x) => x.quantity > 3)) throw new Error('基础兵最多 3 张，其他卡牌最多 1 张');
  if (cards.reduce((sum, x) => sum + x.quantity, 0) !== DECK_SIZE) throw new Error('卡组必须正好 30 张');
  if (new Set(cards.map((x) => x.cardId)).size !== cards.length) throw new Error('同一张卡只能出现一条明细');
  for (const item of cards) {
    const card = db.prepare('SELECT * FROM cards WHERE id = ? AND enabled = 1').get(item.cardId);
    if (!card || !card.deckable || !card.implemented) throw new Error(`卡牌不可用：${item.cardId}`);
    if (card.faction !== input.faction && !PUBLIC_POOL.has(card.faction)) throw new Error(`卡牌不属于 ${input.faction} 卡池：${card.name}`);
    const max = card.type === 'troop' ? 3 : 1;
    if (item.quantity > max) throw new Error(`${card.name} 最多 ${max} 张`);
    const owned = db.prepare('SELECT quantity FROM user_cards WHERE user_id = ? AND card_id = ?').get(DEMO_USER, item.cardId);
    if (!owned || owned.quantity < item.quantity) throw new Error(`未拥有足够的 ${card.name}`);
  }
  return cards;
}

async function api(req, res, url) {
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }
  if (url.pathname === '/api/health') return send(res, 200, { ok: true, user: DEMO_USER });
  if (url.pathname === '/api/cards' && req.method === 'GET') return send(res, 200, { cards: cardRows(url.searchParams.get('faction'), false) });
  if (url.pathname === `/api/users/${DEMO_USER}` && req.method === 'GET') return send(res, 200, db.prepare('SELECT * FROM users WHERE id = ?').get(DEMO_USER));
  if (url.pathname === `/api/users/${DEMO_USER}/cards` && req.method === 'GET') return send(res, 200, { cards: cardRows(url.searchParams.get('faction'), true) });
  if (url.pathname === `/api/users/${DEMO_USER}/decks` && req.method === 'GET') {
    const decks = db.prepare('SELECT id, name, faction, revision, created_at, updated_at FROM user_decks WHERE user_id = ? ORDER BY updated_at DESC').all(DEMO_USER);
    return send(res, 200, { decks });
  }
  const match = url.pathname.match(new RegExp(`^/api/users/${DEMO_USER}/decks(?:/([^/]+))?$`));
  if (match) {
    const id = match[1];
    try {
      if (req.method === 'GET' && id) { const deck = deckRows(id); return deck ? send(res, 200, deck) : error(res, 404, '卡组不存在'); }
      if (req.method === 'POST' && !id || req.method === 'PUT' && id) {
        const body = await parseBody(req); const cards = validateDeck(body); const name = String(body.name || '未命名卡组').trim().slice(0, 32) || '未命名卡组';
        db.exec('BEGIN');
        try {
          let deckId = id;
          if (req.method === 'POST') { deckId = randomUUID(); db.prepare('INSERT INTO user_decks (id, user_id, name, faction) VALUES (?, ?, ?, ?)').run(deckId, DEMO_USER, name, body.faction); }
          else { const current = db.prepare('SELECT revision FROM user_decks WHERE id = ? AND user_id = ?').get(deckId, DEMO_USER); if (!current) throw new Error('卡组不存在'); db.prepare('UPDATE user_decks SET name = ?, faction = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(name, body.faction, deckId, DEMO_USER); db.prepare('DELETE FROM user_deck_cards WHERE deck_id = ?').run(deckId); }
          const insert = db.prepare('INSERT INTO user_deck_cards (deck_id, card_id, quantity) VALUES (?, ?, ?)'); for (const card of cards) insert.run(deckId, card.cardId, card.quantity);
          db.exec('COMMIT'); return send(res, 200, deckRows(deckId));
        } catch (e) { db.exec('ROLLBACK'); throw e; }
      }
      if (req.method === 'DELETE' && id) { const result = db.prepare('DELETE FROM user_decks WHERE id = ? AND user_id = ?').run(id, DEMO_USER); return result.changes ? send(res, 200, { ok: true }) : error(res, 404, '卡组不存在'); }
    } catch (e) { return error(res, 400, e.message); }
  }
  return error(res, 404, '接口不存在');
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
async function serveStatic(req, res, url) {
  const pathname = url.pathname === '/' ? '/prototype/deck-builder.html' : url.pathname;
  const file = resolve(ROOT, `.${pathname}`);
  if (!file.startsWith(ROOT + sep)) return error(res, 403, '禁止访问');
  try { const body = await readFile(file); res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(body); }
  catch { error(res, 404, '文件不存在'); }
}
createServer(async (req, res) => { try { const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`); if (url.pathname.startsWith('/api/')) await api(req, res, url); else await serveStatic(req, res, url); } catch (e) { error(res, 500, e.message); } })
  .listen(PORT, '127.0.0.1', () => console.log(`酒话三国服务已启动：http://127.0.0.1:${PORT}/prototype/deck-builder.html`));
