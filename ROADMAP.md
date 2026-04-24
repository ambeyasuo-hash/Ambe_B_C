# あんべの名刺代わり — 実装ロードマップ v6.1.1
# Phoenix Rebuild Edition

**作成日**: 2026-04-21  
**更新日**: 2026-04-24  
**ベース仕様**: design_doc_v6_0_3.md / CLAUDE.md v6.0.0  
**対応モックアップ**: mockup_v6_8.html（①〜⑲ 全20画面）

---

## AI モデル戦略

| フェーズ | モデル | 理由 |
|---|---|---|
| Phase 1: 地盤固め | **Haiku** | SQL実行・boilerplate生成など単純タスク |
| Phase 2: Shell | **Sonnet** | デザイントークン投入・コンポーネント骨格 |
| Phase 3: 認証 | **Sonnet（一気通貫）** | `crypto.ts`→`vault.ts`→`config-bundle.ts` の依存チェーンが密結合。分割すると前ステップの実装意図が失われ v5.x の頓挫を再現する |
| Phase 4: OCR | **Sonnet（一気通貫）** | Azure 呼び出し・暗号化・Supabase 保存が一本のデータフロー |
| Phase 5: Dashboard/UX | **Haiku** | 設定画面・アニメーション等の独立した UI タスク |

> **原則**: Phase 3・4 は1会話で完走する。途中でコンテキストが切れると設計の一貫性が失われる。

---

## スパゲティ防止の絶対ルール

1. **フェーズゲートを破らない** — 各フェーズ末尾の「完了条件」を全て満たすまで次に進まない
2. **Phase 3（認証）と Phase 4（OCR）を同時に触らない** — v5.x 頓挫の直接原因
3. **実装順序は各フェーズ内の番号順に従う** — 依存関係が下流から上流に向かうと崩壊する
4. **デザイントークン外の色・サイズを使わない** — インラインスタイル禁止、globals.css の CSS 変数のみ使用
5. **各ステップ完了時に git commit を打つ** — コンテキスト切れ時の復旧ポイントを確保する

---

## 整合性チェック（モックアップ vs 仕様書）

| 項目 | mockup_v6_8.html | design_doc_v6_0_3.md | 判定 |
|---|---|---|---|
| 背景色 | `oklch(0.12 0.02 250)` | `oklch(0.12 0.02 250)` | ✅ |
| カード色 | `oklch(0.15 0.025 250)` | `oklch(0.15 0.025 250)` | ✅ |
| ボーダー色 | `oklch(0.25 0.03 250)` | `oklch(0.25 0.03 250)` | ✅ |
| デバイスフレーム | 390×844px + ホームインジケーター | 390×min(844px,92svh) | ✅ |
| Dynamic Island | あり | 仕様あり | ✅ |
| セッションタイマー | 右上に表示（ブルー） | 右上・穏やかなブルー | ✅ |
| グラデーション3色 | blue/emerald/purple | 同上 | ✅ |
| フォント | **Inter（参照用）** | **Geist（実装時）** | ⚠️ |
| スクリーン数 | ①〜⑲（20画面） | 全フロー網羅 | ✅ |
| セットアップ順序 | ⑨生体認証→③API→⑧PIN→⑩24単語 | 同上（v6.0.3修正済み） | ✅ |

**⚠️ 要注意**: 実装時は `next/font/google` で **Geist** を読み込み統一する。モックアップは Inter を使用しているが参照用のため変更不要。

---

## Phase 1: 地盤固め

**目的**: コードを1行も書かずにインフラと設計を確定させる

### タスク

| # | 内容 | 成果物 |
|---|---|---|
| 1-1 | Next.js 15 プロジェクト作成（App Router） | `package.json`, `next.config.ts` |
| 1-2 | Supabase でテーブル作成（design_doc Section 7.5 の SQL をそのまま実行） | `business_cards` + `user_vault` + `categories` テーブル |
| 1-3 | `.env.local.example` テンプレート作成（環境変数なし・コメントのみ） | `.env.local.example` |
| 1-4 | CLAUDE.md / design_doc_v6_0_3.md / ROADMAP.md をリポジトリに配置 | プロジェクトルート |

> **注意**: `CRON_SECRET` および `vercel.json` Cron 定義は不要（廃止）。Supabase 生存維持は GitHub Actions テンプレート方式（design_doc Section 5.5）に統一。

> **★ v6.0.3 追加**: `user_vault` テーブルの SQL には必ず以下を含めること:
> - `user_email TEXT NOT NULL UNIQUE` — 1 ユーザー 1 Vault を DB レベルで強制
> - `wrapped_data_key_pin TEXT NOT NULL` — PIN 保護層（3 層目）
> - `vault_generation INTEGER NOT NULL DEFAULT 1` — ステール書き込み防止
>
> 詳細は design_doc Section 7.3 / 7.5 の SQL を参照。

### 完了条件
- [ ] Supabase で全テーブルが存在し、RLS ポリシーが設定されている
- [ ] `user_vault` に `user_email UNIQUE` 制約が存在することを確認
- [ ] `npm run build` が通る（空のプロジェクト）
- [ ] Vercel にデプロイできる

---

## Phase 2: Shell（骨格）

**目的**: デザインシステムとルーティングを確立する。ロジックは書かない。

### タスク

| # | 内容 | 対応モックアップ |
|---|---|---|
| 2-1 | `src/styles/globals.css` — CSS 変数・デザイントークン投入 | 全画面 |
| 2-2 | Geist フォント設定（`next/font/google`） | 全画面 |
| 2-3 | デバイスフレームコンポーネント（390px、Dynamic Island、ホームインジケーター） | 全画面 |
| 2-4 | 3タブナビゲーション（ホーム/スキャン/設定）— ボタンのみ、遷移は後回し | ④一覧 |
| 2-5 | `src/app/page.tsx` — 状態分岐プレースホルダー（UNINITIALIZED/LOCKED/UNLOCKED） | — |
| 2-6 | 各ページのファイルを作成しプレースホルダーテキストを置く | — |

### 完了条件
- [ ] `localhost:3000` でデバイスフレームが表示される
- [ ] タブナビが表示され、クリックでコンソールログが出る
- [ ] ライトモードの白背景が一切現れない
- [ ] インラインスタイルがない

---

## Phase 3: 認証（最重要・最難関）

**目的**: Config-as-Credential モデルを完全に動作させる。  
**⚠️ このフェーズが完全に動くまで Phase 4 に進まない。**

### 実装順序（番号順に実装・動作確認してから次へ）

```
[3-1] src/lib/crypto.ts          — プリミティブ（AES-GCM / PBKDF2 / HMAC）
[3-2] src/lib/vault.ts           — Data Key 生成・wrap・unwrap・Supabase 連携
[3-3] src/lib/mnemonic.ts        — BIP-39 24単語 + HKDF 導出
[3-4] src/lib/webauthn.ts        — WebAuthn 登録・認証・wrapping key 導出
[3-5] src/lib/config-bundle.ts   — Config Bundle 組み立て・暗号化・復号（WebAuthn + PIN）
[3-6] src/components/auth/SecuritySetup.tsx  — 初回セットアップ UI
        ★ Step 2 終了時に Vault 存在確認チェックを必須実装（design_doc 3.1 [1.5]）
        ★ 既存 Vault 検出時は fresh setup をブロックしインポートフローへ誘導
[3-7] src/components/auth/LockScreen.tsx     — ロック画面 UI（①②）
[3-8] src/lib/pairing.ts + PairingExport/Import.tsx  — QR ペアリング（⑪⑫）
[3-9] src/lib/ambe-file.ts + AmbeExport/Import.tsx   — .ambe 経路（⑬⑭）
[3-10] 緊急リカバリ UI（⑮⑯）— 24単語入力 + 完全全滅フロー
[3-11] 15分セッションタイマー — 右上表示・自動ロック
[3-12] ★ v6.0.3 新規: Vault 整合性テスト
        セットアップ完了後に DevTools で確認:
        - user_vault に user_email UNIQUE 行が 1 件のみ存在すること
        - 同一 user_email で 2 回目の SecuritySetup がブロックされること
```

### 対応モックアップ画面

| 画面 | ファイル | mockup_v6_8.html | セットアップ内順序 |
|---|---|---|---|
| ① ロック画面（生体認証） | `LockScreen.tsx` | ① | — |
| ② PIN 入力 | `LockScreen.tsx` | ② | — |
| ⑨ セットアップ — 生体認証登録 | `SecuritySetup.tsx` | ⑨ | Step 1/4 |
| ③ 初回セットアップ（API 入力） | `SecuritySetup.tsx` | ③ | Step 2/4 |
| ⑧ セットアップ — PIN 設定 | `SecuritySetup.tsx` | ⑧ | Step 3/4 |
| ⑩ セットアップ — 24単語バックアップ | `SecuritySetup.tsx` | ⑩ | Step 4/4 |
| ⑪ QR ペアリング（既存端末） | `PairingExport.tsx` | ⑪ | — |
| ⑫ QR ペアリング（新端末） | `PairingImport.tsx` | ⑫ | — |
| ⑬ .ambe エクスポート | `AmbeExport.tsx` | ⑬ | — |
| ⑭ .ambe インポート | `AmbeImport.tsx` | ⑭ | — |
| ⑮ 24単語で緊急復旧 | `LockScreen.tsx` | ⑮ | — |
| ⑯ 完全全滅時の復旧フロー | `LockScreen.tsx` | ⑯ | — |

### 完了条件
- [ ] 初回セットアップが完了し UNLOCKED になる
- [ ] アプリを閉じて再起動 → LOCKED → 生体認証で UNLOCKED になる
- [ ] 生体認証失敗 → PIN で UNLOCKED になる
- [ ] 15分タイマーが切れると自動でロックされる
- [ ] QR ペアリングで別デバイスに Config Bundle を転送できる
- [ ] .ambe エクスポート → インポートで Config Bundle を復元できる
- [ ] 24単語でリカバリできる（完全全滅フロー含む）
- [ ] localStorage に平文の Data Key / Config Bundle が存在しない（DevTools で確認）

---

## Phase 4: OCR

**目的**: Azure AI Document Intelligence を使って名刺を取り込む。

### 実装順序

```
[4-1] src/lib/azure-ocr.ts       — Azure API 呼び出し（prebuilt-layout / prebuilt-read）
[4-2] src/lib/normalize.ts       — OCR 結果のノイズ除去・検索ワード分割
[4-3] app/api/ocr/route.ts       — Next.js API Route（CORS 対策・Azure 呼び出し中継）
[4-4] src/components/ScanPage.tsx  — カメラ → OCR → 確認・編集（⑥⑰⑱）
[4-5] app/api/save-business-card/route.ts  — 暗号化・Blind Indexing・Supabase 保存
        ★ v6.0.3 追加: リクエスト受信時に以下の整合性チェックを実装（design_doc 8.1）
          1. user_vault WHERE user_email = $email AND encryption_salt = $salt を照会
          2. 行なし → HTTP 409（鍵不整合エラー）
          3. vault_generation がリクエスト < DB → HTTP 409（ステール書き込みエラー）
```

### 対応モックアップ画面

| 画面 | ファイル | mockup_v6_8.html |
|---|---|---|
| ⑥ スキャン（縦/横） | `ScanPage.tsx` | ⑥・⑥b |
| ⑰ OCR プレビュー確認・保存 | `ScanPage.tsx` | ⑰ |
| ⑱ 名刺編集 | `ScanPage.tsx` | ⑱ |

### 完了条件
- [ ] 名刺を撮影 → OCR → 結果確認画面が表示される
- [ ] 保存後に Supabase の `business_cards` に暗号化データが入っている
- [ ] `encrypted_data` に平文 PII が含まれない（base64 文字列のみ）
- [ ] `search_hashes` に HMAC ハッシュ配列が入っている

---

## Phase 5: Dashboard / UX

**目的**: 名刺の閲覧・検索・削除と UX の仕上げ。

### 実装順序

```
[5-1] src/components/Dashboard.tsx  — 名刺一覧・Blind Indexing 検索（④）
[5-2] 名刺詳細画面                 — 復号・表示（⑤）
[5-3] 削除確認モーダル             — 論理削除（⑲）
[5-4] src/components/SettingsPage.tsx  — 設定画面（⑦）
      - アコーディオン（Supabase/Azure/Gemini）
      - フォントサイズ切替（小/標準/大/特大）
      - バックアップ警告バナー（24単語未保管時）
      - ペアリング / .ambe エクスポートへの導線
      - 緊急リカバリセクション（デフォルト折り畳み）
[5-5] Supabase Realtime 同期 — LWW 競合解決
[5-6] エラーメッセージ日本語化（全エラー）
[5-7] Framer Motion アニメーション調整
[5-8] ★ v6.0.3 新規: クライアントサイド鍵不整合検出 UI（design_doc 2.6 Layer 4）
      - cards/page.tsx のカード一覧ロード時に全件復号失敗を検出
      - "KEY_MISMATCH" 専用バナーを表示し保存ボタンを無効化
      - 「24単語またはQRペアリングで鍵を同期してください」の復旧フローへ誘導
```

### 対応モックアップ画面

| 画面 | ファイル | mockup_v6_8.html |
|---|---|---|
| ④ 名刺一覧 | `Dashboard.tsx` | ④ |
| ⑤ 名刺詳細（お礼メールアクション含む） | `CardDetail.tsx` | ⑤ |
| ⑦ 設定 | `SettingsPage.tsx` | ⑦ |
| ⑲ 削除確認モーダル | `Dashboard.tsx` | ⑲ |

### 完了条件
- [ ] 名刺一覧が表示・スクロールできる
- [ ] 名前・会社名で検索できる（Blind Indexing）
- [ ] 詳細画面で復号された PII が表示される
- [ ] 削除できる
- [ ] 設定のアコーディオンが動作する
- [ ] フォントサイズ切替が全体に反映される
- [ ] 24単語未保管時に警告バナーが表示される

---

## 禁止事項リファレンス（やってはいけないこと）

| 禁止 | 理由 |
|---|---|
| Phase 3 と Phase 4 の同時着手 | v5.x 頓挫の直接原因 |
| `localStorage` に平文 Data Key を保存 | Zero-Knowledge 違反 |
| Supabase/Azure/Gemini キーを環境変数に入れる | BYOS/BYOK 違反 |
| サーバーに平文 Config Bundle を送信 | Zero-Knowledge 違反 |
| `authenticatorAttachment: 'crossPlatform'` | platform 固定が設計前提 |
| PII を Gemini に送信 | Placeholder-Based AI 違反 |
| インラインスタイルでカラーコード直書き | デザイントークン崩壊 |
| `master_key` 呼称を使う | v6.0 は `Data Key` に統一 |
| 旧 localStorage キーを参照 | `encryption_key_wrapped_b64` 等は廃止済み |
| QR ペアリングに中継サーバー | BYOS と矛盾 |
| Config Bundle を localStorage に平文保存 | 必ず暗号化状態で保存 |
| 暗号処理を Server Component で行う | `CryptoKey` はシリアライズ不可・Zero-Knowledge 違反。必ず `'use client'` の Context/Hooks 内で完結させる |
| Vercel Cron / CRON_SECRET を使用する | v6.0.3 で廃止。GitHub Actions 直接 ping 方式に統一 |
| **user_vault に user_email UNIQUE なしで INSERT する** | **多端末間の鍵不整合を引き起こす（design_doc 2.6 Layer 1 違反）** |
| **Vault 存在確認をスキップして SecuritySetup を完了させる** | **同一ユーザーが 2 つの Vault を持ち名刺が相互復号不能になる** |
| **保存 API で encryption_salt + user_email の整合性チェックを省略する** | **鍵不整合データの DB 書き込みを許してしまう（design_doc 2.6 Layer 3 違反）** |
| **encryption_salt を UUID v4 のランダム値で生成する** | **完全全滅時に salt が復元できない。mnemonic から HKDF で決定論的導出すること** |

---

**(c) 2026 ambe / Business_Card_Folder — Phoenix Rebuild Edition v6.1.1**
