'use client'

import { useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useVault } from '@/context/VaultContext'
import LockScreen from '@/components/auth/LockScreen'
import DeviceFrame from '@/components/layout/DeviceFrame'
import StatusBar from '@/components/layout/StatusBar'

type LockMode = 'biometric' | 'pin' | 'reset' | 'ambe' | 'mnemonic' | 'qr-import'

const VALID_MODES: LockMode[] = ['biometric', 'pin', 'reset', 'ambe', 'mnemonic', 'qr-import']

function LockPageInner() {
  const { appState, lock } = useVault()
  const searchParams = useSearchParams()

  const rawMode = searchParams.get('mode') ?? 'biometric'
  const initialMode: LockMode = VALID_MODES.includes(rawMode as LockMode)
    ? (rawMode as LockMode)
    : 'biometric'

  // UNLOCKED 状態でこのページに来た場合はロックしてからロック画面を表示する
  useEffect(() => {
    if (appState === 'UNLOCKED') lock()
  }, [appState, lock])

  return (
    <DeviceFrame>
      <StatusBar />
      <LockScreen initialMode={initialMode} />
    </DeviceFrame>
  )
}

export default function LockPage() {
  return (
    <Suspense>
      <LockPageInner />
    </Suspense>
  )
}
