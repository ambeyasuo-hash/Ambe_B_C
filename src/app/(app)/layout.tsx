'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import DeviceFrame from '@/components/layout/DeviceFrame'
import StatusBar from '@/components/layout/StatusBar'
import BottomNav from '@/components/layout/BottomNav'
import { useVault } from '@/context/VaultContext'
import { useSessionTimer } from '@/hooks/useSessionTimer'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { appState } = useVault()
  const router = useRouter()
  const pathname = usePathname()
  const { timerLabel, isUnlocked } = useSessionTimer()

  useEffect(() => {
    if (appState === 'LOCKED' || appState === 'UNINITIALIZED') {
      router.replace('/')
    }
  }, [appState, router])

  const activeTab: 'cards' | 'scan' | 'settings' =
    pathname.startsWith('/settings') ? 'settings' :
    pathname.startsWith('/scan') ? 'scan' : 'cards'

  if (appState !== 'UNLOCKED') return null

  return (
    <DeviceFrame>
      <StatusBar sessionTimer={timerLabel} isUnlocked={isUnlocked} />
      <div className="flex flex-col flex-1 overflow-hidden relative">
        <div className="flex-1 overflow-y-auto pb-[82px]">
          {children}
        </div>
        <BottomNav
          activeTab={activeTab}
          onTabChange={(tab) => {
            if (tab === 'cards') router.push('/cards')
            else if (tab === 'scan') router.push('/scan')
            else router.push('/settings')
          }}
        />
      </div>
    </DeviceFrame>
  )
}
