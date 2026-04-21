import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'

const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
})

export const metadata: Metadata = {
  title: 'あんべの名刺代わり',
  description: 'Zero-Knowledge 名刺管理',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja" className={`${geist.variable} dark`}>
      <body className="font-[var(--font-geist),system-ui,sans-serif]">
        {children}
      </body>
    </html>
  )
}
