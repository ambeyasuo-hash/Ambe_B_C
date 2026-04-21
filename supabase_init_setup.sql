-- ============================================================
-- あんべの名刺代わり — Supabase 初期セットアップ SQL
-- Supabase Dashboard > SQL Editor に貼り付けて実行してください
-- ============================================================

-- ① user_vault テーブル（認証・暗号鍵管理）
CREATE TABLE IF NOT EXISTS user_vault (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encryption_salt         TEXT NOT NULL UNIQUE,
  wrapped_data_key_alpha  TEXT NOT NULL,
  wrapped_data_key_beta   TEXT NOT NULL,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_vault ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon full access" ON user_vault
  FOR ALL TO anon USING (true) WITH CHECK (true);

GRANT ALL ON user_vault TO anon;

-- ② business_cards テーブル（名刺データ）
CREATE TABLE IF NOT EXISTS business_cards (
  -- Primary
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- [E2EE Zone] 復号鍵なしでは読めない
  encrypted_data           TEXT NOT NULL,
  encrypted_thumbnail_front TEXT,
  encrypted_thumbnail_back  TEXT,

  -- [Search Zone] Blind Indexing
  search_hashes            TEXT[] NOT NULL DEFAULT '{}',

  -- [Analytics Zone] 平文・統計用
  industry_category        TEXT,
  card_category            TEXT,
  attributes               JSONB NOT NULL DEFAULT '{}',
  notes                    TEXT,
  ocr_raw_text             TEXT,

  -- [Security]
  encryption_salt          TEXT NOT NULL,
  encryption_key_id        TEXT NOT NULL DEFAULT 'v1',

  -- [Metadata]
  created_at               TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at               TIMESTAMPTZ DEFAULT now() NOT NULL,
  scanned_at               TIMESTAMPTZ,
  ocr_confidence           FLOAT,
  thank_you_sent           BOOLEAN NOT NULL DEFAULT false,
  thank_you_sent_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bc_encryption_salt
  ON business_cards (encryption_salt);
CREATE INDEX IF NOT EXISTS idx_bc_created_at
  ON business_cards (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bc_search_hashes
  ON business_cards USING GIN (search_hashes);
CREATE INDEX IF NOT EXISTS idx_bc_card_category
  ON business_cards (card_category);
CREATE INDEX IF NOT EXISTS idx_bc_industry
  ON business_cards (industry_category);

-- ③ categories テーブル（ユーザー定義カテゴリ）
CREATE TABLE IF NOT EXISTS categories (
  id              TEXT PRIMARY KEY,
  encryption_salt TEXT NOT NULL,
  name            TEXT NOT NULL,
  color_index     INT NOT NULL DEFAULT 0,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_categories_encryption_salt
  ON categories (encryption_salt);

-- ④ categories テーブル RLS ポリシー（system-default 保護）
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon full access (non-delete)" ON categories
  FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE POLICY "protect system-default category" ON categories
  FOR DELETE TO anon
  USING (id != 'system-default');

GRANT ALL ON categories TO anon;

-- ⑤ updated_at 自動更新トリガー
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_business_cards_updated_at
  BEFORE UPDATE ON business_cards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER trg_user_vault_updated_at
  BEFORE UPDATE ON user_vault
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ⑥ 完了メッセージ
SELECT 'あんべの名刺代わり — セットアップ完了！' AS status;
