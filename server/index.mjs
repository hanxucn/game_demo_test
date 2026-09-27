#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import net from 'node:net';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
// 组卡规则**唯一真源是 core**（core/src/deck.ts），服务端直接 import 它。
// Node ≥22.18 默认开启类型剥离，可直接 import .ts（本服务本来就已经要求
// node:sqlite，即 ≥22.5，故这不是新增的运行门槛）。
// 从前这里抄了一份 JS 版规则，与引擎各存一份 —— 已经漂移过：core 用黑名单
// NON_DECK_TYPES（新增卡型默认**可**组），这里用白名单 DECKABLE_TYPES
// （新增卡型默认**不可**组），默认相反，只是当前卡型恰好重合而已。
import { loadData } from '../core/src/loader.ts';
import {
  validateDeck as coreValidateDeck, isDeckable, maxCopiesOf,
  PLAYABLE_FACTIONS, PUBLIC_POOL,
} from '../core/src/deck.ts';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SERVER_DIR = resolve(ROOT, 'server');
const DB_FILE = resolve(SERVER_DIR, 'game.db');
const PORT = Number(process.env.PORT || 8099);
const DEMO_USER = 'demo-user';

/** 读一个生成出来的 JSON 目录；缺了就给人话，而不是甩一个与卡组无关的 ENOENT。 */
async function readGenerated(name, hint) {
  const file = resolve(ROOT, 'core/data', name);
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    console.error(`✗ 读不到 core/data/${name} —— 它是**生成物**（被 .gitignore 忽略），首次运行前要先导出。`);
    console.error('  跑一次：  python3 tools/yaml2json.py');
    console.error(`  或整条链：bash tools/build-cards.sh${hint ? `   （${hint}）` : ''}`);
    process.exit(1);
  }
}

await mkdir(SERVER_DIR, { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec(await readFile(resolve(SERVER_DIR, 'schema.sql'), 'utf8'));

const cardSource = await readGenerated('cards.json');
const heroSource = await readGenerated('heroes.json');
// 服务端只做「玩家状态」把关；「卡组合不合法」全交给 core 判定。
const coreData = loadData({ cards: cardSource, heroes: heroSource },
  { own: 'shu_liubei', enemy: 'wei_caocao' });

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
      const deckable = isDeckable(card);            // ← core 判定，不再本地维护白名单
      const ready = deckable && implemented(card);
      const quantity = maxCopiesOf(card);           // ← 基础兵 3 / 其余 1，同样来自 core
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
  const publicList = PUBLIC_POOL.map((f) => `'${f}'`).join(', ');   // ← 公共池同样来自 core
  const where = faction ? `AND (c.faction = ? OR c.faction IN (${publicList}))` : '';
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
/**
 * 卡组校验分两层，职责不重叠：
 *   ① **组卡规则**（30 张 / 阵营池 / 同名上限 / 可否组入）→ 一律问 core，服务端不重写
 *   ② **玩家状态**（卡是否启用、是否已实现、是否拥有足够张数）→ 只有服务端知道，查 DB
 *
 * 从前 ① 在这里被抄了第二份（DECK_SIZE / PUBLIC_POOL / DECKABLE_TYPES / quantity > 3），
 * 于是引擎、服务端、前端各有一份"同名上限"，改一处忘一处就是静默漂移。
 */
function validateDeck(input) {
  if (!PLAYABLE_FACTIONS.includes(input.faction)) {
    throw new Error(`阵营必须是 ${PLAYABLE_FACTIONS.join('、')}`);
  }
  if (!Array.isArray(input.cards)) throw new Error('cards 必须是数组');
  const cards = input.cards.map((item) => ({ cardId: String(item.cardId || ''), quantity: Number(item.quantity) }));
  if (cards.some((x) => !x.cardId || !Number.isInteger(x.quantity) || x.quantity < 1)) throw new Error('卡牌数量必须是正整数');
  if (new Set(cards.map((x) => x.cardId)).size !== cards.length) throw new Error('同一张卡只能出现一条明细');

  // ① 组卡规则：展开成扁平 id 数组交给 core（它按 DECK.SIZE / 阵营池 / maxCopiesOf 判）
  const ids = [];
  for (const item of cards) for (let i = 0; i < item.quantity; i += 1) ids.push(item.cardId);
  const chk = coreValidateDeck(coreData, input.faction, ids);
  if (!chk.ok) throw new Error(chk.errors[0].message);

  // ② 玩家状态：core 只认卡牌定义、不认数据库，这一层必须留在服务端
  for (const item of cards) {
    const card = db.prepare('SELECT * FROM cards WHERE id = ? AND enabled = 1').get(item.cardId);
    if (!card || !card.deckable || !card.implemented) throw new Error(`卡牌不可用：${item.cardId}`);
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
const server = createServer(async (req, res) => { try { const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`); if (url.pathname.startsWith('/api/')) await api(req, res, url); else await serveStatic(req, res, url); } catch (e) { error(res, 500, e.message); } });

/** 这个端口上是不是**本服务**已经在跑了（用 /api/health 认人，别误杀别人的服务） */
async function probeOurs(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(800) });
    if (!r.ok) return false;
    const body = await r.json();
    return body?.ok === true && body.user === DEMO_USER;
  } catch { return false; }
}

/** 端口是否空闲（真的去 bind 一次，比只看 lsof 可靠） */
function portFree(port) {
  return new Promise((done) => {
    const probe = net.createServer();
    probe.once('error', () => done(false));
    probe.once('listening', () => probe.close(() => done(true)));
    probe.listen(port, '127.0.0.1');
  });
}

async function pickPort(start, limit = 20) {
  if (await probeOurs(start)) return { port: start, already: true };
  if (await portFree(start)) return { port: start, already: false };
  for (let p = start + 1; p < start + limit; p += 1) {
    if (await portFree(p)) return { port: p, already: false, moved: true };
  }
  return null;
}

// 端口被占时**自动换一个**（原先这个便利功能在 tools/serve.sh 的 python 里；
// serve.sh 现在直接委托给本服务，所以搬进来）。重复启动也不再甩 EADDRINUSE 栈。
const picked = await pickPort(PORT);
if (!picked) {
  console.error(`✗ 从 ${PORT} 起连续 20 个端口都被占用，换个起始端口试试：`);
  console.error(`    PORT=9000 node server/index.mjs`);
  process.exit(1);
}
const LISTEN_PORT = picked.port;
if (picked.already) {
  console.log('✓ 服务已经在跑了，直接用：');
  console.log(`    http://127.0.0.1:${LISTEN_PORT}/prototype/battlefield.html`);
  console.log('  （想重启：pkill -f "server/index.mjs" 之后再跑一次）');
  process.exit(0);
}
if (picked.moved) console.log(`⚠ 端口 ${PORT} 被别的程序占用，改用 ${LISTEN_PORT}`);

server.on('error', (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.error(`✗ 端口 ${LISTEN_PORT} 刚被抢占，重跑一次即可。`);
  process.exit(1);
});

server.listen(LISTEN_PORT, '127.0.0.1', () => {
  console.log('✓ 酒话三国服务已启动（静态页面 + 卡组 API）');
  console.log(`    对战：http://127.0.0.1:${LISTEN_PORT}/prototype/battlefield.html`);
  console.log(`    构筑：http://127.0.0.1:${LISTEN_PORT}/prototype/deck-builder.html`);
  console.log('    卡组存于 server/game.db（跨浏览器、跨机器都在）');
});
