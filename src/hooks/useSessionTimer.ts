'use client'

import { useEffect, useState } from 'react'
import { useVault } from '@/context/VaultContext'

const SESSION_MS = 15 * 60 * 1000

export function useSessionTimer() {
  const { appState } = useVault()
  const [remaining, setRemaining] = useState(SESSION_MS)
  const [startedAt, setStartedAt] = useState<number | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      if (appState !== 'UNLOCKED') {
        setRemaining(SESSION_MS)
        setStartedAt(null)
        return
      }
      setStartedAt(Date.now())
    }, 0)
    return () => clearTimeout(timer)
  }, [appState])

  useEffect(() => {
    if (!startedAt) return
    const id = setInterval(() => {
      setRemaining(Math.max(0, SESSION_MS - (Date.now() - startedAt)))
    }, 1000)
    return () => clearInterval(id)
  }, [startedAt])

  // Reset displayed timer when activity resets the session
  useEffect(() => {
    if (appState !== 'UNLOCKED') return
    const handler = () => setStartedAt(Date.now())
    window.addEventListener('pointerdown', handler, { passive: true })
    window.addEventListener('keydown', handler, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', handler)
      window.removeEventListener('keydown', handler)
    }
  }, [appState])

  const mm = String(Math.floor(remaining / 60_000)).padStart(2, '0')
  const ss = String(Math.floor((remaining % 60_000) / 1000)).padStart(2, '0')

  return { timerLabel: `${mm}:${ss}`, isUnlocked: appState === 'UNLOCKED' }
}
