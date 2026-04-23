'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useVault } from '@/context/VaultContext'
import SecuritySetup from '@/components/auth/SecuritySetup'
import LockScreen from '@/components/auth/LockScreen'
import DeviceFrame from '@/components/layout/DeviceFrame'
import StatusBar from '@/components/layout/StatusBar'

export default function Home() {
  const { appState } = useVault()
  const router = useRouter()

  useEffect(() => {
    if (appState === 'UNLOCKED') {
      router.replace('/cards')
    }
  }, [appState, router])

  if (appState === 'UNLOCKED') return null

  return (
    <DeviceFrame>
      <StatusBar />
      {appState === 'UNINITIALIZED' && <SecuritySetup />}
      {appState === 'LOCKED' && <LockScreen />}
    </DeviceFrame>
  )
}
