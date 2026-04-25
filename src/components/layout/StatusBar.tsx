type Props = {
  sessionTimer?: string
  isUnlocked?: boolean
}

export default function StatusBar({ sessionTimer, isUnlocked = false }: Props) {
  return (
    <div
      className="flex items-end justify-end flex-shrink-0"
      style={{
        height: '59px',
        padding: '0 28px 8px',
        fontSize: '12px',
        fontWeight: '600',
        position: 'relative',
        zIndex: 5,
      }}
    >

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
      </div>
    </div>
  )
}
