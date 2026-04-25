'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { useVault } from '@/context/VaultContext'
import SecuritySetup from '@/components/auth/SecuritySetup'
import LockScreen from '@/components/auth/LockScreen'
import DeviceFrame from '@/components/layout/DeviceFrame'
import StatusBar from '@/components/layout/StatusBar'

type InitChoice = null | 'setup' | 'qr-import' | 'ambe' | 'mnemonic'

export default function Home() {
  const { appState } = useVault()
  const router = useRouter()
  const [initChoice, setInitChoice] = useState<InitChoice>(null)

  useEffect(() => {
    if (appState === 'UNLOCKED') router.replace('/cards')
  }, [appState, router])

  // UNINITIALIZED に戻ったとき（セットアップ中断 等）選択をリセット
  useEffect(() => {
    if (appState === 'UNINITIALIZED') setInitChoice(null)
  }, [appState])

  if (appState === 'UNLOCKED') return null

  const primaryBtn: React.CSSProperties = {
    background: 'linear-gradient(135deg, oklch(0.55 0.22 255), oklch(0.60 0.18 200))',
    color: 'white',
  }

  const secondaryBtn: React.CSSProperties = {
    background: 'var(--card)',
    border: '1px solid var(--border)',
    color: 'var(--foreground)',
  }

  return (
    <DeviceFrame>
      <StatusBar />
      {/* ── UNINITIALIZED: 選択画面 or 各インポート画面 ── */}
      {appState === 'UNINITIALIZED' && (
        <>
          {initChoice === 'setup' && <SecuritySetup />}
          {(initChoice === 'qr-import' || initChoice === 'ambe' || initChoice === 'mnemonic') && (
            <LockScreen initialMode={initChoice} />
          )}
          {initChoice === null && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col flex-1 items-center justify-center px-8 gap-6"
              style={{ paddingTop: '59px', paddingBottom: '20px' }}
            >
              {/* ロゴ */}
              <div className="flex flex-col items-center gap-3">
                <span style={{ fontSize: '52px' }}>📇</span>
                <h1 className="text-xl font-bold" style={{ color: 'var(--foreground)' }}>
                  あんべの名刺代わり
                </h1>
                <p className="text-sm text-center" style={{ color: 'var(--muted-foreground)' }}>
                  ようこそ。はじめ方を選んでください。
                </p>
              </div>
              {/* 選択ボタン */}
              <div className="flex flex-col gap-3 w-full">
                {/* 新規セットアップ */}
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setInitChoice('setup')}
                  className="w-full py-4 rounded-2xl font-bold text-sm"
                  style={primaryBtn}
                >
                  🆕 &ensp;新規セットアップ
                </motion.button>
                {/* 区切り */}
                <div className="flex items-center gap-3 w-full">
                  <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
                  <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                    すでに設定済みの方
                  </span>
                  <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
                </div>
                {/* インポート・復元手段 */}
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setInitChoice('qr-import')}
                  className="w-full py-3 rounded-xl text-sm font-medium text-left px-4"
                  style={secondaryBtn}
                >
                  📱 &ensp;別端末からQRで引き継ぐ
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setInitChoice('ambe')}
                  className="w-full py-3 rounded-xl text-sm font-medium text-left px-4"
                  style={secondaryBtn}
                >
                  📁 &ensp;.ambeファイルで復元
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setInitChoice('mnemonic')}
                  className="w-full py-3 rounded-xl text-sm font-medium text-left px-4"
                  style={secondaryBtn}
                >
                  🔑 &ensp;24単語で復旧
                </motion.button>
              </div>
            </motion.div>
          )}
        </>
      )}
      {/* ── LOCKED: 通常のロック画面 ── */}
      {appState === 'LOCKED' && <LockScreen />}
    </DeviceFrame>
  )
}
