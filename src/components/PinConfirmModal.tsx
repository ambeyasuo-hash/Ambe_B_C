'use client'

import { useState } from 'react'

interface Props {
  title: string
  onConfirm: (pin: string) => void
  onCancel: () => void
}

export function PinConfirmModal({ title, onConfirm, onCancel }: Props) {
  const [pin, setPin] = useState('')

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-[390px] rounded-t-3xl bg-[var(--color-surface-2,#1a1a1a)] p-6">
        <p className="text-sm font-semibold text-white">{title}</p>
        <input
          type="password"
          inputMode="numeric"
          maxLength={8}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          className="mt-3 w-full rounded-xl bg-white/10 px-4 py-3 text-white placeholder:text-white/40
            focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="PINを入力"
          autoFocus
        />
        <div className="mt-4 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-xl bg-white/10 py-3 text-sm text-white/70 font-medium
              hover:bg-white/15 transition-colors"
          >
            キャンセル
          </button>
          <button
            onClick={() => onConfirm(pin)}
            disabled={!pin}
            className="flex-1 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-400 py-3 text-sm
              font-semibold text-white disabled:opacity-50"
          >
            確認
          </button>
        </div>
      </div>
    </div>
  )
}
