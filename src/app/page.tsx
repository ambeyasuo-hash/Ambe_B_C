'use client'

import { useVault } from '@/context/VaultContext'
import SecuritySetup from '@/components/auth/SecuritySetup'
import LockScreen from '@/components/auth/LockScreen'
import DeviceFrame from '@/components/layout/DeviceFrame'
import StatusBar from '@/components/layout/StatusBar'
import BottomNav from '@/components/layout/BottomNav'
import { useState } from 'react'
import { useSessionTimer } from '@/hooks/useSessionTimer'

function AppShell() {
  const { appState } = useVault()
  const [activeTab, setActiveTab] = useState<'cards' | 'scan' | 'settings'>('cards')
  const { timerLabel, isUnlocked } = useSessionTimer()

  return (
    <DeviceFrame>
      <StatusBar
        sessionTimer={timerLabel}
        isUnlocked={isUnlocked}
      />

      {appState === 'UNINITIALIZED' && <SecuritySetup />}
      {appState === 'LOCKED' && <LockScreen />}
      {appState === 'UNLOCKED' && (
        <div className="flex flex-col flex-1 overflow-hidden relative">
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <p style={{ color: 'var(--muted-foreground)' }}>TODO: {activeTab} 画面（Phase 4・5）</p>
          </div>
          <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
        </div>
      )}
    </DeviceFrame>
  )
}

export default function Home() {
  return <AppShell />
}
