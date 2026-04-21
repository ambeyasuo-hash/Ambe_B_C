'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { useVault } from '@/context/VaultContext'
import {
  analyzeBusinessCardFront,
  analyzeBusinessCardBack,
  type BusinessCardOcrResult,
} from '@/lib/azure-ocr'
import { aesEncryptString, hkdfDerive, hmacIndex } from '@/lib/crypto'
import { buildSearchTokens } from '@/lib/normalize'

type ScanStep = 'camera' | 'preview' | 'edit'
type CardSide = 'front' | 'back'

interface EditFields {
  name: string
  company: string
  title: string
  email: string
  tel: string
  address: string
}

const FIELD_LABELS: Record<keyof EditFields, string> = {
  name: '氏名',
  company: '会社名',
  title: '役職',
  email: 'メール',
  tel: '電話',
  address: '住所',
}

function ScanIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [frontImageBase64, setFrontImageBase64] = useState<string | null>(null)
  const [ocrResult, setOcrResult] = useState<BusinessCardOcrResult | null>(null)
  const [backResult, setBackResult] = useState<{ rawText: string; confidence: number } | null>(null)
  const [editFields, setEditFields] = useState<EditFields>({
    name: '',
    company: '',
    title: '',
    email: '',
    tel: '',
    address: '',
  })

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
    return () => stopCamera()
  }, [step, startCamera, stopCamera])

  const captureImage = useCallback((): string | null => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return null
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0)
    return canvas.toDataURL('image/jpeg', 0.85)
  }, [])

  const handleCapture = useCallback(async () => {
    if (!bundle) return
    const imageBase64 = captureImage()
    if (!imageBase64) return

    setIsAnalyzing(true)
    setCameraError(null)
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
        })
        setStep('preview')
      } else {
        const result = await analyzeBusinessCardBack(
          imageBase64,
          bundle.azure.endpoint,
          bundle.azure.key,
        )
        setBackResult(result)
        setStep('preview')
      }
    } catch (e) {
      setCameraError(e instanceof Error ? e.message : 'OCR 解析に失敗しました')
    } finally {
      setIsAnalyzing(false)
    }
  }, [bundle, captureImage, side])

  const handleSave = useCallback(async () => {
    if (!dataKey || !bundle) return
    setIsSaving(true)
    setSaveError(null)
    try {
      const piiJson = JSON.stringify({
        name: editFields.name,
        company: editFields.company,
        title: editFields.title,
        email: editFields.email,
        tel: editFields.tel,
        address: editFields.address,
      })
      const encrypted_data = await aesEncryptString(dataKey, piiJson)

      const encrypted_thumbnail_front = frontImageBase64
        ? await aesEncryptString(dataKey, frontImageBase64)
        : null

      const hmacKeyBytes = await hkdfDerive(
        new TextEncoder().encode(bundle.encryption_salt),
        'blind-index-hmac',
        32,
      )
      const tokens = ocrResult ? buildSearchTokens(ocrResult) : []
      const search_hashes = await Promise.all(tokens.map((t) => hmacIndex(hmacKeyBytes, t)))

      const res = await fetch('/api/save-business-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          encrypted_data,
          encrypted_thumbnail_front,
          encrypted_thumbnail_back: null,
          search_hashes,
          industry_category: null,
          notes: backResult?.rawText ?? null,
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
  }, [dataKey, bundle, editFields, frontImageBase64, ocrResult, backResult, router])

  // ── Camera step ────────────────────────────────────────────────────────────
  if (step === 'camera') {
    return (
      <div className="flex flex-col gap-4 px-4 py-6">
        <h1 className="text-lg font-semibold text-foreground">名刺スキャン</h1>

        {/* Video area */}
        <div className="relative w-full rounded-2xl overflow-hidden bg-black aspect-video">
          {!cameraError ? (
            <>
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover"
              />
              {/* Business-card frame overlay (85.6×54mm ≈ 1.586:1) */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-[88%] aspect-[1.586/1] border-2 border-dashed border-white/60 rounded-lg" />
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center w-full h-full p-4">
              <p className="text-sm text-red-400 text-center">{cameraError}</p>
            </div>
          )}

          {/* Analyzing overlay */}
          {isAnalyzing && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm rounded-2xl z-10">
              <motion.div
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
              >
                <div className="w-16 h-16 rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 flex items-center justify-center">
                  <ScanIcon />
                </div>
              </motion.div>
              <p className="mt-4 text-sm text-muted-foreground">Azure AI で解析中...</p>
            </div>
          )}
        </div>

        {/* Side toggle */}
        <div className="flex gap-2">
          <button
            onClick={() => setSide('front')}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${
              side === 'front'
                ? 'bg-gradient-to-r from-blue-500 to-cyan-400 text-white'
                : 'bg-secondary border border-white/10 text-foreground'
            }`}
          >
            表面
          </button>
          <button
            onClick={() => setSide('back')}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${
              side === 'back'
                ? 'bg-gradient-to-r from-blue-500 to-cyan-400 text-white'
                : 'bg-secondary border border-white/10 text-foreground'
            }`}
          >
            裏面
          </button>
        </div>

        {/* Capture button */}
        <button
          onClick={handleCapture}
          disabled={isAnalyzing || !bundle || !!cameraError}
          className="w-full py-3 rounded-2xl bg-gradient-to-r from-blue-500 to-cyan-400 text-white font-semibold disabled:opacity-40 transition-opacity"
        >
          {isAnalyzing ? '解析中...' : '撮影'}
        </button>

        {/* Hidden canvas for capture */}
        <canvas ref={canvasRef} className="hidden" />
      </div>
    )
  }

  // ── Preview step ───────────────────────────────────────────────────────────
  if (step === 'preview') {
    return (
      <div className="flex flex-col gap-4 px-4 py-6">
        <h1 className="text-lg font-semibold text-foreground">OCR 確認</h1>

        <div className="rounded-2xl bg-card border border-white/10 p-4 flex flex-col gap-3">
          {ocrResult ? (
            (Object.keys(FIELD_LABELS) as Array<keyof EditFields>).map((key) => (
              <div key={key}>
                <p className="text-xs text-muted-foreground">{FIELD_LABELS[key]}</p>
                <p className="text-sm text-foreground mt-0.5">
                  {(ocrResult[key] as { value: string } | undefined)?.value || (
                    <span className="text-muted-foreground italic">未検出</span>
                  )}
                </p>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">表面の OCR 結果がありません</p>
          )}

          {backResult?.rawText && (
            <div>
              <p className="text-xs text-muted-foreground">裏面テキスト</p>
              <p className="text-sm text-foreground mt-0.5 whitespace-pre-wrap">
                {backResult.rawText}
              </p>
            </div>
          )}
        </div>

        {saveError && (
          <p className="text-sm text-red-400">{saveError}</p>
        )}

        <button
          onClick={handleSave}
          disabled={isSaving}
          className="w-full py-3 rounded-2xl bg-gradient-to-r from-blue-500 to-cyan-400 text-white font-semibold disabled:opacity-40 transition-opacity"
        >
          {isSaving ? '保存中...' : 'この内容で保存'}
        </button>

        <button
          onClick={() => setStep('edit')}
          className="w-full py-3 rounded-2xl bg-secondary border border-white/10 text-foreground font-medium"
        >
          編集する
        </button>

        <button
          onClick={() => setStep('camera')}
          className="w-full py-2 text-sm text-muted-foreground"
        >
          撮り直す
        </button>
      </div>
    )
  }

  // ── Edit step ──────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 px-4 py-6">
      <h1 className="text-lg font-semibold text-foreground">名刺編集</h1>

      <div className="flex flex-col gap-3">
        {(Object.keys(FIELD_LABELS) as Array<keyof EditFields>).map((key) => (
          <div key={key}>
            <label className="text-xs text-muted-foreground">{FIELD_LABELS[key]}</label>
            <input
              type={key === 'email' ? 'email' : key === 'tel' ? 'tel' : 'text'}
              value={editFields[key]}
              onChange={(e) =>
                setEditFields((prev) => ({ ...prev, [key]: e.target.value }))
              }
              className="mt-1 w-full rounded-xl bg-card border border-white/10 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder={FIELD_LABELS[key]}
            />
          </div>
        ))}
      </div>

      {saveError && (
        <p className="text-sm text-red-400">{saveError}</p>
      )}

      <button
        onClick={handleSave}
        disabled={isSaving}
        className="w-full py-3 rounded-2xl bg-gradient-to-r from-blue-500 to-cyan-400 text-white font-semibold disabled:opacity-40 transition-opacity"
      >
        {isSaving ? '保存中...' : '保存'}
      </button>

      <button
        onClick={() => setStep('preview')}
        className="w-full py-3 rounded-2xl bg-secondary border border-white/10 text-foreground font-medium"
      >
        戻る
      </button>
    </div>
  )
}
