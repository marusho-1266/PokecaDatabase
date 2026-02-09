-- ポケモンカードデータベース D1（SQLite）用スキーマ
-- database/schema.sql（PostgreSQL）を D1 用に変換
-- docs/D1_wrangler_execute_実装計画.md に基づく

-- 基本カード情報
CREATE TABLE IF NOT EXISTS cards (
  card_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  full_name TEXT,
  category TEXT NOT NULL DEFAULT '不明',
  image_url TEXT,
  detail_url TEXT,
  hp INTEGER,
  card_type TEXT,
  energy_subtype TEXT,
  effect_text TEXT,
  evolution_stage TEXT,
  pokemon_number TEXT,
  weakness TEXT,
  weakness_type TEXT,
  weakness_value TEXT,
  resistance TEXT,
  resistance_type TEXT,
  resistance_value TEXT,
  retreat_cost INTEGER,
  set_code TEXT,
  set_name TEXT,
  regulation TEXT,
  card_number TEXT,
  rarity TEXT,
  illustrator TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  last_verified_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_cards_name ON cards(name);
CREATE INDEX IF NOT EXISTS idx_cards_category ON cards(category);
CREATE INDEX IF NOT EXISTS idx_cards_set_code ON cards(set_code);
CREATE INDEX IF NOT EXISTS idx_cards_regulation ON cards(regulation);
CREATE INDEX IF NOT EXISTS idx_cards_card_type ON cards(card_type);
CREATE INDEX IF NOT EXISTS idx_cards_evolution_stage ON cards(evolution_stage);
CREATE INDEX IF NOT EXISTS idx_cards_hp_null ON cards(card_id) WHERE hp IS NULL;

-- ワザ
CREATE TABLE IF NOT EXISTS waza (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES cards(card_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_clean TEXT,
  damage INTEGER,
  damage_modifier TEXT,
  effect TEXT,
  order_index INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_waza_card_id ON waza(card_id);

-- ワザのエネルギーコスト
CREATE TABLE IF NOT EXISTS waza_energy_cost (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  waza_id INTEGER NOT NULL REFERENCES waza(id) ON DELETE CASCADE,
  energy_type TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_waza_energy_cost_waza_id ON waza_energy_cost(waza_id);

-- 特性
CREATE TABLE IF NOT EXISTS abilities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES cards(card_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  effect TEXT,
  order_index INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_abilities_card_id ON abilities(card_id);

-- カードIDマッピング
CREATE TABLE IF NOT EXISTS card_id_mapping (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  base_card_id TEXT NOT NULL,
  variant_card_id TEXT NOT NULL,
  regulation TEXT,
  relationship TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_card_id_mapping_base ON card_id_mapping(base_card_id);
CREATE INDEX IF NOT EXISTS idx_card_id_mapping_variant ON card_id_mapping(variant_card_id);

-- 収集ログ
CREATE TABLE IF NOT EXISTS collection_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT,
  status TEXT NOT NULL,
  source TEXT,
  error_message TEXT,
  processing_time_ms INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_collection_logs_status ON collection_logs(status);
CREATE INDEX IF NOT EXISTS idx_collection_logs_created_at ON collection_logs(created_at);
