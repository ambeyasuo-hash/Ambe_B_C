'use client'

import { useState, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useVault } from '@/context/VaultContext'
import {
  loadBundleWithPIN,
  saveBundleWithPIN,
  saveBundleWithAlpha,
  exportAmbeFile,
  clearAllSetupData,
  type ConfigBundle,
} from '@/lib/config-bundle'
import { deriveWrappingKeyFromPIN, unwrapKey, wrapKey, randomBytes } from '@/lib/crypto'
import { registerWebAuthn, hasRegisteredCredential, isPrfEnabled } from '@/lib/webauthn'
import { testSupabaseConnection } from '@/lib/vault'
import { useRouter } from 'next/navigation'

type TestState = 'idle' | 'testing' | 'ok' | 'error'

function AccordionSection({
  title,
  children,
  danger = false,
  defaultOpen = false,
}: {
  title: string
  children: React.ReactNode
  danger?: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`rounded-2xl border overflow-hidden ${danger ? 'border-red-500/30' : 'border-white/10'}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between px-4 py-3.5 text-sm font-semibold
          ${danger ? 'text-red-400 bg-red-500/5' : 'text-foreground bg-card'}`}
      >
        <span>{title}</span>
        <span className="text-muted-foreground text-xs">{open ? '▲' : '▼'}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className={`px-4 pb-4 pt-2 flex flex-col gap-4 ${danger ? 'bg-red-500/5' : 'bg-card'}`}>
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function TestButton({ label, onTest }: { label: string; onTest: () => Promise<{ ok: boolean; message?: string }> }) {
  const [state, setState] = useState<TestState>('idle')
  const [message, setMessage] = useState('')

  const run = useCallback(async () => {
    setState('testing')
    setMessage('')
    try {
      const result = await onTest()
      if (result.ok) {
        setState('ok')
        setMessage('接続成功')
        setTimeout(() => setState('idle'), 2000)
      } else {
        setState('error')
        setMessage(result.message ?? '接続失敗')
      }
    } catch (e) {
      setState('error')
      setMessage(e instanceof Error ? e.message : '接続エラー')
    }
  }, [onTest])

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={run}
        disabled={state === 'testing'}
        className="text-xs px-3 py-1.5 rounded-xl border border-white/20 text-muted-foreground
          disabled:opacity-40 hover:bg-white/5 transition-colors"
      >
        {state === 'testing' ? '⏳ テスト中...' : '接続テスト'}
      </button>
      {state === 'ok' && <span className="text-xs text-emerald-400">✓ {message}</span>}
      {state === 'error' && <span className="text-xs text-red-400">✗ {message}</span>}
    </div>
  )
}

export default function SettingsPage() {
  const { bundle, dataKey, appState, lock } = useVault()
  const router = useRouter()

  useEffect(() => {
    if (appState !== 'UNLOCKED') router.replace('/')
  }, [appState, router])

  // ── Security: PIN change ───────────────────────────────────────────────────

  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [pinChangeStatus, setPinChangeStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [pinChangeMsg, setPinChangeMsg] = useState('')

  const handlePinChange = useCallback(async () => {
    if (!bundle) return
    if (newPin.length < 4) { setPinChangeMsg('新しいPINは4桁以上にしてください'); setPinChangeStatus('error'); return }
    if (newPin !== confirmPin) { setPinChangeMsg('新しいPINが一致しません'); setPinChangeStatus('error'); return }

    setPinChangeStatus('loading')
    setPinChangeMsg('')
    try {
      const currentBundle = await loadBundleWithPIN(currentPin)
      const saltHex = localStorage.getItem('config_bundle_pin_salt')!
      const salt = Uint8Array.from(saltHex.match(/.{2}/g)!.map((h: string) => parseInt(h, 16))) as unknown as Uint8Array<ArrayBuffer>
      const currentPinKey = await deriveWrappingKeyFromPIN(currentPin, salt)
      const dataKeyFromPin = await unwrapKey(currentPinKey, currentBundle.wrapped_data_key_pin)

      const newSalt = randomBytes(16)
      const newPinKey = await deriveWrappingKeyFromPIN(newPin, newSalt)
      const newWrappedDataKey = await wrapKey(newPinKey, dataKeyFromPin)

      const updatedBundle: ConfigBundle = {
        ...currentBundle,
        wrapped_data_key_pin: newWrappedDataKey,
      }

      await saveBundleWithPIN(newPin, updatedBundle, newSalt)

      setCurrentPin('')
      setNewPin('')
      setConfirmPin('')
      setPinChangeStatus('ok')
      setPinChangeMsg('PINを変更しました')
      setTimeout(() => setPinChangeStatus('idle'), 3000)
    } catch {
      setPinChangeStatus('error')
      setPinChangeMsg('現在のPINが正しくありません')
    }
  }, [bundle, currentPin, newPin, confirmPin])

  // ── Security: Biometric re-registration ────────────────────────────────────

  const [biometricStatus, setBiometricStatus] = useState('')
  const [biometricLoading, setBiometricLoading] = useState(false)
  const isBioRegistered = typeof window !== 'undefined' && hasRegisteredCredential()
  const isBioPrf = typeof window !== 'undefined' && isPrfEnabled()

  const handleBiometricReregister = useCallback(async () => {
    if (!bundle?.userEmail) return
    setBiometricLoading(true)
    setBiometricStatus('')
    try {
      await registerWebAuthn(bundle.userEmail, bundle.userEmail)
      if (dataKey) {
        const { loadBundleWithAlpha: _la, ...rest } = await import('@/lib/config-bundle')
        void rest
        const { assertWebAuthn } = await import('@/lib/webauthn')
        const result = await assertWebAuthn()
        if (result.kind === 'prf') {
          await saveBundleWithAlpha(result.wrappingKey, bundle)
        }
      }
      setBiometricStatus('再登録しました')
    } catch (e) {
      setBiometricStatus(e instanceof Error ? e.message : '登録に失敗しました')
    } finally {
      setBiometricLoading(false)
    }
  }, [bundle, dataKey])

  // ── API settings ───────────────────────────────────────────────────────────

  const [apiFields, setApiFields] = useState({
    supabaseUrl: bundle?.supabase.url ?? '',
    supabaseKey: bundle?.supabase.anon_key ?? '',
    azureEndpoint: bundle?.azure.endpoint ?? '',
    azureKey: bundle?.azure.key ?? '',
    geminiKey: bundle?.gemini.key ?? '',
  })
  const [apiSaving, setApiSaving] = useState(false)
  const [apiSaveMsg, setApiSaveMsg] = useState('')

  useEffect(() => {
    if (bundle) {
      setApiFields({
        supabaseUrl: bundle.supabase.url,
        supabaseKey: bundle.supabase.anon_key,
        azureEndpoint: bundle.azure.endpoint,
        azureKey: bundle.azure.key,
        geminiKey: bundle.gemini.key,
      })
    }
  }, [bundle])

  const handleApiSave = useCallback(async () => {
    if (!bundle) return
    setApiSaving(true)
    setApiSaveMsg('')
    try {
      const pinSaltHex = localStorage.getItem('config_bundle_pin_salt')
      if (!pinSaltHex) throw new Error('PINが見つかりません')
      const pin = window.prompt('API設定を保存するためPINを入力してください')
      if (!pin) { setApiSaving(false); return }

      const currentBundle = await loadBundleWithPIN(pin)
      const updatedBundle: ConfigBundle = {
        ...currentBundle,
        supabase: { url: apiFields.supabaseUrl, anon_key: apiFields.supabaseKey },
        azure: { endpoint: apiFields.azureEndpoint, key: apiFields.azureKey },
        gemini: { key: apiFields.geminiKey },
      }

      const salt = Uint8Array.from(pinSaltHex.match(/.{2}/g)!.map((h: string) => parseInt(h, 16))) as unknown as Uint8Array<ArrayBuffer>
      await saveBundleWithPIN(pin, updatedBundle, salt)

      const alphaWrapped = localStorage.getItem('config_bundle_wrapped_alpha')
      if (alphaWrapped && dataKey) {
        const { assertWebAuthn } = await import('@/lib/webauthn')
        try {
          const result = await assertWebAuthn()
          if (result.kind === 'prf') {
            await saveBundleWithAlpha(result.wrappingKey, updatedBundle)
          }
        } catch {
          // alpha update optional
        }
      }

      setApiSaveMsg('保存しました')
      setTimeout(() => setApiSaveMsg(''), 3000)
    } catch (e) {
      setApiSaveMsg(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setApiSaving(false)
    }
  }, [bundle, apiFields, dataKey])

  // ── Display settings ───────────────────────────────────────────────────────

  const [fontSize, setFontSize] = useState<ConfigBundle['fontSizePreference']>(
    bundle?.fontSizePreference ?? 'standard',
  )
  const [fontSavingMsg, setFontSavingMsg] = useState('')

  const handleFontSave = useCallback(async (newSize: ConfigBundle['fontSizePreference']) => {
    if (!bundle) return
    setFontSize(newSize)
    try {
      const pinSaltHex = localStorage.getItem('config_bundle_pin_salt')
      if (!pinSaltHex) return
      const pin = window.prompt('設定を保存するためPINを入力してください')
      if (!pin) return
      const currentBundle = await loadBundleWithPIN(pin)
      const updatedBundle: ConfigBundle = { ...currentBundle, fontSizePreference: newSize }
      const salt = Uint8Array.from(pinSaltHex.match(/.{2}/g)!.map((h: string) => parseInt(h, 16))) as unknown as Uint8Array<ArrayBuffer>
      await saveBundleWithPIN(pin, updatedBundle, salt)
      setFontSavingMsg('保存しました')
      setTimeout(() => setFontSavingMsg(''), 2000)
    } catch (e) {
      setFontSavingMsg(e instanceof Error ? e.message : '保存に失敗しました')
    }
  }, [bundle])

  // ── .ambe export ───────────────────────────────────────────────────────────

  const [ambeExporting, setAmbeExporting] = useState(false)
  const [ambeMsg, setAmbeMsg] = useState('')

  const handleAmbeExport = useCallback(async () => {
    if (!bundle) return
    const pin = window.prompt('.ambe ファイルを暗号化するPINを入力してください')
    if (!pin) return
    setAmbeExporting(true)
    setAmbeMsg('')
    try {
      const content = await exportAmbeFile(pin, bundle)
      const blob = new Blob([content], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ambe-backup-${new Date().toISOString().slice(0, 10)}.ambe`
      a.click()
      URL.revokeObjectURL(url)
      setAmbeMsg('エクスポートしました')
    } catch (e) {
      setAmbeMsg(e instanceof Error ? e.message : 'エクスポートに失敗しました')
    } finally {
      setAmbeExporting(false)
    }
  }, [bundle])

  // ── Connection tests ───────────────────────────────────────────────────────

  const testSupabase = useCallback(async () => {
    const ok = await testSupabaseConnection(apiFields.supabaseUrl, apiFields.supabaseKey)
    return ok ? { ok: true } : { ok: false, message: 'Supabaseに接続できません' }
  }, [apiFields])

  const testAzure = useCallback(async () => {
    const res = await fetch('/api/test-azure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: apiFields.azureEndpoint, key: apiFields.azureKey }),
    })
    const json = (await res.json()) as { ok?: boolean; error?: string }
    return json.ok ? { ok: true } : { ok: false, message: json.error ?? '接続失敗' }
  }, [apiFields])

  const testGemini = useCallback(async () => {
    if (!apiFields.geminiKey) return { ok: false, message: 'APIキーを入力してください' }
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiFields.geminiKey}`,
    )
    return res.ok ? { ok: true } : { ok: false, message: `HTTPエラー: ${res.status}` }
  }, [apiFields])

  // ── Copy helper ────────────────────────────────────────────────────────────

  const [copyMsg, setCopyMsg] = useState('')
  const copyToClipboard = useCallback(async (text: string, label: string) => {
    await navigator.clipboard.writeText(text)
    setCopyMsg(`${label}をコピーしました`)
    setTimeout(() => setCopyMsg(''), 2000)
  }, [])

  if (!bundle) return null

  return (
    <div className="flex flex-col gap-3 px-4 py-4 pb-8">
      <h1 className="text-base font-bold text-foreground px-1">設定</h1>

      {/* セキュリティ */}
      <AccordionSection title="🔐 セキュリティ" defaultOpen>
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground font-medium">PIN を変更する</p>
          <input
            type="password"
            inputMode="numeric"
            placeholder="現在のPIN"
            value={currentPin}
            onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
            className="w-full rounded-xl bg-background border border-white/10 px-3 py-2
              text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <input
            type="password"
            inputMode="numeric"
            placeholder="新しいPIN（4桁以上）"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
            className="w-full rounded-xl bg-background border border-white/10 px-3 py-2
              text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <input
            type="password"
            inputMode="numeric"
            placeholder="新しいPIN（確認）"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
            className="w-full rounded-xl bg-background border border-white/10 px-3 py-2
              text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handlePinChange}
            disabled={pinChangeStatus === 'loading' || !currentPin || !newPin || !confirmPin}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-400
              text-white text-sm font-semibold disabled:opacity-40"
          >
            {pinChangeStatus === 'loading' ? '変更中...' : 'PINを変更する'}
          </motion.button>
          {pinChangeMsg && (
            <p className={`text-xs ${pinChangeStatus === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
              {pinChangeMsg}
            </p>
          )}
        </div>

        <div className="border-t border-white/10 pt-4 flex flex-col gap-2">
          <p className="text-xs text-muted-foreground font-medium">生体認証</p>
          <p className="text-xs text-muted-foreground">
            {isBioRegistered
              ? `登録済み${isBioPrf ? '（PRF対応）' : '（PIN併用）'}`
              : '未登録'}
          </p>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handleBiometricReregister}
            disabled={biometricLoading}
            className="w-full py-2.5 rounded-xl bg-card border border-white/20
              text-foreground text-sm disabled:opacity-40"
          >
            {biometricLoading ? '登録中...' : '生体認証を再登録'}
          </motion.button>
          {biometricStatus && <p className="text-xs text-muted-foreground">{biometricStatus}</p>}
        </div>
      </AccordionSection>

      {/* API接続設定 */}
      <AccordionSection title="🔗 API接続設定">
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Supabase URL</label>
            <input
              value={apiFields.supabaseUrl}
              onChange={(e) => setApiFields((p) => ({ ...p, supabaseUrl: e.target.value }))}
              className="mt-1 w-full rounded-xl bg-background border border-white/10 px-3 py-2
                text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="https://xxx.supabase.co"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Supabase Anon Key</label>
            <input
              value={apiFields.supabaseKey}
              onChange={(e) => setApiFields((p) => ({ ...p, supabaseKey: e.target.value }))}
              className="mt-1 w-full rounded-xl bg-background border border-white/10 px-3 py-2
                text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="eyJhbGciOi..."
            />
          </div>
          <TestButton label="Supabase" onTest={testSupabase} />

          <div className="border-t border-white/10 pt-3">
            <label className="text-xs text-muted-foreground">Azure AI Endpoint</label>
            <input
              value={apiFields.azureEndpoint}
              onChange={(e) => setApiFields((p) => ({ ...p, azureEndpoint: e.target.value }))}
              className="mt-1 w-full rounded-xl bg-background border border-white/10 px-3 py-2
                text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="https://xxx.cognitiveservices.azure.com/"
            />
            <label className="text-xs text-muted-foreground mt-2 block">Azure Key</label>
            <input
              value={apiFields.azureKey}
              onChange={(e) => setApiFields((p) => ({ ...p, azureKey: e.target.value }))}
              className="mt-1 w-full rounded-xl bg-background border border-white/10 px-3 py-2
                text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            />
            <div className="mt-2">
              <TestButton label="Azure" onTest={testAzure} />
            </div>
          </div>

          <div className="border-t border-white/10 pt-3">
            <label className="text-xs text-muted-foreground">Gemini API Key</label>
            <input
              value={apiFields.geminiKey}
              onChange={(e) => setApiFields((p) => ({ ...p, geminiKey: e.target.value }))}
              className="mt-1 w-full rounded-xl bg-background border border-white/10 px-3 py-2
                text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="AIzaSy..."
            />
            <div className="mt-2">
              <TestButton label="Gemini" onTest={testGemini} />
            </div>
          </div>

          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handleApiSave}
            disabled={apiSaving}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-400
              text-white text-sm font-semibold disabled:opacity-40"
          >
            {apiSaving ? '保存中...' : '変更を保存'}
          </motion.button>
          {apiSaveMsg && (
            <p className={`text-xs ${apiSaveMsg.includes('失敗') ? 'text-red-400' : 'text-emerald-400'}`}>
              {apiSaveMsg}
            </p>
          )}
        </div>
      </AccordionSection>

      {/* 表示設定 */}
      <AccordionSection title="🎨 表示設定">
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">文字サイズ</p>
          <div className="flex gap-2">
            {(['small', 'standard', 'large', 'xlarge'] as const).map((size) => {
              const labels = { small: '小', standard: '標準', large: '大', xlarge: '特大' }
              return (
                <button
                  key={size}
                  onClick={() => handleFontSave(size)}
                  className={`flex-1 py-2 rounded-xl text-xs font-medium transition-all
                    ${fontSize === size
                      ? 'bg-gradient-to-r from-blue-500 to-cyan-400 text-white'
                      : 'bg-background border border-white/10 text-muted-foreground'
                    }`}
                >
                  {labels[size]}
                </button>
              )
            })}
          </div>
          {fontSavingMsg && <p className="text-xs text-emerald-400">{fontSavingMsg}</p>}
        </div>
      </AccordionSection>

      {/* GitHub Actions 生存維持 */}
      <AccordionSection title="⚙️ GitHub Actions 生存維持">
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Vercel + Supabase の無料枠を維持するために定期実行が必要な場合は、以下の値を GitHub Actions の Secrets に設定してください。
          </p>
          <div>
            <p className="text-xs text-muted-foreground mb-1">SUPABASE_URL</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-background border border-white/10 rounded-lg px-3 py-2
                text-foreground truncate">
                {bundle.supabase.url || '（未設定）'}
              </code>
              <button
                onClick={() => copyToClipboard(bundle.supabase.url, 'SUPABASE_URL')}
                className="text-xs px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-muted-foreground"
              >
                コピー
              </button>
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">SUPABASE_ANON_KEY</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-background border border-white/10 rounded-lg px-3 py-2
                text-muted-foreground truncate">
                {bundle.supabase.anon_key ? `${bundle.supabase.anon_key.slice(0, 20)}...` : '（未設定）'}
              </code>
              <button
                onClick={() => copyToClipboard(bundle.supabase.anon_key, 'SUPABASE_ANON_KEY')}
                className="text-xs px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-muted-foreground"
              >
                コピー
              </button>
            </div>
          </div>
          {copyMsg && <p className="text-xs text-emerald-400">{copyMsg}</p>}
        </div>
      </AccordionSection>

      {/* 緊急リカバリ */}
      <AccordionSection title="🆘 緊急リカバリ" danger>
        <div className="flex flex-col gap-3">
          <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              バックアップ情報は安全な場所に保管してください。紛失するとデータを復元できません。
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground font-medium">24単語バックアップ</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              セキュリティセットアップ時に表示された24単語がバックアップフレーズです。安全な場所に記録しておいてください。
            </p>
          </div>

          <div className="flex flex-col gap-2 border-t border-red-500/20 pt-3">
            <p className="text-xs text-muted-foreground font-medium">.ambe ファイルをエクスポート</p>
            <p className="text-xs text-muted-foreground">
              設定データを暗号化ファイルとして保存します。PINでの確認が必要です。
            </p>
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={handleAmbeExport}
              disabled={ambeExporting}
              className="w-full py-2.5 rounded-xl border border-red-500/30 text-red-400 text-sm disabled:opacity-40"
            >
              {ambeExporting ? 'エクスポート中...' : '📁 .ambe をエクスポート'}
            </motion.button>
            {ambeMsg && <p className="text-xs text-muted-foreground">{ambeMsg}</p>}
          </div>
        </div>
      </AccordionSection>

      {/* データ管理 */}
      <AccordionSection title="🗑 データ管理" danger>
        <div className="flex flex-col gap-3">
          <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-3">
            <p className="text-xs font-bold text-red-400 mb-1">⚠️ 全データを削除します</p>
            <p className="text-xs text-muted-foreground">
              認証データと設定をすべて削除して最初からやり直します。Supabase内のデータは削除されません。
            </p>
          </div>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => {
              if (window.confirm('本当に最初からやり直しますか？この操作は取り消せません。')) {
                clearAllSetupData()
                window.location.reload()
              }
            }}
            className="w-full py-3 rounded-2xl text-white text-sm font-semibold"
            style={{ background: 'oklch(0.577 0.245 27.325)' }}
          >
            削除して最初からやり直す
          </motion.button>
          <button
            onClick={() => lock()}
            className="w-full py-2.5 rounded-xl bg-card border border-white/10 text-muted-foreground text-sm"
          >
            🔒 今すぐロック
          </button>
        </div>
      </AccordionSection>
    </div>
  )
}
