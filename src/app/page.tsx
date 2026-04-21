'use client'

// Phase 3 で実装するセッション状態
type AppState = 'UNINITIALIZED' | 'LOCKED' | 'UNLOCKED'

export default function Home() {
  // TODO Phase 3: useVault() から実際の状態を取得する
  const appState = 'LOCKED' as AppState

  if (appState === 'UNINITIALIZED') {
    return <div>TODO: SecuritySetup（Phase 3）</div>
  }

  if (appState === 'LOCKED') {
    return <div>TODO: LockScreen（Phase 3）</div>
  }

  return <div>TODO: MainApp（Phase 4・5）</div>
}
