'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { assertWebAuthn, hasRegisteredCredential } from '@/lib/webauthn'
import {
  loadBundleWithAlpha,
  loadBundleWithPIN,
  hasBundleAlpha,
  saveBundleWithAlpha,
  saveBundleWithPIN,
  clearAllSetupData,
  importAmbeFile,
  type ConfigBundle,
} from '@/lib/config-bundle'
import { unlockWithAlpha } from '@/lib/vault'
import { fetchVaultRow } from '@/lib/vault'
import { useVault } from '@/context/VaultContext'
import { validateMnemonic24, deriveWrappingKeyFromMnemonic, deriveEncryptionSalt } from '@/lib/mnemonic'
import QRPairingImport from '@/components/QRPairingImport'

type LockMode = 'biometric' | 'pin' | 'reset' | 'ambe' | 'mnemonic' | 'qr-import'

export default function LockScreen({ initialMode }: { initialMode?: LockMode }) {
  const { unlock } = useVault()
  const [mode, setMode] = useState<LockMode>(initialMode ?? 'biometric')
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [recoveryExpanded, setRecoveryExpanded] = useState(false)
  const [canUseBiometric, setCanUseBiometric] = useState(false)
  // PRF assertion 成功後、bundle が PIN 暗号化のままだった場合に upgrade するための key 保持
  const pendingPrfKey = useRef<CryptoKey | null>(null)

  // .ambe recovery state
  const [ambeContent, setAmbeContent] = useState('')
  const [ambeFileName, setAmbeFileName] = useState('')
  const [ambeExportPin, setAmbeExportPin] = useState('')
  const [ambeAppPin, setAmbeAppPin] = useState('')
  const ambeFileRef = useRef<HTMLInputElement>(null)

  // Mnemonic recovery state (2 steps)
  const [mnemonicWords, setMnemonicWords] = useState('')
  const [mnemonicSupabaseUrl, setMnemonicSupabaseUrl] = useState('')
  const [mnemonicSupabaseKey, setMnemonicSupabaseKey] = useState('')
  const [mnemonicNewPin, setMnemonicNewPin] = useState('')
  const [mnemonicStep, setMnemonicStep] = useState<1 | 2>(1)
  const pendingMnemonicDataKey = useRef<CryptoKey | null>(null)
  const pendingMnemonicVaultBeta = useRef<string>('')
  const pendingMnemonicEncSalt = useRef<string>('')

  // Check localStorage only on client
  useEffect(() => {
    setCanUseBiometric(hasRegisteredCredential() && hasBundleAlpha())
  }, [])

  function resetToMode(m: LockMode) {
    setMode(m)
    setError('')
    setPin('')
    setAmbeContent('')
    setAmbeFileName('')
    setAmbeExportPin('')
    setAmbeAppPin('')
    setMnemonicWords('')
    setMnemonicSupabaseUrl('')
    setMnemonicSupabaseKey('')
    setMnemonicNewPin('')
    setMnemonicStep(1)
    pendingMnemonicDataKey.current = null
    pendingMnemonicVaultBeta.current = ''
    pendingMnemonicEncSalt.current = ''
    setRecoveryExpanded(false)
  }

  // ── Biometric unlock ───────────────────────────────────────────────────

  async function handleBiometric() {
    setLoading(true)
    setError('')
    try {
      // このブラウザ/アプリでセットアップされていない場合（Safari + Chrome 別々など）
      if (!hasRegisteredCredential() || !hasBundleAlpha()) {
        setError(
          'この端末・ブラウザではまだセットアップされていません。' +
          '「別の方法で復旧する」→「別端末からQRで引き継ぐ」か、' +
          '「24単語で復旧」でデータを引き継いでください。',
        )
        setLoading(false)
        return
      }

      const result = await assertWebAuthn()
      if (result.kind === 'prf') {
        // PRF assertion 成功 → bundle が PRF key で暗号化されていれば直接復号
        try {
          const bundle = await loadBundleWithAlpha(result.wrappingKey)
          const dataKey = await unlockWithAlpha(result.wrappingKey, bundle)
          unlock(dataKey, bundle)
        } catch {
          // bundle がまだ PIN key で暗号化されている（初回 PRF ログイン）
          pendingPrfKey.current = result.wrappingKey
          setError('初回のみPINの入力が必要です（次回から生体認証のみでログインできます）')
          setMode('pin')
        }
      } else {
        // PRF 非対応 (iOS Safari / iOS Chrome): 生体認証は通過済み → PIN で復号
        setError('この端末では生体認証後にPINの入力が必要です')
        setMode('pin')
      }
    } catch (e) {
      setError((e as Error).message)
      setMode('pin')
    } finally {
      setLoading(false)
    }
  }

  // ── PIN unlock ─────────────────────────────────────────────────────────

  async function handlePIN() {
    if (pin.length < 4) return
    setLoading(true)
    setError('')
    try {
      const bundle = await loadBundleWithPIN(pin)

      // 旧フォーマット検出
      if (!bundle.wrapped_data_key_pin) {
        setError('保存データが古いフォーマットです。「最初からやり直す」で再設定してください。')
        setMode('reset')
        setLoading(false)
        return
      }

      const { deriveWrappingKeyFromPIN, unwrapKey } = await import('@/lib/crypto')
      // pin_salt は bundle 内に保持（旧環境は localStorage にフォールバック）
      const saltHex = bundle.pin_salt ?? localStorage.getItem('config_bundle_pin_salt')!
      const salt = Uint8Array.from(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)))
      const pinKey = await deriveWrappingKeyFromPIN(pin, salt)
      const dataKey = await unwrapKey(pinKey, bundle.wrapped_data_key_pin)

      // PRF アップグレード: 初回 PIN ログイン後に bundle を PRF key で再暗号化
      if (pendingPrfKey.current) {
        try {
          const { wrapKey } = await import('@/lib/crypto')
          const rewrappedAlpha = await wrapKey(pendingPrfKey.current, dataKey)
          const upgradedBundle = { ...bundle, wrapped_data_key_alpha: rewrappedAlpha }
          await saveBundleWithAlpha(pendingPrfKey.current, upgradedBundle)
          pendingPrfKey.current = null
        } catch {
          // アップグレード失敗は致命的ではない
        }
      }

      unlock(dataKey, bundle)
    } catch {
      setError('PINが正しくありません')
      setPin('')
    } finally {
      setLoading(false)
    }
  }

  // ── .ambe file recovery ────────────────────────────────────────────────

  function handleAmbeFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setAmbeFileName(file.name)
    const reader = new FileReader()
    reader.onload = (ev) => setAmbeContent(ev.target?.result as string ?? '')
    reader.readAsText(file)
  }

  async function handleAmbeRecover() {
    if (!ambeContent || !ambeExportPin || !ambeAppPin) return
    setLoading(true)
    setError('')
    try {
      // 1. .ambe ファイルを ambe エクスポート PIN で復号
      const bundle = await importAmbeFile(ambeExportPin, ambeContent)

      // 2. bundle 内の pin_salt を使って Data Key を復元
      const saltHex = bundle.pin_salt
      if (!saltHex) {
        setError('この .ambe ファイルは古い形式です。24単語リカバリをお使いください。')
        return
      }

      const { deriveWrappingKeyFromPIN, unwrapKey } = await import('@/lib/crypto')
      const salt = Uint8Array.from(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)))
      const pinKey = await deriveWrappingKeyFromPIN(ambeAppPin, salt)
      const dataKey = await unwrapKey(pinKey, bundle.wrapped_data_key_pin)

      // 3. localStorage に復元して保存
      const saltTyped = new Uint8Array(salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength)) as Uint8Array<ArrayBuffer>
      await saveBundleWithPIN(ambeAppPin, bundle, saltTyped)
      await saveBundleWithAlpha(pinKey, bundle)  // alpha = pin key（次回ログイン時に PRF Upgrade）

      unlock(dataKey, bundle)
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      if (msg.includes('decrypt') || msg.includes('OperationError') || msg.includes('復号')) {
        setError('.ambeファイルのPINまたはアプリのPINが正しくありません')
      } else {
        setError('復元に失敗しました: ' + (msg || '不明なエラー'))
      }
      setAmbeAppPin('')
    } finally {
      setLoading(false)
    }
  }

  // ── Mnemonic (24-word) disaster recovery ──────────────────────────────

  async function handleMnemonicStep1() {
    setLoading(true)
    setError('')
    try {
      const words = mnemonicWords.trim().toLowerCase().replace(/\s+/g, ' ')
      if (!validateMnemonic24(words)) {
        setError('24単語が正しくありません。スペルと順序を確認してください。')
        return
      }
      if (!mnemonicSupabaseUrl.trim() || !mnemonicSupabaseKey.trim()) {
        setError('Supabase の接続情報を入力してください')
        return
      }

      // encryption_salt を mnemonic から決定論的に導出
      const encSalt = await deriveEncryptionSalt(words)

      // Supabase から wrapped_data_key_beta を取得
      const vaultRow = await fetchVaultRow({
        supabase: { url: mnemonicSupabaseUrl.trim(), anon_key: mnemonicSupabaseKey.trim() },
        encryption_salt: encSalt,
      })
      if (!vaultRow) {
        setError('Supabase にデータが見つかりません。接続情報と24単語を確認してください。')
        return
      }

      // mnemonic から beta key を導出して Data Key を復元
      const betaKey = await deriveWrappingKeyFromMnemonic(words)
      const { unwrapKey } = await import('@/lib/crypto')
      const dataKey = await unwrapKey(betaKey, vaultRow.wrapped_data_key_beta)

      pendingMnemonicDataKey.current = dataKey
      pendingMnemonicVaultBeta.current = vaultRow.wrapped_data_key_beta
      pendingMnemonicEncSalt.current = encSalt
      setMnemonicStep(2)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'リカバリに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  async function handleMnemonicStep2() {
    if (!pendingMnemonicDataKey.current) return
    if (mnemonicNewPin.length < 4) return
    setLoading(true)
    setError('')
    try {
      const { deriveWrappingKeyFromPIN, wrapKey, randomBytes } = await import('@/lib/crypto')

      const newPinSalt = randomBytes(16)
      const newPinKey = await deriveWrappingKeyFromPIN(mnemonicNewPin, newPinSalt)
      const [newWrappedAlpha, newWrappedPin] = await Promise.all([
        wrapKey(newPinKey, pendingMnemonicDataKey.current),
        wrapKey(newPinKey, pendingMnemonicDataKey.current),
      ])

      const pinSaltHex = Array.from(newPinSalt).map((b) => b.toString(16).padStart(2, '0')).join('')
      const words = mnemonicWords.trim().toLowerCase().replace(/\s+/g, ' ')
      const betaKey = await deriveWrappingKeyFromMnemonic(words)
      const { wrapKey: wrapKey2 } = await import('@/lib/crypto')
      const newWrappedBeta = await wrapKey2(betaKey, pendingMnemonicDataKey.current)

      const restoredBundle: ConfigBundle = {
        v: 1,
        encryption_salt: pendingMnemonicEncSalt.current,
        ambe_generation: 1,
        last_exported_at: new Date().toISOString(),
        supabase: { url: mnemonicSupabaseUrl.trim(), anon_key: mnemonicSupabaseKey.trim() },
        azure: { endpoint: '', key: '' },
        gemini: { key: '' },
        wrapped_data_key_alpha: newWrappedAlpha,
        wrapped_data_key_pin: newWrappedPin,
        wrapped_data_key_beta: newWrappedBeta,
        pin_salt: pinSaltHex,
        userEmail: '',
        fontSizePreference: 'standard',
      }

      const newPinSaltTyped = newPinSalt as Uint8Array<ArrayBuffer>
      await saveBundleWithPIN(mnemonicNewPin, restoredBundle, newPinSaltTyped)
      await saveBundleWithAlpha(newPinKey, restoredBundle)

      unlock(pendingMnemonicDataKey.current, restoredBundle)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'リカバリに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  // ── Reset ──────────────────────────────────────────────────────────────

  function handleReset() {
    clearAllSetupData()
    window.location.reload()
  }

  // ── Shared button styles ───────────────────────────────────────────────

  const primaryBtn = {
    background: 'linear-gradient(135deg, oklch(0.55 0.22 255), oklch(0.60 0.18 200))',
  }
  const inputClass = 'w-full px-4 py-3 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-blue-500'
  const inputStyle = { background: 'var(--input)', color: 'var(--foreground)', border: '1px solid var(--border)' }

  return (
    <div className="flex flex-col flex-1 items-center justify-center px-8 gap-8"
      style={{ paddingTop: '59px', paddingBottom: '20px' }}>

      <div className="flex flex-col items-center gap-3">
        <motion.span
          animate={{ scale: loading ? [1, 1.1, 1] : 1 }}
          transition={{ repeat: loading ? Infinity : 0, duration: 1 }}
          style={{ fontSize: '48px', display: 'block' }}
        >
          🔒
        </motion.span>
        <h1 className="text-xl font-bold" style={{ color: 'var(--foreground)' }}>
          あんべの名刺代わり
        </h1>
      </div>

      <AnimatePresence mode="wait">

        {/* ── Biometric mode ── */}
        {mode === 'biometric' && (
          <motion.div key="bio"
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
            className="flex flex-col items-center gap-4 w-full">
            <motion.button
              onClick={handleBiometric}
              disabled={loading}
              whileHover={{ scale: 1.02, y: -2 }} whileTap={{ scale: 0.97 }}
              className="w-full py-4 rounded-2xl font-bold text-white"
              style={{ ...primaryBtn, opacity: loading ? 0.7 : 1 }}
            >
              {loading ? '認証中...' : '生体認証で開く'}
            </motion.button>

            <div className="flex items-center gap-3 w-full">
              <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
              <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>または</span>
              <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
            </div>

            <button onClick={() => { setMode('pin'); setError('') }}
              className="w-full py-4 rounded-2xl font-bold"
              style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}>
              PIN で開く
            </button>
          </motion.div>
        )}

        {/* ── PIN mode ── */}
        {mode === 'pin' && (
          <motion.div key="pin"
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
            className="flex flex-col items-center gap-4 w-full">
            <input
              type="password" inputMode="numeric" placeholder="PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              onKeyDown={(e) => e.key === 'Enter' && handlePIN()}
              autoFocus
              className="w-full px-4 py-4 rounded-xl text-center"
              style={{
                background: 'var(--input)', color: 'var(--foreground)',
                border: `1px solid ${error ? 'oklch(0.577 0.245 27.325)' : 'var(--border)'}`,
                fontSize: '28px', letterSpacing: '0.5em',
              }}
            />
            <button onClick={handlePIN}
              disabled={pin.length < 4 || loading}
              className="w-full py-4 rounded-2xl font-bold text-white"
              style={{ ...primaryBtn, opacity: pin.length >= 4 && !loading ? 1 : 0.4 }}>
              {loading ? '確認中...' : '開く'}
            </button>
            {canUseBiometric && (
              <button onClick={() => { setMode('biometric'); setError(''); setPin('') }}
                className="text-sm" style={{ color: 'oklch(0.65 0.2 250)' }}>
                生体認証に戻る
              </button>
            )}
          </motion.div>
        )}

        {/* ── Reset confirmation mode ── */}
        {mode === 'reset' && (
          <motion.div key="reset"
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
            className="flex flex-col items-center gap-4 w-full">
            <div className="w-full rounded-2xl p-4 text-sm"
              style={{ background: 'oklch(0.15 0.03 27)', border: '1px solid oklch(0.577 0.245 27.325)', color: 'var(--foreground)' }}>
              <p className="font-bold mb-1">⚠️ 全データを削除します</p>
              <p style={{ color: 'var(--muted-foreground)' }}>
                認証データと設定をすべて削除して最初からやり直します。Supabase内のデータは削除されません。
              </p>
            </div>
            <button onClick={handleReset}
              className="w-full py-4 rounded-2xl font-bold"
              style={{ background: 'oklch(0.577 0.245 27.325)', color: 'white' }}>
              削除して最初からやり直す
            </button>
            <button onClick={() => { setMode('biometric'); setError('') }}
              className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
              キャンセル
            </button>
          </motion.div>
        )}

        {/* ── QR pairing import mode ── */}
        {mode === 'qr-import' && (
          <motion.div key="qr-import"
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
            className="flex flex-col w-full flex-1">
            <QRPairingImport onClose={() => resetToMode(canUseBiometric ? 'biometric' : 'pin')} />
          </motion.div>
        )}

        {/* ── .ambe file recovery mode ── */}
        {mode === 'ambe' && (
          <motion.div key="ambe"
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
            className="flex flex-col gap-4 w-full">
            <div className="flex items-center gap-2">
              <button onClick={() => resetToMode(canUseBiometric ? 'biometric' : 'pin')}
                className="text-xs" style={{ color: 'var(--muted-foreground)' }}>← 戻る</button>
              <h2 className="text-sm font-bold" style={{ color: 'var(--foreground)' }}>📁 .ambeファイルで復元</h2>
            </div>

            {/* File picker */}
            <input ref={ambeFileRef} type="file" accept=".ambe,.json"
              onChange={handleAmbeFileChange} className="hidden" />
            <button
              onClick={() => ambeFileRef.current?.click()}
              className="w-full py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
              style={{ background: 'var(--card)', border: `1px dashed ${ambeContent ? 'oklch(0.65 0.2 250)' : 'var(--border)'}`, color: 'var(--foreground)' }}>
              {ambeContent ? `✓ ${ambeFileName}` : 'ファイルを選択'}
            </button>

            <input
              type="password" placeholder=".ambeファイルのPIN"
              value={ambeExportPin}
              onChange={(e) => setAmbeExportPin(e.target.value)}
              className={inputClass} style={inputStyle}
            />
            <input
              type="password" inputMode="numeric" placeholder="アプリのPIN（元のPIN）"
              value={ambeAppPin}
              onChange={(e) => setAmbeAppPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              onKeyDown={(e) => e.key === 'Enter' && handleAmbeRecover()}
              className={inputClass} style={inputStyle}
            />

            <button onClick={handleAmbeRecover}
              disabled={!ambeContent || !ambeExportPin || ambeAppPin.length < 4 || loading}
              className="w-full py-4 rounded-2xl font-bold text-white"
              style={{ ...primaryBtn, opacity: (!ambeContent || !ambeExportPin || ambeAppPin.length < 4 || loading) ? 0.4 : 1 }}>
              {loading ? '復元中...' : '復元する'}
            </button>

            <p className="text-xs text-center" style={{ color: 'var(--muted-foreground)' }}>
              設定画面からエクスポートした .ambe ファイルと、エクスポート時に設定した PIN が必要です
            </p>
          </motion.div>
        )}

        {/* ── Mnemonic (24-word) recovery mode ── */}
        {mode === 'mnemonic' && (
          <motion.div key="mnemonic"
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
            className="flex flex-col gap-4 w-full">
            <div className="flex items-center gap-2">
              <button onClick={() => resetToMode(canUseBiometric ? 'biometric' : 'pin')}
                className="text-xs" style={{ color: 'var(--muted-foreground)' }}>← 戻る</button>
              <h2 className="text-sm font-bold" style={{ color: 'var(--foreground)' }}>
                🔑 24単語で復旧 {mnemonicStep === 2 ? '— 新しいPINを設定' : ''}
              </h2>
            </div>

            {mnemonicStep === 1 && (
              <>
                <div className="rounded-xl p-3 text-xs" style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--muted-foreground)' }}>
                  Supabase の接続情報と、セットアップ時に記録した24単語が必要です。
                </div>
                <textarea
                  placeholder="24単語をスペース区切りで入力（例: word1 word2 word3 ...）"
                  value={mnemonicWords}
                  onChange={(e) => setMnemonicWords(e.target.value)}
                  rows={4}
                  className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                  style={{ background: 'var(--input)', color: 'var(--foreground)', border: '1px solid var(--border)' }}
                />
                <input
                  type="text" placeholder="Supabase URL（https://xxx.supabase.co）"
                  value={mnemonicSupabaseUrl}
                  onChange={(e) => setMnemonicSupabaseUrl(e.target.value)}
                  className={inputClass} style={inputStyle}
                />
                <input
                  type="password" placeholder="Supabase Anon Key"
                  value={mnemonicSupabaseKey}
                  onChange={(e) => setMnemonicSupabaseKey(e.target.value)}
                  className={inputClass} style={inputStyle}
                />
                <button onClick={handleMnemonicStep1}
                  disabled={mnemonicWords.trim().split(/\s+/).length < 24 || !mnemonicSupabaseUrl || !mnemonicSupabaseKey || loading}
                  className="w-full py-4 rounded-2xl font-bold text-white"
                  style={{ ...primaryBtn, opacity: loading ? 0.7 : 1 }}>
                  {loading ? '確認中...' : '次へ → 新PINを設定'}
                </button>
              </>
            )}

            {mnemonicStep === 2 && (
              <>
                <div className="rounded-xl p-3 text-xs text-center"
                  style={{ background: 'oklch(0.15 0.05 140)', border: '1px solid oklch(0.45 0.15 140)', color: 'var(--foreground)' }}>
                  ✓ データを確認しました。新しいPINを設定してください。
                </div>
                <input
                  type="password" inputMode="numeric" placeholder="新しいPIN（4〜8桁）"
                  value={mnemonicNewPin}
                  onChange={(e) => setMnemonicNewPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  onKeyDown={(e) => e.key === 'Enter' && handleMnemonicStep2()}
                  autoFocus
                  className={inputClass} style={{ ...inputStyle, fontSize: '24px', letterSpacing: '0.4em', textAlign: 'center' }}
                />
                <button onClick={handleMnemonicStep2}
                  disabled={mnemonicNewPin.length < 4 || loading}
                  className="w-full py-4 rounded-2xl font-bold text-white"
                  style={{ ...primaryBtn, opacity: mnemonicNewPin.length >= 4 && !loading ? 1 : 0.4 }}>
                  {loading ? '復元中...' : '復元して開く'}
                </button>
                <p className="text-xs text-center" style={{ color: 'var(--muted-foreground)' }}>
                  ※ Azure / Gemini の設定は復元後に「設定」画面で再入力してください
                </p>
              </>
            )}
          </motion.div>
        )}

      </AnimatePresence>

      {error && (
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="text-sm text-center"
          style={{ color: 'oklch(0.577 0.245 27.325)' }}>
          {error}
        </motion.p>
      )}

      {/* Recovery options — only show in biometric/pin modes */}
      {(mode === 'biometric' || mode === 'pin') && (
        <div className="w-full mt-auto">
          <button
            onClick={() => setRecoveryExpanded((v) => !v)}
            className="w-full text-sm py-2"
            style={{ color: 'var(--muted-foreground)' }}
          >
            別の方法で復旧する {recoveryExpanded ? '▲' : '▼'}
          </button>
          <AnimatePresence>
            {recoveryExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden flex flex-col gap-2 pt-2"
              >
                <button
                  onClick={() => { setMode('qr-import'); setError('') }}
                  className="w-full py-3 rounded-xl text-sm font-medium text-left px-4"
                  style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                >
                  📱 別端末からQRで引き継ぐ
                </button>
                <button
                  onClick={() => { setMode('ambe'); setError('') }}
                  className="w-full py-3 rounded-xl text-sm font-medium text-left px-4"
                  style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                >
                  📁 .ambeファイルで復元
                </button>
                <button
                  onClick={() => { setMode('mnemonic'); setError(''); setMnemonicStep(1) }}
                  className="w-full py-3 rounded-xl text-sm font-medium text-left px-4"
                  style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                >
                  🔑 24単語で復旧（完全全滅時）
                </button>
                {/* 脱出口: 認証データが壊れた / 古いフォーマットの場合 */}
                <button
                  onClick={() => { setMode('reset'); setError('') }}
                  className="w-full py-3 rounded-xl text-sm font-medium text-left px-4"
                  style={{ background: 'var(--card)', border: '1px solid oklch(0.577 0.245 27.325)', color: 'oklch(0.577 0.245 27.325)' }}
                >
                  🔄 最初からやり直す
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
