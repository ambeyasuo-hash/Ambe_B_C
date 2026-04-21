'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { assertWebAuthn, hasRegisteredCredential } from '@/lib/webauthn'
import { loadBundleWithAlpha, loadBundleWithPIN, hasBundleAlpha } from '@/lib/config-bundle'
import { unlockWithAlpha } from '@/lib/vault'
import { useVault } from '@/context/VaultContext'

type LockMode = 'biometric' | 'pin' | 'recovery'

export default function LockScreen() {
  const { unlock } = useVault()
  const [mode, setMode] = useState<LockMode>('biometric')
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [recoveryExpanded, setRecoveryExpanded] = useState(false)
  const [canUseBiometric, setCanUseBiometric] = useState(false)

  // Check localStorage only on client
  useEffect(() => {
    setCanUseBiometric(hasRegisteredCredential() && hasBundleAlpha())
  }, [])

  // ── Biometric unlock ───────────────────────────────────────────────────

  async function handleBiometric() {
    setLoading(true)
    setError('')
    try {
      const wrappingKey = await assertWebAuthn()
      const bundle = await loadBundleWithAlpha(wrappingKey)
      const dataKey = await unlockWithAlpha(wrappingKey, bundle)
      unlock(dataKey, bundle)
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
      // unwrap via PIN-derived key
      const { deriveWrappingKeyFromPIN } = await import('@/lib/crypto')
      const { unwrapKey } = await import('@/lib/crypto')
      const saltHex = localStorage.getItem('config_bundle_pin_salt')!
      const salt = Uint8Array.from(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)))
      const pinKey = await deriveWrappingKeyFromPIN(pin, salt)
      const dataKey = await unwrapKey(pinKey, bundle.wrapped_data_key_alpha)
      unlock(dataKey, bundle)
    } catch {
      setError('PINが正しくありません')
      setPin('')
    } finally {
      setLoading(false)
    }
  }

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
        {mode === 'biometric' && (
          <motion.div
            key="bio"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="flex flex-col items-center gap-4 w-full"
          >
            <motion.button
              onClick={handleBiometric}
              disabled={loading || !canUseBiometric}
              whileHover={{ scale: 1.02, y: -2 }}
              whileTap={{ scale: 0.97 }}
              className="w-full py-4 rounded-2xl font-bold text-white"
              style={{
                background: 'linear-gradient(135deg, oklch(0.55 0.22 255), oklch(0.60 0.18 200))',
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? '認証中...' : '生体認証で開く'}
            </motion.button>

            <div className="flex items-center gap-3 w-full">
              <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
              <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>または</span>
              <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
            </div>

            <button
              onClick={() => setMode('pin')}
              className="w-full py-4 rounded-2xl font-bold"
              style={{
                background: 'var(--card)',
                border: '1px solid var(--border)',
                color: 'var(--foreground)',
              }}
            >
              PIN で開く
            </button>
          </motion.div>
        )}

        {mode === 'pin' && (
          <motion.div
            key="pin"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="flex flex-col items-center gap-4 w-full"
          >
            <input
              type="password"
              inputMode="numeric"
              placeholder="PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              onKeyDown={(e) => e.key === 'Enter' && handlePIN()}
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
            <button
              onClick={handlePIN}
              disabled={pin.length < 4 || loading}
              className="w-full py-4 rounded-2xl font-bold text-white"
              style={{
                background: 'linear-gradient(135deg, oklch(0.55 0.22 255), oklch(0.60 0.18 200))',
                opacity: pin.length >= 4 && !loading ? 1 : 0.4,
              }}
            >
              {loading ? '確認中...' : '開く'}
            </button>
            {canUseBiometric && (
              <button
                onClick={() => { setMode('biometric'); setError(''); setPin('') }}
                className="text-sm"
                style={{ color: 'oklch(0.65 0.2 250)' }}
              >
                生体認証に戻る
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-sm text-center"
          style={{ color: 'oklch(0.577 0.245 27.325)' }}
        >
          {error}
        </motion.p>
      )}

      {/* Recovery options */}
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
              {[
                { label: '📱 QRで別端末から', mode: 'recovery' as const },
                { label: '📁 .ambeファイル', mode: 'recovery' as const },
                { label: '🔑 24単語で復旧', mode: 'recovery' as const },
              ].map((item) => (
                <button
                  key={item.label}
                  className="w-full py-3 rounded-xl text-sm font-medium text-left px-4"
                  style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                >
                  {item.label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
