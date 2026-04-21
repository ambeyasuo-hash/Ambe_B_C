export default function DeviceFrame({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Desktop outer background */}
      <div
        className="hidden md:flex min-h-screen items-center justify-center"
        style={{ background: 'oklch(0.10 0.015 250)' }}
      >
        {/* Device shell */}
        <div
          className="relative flex flex-col overflow-hidden"
          style={{
            width: '390px',
            height: 'min(844px, 92svh)',
            background: 'var(--background)',
            borderRadius: '48px',
            border: '1px solid oklch(0.28 0.04 250)',
            boxShadow: [
              '0 0 0 6px oklch(0.10 0.02 250)',
              '0 0 0 7px oklch(0.22 0.03 250)',
              '0 40px 80px -20px rgba(0,0,0,0.8)',
              'inset 0 1px 0 oklch(0.35 0.05 250 / 0.4)',
            ].join(', '),
          }}
        >
          <DynamicIsland />
          {children}
          <HomeIndicator />
        </div>
      </div>

      {/* Mobile: full viewport */}
      <div
        className="md:hidden flex flex-col"
        style={{
          height: '100svh',
          paddingTop: 'env(safe-area-inset-top)',
          background: 'var(--background)',
        }}
      >
        {children}
      </div>
    </>
  )
}

function DynamicIsland() {
  return (
    <div
      className="absolute z-10"
      style={{
        top: '12px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '120px',
        height: '34px',
        background: '#000',
        borderRadius: '20px',
      }}
    />
  )
}

function HomeIndicator() {
  return (
    <div
      className="absolute z-30 pointer-events-none"
      style={{
        bottom: '8px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '120px',
        height: '5px',
        background: 'oklch(0.80 0 0 / 0.30)',
        borderRadius: '3px',
      }}
    />
  )
}
