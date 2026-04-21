type Tab = 'cards' | 'scan' | 'settings'

type Props = {
  activeTab: Tab
  onTabChange: (tab: Tab) => void
}

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'cards',    icon: '🗂',  label: '名刺' },
  { id: 'scan',     icon: '📷', label: 'スキャン' },
  { id: 'settings', icon: '⚙️', label: '設定' },
]

export default function BottomNav({ activeTab, onTabChange }: Props) {
  return (
    <div
      className="absolute bottom-0 left-0 right-0 flex items-center justify-around"
      style={{
        height: '82px',
        background: 'oklch(0.12 0.02 250 / 0.9)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop: '1px solid oklch(0.22 0.03 250 / 0.6)',
        padding: '0 8px 20px',
        zIndex: 20,
      }}
    >
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className="flex flex-col items-center gap-1"
            style={{
              padding: '8px 20px',
              borderRadius: '12px',
              cursor: 'pointer',
              background: 'none',
              border: 'none',
              transition: 'background 0.15s',
            }}
          >
            <span
              style={{
                fontSize: '20px',
                opacity: isActive ? 1 : 0.5,
                filter: isActive ? 'drop-shadow(0 0 6px oklch(0.65 0.2 250 / 0.8))' : 'none',
              }}
            >
              {tab.icon}
            </span>
            <span
              style={{
                fontSize: '10px',
                fontWeight: '600',
                color: isActive ? 'oklch(0.75 0.18 250)' : 'var(--muted-foreground)',
              }}
            >
              {tab.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
