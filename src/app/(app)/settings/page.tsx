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
import QRPairingExport from '@/components/QRPairingExport'
import { PinConfirmModal } from '@/components/PinConfirmModal'
import { SUPABASE_SETUP_SQL } from '@/lib/setup-sql'

// ── Helpers ───────────────────────────────────────────────────────────────────

type TestState = 'idle' | 'testing' | 'ok' | 'error'

function AccordionSection({
  title,
  children,
  variant = 'default',
  defaultOpen = false,
}: {
  title: string
  children: React.ReactNode
  variant?: 'default' | 'danger' | 'warning'
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const styles = {
    default: {
      wrapper: 'border-white/10',
      header: 'text-foreground bg-card',
      body: 'bg-card',
    },
    danger: {
      wrapper: 'border-red-500/30',
      header: 'text-red-400 bg-red-500/5',
      body: 'bg-red-500/5',
    },
    warning: {
      wrapper: 'border-amber-500/30',
      header: 'text-amber-400 bg-amber-500/5',
      body: 'bg-amber-500/5',
    },
  }[variant]

  return (
    <div className={`rounded-2xl border overflow-hidden ${styles.wrapper}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between px-4 py-3.5 text-sm font-semibold ${styles.header}`}
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
            <div className={`px-4 pb-4 pt-2 flex flex-col gap-4 ${styles.body}`}>
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

function ServiceAccordion({
  title,
  badge,
  children,
  defaultOpen,
}: {
  title: string
  badge?: React.ReactNode
  children: React.ReactNode
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border border-white/10 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground">{title}</span>
          {badge}
        </div>
        <span className="text-muted-foreground text-xs">{open ? '▲' : '▼'}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1 flex flex-col gap-2">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const FONT_SIZE_MAP: Record<ConfigBundle['fontSizePreference'], string> = {
  small: 'text-sm',
  standard: 'text-base',
  large: 'text-lg',
  xlarge: 'text-xl',
}

export default function SettingsPage() {
  const { bundle, dataKey, appState, lock, updateBundle } = useVault()
  const router = useRouter()

  const [mnemonicConfirmed, setMnemonicConfirmed] = useState(false)
  useEffect(() => {
    setMnemonicConfirmed(localStorage.getItem('mnemonic_confirmed') === '1')
  }, [])

  useEffect(() => {
    if (appState !== 'UNLOCKED') router.replace('/')
  }, [appState, router])

  // ── PIN Confirmation Modal ─────────────────────────────────────────────────

  const [pinModal, setPinModal] = useState<{
    show: boolean
    title: string
    onConfirm: (pin: string) => void
  } | null>(null)

  // ── QR Pairing Export ─────────────────────────────────────────────────────

  const [showQRExport, setShowQRExport] = useState(false)

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
      const saltHex = currentBundle.pin_salt ?? localStorage.getItem('config_bundle_pin_salt')!
      const salt = Uint8Array.from(saltHex.match(/.{2}/g)!.map((h: string) => parseInt(h, 16))) as unknown as Uint8Array<ArrayBuffer>
      const currentPinKey = await deriveWrappingKeyFromPIN(currentPin, salt)
      const dataKeyFromPin = await unwrapKey(currentPinKey, currentBundle.wrapped_data_key_pin)

      const newSalt = randomBytes(16)
      const newPinKey = await deriveWrappingKeyFromPIN(newPin, newSalt)
      const newWrappedDataKey = await wrapKey(newPinKey, dataKeyFromPin)

      const updatedBundle: ConfigBundle = { ...currentBundle, wrapped_data_key_pin: newWrappedDataKey }
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
    if (!bundle) return
    setBiometricLoading(true)
    setBiometricStatus('')
    try {
      // userEmail が空の場合は encryption_salt を代替 ID として使用
      const userId = bundle.userEmail || bundle.encryption_salt
      await registerWebAuthn(userId, userId)
      // 旧 alpha bundle をクリア。次回 PIN ログイン時に PRF Upgrade で再生成される
      // (Windows Chrome での二重プロンプト防止のため assertWebAuthn はここでは呼ばない)
      localStorage.removeItem('config_bundle_wrapped_alpha')
      setBiometricStatus('再登録しました。次回ロック解除時に生体認証が有効になります')
    } catch (e) {
      setBiometricStatus(e instanceof Error ? e.message : '登録に失敗しました')
    } finally {
      setBiometricLoading(false)
    }
  }, [bundle])

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
  const [showSql, setShowSql] = useState(false)
  const [sqlCopied, setSqlCopied] = useState(false)
  const [mnemonicWords, setMnemonicWords] = useState<string | null>(null)
  const [keepAliveConfirmed, setKeepAliveConfirmed] = useState(false)

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

  useEffect(() => {
    setMnemonicWords(localStorage.getItem('mnemonic_words'))
    setKeepAliveConfirmed(localStorage.getItem('keep_alive_confirmed') === '1')
  }, [])

  const handleApiSave = useCallback(async () => {
    if (!bundle) return
    setApiSaving(true)
    setApiSaveMsg('')
    setPinModal({
      show: true,
      title: 'API設定を保存するためPINを入力してください',
      onConfirm: async (pin: string) => {
        try {
          if (!pin) return
          const pinSaltHex = localStorage.getItem('config_bundle_pin_salt')
          if (!pinSaltHex) throw new Error('PINが見つかりません')

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
              // alpha 更新は任意
            }
          }

          updateBundle(updatedBundle)
          setApiSaveMsg('保存しました')
          setPinModal(null)
          setTimeout(() => setApiSaveMsg(''), 3000)
        } catch (e) {
          setApiSaveMsg(e instanceof Error ? e.message : '保存に失敗しました')
        } finally {
          setApiSaving(false)
        }
      },
    })
  }, [bundle, apiFields, dataKey, updateBundle])

  // ── Display settings ───────────────────────────────────────────────────────

  const [fontSize, setFontSize] = useState<ConfigBundle['fontSizePreference']>(
    bundle?.fontSizePreference ?? 'standard',
  )
  const [fontSavingMsg, setFontSavingMsg] = useState('')

  const applyFontSize = useCallback((size: ConfigBundle['fontSizePreference']) => {
    document.documentElement.classList.remove(...Object.values(FONT_SIZE_MAP))
    document.documentElement.classList.add(FONT_SIZE_MAP[size])
  }, [])

  const handleFontSave = useCallback((newSize: ConfigBundle['fontSizePreference']) => {
    if (!bundle) return
    setFontSize(newSize)
    setPinModal({
      show: true,
      title: '設定を保存するためPINを入力してください',
      onConfirm: async (pin: string) => {
        try {
          if (!pin) return
          const pinSaltHex = localStorage.getItem('config_bundle_pin_salt')
          if (!pinSaltHex) return
          const currentBundle = await loadBundleWithPIN(pin)
          const updatedBundle: ConfigBundle = { ...currentBundle, fontSizePreference: newSize }
          const salt = Uint8Array.from(pinSaltHex.match(/.{2}/g)!.map((h: string) => parseInt(h, 16))) as unknown as Uint8Array<ArrayBuffer>
          await saveBundleWithPIN(pin, updatedBundle, salt)
          updateBundle(updatedBundle)
          applyFontSize(newSize)
          setFontSavingMsg('保存しました')
          setPinModal(null)
          setTimeout(() => setFontSavingMsg(''), 2000)
        } catch (e) {
          setFontSavingMsg(e instanceof Error ? e.message : '保存に失敗しました')
        }
      },
    })
  }, [bundle, updateBundle, applyFontSize])

  // ── .ambe export ───────────────────────────────────────────────────────────

  const [ambeExporting, setAmbeExporting] = useState(false)
  const [ambeMsg, setAmbeMsg] = useState('')

  const handleAmbeExport = useCallback(async () => {
    if (!bundle) return
    setAmbeExporting(true)
    setAmbeMsg('')
    setPinModal({
      show: true,
      title: '.ambe ファイルを暗号化するPINを入力してください',
      onConfirm: async (pin: string) => {
        try {
          if (!pin) return
          const content = await exportAmbeFile(pin, bundle)
          const parsed = JSON.parse(content) as { ambe_generation?: number }
          const gen = parsed.ambe_generation ?? 1
          const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
          const blob = new Blob([content], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `ambe-config-${date}-gen${gen}.ambe`
          a.click()
          URL.revokeObjectURL(url)
          // VaultContext の bundle も world generation を更新
          const updatedBundle: ConfigBundle = {
            ...bundle,
            ambe_generation: gen,
            last_exported_at: new Date().toISOString(),
          }
          updateBundle(updatedBundle)
          setAmbeMsg(`エクスポートしました（世代 ${gen}）`)
          setPinModal(null)
        } catch (e) {
          setAmbeMsg(e instanceof Error ? e.message : 'エクスポートに失敗しました')
        } finally {
          setAmbeExporting(false)
        }
      },
    })
  }, [bundle, updateBundle])

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

  // ── Copy helpers ───────────────────────────────────────────────────────────

  const [copyMsg, setCopyMsg] = useState('')
  const copyToClipboard = useCallback(async (text: string, label: string) => {
    await navigator.clipboard.writeText(text)
    setCopyMsg(`${label}をコピーしました`)
    setTimeout(() => setCopyMsg(''), 2000)
  }, [])

  const handleCopySql = useCallback(async () => {
    await navigator.clipboard.writeText(SUPABASE_SETUP_SQL)
    setSqlCopied(true)
    setTimeout(() => setSqlCopied(false), 2000)
  }, [])

  const handleCopyMnemonic = useCallback(async () => {
    if (!mnemonicWords) return
    await navigator.clipboard.writeText(mnemonicWords)
    setCopyMsg('24単語をコピーしました')
    setTimeout(() => setCopyMsg(''), 2000)
  }, [mnemonicWords])

  const handleVcfExport = useCallback(() => {
    if (!mnemonicWords) return
    const vcf = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:あんべの名刺代わり',
      `NOTE:${mnemonicWords}`,
      'END:VCARD',
    ].join('\r\n')
    const blob = new Blob([vcf], { type: 'text/vcard' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'ambe-recovery.vcf'
    a.click()
    URL.revokeObjectURL(url)
  }, [mnemonicWords])

  const handleKeepAliveConfirm = useCallback((checked: boolean) => {
    localStorage.setItem('keep_alive_confirmed', checked ? '1' : '0')
    setKeepAliveConfirmed(checked)
  }, [])

  if (!bundle) return null

  return (
    <div className="flex flex-col gap-3 px-4 py-4 pb-8">
      <h1 className="text-base font-bold text-foreground px-1">設定</h1>

      {/* バックアップ未確認バナー */}
      {!mnemonicConfirmed && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 flex flex-col gap-2">
          <p className="text-xs font-semibold text-amber-400">⚠️ 24単語のバックアップが未確認です</p>
          <p className="text-xs text-amber-300/70 leading-relaxed">
            セットアップ時に表示された24単語を紙などに保管しましたか？デバイスを失った場合の唯一の復元手段です。
          </p>
          <p className="text-xs text-amber-300/50 leading-relaxed">
            ※ セキュリティ上、24単語はこの画面では再表示できません。
          </p>
          <div className="flex gap-2 mt-1">
            <button
              onClick={() => {
                localStorage.setItem('mnemonic_confirmed', '1')
                setMnemonicConfirmed(true)
              }}
              className="flex-1 rounded-xl bg-amber-500/20 px-3 py-1.5 text-xs text-amber-300 border border-amber-500/30
                hover:bg-amber-500/30 transition-colors"
            >
              ✓ 保管済みにする
            </button>
            <button
              onClick={() => router.push('/lock?mode=mnemonic')}
              className="flex-1 rounded-xl bg-white/5 px-3 py-1.5 text-xs text-muted-foreground border border-white/10
                hover:bg-white/10 transition-colors"
            >
              24単語でリカバリー →
            </button>
          </div>
        </div>
      )}

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
          {biometricStatus && (
            <p className={`text-xs ${biometricStatus.includes('失敗') ? 'text-red-400' : 'text-emerald-400'}`}>
              {biometricStatus}
            </p>
          )}
        </div>

        <div className="border-t border-white/10 pt-4 flex flex-col gap-2">
          <p className="text-xs text-muted-foreground font-medium">別端末への引き継ぎ</p>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => setShowQRExport(true)}
            className="w-full py-2.5 rounded-xl bg-card border border-white/20
              text-foreground text-sm"
          >
            📱 別端末へQRで転送
          </motion.button>
        </div>
      </AccordionSection>

      {showQRExport && bundle && (
        <QRPairingExport bundle={bundle} onClose={() => setShowQRExport(false)} />
      )}

      {/* API接続設定 */}
      <AccordionSection title="🔗 API接続設定">
        <div className="flex flex-col gap-3">
          {/* Supabase */}
          <ServiceAccordion
            title="Supabase"
            badge={apiFields.supabaseUrl && apiFields.supabaseKey
              ? <span className="text-xs text-emerald-400">✓ 設定済み</span>
              : undefined}
            defaultOpen={!(apiFields.supabaseUrl && apiFields.supabaseKey)}
          >
            <a
              href="https://supabase.com/dashboard"
              target="_blank"
              rel="noopener noreferrer"
              className="self-end text-xs text-blue-400 hover:text-blue-300"
            >
              → ダッシュボードで取得 ↗
            </a>
            <input
              value={apiFields.supabaseUrl}
              onChange={(e) => setApiFields((p) => ({ ...p, supabaseUrl: e.target.value }))}
              className="w-full rounded-xl bg-background border border-white/10 px-3 py-2
                text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="https://xxx.supabase.co"
            />
            <input
              value={apiFields.supabaseKey}
              onChange={(e) => setApiFields((p) => ({ ...p, supabaseKey: e.target.value }))}
              className="w-full rounded-xl bg-background border border-white/10 px-3 py-2
                text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="eyJhbGciOi..."
            />
            <TestButton label="Supabase" onTest={testSupabase} />
            {/* セットアップ SQL */}
            <div className="rounded-xl border border-white/10 bg-background overflow-hidden">
              <button
                onClick={() => setShowSql((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs text-muted-foreground
                  hover:bg-white/5 transition-colors"
              >
                <span>📋 初回セットアップ SQL</span>
                <span>{showSql ? '▲' : '▼'}</span>
              </button>
              <AnimatePresence initial={false}>
                {showSql && (
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: 'auto' }}
                    exit={{ height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-3 pb-3 flex flex-col gap-2">
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Supabase Dashboard → SQL Editor に貼り付けて実行してください。
                      </p>
                      <div className="flex gap-2">
                        <motion.button
                          whileTap={{ scale: 0.97 }}
                          onClick={handleCopySql}
                          className="flex-1 py-1.5 rounded-lg bg-gradient-to-r from-blue-500 to-cyan-400
                            text-white text-xs font-semibold"
                        >
                          {sqlCopied ? '✓ コピーしました' : 'SQLをコピー'}
                        </motion.button>
                        <a
                          href="https://supabase.com/dashboard/project/_/sql/new"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 py-1.5 rounded-lg border border-white/20 text-muted-foreground text-xs
                            text-center hover:bg-white/5 transition-colors"
                        >
                          SQL Editor を開く ↗
                        </a>
                      </div>
                      <pre className="text-xs text-muted-foreground bg-black/30 rounded-lg p-3
                        overflow-x-auto max-h-48 whitespace-pre leading-relaxed">
                        {SUPABASE_SETUP_SQL}
                      </pre>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </ServiceAccordion>

          {/* Azure */}
          <ServiceAccordion
            title="Azure AI Document Intelligence"
            badge={apiFields.azureEndpoint && apiFields.azureKey
              ? <span className="text-xs text-emerald-400">✓ 設定済み</span>
              : undefined}
            defaultOpen={!(apiFields.azureEndpoint && apiFields.azureKey)}
          >
            <a
              href="https://portal.azure.com"
              target="_blank"
              rel="noopener noreferrer"
              className="self-end text-xs text-blue-400 hover:text-blue-300"
            >
              → Portal で取得 ↗
            </a>
            <input
              value={apiFields.azureEndpoint}
              onChange={(e) => setApiFields((p) => ({ ...p, azureEndpoint: e.target.value }))}
              className="w-full rounded-xl bg-background border border-white/10 px-3 py-2
                text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="https://xxx.cognitiveservices.azure.com/"
            />
            <input
              value={apiFields.azureKey}
              onChange={(e) => setApiFields((p) => ({ ...p, azureKey: e.target.value }))}
              className="w-full rounded-xl bg-background border border-white/10 px-3 py-2
                text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            />
            <TestButton label="Azure" onTest={testAzure} />
          </ServiceAccordion>

          {/* Gemini */}
          <ServiceAccordion
            title="Gemini（任意）"
            badge={apiFields.geminiKey
              ? <span className="text-xs text-emerald-400">✓ 設定済み</span>
              : undefined}
            defaultOpen={!apiFields.geminiKey}
          >
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="self-end text-xs text-blue-400 hover:text-blue-300"
            >
              → AI Studio で取得 ↗
            </a>
            <input
              value={apiFields.geminiKey}
              onChange={(e) => setApiFields((p) => ({ ...p, geminiKey: e.target.value }))}
              className="w-full rounded-xl bg-background border border-white/10 px-3 py-2
                text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="AIzaSy..."
            />
            <TestButton label="Gemini" onTest={testGemini} />
          </ServiceAccordion>

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
          {keepAliveConfirmed && (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
              <span className="text-xs text-emerald-400 font-semibold">✓ 生存維持 有効</span>
            </div>
          )}
          <p className="text-xs text-muted-foreground leading-relaxed">
            Supabase 無料プランの自動停止を防ぐため、GitHub Actions テンプレートを設定してください。
          </p>

          {/* 手順 1 */}
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-muted-foreground font-medium">① テンプレートをコピー</p>
            <a
              href="https://github.com/ambeyasuo-hash/Ambe_B_C"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 py-2 rounded-xl border border-white/20
                text-foreground text-xs font-medium hover:bg-white/5 transition-colors"
            >
              Use this template ↗
            </a>
          </div>

          {/* 手順 2 */}
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-muted-foreground font-medium">② Secrets に登録する値</p>
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
            <a
              href="https://github.com/ambeyasuo-hash/Ambe_B_C/settings/secrets/actions"
              target="_blank"
              rel="noopener noreferrer"
              className="self-start text-xs text-blue-400 hover:text-blue-300"
            >
              → GitHub Secrets 設定ページを開く ↗
            </a>
          </div>

          {/* 手順 3: 疎通テスト */}
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-muted-foreground font-medium">③ 疎通テスト</p>
            <TestButton label="Supabase 疎通テスト" onTest={testSupabase} />
          </div>

          {/* 設定済み確認 */}
          <label className="flex items-center gap-3 cursor-pointer rounded-xl border border-white/10 px-3 py-2.5">
            <input
              type="checkbox"
              checked={keepAliveConfirmed}
              onChange={(e) => handleKeepAliveConfirm(e.target.checked)}
              className="rounded"
            />
            <span className="text-xs text-foreground">設定が完了しました（生存維持 有効にする）</span>
          </label>

          {copyMsg && <p className="text-xs text-emerald-400">{copyMsg}</p>}
        </div>
      </AccordionSection>

      {/* 緊急リカバリ */}
      <AccordionSection title="🔴 緊急リカバリ (Emergency Recovery)" variant="warning">
        <div className="flex flex-col gap-3">
          <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3">
            <p className="text-xs text-amber-300/80 leading-relaxed">
              バックアップ情報は安全な場所に保管してください。紛失するとデータを復元できません。
            </p>
          </div>

          {/* 24単語バックアップ 3導線 */}
          <div className="flex flex-col gap-2">
            <p className="text-xs text-amber-400 font-medium">24単語バックアップ</p>
            {mnemonicWords ? (
              <>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  セットアップ時の24単語を各導線で保管してください。
                </p>
                <div className="flex flex-col gap-2">
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={handleCopyMnemonic}
                    className="w-full py-2 rounded-xl border border-amber-500/30 text-amber-400 text-xs
                      hover:bg-amber-500/10 transition-colors"
                  >
                    📋 コピー
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={handleVcfExport}
                    className="w-full py-2 rounded-xl border border-amber-500/30 text-amber-400 text-xs
                      hover:bg-amber-500/10 transition-colors"
                  >
                    👤 .vcf エクスポート（連絡先に保存）
                  </motion.button>
                  <a
                    href={`mailto:?subject=${encodeURIComponent('【バックアップ】あんべの名刺代わり・復号キー')}&body=${encodeURIComponent(mnemonicWords)}`}
                    className="w-full py-2 rounded-xl border border-amber-500/30 text-amber-400 text-xs
                      text-center hover:bg-amber-500/10 transition-colors block"
                  >
                    ✉️ メールで送信
                  </a>
                </div>
              </>
            ) : (
              <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 px-3 py-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  セットアップ時に記録した24単語を使用してください。
                </p>
                <p className="text-xs text-amber-300/60 mt-1 leading-relaxed">
                  24単語はセットアップ画面にのみ表示されます。この画面での再表示はできません。
                </p>
              </div>
            )}
            {copyMsg && <p className="text-xs text-emerald-400">{copyMsg}</p>}
          </div>

          {/* 24単語リカバリー入力 */}
          <div className="flex flex-col gap-2 border-t border-amber-500/20 pt-3">
            <p className="text-xs text-amber-400 font-medium">24単語でリカバリー（完全全滅時）</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              デバイスと .ambe ファイルを両方失った場合、24単語と Supabase 接続情報があればデータを復元できます。
            </p>
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => router.push('/lock?mode=mnemonic')}
              className="w-full py-2 rounded-xl border border-amber-500/30 text-amber-400 text-xs
                hover:bg-amber-500/10 transition-colors"
            >
              🔑 24単語リカバリーを開始する →
            </motion.button>
          </div>

          <div className="flex flex-col gap-2 border-t border-amber-500/20 pt-3">
            <p className="text-xs text-amber-400 font-medium">.ambe ファイルをエクスポート</p>
            <p className="text-xs text-muted-foreground">
              設定データを暗号化ファイルとして保存します。PINでの確認が必要です。
            </p>
            {bundle.last_exported_at && (
              <p className="text-xs text-muted-foreground">
                前回エクスポート: {new Date(bundle.last_exported_at).toLocaleDateString('ja-JP')}（世代 {bundle.ambe_generation}）
              </p>
            )}
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={handleAmbeExport}
              disabled={ambeExporting}
              className="w-full py-2.5 rounded-xl border border-amber-500/30 text-amber-400 text-sm disabled:opacity-40"
            >
              {ambeExporting ? 'エクスポート中...' : '📁 .ambe をエクスポート'}
            </motion.button>
            {ambeMsg && <p className="text-xs text-amber-300/70">{ambeMsg}</p>}
          </div>
        </div>
      </AccordionSection>

      {/* データ管理 */}
      <AccordionSection title="🗑 データ管理" variant="danger">
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
            className="w-full py-3 rounded-2xl bg-destructive text-white text-sm font-semibold"
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

      {/* PinConfirmModal */}
      {pinModal && (
        <PinConfirmModal
          title={pinModal.title}
          onConfirm={pinModal.onConfirm}
          onCancel={() => {
            setPinModal(null)
            setApiSaving(false)
            setAmbeExporting(false)
          }}
        />
      )}
    </div>
  )
}
