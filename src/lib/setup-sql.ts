// ── Supabase セットアップ SQL（アプリ内の「SQLをコピー」ボタン共通ソース） ──────
// SecuritySetup.tsx と settings/page.tsx の両方がここからインポートする。
// SQL を修正する場合はこのファイルのみ変更すること。

export const SUPABASE_FORMAT_SQL = `-- ============================================================
-- あんべの名刺代わり — DB フォーマット SQL
-- ⚠️ 全データが削除されます。実行前に必ずバックアップを確認してください。
-- Supabase Dashboard > SQL Editor に貼り付けて実行してください
-- ============================================================

-- テーブルを CASCADE で削除（トリガーも一緒に削除される）
DROP TABLE IF EXISTS categories     CASCADE;
DROP TABLE IF EXISTS business_cards CASCADE;
DROP TABLE IF EXISTS user_vault     CASCADE;

-- テーブル削除後に関数を削除
DROP FUNCTION IF EXISTS update_updated_at() CASCADE;

SELECT 'フォーマット完了。次にセットアップ SQL を実行してください。' AS status;`

export const SUPABASE_SETUP_SQL = `-- ============================================================
-- あんべの名刺代わり — Supabase 初期セットアップ SQL v6.1
-- Supabase Dashboard > SQL Editor に貼り付けて実行してください
-- ============================================================

-- ① user_vault テーブル（認証・暗号鍵管理）
CREATE TABLE IF NOT EXISTS user_vault (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email             TEXT NOT NULL UNIQUE,
  encryption_salt        TEXT NOT NULL UNIQUE,
  wrapped_data_key_alpha TEXT NOT NULL,
  wrapped_data_key_beta  TEXT NOT NULL,
  vault_generation       INTEGER NOT NULL DEFAULT 1,
  created_at             TIMESTAMPTZ DEFAULT now(),
  updated_at             TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE user_vault ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon full access" ON user_vault
  FOR ALL TO anon USING (true) WITH CHECK (true);
GRANT ALL ON user_vault TO anon;

-- ② business_cards テーブル（名刺データ）
CREATE TABLE IF NOT EXISTS business_cards (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encrypted_data            TEXT NOT NULL,
  encrypted_thumbnail_front TEXT,
  encrypted_thumbnail_back  TEXT,
  search_hashes             TEXT[] NOT NULL DEFAULT '{}',
  industry_category         TEXT,
  card_category             TEXT,
  attributes                JSONB NOT NULL DEFAULT '{}',
  notes                     TEXT,
  ocr_raw_text              TEXT,
  encryption_salt           TEXT NOT NULL,
  encryption_key_id         TEXT NOT NULL DEFAULT 'v1',
  created_at                TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at                TIMESTAMPTZ DEFAULT now() NOT NULL,
  scanned_at                TIMESTAMPTZ,
  ocr_confidence            FLOAT,
  thank_you_sent            BOOLEAN NOT NULL DEFAULT false,
  thank_you_sent_at         TIMESTAMPTZ
);
ALTER TABLE business_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon full access" ON business_cards
  FOR ALL TO anon USING (true) WITH CHECK (true);
GRANT ALL ON business_cards TO anon;

CREATE INDEX IF NOT EXISTS idx_bc_encryption_salt ON business_cards (encryption_salt);
CREATE INDEX IF NOT EXISTS idx_bc_created_at      ON business_cards (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bc_search_hashes   ON business_cards USING GIN (search_hashes);
CREATE INDEX IF NOT EXISTS idx_bc_card_category   ON business_cards (card_category);
CREATE INDEX IF NOT EXISTS idx_bc_industry        ON business_cards (industry_category);

-- ③ categories テーブル（ユーザー定義カテゴリ）
CREATE TABLE IF NOT EXISTS categories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encryption_salt TEXT NOT NULL,
  name            TEXT NOT NULL,
  color_index     INT NOT NULL DEFAULT 0,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon full access"       ON categories FOR ALL    TO anon USING (true) WITH CHECK (true);
CREATE POLICY "protect system-default" ON categories FOR DELETE TO anon USING (id::text != 'system-default');
GRANT ALL ON categories TO anon;

CREATE INDEX IF NOT EXISTS idx_categories_encryption_salt ON categories (encryption_salt);

-- ④ updated_at 自動更新トリガー
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

SELECT 'あんべの名刺代わり — セットアップ完了！' AS status;`
