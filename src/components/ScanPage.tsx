'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { useVault } from '@/context/VaultContext'
import {
  analyzeBusinessCardFront,
  analyzeBusinessCardBack,
  type BusinessCardOcrResult,
} from '@/lib/azure-ocr'
import { aesEncryptString, hkdfDerive, hmacIndex } from '@/lib/crypto'
import { buildSearchTokens } from '@/lib/normalize'
import { fetchCategories, createCategory, type Category } from '@/lib/categories'

type ScanStep = 'camera' | 'preview'
type CardSide = 'front' | 'back'

// ── 氏名フィールドの問題検出（クライアントサイドのみ） ────────────────────
const NAME_DEPT_SUFFIX_RE =
  /(?:部|課|係|室|グループ|チーム|部門|センター|事業部|本部|局)(?:長|次長|主任|担当|代理|補佐|マネージャー|リーダー|スタッフ)?/
const NAME_DEPT_START_RE =
  /^(?:第.{1,3})?(?:営業|開発|技術|総務|人事|経理|財務|広報|企画|管理|システム|品質|製造|購買|物流|法務|経営|事業|商品|マーケ|デザイン|サポート)/
const NAME_JP_RE =
  /^[\u4e00-\u9faf\u3040-\u309f\u30a0-\u30ff]{1,4}[\s\u3000]{0,2}[\u4e00-\u9faf\u3040-\u309f\u30a0-\u30ff]{1,4}$/

interface NameIssue {
  tooLong: boolean
  hasDept: boolean
  /** 分割候補: { deptPart, namePart } */
  split?: { deptPart: string; namePart: string }
}

function detectNameIssue(name: string): NameIssue | null {
  if (!name) return null
  const tooLong = name.length > 10
  const hasDeptSuffix = NAME_DEPT_SUFFIX_RE.test(name)
  const hasDeptStart  = NAME_DEPT_START_RE.test(name)
  const hasDept = hasDeptSuffix || hasDeptStart

  if (!tooLong && !hasDept) return null

  // スペース区切り分割を試みる
  const spaceIdx = name.search(/[\s\u3000]+/)
  if (spaceIdx > 0) {
    const left  = name.slice(0, spaceIdx).trim()
    const right = name.slice(spaceIdx).trim()
    const leftIsOrg  = NAME_DEPT_SUFFIX_RE.test(left)  || NAME_DEPT_START_RE.test(left)
    const rightIsOrg = NAME_DEPT_SUFFIX_RE.test(right) || NAME_DEPT_START_RE.test(right)
    const rightIsName = NAME_JP_RE.test(right)
    const leftIsName  = NAME_JP_RE.test(left)

    if (leftIsOrg && rightIsName) {
      return { tooLong, hasDept, split: { deptPart: left, namePart: right } }
    }
    if (leftIsName && rightIsOrg) {
      return { tooLong, hasDept, split: { deptPart: right, namePart: left } }
    }
  }

  // スペースなし境界検出
  const m = name.match(
    /^(.{1,10}(?:部|課|係|室|グループ|チーム|部門|センター|事業部|本部|局)(?:長|次長|主任|担当|代理|補佐|マネージャー|リーダー)?)([\u4e00-\u9faf\u3040-\u309f\u30a0-\u30ff]{2,8})$/
  )
  if (m) {
    return { tooLong, hasDept, split: { deptPart: m[1], namePart: m[2] } }
  }

  return { tooLong, hasDept }
}

interface EditFields {
  name: string
  company: string
  title: string
  email: string
  tel: string
  address: string
  memo: string
}

const FORM_FIELDS: Array<{ key: keyof Omit<EditFields, 'memo'>; label: string; type: string }> = [
  { key: 'name', label: '氏名', type: 'text' },
  { key: 'company', label: '会社名', type: 'text' },
  { key: 'title', label: '役職', type: 'text' },
  { key: 'email', label: 'メール', type: 'email' },
  { key: 'tel', label: '電話', type: 'tel' },
  { key: 'address', label: '住所', type: 'text' },
]

const GRADIENT_CLASSES = [
  'from-blue-500 to-cyan-400',
  'from-emerald-500 to-teal-400',
  'from-purple-500 to-pink-400',
]

function StepIndicator({ frontDone, backDone, currentSide }: { frontDone: boolean; backDone: boolean; currentSide: CardSide }) {
  return (
    <div className="flex items-center gap-2">
      {(['front', 'back'] as CardSide[]).map((s, i) => {
        const done = s === 'front' ? frontDone : backDone
        const active = s === currentSide
        const label = s === 'front' ? '表面' : '裏面'
        return (
          <div key={s} className="flex items-center gap-1">
            {i > 0 && <div className="w-4 h-px bg-white/30" />}
            <div className={`flex items-center gap-1 text-xs font-medium ${active ? 'text-white' : done ? 'text-white/70' : 'text-white/40'}`}>
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold
                ${done ? 'bg-gradient-to-r from-blue-500 to-cyan-400 text-white' :
                  active ? 'border-2 border-white text-white' :
                  'border border-white/30 text-white/40'}`}>
                {done ? '✓' : i + 1}
              </div>
              <span>{label}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function GradientSpinner() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="20" stroke="url(#spin-grad)" strokeWidth="4"
        strokeLinecap="round" strokeDasharray="90 36" />
      <defs>
        <linearGradient id="spin-grad" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3b82f6" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
    </svg>
  )
}

function ScanFABIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <line x1="7" y1="12" x2="17" y2="12" />
    </svg>
  )
}

export default function ScanPage() {
  const router = useRouter()
  const { dataKey, bundle } = useVault()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [step, setStep] = useState<ScanStep>('camera')
  const [side, setSide] = useState<CardSide>('front')
  const [isPortrait, setIsPortrait] = useState(true)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [scanLocation, setScanLocation] = useState<{ lat: number; lng: number; accuracy: number } | null>(null)

  const [frontImageBase64, setFrontImageBase64] = useState<string | null>(null)
  const [backImageBase64, setBackImageBase64] = useState<string | null>(null)
  const [ocrResult, setOcrResult] = useState<BusinessCardOcrResult | null>(null)
  const [backOcrResult, setBackOcrResult] = useState<{ rawText: string; confidence: number } | null>(null)

  const [editFields, setEditFields] = useState<EditFields>({
    name: '', company: '', title: '', email: '', tel: '', address: '', memo: '',
  })

  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('system-default')
  const [newCategoryName, setNewCategoryName] = useState<string | null>(null)
  const [newCategoryError, setNewCategoryError] = useState<string | null>(null)
  const [showBackPrompt, setShowBackPrompt] = useState(true)

  // ── Orientation ────────────────────────────────────────────────────────────

  useEffect(() => {
    const update = () => {
      setIsPortrait(window.innerHeight > window.innerWidth)
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])

  // ── Camera ─────────────────────────────────────────────────────────────────

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  const startCamera = useCallback(async () => {
    setCameraError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
      // 位置情報をカメラ起動と並行して取得（拒否されても続行）
      navigator.geolocation?.getCurrentPosition(
        (pos) =>
          setScanLocation({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          }),
        () => {},
        { timeout: 10000, enableHighAccuracy: false },
      )
    } catch {
      setCameraError('カメラへのアクセスが許可されていません。ブラウザの設定を確認してください。')
    }
  }, [])

  useEffect(() => {
    if (step === 'camera') {
      startCamera()
    } else {
      stopCamera()
    }
    return stopCamera
  }, [step, startCamera, stopCamera])

  // ── Categories ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!bundle) return
    fetchCategories(bundle.supabase.url, bundle.supabase.anon_key, bundle.encryption_salt)
      .then(setCategories)
      .catch(() =>
        setCategories([{ id: 'system-default', name: '未分類', color_index: 0, sort_order: 0 }]),
      )
  }, [bundle])

  // ── Capture & OCR ─────────────────────────────────────────────────────────

  const captureImage = useCallback((): string | null => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return null
    const videoW = video.videoWidth
    const videoH = video.videoHeight
    if (!videoW || !videoH) return null

    const screenW = window.innerWidth
    const screenH = window.innerHeight
    const portrait = screenH > screenW

    // object-cover のスケール係数（画面を覆うために必要な拡大率）
    const scale = Math.max(screenW / videoW, screenH / videoH)

    // 画面の端でクリップされているビデオの開始位置（ビデオピクセル座標）
    const visX = Math.max(0, (videoW - screenW / scale) / 2)
    const visY = Math.max(0, (videoH - screenH / scale) / 2)

    // フレームオーバーレイの寸法（スクリーンピクセル）
    let frameW_screen: number, frameH_screen: number
    if (portrait) {
      frameH_screen = screenH * 0.75
      frameW_screen = frameH_screen * (9 / 16)
    } else {
      frameW_screen = screenW * 0.88
      frameH_screen = frameW_screen * (9 / 16)
    }
    const frameX_screen = (screenW - frameW_screen) / 2
    const frameY_screen = (screenH - frameH_screen) / 2

    // フレームをビデオピクセル座標へ変換してクロップ
    const cropX = visX + frameX_screen / scale
    const cropY = visY + frameY_screen / scale
    const cropW = frameW_screen / scale
    const cropH = frameH_screen / scale

    canvas.width  = Math.round(cropW)
    canvas.height = Math.round(cropH)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height)

    return canvas.toDataURL('image/jpeg', 0.92)
  }, [])

  const handleCapture = useCallback(async () => {
    if (!bundle) return
    const imageBase64 = captureImage()
    if (!imageBase64) return

    setIsAnalyzing(true)
    setCameraError(null)

    // カメラストリームを先に停止してからネットワークリクエストを送る。
    // カメラ稼働中の大容量送信はモバイルブラウザで ERR_INTERNET_DISCONNECTED を引き起こす。
    stopCamera()

    try {
      if (side === 'front') {
        setFrontImageBase64(imageBase64)
        const result = await analyzeBusinessCardFront(
          imageBase64,
          bundle.azure.endpoint,
          bundle.azure.key,
        )
        setOcrResult(result)
        setEditFields({
          name: result.name?.value ?? '',
          company: result.company?.value ?? '',
          title: result.title?.value ?? '',
          email: result.email?.value ?? '',
          tel: result.tel?.value ?? '',
          address: result.address?.value ?? '',
          memo: '',
        })
        setShowBackPrompt(true)
        setStep('preview')
      } else {
        setBackImageBase64(imageBase64)
        const result = await analyzeBusinessCardBack(
          imageBase64,
          bundle.azure.endpoint,
          bundle.azure.key,
        )
        setBackOcrResult(result)
        setStep('preview')
      }
    } catch (e) {
      // OCR 失敗時はカメラを再起動してリトライ可能にする
      setCameraError(e instanceof Error ? e.message : 'OCR 解析に失敗しました')
      startCamera()
    } finally {
      setIsAnalyzing(false)
    }
  }, [bundle, captureImage, side, stopCamera, startCamera])

  // ── Save ───────────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!dataKey || !bundle) return
    setIsSaving(true)
    setSaveError(null)
    try {
      // [1] Encrypt PII JSON（位置情報も E2EE 対象として含める）
      const piiJson = JSON.stringify({
        name: editFields.name,
        company: editFields.company,
        title: editFields.title,
        email: editFields.email,
        tel: editFields.tel,
        address: editFields.address,
        ...(scanLocation && {
          scanned_lat: scanLocation.lat,
          scanned_lng: scanLocation.lng,
          scanned_accuracy: scanLocation.accuracy,
        }),
      })
      const encrypted_data = await aesEncryptString(dataKey, piiJson)

      // [2] Encrypt thumbnails
      const encrypted_thumbnail_front = frontImageBase64
        ? await aesEncryptString(dataKey, frontImageBase64)
        : null
      const encrypted_thumbnail_back = backImageBase64
        ? await aesEncryptString(dataKey, backImageBase64)
        : null

      // [3] Blind indexing via HMAC-SHA256
      const hmacKeyBytes = await hkdfDerive(
        new TextEncoder().encode(bundle.encryption_salt),
        'blind-index-hmac',
        32,
      )
      const tokens = ocrResult ? buildSearchTokens(ocrResult) : []
      const search_hashes = await Promise.all(tokens.map((t) => hmacIndex(hmacKeyBytes, t)))

      // [4] Resolve category name (system-default → null = 未分類)
      const selectedCat = categories.find((c) => c.id === selectedCategoryId)
      const card_category =
        !selectedCat || selectedCat.id === 'system-default' ? null : selectedCat.name

      // [5] POST to API route (土管)
      const res = await fetch('/api/save-business-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          encrypted_data,
          encrypted_thumbnail_front,
          encrypted_thumbnail_back,
          search_hashes,
          industry_category: null,
          card_category,
          notes: editFields.memo || backOcrResult?.rawText || null,
          ocr_raw_text: ocrResult?.rawText ?? null,
          ocr_confidence: ocrResult?.confidence ?? 0,
          scanned_at: new Date().toISOString(),
          encryption_salt: bundle.encryption_salt,
          supabaseUrl: bundle.supabase.url,
          supabaseAnonKey: bundle.supabase.anon_key,
        }),
      })

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error ?? '保存に失敗しました')
      }

      router.push('/cards')
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setIsSaving(false)
    }
  }, [
    dataKey, bundle, editFields, frontImageBase64, backImageBase64,
    ocrResult, backOcrResult, categories, selectedCategoryId, router, scanLocation,
  ])

  // ── Add category inline ────────────────────────────────────────────────────

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
      setSelectedCategoryId(cat.id)
      setNewCategoryName(null)
    } catch (e) {
      setNewCategoryError(e instanceof Error ? e.message : 'カテゴリ作成に失敗しました')
    }
  }, [bundle, newCategoryName, categories])

  // ── Camera screen ──────────────────────────────────────────────────────────

  if (step === 'camera') {
    const frameClasses = isPortrait
      ? 'h-[75%] aspect-[9/16]'
      : 'w-[88%] aspect-[16/9]'

    return (
      <div
        className="fixed inset-0 z-50 bg-black select-none"
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Camera feed */}
        {!cameraError && (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            disablePictureInPicture
            className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            onContextMenu={(e) => e.preventDefault()}
            style={{ WebkitTouchCallout: 'none' } as React.CSSProperties}
          />
        )}

        {/* Camera error */}
        {cameraError && (
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <p className="text-sm text-red-400 text-center">{cameraError}</p>
          </div>
        )}

        {/* Card frame + scan line */}
        {!cameraError && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className={`${frameClasses} relative border-2 border-dashed border-white/60 rounded-xl overflow-hidden`}>
              <motion.div
                className="absolute left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-blue-400/80 to-transparent"
                animate={{ y: ['0%', '100%', '0%'] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
              />
            </div>
          </div>
        )}

        {/* Top bar */}
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 pt-12 pb-6
          bg-gradient-to-b from-black/70 to-transparent">
          <button
            onClick={() => router.back()}
            className="w-8 h-8 flex items-center justify-center text-white/80 text-xl"
            aria-label="閉じる"
          >
            ✕
          </button>
          <StepIndicator
            frontDone={!!frontImageBase64}
            backDone={!!backImageBase64}
            currentSide={side}
          />
          <div className="w-8" />
        </div>

        {/* Bottom bar */}
        <div
          className="absolute bottom-0 left-0 right-0 flex flex-col items-center gap-4 px-6 pt-6
            bg-gradient-to-t from-black/70 to-transparent"
          style={{ paddingBottom: 'max(3rem, calc(env(safe-area-inset-bottom) + 1.5rem))' }}
        >
          {cameraError ? (
            <button
              onClick={startCamera}
              className="w-full py-3 rounded-2xl bg-gradient-to-r from-blue-500 to-cyan-400 text-white font-semibold"
            >
              カメラを再起動
            </button>
          ) : (
            <>
              <motion.button
                whileTap={{ scale: 0.92 }}
                onClick={handleCapture}
                disabled={isAnalyzing || !bundle}
                className="w-20 h-20 rounded-full bg-white/10 border-4 border-white disabled:opacity-40
                  flex items-center justify-center"
                aria-label="撮影"
              >
                <div className="w-14 h-14 rounded-full bg-gradient-to-r from-blue-500 to-cyan-400" />
              </motion.button>
              <p className="text-white/60 text-xs text-center">
                {side === 'front' ? '名刺の表面をフレームに合わせて撮影してください' : '名刺の裏面をフレームに合わせて撮影してください'}
              </p>
            </>
          )}
        </div>

        {/* OCR analyzing overlay */}
        <AnimatePresence>
          {isAnalyzing && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-20 flex flex-col items-center justify-center
                bg-background/80 backdrop-blur-sm"
            >
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
              >
                <GradientSpinner />
              </motion.div>
              <p className="mt-4 text-sm text-foreground font-medium">名刺を解析しています</p>
              <p className="mt-1 text-xs text-muted-foreground">Azure AI で解析中...</p>
            </motion.div>
          )}
        </AnimatePresence>

        <canvas ref={canvasRef} className="hidden" />
      </div>
    )
  }

  // ── Preview / Edit / Save screen ───────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-full">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-xl border-b border-white/10
        flex items-center justify-between px-4 py-3">
        <button
          onClick={() => {
            setSide('front')
            setStep('camera')
          }}
          className="text-sm text-muted-foreground"
        >
          ‹ 戻る
        </button>
        <span className="text-sm font-semibold text-foreground">確認・保存</span>
        <div className="w-12" />
      </div>

      <div className="flex flex-col gap-4 px-4 py-4 pb-8">
        {/* Step indicator */}
        <div className="flex justify-center">
          <div className="flex items-center gap-3">
            {(['front', 'back'] as CardSide[]).map((s, i) => {
              const done = s === 'front' ? !!frontImageBase64 : !!backImageBase64
              const label = s === 'front' ? '表面' : '裏面'
              return (
                <div key={s} className="flex items-center gap-2">
                  {i > 0 && <div className="w-6 h-px bg-white/20" />}
                  <div className={`flex items-center gap-1 text-xs font-medium
                    ${done ? 'text-blue-400' : 'text-muted-foreground'}`}>
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold
                      ${done ? 'bg-gradient-to-r from-blue-500 to-cyan-400 text-white' :
                        'border border-white/30 text-muted-foreground'}`}>
                      {done ? '✓' : i + 1}
                    </div>
                    <span>{label}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Thumbnails */}
        <div className="flex gap-3">
          {frontImageBase64 && (
            <div className="flex-1 flex flex-col gap-1">
              <p className="text-xs text-muted-foreground">表面</p>
              <div className="relative rounded-xl overflow-hidden aspect-video bg-card border border-white/10">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={frontImageBase64} alt="名刺表面" className="w-full h-full object-cover" />
                <button
                  onClick={() => {
                    setFrontImageBase64(null)
                    setOcrResult(null)
                    setSide('front')
                    setStep('camera')
                  }}
                  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60
                    flex items-center justify-center text-white/80 text-xs"
                  aria-label="表面を撮り直す"
                >
                  ↺
                </button>
              </div>
            </div>
          )}
          {backImageBase64 && (
            <div className="flex-1 flex flex-col gap-1">
              <p className="text-xs text-muted-foreground">裏面</p>
              <div className="relative rounded-xl overflow-hidden aspect-video bg-card border border-white/10">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={backImageBase64} alt="名刺裏面" className="w-full h-full object-cover" />
                <button
                  onClick={() => {
                    setBackImageBase64(null)
                    setBackOcrResult(null)
                    setSide('back')
                    setStep('camera')
                  }}
                  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60
                    flex items-center justify-center text-white/80 text-xs"
                  aria-label="裏面を撮り直す"
                >
                  ↺
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Scan back prompt */}
        {!backImageBase64 && showBackPrompt && (
          <div className="rounded-2xl bg-card border border-white/10 p-4 flex flex-col gap-3">
            <p className="text-sm font-medium text-foreground">裏面もスキャンしますか？</p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setSide('back')
                  setStep('camera')
                }}
                className="flex-1 py-2 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-400
                  text-white text-sm font-medium"
              >
                裏面もスキャンする
              </button>
              <button
                onClick={() => setShowBackPrompt(false)}
                className="flex-1 py-2 rounded-xl bg-secondary border border-white/10
                  text-foreground text-sm"
              >
                スキップして保存へ
              </button>
            </div>
          </div>
        )}

        {/* Editable form */}
        <div className="rounded-2xl bg-card border border-white/10 p-4 flex flex-col gap-4">
          {FORM_FIELDS.map(({ key, label, type }) => {
            const nameIssue = key === 'name' ? detectNameIssue(editFields.name) : null
            return (
              <div key={key}>
                <label className="text-xs text-muted-foreground">{label}</label>
                <input
                  type={type}
                  value={editFields[key]}
                  onChange={(e) => setEditFields((prev) => ({ ...prev, [key]: e.target.value }))}
                  className={`mt-1 w-full rounded-xl bg-background border px-3 py-2
                    text-sm text-foreground placeholder:text-muted-foreground
                    focus:outline-none focus:ring-1 focus:ring-blue-500
                    ${nameIssue ? 'border-amber-500/60' : 'border-white/10'}`}
                  placeholder={label}
                />
                {/* ── 氏名フィールド警告バナー ── */}
                {nameIssue && (
                  <div className="mt-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2 flex flex-col gap-1.5">
                    <p className="text-xs text-amber-400 leading-snug">
                      {nameIssue.hasDept
                        ? '所属名が氏名欄に混入している可能性があります'
                        : '氏名が長すぎます。確認してください'}
                    </p>
                    {nameIssue.split && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-muted-foreground">分割候補:</span>
                        <button
                          type="button"
                          onClick={() =>
                            setEditFields((prev) => ({
                              ...prev,
                              name:  nameIssue.split!.namePart,
                              title: prev.title
                                ? prev.title
                                : nameIssue.split!.deptPart,
                            }))
                          }
                          className="text-xs px-2 py-0.5 rounded-lg bg-amber-500/20 border border-amber-500/40
                            text-amber-300 font-medium"
                        >
                          氏名 →「{nameIssue.split.namePart}」/ 役職 →「{nameIssue.split.deptPart}」
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          <div>
            <label className="text-xs text-muted-foreground">メモ</label>
            <textarea
              value={editFields.memo}
              onChange={(e) => setEditFields((prev) => ({ ...prev, memo: e.target.value }))}
              rows={3}
              className="mt-1 w-full rounded-xl bg-background border border-white/10 px-3 py-2
                text-sm text-foreground placeholder:text-muted-foreground
                focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
              placeholder="展示会で名刺交換、フォローアップ予定..."
            />
          </div>
        </div>

        {/* Back OCR raw text (auto-filled into memo area if user hasn't typed) */}
        {backOcrResult?.rawText && !editFields.memo && (
          <div className="rounded-2xl bg-card border border-white/10 p-4">
            <p className="text-xs text-muted-foreground mb-1">裏面テキスト（OCR 読み取り）</p>
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
              {backOcrResult.rawText}
            </p>
          </div>
        )}

        {/* Category chips */}
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">カテゴリ</p>
          <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {categories.map((cat) => {
              const isSelected = cat.id === selectedCategoryId
              const gradClass = GRADIENT_CLASSES[cat.color_index % 3]
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategoryId(cat.id)}
                  className={`flex-none px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap
                    transition-all ${isSelected
                      ? `bg-gradient-to-r ${gradClass} text-white`
                      : 'bg-card border border-white/20 text-muted-foreground'
                    }`}
                >
                  {cat.name}
                </button>
              )
            })}

            {newCategoryName === null ? (
              <button
                onClick={() => setNewCategoryName('')}
                className="flex-none px-3 py-1.5 rounded-full text-xs font-medium border border-dashed
                  border-white/30 text-muted-foreground whitespace-nowrap"
              >
                + 新規
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
                <button onClick={handleAddCategory} className="text-xs text-blue-400 font-medium">
                  追加
                </button>
                <button
                  onClick={() => { setNewCategoryName(null); setNewCategoryError(null) }}
                  className="text-xs text-muted-foreground"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
          {newCategoryError && (
            <p className="text-xs text-red-400">{newCategoryError}</p>
          )}
        </div>

        {/* Save error */}
        {saveError && (
          <p className="text-sm text-red-400">{saveError}</p>
        )}

        {/* Save button */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={handleSave}
          disabled={isSaving || !dataKey || !bundle}
          className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-blue-500 to-cyan-400
            text-white font-semibold disabled:opacity-40"
        >
          {isSaving ? '保存中...' : '保存する'}
        </motion.button>

        {/* Retake front */}
        <button
          onClick={() => {
            setSide('front')
            setStep('camera')
          }}
          className="w-full py-2 text-sm text-muted-foreground"
        >
          表面を撮り直す
        </button>
      </div>

      {/* Scan FAB icon for reference */}
      <div className="hidden">
        <ScanFABIcon />
      </div>
    </div>
  )
}
