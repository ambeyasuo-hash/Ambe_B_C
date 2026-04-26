# あんべの名刺代わり — 取扱説明書

> バージョン v6.2.1 対応 / 最終更新: 2026-04-26

---

## 目次

1. [このアプリについて](#1-このアプリについて)
2. [セットアップ前の準備（外部サービス登録）](#2-セットアップ前の準備外部サービス登録)
3. [初回セットアップ（新規）](#3-初回セットアップ新規)
4. [名刺のスキャン方法](#4-名刺のスキャン方法)
5. [名刺詳細の見かた・編集](#5-名刺詳細の見かた編集)
6. [お礼メールの作成](#6-お礼メールの作成)
7. [別端末への引き継ぎ](#7-別端末への引き継ぎ)
8. [バックアップと復旧](#8-バックアップと復旧)
9. [よくある質問（FAQ）](#9-よくある質問faq)
10. [セキュリティモデルについて](#10-セキュリティモデルについて)

---

## 1. このアプリについて

**あんべの名刺代わり** は、名刺情報を完全暗号化（Zero-Knowledge）で管理する名刺 DX アプリです。

### 主な特徴

- **完全 E2EE**: 名前・会社名・電話番号などの個人情報は端末上で暗号化され、サーバーには一切の平文が保存されません
- **BYOS / BYOK（自分でクラウドを持ち込む）**: ご自身の Supabase・Azure・Gemini アカウントを使います。開発者はあなたのデータを覗くことができません
- **AI OCR**: Azure AI で名刺を自動読み取り。部署・役職・フリガナも自動抽出します
- **AI メール作成**: Gemini でお礼メールのドラフトを自動生成します（PII は Gemini に送信しません）

---

## 2. セットアップ前の準備（外部サービス登録）

初回セットアップには以下の 3 つのアカウントが必要です。  
すべて無料枠で利用できます。

### 2-1. Supabase（データ保管）

1. [https://supabase.com](https://supabase.com) にアクセスし、アカウントを作成
2. 「New Project」でプロジェクトを作成（リージョンは **Northeast Asia (Tokyo)** 推奨）
3. Settings → API ページを開く
4. 以下の 2 つをメモする:
   - **Project URL** — `https://xxxxxxxxxx.supabase.co` の形式
   - **anon public key** — `eyJh...` で始まる長い文字列
5. SQL Editor を開き、以下の SQL を貼り付けて **Run** を押す（テーブル作成）:

```sql
-- user_vault テーブル
CREATE TABLE IF NOT EXISTS user_vault (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT UNIQUE NOT NULL,
  encryption_salt TEXT NOT NULL,
  wrapped_data_key_alpha TEXT NOT NULL,
  wrapped_data_key_pin TEXT NOT NULL,
  wrapped_data_key_beta TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- business_cards テーブル
CREATE TABLE IF NOT EXISTS business_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encryption_salt TEXT NOT NULL,
  encrypted_data TEXT NOT NULL,
  encrypted_thumbnail_front TEXT,
  encrypted_thumbnail_back TEXT,
  search_hashes TEXT[],
  card_category TEXT,
  industry_category TEXT,
  notes TEXT,
  ocr_raw_text TEXT,
  ocr_confidence FLOAT,
  thank_you_sent BOOLEAN DEFAULT false,
  thank_you_sent_at TIMESTAMPTZ,
  scanned_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- categories テーブル
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encryption_salt TEXT NOT NULL,
  name TEXT NOT NULL,
  color_index INT DEFAULT 0,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- qr_transfers テーブル（QR 引き継ぎ用）
CREATE TABLE IF NOT EXISTS qr_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT UNIQUE NOT NULL,
  encrypted_payload TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

> **注意**: SQL の実行に失敗した場合は、Supabase のダッシュボードで Row Level Security（RLS）が有効になっていないか確認してください。このアプリでは RLS を使わず `encryption_salt` によるデータ分離を行います。

### 2-2. Azure AI Services（OCR）

1. [https://portal.azure.com](https://portal.azure.com) にアクセスし、Microsoft アカウントでログイン
  Azureアカウントを作成するために初回にクレジットカードもしくはデビッドカードの登録が必要です。
2. 「リソースの作成」→「AI + Machine Learning」→「Document Intelligence」を選択
3. 以下の設定でリソースを作成:
   - **価格レベル**: F0（無料）推奨
   - **リージョン**: Japan East 推奨
4. リソース作成後、「キーとエンドポイント」を開く
5. 以下の 2 つをメモする:
   - **エンドポイント** — `https://xxxxxxxx.cognitiveservices.azure.com/` の形式
   - **キー 1** — 32 文字の英数字

> **無料枠**: F0 プランは月 500 ページまで無料。名刺スキャンは 1 枚 2 ページ（表面・裏面）消費します。

### 2-3. Google Gemini（AI メール作成）

1. [https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) にアクセス
2. 「APIキーを作成」をクリック
3. 表示された APIキー（`AIza...` で始まる文字列）をメモする

> Gemini は任意です。キーを入力しない場合もスキャン・検索機能は利用できます。

---

## 3. 初回セットアップ（新規）

1. アプリのトップ画面で **「🆕 新規セットアップ」** をタップ
2. **メールアドレス** を入力（ログインには使わず、データ紐付けに使います）
3. **Supabase URL** と **Supabase Anon Key** を入力して「接続テスト」
4. **Azure エンドポイント** と **Azure Key** を入力
5. **Gemini API Key** を入力（任意）
6. **PIN（6 桁）** を 2 回入力して設定
7. **生体認証** の登録（Face ID / 指紋 / Windows Hello）— スキップ可
8. **24 単語バックアップ** が表示されます。**紙に書き写して安全な場所に保管してください**（これがすべての復旧の最終手段です）
9. セットアップ完了 → 名刺一覧画面へ

---

## 4. 名刺のスキャン方法

1. 下部ナビの **📷 スキャン** をタップ
2. カメラが起動したら、名刺の向きを選択:
   - **縦の名刺**: そのまま縦向きに撮影
   - **横・左が上**: 名刺の左端を上にしてスマホを縦に持って撮影
   - **横・右が上**: 名刺の右端を上にしてスマホを縦に持って撮影
3. 白い枠（フレーム）に名刺を合わせて **シャッターボタン** をタップ
4. 表面の解析が完了したら、裏面もスキャンするか選択
5. **確認画面** で OCR 結果を確認・編集:
   - 氏名を入力するとフリガナが自動入力されます
   - 名刺にローマ字読みが印字されている場合も自動でカタカナ変換します
   - 名刺交換場所が自動取得されます（許可した場合）
   - カテゴリを選択（または新規作成）
6. **「保存する」** をタップ

---

## 5. 名刺詳細の見かた・編集

### 閲覧モード

- 各フィールドの **「コピー」** ボタンでクリップボードにコピー
- **「初回名刺交換場所」** には Google Maps リンクが表示されます

### 編集モード

右上の **「✏️ 編集」** をタップすると編集モードになります:

- 全フィールド（氏名・フリガナ・会社名・**部署**・役職・メール・電話・携帯・住所）を編集可能
- **氏名フィールドを入力してフォーカスを外す**と、フリガナが自動入力されます
  - ローマ字 → カタカナ変換（辞書不要）
  - 漢字 → Gemini API で読み仮名取得（Gemini キー設定時のみ）
- 名刺交換場所の地名を編集可能
- 「座標を修正 ▾」で緯度・経度を手動修正できます（修正後に地名が再取得されます）
- **カテゴリ** を選択可能（チップ選択 UI）

---

## 6. お礼メールの作成

1. 名刺詳細画面の下部「お礼メール」セクションを開く
2. **「✉️ お礼メールを作成」** をタップ
3. Gemini がお礼メールのドラフトを生成します（数秒かかります）
4. 生成されたメールを確認・編集
5. **「メールアプリで開く」** または **「コピー」** でメールを送信
6. 送信後は **「✓ 送信済みにする」** をタップ（一覧から ✉️ アイコンが消えます）

> **プライバシー**: Gemini に送信されるのは業界・役職などの非個人情報のみです。氏名・会社名はサニタイズ処理後にプロンプトに含まれますが、Gemini はデータを学習・保持しません。

---

## 7. 別端末への引き継ぎ

### QR コードで引き継ぐ（推奨）

**旧端末での操作:**
1. 設定画面 → 「QR で引き継ぐ」をタップ
2. 6 桁のペアリング PIN が表示される

**新端末での操作:**
1. トップ画面 → 「📱 別端末からQRで引き継ぐ」をタップ
2. 旧端末の QR コードをスキャン
3. 旧端末に表示された 6 桁の PIN を入力
4. 新しい PIN を設定
5. 生体認証を登録（任意）

### .ambe ファイルで引き継ぐ

1. 旧端末の設定画面 → 「.ambe ファイルをエクスポート」
2. ファイルを新端末に転送（AirDrop / メール / クラウドストレージ）
3. 新端末のトップ画面 → 「📁 .ambeファイルで復元」
4. ファイルを選択し、PIN を入力

---

## 8. バックアップと復旧

### 24 単語バックアップ

初回セットアップ時に表示された 24 単語は **マスター復旧キー** です。

- 紙に書き写して安全な場所に保管
- デジタルデータとしての保存は非推奨（写真・テキストファイル等）
- 紛失すると復旧できません

### 24 単語で復旧する手順

1. トップ画面 → 「🔑 24単語で復旧」をタップ
2. 24 単語を入力
3. メールアドレスを入力（Supabase のデータ検索に使います）
4. Supabase URL と Anon Key を入力
5. 「次へ」をタップ
6. 新しい PIN を設定
7. 復旧完了 → 名刺データが復元されます

### 24 単語の再生成

設定画面の「24 単語バックアップを再生成」から新しい 24 単語を生成できます。  
再生成後は **古い 24 単語は使えなくなります**。必ず新しい 24 単語を書き直してください。

---

## 9. よくある質問（FAQ）

**Q. ログインできなくなった（生体認証が失敗する）**  
A. ロック画面で「PIN でログイン」をタップして PIN を入力してください。PIN も忘れた場合は 24 単語で復旧できます。

**Q. 別のスマホに買い替えた**  
A. QR コードまたは .ambe ファイルで引き継いでください（Section 7 参照）。

**Q. Supabase の無料枠が切れた**  
A. Supabase は 2 週間アクティビティがないとデータベースが停止します。設定画面の「Supabase 接続テスト」を定期的に実行するか、GitHub Actions による自動 keep-alive を設定してください。

**Q. OCR の精度が低い**  
A. 以下をお試しください:
- 明るい場所でスキャン
- 名刺をフレームにできるだけ合わせる
- 確認画面で手動修正して保存

**Q. フリガナが正しくない**  
A. 確認画面・詳細編集画面でフリガナフィールドを直接編集できます。

**Q. データを完全に消去したい**  
A. 設定画面の「アカウントをリセット」で端末上のデータをすべて削除できます。Supabase 上のデータを削除するには、Supabase ダッシュボードから該当テーブルのレコードを削除してください。

---

## 10. セキュリティモデルについて

### Zero-Knowledge とは

このアプリでは、名前・電話番号・メールアドレスなどの個人情報（PII）は端末上で **AES-256-GCM** によって暗号化されてからサーバーに送信されます。サーバー（Supabase）に保存されるのは暗号化済みのデータのみであり、開発者を含む第三者は平文を閲覧できません。

### 復号鍵の管理

| 鍵の種類 | 保存場所 | 用途 |
|---|---|---|
| Data Key | JS メモリ（セッション中のみ） | PII の暗号化・復号 |
| 生体認証で保護された鍵 | 端末の localStorage | ロック解除 |
| PIN で保護された鍵 | 端末の localStorage / .ambeファイル | ロック解除・引き継ぎ |
| 24 単語由来の鍵 | Supabase（wrapped） | 最終復旧 |

### セッションについて

アンロック状態（UNLOCKED）は **15 分の無操作** でタイムアウトし、再度認証が必要になります。  
タブを閉じるとメモリ上の Data Key は消え、自動的にロック状態に戻ります。

---

*© 2026 ambe / あんべの名刺代わり v6.2.1*
