'use client'

import { createContext, useContext, useRef, useState, useCallback, useEffect, type ReactNode } from 'react'
import type { ConfigBundle } from '@/lib/config-bundle'
import { hasBundleAlpha, hasBundlePIN } from '@/lib/config-bundle'
import { hasRegisteredCredential } from '@/lib/webauthn'

export type AppState = 'UNINITIALIZED' | 'LOCKED' | 'UNLOCKED'

interface VaultState {
  appState: AppState
  dataKey: CryptoKey | null
  bundle: ConfigBundle | null
}

interface VaultContextValue extends VaultState {
  unlock: (dataKey: CryptoKey, bundle: ConfigBundle) => void
  lock: () => void
  setUninitialized: () => void
  resetSessionTimer: () => void
  updateBundle: (bundle: ConfigBundle) => void
}

const VaultContext = createContext<VaultContextValue | null>(null)

const SESSION_TIMEOUT_MS = 15 * 60 * 1000 // 15 minutes

export function VaultProvider({ children }: { children: ReactNode }) {
  const [appState, setAppState] = useState<AppState>('LOCKED')
  const [dataKey, setDataKey] = useState<CryptoKey | null>(null)
  const [bundle, setBundle] = useState<ConfigBundle | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const lock = useCallback(() => {
    setDataKey(null)
    setBundle(null)
    setAppState('LOCKED')
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  const resetSessionTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(lock, SESSION_TIMEOUT_MS)
  }, [lock])

  const unlock = useCallback(
    (key: CryptoKey, cfg: ConfigBundle) => {
      setDataKey(key)
      setBundle(cfg)
      setAppState('UNLOCKED')
      resetSessionTimer()
    },
    [resetSessionTimer],
  )

  const setUninitialized = useCallback(() => {
    setDataKey(null)
    setBundle(null)
    setAppState('UNINITIALIZED')
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  const updateBundle = useCallback((newBundle: ConfigBundle) => {
    setBundle(newBundle)
  }, [])

  // Initialize: determine state from localStorage (client only)
  useEffect(() => {
    if (typeof window === 'undefined') return
    // PIN bundle がなければ未完了セットアップ → UNINITIALIZED
    // alpha bundle だけある（セットアップ途中でクラッシュ等）場合も UNINITIALIZED に倒す
    if (!hasBundlePIN()) {
      setAppState('UNINITIALIZED')
    } else {
      setAppState('LOCKED')
    }
  }, [])

  // Reset session timer on user activity
  useEffect(() => {
    if (appState !== 'UNLOCKED') return
    const events = ['pointerdown', 'keydown', 'touchstart']
    const handler = () => resetSessionTimer()
    events.forEach((e) => window.addEventListener(e, handler, { passive: true }))
    return () => events.forEach((e) => window.removeEventListener(e, handler))
  }, [appState, resetSessionTimer])

  return (
    <VaultContext.Provider value={{ appState, dataKey, bundle, unlock, lock, setUninitialized, resetSessionTimer, updateBundle }}>
      {children}
    </VaultContext.Provider>
  )
}

export function useVault(): VaultContextValue {
  const ctx = useContext(VaultContext)
  if (!ctx) throw new Error('useVault must be used within VaultProvider')
  return ctx
}
