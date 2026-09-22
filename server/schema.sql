PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  avatar_url TEXT,
  platform TEXT NOT NULL DEFAULT 'demo',
  platform_uid TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  faction TEXT NOT NULL,
  type TEXT NOT NULL,
  cost INTEGER NOT NULL,
  deckable INTEGER NOT NULL DEFAULT 0,
  implemented INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  definition_json TEXT NOT NULL,
  content_version INTEGER NOT NULL DEFAULT 1,
  checksum TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_cards (
  user_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, card_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_decks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  faction TEXT NOT NULL CHECK (faction IN ('shu', 'wei', 'wu')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_deck_cards (
  deck_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 3),
  PRIMARY KEY (deck_id, card_id),
  FOREIGN KEY (deck_id) REFERENCES user_decks(id) ON DELETE CASCADE,
  FOREIGN KEY (card_id) REFERENCES cards(id)
);

CREATE INDEX IF NOT EXISTS idx_cards_faction ON cards(faction);
CREATE INDEX IF NOT EXISTS idx_user_decks_user ON user_decks(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_user_cards_user ON user_cards(user_id);
