'use client'

import { useState, useEffect, useCallback } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { motion } from 'framer-motion'
import { createClient } from '@supabase/supabase-js'
import { randomBytes, deriveWrappingKeyFromPIN, toB64 } from '@/lib/crypto'
import type { ConfigBundle } from '@/lib/config-bundle'

const EXPIRE_SECONDS = 300

function generatePin(): string {
  const buf = new Uint8Array(new ArrayBuffer(4))
  crypto.getRandomValues(buf)
  const num = (buf[0] * 16777216 + buf[1] * 65536 + buf[2] * 256 + buf[3]) % 1_000_000
  return num.toString().padStart(6, '0')
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

interface QRPairingExportProps {
  bundle: ConfigBundle
  onClose: () => void
}

export default function QRPairingExport({ bundle, onClose }: QRPairingExportProps) {
  const [pin] = useState(() => generatePin())
  const [qrData, setQrData] = useState<string | null>(null)
  const [remaining, setRemaining] = useState(EXPIRE_SECONDS)
  const [expired, setExpired] = useState(false)
  const [error, setError] = useState('')

  const buildQrPayload = useCallback(async () => {
    try {
      const salt = randomBytes(16)
      const iv = randomBytes(12)
      const wrappingKey = await deriveWrappingKeyFromPIN(pin, salt)

      const plaintext = new TextEncoder().encode(JSON.stringify(bundle))
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, plaintext)

      const token = toHex(randomBytes(16))
      const expiresAt = new Date(Date.now() + EXPIRE_SECONDS * 1000)

      const supabase = createClient(bundle.supabase.url, bundle.supabase.anon_key)
      const { error: insertError } = await supabase
        .from('qr_transfers')
        .insert({
          token,
          ct: toB64(ct),
          iv: toB64(iv.buffer),
          expires_at: expiresAt.toISOString(),
        })

      if (insertError) {
        setError('サーバーへの保存に失敗しました: ' + insertError.message)
        return
      }

      setQrData([
        'AMBE3',
        token,
        toB64(salt.buffer),
        toB64(iv.buffer),
        bundle.supabase.url,
        bundle.supabase.anon_key,
      ].join('|'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'QR生成に失敗しました')
    }
  }, [pin, bundle])

  useEffect(() => {
    buildQrPayload()
  }, [buildQrPayload])

  useEffect(() => {
    if (expired) return
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(id)
          setExpired(true)
          setQrData(null)
          return 0
        }
        return r - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [expired])

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0')
  const ss = String(remaining % 60).padStart(2, '0')
  const pinDigits = pin.split('')
  const qrBoxStyle = { width: 'min(280px, calc(92vw - 56px))', height: 'min(280px, calc(92vw - 56px))' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'oklch(0 0 0 / 0.75)' }}>
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="flex flex-col items-center gap-5 rounded-3xl p-5"
        style={{ background: 'var(--card)', border: '1px solid var(--border)', width: 'min(92vw, 380px)' }}
      >
        <h2 className="text-base font-bold" style={{ color: 'var(--foreground)' }}>
          別端末でスキャン
        </h2>

        <div className="rounded-2xl p-2" style={{ background: 'white' }}>
          {expired ? (
            <div className="flex flex-col items-center justify-center gap-2" style={qrBoxStyle}>
              <span style={{ fontSize: '40px' }}>⏱</span>
              <p className="text-sm font-medium text-center" style={{ color: 'oklch(0.2 0 0)' }}>
                QRコードが期限切れです
              </p>
            </div>
          ) : qrData ? (
            <div style={qrBoxStyle}>
              <QRCodeSVG value={qrData} size={280} level="L" marginSize={2} className="w-full h-full" />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center" style={qrBoxStyle}>
              <p className="text-xs text-center" style={{ color: 'oklch(0.577 0.245 27.325)' }}>{error}</p>
            </div>
          ) : (
            <div className="flex items-center justify-center" style={qrBoxStyle}>
              <p className="text-sm" style={{ color: 'oklch(0.4 0 0)' }}>生成中...</p>
            </div>
          )}
        </div>

        <div className="flex flex-col items-center gap-1">
          <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>PIN（別端末で入力）</p>
          <div className="flex gap-2">
            {pinDigits.map((d, i) => (
              <div key={i}
                className="w-10 h-12 flex items-center justify-center rounded-xl text-2xl font-bold"
                style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}>
                {d}
              </div>
            ))}
          </div>
        </div>

        <p className="text-sm font-medium"
          style={{ color: expired ? 'oklch(0.577 0.245 27.325)' : remaining <= 60 ? 'oklch(0.65 0.22 30)' : 'oklch(0.65 0.2 250)' }}>
          {expired ? '期限切れ' : `残り時間: ${mm}:${ss}`}
        </p>

        <button
          onClick={onClose}
          className="w-full py-3 rounded-2xl text-sm font-medium"
          style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--muted-foreground)' }}
        >
          キャンセル
        </button>
      </motion.div>
    </div>
  )
}
