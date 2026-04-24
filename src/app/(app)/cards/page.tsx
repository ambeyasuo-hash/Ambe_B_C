'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { getSupabaseClient } from '@/lib/supabase'
import { useVault } from '@/context/VaultContext'
import { aesDecryptString, hkdfDerive, hmacIndex } from '@/lib/crypto'
import { fetchCategories, createCategory, type Category } from '@/lib/categories'

type SortKey = 'date_desc' | 'date_asc' | 'name_asc'

interface CardRow {
  id: string
  encrypted_data: string
  encrypted_thumbnail_front: string | null
  card_category: string | null
  thank_you_sent: boolean
  scanned_at: string
}

interface DecryptedCard {
  id: string
  name: string
  company: string
  thumbnailUrl: string | null
  category: string | null
  thankYouSent: boolean
  colorIndex: number
  decryptFailed?: boolean
}

const GRADIENT_CLASSES = [
  'from-blue-500 to-cyan-400',
  'from-emerald-500 to-teal-400',
  'from-purple-500 to-pink-400',
]

function ScanIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <line x1="7" y1="12" x2="17" y2="12" />
    </svg>
  )
}

function SkeletonCard() {
  return <div className="rounded-2xl bg-card border border-white/10 h-[72px] animate-pulse" />
}

export default function CardsPage() {
  const router = useRouter()
  const { dataKey, bundle, appState } = useVault()

  const [cards, setCards] = useState<DecryptedCard[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isKeyMismatch, setIsKeyMismatch] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('すべて')
  const [sortKey, setSortKey] = useState<SortKey>('date_desc')
  const [showSortMenu, setShowSortMenu] = useState(false)

  const [categories, setCategories] = useState<Category[]>([])
  const [newCategoryName, setNewCategoryName] = useState<string | null>(null)
  const [newCategoryError, setNewCategoryError] = useState<string | null>(null)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [debouncedQuery, setDebouncedQuery] = useState('')

  useEffect(() => {
    if (appState !== 'UNLOCKED') {
      router.replace('/')
    }
  }, [appState, router])

  useEffect(() => {
    if (!bundle) return
    fetchCategories(bundle.supabase.url, bundle.supabase.anon_key, bundle.encryption_salt)
      .then(setCategories)
      .catch(() => setCategories([{ id: 'system-default', name: '未分類', color_index: 0, sort_order: 0 }]))
  }, [bundle])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedQuery(searchQuery), 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [searchQuery])

  const load = useCallback(async () => {
    if (!dataKey || !bundle) return
    setIsLoading(true)
    setError(null)
    try {
      const supabase = getSupabaseClient(bundle.supabase.url, bundle.supabase.anon_key)

      let query = supabase
        .from('business_cards')
        .select('id, encrypted_data, encrypted_thumbnail_front, card_category, thank_you_sent, scanned_at')
        .eq('encryption_salt', bundle.encryption_salt)

      if (debouncedQuery.trim()) {
        const hmacKeyBytes = await hkdfDerive(
          new TextEncoder().encode(bundle.encryption_salt),
          'blind-index-hmac',
          32,
        )
        const hash = await hmacIndex(hmacKeyBytes, debouncedQuery.trim().toLowerCase())
        query = query.contains('search_hashes', [hash])
      }

      if (selectedCategory !== 'すべて') {
        if (selectedCategory === '未分類') {
          query = query.is('card_category', null)
        } else {
          query = query.eq('card_category', selectedCategory)
        }
      }

      // created_at は NOT NULL DEFAULT now() で確実に存在するため sort に使用
      // scanned_at は nullable のため sort 列として不安定
      if (sortKey !== 'name_asc') {
        query = query.order('created_at', { ascending: sortKey === 'date_asc' })
      } else {
        query = query.order('created_at', { ascending: false })
      }

      const { data, error: fetchError } = await query
      if (fetchError) throw new Error(fetchError.message)

      const rows = (data ?? []) as CardRow[]
      const decrypted = await Promise.all(
        rows.map(async (row, i): Promise<DecryptedCard> => {
          try {
            const piiJson = await aesDecryptString(dataKey, row.encrypted_data)
            const pii = JSON.parse(piiJson) as { name?: string; company?: string }

            let thumbnailUrl: string | null = null
            if (row.encrypted_thumbnail_front) {
              thumbnailUrl = await aesDecryptString(dataKey, row.encrypted_thumbnail_front)
            }

            return {
              id: row.id,
              name: pii.name ?? '',
              company: pii.company ?? '',
              thumbnailUrl,
              category: row.card_category,
              thankYouSent: row.thank_you_sent,
              colorIndex: i % 3,
              decryptFailed: false,
            }
          } catch {
            return {
              id: row.id,
              name: '（復号失敗）',
              company: '',
              thumbnailUrl: null,
              category: row.card_category,
              thankYouSent: row.thank_you_sent,
              colorIndex: i % 3,
              decryptFailed: true,
            }
          }
        }),
      )

      const totalCards = decrypted.length
      const failedCards = decrypted.filter((c) => c.decryptFailed).length
      setIsKeyMismatch(totalCards > 0 && failedCards === totalCards)

      if (sortKey === 'name_asc') {
        decrypted.sort((a, b) => a.name.localeCompare(b.name, 'ja'))
      }

      setCards(decrypted)
    } catch (e) {
      setError(e instanceof Error ? e.message : '名刺の読み込みに失敗しました')
    } finally {
      setIsLoading(false)
    }
  }, [dataKey, bundle, debouncedQuery, selectedCategory, sortKey])

  useEffect(() => {
    load()
  }, [load])

  const handleAddCategory = useCallback(async () => {
    if (!bundle || !newCategoryName?.trim()) return
    setNewCategoryError(null)
    try {
      const colorIndex = categories.filter((c) => c.id !== 'system-default').length % 3
      const cat = await createCategory(
        bundle.supabase.url,
        bundle.supabase.anon_key,
        bundle.encryption_salt,
        newCategoryName.trim(),
        colorIndex,
      )
      setCategories((prev) => [...prev, cat])
      setSelectedCategory(cat.name)
      setNewCategoryName(null)
    } catch (e) {
      setNewCategoryError(e instanceof Error ? e.message : 'カテゴリ作成に失敗しました')
    }
  }, [bundle, newCategoryName, categories])

  const SORT_LABELS: Record<SortKey, string> = {
    date_desc: '登録日（新しい順）',
    date_asc: '登録日（古い順）',
    name_asc: '氏名（あいうえお順）',
  }

  const allCategoryNames = ['すべて', ...categories.map((c) => c.name)]

  return (
    <div className="flex flex-col flex-1 relative">
      {/* Search bar */}
      <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-xl border-b border-white/10 px-4 pt-3 pb-3 flex items-center gap-2">
        <div className="flex-1 relative">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="氏名・会社名で検索..."
            className="w-full rounded-xl bg-card border border-white/10 pl-9 pr-3 py-2
              text-sm text-foreground placeholder:text-muted-foreground
              focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" width="14" height="14"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
        </div>
        {/* Sort button */}
        <div className="relative">
          <button
            onClick={() => setShowSortMenu((v) => !v)}
            className="w-9 h-9 rounded-xl bg-card border border-white/10 flex items-center justify-center text-muted-foreground"
            aria-label="並び替え"
          >
            ⋯
          </button>
          <AnimatePresence>
            {showSortMenu && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -4 }}
                className="absolute right-0 top-11 z-30 w-52 rounded-2xl bg-card border border-white/10
                  shadow-xl shadow-black/40 overflow-hidden"
              >
                {(['date_desc', 'date_asc', 'name_asc'] as SortKey[]).map((key) => (
                  <button
                    key={key}
                    onClick={() => { setSortKey(key); setShowSortMenu(false) }}
                    className={`w-full text-left px-4 py-3 text-sm transition-colors
                      ${sortKey === key ? 'text-blue-400 bg-blue-500/10' : 'text-foreground hover:bg-white/5'}`}
                  >
                    {SORT_LABELS[key]}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Category filter chips */}
      <div className="px-4 pt-3 pb-2 flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {allCategoryNames.map((name) => {
          const isSelected = name === selectedCategory
          const cat = categories.find((c) => c.name === name)
          const gradClass = cat ? GRADIENT_CLASSES[cat.color_index % 3] : GRADIENT_CLASSES[0]
          return (
            <button
              key={name}
              onClick={() => setSelectedCategory(name)}
              className={`flex-none px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all
                ${isSelected
                  ? name === 'すべて'
                    ? 'bg-gradient-to-r from-blue-500 to-cyan-400 text-white'
                    : `bg-gradient-to-r ${gradClass} text-white`
                  : 'bg-card border border-white/10 text-muted-foreground'
                }`}
            >
              {name}
            </button>
          )
        })}

        {newCategoryName === null ? (
          <button
            onClick={() => setNewCategoryName('')}
            className="flex-none px-3 py-1.5 rounded-full text-xs font-medium border border-dashed
              border-white/30 text-muted-foreground whitespace-nowrap"
          >
            +
          </button>
        ) : (
          <div className="flex-none flex items-center gap-1.5">
            <input
              autoFocus
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddCategory()
                if (e.key === 'Escape') setNewCategoryName(null)
              }}
              maxLength={20}
              placeholder="カテゴリ名"
              className="w-24 px-2 py-1 rounded-xl bg-card border border-blue-500/60
                text-xs text-foreground focus:outline-none"
            />
            <button onClick={handleAddCategory} className="text-xs text-blue-400 font-medium">追加</button>
            <button onClick={() => { setNewCategoryName(null); setNewCategoryError(null) }}
              className="text-xs text-muted-foreground">✕</button>
          </div>
        )}
      </div>
      {newCategoryError && (
        <p className="px-4 pb-1 text-xs text-red-400">{newCategoryError}</p>
      )}

      {/* KEY_MISMATCH banner */}
      {isKeyMismatch && (
        <div className="mx-4 mt-4 rounded-2xl border border-red-500/40 bg-red-500/10 p-4">
          <p className="text-sm font-semibold text-red-400">🔑 暗号キーが一致しません</p>
          <p className="mt-1 text-xs text-red-300/80">
            このデバイスの暗号キーは保存されたカードと異なります。
            別端末でセットアップされた Vault の可能性があります。
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => router.push('/lock?mode=qr-import')}
              className="rounded-xl bg-red-500/20 px-3 py-1.5 text-xs text-red-300 border border-red-500/30"
            >
              QRペアリングで修復
            </button>
            <button
              onClick={() => router.push('/lock?mode=recovery')}
              className="rounded-xl bg-red-500/20 px-3 py-1.5 text-xs text-red-300 border border-red-500/30"
            >
              リカバリーフレーズで復元
            </button>
          </div>
        </div>
      )}

      {/* Card list */}
      <div className="flex flex-col gap-3 px-4 py-2">
        {isLoading && (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        )}

        {!isLoading && error && (
          <div className="flex flex-col items-center gap-4 py-12">
            <p className="text-sm text-red-400 text-center">{error}</p>
            <button onClick={() => load()} className="text-sm text-blue-400">
              再読み込み
            </button>
          </div>
        )}

        {!isLoading && !error && cards.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-16">
            {debouncedQuery.trim() ? (
              <p className="text-sm text-muted-foreground text-center">
                「{debouncedQuery}」に一致する名刺はありません
              </p>
            ) : (
              <>
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-r from-blue-500 to-cyan-400
                  flex items-center justify-center text-2xl">
                  📇
                </div>
                <p className="text-sm text-muted-foreground text-center leading-relaxed">
                  名刺がまだありません。<br />右下のボタンからスキャンしてください。
                </p>
              </>
            )}
          </div>
        )}

        {!isLoading && !error && cards.map((card, i) => {
          const grad = GRADIENT_CLASSES[card.colorIndex]
          return (
            <motion.div
              key={card.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => router.push(`/cards/${card.id}`)}
              className="rounded-2xl bg-card border border-white/10 overflow-hidden flex gap-3 p-3 cursor-pointer"
            >
              {/* Thumbnail / avatar */}
              <div className={`w-16 h-10 rounded-xl overflow-hidden flex-none
                bg-gradient-to-br ${grad.replace('from-', 'from-').replace('to-', 'to-')}/20
                flex items-center justify-center`}
                style={{ background: card.thumbnailUrl ? undefined : undefined }}>
                {card.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={card.thumbnailUrl} alt={card.name} className="w-full h-full object-cover" />
                ) : (
                  <div className={`w-full h-full flex items-center justify-center bg-gradient-to-br ${grad} bg-opacity-20`}>
                    <span className="text-lg font-bold text-white drop-shadow">
                      {card.name ? card.name[0] : '?'}
                    </span>
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0 flex items-center">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {card.name || '（氏名なし）'}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {card.company || '（会社名なし）'}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 flex-none ml-2">
                  {!card.thankYouSent && (
                    <span className="text-base" title="お礼メール未送信">✉️</span>
                  )}
                  {card.category && (
                    <span className={`text-[10px] px-2 py-0.5 rounded-full
                      bg-gradient-to-r ${grad} text-white`}>
                      {card.category}
                    </span>
                  )}
                </div>
              </div>
            </motion.div>
          )
        })}
      </div>

      {/* Scan FAB */}
      <motion.button
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        onClick={() => router.push('/scan')}
        className="fixed bottom-24 right-4 w-14 h-14 rounded-2xl
          bg-gradient-to-r from-blue-500 to-cyan-400
          shadow-lg shadow-blue-500/30 flex items-center justify-center text-white z-10"
        aria-label="名刺をスキャン"
      >
        <ScanIcon />
      </motion.button>

      {/* Close sort menu on backdrop click */}
      {showSortMenu && (
        <div className="fixed inset-0 z-20" onClick={() => setShowSortMenu(false)} />
      )}
    </div>
  )
}
