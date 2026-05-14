'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { getSupabaseClient } from '@/lib/supabase'
import { useVault } from '@/context/VaultContext'
import { aesDecryptString, aesEncryptString } from '@/lib/crypto'
import { fetchCategories, type Category } from '@/lib/categories'
import { reverseGeocode } from '@/lib/geocode'
import { autoFurigana } from '@/lib/furigana'
import { buildSearchHashes, buildSearchTokensFromValues } from '@/lib/normalize'

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
  department?: string
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
  { key: 'department', label: '部署', type: 'text' },
  { key: 'title', label: '役職', type: 'text' },
  { key: 'email', label: 'メール', type: 'email' },
  { key: 'tel', label: '電話', type: 'tel' },
  { key: 'mobile', label: '携帯', type: 'tel' },
  { key: 'address', label: '住所', type: 'text' },
]

const EMAIL_PLACEHOLDERS: Record<keyof PiiFields, string> = {
  name: '[[NAME]]',
  furigana: '[[FURIGANA]]',
  company: '[[COMPANY]]',
  department: '[[DEPARTMENT]]',
  title: '[[TITLE]]',
  email: '[[EMAIL]]',
  tel: '[[TEL]]',
  mobile: '[[MOBILE]]',
  address: '[[ADDRESS]]',
}

function applyEmailPlaceholders(draft: string, pii: PiiFields) {
  const replacements: Record<keyof PiiFields, string> = {
    name: pii.name || 'ご担当者',
    furigana: pii.furigana || '',
    company: pii.company || '',
    department: pii.department || '',
    title: pii.title || '',
    email: pii.email || '',
    tel: pii.tel || '',
    mobile: pii.mobile || '',
    address: pii.address || '',
  }

  let result = draft
  for (const [key, placeholder] of Object.entries(EMAIL_PLACEHOLDERS) as Array<[keyof PiiFields, string]>) {
    result = result.replaceAll(placeholder, replacements[key])
  }

  return result
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]+/gm, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

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
    name: '', furigana: '', company: '', department: '', title: '', email: '', tel: '', mobile: '', address: '', notes: '', locationName: '',
  })
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [furiganaLoading, setFuriganaLoading] = useState(false)

  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const [toastMsg, setToastMsg] = useState<string | null>(null)

  const [categories, setCategories] = useState<Category[]>([])
  const [editCategoryId, setEditCategoryId] = useState('system-default')
  const [showCoordEdit, setShowCoordEdit] = useState(false)
  const [editLocLat, setEditLocLat] = useState('')
  const [editLocLng, setEditLocLng] = useState('')
  const [coordGeoLoading, setCoordGeoLoading] = useState(false)

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
        .is('deleted_at', null)
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
        department: rawPii.department ?? '',
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
      setEditFields({ ...pii, department: pii.department ?? '', notes: row.notes ?? '', locationName: scanLocation?.name ?? '' })
    } catch (e) {
      setError(e instanceof Error ? e.message : '名刺の読み込みに失敗しました')
    } finally {
      setIsLoading(false)
    }
  }, [dataKey, bundle, id])

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadCard()
    }, 0)
    return () => clearTimeout(timer)
  }, [loadCard])

  useEffect(() => {
    if (!bundle) return
    fetchCategories(bundle.supabase.url, bundle.supabase.anon_key, bundle.encryption_salt)
      .then(setCategories)
      .catch(() => {})
  }, [bundle])

  const handleNameBlur = useCallback(async () => {
    if (!editFields.furigana && editFields.name) {
      setFuriganaLoading(true)
      const result = await autoFurigana(editFields.name, bundle?.gemini.key)
      if (result) setEditFields((prev) => ({ ...prev, furigana: result }))
      setFuriganaLoading(false)
    }
  }, [editFields.name, editFields.furigana, bundle])

  const handleEditCoordChange = useCallback(async () => {
    const lat = parseFloat(editLocLat)
    const lng = parseFloat(editLocLng)
    if (isNaN(lat) || isNaN(lng)) return
    setCoordGeoLoading(true)
    const name = await reverseGeocode(lat, lng)
    if (name !== null) setEditFields((prev) => ({ ...prev, locationName: name }))
    setCoordGeoLoading(false)
  }, [editLocLat, editLocLng])

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
      // カテゴリ
      const selectedCat = categories.find((c) => c.id === editCategoryId)
      const newCardCategory = editCategoryId === 'system-default' ? null : (selectedCat?.name ?? null)

      // 座標（手動修正済みがあればそちらを優先）
      const lat = editLocLat ? parseFloat(editLocLat) : null
      const lng = editLocLng ? parseFloat(editLocLng) : null
      const hasValidCoords = lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)
      const updatedLocation: ScanLocation | null = card.scanLocation
        ? {
            lat: hasValidCoords ? lat! : card.scanLocation.lat,
            lng: hasValidCoords ? lng! : card.scanLocation.lng,
            accuracy: card.scanLocation.accuracy,
            name: editFields.locationName || null,
          }
        : null

      const piiJson = JSON.stringify({
        name: editFields.name,
        furigana: editFields.furigana,
        company: editFields.company,
        department: editFields.department,
        title: editFields.title,
        email: editFields.email,
        tel: editFields.tel,
        mobile: editFields.mobile,
        address: editFields.address,
        ...(updatedLocation && {
          scanned_lat: updatedLocation.lat,
          scanned_lng: updatedLocation.lng,
          scanned_accuracy: updatedLocation.accuracy,
          ...(updatedLocation.name && { scanned_location_name: updatedLocation.name }),
        }),
      })
      const encryptedData = await aesEncryptString(dataKey, piiJson)

      const uniqueTokens = buildSearchTokensFromValues([
        editFields.name,
        editFields.furigana,
        editFields.company,
        editFields.department,
        editFields.title,
        editFields.email,
        editFields.tel,
        editFields.mobile,
      ])
      const searchHashes = await buildSearchHashes(uniqueTokens, bundle, { includeLegacy: false })

      const res = await fetch('/api/update-business-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'details',
          id,
          encryption_salt: bundle.encryption_salt,
          supabaseUrl: bundle.supabase.url,
          supabaseAnonKey: bundle.supabase.anon_key,
          encrypted_data: encryptedData,
          search_hashes: searchHashes,
          notes: editFields.notes || null,
          card_category: newCardCategory,
          userEmail: bundle.userEmail,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string; id?: string }
      if (!res.ok) {
        const err = json
        throw new Error(err.error ?? '保存に失敗しました')
      }
      const nextId = json.id ?? id

      setCard((prev) => prev ? {
        ...prev,
        pii: { name: editFields.name, furigana: editFields.furigana, company: editFields.company, department: editFields.department, title: editFields.title, email: editFields.email, tel: editFields.tel, mobile: editFields.mobile, address: editFields.address },
        row: { ...prev.row, id: nextId, notes: editFields.notes || null, card_category: newCardCategory },
        scanLocation: updatedLocation,
      } : null)
      setIsEditing(false)
      if (nextId !== id) router.replace(`/cards/${nextId}`)
      setToastMsg('保存しました')
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setIsSaving(false)
    }
  }, [dataKey, bundle, card, editFields, id, editCategoryId, categories, editLocLat, editLocLng, router])

  const handleDelete = useCallback(async () => {
    if (!bundle) return
    setIsDeleting(true)
    try {
      const res = await fetch('/api/delete-business-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          encryption_salt: bundle.encryption_salt,
          supabaseUrl: bundle.supabase.url,
          supabaseAnonKey: bundle.supabase.anon_key,
          userEmail: bundle.userEmail,
        }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error ?? '削除に失敗しました')
      }
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
      const industry = card.row.industry_category ?? '不明'
      // 制御文字・改行をサニタイズして Gemini プロンプトインジェクションを防ぐ
      const san = (s: string) => s.replace(/[\n\r\x00-\x1f\x7f]/g, ' ').trim().slice(0, 200)
      const prompt = [
        '名刺交換後のお礼メールを日本語で作成してください。',
        '',
        '【利用できる非個人情報】',
        `業種・カテゴリ：${san(industry)}`,
        '',
        '【個人情報プレースホルダー】',
        '- 宛名や本文で必要な場合は、以下のプレースホルダーを文字列どおりに使うこと',
        `- 氏名：${EMAIL_PLACEHOLDERS.name}`,
        `- 会社名：${EMAIL_PLACEHOLDERS.company}`,
        `- 部署名：${EMAIL_PLACEHOLDERS.department}`,
        `- 役職：${EMAIL_PLACEHOLDERS.title}`,
        '- メールアドレス、電話番号、住所は本文に含めないこと',
        '',
        '【厳守事項】',
        '- 氏名、会社名、部署名、役職、メールアドレス、電話番号、住所などの実データは提供されていません。推測しないこと',
        '- プレースホルダーを変更、翻訳、装飾、分解しないこと',
        '- 件名と本文のみを出力すること。解説・コメント・注釈・見出し・箇条書きは一切出力しないこと',
        '- 出力形式：件名：〇〇 の1行の後に空行、そのまま本文',
      ].join('\n')
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, geminiKey: bundle.gemini.key }),
      })
      const json = (await res.json()) as { text?: string; error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Gemini API エラー')

      setGeminiEmail(applyEmailPlaceholders(json.text ?? '', card.pii))
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
      const res = await fetch('/api/update-business-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'thank_you',
          id,
          encryption_salt: bundle.encryption_salt,
          supabaseUrl: bundle.supabase.url,
          supabaseAnonKey: bundle.supabase.anon_key,
          userEmail: bundle.userEmail,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        thank_you_sent_at?: string
      }
      if (!res.ok) throw new Error(json.error ?? '更新に失敗しました')
      const thankYouSentAt = json.thank_you_sent_at ?? new Date().toISOString()
      setCard((prev) => prev ? {
        ...prev,
        row: { ...prev.row, thank_you_sent: true, thank_you_sent_at: thankYouSentAt },
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
            onClick={() => {
              setIsEditing(true)
              setEditFields((prev) => ({ ...prev, department: card.pii.department ?? '' }))
              setEditCategoryId(categories.find((c) => c.name === card.row.card_category)?.id ?? 'system-default')
              setEditLocLat(card.scanLocation?.lat.toFixed(6) ?? '')
              setEditLocLng(card.scanLocation?.lng.toFixed(6) ?? '')
              setShowCoordEdit(false)
            }}
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
                  <label className="text-xs text-muted-foreground flex items-center gap-2">
                    {label}
                    {key === 'furigana' && furiganaLoading && (
                      <span className="text-[10px] text-blue-400 animate-pulse">取得中...</span>
                    )}
                  </label>
                  <input
                    type={type}
                    value={editFields[key] ?? ''}
                    onChange={(e) => setEditFields((prev) => ({ ...prev, [key]: e.target.value }))}
                    onBlur={key === 'name' ? handleNameBlur : undefined}
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
                  <button
                    onClick={() => setShowCoordEdit((v) => !v)}
                    className="text-xs text-muted-foreground/60 mt-2"
                  >
                    座標を修正 {showCoordEdit ? '▴' : '▾'}
                  </button>
                  {showCoordEdit && (
                    <div className="flex gap-2 mt-2">
                      <div className="flex-1">
                        <label className="text-[10px] text-muted-foreground">緯度</label>
                        <input
                          type="number"
                          value={editLocLat}
                          onChange={(e) => setEditLocLat(e.target.value)}
                          onBlur={handleEditCoordChange}
                          step="0.000001"
                          className="mt-1 w-full rounded-xl bg-background border border-white/10 px-2 py-1.5
                            text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-[10px] text-muted-foreground">経度</label>
                        <input
                          type="number"
                          value={editLocLng}
                          onChange={(e) => setEditLocLng(e.target.value)}
                          onBlur={handleEditCoordChange}
                          step="0.000001"
                          className="mt-1 w-full rounded-xl bg-background border border-white/10 px-2 py-1.5
                            text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  )}
                  {coordGeoLoading && <p className="text-[10px] text-muted-foreground mt-1">地名を取得中...</p>}
                </div>
              )}
              <div className="border-t border-white/5 pt-3">
                <label className="text-xs text-muted-foreground">カテゴリ</label>
                <div className="flex flex-wrap gap-2 mt-2">
                  <button
                    onClick={() => setEditCategoryId('system-default')}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${editCategoryId === 'system-default' ? 'bg-white/20 border-white/30 text-foreground' : 'bg-transparent border-white/10 text-muted-foreground'}`}
                  >
                    未分類
                  </button>
                  {categories.map((cat, idx) => (
                    <button
                      key={cat.id}
                      onClick={() => setEditCategoryId(cat.id)}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${editCategoryId === cat.id ? `bg-gradient-to-r ${GRADIENT_CLASSES[idx % 3]} text-white` : 'bg-white/5 border border-white/10 text-muted-foreground'}`}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              </div>
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
                  onClick={() => {
                    setIsEditing(false)
                    setSaveError(null)
                    setEditFields({ ...card.pii, department: card.pii.department ?? '', notes: card.row.notes ?? '', locationName: card.scanLocation?.name ?? '' })
                    setEditCategoryId(categories.find((c) => c.name === card.row.card_category)?.id ?? 'system-default')
                    setEditLocLat(card.scanLocation?.lat.toFixed(6) ?? '')
                    setEditLocLng(card.scanLocation?.lng.toFixed(6) ?? '')
                    setShowCoordEdit(false)
                  }}
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
