'use client'

export interface OcrField {
  value: string
  confidence: number
}

export interface BusinessCardOcrResult {
  name?: OcrField
  company?: OcrField
  title?: OcrField
  email?: OcrField
  tel?: OcrField
  address?: OcrField
  rawText: string
  confidence: number
}

function extractField(
  fields: Record<string, unknown> | undefined,
  ...keys: string[]
): OcrField | undefined {
  if (!fields) return undefined
  for (const key of keys) {
    const f = fields[key] as Record<string, unknown> | undefined
    if (!f) continue
    // Single value field
    if (typeof f.content === 'string' && f.content) {
      return { value: f.content, confidence: (f.confidence as number) ?? 0 }
    }
    // Array field (e.g. ContactNames, PhoneNumbers)
    const values = f.values as Array<Record<string, unknown>> | undefined
    if (values?.[0]?.content) {
      const first = values[0]
      const content = first.content as string
      // Array items may themselves have valueObject with sub-fields
      const obj = first.valueObject as Record<string, unknown> | undefined
      if (obj) {
        const parts = Object.values(obj)
          .map((v) => (v as Record<string, unknown>)?.content as string)
          .filter(Boolean)
        if (parts.length) {
          return { value: parts.join(' '), confidence: (first.confidence as number) ?? 0 }
        }
      }
      return { value: content, confidence: (first.confidence as number) ?? 0 }
    }
  }
  return undefined
}

function calcAvgConfidence(analyzeResult: Record<string, unknown>): number {
  const pages = analyzeResult.pages as Array<Record<string, unknown>> | undefined
  if (!pages?.length) return 0
  const words = pages.flatMap((p) => (p.words as Array<Record<string, unknown>>) ?? [])
  if (!words.length) return 0
  return words.reduce((sum, w) => sum + ((w.confidence as number) ?? 0), 0) / words.length
}

function extractRawText(analyzeResult: Record<string, unknown>): string {
  if (typeof analyzeResult.content === 'string') return analyzeResult.content
  const pages = analyzeResult.pages as Array<Record<string, unknown>> | undefined
  return (
    pages
      ?.map((p) =>
        ((p.lines as Array<Record<string, unknown>>) ?? [])
          .map((l) => l.content as string)
          .join('\n'),
      )
      .join('\n') ?? ''
  )
}

export async function analyzeBusinessCardFront(
  imageBase64: string,
  azureEndpoint: string,
  azureKey: string,
): Promise<BusinessCardOcrResult> {
  const res = await fetch('/api/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: imageBase64, model: 'prebuilt-layout', azureEndpoint, azureKey }),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(err.error ?? 'OCR 解析に失敗しました（表面）')
  }
  const data = (await res.json()) as Record<string, unknown>
  const analyzeResult = (data.analyzeResult ?? data) as Record<string, unknown>
  const docs = analyzeResult.documents as Array<Record<string, unknown>> | undefined
  const fields = docs?.[0]?.fields as Record<string, unknown> | undefined

  return {
    name: extractField(fields, 'ContactNames', 'Name', 'FirstName'),
    company: extractField(fields, 'Organizations', 'Company', 'CompanyName'),
    title: extractField(fields, 'JobTitles', 'Title', 'JobTitle'),
    email: extractField(fields, 'Emails', 'Email', 'EmailAddress'),
    tel: extractField(fields, 'PhoneNumbers', 'Phone', 'Tel', 'MobilePhone'),
    address: extractField(fields, 'Addresses', 'Address'),
    rawText: extractRawText(analyzeResult),
    confidence: calcAvgConfidence(analyzeResult),
  }
}

export async function analyzeBusinessCardBack(
  imageBase64: string,
  azureEndpoint: string,
  azureKey: string,
): Promise<{ rawText: string; confidence: number }> {
  const res = await fetch('/api/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: imageBase64, model: 'prebuilt-read', azureEndpoint, azureKey }),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(err.error ?? 'OCR 解析に失敗しました（裏面）')
  }
  const data = (await res.json()) as Record<string, unknown>
  const analyzeResult = (data.analyzeResult ?? data) as Record<string, unknown>
  return {
    rawText: extractRawText(analyzeResult),
    confidence: calcAvgConfidence(analyzeResult),
  }
}
