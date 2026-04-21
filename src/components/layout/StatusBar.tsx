type Props = {
  time?: string
  sessionTimer?: string
  isUnlocked?: boolean
}

export default function StatusBar({ time = '9:41', sessionTimer, isUnlocked = false }: Props) {
  return (
    <div
      className="flex items-end justify-between flex-shrink-0"
      style={{
        height: '59px',
        padding: '0 28px 8px',
        fontSize: '12px',
        fontWeight: '600',
        position: 'relative',
        zIndex: 5,
      }}
    >
      <span style={{ color: 'var(--foreground)' }}>{time}</span>

      <div className="flex items-center gap-2" style={{ fontSize: '11px' }}>
        {isUnlocked && sessionTimer && (
          <span
            title="15分間の無操作でロックされます"
            style={{
              background: 'oklch(0.65 0.2 250 / 0.15)',
              border: '1px solid oklch(0.65 0.2 250 / 0.3)',
              color: 'oklch(0.75 0.15 250)',
              padding: '3px 10px',
              borderRadius: '20px',
              fontSize: '11px',
              fontWeight: '600',
              cursor: 'default',
            }}
          >
            {sessionTimer}
          </span>
        )}
        {/* Battery icon */}
        <svg width="25" height="12" viewBox="0 0 25 12" fill="none" aria-hidden="true">
          <rect x="0.5" y="0.5" width="21" height="11" rx="3.5" stroke="currentColor" strokeOpacity="0.35" />
          <rect x="2" y="2" width="16" height="8" rx="2" fill="currentColor" />
          <path d="M23 4v4a2 2 0 000-4z" fill="currentColor" fillOpacity="0.4" />
        </svg>
      </div>
    </div>
  )
}
