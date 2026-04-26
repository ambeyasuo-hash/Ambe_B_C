'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { useVault } from '@/context/VaultContext'
import SecuritySetup from '@/components/auth/SecuritySetup'
import LockScreen from '@/components/auth/LockScreen'
import DeviceFrame from '@/components/layout/DeviceFrame'
import StatusBar from '@/components/layout/StatusBar'

const APP_VERSION = 'v6.2.1'

// 取扱説明書 URL — Notion ページ作成後にここを差し替える
const MANUAL_URL = 'https://github.com/ambeyasuo-hash/Ambe_B_C/blob/master/docs/manual.md'

const TICKER_ITEMS = [
  `📦 ${APP_VERSION}`,
  '📍 スキャン位置情報・逆ジオコーディング対応',
  '🗂 名刺詳細でカテゴリ編集が可能に',
  '🔑 24単語リカバリをメールアドレスで検索（mnemonic 再生成後も復旧可）',
  '✉️ お礼メール生成の精度向上（プレースホルダーなし・相手情報を直接埋め込み）',
  '📸 横向き名刺 3 択撮影モード確定',
  '🔐 生体認証フロー安定化（PRF upgrade）',
  '📁 .ambe ファイルによる引き継ぎ・復元',
  '🔒 Zero-Knowledge / E2EE — サーバーに平文 PII は一切保存されません',
]

function VersionTicker() {
  const text = TICKER_ITEMS.join('　　・　　')
  return (
    <div
      className="overflow-hidden border-b border-white/10"
      style={{ background: 'oklch(0.14 0.02 255 / 0.55)' }}
    >
      <div
        style={{
          display: 'flex',
          whiteSpace: 'nowrap',
          animation: 'ambe-ticker 36s linear infinite',
        }}
      >
        {[0, 1].map((i) => (
          <span
            key={i}
            className="text-[11px] py-1.5 px-6 flex-shrink-0"
            style={{ color: 'var(--muted-foreground)' }}
          >
            {text}
          </span>
        ))}
      </div>
      <style>{`
        @keyframes ambe-ticker {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  )
}

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
              className="flex flex-col flex-1"
              style={{ paddingTop: '59px' }}
            >
              {/* 電光掲示板ティッカー */}
              <VersionTicker />

              {/* メインコンテンツ */}
              <div className="flex flex-col flex-1 items-center justify-center px-8 gap-6 py-6">
                {/* ロゴ */}
                <div className="flex flex-col items-center gap-2">
                  <span style={{ fontSize: '52px' }}>📇</span>
                  <h1 className="text-xl font-bold" style={{ color: 'var(--foreground)' }}>
                    あんべの名刺代わり
                  </h1>
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full border font-mono"
                    style={{ color: 'var(--muted-foreground)', borderColor: 'var(--border)' }}
                  >
                    {APP_VERSION}
                  </span>
                  <p className="text-sm text-center mt-1" style={{ color: 'var(--muted-foreground)' }}>
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

                {/* 取扱説明書リンク */}
                <a
                  href={MANUAL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs flex items-center gap-1.5 mt-auto"
                  style={{ color: 'var(--muted-foreground)' }}
                >
                  <span>📖</span>
                  <span className="underline underline-offset-2">取扱説明書・セットアップガイド</span>
                </a>
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
