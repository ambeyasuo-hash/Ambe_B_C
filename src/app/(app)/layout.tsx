'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { motion } from 'framer-motion'
import DeviceFrame from '@/components/layout/DeviceFrame'
import StatusBar from '@/components/layout/StatusBar'
import BottomNav from '@/components/layout/BottomNav'
import { useVault } from '@/context/VaultContext'
import { useSessionTimer } from '@/hooks/useSessionTimer'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { appState, bundle } = useVault()
  const router = useRouter()
  const pathname = usePathname()
  const { timerLabel, isUnlocked } = useSessionTimer()
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    if (appState === 'LOCKED' || appState === 'UNINITIALIZED') {
      router.replace('/')
    }
  }, [appState, router])

  // C-6: Page transition animation
  useEffect(() => {
    setIsVisible(false)
    const timer = setTimeout(() => setIsVisible(true), 50)
    return () => clearTimeout(timer)
  }, [pathname])

  // C-2: Apply font size preference to document root
  useEffect(() => {
    if (!bundle?.fontSizePreference) return
    document.documentElement.classList.remove('text-sm', 'text-base', 'text-lg', 'text-xl')
    const sizeMap = {
      small: 'text-sm',
      standard: 'text-base',
      large: 'text-lg',
      xlarge: 'text-xl',
    }
    document.documentElement.classList.add(sizeMap[bundle.fontSizePreference])
  }, [bundle?.fontSizePreference])

  const activeTab: 'cards' | 'scan' | 'settings' =
    pathname.startsWith('/settings') ? 'settings' :
    pathname.startsWith('/scan') ? 'scan' : 'cards'

  if (appState !== 'UNLOCKED') return null

  return (
    <DeviceFrame>
      <StatusBar sessionTimer={timerLabel} isUnlocked={isUnlocked} />
      <div className="flex flex-col flex-1 overflow-hidden relative">
        <motion.div
          className="flex-1 overflow-y-auto pb-[82px]"
          initial={false}
          animate={{ opacity: isVisible ? 1 : 0 }}
          transition={{ duration: 0.2 }}
        >
          {children}
        </motion.div>
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
