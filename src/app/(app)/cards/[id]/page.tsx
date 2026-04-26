'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { getSupabaseClient } from '@/lib/supabase'
import { useVault } from '@/context/VaultContext'
import { aesDecryptString, aesEncryptString, hkdfDerive, hmacIndex } from '@/lib/crypto'

interface CardRow {
  id: string
  encrypted_data: string
  encrypted_thumbnail_front: string | null
  encrypted_thumbnail_back: string | null
  card_category: string | null
  thank_you_sent: boolean
  thank_you_sent_at: string | null
  scanned_at: string
  industry_category: string | null
  notes: string | null
}

interface PiiFields {
  name: string
  furigana: string
  company: string
  title: string
  email: string
  tel: string
  mobile?: string
  address: string
}

interface ScanLocation {
  lat: number
  lng: number
  accuracy: number
  name: string | null
}

interface CardState {
  row: CardRow
  pii: PiiFields
  thumbnailFrontUrl: string | null
  thumbnailBackUrl: string | null
  scanLocation: ScanLocation | null
}

const GRADIENT_CLASSES = [
  'from-blue-500 to-cyan-400',
  'from-emerald-500 to-teal-400',
  'from-purple-500 to-pink-400',
]

const FIELD_LABELS: Array<{ key: keyof PiiFields; label: string; type: string }> = [
  { key: 'name', label: '氏名', type: 'text' },
  { key: 'furigana', label: 'フリガナ', type: 'text' },
  { key: 'company', label: '会社名', type: 'text' },
  { key: 'title', label: '役職', type: 'text' },
  { key: 'email', label: 'メール', type: 'email' },
  { key: 'tel', label: '電話', type: 'tel' },
  { key: 'mobile', label: '携帯', type: 'tel' },
  { key: 'address', label: '住所', type: 'text' },
]

function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2000)
    return () => clearTimeout(t)
  }, [onDone])
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="fixed bottom-28 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl
        bg-foreground text-background text-sm font-medium shadow-lg whitespace-nowrap"
    >
      {message}
    </motion.div>
  )
}

export default function CardDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { dataKey, bundle, appState } = useVault()

  const [card, setCard] = useState<CardState | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [isEditing, setIsEditing] = useState(false)
  const [editFields, setEditFields] = useState<PiiFields & { notes: string; locationName: string }>({
    name: '', furigana: '', company: '', title: '', email: '', tel: '', mobile: '', address: '', notes: '', locationName: '',
  })
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const [toastMsg, setToastMsg] = useState<string | null>(null)

  const [geminiLoading, setGeminiLoading] = useState(false)
  const [geminiEmail, setGeminiEmail] = useState<string | null>(null)
  const [showGeminiModal, setShowGeminiModal] = useState(false)
  const [isSendingThankYou, setIsSendingThankYou] = useState(false)

  useEffect(() => {
    if (appState !== 'UNLOCKED') router.replace('/')
  }, [appState, router])

  const loadCard = useCallback(async () => {
    if (!dataKey || !bundle || !id) return
    setIsLoading(true)
    setError(null)
    try {
      const supabase = getSupabaseClient(bundle.supabase.url, bundle.supabase.anon_key)
      const { data, error: fetchError } = await supabase
        .from('business_cards')
        .select('id, encrypted_data, encrypted_thumbnail_front, encrypted_thumbnail_back, card_category, thank_you_sent, thank_you_sent_at, scanned_at, industry_category, notes')
        .eq('id', id)
        .eq('encryption_salt', bundle.encryption_salt)
        .single()

      if (fetchError) throw new Error(fetchError.message)
      if (!data) throw new Error('名刺が見つかりません')

      const row = data as CardRow
      const piiJson = await aesDecryptString(dataKey, row.encrypted_data)
      const rawPii = JSON.parse(piiJson) as Partial<PiiFields & {
        scanned_lat: number; scanned_lng: number; scanned_accuracy: number; scanned_location_name: string
      }>
      const pii: PiiFields = {
        name: rawPii.name ?? '',
        furigana: rawPii.furigana ?? '',
        company: rawPii.company ?? '',
        title: rawPii.title ?? '',
        email: rawPii.email ?? '',
        tel: rawPii.tel ?? '',
        mobile: rawPii.mobile ?? '',
        address: rawPii.address ?? '',
      }
      const scanLocation: ScanLocation | null = rawPii.scanned_lat != null ? {
        lat: rawPii.scanned_lat,
        lng: rawPii.scanned_lng!,
        accuracy: rawPii.scanned_accuracy ?? 0,
        name: rawPii.scanned_location_name ?? null,
      } : null

      let thumbnailFrontUrl: string | null = null
      if (row.encrypted_thumbnail_front) {
        thumbnailFrontUrl = await aesDecryptString(dataKey, row.encrypted_thumbnail_front)
      }
      let thumbnailBackUrl: string | null = null
      if (row.encrypted_thumbnail_back) {
        thumbnailBackUrl = await aesDecryptString(dataKey, row.encrypted_thumbnail_back)
      }

      setCard({ row, pii, thumbnailFrontUrl, thumbnailBackUrl, scanLocation })
      setEditFields({ ...pii, notes: row.notes ?? '', locationName: scanLocation?.name ?? '' })
    } catch (e) {
      setError(e instanceof Error ? e.message : '名刺の読み込みに失敗しました')
    } finally {
      setIsLoading(false)
    }
  }, [dataKey, bundle, id])

  useEffect(() => { loadCard() }, [loadCard])

  const handleCopy = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setToastMsg(`${label}をコピーしました`)
    } catch {
      setToastMsg('コピーに失敗しました')
    }
  }, [])

  const handleSaveEdit = useCallback(async () => {
    if (!dataKey || !bundle || !card) return
    setIsSaving(true)
    setSaveError(null)
    try {
      const piiJson = JSON.stringify({
        name: editFields.name,
        furigana: editFields.furigana,
        company: editFields.company,
        title: editFields.title,
        email: editFields.email,
        tel: editFields.tel,
        mobile: editFields.mobile,
        address: editFields.address,
        ...(card.scanLocation && {
          scanned_lat: card.scanLocation.lat,
          scanned_lng: card.scanLocation.lng,
          scanned_accuracy: card.scanLocation.accuracy,
          ...(editFields.locationName && { scanned_location_name: editFields.locationName }),
        }),
      })
      const encryptedData = await aesEncryptString(dataKey, piiJson)

      const hmacKeyBytes = await hkdfDerive(
        new TextEncoder().encode(bundle.encryption_salt),
        'blind-index-hmac',
        32,
      )
      const rawTokens = [
        editFields.name, editFields.company, editFields.title,
        editFields.email, editFields.tel,
      ]
        .filter(Boolean)
        .flatMap((s) => s.toLowerCase().split(/\s+/).filter((t) => t.length > 1))
      const uniqueTokens = [...new Set(rawTokens)]
      const searchHashes = await Promise.all(uniqueTokens.map((t) => hmacIndex(hmacKeyBytes, t)))

      const supabase = getSupabaseClient(bundle.supabase.url, bundle.supabase.anon_key)
      const { error: updateError } = await supabase
        .from('business_cards')
        .update({
          encrypted_data: encryptedData,
          search_hashes: searchHashes,
          notes: editFields.notes || null,
        })
        .eq('id', id)

      if (updateError) throw new Error(updateError.message)

      setCard((prev) => prev ? {
        ...prev,
        pii: { name: editFields.name, furigana: editFields.furigana, company: editFields.company, title: editFields.title, email: editFields.email, tel: editFields.tel, mobile: editFields.mobile, address: editFields.address },
        row: { ...prev.row, notes: editFields.notes || null },
        scanLocation: prev.scanLocation ? { ...prev.scanLocation, name: editFields.locationName || null } : null,
      } : null)
      setIsEditing(false)
      setToastMsg('保存しました')
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setIsSaving(false)
    }
  }, [dataKey, bundle, card, editFields, id])

  const handleDelete = useCallback(async () => {
    if (!bundle) return
    setIsDeleting(true)
    try {
      const supabase = getSupabaseClient(bundle.supabase.url, bundle.supabase.anon_key)
      const { error: deleteError } = await supabase.from('business_cards').delete().eq('id', id)
      if (deleteError) throw new Error(deleteError.message)
      router.push('/cards')
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除に失敗しました')
      setShowDeleteModal(false)
    } finally {
      setIsDeleting(false)
    }
  }, [bundle, id, router])

  const handleGeminiEmail = useCallback(async () => {
    if (!bundle || !card) return
    if (!bundle.gemini.key) {
      setToastMsg('Gemini API キーが設定されていません')
      return
    }
    setGeminiLoading(true)
    try {
      const { name, company, title } = card.pii
      const industry = card.row.industry_category ?? card.row.card_category ?? '不明'
      const prompt = [
        '名刺交換後のお礼メールを日本語で作成してください。',
        '',
        '【相手の情報】',
        `氏名：${name || '（不明）'}`,
        `会社名：${company || '（不明）'}`,
        `部署・役職：${title || '（不明）'}`,
        `業界：${industry}`,
        '',
        '【厳守事項】',
        '- 件名と本文のみを出力すること。解説・コメント・注釈・見出し・箇条書きは一切出力しないこと',
        '- {{}} 等のプレースホルダーは使わず、上記の情報を本文に直接記載すること',
        '- 署名欄の氏名・会社名・部署は「（要記入）」とし、メールアドレスは「（要記入）」とすること',
        '- 出力形式：件名：〇〇 の1行の後に空行、そのまま本文（宛名から署名まで）',
      ].join('\n')
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, geminiKey: bundle.gemini.key }),
      })
      const json = (await res.json()) as { text?: string; error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Gemini API エラー')

      setGeminiEmail((json.text ?? '').trim())
      setShowGeminiModal(true)
    } catch (e) {
      setToastMsg(e instanceof Error ? e.message : 'メール生成に失敗しました')
    } finally {
      setGeminiLoading(false)
    }
  }, [bundle, card])

  const handleMarkThankYouSent = useCallback(async () => {
    if (!bundle || !card) return
    setIsSendingThankYou(true)
    try {
      const supabase = getSupabaseClient(bundle.supabase.url, bundle.supabase.anon_key)
      const { error: updateError } = await supabase
        .from('business_cards')
        .update({ thank_you_sent: true, thank_you_sent_at: new Date().toISOString() })
        .eq('id', id)
      if (updateError) throw new Error(updateError.message)
      setCard((prev) => prev ? {
        ...prev,
        row: { ...prev.row, thank_you_sent: true, thank_you_sent_at: new Date().toISOString() },
      } : null)
      setToastMsg('送信済みにしました')
    } catch (e) {
      setToastMsg(e instanceof Error ? e.message : '更新に失敗しました')
    } finally {
      setIsSendingThankYou(false)
    }
  }, [bundle, card, id])

  const categoryGrad = card?.row.card_category
    ? GRADIENT_CLASSES[0]
    : null

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 px-4 py-4">
        <div className="h-48 rounded-2xl bg-card border border-white/10 animate-pulse" />
        <div className="h-[200px] rounded-2xl bg-card border border-white/10 animate-pulse" />
      </div>
    )
  }

  if (error || !card) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 px-4">
        <p className="text-sm text-red-400 text-center">{error ?? '名刺が見つかりません'}</p>
        <button onClick={() => router.push('/cards')} className="text-sm text-blue-400">
          一覧に戻る
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-full">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-xl border-b border-white/10
        flex items-center px-4 py-3 gap-3">
        <button onClick={() => router.push('/cards')} className="text-muted-foreground text-sm">
          ‹ 戻る
        </button>
        <span className="flex-1 text-sm font-semibold text-foreground truncate">
          {card.pii.name || '（氏名なし）'}
        </span>
        {!isEditing && (
          <button
            onClick={() => setIsEditing(true)}
            className="text-sm text-blue-400"
          >
            ✏️ 編集
          </button>
        )}
      </div>

      <div className="flex flex-col gap-4 px-4 py-4 pb-8">
        {/* Hero: thumbnails */}
        <div className="relative rounded-2xl overflow-hidden">
          {card.thumbnailFrontUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={card.thumbnailFrontUrl} alt="名刺表面" className="w-full aspect-video object-cover" />
          ) : (
            <div className="w-full aspect-video bg-gradient-to-br from-blue-500/20 to-cyan-400/20
              flex items-center justify-center">
              <span className="text-5xl font-bold text-white/40">
                {card.pii.name ? card.pii.name[0] : '?'}
              </span>
            </div>
          )}
          {card.row.card_category && categoryGrad && (
            <span className={`absolute top-3 right-3 text-[10px] px-2 py-1 rounded-full
              bg-gradient-to-r ${categoryGrad} text-white font-medium`}>
              {card.row.card_category}
            </span>
          )}
        </div>

        {card.thumbnailBackUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.thumbnailBackUrl} alt="名刺裏面" className="w-full aspect-video object-cover rounded-2xl" />
        ) : (
          <div className="w-full aspect-video bg-card border border-white/10 rounded-2xl
            flex items-center justify-center">
            <p className="text-xs text-muted-foreground">裏面なし</p>
          </div>
        )}

        {/* Fields */}
        <div className="rounded-2xl bg-card border border-white/10 p-4 flex flex-col gap-4">
          {isEditing ? (
            <>
              {FIELD_LABELS.map(({ key, label, type }) => (
                <div key={key}>
                  <label className="text-xs text-muted-foreground">{label}</label>
                  <input
                    type={type}
                    value={editFields[key]}
                    onChange={(e) => setEditFields((prev) => ({ ...prev, [key]: e.target.value }))}
                    className="mt-1 w-full rounded-xl bg-background border border-white/10 px-3 py-2
                      text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              ))}
              <div>
                <label className="text-xs text-muted-foreground">メモ</label>
                <textarea
                  value={editFields.notes}
                  onChange={(e) => setEditFields((prev) => ({ ...prev, notes: e.target.value }))}
                  rows={3}
                  className="mt-1 w-full rounded-xl bg-background border border-white/10 px-3 py-2
                    text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                />
              </div>
              {card.scanLocation && (
                <div className="border-t border-white/5 pt-3">
                  <label className="text-xs text-muted-foreground">初回名刺交換場所</label>
                  <input
                    type="text"
                    value={editFields.locationName}
                    onChange={(e) => setEditFields((prev) => ({ ...prev, locationName: e.target.value }))}
                    placeholder="場所名（任意）"
                    className="mt-1 w-full rounded-xl bg-background border border-white/10 px-3 py-2
                      text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <a
                    href={`https://maps.google.com/?q=${card.scanLocation.lat},${card.scanLocation.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400/70 mt-1 block"
                  >
                    📍 {card.scanLocation.lat.toFixed(5)}, {card.scanLocation.lng.toFixed(5)}
                  </a>
                </div>
              )}
              {saveError && <p className="text-xs text-red-400">{saveError}</p>}
              <div className="flex gap-2">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleSaveEdit}
                  disabled={isSaving}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-400
                    text-white text-sm font-semibold disabled:opacity-40"
                >
                  {isSaving ? '保存中...' : '保存'}
                </motion.button>
                <button
                  onClick={() => { setIsEditing(false); setSaveError(null); setEditFields({ ...card.pii, notes: card.row.notes ?? '', locationName: card.scanLocation?.name ?? '' }) }}
                  className="flex-1 py-2.5 rounded-xl bg-secondary border border-white/10 text-foreground text-sm"
                >
                  キャンセル
                </button>
              </div>
            </>
          ) : (
            <>
              {FIELD_LABELS.map(({ key, label }) => {
                const value = card.pii[key]
                return (
                  <div key={key} className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className={`text-sm mt-0.5 break-all ${value ? 'text-foreground' : 'text-white/25'}`}>
                        {value || '—'}
                      </p>
                    </div>
                    {value && (
                      <button
                        onClick={() => handleCopy(value, label)}
                        className="flex-none text-[10px] px-2 py-1 rounded-lg bg-white/5 text-muted-foreground
                          border border-white/10 mt-4 hover:bg-white/10 transition-colors"
                      >
                        コピー
                      </button>
                    )}
                  </div>
                )
              })}
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">メモ</p>
                  {card.row.notes ? (
                    <p className="text-sm text-foreground mt-0.5 whitespace-pre-wrap">{card.row.notes}</p>
                  ) : (
                    <p className="text-sm text-white/25 mt-0.5">—</p>
                  )}
                </div>
                {card.row.notes && (
                  <button
                    onClick={() => handleCopy(card.row.notes!, 'メモ')}
                    className="flex-none text-[10px] px-2 py-1 rounded-lg bg-white/5 text-muted-foreground
                      border border-white/10 mt-4 hover:bg-white/10 transition-colors"
                  >
                    コピー
                  </button>
                )}
              </div>
              {/* 初回名刺交換場所 */}
              <div className="flex items-start gap-2 border-t border-white/5 pt-4">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">初回名刺交換場所</p>
                  {card.scanLocation ? (
                    <>
                      <p className={`text-sm mt-0.5 ${card.scanLocation.name ? 'text-foreground' : 'text-white/25'}`}>
                        {card.scanLocation.name || '（地名未取得）'}
                      </p>
                      <a
                        href={`https://maps.google.com/?q=${card.scanLocation.lat},${card.scanLocation.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-400/70 mt-0.5 block"
                      >
                        📍 {card.scanLocation.lat.toFixed(5)}, {card.scanLocation.lng.toFixed(5)}（精度 ±{Math.round(card.scanLocation.accuracy)}m）
                      </a>
                    </>
                  ) : (
                    <p className="text-sm text-white/25 mt-0.5">—</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Thank-you email section */}
        <div className="rounded-2xl bg-card border border-white/10 p-4 flex flex-col gap-3">
          <p className="text-xs text-muted-foreground font-medium">お礼メール</p>
          {card.row.thank_you_sent ? (
            <div className="flex items-center gap-2 text-sm text-emerald-400">
              <span>✓</span>
              <span>送信済み</span>
              {card.row.thank_you_sent_at && (
                <span className="text-xs text-muted-foreground ml-auto">
                  {new Date(card.row.thank_you_sent_at).toLocaleDateString('ja-JP')}
                </span>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={handleGeminiEmail}
                disabled={geminiLoading}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-pink-400
                  text-white text-sm font-medium disabled:opacity-40"
              >
                {geminiLoading ? '⏳ 生成中...' : '✉️ お礼メールを作成'}
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={handleMarkThankYouSent}
                disabled={isSendingThankYou}
                className="w-full py-2.5 rounded-xl bg-card border border-white/20
                  text-foreground text-sm disabled:opacity-40"
              >
                {isSendingThankYou ? '更新中...' : '✓ 送信済みにする'}
              </motion.button>
            </div>
          )}
        </div>

        {/* Delete button */}
        {!isEditing && (
          <button
            onClick={() => setShowDeleteModal(true)}
            className="w-full py-3 rounded-2xl border border-red-500/30 text-red-400 text-sm"
          >
            🗑 この名刺を削除
          </button>
        )}
      </div>

      {/* Delete confirmation modal */}
      <AnimatePresence>
        {showDeleteModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setShowDeleteModal(false)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[390px] bg-card rounded-t-3xl p-6 flex flex-col gap-4
                border-t border-white/10"
            >
              <h3 className="text-base font-bold text-foreground">この名刺を削除しますか？</h3>
              <p className="text-sm text-muted-foreground">この操作は取り消せません。</p>
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={handleDelete}
                disabled={isDeleting}
                className="w-full py-3 rounded-2xl text-white text-sm font-semibold
                  disabled:opacity-40"
                style={{ background: 'oklch(0.577 0.245 27.325)' }}
              >
                {isDeleting ? '削除中...' : '削除する'}
              </motion.button>
              <button
                onClick={() => setShowDeleteModal(false)}
                className="w-full py-3 rounded-2xl bg-secondary border border-white/10 text-foreground text-sm"
              >
                キャンセル
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Gemini email modal */}
      <AnimatePresence>
        {showGeminiModal && geminiEmail !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setShowGeminiModal(false)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[390px] bg-card rounded-t-3xl p-6 flex flex-col gap-4
                border-t border-white/10 max-h-[80svh] overflow-y-auto"
            >
              <h3 className="text-base font-bold text-foreground">お礼メール</h3>
              <textarea
                value={geminiEmail}
                onChange={(e) => setGeminiEmail(e.target.value)}
                rows={10}
                className="w-full rounded-xl bg-background border border-white/10 px-3 py-2
                  text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500 resize-none"
              />
              <div className="flex gap-2">
                {card.pii.email && (
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => {
                      const subject = encodeURIComponent('先日はありがとうございました')
                      const body = encodeURIComponent(geminiEmail)
                      window.open(`mailto:${card.pii.email}?subject=${subject}&body=${body}`)
                    }}
                    className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-pink-400
                      text-white text-sm font-medium"
                  >
                    メールアプリで開く
                  </motion.button>
                )}
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => handleCopy(geminiEmail, 'メール')}
                  className="flex-1 py-2.5 rounded-xl bg-secondary border border-white/10
                    text-foreground text-sm"
                >
                  コピー
                </motion.button>
              </div>
              <button
                onClick={() => setShowGeminiModal(false)}
                className="w-full py-2 text-sm text-muted-foreground"
              >
                閉じる
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toastMsg && (
          <Toast message={toastMsg} onDone={() => setToastMsg(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}
