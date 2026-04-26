<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

## CRITICAL: Scope discipline — do NOT touch what you weren't asked to touch

Your task is always **scoped**. Read the task description carefully and only modify the files and functions that are **explicitly named**. The rules below are absolute.

### General rules

1. **Only change what the task explicitly requests.** If a file is not named in the task, do not open it for editing.
2. **Do not refactor, rename, reorganize, or clean up** code outside your task scope — even if it looks improvable.
3. **Do not add or remove imports** unless the task directly requires it.
4. **Do not add error handling, comments, logging, or validation** beyond what the task explicitly requests.
5. **If you notice a bug outside your scope**, report it in your response summary but do NOT fix it.
6. **After completing your task**, run `npx tsc --noEmit` and fix any TypeScript errors you introduced. Do not fix pre-existing errors unrelated to your changes.
7. **Do not change function signatures, interface shapes, or state types** unless explicitly required by the task.

### Confirmed and locked implementations

The following logic has been deliberately designed and tested. **Do not modify it without an explicit instruction that names the specific item.**

#### `src/components/auth/LockScreen.tsx`
- `canUseBiometric = hasRegisteredCredential()` — intentionally does NOT check `hasBundleAlpha()`. Alpha bundle is created lazily via PRF upgrade; checking it here breaks the flow.
- Auto-switch to PIN mode on mount when `!hasRegisteredCredential()`.
- `pendingPrfKey.current` PRF upgrade flow: biometric sets the key, PIN login triggers the upgrade.
- Recovery accordion with QR / .ambe / mnemonic / reset options.

#### `src/components/QRPairingImport.tsx`
- After QR import: calls `saveBundleWithPIN` only. **Never calls `saveBundleWithAlpha`** — WebAuthn is not registered on the new device yet.
- Re-wraps data key with a new PIN salt on the new device.

#### `src/lib/azure-ocr.ts`
- `cleanNameField()`: COMPANY_KEYWORDS early-return guard at the top.
- `parseRawTextFallback()`: mobile detection block (080/090/070/050 prefixes) placed after tel detection; tel loop skips mobile-prefix lines.
- `analyzeBusinessCardFront()` returns `mobile: fallback.mobile`.

#### `src/components/ScanPage.tsx`
- `cardOrientation` state type: `'portrait' | 'landscape-left' | 'landscape-right'`.
- `captureImage()`: frame is always portrait (55/91 aspect ratio); rotates canvas +90° for `landscape-left`, −90° for `landscape-right`.
- 3-way orientation toggle UI in the camera bottom bar.
- `isPortrait` device orientation state is kept for reference but the frame is always portrait.

#### `src/context/VaultContext.tsx`
- 15-minute session timer with user-activity reset.
- `hasBundlePIN()` determines LOCKED vs UNINITIALIZED on mount.

#### `src/app/(app)/settings/page.tsx`
- SQL copy button: try-catch + textarea `execCommand` fallback (for incognito / non-HTTPS).
- `handleMnemonicRegen`: regenerates 24-word backup, updates Supabase `wrapped_data_key_beta`, updates localStorage PIN bundle, and saves new words to `localStorage['mnemonic_words']`.

#### `src/app/page.tsx`
- UNINITIALIZED welcome screen with 4 buttons: 新規セットアップ / QRで引き継ぐ / .ambeで復元 / 24単語で復旧.

#### `src/components/layout/StatusBar.tsx`
- Shows session timer only (right-aligned). No clock time. No battery icon.

#### `src/app/api/gemini/route.ts`
- Model: `gemini-2.5-flash` (stable). Do not change to any preview or versioned endpoint.

#### `src/components/auth/SecuritySetup.tsx`
- SQL copy button: same try-catch + execCommand fallback as settings page.

#### `src/lib/normalize.ts`
- `buildSearchTokens()` includes `result.mobile?.value`.

#### `src/app/(app)/cards/[id]/page.tsx`
- `PiiFields` includes `furigana` and `mobile`.
- `FIELD_LABELS` order: name → furigana → company → title → email → tel → mobile → address.
