# あんべの名刺代わり — Design Document v6.2.1
# Phoenix Rebuild Edition (Config-as-Credential Architecture)

**発行日**: 2026-04-26  
**ステータス**: Phase 3〜9 実装進行中（認証・スキャン・設定確定済み）  
**前版**: v6.2.0

---

## 変更履歴

| バージョン | 日付 | 主な変更 |
|---|---|---|
| v6.2.1 | 2026-04-26 | **位置情報・ジオコーディング・カテゴリ編集確定**。スキャン確認画面に位置情報カード（地名・座標・Maps リンク）を常時表示。Nominatim（OpenStreetMap）で逆ジオコーディングし地名を自動取得。地名は編集可能。座標は「座標を修正 ▾」トグルで lat/lng 数値入力により手動修正可能（`onBlur` で再ジオコーディング）。名刺詳細画面でも同様の位置情報・座標修正 UI を実装。PII JSON に `scanned_lat` / `scanned_lng` / `scanned_accuracy` / `scanned_location_name` を追加（Section 9.13）。名刺詳細の編集モードでカテゴリ変更を可能に（チップ選択 UI）。空欄フィールドも "—" で常時表示（非表示にしない）。お礼メール Gemini プロンプト改善（プレースホルダー排除・相手情報を直接埋め込み）。24 単語リカバリを email ベース検索に変更（mnemonic 再生成後も復旧可能）。共有 geocode ユーティリティを `src/lib/geocode.ts` に抽出。 |
| v6.2.0 | 2026-04-26 | **認証フロー確定・OCR拡張・カメラ仕様確定**。LockScreen の `canUseBiometric` を `hasRegisteredCredential()` のみに変更（alpha bundle 有無チェックを削除、PRF upgrade フロー安定化）。QRインポート後の生体認証再登録 → 動作確定。設定画面に24単語バックアップ再生成機能追加。OCR に `mobile` フィールド追加（080/090/070/050 検出）。カメラ常時縦フレーム＋3択向きトグル（縦/横・左上/横・右上）確定。furigana フィールド確定（cards/scan 双方）。Gemini モデルを `gemini-2.5-flash`（安定版）に更新。UNINITIALIZED 初回選択画面実装確定。StatusBar からシステム時計・バッテリーアイコン削除確定。 |
| v6.1.0 | 2026-04-25 | QR ペアリングを Supabase リレー方式に変更（QR ペイロードサイズ問題を解消）。qr_transfers テーブルを追加。禁止事項の「中継サーバー」を「第三者中継サーバー」に明確化。 |
| v6.0.3 | 2026-04-24 | **Vault 整合性保証（多端末鍵不整合防止）を正式仕様化**。`user_vault` に `user_email UNIQUE` 制約・`vault_generation` カラムを追加。SecuritySetup に Vault 存在確認ステップを必須化。`/api/save-business-card` にサーバーサイドのソルト整合性チェックを追加。クライアントサイドの鍵不整合検出 UI を仕様化。禁止事項に「Vault 存在確認なしの fresh setup」を追加。Config Bundle に `wrapped_data_key_pin` を正式追加（v6.0.3 以降必須）。 |
| v6.0.2 | 2026-04-21 | ホスティング・配布アーキテクチャの確定。Vercel を「土管」モデルに確定（ユーザーキーを環境変数に持たない）。GitHub Actions テンプレートがユーザーの Supabase に直接 ping する方式に統一（CRON_SECRET・Vercel Cron 廃止）。OCRプレビュー・確認・保存フロー（Section 9.11）を新設。お礼メール機能（Section 9.12）を新設。business_cards に `thank_you_sent` / `thank_you_sent_at` カラムを追加。|
| v6.0.1 | 2026-04-21 | 名刺一覧・詳細・スキャン画面の UI 仕様を追加（Section 9.8〜9.10）。カスタムカテゴリ機能・サムネイル表示・スキャン時の向き自動検出を正式仕様化。DB に `card_category` カラムと `categories` テーブルを追加。 |
| v6.0.0 | 2026-04-21 | 認証アーキテクチャを全面刷新（Config-as-Credential モデル導入）。PIN モード復活・必須化。QR ペアリング・.ambe ファイルを正式採用。v5.x 系のマスターキー/Data Key 混在呼称を Data Key に統一。旧 LocalStorage 互換フォールバックを廃止。 |

---

## 1. 製品概要

### 1.1 コンセプト

**「軍用レベルの堅牢性と、隣人に寄り添う優しさの共存」**

サーバー管理者が一切のデータを見ることができない Zero-Knowledge を貫きつつ、ユーザーが認証に迷った際の救済策を備えた名刺 DX プラットフォーム。

### 1.2 ターゲット

プライバシー意識の極めて高い法人・コンサルタント・営業職。

### 1.3 技術的特性

- **Zero-Knowledge**: 平文 PII はサーバーに一切送信しない
- **BYOS / BYOK**: 各ユーザーが自身の Supabase / Azure / Gemini アカウントを持ち込む
- **Searchable Encryption (Blind Indexing)**: 暗号化されたデータに対し、ハッシュ化された索引で高速検索
- **Config-as-Credential**: 接続情報そのものを認証の対象とする（v6.0.0 新概念）
- **Elegant Rescue**: 認証失敗時の救済策として 24 単語リカバリ + .ambe ファイル経路を提供
- **Placeholder-Based AI**: Gemini には非 PII 属性のみを送信

---

## 2. 認証アーキテクチャ (Config-as-Credential Model)

### 2.1 基本思想

本アプリは BYOS / BYOK を前提とするため、「ユーザーをサーバーで認証する」モデルが成立しない。代わりに、

**「ユーザーを認証する」のではなく「Config Bundle を開錠する」**

という発想に転換する。接続情報（Supabase URL/Key, Azure endpoint/key, Gemini key, encryption_salt, wrapped data keys）をひとまとめにした **Config Bundle** を作成し、これを複数の鍵で保護する。

### 2.2 Config Bundle の構成

```json
{
  "v": 1,
  "encryption_salt": "uuid-xxxxxxxx-xxxx-xxxx",
  "ambe_generation": 1,
  "last_exported_at": "2026-04-24T00:00:00Z",
  "supabase": {
    "url": "https://xxx.supabase.co",
    "anon_key": "eyJhbGc..."
  },
  "azure": {
    "endpoint": "https://xxx.cognitiveservices.azure.com/",
    "key": "abc123..."
  },
  "gemini": {
    "key": "AIza..."
  },
  "wrapped_data_key_alpha": "v1:iv:ct...",
  "wrapped_data_key_pin":   "v1:iv:ct...",
  "wrapped_data_key_beta":  "v1:iv:ct...",
  "pin_salt": "hex16bytes...",
  "userEmail": "user@example.com",
  "fontSizePreference": "standard"
}
```

**役割**:

| 項目 | 役割 | 必須 |
|---|---|---|
| `encryption_salt` | Vault 識別子（Supabase の行特定・暗号化ソルト） | ✅ |
| `ambe_generation` | Vault の世代番号（.ambe エクスポートごとに +1） | ✅ |
| `supabase.url/anon_key` | データ保管先 | ✅ |
| `azure.endpoint/key` | OCR 処理 | ✅ |
| `gemini.key` | テンプレート生成 | ⚠️ 任意 |
| `wrapped_data_key_alpha` | WebAuthn PRF 由来鍵で保護された Data Key | ✅ |
| `wrapped_data_key_pin` | PIN/PBKDF2 由来鍵で保護された Data Key（v6.0.3 追加） | ✅ |
| `wrapped_data_key_beta` | 24 単語 BIP-39 由来鍵で保護された Data Key（リカバリ用） | ✅ |
| `pin_salt` | PIN wrapping の PBKDF2 ソルト（.ambe インポート時に必要） | ✅ |
| `userEmail` | Vault 所有者の識別子（Vault 整合性検証にも使用） | ✅ |
| `fontSizePreference` | UX 設定引き継ぎ | ❌ |

### 2.3 鍵の階層

```
┌──────────────────────────────────────────────┐
│  Config Bundle（本アプリの最重要資産）        │
└──────────────────────────────────────────────┘
                  ↓ 複数の鍵で保護
┌──────────────────────────────────────────────┐
│  Level 1a: Device Key (WebAuthn platform)    │
│    → デバイスローカルで Config Bundle を     │
│      暗号化して localStorage に保管          │
│                                               │
│  Level 1b: PIN Key (PBKDF2-SHA256)           │
│    → 生体認証 NG 時のフォールバック          │
│    → .ambe ファイル暗号化にも使用            │
│                                               │
│  Level 1c: Pairing PIN (6 桁・一時的)        │
│    → QR ペアリング時のみ使用                 │
│    → 5 分で失効                              │
│                                               │
│  Level 2: Recovery Mnemonic (BIP-39 24 単語) │
│    → 全滅時の最終リカバリ                    │
│    → 紙で物理保管（ユーザー責任）            │
└──────────────────────────────────────────────┘
                  ↓ Config Bundle を開錠すると
┌──────────────────────────────────────────────┐
│  Data Key (AES-256-GCM)                      │
│  → PII を暗号化する唯一の鍵                  │
│  → UNLOCKED 時のみメモリに存在               │
│  → localStorage / Supabase に平文保存禁止    │
└──────────────────────────────────────────────┘
```

### 2.4 保護方式の保存先

| 保護方式 | 保存先 | 形式 |
|---|---|---|
| 生体認証で暗号化された Config Bundle | localStorage | `config_bundle_wrapped_alpha` |
| PIN で暗号化された Config Bundle | localStorage | `config_bundle_wrapped_pin` |
| PIN で暗号化された Config Bundle (可搬) | `.ambe` ファイル | ユーザー管理 |
| wrapped_data_key_alpha (WebAuthn) | Supabase user_vault + Config Bundle 内 | DB + ファイル |
| wrapped_data_key_beta (24 単語) | Supabase user_vault + Config Bundle 内 | DB + ファイル |
| Recovery Mnemonic (24 単語) | ユーザーの紙・金庫 | 物理 |
| 平文 Data Key | JS メモリ（UNLOCKED 時のみ） | ❌ 永続化禁止 |
| 平文 Config Bundle | JS メモリ（UNLOCKED 時のみ） | ❌ 永続化禁止 |

### 2.5 セッション状態マシン

```
┌──────────────────┐
│  UNINITIALIZED   │ （初回 or 全データクリア後）
└────────┬─────────┘
         │ 初回セットアップ / QR ペアリング / .ambe インポート / 24 単語リカバリ
         ↓
┌──────────────────┐
│     LOCKED       │ ◄───────────────┐
└────────┬─────────┘                  │
         │ 生体認証 or PIN             │
         ↓                             │
┌──────────────────┐                  │
│ AUTHENTICATING   │                  │
└────────┬─────────┘                  │
         │ 成功                         │ 15 分無操作
         ↓                             │ or 明示的ログアウト
┌──────────────────┐                  │
│    UNLOCKED      │──────────────────┘
└──────────────────┘
```

**メモリ管理**:
- Data Key / Config Bundle は JS メモリのみに保持（`CryptoKey` オブジェクトとして Web Crypto API が隔離）
- ページ遷移・タブ閉鎖時は自動的に消える
- 明示的ログアウト時はメモリを能動的にクリア

### 2.6 Vault 整合性保証（多端末鍵不整合防止）

#### 問題の本質

複数端末が **異なる `encryption_salt` と異なる Data Key** でデータを保存すると、
「端末 A で保存した名刺は端末 B では暗号のゴミに見える」という致命的な不整合が発生する。

```
【不整合が起きるシナリオ】

端末 A: SecuritySetup 完了 → salt_A / DataKey_A
        → 名刺を暗号化して保存（salt_A, ciphertext_A）

端末 B: SecuritySetup を"fresh"で実行 → salt_B / DataKey_B
        → 名刺を暗号化して保存（salt_B, ciphertext_B）

結果: 端末 A は ciphertext_B を復号できない（鍵が違う）
      端末 B は ciphertext_A を復号できない（鍵が違う）
```

根本原因: **`user_vault` テーブルが同一ユーザーの複数行作成を許していた**（`user_email` に UNIQUE 制約なし）

#### 4 層防衛ライン

```
Layer 1: DB 制約（最強・破られない）
  user_vault.user_email に UNIQUE 制約
  → 同一メールで 2 行目を INSERT しようとすると DB が 409 Conflict で弾く

Layer 2: SecuritySetup での事前チェック（UX）
  API 認証情報入力 (Step 2) → 「次へ」押下時
  → Supabase に SELECT: user_vault WHERE user_email = $email
  → 既存行あり: 「既にVaultがあります。インポートしてください」を表示
               → QR ペアリング / .ambe / 24 単語の選択肢を提示
               → fresh setup をブロック
  → 既存行なし: 通常の fresh setup を継続

Layer 3: 保存 API のソルト整合性チェック（サーバー）
  POST /api/save-business-card 受信時
  → user_vault WHERE user_email = $email AND encryption_salt = $salt を照会
  → 一致しない場合: HTTP 409 を返してデータ保存を物理的に阻止
    エラーメッセージ: "暗号化鍵の不整合: このデバイスの鍵はサーバーに登録されたVaultと一致しません"

Layer 4: クライアントサイド鍵不整合の検出（UX 最終防衛）
  カード一覧ロード時に全件の AES 復号が失敗した場合
  → "KEY_MISMATCH" エラーとして専用の復旧 UI を表示
  → 「このデバイスの暗号鍵がサーバーと一致しません。24単語またはQRペアリングで鍵を同期してください」
  → LockScreen の mnemonic / QR フローへ誘導
  ※ 1 件だけ失敗 = データ破損。全件失敗 = 鍵不整合として区別する。
```

#### vault_generation によるステール書き込み防止

`user_vault` の `vault_generation` カラム（INTEGER, DEFAULT 1）と Config Bundle の `ambe_generation` を同期させる。

保存 API でチェック:
```
リクエストの vault_generation < DB の vault_generation
→ HTTP 409: "古いバージョンのVaultです。最新の端末からQRペアリングで同期してください"
```

端末 A で設定変更（generation 更新）→ 端末 B が古い generation で書き込もうとすると弾く。

#### 原則: 1 ユーザー 1 Vault

- `user_vault.user_email` は `UNIQUE NOT NULL`
- 新デバイス追加は必ず「既存端末からの転送（QR / .ambe / 24単語）」経由
- Fresh setup が許されるのは `user_vault` に該当 `user_email` の行が存在しない場合のみ

---

## 3. 認証フロー詳細

### 3.1 初回セットアップフロー

```
[1] API 情報入力
    ├─ Supabase URL / anon key
    ├─ Azure endpoint / key
    └─ Gemini key (任意)

[1.5] ★ Vault 存在確認チェック（v6.0.3 追加・必須）
    入力された Supabase 認証情報を使い、即座に以下を照会:
      SELECT id FROM user_vault WHERE user_email = $userEmail LIMIT 1
    ┌─ 行あり（既存 Vault が存在する）
    │   → "このメールアドレスには既にVaultが存在します" を表示
    │   → fresh setup を完全ブロック
    │   → 以下の選択肢を提示:
    │       [📱 QR ペアリングで引き継ぐ]
    │       [📁 .ambe ファイルから復元]
    │       [🔑 24単語で復旧]
    │   → 選択されたフローへ遷移（UNINITIALIZED → 各インポートフロー）
    │
    └─ 行なし（新規ユーザー）
        → 通常の fresh setup を継続（以下 [2] へ）

[2] アプリが自動生成
    ├─ encryption_salt: 24単語 mnemonic から HKDF で決定論的に導出
    │    encryption_salt = HKDF(mnemonic_seed, "encryption_salt", 16B)
    │    ※ UUID v4 ではなく mnemonic から導出することで完全全滅時の復元を保証
    ├─ Data Key (AES-256 ランダム)
    └─ Recovery Mnemonic (BIP-39 24 単語)

[3] Config Bundle を組み立て
    wrapped_data_key_alpha / wrapped_data_key_pin / wrapped_data_key_beta を含む
    ambe_generation = 1, pin_salt を含む

[4] 保護方式を設定（両方必須）
    ├─ 生体認証 (WebAuthn platform)
    │  → Device Key で Config Bundle を暗号化
    │  → localStorage['config_bundle_wrapped_alpha']
    │
    └─ PIN (4〜8 桁数字、必須)
       → PBKDF2-SHA256 (100,000 iterations) で wrapping key 導出
       → Config Bundle を暗号化（pin_salt を Bundle 内に埋め込む）
       → localStorage['config_bundle_wrapped_pin']

[5] 24 単語の表示・保管確認
    ├─ 24 単語を画面表示
    ├─ ユーザーが「コピー」「.vcf エクスポート」「メール送信」のいずれかで保管
    └─ 「保管した」チェックボックス
        → localStorage['mnemonic_confirmed'] = '1' をセット
        → バックアップ警告バナーを非表示に

[6] wrapped_data_key_alpha / wrapped_data_key_pin / wrapped_data_key_beta を
    Supabase user_vault に保存（user_email / vault_generation も同時に保存）

[7] Data Key をメモリへロード → UNLOCKED
```

**重要**:
- PIN は **必須**（生体認証非対応環境・失敗時の唯一のフォールバック）
- 24 単語の確認は強制しないが、バックアップ完了までは設定画面に警告バナーを出す
- WebAuthn の `authenticatorAttachment` は `'platform'` に固定（USB/NFC キー不可）

### 3.2 日常起動フロー

```
アプリ起動
  ↓
【LOCKED】
  ↓
保護方式を自動判定（v6.2.0 確定仕様）
  ├─ WebAuthn credential が localStorage にある（hasRegisteredCredential() = true）
  │   → 生体認証ボタンを表示（alpha bundle の有無は問わない）
  │      ↓ タップ → WebAuthn assertion 実行
  │      ┌─ PRF 対応 & alpha bundle あり
  │      │   → loadBundleWithAlpha → unlockWithAlpha → UNLOCKED（最速）
  │      │
  │      ├─ PRF 対応 & alpha bundle なし（生体認証再登録直後など）
  │      │   → PRF key を pendingPrfKey.current に保持
  │      │   → PIN 入力画面へ（「初回のみPINが必要」メッセージ）
  │      │   → PIN 成功後に alpha bundle を作成（PRF upgrade）
  │      │   → 次回以降は生体認証のみでログイン可能
  │      │
  │      └─ PRF 非対応（iOS Safari 等）
  │          → 生体認証は通過 → PIN 入力画面へ
  │
  └─ credential なし（QRインポート直後・別ブラウザ等）
      → 自動で PIN モードで起動（生体認証ボタンを表示しない）
         ↓ PIN 入力
         PBKDF2 で wrapping key 導出
         → Config Bundle 復号（PIN bundle）
         → wrapped_data_key_pin を unwrap
         → Data Key をメモリへ
         → UNLOCKED
         ※ 設定画面「生体認証を再登録」でいつでも生体認証を追加可能

UNLOCKED 後
  ↓
15 分無操作タイマー開始
  ↓
タイマー満了 or 明示的ログアウト
  ↓
【LOCKED】 (メモリから Data Key & Config Bundle をクリア)
```

### 3.3 新デバイス追加フロー（QR ペアリング）

Device A (既存・UNLOCKED 状態) → Device B (新規) へ Config Bundle を安全に転送する。

#### 設計方針（v6.1.0 改訂）

旧方式では暗号化した Config Bundle 全体（〜1,200 バイト）を QR に埋め込んでいたため
QR の密度が高くなりすぎ、端末によっては読み取れない問題が発生した。

v6.1.0 では **暗号文をユーザー自身の Supabase に一時保存**し、
QR には「取得トークン＋salt＋IV＋Supabase URL」のみを入れるリレー方式に変更する。
（リレーサーバーはユーザー自身の Supabase であり BYOS 原則に準拠する）

QR ペイロード例（〜170 文字・Version 3 相当・確実に読める）:
```json
{
  "v": 2,
  "kind": "qr-relay",
  "token": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "salt": "<base64 16B>",
  "iv": "<base64 12B>",
  "url": "https://xxx.supabase.co",
  "exp": "2026-04-25T12:05:00Z"
}
```

セキュリティ特性（旧方式から変化なし）:

- QR だけ、または PIN だけでは復号不可（2 要素必須）
- 5 分で token が失効（Supabase 行を DELETE）
- 中継するのはユーザー自身の Supabase のみ

#### Device A 側

```
設定画面「別の端末に移行」タップ
  ↓
[1] ランダム 6 桁 Pairing PIN 生成（例: 837291）
[2] ランダム salt (16B) + IV (12B) 生成
[3] wrapping_key = PBKDF2(Pairing PIN, salt, 100,000)
[4] ct = AES-256-GCM(Config Bundle JSON, wrapping_key, IV)
[5] token = crypto.randomUUID()
[6] Supabase qr_transfers に INSERT
     { token, ct, iv, expires_at: now + 5min }
[7] QR payload を作成（ct は含まない）
     {
       "v": 2,
       "kind": "qr-relay",
       "token": "<uuid>",
       "salt": "<base64>",
       "iv": "<base64>",
       "url": "<supabase.url>",
       "exp": "<expiresAt>"
     }
[8] QR 画像を画面表示 + 6 桁 PIN を画面に併記
       「スキャン後、PIN: 837291 を入力してください」
       ↓
       5 分カウントダウン → 失効時に qr_transfers の行を DELETE
```

#### Device B 側

```
アプリ起動（初回）
  ↓
「既存の端末から引き継ぐ」タップ
  ↓
[1] カメラ起動 → QR スキャン
[2] QR payload パース → token, salt, iv, url, exp 取得
[3] exp をチェック → 期限切れなら「QRが期限切れです」エラー
[4] payload.url の Supabase から ct を取得
      SELECT ct FROM qr_transfers WHERE token = $token
      → 取得できなければ「QRが無効です」エラー
[5] 画面表示された 6 桁 PIN を入力
[6] wrapping_key = PBKDF2(PIN, salt, 100,000)
[7] Config Bundle = AES-256-GCM-Decrypt(ct, wrapping_key, iv)
[8] qr_transfers の行を DELETE（cleanup）
  ↓
[9] この端末用の新しい PIN salt で Data Key を再ラップ → saveBundleWithPIN
    ※ saveBundleWithAlpha は呼ばない（WebAuthn 未登録のため）
  ↓
[10] Data Key をメモリへロード → UNLOCKED
  ↓
[11] ★ 生体認証のセットアップ（任意・推奨）
    設定画面 → 「生体認証を再登録」
    → WebAuthn 新規登録
    → 次回起動から: 生体認証ボタンが表示される
    → 初回タップ時: 「初回のみPINが必要」→ PIN 入力で PRF upgrade 完了
    → 以降: 生体認証のみでログイン可能
```

### 3.4 .ambe ファイル経由フロー

#### エクスポート（既存端末）

```
設定画面「設定をファイルに書き出す」
  ↓
[1] デバイスラベル入力（任意、例: "iphone"）
[2] PIN 入力（新規・確認）
[3] ランダム salt (16B) + IV (12B) 生成
[4] wrapping_key = PBKDF2(PIN, salt, 100,000)
[5] ct = AES-256-GCM(Config Bundle, wrapping_key, IV)
[6] 世代番号を決定（前回 generation + 1）
[7] ファイル生成
     ambe-config-{deviceLabel}-{YYYYMMDD}-gen{N}.ambe
[8] ダウンロード / 共有ダイアログ
```

#### インポート（新端末）

```
アプリ起動
  ↓
「設定ファイルから復元」タップ
  ↓
[1] .ambe ファイル選択
[2] メタデータ表示
    ├─ 発行日
    ├─ 世代番号
    └─ デバイスラベル
[3] PIN 入力
[4] wrapping_key = PBKDF2(PIN, salt, 100,000)
[5] Config Bundle = AES-256-GCM-Decrypt(ct, wrapping_key, iv)
[6] 復号成功 → この端末でも Config Bundle を保持
  ↓
[7] この端末用の保護方式を新規設定
    ├─ 生体認証（WebAuthn 新規登録）
    └─ PIN（新規設定）
  ↓
[8] Data Key をメモリへロード → UNLOCKED
```

### 3.5 .ambe ファイルの仕様

**ファイル名規則**:
```
ambe-config-{deviceLabel}-{YYYYMMDD}-gen{N}.ambe
例: ambe-config-iphone-20260420-gen1.ambe
    ambe-config-macbook-20260425-gen2.ambe
```

**ファイル内容（平文メタデータ + 暗号化本体）**:
```json
{
  "v": 1,
  "kind": "ambe-config-bundle",
  "generation": 2,
  "createdAt": "2026-04-25T10:30:00Z",
  "deviceLabel": "macbook",
  "previousGeneration": 1,
  "ct": "<base64 AES-GCM 暗号文>",
  "iv": "<base64 12B>",
  "salt": "<base64 16B>",
  "iter": 100000
}
```

**世代管理**:
- 何度でも再発行可能
- 古いファイルも技術的には有効（Zero-Knowledge 原則下で無効化は不可能）
- 世代番号でユーザーが最新かどうかを判別
- エクスポート画面で古いファイルの処分を明示的に警告

### 3.6 緊急リカバリフロー（24 単語）

端末・.ambe ファイル全滅時の最終手段。

```
新端末でアプリ起動
  ↓
「24 単語で復旧」タップ
  ↓
[1] 24 単語入力
[2] deriveWrappingKeyFromMnemonic() で Level 2 wrapping key 導出
  ↓
[3] 分岐
    ├─ [3a] .ambe ファイルがある場合
    │        → .ambe をインポート → PIN で復号 → Config Bundle 復元 → 完了
    │
    └─ [3b] .ambe もない場合（完全全滅）
            ↓
            [3b-1] Supabase URL / anon key を手動再入力
            [3b-2] Azure / Gemini のキーを手動再取得・再入力
            [3b-3] encryption_salt を復元
                   → 24 単語から HKDF で決定論的に導出
                   encryption_salt = HKDF(mnemonic_seed, "encryption_salt", 16B)
            [3b-4] Supabase user_vault から wrapped_data_key_beta を取得
            [3b-5] Data Key を復元 → メモリへ
            [3b-6] 新しい Config Bundle を組み立て
            [3b-7] 生体認証・PIN を新規設定
            [3b-8] UNLOCKED
```

**前提**: `encryption_salt` は 24 単語 mnemonic から決定論的に導出される。これにより紙さえ残っていれば既存 Supabase データへのアクセスを復元できる。

---

## 4. セキュリティ詳細

### 4.1 Azure AI Document Intelligence

- リージョン: Japan East
- 学習・ログ保存: オプトアウト済み法人契約 API を使用
- 画像保持: 解析後の元画像はメモリから即座に抹消、DB に保存しない
- 呼び出し経路: ブラウザから直接ではなく Next.js API Route 経由（CORS 対策）

### 4.2 暗号化仕様

| 用途 | アルゴリズム | パラメータ |
|---|---|---|
| Data Key | AES-256-GCM | IV 12B / Tag 16B |
| Config Bundle 保護 | AES-256-GCM | IV 12B / Tag 16B |
| PIN → wrapping key | PBKDF2-SHA256 | 100,000 iterations / salt 16B |
| Blind Indexing | HMAC-SHA256 | encryption_salt を鍵に使用 |
| Pairing PIN → wrapping key | PBKDF2-SHA256 | 100,000 iterations / salt 16B |

### 4.3 wrapped 値のフォーマット

```
"v1:<iv_base64>:<ciphertext_base64>"
```

v1 はバージョン番号。将来のアルゴリズム変更に備える。

### 4.4 WebAuthn 仕様

- `authenticatorAttachment`: `'platform'` 固定
- `userVerification`: `'required'`
- `residentKey`: `'preferred'`
- 対応認証器: FaceID / Touch ID / Windows Hello / Android Biometric

### 4.5 セッション管理

- UNLOCKED セッション: 15 分無操作で自動ロック
- セッションタイマー表示: UNLOCKED 時に残り時間を UI 右上に表示
- ページリロード・タブ閉鎖: 自動 LOCKED（メモリクリア）

---

## 5. 技術スタック・アーキテクチャ

### 5.1 基本方針：Vercel は「土管」に徹する

本アプリは BYOS / BYOK を前提とするため、**Vercel はユーザーのキーを一切保持しない**。すべての秘密情報はユーザーの Config Bundle 内に留まり、必要な瞬間にのみリクエストに乗せて転送される。

```
【正しい設計】

ユーザーのブラウザ（Config Bundle が UNLOCKED 状態）
  ├─ Azure key をリクエストヘッダーに同梱
  ↓
Vercel /api/ocr（土管）
  ├─ 受け取った Azure key でそのまま Azure に転送
  ├─ キーは Vercel に保存されない
  ↓
Azure AI Document Intelligence
  ├─ OCR 処理
  ↓
Vercel → ブラウザへ結果を返す

【廃止した設計】
  Vercel が AZURE_KEY を環境変数で保持 → 全ユーザーが同じキーを共有（BYOK違反）
```

### 5.2 Frontend

- Next.js 15 / 16 (App Router)
- React 18+
- Tailwind CSS v4
- Framer Motion（アニメーション）

### 5.3 Security / Crypto

- Web Crypto API（AES-GCM, PBKDF2, HMAC）
- WebAuthn API（platform authenticator）
- BIP-39 実装（24 単語生成・検証）
- `jsQR` 等の QR 読み取りライブラリ

### 5.4 Vercel（単一プロジェクト・あんべ管理）

- **一元配信**: 開発者が 1 つの Vercel プロジェクトをデプロイ。全ユーザーが同一 URL を使用
- **ゼロ設定**: ユーザーは Vercel のアカウント作成・デプロイ作業を一切不要
- **OCR 中継（土管）**: Azure OCR の CORS 制限を回避するため `/api/ocr` をプロキシとして利用。ただしキーはリクエストヘッダーからユーザーが動的に注入し、Vercel 側には保存しない
- **環境変数**: Vercel は **一切のユーザーキーを環境変数に持たない**。CRON_SECRET も不要・廃止

### 5.5 Supabase keep-alive（ユーザー側・GitHub Actions テンプレート方式）

Supabase 無料プランの自動停止を防ぐ。**GitHub Actions がユーザーの Supabase に直接 ping** する。Vercel を経由しない。

```
ユーザーの GitHub リポジトリ（テンプレートをコピー）
  └─ Secrets に登録
       ├─ SUPABASE_URL: 自分の Supabase URL
       └─ SUPABASE_ANON_KEY: 自分の anon key
  ↓
GitHub Actions（毎日 0:00 UTC）
  ↓
ユーザー自身の Supabase に直接 SELECT ping
  ↓
自動停止を防止
```

**廃止した設計**:
- `CRON_SECRET` + `APP_URL` を Secrets に登録し GitHub → Vercel → Supabase と経由する方式は廃止
- Vercel 側の `/api/cron/keep-alive` エンドポイントも廃止（不要になる）

**GitHub Actions テンプレート YAML**（`ambe-keep-alive-template` リポジトリに同梱）:

```yaml
name: Supabase Keep-Alive
on:
  schedule:
    - cron: '0 0 * * *'   # 毎日 0:00 UTC
  workflow_dispatch:       # 手動トリガー可
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Ping Supabase directly
        run: |
          curl -X GET "${{ secrets.SUPABASE_URL }}/rest/v1/user_vault?limit=1" \
            -H "apikey: ${{ secrets.SUPABASE_ANON_KEY }}" \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_ANON_KEY }}" \
            --fail --silent --show-error
          echo "Supabase ping OK"
```

**ユーザーのセットアップ手順**（アプリ内の設定画面でガイド）:
1. `ambe-keep-alive-template` を GitHub で「Use this template」でコピー
2. 自分のリポジトリの Settings → Secrets → Actions に登録:
   - `SUPABASE_URL`: 自分の Supabase URL
   - `SUPABASE_ANON_KEY`: 自分の anon key
3. アプリの設定画面で「疎通テスト」を実行
4. 完了

**UI 表示**（設定画面の「Supabase 生存維持」セクション）:
- 未設定 → 「GitHub Actions を設定する」手順を折りたたみ表示
- 設定済み → 「✓ 生存維持 有効」バッジ（ユーザーが手動で確認チェック）

### 5.6 Cloud Services（BYOK）

- Supabase (PostgreSQL + RLS)
- Azure AI Document Intelligence（`@azure/ai-form-recognizer` / CORS回避のためVercel API Route経由・キーは動的注入）
- Google Gemini（モデル: `gemini-2.5-flash` 安定版・非 PII テンプレート生成のみ・キーは動的注入）

**スケーラビリティ**: Vercel はステートレスな中継のみを担当。データは各ユーザーの Supabase に直接格納されるため、無料枠内でも多人数利用が可能。

---

## 6. OCR / 検索パイプライン

### 6.1 Two-Phase OCR

```
撮影 → Next.js API Route → Azure AI Document Intelligence
  表面: prebuilt-businessCard → {name, furigana, company, title, email, tel, mobile, address}
        ※ name: cleanNameField() で「株式会社〇〇」混入・部署名混入を除去
        ※ furigana: カタカナ/ひらがなのみの行から自動検出
        ※ mobile: 080/090/070/050 プレフィックスを tel と分離して検出
        ※ rawText fallback: parseRawTextFallback() で構造化失敗時を補完
  裏面: prebuilt-read   → 全文テキスト → notes カラムへ
```

### 6.2 クライアント側処理

```
[1] Azure OCR 結果を受信
[2] normalize.ts でノイズ除去
    - 企業名から「株式会社」等を除去
    - 検索用単語に分割
[3] 暗号化
    - PII 全体を AES-256-GCM で一括暗号化 → encrypted_data
    - サムネイルを暗号化 → encrypted_thumbnail
[4] Blind Indexing
    - 名字・名前・社名を HMAC-SHA256 で個別ハッシュ化 → search_hashes (TEXT[])
[5] 非 PII 属性を抽出
    - 業界カテゴリ → industry_category (平文)
[6] Supabase へ POST
```

### 6.3 AI テンプレート生成（Placeholder-Based）

- Gemini には業界・役職等の**非 PII 属性のみ**送信
- 返却された `{{氏名}}` 入りテンプレートをブラウザ側で実データと結合

---

## 7. データ設計（Supabase）

### 7.1 business_cards テーブル

**[E2EE Zone]**（復号鍵が必須）
| カラム | 型 | 説明 |
|---|---|---|
| `encrypted_data` | TEXT | PII 一括暗号化 JSON（スキーマは下記参照） |
| `encrypted_thumbnail_front` | TEXT | 表面サムネイル（AES-256-GCM 暗号化済み Base64） |
| `encrypted_thumbnail_back` | TEXT | 裏面サムネイル（AES-256-GCM 暗号化済み Base64）。裏面スキャンなしの場合は NULL |

**`encrypted_data` 内 PII JSON スキーマ（v6.2.1）**:
```json
{
  "name":                  "string",
  "furigana":              "string",
  "company":               "string",
  "title":                 "string",
  "email":                 "string",
  "tel":                   "string",
  "mobile":                "string",
  "address":               "string",
  "scanned_lat":           "number | undefined",
  "scanned_lng":           "number | undefined",
  "scanned_accuracy":      "number | undefined",
  "scanned_location_name": "string | undefined"
}
```

- `scanned_lat` / `scanned_lng`: スキャン時の GPS 座標（WGS-84 十進度）。位置情報が取得できなかった場合は省略。
- `scanned_accuracy`: GPS 精度（メートル）。
- `scanned_location_name`: Nominatim 逆ジオコーディングで取得した地名（都道府県 + 市区町村 + 地域）、またはユーザーが手動で修正した地名。未取得・未設定の場合は省略。
- 座標はユーザーが詳細画面の編集モードから手動修正可能（修正時に再ジオコーディングを実行）。

**[Search Zone]**（盲目的索引）
| カラム | 型 | 説明 |
|---|---|---|
| `search_hashes` | TEXT[] | 名字・名前・社名の HMAC-SHA256 配列 |

**[Analytics Zone]**（統計用平文）
| カラム | 型 | 説明 |
|---|---|---|
| `industry_category` | TEXT | 業界（IT、製造等） |
| `card_category` | TEXT | ユーザー定義カテゴリ名（「業者」「友人」等）。平文。`categories` テーブルの `name` を参照 |
| `attributes` | JSONB | 役職ランク等の非 PII 属性 |
| `notes` | TEXT | 裏面全文テキスト（全文検索用、暗号化対象外） |
| `ocr_raw_text` | TEXT | 表面 OCR 生テキスト |

**[Security & Recovery]**
| カラム | 型 | 説明 |
|---|---|---|
| `encryption_salt` | TEXT | ユーザー固有 UUID（RLS 代わりの分離キー） |

**[Metadata]**
| カラム | 型 | 説明 |
|---|---|---|
| `id` | UUID | PRIMARY KEY |
| `user_id` | UUID | auth.users 参照（使用時のみ） |
| `created_at` | TIMESTAMPTZ | 作成日時 |
| `updated_at` | TIMESTAMPTZ | 更新日時（LWW 競合解決に使用） |
| `scanned_at` | TIMESTAMPTZ | スキャン日時 |
| `ocr_confidence` | FLOAT | OCR 信頼度 |
| `thumbnail_url` | TEXT | サムネイル参照（Base64） |
| `thank_you_sent` | BOOLEAN | お礼メール送信済みフラグ。デフォルト `false` |
| `thank_you_sent_at` | TIMESTAMPTZ | 送信済みにした日時 |

**Indexes**:
- `idx_business_cards_encryption_salt` — ユーザー絞り込み
- `idx_business_cards_created_at` — タイムライン・登録日ソート
- `idx_business_cards_search_hashes` — GIN index（高速 blind search）
- `idx_business_cards_industry` — 業界フィルタ
- `idx_business_cards_card_category` — ユーザーカテゴリフィルタ
- `idx_business_cards_notes_fts` — 裏面全文検索（任意）

### 7.2 categories テーブル（カスタムカテゴリ管理）

ユーザーが自由に作成・編集・削除できるカテゴリを管理するテーブル。カテゴリ名は平文で保存する（PII ではないため）。

```sql
CREATE TABLE IF NOT EXISTS categories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encryption_salt TEXT NOT NULL,          -- ユーザー識別子（business_cards と共通）
  name            TEXT NOT NULL,          -- カテゴリ名（例: 「業者」「友人」「展示会」）
  color_index     INT NOT NULL DEFAULT 0, -- 0=ブルー / 1=エメラルド / 2=パープル (index % 3)
  sort_order      INT NOT NULL DEFAULT 0, -- ユーザーが並び替え可能
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_categories_encryption_salt ON categories (encryption_salt);
```

**デフォルトカテゴリ**: 初回セットアップ時に「未分類」を自動生成。削除不可。

**カテゴリ操作**:
- 追加・編集・削除はすべてクライアント側で実行
- 削除時は紐づく `business_cards.card_category` を `NULL`（未分類）に更新
- カテゴリ名は最大 20 文字

### 7.3 user_vault テーブル

認証アーキテクチャの核。wrapped Data Key と Vault 整合性情報を保管する。

```sql
CREATE TABLE IF NOT EXISTS user_vault (
  id                      UUID    PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Vault 識別子（ユーザーごとに 1 行を保証する UNIQUE 制約）
  user_email              TEXT    NOT NULL UNIQUE,   -- ★ v6.0.3 追加
  encryption_salt         TEXT    NOT NULL UNIQUE,

  -- wrapped Data Keys（3 層保護）
  wrapped_data_key_alpha  TEXT    NOT NULL,  -- WebAuthn PRF 由来鍵でラップ
  wrapped_data_key_pin    TEXT    NOT NULL,  -- PIN/PBKDF2 由来鍵でラップ（v6.0.3 追加）
  wrapped_data_key_beta   TEXT    NOT NULL,  -- Mnemonic BIP-39 由来鍵でラップ

  -- Vault 世代番号（ステール書き込み防止に使用）
  vault_generation        INTEGER NOT NULL DEFAULT 1,  -- ★ v6.0.3 追加

  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_vault ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon full access" ON user_vault
  FOR ALL TO anon USING (true) WITH CHECK (true);
GRANT ALL ON user_vault TO anon;
```

**設計上の重要ルール**:
- `user_email UNIQUE` により 1 ユーザー 1 行を DB レベルで強制する（Section 2.6 Layer 1）
- `encryption_salt` は 24 単語 mnemonic から HKDF で決定論的に導出する（完全全滅時の復元を保証）
- `vault_generation` は Config Bundle の `ambe_generation` と同期し、古い端末からのステール書き込みを防ぐ

wrapped 値フォーマット: `"v1:<iv_b64>:<ct_b64>"`

---

### 7.4 qr_transfers テーブル（QR ペアリング一時保管）

QR ペアリング時に暗号化済み Config Bundle を一時保管するテーブル。
5 分で失効し、Device B が取得後に即座に DELETE される。

```sql
CREATE TABLE IF NOT EXISTS qr_transfers (
  token      TEXT PRIMARY KEY,              -- crypto.randomUUID()
  ct         TEXT NOT NULL,                -- base64 AES-GCM 暗号文（Config Bundle）
  iv         TEXT NOT NULL,                -- base64 12B IV（QR 内にも重複保持）
  expires_at TIMESTAMPTZ NOT NULL,         -- now() + 5 minutes
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE qr_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon full access" ON qr_transfers
  FOR ALL TO anon USING (true) WITH CHECK (true);
GRANT ALL ON qr_transfers TO anon;
```

**設計上の注意**:
- salt と iv は QR ペイロードにも含まれるため DB には iv のみ保存（復号に必要な照合用）
- ct のみを Supabase に保管し、復号鍵（salt・PIN 由来）はクライアントが持つ
- Supabase の RLS はユーザー自身の DB のため anon 全許可で問題ない

---

### 7.5 Supabase 初期セットアップ SQL（一括実行用）

初回セットアップ画面の「Supabase SQL をコピー」ボタンで提供するコード。  
Supabase ダッシュボード → SQL Editor に貼り付けて実行する。

```sql
-- ============================================================
-- あんべの名刺代わり — Supabase 初期セットアップ SQL
-- Supabase Dashboard > SQL Editor に貼り付けて実行してください
-- ============================================================

-- ① user_vault テーブル（認証・暗号鍵管理）
-- ★ v6.0.3: user_email UNIQUE / wrapped_data_key_pin / vault_generation を追加
CREATE TABLE IF NOT EXISTS user_vault (
  id                      UUID    PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Vault 識別子（1 ユーザー 1 行を DB レベルで強制）
  user_email              TEXT    NOT NULL UNIQUE,
  encryption_salt         TEXT    NOT NULL UNIQUE,

  -- wrapped Data Keys（3 層保護）
  wrapped_data_key_alpha  TEXT    NOT NULL,
  wrapped_data_key_pin    TEXT    NOT NULL,
  wrapped_data_key_beta   TEXT    NOT NULL,

  -- Vault 世代番号（ステール書き込み防止）
  vault_generation        INTEGER NOT NULL DEFAULT 1,

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
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encryption_salt TEXT NOT NULL,
  name            TEXT NOT NULL,
  color_index     INT NOT NULL DEFAULT 0,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_categories_encryption_salt
  ON categories (encryption_salt);

-- ④ qr_transfers テーブル（QR ペアリング一時保管）
CREATE TABLE IF NOT EXISTS qr_transfers (
  token      TEXT PRIMARY KEY,
  ct         TEXT NOT NULL,
  iv         TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE qr_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon full access" ON qr_transfers
  FOR ALL TO anon USING (true) WITH CHECK (true);
GRANT ALL ON qr_transfers TO anon;

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

-- ⑥ Supabase Cron 生存維持用（無料プラン自動停止防止）
-- ※ profiles テーブルがない場合は不要。keep-alive API が代替します。

-- 完了メッセージ
SELECT 'あんべの名刺代わり — セットアップ完了！' AS status;
```

**UI での提供方法（セットアップ画面・設定画面共通）**:
- 「SQL をコピー」ボタン → クリップボードにコピー
- 「Supabase SQL Editor を開く ↗」リンク → `https://supabase.com/dashboard/project/_/sql/new` を外部ブラウザで開く
- コピー後はブラウザに戻って Supabase に貼り付け → 実行 → 戻ってきて続きの設定へ

### 7.6 Realtime Sync Policy

- **データ同期**: Supabase Realtime により複数デバイス間で名刺変更をリアルタイム伝播
- **競合解決**: LWW (Last Write Wins)
  - 同じカードの同時編集 → `max(updated_at)` の版を採用
  - 削除 vs 編集 → 最後の操作が優先
- **設計根拠**: 名刺管理の性質上、最後に更新したデバイスが正で十分。CRDT 不要。

---

## 8. API Contract

### 8.1 POST /api/save-business-card

**Request**:
```json
{
  "encrypted_data":            "v1:iv:ct...",
  "encrypted_thumbnail_front": "v1:iv:ct...",
  "encrypted_thumbnail_back":  "v1:iv:ct...",
  "search_hashes":             ["hmac1", "hmac2"],
  "encryption_salt":           "uuid-xxxxxxxx",
  "user_email":                "user@example.com",
  "vault_generation":          1,
  "card_category":             "業者",
  "notes":                     "裏面全文テキスト（平文）",
  "ocr_raw_text":              "表面 OCR 生テキスト",
  "ocr_confidence":            0.92,
  "scanned_at":                "2026-04-20T00:00:00Z",
  "supabaseUrl":               "https://xxx.supabase.co",
  "supabaseAnonKey":           "eyJhbGc..."
}
```

**クライアント側で行う処理（送信前に必ず完了）**:
1. PII を AES-256-GCM で暗号化 → `encrypted_data`
2. サムネイルを AES-256-GCM で暗号化 → `encrypted_thumbnail_front/back`
3. Blind Indexing: 名前・社名等を HMAC-SHA256 でハッシュ化 → `search_hashes`

サーバーは平文 PII を一切受け取らない。

**サーバーサイド処理（★ v6.0.3 追加: Vault 整合性チェック）**:
```
[1] リクエストの encryption_salt と user_email で user_vault を照会
      SELECT id, vault_generation
      FROM user_vault
      WHERE user_email = $user_email
        AND encryption_salt = $encryption_salt
      LIMIT 1

[2] 行が見つからない場合
      → HTTP 409: { error: "暗号化鍵の不整合: このデバイスの鍵はサーバーに登録されたVaultと一致しません" }
      → 保存を物理的に阻止

[3] vault_generation のチェック
      リクエストの vault_generation < DB の vault_generation の場合
      → HTTP 409: { error: "古いバージョンのVaultです。最新の端末からQRペアリングで同期してください" }

[4] 整合性確認済み → business_cards テーブルへ INSERT
```

**エラーレスポンス**:
| HTTP | 意味 | クライアント側の対応 |
|---|---|---|
| 409 | 鍵不整合 / ステールVault | Layer 4 UI（KEY_MISMATCH バナー）を表示して保存ボタンを無効化 |
| 400 | リクエスト不正 | バリデーションエラーをトースト表示 |
| 500 | サーバーエラー | リトライ促進 |

### 8.2 /api/cron/keep-alive（廃止）

~~Vercel Cron から毎日 0:00 UTC に実行される Supabase 無料プラン自動停止防止用エンドポイント。~~

**v6.0.2 で廃止**。GitHub Actions テンプレートがユーザーの Supabase に直接 ping する方式（Section 5.5）に置き換え。Vercel 経由での Cron は BYOK 原則に反するため廃止。

---

## 9. UI / UX デザイン規格 (Ambe Design System)

### 9.1 デザイン哲学

- **Deep Dark Luxury**: iOS コントロールセンター / Linear / Vercel に代表されるミニマル高級感
- **Device-in-Browser**: デスクトップではブラウザ内に 390px のデバイスフレームを表示
- **Gradient Vitality**: 3 色グラデーション体系でカテゴリを直感的に色分け
- **Kindness-Centered UX**: 認証失敗時の救済策を含め、隣人に寄り添うデザイン

### 9.2 カラーパレット

#### 背景色
| 用途 | OKLCH | 概算 HEX |
|---|---|---|
| メイン背景 | `oklch(0.12 0.02 250)` | `#0a0f1a` |
| カード背景 | `oklch(0.15 0.025 250)` | `#0d1220` |
| サイドバー | `oklch(0.14 0.02 250)` | `#0b1019` |
| 入力フィールド | `oklch(0.18 0.02 250)` | `#111827` |
| ミュート | `oklch(0.20 0.015 250)` | `#141c2a` |

#### アクセントカラー（3 色グラデーション体系）
| # | 名称 | グラデーション | 用途 |
|---|---|---|---|
| 1 | ブルー/シアン | `from-blue-500 to-cyan-400` | プライマリアクション・第 1 カテゴリ (`index % 3 === 0`) |
| 2 | エメラルド/ティール | `from-emerald-500 to-teal-500` | 確認・成功・第 2 カテゴリ (`index % 3 === 1`) |
| 3 | パープル/ピンク | `from-purple-500 to-pink-500` | 特別なアクション・第 3 カテゴリ (`index % 3 === 2`) |

#### CSS 変数（globals.css）

```css
:root, .dark {
  --background:         oklch(0.12 0.02 250);
  --foreground:         oklch(0.95 0 0);
  --card:               oklch(0.15 0.025 250);
  --card-foreground:    oklch(0.95 0 0);
  --primary:            oklch(0.65 0.2 250);
  --secondary:          oklch(0.18 0.02 250);
  --muted:              oklch(0.20 0.015 250);
  --muted-foreground:   oklch(0.60 0.01 250);
  --accent:             oklch(0.55 0.15 160);
  --destructive:        oklch(0.577 0.245 27.325);
  --border:             oklch(0.25 0.03 250);
  --input:              oklch(0.18 0.02 250);
  --ring:               oklch(0.65 0.2 250);
  --radius:             0.75rem;
}
```

### 9.3 タイポグラフィ

- フォント: Geist（フォールバック system-ui）
- サイズ体系: xs(12) / sm(14) / base(16) / lg(18) / xl(20) / 2xl(24) / 3xl(30)
- 動的スケーリング: `--base-font-size` を `<html>` に適用し、4 段階（小/標準/大/特大）で一括制御

### 9.4 レイアウト

- モバイル: `h-[100svh]` + `pt-[env(safe-area-inset-top)]` でセーフエリア対応
- デスクトップ: 390px × min(844px, 92svh) のデバイスフレーム（Dynamic Island + ホームインジケーター）
- 角丸: `rounded-xl` / `rounded-2xl` を基本
- 透明感: `backdrop-blur-xl`, `bg-card/95`

### 9.5 実装ルール

**✅ DO**:
```tsx
<div className="rounded-2xl bg-card border border-white/10 p-6">
<button className="bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl py-5">
<motion.button whileHover={{ scale: 1.02, y: -3 }} whileTap={{ scale: 0.97 }}>

// カテゴリ色分け
const gradients = [
  'from-blue-500/30 to-cyan-500/10',
  'from-emerald-500/30 to-teal-500/10',
  'from-purple-500/30 to-pink-500/10',
];
className={gradients[index % 3]}
```

**❌ DON'T**:
```tsx
<div className="bg-white border border-slate-200">   // ライトモード禁止
<div style={{ color: '#2563EB' }}>                   // インラインカラー禁止
<button className="bg-blue-600">                    // グラデーションなし禁止
<div style={{ padding: '17px 22px' }}>              // 任意値禁止
```

### 9.6 アクセシビリティ（WCAG 2.1 AA）

- カラーコントラスト: ダーク背景 + 白テキストで自動的に高コントラスト
- フォーカス指標: `outline-ring/50` をグローバル適用
- セマンティック HTML: `<button>`, `<input>` を常に適切に使用

### 9.7 認証 UI

#### ロック画面 (LOCKED)

```
┌─────────────────────────┐
│         🔒               │
│  あんべの名刺代わり       │
│                          │
│  [ 生体認証で開く ]       │ ← デフォルト・最速
│                          │
│  ─────────               │
│                          │
│  [ PINで開く ]            │
│                          │
│  別の方法で復旧する ▼     │
│    ├ QRで別端末から      │
│    ├ .ambeファイル       │
│    └ 24単語で復旧        │
└─────────────────────────┘
```

#### セッション進捗表示 (UNLOCKED)

- 右上にタイマー: 残り時間（14:32 → 14:31 ...）
- 色: 穏やかなブルー（警告ではなく情報）
- ホバーテキスト: 「15 分間の無操作でロックされます」

#### ロック画面: 起動モード判定（v6.2.0 確定）

- `hasRegisteredCredential()` = true → 生体認証ボタンをデフォルト表示
- `hasRegisteredCredential()` = false（QRインポート直後・未登録）→ PIN モードで自動起動（生体認証ボタン非表示）
- alpha bundle がなくても credential があれば生体認証モードで起動する（PRF upgrade フロー）

#### 設定画面: 緊急リカバリセクション（v6.2.0 確定）

- ラベル: 「🔴 緊急リカバリ (Emergency Recovery)」
- デフォルト折り畳み
- Amber/Orange トーン（警告レベル）
- 24 単語バックアップ導線（`localStorage['mnemonic_words']` がある場合）:
  - コピー
  - .vcf エクスポート（連絡先名「あんべの名刺代わり」、備考欄に 24 単語）
  - メール送信（件名「【バックアップ】あんべの名刺代わり・復号キー」）
- **24 単語バックアップ再生成**（`mnemonic_words` が localStorage にない場合、v6.2.0 追加）:
  - 「🔑 新しい24単語バックアップを生成する」ボタン
  - PIN 確認後、新 mnemonic 生成 → `wrapped_data_key_beta` を Supabase に上書き → localStorage に保存
  - QRインポート後の新端末でも 24 単語バックアップを再取得可能

#### 設定画面: API 接続設定セクション

Config Bundle 内の接続情報（Supabase / Azure / Gemini）を後から変更するための導線。

```
設定画面
  ├─ セキュリティ
  ├─ デバイス管理
  ├─ API 接続設定  ← ここ
  │   ├─ Supabase
  │   ├─ Azure AI Document Intelligence
  │   └─ Gemini
  ├─ 表示
  ├─ 緊急リカバリ
  └─ データ管理
```

**各サービスの表示仕様**:
- 設定済み → 「✓ 設定済み」バッジ付きで折りたたみ表示
- 未設定 → デフォルト展開、入力を促す

**接続テストボタン仕様**:

各サービスの入力フィールドごとに「接続テスト」ボタンを設置する。URL・Keyを入力した直後またはボタンタップ時に軽量なリクエストを送り、疎通を確認する。

| サービス | テスト方法 | 成功条件 |
|---|---|---|
| Supabase | `SELECT 1` を user_vault テーブルに対して実行（anon key 使用） | HTTP 200 が返る |
| Azure AI | 空の POST リクエストをエンドポイントに送信（API Route 経由） | HTTP 400 または 200（認証は通っている） |
| Gemini | モデル一覧取得 API を呼び出す | HTTP 200 が返る |

テスト結果の表示:
- `⏳ テスト中...` → ボタンを非活性化してスピナー表示
- `✓ 接続成功` → エメラルド色で表示、2秒後に消える
- `✗ 接続失敗: [理由]` → レッド色で日本語メッセージ表示（例: 「URLの形式を確認してください」「APIキーが無効です」「CORSエラー：Azure は API Route 経由で接続されます」）

セットアップフローでは「次へ →」ボタンを押す前に Supabase と Azure の接続テストを自動実行し、失敗時は進行をブロックする（Gemini は任意のためスキップ可）。

**リンク仕様**（コピペ支援）:

| サービス | リンク先 |
|---|---|
| Supabase | `https://supabase.com/dashboard` → Project Settings → API |
| Azure | `https://portal.azure.com` → リソース → キーとエンドポイント |
| Gemini | `https://aistudio.google.com/app/apikey` |

各入力フィールドの上に「**→ ここから取得**」のリンクを設置。タップで外部ブラウザで開く。

**変更時の挙動**:
1. 変更内容を新しい Config Bundle に反映
2. Config Bundle を生体認証・PIN で再暗号化して localStorage を上書き
3. Supabase user_vault の wrapped_data_key_alpha/beta は変更なし（Data Key 自体は変わらない）
4. 変更完了後「設定を更新しました」トースト表示

**API 設定へのナビゲーション経路**:
- 初回起動（UNINITIALIZED）→ セットアップフロー Step 2 で自動誘導
- 後から変更 → 設定画面（⑦）→「API 接続設定」セクション

#### 設定画面: GitHub Actions 生存維持セクション

Supabase 無料プランの自動停止防止のため、ユーザーが自分の GitHub に keep-alive テンプレートを設定する導線を提供する。**Vercel は経由しない**。

```
設定画面 → Supabase 生存維持セクション
  └─ GitHub Actions テンプレート方式
       ├─ 手順 ①: テンプレートリポジトリをコピー
       ├─ 手順 ②: Secrets に Supabase URL / Key を登録
       └─ 手順 ③: 疎通テスト
```

**設定画面内で提供するもの**:

1. 「Use this template ↗」ボタン → `github.com/ambe/ambe-keep-alive-template` を外部ブラウザで開く
2. 登録する Secrets の値をコピーボタンで提供:
   - `SUPABASE_URL`: Config Bundle から読み取り表示（コピーボタン付き）
   - `SUPABASE_ANON_KEY`: Config Bundle から読み取り表示（コピーボタン付き）
3. GitHub Secrets 設定ページへのリンク: `github.com/{repo}/settings/secrets/actions`
4. 疎通テストボタン（Supabase への直接 GET が成功するか確認）

**UI 表示**:
- 未設定 → 「GitHub Actions で生存維持を設定する（推奨）」折りたたみ展開
- 設定済み → 「✓ 生存維持 有効」バッジ（ユーザーが手動チェックで確認済みにする）

**注意**: `CRON_SECRET` は不要。Vercel を経由しないため認証トークンも不要。

- 「別の端末に移行」→ QR ペアリングモーダル
- 「設定をファイルに書き出す」→ .ambe エクスポートフロー
- 世代番号と前回発行日を表示
- 古いファイルの処分を明示的に警告

---

### 9.11 OCR プレビュー・確認・保存フロー（撮影後）

撮影 → OCR → **ユーザーによるデータ確認・修正** → 暗号化 → DB保存 という一連のフローを担う画面。

#### 画面の位置づけ

```
スキャン画面（⑥）で撮影
  ↓
OCR プレビュー画面（⑧ 新設）← この画面
  ↓
名刺一覧（④）に戻る
```

#### フロー詳細

```
[1] OCR・構造化（自動）
    撮影画像 → Azure OCR（API Route経由）→ Gemini 構造化
    → プレビュー画面に遷移

[2] データ確認・修正（ユーザー操作）
    各フィールドが編集可能なフォームで表示
    ├─ 氏名 / 社名 / 役職 / メール / 電話 / 住所
    ├─ メモ欄（ユーザーが自由記入）
    └─ OCR 読み取りミスをその場で修正

[3] カテゴリ付与（ユーザー操作）
    categories テーブルから選択
    └─ 「+ 新しいカテゴリ」でその場作成も可

[4] 保存ボタン押下（確定イベント）
    この瞬間に修正済みデータが確定データとして処理へ

[5] ローカル暗号化（自動・Data Key使用）
    ├─ 構造化テキスト JSON → AES-256-GCM → encrypted_data
    ├─ 表面サムネイル画像 → AES-256-GCM → encrypted_thumbnail_front
    └─ 裏面サムネイル画像 → AES-256-GCM → encrypted_thumbnail_back
    ※ ユーザーが納得したデータのみが、デバイスを出る直前に暗号化される

[6] Supabase へ一括送信（自動）
    ├─ business_cards テーブルへ暗号化テキスト保存
    └─ 暗号化サムネイル（Base64）も同テーブルに保存
    ※ サーバーには「読めない文字列」だけが届く

[7] 保存完了 → 名刺一覧に戻る
    └─ お礼メール未送信アイコン（✉️）付きで一覧に表示
```

#### UI 構成

```
┌─────────────────────────────┐
│ ‹ 戻る          確認・保存   │
│ ─────────────────────────── │
│ [名刺サムネイル（表面）]     │
│ [名刺サムネイル（裏面）]     │
│ ─────────────────────────── │
│ 氏名    [ 山田 太郎      ]   │
│ 社名    [ 株式会社テクノロジー]│
│ 役職    [ 営業部長       ]   │
│ メール  [ yamada@...    ]   │
│ 電話    [ 03-1234-5678  ]   │
│ 住所    [ 東京都...      ]   │
│ ─────────────────────────── │
│ メモ    [ 展示会で名刺交換   │
│          フォローアップ予定  ]│
│ ─────────────────────────── │
│ カテゴリ  [ 業者 ▾ ]        │
│                              │
│ [ 保存する ]                 │
└─────────────────────────────┘
```

**実装上の注意**:
- 「保存する」ボタン押下前は一切の暗号化・送信を行わない
- OCR 処理用の元画像はプレビュー表示後にメモリから抹消
- サムネイル（表示用縮小版）はプレビュー表示のためメモリに保持し、保存時に暗号化

---

### 9.12 お礼メール機能

名刺交換後のフォローアップ（お礼メールのドラフト作成）をサポートする機能。本アプリの目玉機能。

#### 設計方針

スキャン直後ではなく、**保存後に一覧・詳細から随時アクセス**できる設計にする。理由：
- スキャン→保存のフローをシンプルに保つ
- 「あとでまとめて送る」ユースケースに対応
- 送信済み管理を自然に組み込める

#### 名刺一覧でのお礼メール未送信インジケーター

一覧画面の各カード右端に、お礼メール送信状態を表示する：

```
[ サムネ ] 山田 太郎          ✉️  [ 業者 ]
           株式会社テクノロジー
                           ↑
                    未送信アイコン（タップで詳細へ）
```

- `thank_you_sent = false`（デフォルト）→ ✉️ アイコン表示
- `thank_you_sent = true` → アイコン非表示（スッキリした一覧に）

#### 名刺詳細画面のお礼メールアクション

詳細画面の下部アクションエリアに配置：

```
┌─────────────────────────────┐
│ [✉️ お礼メールを作成]        │ ← Gemini でドラフト生成
│ [✓ 送信済みにする]           │ ← 手動ステータス変更
└─────────────────────────────┘
```

**「お礼メールを作成」ボタンの処理**:
```
[1] Gemini に送信する情報（非 PII のみ）
    - 業界カテゴリ（例: IT）
    - 役職ランク（例: 部長クラス）
    - 名刺交換の文脈（メモから非 PII 部分を抽出）
    → Placeholder: {{氏名}}、{{社名}} を含むテンプレートを生成

[2] ブラウザ側で実データと結合
    {{氏名}} → 山田 太郎（復号済み）
    {{社名}} → 株式会社テクノロジー（復号済み）

[3] ドラフトを編集可能なモーダルで表示

[4] 「メールアプリで開く」→ mailto: スキーム
    または「コピー」→ クリップボード
```

**「送信済みにする」ボタンの処理**:
- `business_cards` テーブルの `thank_you_sent` を `true` に更新
- 一覧の ✉️ アイコンが消える

#### DB への追加カラム

`business_cards` テーブルに以下を追加：

| カラム | 型 | 説明 |
|---|---|---|
| `thank_you_sent` | BOOLEAN | お礼メール送信済みフラグ。デフォルト `false` |
| `thank_you_sent_at` | TIMESTAMPTZ | 送信済みにした日時 |

#### レイアウト構造

```
[ヘッダー]  名刺フォルダ              🔍 ⋯
[カテゴリフィルタ] すべて｜業者｜友人｜展示会｜…
[検索バー]  名前・会社名で検索...
[カードリスト]  ↓ 以下ループ
[カード]
[ソートコントロール / FAB]
[ボトムナビ]
```

#### カードコンポーネント（名刺一覧行）

- **高さ**: 既存のリスト行と同じ高さを維持（一覧の視認性を優先）
- **アバタータイル部分**: 44×44px の角丸タイルを**名刺サムネイル（表面）**に置き換える
  - サムネイルあり → 復号した `encrypted_thumbnail`（表面）を `object-fit: cover` で表示
  - サムネイルなし → 姓の漢字 1 文字をグラデーションタイルで fallback 表示
- **右側**: 氏名・会社名・役職のテキスト情報
- **右端**: カテゴリバッジ（カスタムカテゴリ名を表示）

#### カテゴリフィルタバー

- 検索バーの上（ヘッダー直下）に横スクロール可能なチップ列を配置
- 「すべて」チップをデフォルト選択
- ユーザーが作成したカテゴリ名を動的に列挙
- 選択中のチップはグラデーションで強調、非選択はミュートカラー
- カテゴリは `categories` テーブルから取得（`sort_order` 順）

```
[ すべて ]  [ 業者 ]  [ 会社 ]  [ 友人 ]  [ 展示会 ]  [ + ]
```

- 末尾の `[ + ]` でカテゴリ追加モーダルを開く

#### ソート

- ソートボタン（⋯ メニュー内）で以下を切り替え
  - **登録日（新しい順）**← デフォルト
  - 登録日（古い順）
  - 氏名（あいうえお順）

#### 検索（Blind Indexing）

- 入力値を HMAC-SHA256 でハッシュ化して `search_hashes` と突合
- サーバーは平文の検索ワードを受け取らない
- フィルタとソートはカテゴリフィルタ・ソート設定と組み合わせ可能

---

### 9.9 名刺詳細画面 UI 仕様

#### ヒーローエリア（上部）

- **名刺サムネイル（表面）**: 全幅で表示。アスペクト比 `16:9` 相当でクロップ（横名刺）または `9:16` 相当（縦名刺）
- **名刺サムネイル（裏面）**: 表面の下に続けて表示。裏面スキャンがない場合は「裏面なし」プレースホルダー
- **両面ともに復号して表示**（`encrypted_thumbnail_front` / `encrypted_thumbnail_back`）
- カテゴリバッジをヒーローエリア右上に表示

#### 詳細フィールド

- 氏名 / 会社名 / 役職 / メール / 電話 / 住所 / URL
- 裏面テキスト（`notes`）をメモとして表示
- 各フィールドにコピーボタン

#### アクション

- 編集・削除・カテゴリ変更

---

### 9.10 スキャン画面 UI 仕様

#### カメラフレームと向きトグル（v6.2.0 確定仕様）

名刺には横向き（landscape）と縦向き（portrait）がある。**カメラフレームは常に縦（portrait）固定**で、ユーザーが名刺の向きをトグルで選択する。

```
横名刺の場合:
┌─────────────────────────────────────┐  ← 画面幅いっぱい
│                                     │
│  ┌──── 名刺フレーム（16:9）────┐   │
│  │                              │   │
│  └──────────────────────────────┘   │
└─────────────────────────────────────┘

縦名刺の場合:
┌────────────────┐
│                │  ← 画面高さいっぱい
│  ┌─ フレーム ─┐│
│  │            ││
│  │  (9:16)    ││
│  │            ││
│  └────────────┘│
│                │
└────────────────┘
```

**確定仕様（v6.2.0）**:

```
【縦の名刺】
  スマホ縦持ち → 縦フレームに合わせてそのまま撮影 → 縦サムネイル保存

【横の名刺（左が上）】
  名刺の左端を上にしてスマホで縦持ち撮影 → 撮影後に画像を +90°（時計回り）回転 → 横サムネイル保存

【横の名刺（右が上）】
  名刺の右端を上にしてスマホで縦持ち撮影 → 撮影後に画像を −90°（反時計回り）回転 → 横サムネイル保存
```

**実装方針**:
- フレームは端末向きに関係なく常に縦（aspect-ratio: 55/91）固定
- カメラ下部に 3 択トグルを表示: `[縦の名刺] [横・左が上] [横・右が上]`
- `captureImage()` でキャプチャ後、`cardOrientation` に応じて canvas を回転
  - `portrait`: 回転なし
  - `landscape-left`: canvas を +90°（時計回り）回転
  - `landscape-right`: canvas を −90°（反時計回り）回転
- OCR には回転済み画像を送信するため、Azure は正位置の画像を受け取る
- カメラビューエリアは常に `position: fixed; inset: 0`（画面全体）
- スキャンラインアニメーションはフレームの縦方向に流れる
- ステータスバー・ボトムナビはカメラビューの上に重ねて表示（透過）

**Two-Phase スキャン UI**:
- タブ「表面 / 裏面 / ギャラリー」で切り替え
- 表面スキャン完了後に裏面スキャンを促すガイダンスを表示
- 裏面スキャンはスキップ可能（「裏面なし」として保存）

**サムネイル保存**:
- 撮影後の画像（JPEG, 品質 0.8）をサムネイルとして保持
- 表面・裏面それぞれを `encrypted_thumbnail_front` / `encrypted_thumbnail_back` として暗号化して Supabase に保存
- OCR 処理用の元画像はレスポンス受信後にメモリから即座に抹消

### 9.13 スキャン位置情報・ジオコーディング機能（v6.2.1 新設）

名刺スキャン時の GPS 座標を取得・保存し、逆ジオコーディングで地名に変換して「初回名刺交換場所」として表示・編集できる機能。

#### 設計方針

- 位置情報はプライバシー的に PII に準ずるため、**暗号化して `encrypted_data` 内に格納**（平文カラムには保存しない）
- Nominatim（OpenStreetMap）を使用（無料・API キー不要）
- GPS が取得できなかった場合でも確認画面の位置情報カードは常時表示し、状態に応じてメッセージを変える

#### 逆ジオコーディング仕様

| 項目 | 値 |
|---|---|
| API | Nominatim OpenStreetMap `reverse` エンドポイント |
| zoom | 14（市区町村レベル） |
| 言語 | `accept-language=ja`（日本語地名） |
| User-Agent | `AmbeBusinessCard/1.0` |
| 出力形式 | `都道府県 市区町村 地域名`（`address.state` + `city/county/town/village` + `suburb/city_district/neighbourhood`） |
| フォールバック | `display_name`（上記フィールドが取得できない場合） |
| 共有ユーティリティ | `src/lib/geocode.ts` — `reverseGeocode(lat, lng): Promise<string \| null>` |

#### スキャン確認画面（ScanPage.tsx）

```
┌──────────────────────────────────────────────────┐
│ 📍 初回名刺交換場所                               │
│ 東京都 渋谷区 恵比寿                              │  ← 地名（編集可）
│ 35.64690, 139.71020  [Google Maps で開く]         │  ← 座標 + Maps リンク
│                                                   │
│ 座標を修正 ▾                                      │  ← トグルで開閉
│   緯度 [35.646900]  経度 [139.710200]             │  ← 数値入力（onBlur で再ジオコーディング）
└──────────────────────────────────────────────────┘
```

- GPS 取得中: 「📡 位置情報を取得中…」を表示
- GPS 取得失敗: 「📍 位置情報を取得できませんでした」を表示
- 地名は `<input type="text">` で直接編集可能
- 座標修正後 `onBlur` で `reverseGeocode` を再実行して地名を自動更新

#### 名刺詳細画面（cards/[id]/page.tsx）

**閲覧モード**:
```
初回名刺交換場所
東京都 渋谷区 恵比寿
📍 35.64690, 139.71020（精度 ±12m）  [Google Maps で開く]
```
- `scanLocation` が null の場合は "—" を表示（行自体は常に表示）

**編集モード**:
- 場所名を `<input type="text">` で編集可能
- 「座標を修正 ▾」トグルで lat/lng 数値入力フィールドを展開
- `onBlur` で `reverseGeocode` を再実行し場所名を自動更新
- カテゴリ選択チップ（未分類 + 登録済みカテゴリを横スクロールなし wrap 表示）を同一編集モードで表示

#### 保存時の動作

- `handleSaveEdit`: 更新座標 + 地名を PII JSON に含めて再暗号化・Supabase に UPDATE
- `handleSave`（スキャン確認）: `scanned_lat/lng/accuracy/location_name` を PII JSON に含めて保存

---

## 10. 運用・保守

### 10.1 Supabase 生存維持（GitHub Actions テンプレート方式）

Section 5.5 参照。Vercel Cron は廃止。各ユーザーが自分の GitHub テンプレートを使って直接 Supabase に ping する。

### 10.2 環境変数

| キー | 説明 | 状態 |
|---|---|---|
| ~~`CRON_SECRET`~~ | ~~Cron API 認証トークン~~ | **廃止**（GitHub Actions 直接 ping 方式に変更のため不要） |

**Vercel の環境変数にユーザーキーは一切設定しない**。Azure / Supabase / Gemini のキーはすべてユーザーの Config Bundle に格納され、リクエスト時に動的に注入される。

### 10.3 監視

- Supabase Dashboard でクエリ使用量を監視（無料枠 50,000/月）
- GitHub Actions のログで keep-alive 実行履歴を確認

---

## 11. 再構築ロードマップ

### Phase 1: 地盤固め
- Supabase にテーブル定義を流す（business_cards, user_vault）
- `.env.local.example` テンプレート作成
- CLAUDE.md / design_doc.md をプロジェクトに配置

### Phase 2: Shell
- Next.js 15 プロジェクト初期化
- globals.css + デザイントークン投入
- デバイスフレーム + 3 タブナビ配線
- ルーティング骨格（中身はプレースホルダー）

### Phase 3: 認証 ← **現在地**
- `src/lib/vault.ts` 実装
- `src/lib/config-bundle.ts` 実装（組み立て / 暗号化 / 復号）
- `SecuritySetup.tsx`（初回セットアップ）
- `LockScreen.tsx`（LOCKED / PIN / Recovery 分岐）
- `PairingExport.tsx` / `PairingImport.tsx`（QR ペアリング）
- `AmbeFileExport.tsx` / `AmbeFileImport.tsx`（.ambe 経路）
- 15 分セッションタイマー
- **Phase 4 に進む前に認証が完全に動くことを確認する（ゲート）**

### Phase 4: OCR
- `src/lib/azure-ocr.ts`（API Route 経由）
- `src/lib/normalize.ts`
- `ScanPage.tsx`
- `POST /api/save-business-card`

### Phase 5: Dashboard / UX
- カード一覧 + 検索
- 詳細画面（復号・ハイドレーション）
- SettingsPage（アコーディオン / フォントサイズ / リカバリセクション / エクスポート）
- エラーメッセージ日本語化
- アニメーション調整

---

## 12. v5.x からの主な変更点

| 項目 | v5.x | v6.0 |
|---|---|---|
| 認証モデル | ユーザー認証（LocalStorage 暗号化）| Config-as-Credential |
| PIN | Phase 8 で廃止 | **必須・フォールバック** |
| マスターキー呼称 | master_key / Data Key 混在 | **Data Key に統一** |
| 保護層 | 2 層（WebAuthn + 24 単語）| **3 層（WebAuthn + PIN + 24 単語）** |
| QR ペアリング | 中継サーバーあり設計（未実装）| **ワンタイム暗号化バンドル（中継不要）** |
| マルチデバイス | Supabase 経由で間接的 | **QR + .ambe + 24 単語の 3 経路** |
| encryption_salt 復元 | 不明確 | **24 単語から HKDF で決定論的導出** |
| .ambe ファイル | 存在しない | **正式採用・世代管理** |
| LocalStorage 旧キー | `encryption_key_wrapped_b64` と新キー並存 | **新設計に一本化・旧キー廃止** |

---

## 13. やってはいけないこと（前回の教訓 + v6.0.3 追加）

| 禁止事項 | 理由 |
|---|---|
| Phase 3（認証）と Phase 4（OCR）を同時並行 | Vault 設計と OCR 設計が絡み合い収拾不能になる（v5.x の頓挫原因）|
| LocalStorage に平文 Data Key を保存 | Zero-Knowledge 原則違反 |
| サーバーに平文 Config Bundle を送信 | BYOS / BYOK 原則違反 |
| USB/NFC キー対応を追加 | `authenticatorAttachment: 'platform'` が設計前提 |
| PII を Gemini に送信 | Placeholder-Based AI 原則違反 |
| インラインスタイルでカラーコード直書き | デザイントークン管理が崩壊 |
| 旧 LocalStorage 互換フォールバックを維持 | v5.x の頓挫原因。v6.0 では新設計一本化 |
| master_key 呼称を復活させる | v6.0 では Data Key に統一 |
| **user_vault に user_email UNIQUE 制約なしで INSERT する** | **多端末間の鍵不整合を引き起こす（Section 2.6 Layer 1 違反）** |
| **Vault 存在確認をスキップして SecuritySetup を完了させる** | **同一ユーザーが 2 つの Vault を持つことになり名刺が相互に復号不能になる** |
| **保存 API で encryption_salt / user_email の整合性チェックを省略する** | **鍵不整合データの DB 書き込みを許してしまう（Section 2.6 Layer 3 違反）** |
| **encryption_salt を UUID v4 のランダム値で生成する** | **完全全滅時に salt が復元できなくなる。必ず mnemonic から HKDF で決定論的導出すること** |
| **QRペアリングに第三者中継サーバー（Anthropic・開発者管理サーバー等）** | **BYOS と矛盾。ユーザー自身の Supabase をリレーに使う方式は許可（v6.1.0）** |

---

## 14. ホスティング・配布ロードマップ
- 共通基盤のデプロイ: src/app/landing/ を含むプロジェクトをVercelにデプロイ。
- テンプレート公開: GitHubにて ambe-keep-alive-template を公開。
- オンボーディング実装: アプリ内の設定画面から、ユーザーが自身のSecretsを登録する手順をガイドするUIを実装。

**(c) 2026 ambe / Business_Card_Folder**  
**Phoenix Rebuild Edition v6.2.1**
