'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { fromB64, deriveWrappingKeyFromPIN, randomBytes, unwrapKey, wrapKey } from '@/lib/crypto'
import {
  saveBundleWithPIN,
  type ConfigBundle,
} from '@/lib/config-bundle'
import { generateSearchIndexSecret } from '@/lib/normalize'
import { useVault } from '@/context/VaultContext'
import { useRouter } from 'next/navigation'

// step 'pin'    : QR ペアリング PIN（PC 画面に表示されたランダム6桁）
//                  → Supabase の暗号文を復号してバンドルを取得
// step 'app-pin': アプリ PIN（元端末でセットアップ時に設定した本人のPIN）
//                  → bundle.wrapped_data_key_pin を解包してデータキーを取得
type ImportStep = 'scan' | 'pin' | 'app-pin' | 'done'

interface QrPayload {
  v: number
  kind: string
  token: string
  salt: string
  iv: string
  url: string
  key: string
  exp?: string
}

interface QRPairingImportProps {
  onClose?: () => void
}

function parseQrPayload(text: string): QrPayload | null {
  if (text.startsWith('AMBE3|')) {
    const [kind, token, salt, iv, url, key] = text.split('|')
    if (kind === 'AMBE3' && token && salt && iv && url && key) {
      return { v: 3, kind: 'qr-relay', token, salt, iv, url, key }
    }
    return null
  }

  const parsed = JSON.parse(text) as QrPayload
  if (parsed.v === 2 && parsed.kind === 'qr-relay') return parsed
  return null
}

export default function QRPairingImport({ onClose }: QRPairingImportProps) {
  const { unlock } = useVault()
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<{ stop: () => void } | null>(null)
  const [step, setStep] = useState<ImportStep>('scan')
  const [payload, setPayload] = useState<QrPayload | null>(null)
  const [pin, setPin] = useState('')          // QR ペアリング PIN
  const [appPin, setAppPin] = useState('')    // アプリ PIN（元端末のもの）
  const [appPinError, setAppPinError] = useState('')
  const [decryptedBundle, setDecryptedBundle] = useState<ConfigBundle | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [cameraError, setCameraError] = useState('')

  const stopCamera = useCallback(() => {
    if (controlsRef.current) {
      controlsRef.current.stop()
      controlsRef.current = null
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function startCamera() {
      try {
        const { BrowserQRCodeReader } = await import('@zxing/browser')
        const reader = new BrowserQRCodeReader()

        if (!videoRef.current) return

        const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result, err) => {
          if (cancelled) return
          if (result) {
            try {
              const parsed = parseQrPayload(result.getText())
              if (parsed) {
                stopCamera()
                setPayload(parsed)
                setStep('pin')
              } else {
                setError('このQRコードは対応していません')
              }
            } catch {
              setError('QRコードの解析に失敗しました')
            }
          }
          if (err && !(err instanceof Error && err.name === 'NotFoundException')) {
            // transient errors from @zxing are expected — ignore
          }
        })
        if (!cancelled) {
          controlsRef.current = controls
        } else {
          controls.stop()
        }
      } catch (e) {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : ''
        if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('notallowed')) {
          setCameraError('カメラの使用を許可してください')
        } else {
          setCameraError('カメラを起動できませんでした: ' + (msg || '不明なエラー'))
        }
      }
    }

    startCamera()

    return () => {
      cancelled = true
      stopCamera()
    }
  }, [stopCamera])

  // ── Step 1: QR ペアリング PIN で Supabase から暗号文を取得・復号 ──────────

  async function handleDecrypt() {
    if (!payload || pin.length < 6) return
    setLoading(true)
    setError('')
    try {
      // [1] 期限チェック
      if (payload.exp && new Date(payload.exp) < new Date()) {
        setError('QRコードが期限切れです')
        return
      }

      // [2] ct を取得し、DB側で使用済みにする
      const consumeRes = await fetch('/api/consume-qr-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: payload.token,
          supabaseUrl: payload.url,
          supabaseAnonKey: payload.key,
        }),
      })
      const consumeJson = (await consumeRes.json().catch(() => ({}))) as { ct?: string; error?: string }
      if (!consumeRes.ok || !consumeJson.ct) {
        setError(consumeJson.error ?? 'QRコードは無効または既に使用済みです')
        return
      }

      // [4] salt・iv・ct をデコード
      const saltBytes = fromB64(payload.salt)
      const ivBytes   = fromB64(payload.iv)
      const ctBytes   = fromB64(consumeJson.ct)

      // [5] QR PIN で wrapping key を導出して復号
      const wrappingKey = await deriveWrappingKeyFromPIN(pin, saltBytes)
      const plainBuf = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBytes },
        wrappingKey,
        ctBytes,
      )

      // [6] ConfigBundle をパース
      const bundle = JSON.parse(new TextDecoder().decode(plainBuf)) as ConfigBundle

      // [7] 次ステップへ（アプリ PIN でデータキーを解包するため bundle を保持）
      setDecryptedBundle(bundle)
      setStep('app-pin')
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      if (msg.includes('decrypt') || msg.toLowerCase().includes('operationerror') || msg.includes('operation')) {
        setError('QRのPINが正しくありません')
      } else {
        setError('復号に失敗しました: ' + (msg || '不明なエラー'))
      }
      setPin('')
    } finally {
      setLoading(false)
    }
  }

  // ── Step 2: アプリ PIN でデータキーを解包し、この端末用に再ラップ ──────────

  async function handleAppPin() {
    if (!decryptedBundle || appPin.length < 4) return
    setLoading(true)
    setAppPinError('')
    try {
      if (!decryptedBundle.pin_salt || !decryptedBundle.wrapped_data_key_pin) {
        setAppPinError('転送データに PIN 鍵情報が含まれていません。元端末で再度セットアップしてください。')
        return
      }

      // 元端末の pin_salt でキーを導出し、データキーを解包
      const existingSalt = Uint8Array.from(
        decryptedBundle.pin_salt.match(/.{2}/g)!.map((h: string) => parseInt(h, 16)),
      )
      const existingPinKey = await deriveWrappingKeyFromPIN(appPin, existingSalt)
      const dataKey = await unwrapKey(existingPinKey, decryptedBundle.wrapped_data_key_pin)

      // この端末用の新しい salt でデータキーを再ラップ
      const newPinSalt = randomBytes(16)
      const newPinKey = await deriveWrappingKeyFromPIN(appPin, newPinSalt)
      const newWrappedDataKeyPin = await wrapKey(newPinKey, dataKey)

      // wrapped_data_key_pin を更新した bundle を保存
      const updatedBundle: ConfigBundle = {
        ...decryptedBundle,
        wrapped_data_key_pin: newWrappedDataKeyPin,
        search_index_secret: decryptedBundle.search_index_secret ?? generateSearchIndexSecret(),
      }
      await saveBundleWithPIN(appPin, updatedBundle, newPinSalt)
      // ※ saveBundleWithAlpha は呼ばない。WebAuthn PRF 鍵はこの端末未登録のため。
      //    次回生体認証時に LockScreen の PRF upgrade フローが自動処理する。

      unlock(dataKey, updatedBundle)
      setStep('done')
      setTimeout(() => router.replace('/'), 300)
    } catch {
      setAppPinError('アプリのPINが正しくありません')
      setAppPin('')
    } finally {
      setLoading(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const primaryBtn: React.CSSProperties = {
    background: 'linear-gradient(135deg, oklch(0.55 0.22 255), oklch(0.60 0.18 200))',
  }

  return (
    <div className="flex flex-col flex-1 items-center justify-start px-6 gap-5"
      style={{ paddingTop: '59px', paddingBottom: '20px' }}>

      <div className="flex items-center gap-2 w-full">
        {onClose && (
          <button onClick={() => { stopCamera(); onClose() }}
            className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
            ← 戻る
          </button>
        )}
        <h2 className="text-base font-bold" style={{ color: 'var(--foreground)' }}>
          📱 QRで引き継ぎ
        </h2>
      </div>

      <AnimatePresence mode="wait">

        {/* ── QR スキャン ── */}
        {step === 'scan' && (
          <motion.div key="scan"
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-4 w-full">
            {cameraError ? (
              <div className="w-full rounded-2xl p-5 text-center flex flex-col items-center gap-3"
                style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
                <span style={{ fontSize: '40px' }}>📷</span>
                <p className="text-sm" style={{ color: 'oklch(0.577 0.245 27.325)' }}>{cameraError}</p>
              </div>
            ) : (
              <div className="relative rounded-2xl overflow-hidden w-full aspect-square"
                style={{ maxWidth: '280px', background: 'oklch(0.1 0 0)' }}>
                <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-48 h-48 border-2 rounded-xl opacity-60"
                    style={{ borderColor: 'oklch(0.65 0.2 250)' }} />
                </div>
              </div>
            )}
            <p className="text-sm text-center" style={{ color: 'var(--muted-foreground)' }}>
              既存端末の設定画面に表示されたQRコードをカメラに向けてください
            </p>
            {error && (
              <p className="text-sm text-center" style={{ color: 'oklch(0.577 0.245 27.325)' }}>{error}</p>
            )}
          </motion.div>
        )}

        {/* ── QR ペアリング PIN（PC 画面に表示されたランダム6桁）── */}
        {step === 'pin' && (
          <motion.div key="pin"
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex flex-col gap-4 w-full">
            <div className="rounded-xl p-3 text-xs text-center"
              style={{ background: 'oklch(0.15 0.05 140)', border: '1px solid oklch(0.45 0.15 140)', color: 'var(--foreground)' }}>
              ✓ QRコードを読み取りました（1/2）
            </div>
            <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
              既存端末の画面に表示されている<strong style={{ color: 'var(--foreground)' }}>6桁のQR PIN</strong>を入力してください
            </p>
            <input
              type="password"
              inputMode="numeric"
              placeholder="6桁 QR PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => e.key === 'Enter' && handleDecrypt()}
              autoFocus
              className="w-full px-4 py-4 rounded-xl text-center"
              style={{
                background: 'var(--input)',
                color: 'var(--foreground)',
                border: `1px solid ${error ? 'oklch(0.577 0.245 27.325)' : 'var(--border)'}`,
                fontSize: '28px',
                letterSpacing: '0.5em',
              }}
            />
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={handleDecrypt}
              disabled={pin.length < 6 || loading}
              className="w-full py-4 rounded-2xl font-bold text-white"
              style={{ ...primaryBtn, opacity: pin.length >= 6 && !loading ? 1 : 0.4 }}
            >
              {loading ? '取得中...' : '次へ →'}
            </motion.button>
            {error && (
              <p className="text-sm text-center" style={{ color: 'oklch(0.577 0.245 27.325)' }}>{error}</p>
            )}
          </motion.div>
        )}

        {/* ── アプリ PIN（元端末でセットアップ時に設定した本人のPIN）── */}
        {step === 'app-pin' && (
          <motion.div key="app-pin"
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex flex-col gap-4 w-full">
            <div className="rounded-xl p-3 text-xs text-center"
              style={{ background: 'oklch(0.15 0.05 140)', border: '1px solid oklch(0.45 0.15 140)', color: 'var(--foreground)' }}>
              ✓ 接続情報を取得しました（2/2）
            </div>
            <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
              元端末でセットアップ時に設定した<strong style={{ color: 'var(--foreground)' }}>アプリのPIN</strong>を入力してください
            </p>
            <input
              type="password"
              inputMode="numeric"
              placeholder="アプリの PIN"
              value={appPin}
              onChange={(e) => setAppPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              onKeyDown={(e) => e.key === 'Enter' && handleAppPin()}
              autoFocus
              className="w-full px-4 py-4 rounded-xl text-center"
              style={{
                background: 'var(--input)',
                color: 'var(--foreground)',
                border: `1px solid ${appPinError ? 'oklch(0.577 0.245 27.325)' : 'var(--border)'}`,
                fontSize: '28px',
                letterSpacing: '0.5em',
              }}
            />
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={handleAppPin}
              disabled={appPin.length < 4 || loading}
              className="w-full py-4 rounded-2xl font-bold text-white"
              style={{ ...primaryBtn, opacity: appPin.length >= 4 && !loading ? 1 : 0.4 }}
            >
              {loading ? '引き継ぎ中...' : '引き継ぐ'}
            </motion.button>
            {appPinError && (
              <p className="text-sm text-center" style={{ color: 'oklch(0.577 0.245 27.325)' }}>{appPinError}</p>
            )}
          </motion.div>
        )}

        {/* ── 完了 ── */}
        {step === 'done' && (
          <motion.div key="done"
            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center gap-3">
            <span style={{ fontSize: '48px' }}>✅</span>
            <p className="text-base font-bold" style={{ color: 'var(--foreground)' }}>引き継ぎ完了</p>
            <p className="text-sm text-center" style={{ color: 'var(--muted-foreground)' }}>設定を転送しました</p>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  )
}
