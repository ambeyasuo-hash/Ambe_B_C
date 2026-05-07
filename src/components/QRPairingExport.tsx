'use client'

import { useState, useEffect, useCallback } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { motion } from 'framer-motion'
import { createClient } from '@supabase/supabase-js'
import { randomBytes, deriveWrappingKeyFromPIN, toB64 } from '@/lib/crypto'
import type { ConfigBundle } from '@/lib/config-bundle'

const EXPIRE_SECONDS = 300
const SUPABASE_JWT_HEADER = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

function generatePin(): string {
  const buf = new Uint8Array(new ArrayBuffer(4))
  crypto.getRandomValues(buf)
  const num = (buf[0] * 16777216 + buf[1] * 65536 + buf[2] * 256 + buf[3]) % 1_000_000
  return num.toString().padStart(6, '0')
}

function toB64Url(buf: ArrayBuffer): string {
  return toB64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function compactAnonKey(key: string): string {
  const prefix = `${SUPABASE_JWT_HEADER}.`
  return key.startsWith(prefix) ? key.slice(prefix.length) : key
}

function supabaseUrlFromAnonKey(key: string): string | null {
  try {
    const payloadPart = key.split('.')[1]
    if (!payloadPart) return null
    const padded = payloadPart.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payloadPart.length / 4) * 4, '=')
    const payload = JSON.parse(atob(padded)) as { ref?: unknown }
    return typeof payload.ref === 'string' && /^[a-z0-9-]+$/.test(payload.ref)
      ? `https://${payload.ref}.supabase.co`
      : null
  } catch {
    return null
  }
}

function getQrFrames(qrData: string): string[] {
  if (qrData.startsWith('AMBE4|')) {
    const [kind, token, salt, iv, keyPart] = qrData.split('|')
    if (kind === 'AMBE4' && token && salt && iv && keyPart) {
      const keySegments = keyPart.split('.')
      if (keySegments.length === 2) {
        return [
          ['AMBE5', '1', token, salt, iv].join('|'),
          ['AMBE5', '2', keySegments[0]].join('|'),
          ['AMBE5', '3', keySegments[1]].join('|'),
        ]
      }
      return [
        ['AMBE5', '1', token, salt, iv].join('|'),
        ['AMBE5', '2', keyPart].join('|'),
      ]
    }
  }
  return [qrData]
}

interface QRPairingExportProps {
  bundle: ConfigBundle
  onClose: () => void
}

export default function QRPairingExport({ bundle, onClose }: QRPairingExportProps) {
  const [pin] = useState(() => generatePin())
  const [qrData, setQrData] = useState<string | null>(null)
  const [qrPage, setQrPage] = useState(0)
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

      const token = toB64Url(randomBytes(16).buffer)
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

      const inferredUrl = supabaseUrlFromAnonKey(bundle.supabase.anon_key)
      setQrPage(0)
      setQrData(inferredUrl
        ? [
            'AMBE4',
            token,
            toB64Url(salt.buffer),
            toB64Url(iv.buffer),
            compactAnonKey(bundle.supabase.anon_key),
          ].join('|')
        : [
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
  const qrBoxStyle = { width: 'min(330px, calc(96vw - 48px))', height: 'min(330px, calc(96vw - 48px))' }
  const qrFrames = qrData ? getQrFrames(qrData) : []
  const currentQrData = qrFrames[qrPage] ?? qrFrames[0]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'oklch(0 0 0 / 0.75)' }}>
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="flex flex-col items-center gap-5 rounded-3xl p-4"
        style={{ background: 'var(--card)', border: '1px solid var(--border)', width: 'min(96vw, 390px)' }}
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
          ) : currentQrData ? (
            <div style={qrBoxStyle}>
              <QRCodeSVG value={currentQrData} size={330} level="L" marginSize={2} className="w-full h-full" />
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

        {qrFrames.length > 1 && (
          <div className="flex items-center gap-2">
            {qrFrames.map((_, index) => (
              <button
                key={index}
                type="button"
                onClick={() => setQrPage(index)}
                className="w-12 h-10 rounded-xl text-sm font-bold"
                style={{
                  background: qrPage === index ? 'var(--foreground)' : 'var(--background)',
                  border: '1px solid var(--border)',
                  color: qrPage === index ? 'var(--background)' : 'var(--foreground)',
                }}
              >
                {index + 1}/{qrFrames.length}
              </button>
            ))}
          </div>
        )}

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
