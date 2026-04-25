'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@supabase/supabase-js'
import { registerWebAuthn } from '@/lib/webauthn'
import { generateMnemonic24, deriveWrappingKeyFromMnemonic, deriveEncryptionSalt } from '@/lib/mnemonic'
import { generateDataKey, wrapKey, deriveWrappingKeyFromPIN } from '@/lib/crypto'
import { saveBundleWithAlpha, saveBundleWithPIN, type ConfigBundle } from '@/lib/config-bundle'
import { saveVaultRow, testSupabaseConnection } from '@/lib/vault'
import { useVault } from '@/context/VaultContext'
import { SUPABASE_SETUP_SQL } from '@/lib/setup-sql'

type Step = 1 | 2 | 3 | 4

interface ApiConfig {
  supabaseUrl: string
  supabaseKey: string
  azureEndpoint: string
  azureKey: string
  geminiKey: string
}


export default function SecuritySetup() {
  const router = useRouter()
  const { unlock } = useVault()
  const [step, setStep] = useState<Step>(1)
  const [credentialId, setCredentialId] = useState('')
  const [apiConfig, setApiConfig] = useState<ApiConfig>({
    supabaseUrl: '', supabaseKey: '',
    azureEndpoint: '', azureKey: '', geminiKey: '',
  })
  const [userEmail, setUserEmail] = useState('')
  const [showVaultBlock, setShowVaultBlock] = useState(false)
  const [pin, setPin] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [mnemonic, setMnemonic] = useState('')
  const [mnemonicBacked, setMnemonicBacked] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [testStatus, setTestStatus] = useState<Record<string, 'idle' | 'testing' | 'ok' | 'fail'>>({})
  const [pendingDataKey, setPendingDataKey] = useState<CryptoKey | null>(null)
  const [sqlCopied, setSqlCopied] = useState(false)

  // ── Step 1: Register biometric ──────────────────────────────────────────

  async function handleRegisterBiometric() {
    setLoading(true)
    setError('')
    try {
      const id = await registerWebAuthn(crypto.randomUUID(), 'あんべ')
      setCredentialId(id)
      setStep(2)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  // ── Step 2: Test API connections ────────────────────────────────────────

  async function handleTestSupabase() {
    setTestStatus((s) => ({ ...s, supabase: 'testing' }))
    const ok = await testSupabaseConnection(apiConfig.supabaseUrl, apiConfig.supabaseKey)
    setTestStatus((s) => ({ ...s, supabase: ok ? 'ok' : 'fail' }))
  }

  async function handleTestAzure() {
    setTestStatus((s) => ({ ...s, azure: 'testing' }))
    try {
      const res = await fetch('/api/test-azure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: apiConfig.azureEndpoint, key: apiConfig.azureKey }),
      })
      setTestStatus((s) => ({ ...s, azure: res.ok || res.status === 400 ? 'ok' : 'fail' }))
    } catch {
      setTestStatus((s) => ({ ...s, azure: 'fail' }))
    }
  }

  async function checkVaultExistence(supabaseUrl: string, anonKey: string, email: string) {
    const supabase = createClient(supabaseUrl, anonKey)
    const { data, error } = await supabase
      .from('user_vault')
      .select('id, encryption_salt, vault_generation')
      .eq('user_email', email)
      .maybeSingle()
    if (error) {
      // user_email カラム未存在 → スキーマが古い。セットアップを続行させると
      // 鍵不整合が発生するため、ここでブロックしてマイグレーションを促す。
      if (error.message.includes('user_email') || error.code === '42703') {
        throw new Error(
          'Supabase のスキーマが古い状態です。「SQL をコピー」ボタンでマイグレーション SQL を実行してから再試行してください。',
        )
      }
      throw error
    }
    return data
  }

  async function handleStep2Next() {
    setLoading(true)
    setError('')
    try {
      const vaultData = await checkVaultExistence(
        apiConfig.supabaseUrl,
        apiConfig.supabaseKey,
        userEmail,
      )
      if (vaultData !== null) {
        setShowVaultBlock(true)
      } else {
        setStep(3)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  function canProceedStep2() {
    return testStatus.supabase === 'ok' && testStatus.azure === 'ok' &&
      apiConfig.supabaseUrl && apiConfig.supabaseKey &&
      apiConfig.azureEndpoint && apiConfig.azureKey &&
      userEmail.includes('@')
  }

  // ── Step 3: Set PIN ─────────────────────────────────────────────────────

  function canProceedStep3() {
    return pin.length >= 4 && pin.length <= 8 && pin === pinConfirm
  }

  // ── Step 4: Finalize — generate keys, assemble bundle, save ────────────

  async function handleFinalize() {
    setLoading(true)
    setError('')
    try {
      // Setup 時は assertWebAuthn() を呼ばない。
      // 理由: Windows Chrome で Windows Hello と GPM が競合して二重プロンプトが発生する。
      //       PRF key によるバンドル暗号化は初回 PIN ログイン後にサイレントアップグレードする。
      // Generate mnemonic + encryption_salt (deterministic from mnemonic)
      const phrase = generateMnemonic24()
      const encSalt = await deriveEncryptionSalt(phrase)

      // Generate Data Key
      const dataKey = await generateDataKey()

      // Derive wrapping keys
      const pinSalt     = crypto.getRandomValues(new Uint8Array(16))
      const pinSaltHex  = Array.from(pinSalt).map((b) => b.toString(16).padStart(2, '0')).join('')
      const pinKey      = await deriveWrappingKeyFromPIN(pin, pinSalt) // Level 1b
      const mnemonicKey = await deriveWrappingKeyFromMnemonic(phrase)  // Level 2

      // setup 時は常に PIN key を alpha key として使用（PRF upgrade は初回 PIN ログイン後）
      const alphaKey = pinKey

      // 各レベルで Data Key を wrap（それぞれ独立した鍵で保護）
      const wrappedAlpha = await wrapKey(alphaKey, dataKey) // Level 1a
      const wrappedPin   = await wrapKey(pinKey, dataKey)   // Level 1b (PIN 専用)
      const wrappedBeta  = await wrapKey(mnemonicKey, dataKey) // Level 2

      // Assemble bundle (pin_salt を内包して .ambe リカバリを可能にする)
      const bundle: ConfigBundle = {
        v: 1,
        encryption_salt: encSalt,
        ambe_generation: 1,
        last_exported_at: new Date().toISOString(),
        supabase: { url: apiConfig.supabaseUrl, anon_key: apiConfig.supabaseKey },
        azure: { endpoint: apiConfig.azureEndpoint, key: apiConfig.azureKey },
        gemini: { key: apiConfig.geminiKey },
        wrapped_data_key_alpha: wrappedAlpha,
        wrapped_data_key_pin: wrappedPin,
        wrapped_data_key_beta: wrappedBeta,
        pin_salt: pinSaltHex,
        userEmail,
        fontSizePreference: 'standard',
      }

      // Save to localStorage（pinSalt を共有することで PIN unlock 時の salt が一致する）
      await saveBundleWithAlpha(alphaKey, bundle)
      await saveBundleWithPIN(pin, bundle, pinSalt)

      // Save wrapped keys to Supabase
      await saveVaultRow(bundle, {
        user_email: userEmail,
        encryption_salt: encSalt,
        wrapped_data_key_alpha: wrappedAlpha,
        wrapped_data_key_pin: wrappedPin,
        wrapped_data_key_beta: wrappedBeta,
      })

      setPendingDataKey(dataKey)
      setMnemonic(phrase)
      setStep(4)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function handleComplete() {
    if (!pendingDataKey) {
      setError('セットアップデータが見つかりません。やり直してください。')
      return
    }
    setLoading(true)
    setError('')
    try {
      const { loadBundleWithPIN } = await import('@/lib/config-bundle')
      const bundle = await loadBundleWithPIN(pin)
      unlock(pendingDataKey, bundle)
    } catch (e) {
      setError((e as Error).message)
      setLoading(false)
    }
  }

  const statusIcon = (key: string) => {
    const s = testStatus[key]
    if (s === 'testing') return '⏳'
    if (s === 'ok') return '✓'
    if (s === 'fail') return '✗'
    return ''
  }

  return (
    <div className="flex flex-col flex-1 overflow-y-auto" style={{ paddingTop: '59px' }}>
      {showVaultBlock && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col flex-1 px-6 pb-8 gap-5 pt-6"
        >
          <div className="flex flex-col items-center gap-3">
            <span style={{ fontSize: '48px' }}>⚠️</span>
            <h1 className="text-xl font-bold text-center" style={{ color: 'var(--foreground)' }}>
              Vault が既に存在します
            </h1>
            <p className="text-center text-sm leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>
              このメールアドレスには既存の Vault が存在します。別端末からQRペアリングで引き継ぐか、24ワードのリカバリーフレーズを入力してください。
            </p>
          </div>
          <button
            onClick={() => router.push('/lock?mode=qr-import')}
            className="w-full py-4 rounded-2xl font-bold text-white"
            style={{ background: 'linear-gradient(135deg, oklch(0.55 0.22 255), oklch(0.60 0.18 200))' }}
          >
            QRペアリングで引き継ぐ
          </button>
          <button
            onClick={() => router.push('/lock?mode=recovery')}
            className="w-full py-4 rounded-2xl font-bold"
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              color: 'var(--foreground)',
            }}
          >
            リカバリーフレーズで復元
          </button>
          <button
            onClick={() => { setShowVaultBlock(false); setStep(2) }}
            className="w-full py-3 rounded-2xl text-sm"
            style={{ color: 'var(--muted-foreground)' }}
          >
            別のメールアドレスを使う
          </button>
          {error && (
            <p className="text-sm text-center" style={{ color: 'oklch(0.577 0.245 27.325)' }}>
              {error}
            </p>
          )}
        </motion.div>
      )}

      {!showVaultBlock && (
        <>
      {/* Progress dots */}
      <div className="flex justify-center gap-2 py-4">
        {([1, 2, 3, 4] as Step[]).map((s) => (
          <div
            key={s}
            className="rounded-full transition-all"
            style={{
              width: step === s ? '24px' : '8px',
              height: '8px',
              background: s <= step
                ? 'oklch(0.65 0.2 250)'
                : 'oklch(0.25 0.03 250)',
            }}
          />
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.22 }}
          className="flex flex-col flex-1 px-6 pb-8 gap-6"
        >
          {/* ── Step 1: Biometric ─────────────────────────────────── */}
          {step === 1 && (
            <>
              <div className="flex flex-col items-center gap-3 pt-4">
                <span style={{ fontSize: '48px' }}>🔐</span>
                <h1 className="text-xl font-bold text-center" style={{ color: 'var(--foreground)' }}>
                  生体認証を登録
                </h1>
                <p className="text-center text-sm" style={{ color: 'var(--muted-foreground)' }}>
                  FaceID・TouchID・Windows Hello で<br />名刺データを保護します
                </p>
              </div>
              <button
                onClick={handleRegisterBiometric}
                disabled={loading}
                className="w-full py-4 rounded-2xl font-bold text-white"
                style={{
                  background: 'linear-gradient(135deg, oklch(0.55 0.22 255), oklch(0.60 0.18 200))',
                  opacity: loading ? 0.6 : 1,
                }}
              >
                {loading ? '登録中...' : '生体認証を登録する'}
              </button>
            </>
          )}

          {/* ── Step 2: API setup ─────────────────────────────────── */}
          {step === 2 && (
            <>
              <div className="flex flex-col gap-1 pt-4">
                <h1 className="text-xl font-bold" style={{ color: 'var(--foreground)' }}>
                  API 接続設定
                </h1>
                <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                  あなたの Supabase と Azure の情報を入力します
                </p>
              </div>

              {/* SQL copy section */}
              <div className="rounded-2xl p-4 flex flex-col gap-3"
                style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
                <p className="text-xs font-bold" style={{ color: 'var(--muted-foreground)' }}>
                  ① Supabase SQL を先に実行してください
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(SUPABASE_SETUP_SQL)
                      } catch {
                        const el = document.createElement('textarea')
                        el.value = SUPABASE_SETUP_SQL
                        el.style.cssText = 'position:fixed;opacity:0;top:0;left:0'
                        document.body.appendChild(el)
                        el.focus(); el.select()
                        try { document.execCommand('copy') } catch { /* ignore */ }
                        document.body.removeChild(el)
                      }
                      setSqlCopied(true)
                      setTimeout(() => setSqlCopied(false), 2000)
                    }}
                    className="flex-1 py-2 rounded-xl text-sm font-semibold"
                    style={{ background: 'var(--muted)', color: 'var(--foreground)' }}
                  >
                    {sqlCopied ? '✓ コピーしました' : 'SQL をコピー'}
                  </button>
                  <a
                    href="https://supabase.com/dashboard/project/_/sql/new"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 py-2 rounded-xl text-sm font-semibold text-center"
                    style={{ background: 'var(--muted)', color: 'oklch(0.65 0.2 250)' }}
                  >
                    SQL Editor ↗
                  </a>
                </div>
              </div>

              {/* Email */}
              <div className="flex flex-col gap-3">
                <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                  メールアドレス
                </label>
                <input
                  type="email"
                  placeholder="your@email.com"
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl text-sm"
                  style={{ background: 'var(--input)', color: 'var(--foreground)', border: '1px solid var(--border)' }}
                />
              </div>

              {/* Supabase inputs */}
              <div className="flex flex-col gap-3">
                <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                  Supabase
                  <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer"
                    className="ml-2 font-normal" style={{ color: 'oklch(0.65 0.2 250)' }}>→ 取得する ↗</a>
                </label>
                <input
                  type="url"
                  placeholder="https://xxx.supabase.co"
                  value={apiConfig.supabaseUrl}
                  onChange={(e) => setApiConfig((c) => ({ ...c, supabaseUrl: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl text-sm"
                  style={{ background: 'var(--input)', color: 'var(--foreground)', border: '1px solid var(--border)' }}
                />
                <input
                  type="password"
                  placeholder="anon key"
                  value={apiConfig.supabaseKey}
                  onChange={(e) => setApiConfig((c) => ({ ...c, supabaseKey: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl text-sm"
                  style={{ background: 'var(--input)', color: 'var(--foreground)', border: '1px solid var(--border)' }}
                />
                <button
                  onClick={handleTestSupabase}
                  disabled={testStatus.supabase === 'testing'}
                  className="self-start px-4 py-2 rounded-xl text-sm font-semibold"
                  style={{
                    background: testStatus.supabase === 'ok' ? 'oklch(0.55 0.15 160 / 0.2)' :
                      testStatus.supabase === 'fail' ? 'oklch(0.577 0.245 27.325 / 0.2)' : 'var(--muted)',
                    color: testStatus.supabase === 'ok' ? 'oklch(0.55 0.15 160)' :
                      testStatus.supabase === 'fail' ? 'oklch(0.577 0.245 27.325)' : 'var(--foreground)',
                  }}
                >
                  {statusIcon('supabase')} {testStatus.supabase === 'testing' ? 'テスト中...' : '接続テスト'}
                </button>
              </div>

              {/* Azure inputs */}
              <div className="flex flex-col gap-3">
                <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                  Azure AI
                  <a href="https://portal.azure.com" target="_blank" rel="noopener noreferrer"
                    className="ml-2 font-normal" style={{ color: 'oklch(0.65 0.2 250)' }}>→ 取得する ↗</a>
                </label>
                <input
                  type="url"
                  placeholder="https://xxx.cognitiveservices.azure.com/"
                  value={apiConfig.azureEndpoint}
                  onChange={(e) => setApiConfig((c) => ({ ...c, azureEndpoint: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl text-sm"
                  style={{ background: 'var(--input)', color: 'var(--foreground)', border: '1px solid var(--border)' }}
                />
                <input
                  type="password"
                  placeholder="API key"
                  value={apiConfig.azureKey}
                  onChange={(e) => setApiConfig((c) => ({ ...c, azureKey: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl text-sm"
                  style={{ background: 'var(--input)', color: 'var(--foreground)', border: '1px solid var(--border)' }}
                />
                <button
                  onClick={handleTestAzure}
                  disabled={testStatus.azure === 'testing'}
                  className="self-start px-4 py-2 rounded-xl text-sm font-semibold"
                  style={{
                    background: testStatus.azure === 'ok' ? 'oklch(0.55 0.15 160 / 0.2)' :
                      testStatus.azure === 'fail' ? 'oklch(0.577 0.245 27.325 / 0.2)' : 'var(--muted)',
                    color: testStatus.azure === 'ok' ? 'oklch(0.55 0.15 160)' :
                      testStatus.azure === 'fail' ? 'oklch(0.577 0.245 27.325)' : 'var(--foreground)',
                  }}
                >
                  {statusIcon('azure')} {testStatus.azure === 'testing' ? 'テスト中...' : '接続テスト'}
                </button>
              </div>

              {/* Gemini (optional) */}
              <div className="flex flex-col gap-3">
                <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
                  Gemini（任意）
                  <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer"
                    className="ml-2 font-normal" style={{ color: 'oklch(0.65 0.2 250)' }}>→ 取得する ↗</a>
                </label>
                <input
                  type="password"
                  placeholder="AIza..."
                  value={apiConfig.geminiKey}
                  onChange={(e) => setApiConfig((c) => ({ ...c, geminiKey: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl text-sm"
                  style={{ background: 'var(--input)', color: 'var(--foreground)', border: '1px solid var(--border)' }}
                />
              </div>

              <button
                onClick={handleStep2Next}
                disabled={!canProceedStep2() || loading}
                className="w-full py-4 rounded-2xl font-bold text-white mt-auto"
                style={{
                  background: 'linear-gradient(135deg, oklch(0.55 0.22 255), oklch(0.60 0.18 200))',
                  opacity: canProceedStep2() && !loading ? 1 : 0.4,
                }}
              >
                {loading ? '確認中...' : '次へ →'}
              </button>
            </>
          )}

          {/* ── Step 3: PIN ───────────────────────────────────────── */}
          {step === 3 && (
            <>
              <div className="flex flex-col gap-1 pt-4">
                <h1 className="text-xl font-bold" style={{ color: 'var(--foreground)' }}>
                  PIN を設定
                </h1>
                <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                  生体認証が使えないときのバックアップです（4〜8桁）
                </p>
              </div>
              <input
                type="password"
                inputMode="numeric"
                placeholder="PIN（4〜8桁）"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                className="w-full px-4 py-3 rounded-xl text-sm text-center tracking-[0.5em]"
                style={{ background: 'var(--input)', color: 'var(--foreground)', border: '1px solid var(--border)', fontSize: '24px' }}
              />
              <input
                type="password"
                inputMode="numeric"
                placeholder="確認"
                value={pinConfirm}
                onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 8))}
                className="w-full px-4 py-3 rounded-xl text-sm text-center tracking-[0.5em]"
                style={{
                  background: 'var(--input)',
                  color: 'var(--foreground)',
                  border: `1px solid ${pinConfirm && pin !== pinConfirm ? 'oklch(0.577 0.245 27.325)' : 'var(--border)'}`,
                  fontSize: '24px',
                }}
              />
              {pinConfirm && pin !== pinConfirm && (
                <p className="text-sm" style={{ color: 'oklch(0.577 0.245 27.325)' }}>PINが一致しません</p>
              )}
              <button
                onClick={handleFinalize}
                disabled={!canProceedStep3() || loading}
                className="w-full py-4 rounded-2xl font-bold text-white mt-auto"
                style={{
                  background: 'linear-gradient(135deg, oklch(0.55 0.22 255), oklch(0.60 0.18 200))',
                  opacity: canProceedStep3() && !loading ? 1 : 0.4,
                }}
              >
                {loading ? '設定中...' : '設定を完了する'}
              </button>
            </>
          )}

          {/* ── Step 4: Mnemonic backup ───────────────────────────── */}
          {step === 4 && (
            <>
              <div className="flex flex-col gap-1 pt-4">
                <h1 className="text-xl font-bold" style={{ color: 'var(--foreground)' }}>
                  24単語をバックアップ
                </h1>
                <p className="text-sm" style={{ color: 'oklch(0.577 0.245 27.325)' }}>
                  ⚠️ これを失うとデバイス紛失時にデータが完全に消えます
                </p>
              </div>

              {/* Word grid */}
              <div className="grid grid-cols-3 gap-2">
                {mnemonic.split(' ').map((word, i) => (
                  <div
                    key={i}
                    className="rounded-xl px-2 py-2 text-xs"
                    style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
                  >
                    <span style={{ color: 'var(--muted-foreground)', fontSize: '10px' }}>{i + 1}. </span>
                    <span style={{ color: 'var(--foreground)', fontFamily: 'monospace' }}>{word}</span>
                  </div>
                ))}
              </div>

              {/* Backup options */}
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => navigator.clipboard.writeText(mnemonic)}
                  className="w-full py-3 rounded-xl text-sm font-semibold"
                  style={{ background: 'var(--muted)', color: 'var(--foreground)' }}
                >
                  コピー
                </button>
                <a
                  href={`mailto:?subject=${encodeURIComponent('【バックアップ】あんべの名刺代わり・復号キー')}&body=${encodeURIComponent(mnemonic)}`}
                  className="w-full py-3 rounded-xl text-sm font-semibold text-center block"
                  style={{ background: 'var(--muted)', color: 'var(--foreground)' }}
                >
                  メールで送信
                </a>
              </div>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={mnemonicBacked}
                  onChange={(e) => setMnemonicBacked(e.target.checked)}
                  className="rounded"
                  style={{ accentColor: 'oklch(0.65 0.2 250)', width: '20px', height: '20px' }}
                />
                <span className="text-sm" style={{ color: 'var(--foreground)' }}>
                  安全な場所に保管しました
                </span>
              </label>

              <button
                onClick={handleComplete}
                disabled={!mnemonicBacked || loading}
                className="w-full py-4 rounded-2xl font-bold text-white mt-auto"
                style={{
                  background: 'linear-gradient(135deg, oklch(0.45 0.15 160), oklch(0.50 0.12 180))',
                  opacity: mnemonicBacked && !loading ? 1 : 0.4,
                }}
              >
                {loading ? '準備中...' : '名刺管理を始める'}
              </button>
            </>
          )}

          {error && (
            <p className="text-sm text-center" style={{ color: 'oklch(0.577 0.245 27.325)' }}>
              {error}
            </p>
          )}
        </motion.div>
      </AnimatePresence>
        </>
      )}
    </div>
  )
}
