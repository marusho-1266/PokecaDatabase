-- ポケモンカードデータベース PostgreSQLスキーマ
-- docs/データベース構築計画.md に基づく

-- 基本カード情報
CREATE TABLE IF NOT EXISTS cards (
  card_id VARCHAR(5) PRIMARY KEY,
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
  weakness TEXT,                            -- 弱点表示用（例: "雷×2"）。弱点なしは "--"
  weakness_type TEXT,                      -- 弱点タイプ（energy_type と同様: lightning/fighting/...）
  weakness_value TEXT,                     -- 弱点倍率（例: "×2"）
  resistance TEXT,                         -- 抵抗力表示用（例: "闘－30"）。なしは "--"
  resistance_type TEXT,                    -- 抵抗力タイプ（energy_type と同様）
  resistance_value TEXT,                   -- 抵抗力数値（例: "-30"）
  retreat_cost INTEGER,
  set_code TEXT,
  set_name TEXT,
  regulation TEXT,
  card_number TEXT,
  rarity TEXT,
  illustrator TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_verified_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cards_name ON cards(name);
CREATE INDEX IF NOT EXISTS idx_cards_category ON cards(category);
CREATE INDEX IF NOT EXISTS idx_cards_set_code ON cards(set_code);
CREATE INDEX IF NOT EXISTS idx_cards_regulation ON cards(regulation);
CREATE INDEX IF NOT EXISTS idx_cards_card_type ON cards(card_type);
CREATE INDEX IF NOT EXISTS idx_cards_evolution_stage ON cards(evolution_stage);
CREATE INDEX IF NOT EXISTS idx_cards_hp_null ON cards(card_id) WHERE hp IS NULL;
-- 全文検索用（日本語は 'simple' で）
CREATE INDEX IF NOT EXISTS idx_cards_fulltext ON cards USING GIN(to_tsvector('simple', COALESCE(name,'') || ' ' || COALESCE(full_name,'')));

-- ワザ（damage_modifier: ダメージ表記の付加記号。＋＝追加ダメージ、×＝倍率）
CREATE TABLE IF NOT EXISTS waza (
  id SERIAL PRIMARY KEY,
  card_id VARCHAR(5) NOT NULL REFERENCES cards(card_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_clean TEXT,
  damage INTEGER,
  damage_modifier TEXT,  -- 'plus'（＋）, 'times'（×）, NULL
  effect TEXT,
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_waza_card_id ON waza(card_id);

-- ワザのエネルギーコスト
CREATE TABLE IF NOT EXISTS waza_energy_cost (
  id SERIAL PRIMARY KEY,
  waza_id INTEGER NOT NULL REFERENCES waza(id) ON DELETE CASCADE,
  energy_type TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_waza_energy_cost_waza_id ON waza_energy_cost(waza_id);

-- 特性（将来用・現状は未収集）
CREATE TABLE IF NOT EXISTS abilities (
  id SERIAL PRIMARY KEY,
  card_id VARCHAR(5) NOT NULL REFERENCES cards(card_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  effect TEXT,
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_abilities_card_id ON abilities(card_id);

-- カードIDマッピング（複数レギュレーション用）
CREATE TABLE IF NOT EXISTS card_id_mapping (
  id SERIAL PRIMARY KEY,
  base_card_id VARCHAR(5) NOT NULL,
  variant_card_id VARCHAR(5) NOT NULL,
  regulation TEXT,
  relationship TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_card_id_mapping_base ON card_id_mapping(base_card_id);
CREATE INDEX IF NOT EXISTS idx_card_id_mapping_variant ON card_id_mapping(variant_card_id);

-- 収集ログ
CREATE TABLE IF NOT EXISTS collection_logs (
  id SERIAL PRIMARY KEY,
  card_id VARCHAR(5),
  status TEXT NOT NULL,
  source TEXT,
  error_message TEXT,
  processing_time_ms INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_collection_logs_status ON collection_logs(status);
CREATE INDEX IF NOT EXISTS idx_collection_logs_created_at ON collection_logs(created_at);
