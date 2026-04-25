'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createClient } from '@supabase/supabase-js'
import { fromB64, deriveWrappingKeyFromPIN, randomBytes, unwrapKey, wrapKey } from '@/lib/crypto'
import {
  saveBundleWithPIN,
  type ConfigBundle,
} from '@/lib/config-bundle'
import { useVault } from '@/context/VaultContext'
import { useRouter } from 'next/navigation'

type ImportStep = 'scan' | 'pin' | 'done'

interface QrPayload {
  v: number
  kind: string
  token: string
  salt: string
  iv: string
  url: string
  key: string
  exp: string
}

interface QRPairingImportProps {
  onClose?: () => void
}

export default function QRPairingImport({ onClose }: QRPairingImportProps) {
  const { unlock } = useVault()
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<{ stop: () => void } | null>(null)
  const [step, setStep] = useState<ImportStep>('scan')
  const [payload, setPayload] = useState<QrPayload | null>(null)
  const [pin, setPin] = useState('')
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
              const parsed = JSON.parse(result.getText()) as QrPayload
              if (parsed.v === 2 && parsed.kind === 'qr-relay') {
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

  async function handleDecrypt() {
    if (!payload || pin.length < 6) return
    setLoading(true)
    setError('')
    try {
      // [1] 期限チェック
      if (new Date(payload.exp) < new Date()) {
        setError('QRコードが期限切れです')
        return
      }

      // [3] Supabase 接続
      const supabase = createClient(payload.url, payload.key)

      // [4] ct を取得
      const { data, error: fetchError } = await supabase
        .from('qr_transfers')
        .select('ct')
        .eq('token', payload.token)
        .single()

      if (fetchError || !data) {
        setError('QRコードは無効または既に使用済みです')
        return
      }

      // [5] salt・iv をデコード
      const saltBytes = fromB64(payload.salt)
      const ivBytes = fromB64(payload.iv)
      const ctBytes = fromB64(data.ct as string)

      // [6] wrapping key を導出
      const wrappingKey = await deriveWrappingKeyFromPIN(pin, saltBytes)

      // [7] 復号
      const plainBuf = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBytes },
        wrappingKey,
        ctBytes,
      )

      // [8] ConfigBundle をパース
      const bundle = JSON.parse(new TextDecoder().decode(plainBuf)) as ConfigBundle

      // [9] cleanup: qr_transfers から削除
      await supabase.from('qr_transfers').delete().eq('token', payload.token)

      // [10] 元の pin_salt で dataKey を解包し、新 salt で再ラップして保存
      if (!bundle.pin_salt || !bundle.wrapped_data_key_pin) {
        setError('転送データに PIN 鍵情報が含まれていません。元端末で再度セットアップしてください。')
        return
      }

      const existingSalt = Uint8Array.from(
        bundle.pin_salt.match(/.{2}/g)!.map((h: string) => parseInt(h, 16)),
      )
      const existingPinKey = await deriveWrappingKeyFromPIN(pin, existingSalt)
      const dataKey = await unwrapKey(existingPinKey, bundle.wrapped_data_key_pin)

      // この端末用の新しい salt で dataKey を再ラップ
      const newPinSalt = randomBytes(16)
      const newPinKey = await deriveWrappingKeyFromPIN(pin, newPinSalt)
      const newWrappedDataKeyPin = await wrapKey(newPinKey, dataKey)

      // wrapped_data_key_pin を新 salt 対応に更新した bundle を保存
      const updatedBundle: ConfigBundle = { ...bundle, wrapped_data_key_pin: newWrappedDataKeyPin }
      await saveBundleWithPIN(pin, updatedBundle, newPinSalt)

      // ※ saveBundleWithAlpha は呼ばない。WebAuthn PRF 鍵はこの端末未登録のため。
      //    次回生体認証時に LockScreen の PRF upgrade フローが自動処理する。
      unlock(dataKey, updatedBundle)
      setStep('done')
      setTimeout(() => router.replace('/'), 300)
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      if (msg.includes('decrypt') || msg.includes('OperationError')) {
        setError('PINが正しくありません')
      } else {
        setError('復号に失敗しました: ' + (msg || '不明なエラー'))
      }
      setPin('')
    } finally {
      setLoading(false)
    }
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

        {step === 'pin' && (
          <motion.div key="pin"
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex flex-col gap-4 w-full">
            <div className="rounded-xl p-3 text-xs text-center"
              style={{ background: 'oklch(0.15 0.05 140)', border: '1px solid oklch(0.45 0.15 140)', color: 'var(--foreground)' }}>
              ✓ QRコードを読み取りました
            </div>
            <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
              既存端末に表示されている6桁のPINを入力してください
            </p>
            <input
              type="password"
              inputMode="numeric"
              placeholder="6桁 PIN"
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
              style={{
                background: 'linear-gradient(135deg, oklch(0.55 0.22 255), oklch(0.60 0.18 200))',
                opacity: pin.length >= 6 && !loading ? 1 : 0.4,
              }}
            >
              {loading ? '復号中...' : '引き継ぐ'}
            </motion.button>
            {error && (
              <p className="text-sm text-center" style={{ color: 'oklch(0.577 0.245 27.325)' }}>{error}</p>
            )}
          </motion.div>
        )}

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
