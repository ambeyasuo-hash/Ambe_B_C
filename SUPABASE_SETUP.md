# Supabase セットアップ手順（Phase 1）

このドキュメントは、あんべの名刺代わり v6.0.3 のために Supabase を初期化する手順を説明します。

## 前提条件

- Supabase アカウント作成済み
- プロジェクト作成済み
- Supabase Dashboard にアクセス可能

## セットアップ手順

### ステップ 1: SQL ファイルの準備

プロジェクトルートの `supabase_init_setup.sql` ファイルを開きます。

### ステップ 2: SQL Editor を開く

Supabase Dashboard にログインし、以下の手順で SQL Editor を開きます：

1. サイドバー左側の **SQL Editor** をクリック
2. **+ New Query** ボタンをクリック
3. または直接: `https://supabase.com/dashboard/project/_/sql/new`

### ステップ 3: SQL を貼り付けて実行

1. `supabase_init_setup.sql` の内容全体をコピー
2. SQL Editor の入力欄に貼り付け
3. **Run** ボタン（▶️）をクリック
4. 実行結果に「あんべの名刺代わり — セットアップ完了！」と表示されることを確認

## 作成されるテーブルとポリシー

### テーブル一覧

| テーブル名 | 目的 | 主要カラム |
|---|---|---|
| `user_vault` | ユーザーの暗号化設定保管 | encryption_salt, wrapped_data_key_alpha, wrapped_data_key_beta |
| `business_cards` | 暗号化名刺データ | encrypted_data, encrypted_thumbnail_*, search_hashes, card_category |
| `categories` | ユーザーカスタムカテゴリ | id, name, color_index, sort_order |

### RLS ポリシー

- **user_vault**: `anon` が完全アクセス（匿名利用を想定）
- **categories**: `anon` がアクセス可能、`system-default` は DELETE 保護

### 自動トリガー

- **trg_business_cards_updated_at**: business_cards 更新時に `updated_at` を自動更新
- **trg_user_vault_updated_at**: user_vault 更新時に `updated_at` を自動更新

## 検証

セットアップ完了後、以下を確認してください：

### テーブルの確認

1. Supabase Dashboard → **Tables** セクション
2. 以下の3つが表示されていることを確認：
   - `user_vault`
   - `business_cards`
   - `categories`

### system-default カテゴリの確認

以下の SQL を SQL Editor で実行してください：

```sql
SELECT * FROM categories WHERE id = 'system-default';
```

結果として、以下のようなレコードが返されることを確認：
- `id`: 'system-default'
- `name`: '未分類'
- `color_index`: 0
- `sort_order`: 0

### RLS ポリシーの確認

1. Supabase Dashboard → 各テーブル → **Policies** タブ
2. 以下のポリシーが存在することを確認：
   - `user_vault`: "anon full access"
   - `categories`: "anon full access (non-delete)" および "protect system-default category"

## トラブルシューティング

### エラー: "テーブルが既に存在する"

→ `CREATE TABLE IF NOT EXISTS` を使用しているため、再実行しても安全です。

### エラー: "列が既に存在する"

→ 既にセットアップ済みの環境への再実行の場合、このエラーは無視できます。

### system-default が見つからない

→ 以下の SQL で手動 INSERT を実行してください（encryption_salt は実際の値に置き換え）：

```sql
INSERT INTO categories (id, encryption_salt, name, color_index, sort_order)
VALUES ('system-default', 'YOUR_ENCRYPTION_SALT', '未分類', 0, 0)
ON CONFLICT (id) DO NOTHING;
```

## 次のステップ

セットアップ完了後：

1. `.env.local.example` の環境変数テンプレートを確認
2. Phase 2（Shell）の実装に進みます

---

**ドキュメント**: design_doc_v6_0_3.md Section 7.5
**最終更新**: 2026-04-21
