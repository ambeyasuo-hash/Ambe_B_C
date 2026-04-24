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

// ── Raw-text fallback parser (日本語名刺向け) ─────────────────────────────
// prebuilt-businessCard が構造化フィールドを返さなかった場合（日本語名刺など）に
// rawText から正規表現でフィールドを推定する。

const COMPANY_KEYWORDS = [
  '株式会社', '有限会社', '合同会社', '一般社団法人', '公益財団法人',
  '公益社団法人', '学校法人', '医療法人', '社会福祉法人', '宗教法人',
  'Corporation', 'Corp.', 'Inc.', 'Ltd.', 'LLC', 'LLP', 'Co.,', 'Co.,Ltd',
]

const TITLE_KEYWORDS = [
  '代表取締役', '取締役', '社長', '副社長', '専務', '常務', '会長', '副会長',
  '部長', '副部長', '次長', '課長', '係長', '主任', '担当', '顧問', '相談役',
  'Director', 'Manager', 'President', 'Vice President', 'Executive',
  'CEO', 'CTO', 'COO', 'CFO', 'CMO', 'CXO',
  'Engineer', 'Designer', 'Consultant', 'Analyst', 'Architect',
  '教授', '准教授', '講師', '助教', '研究員',
  '営業', '開発', '技術', '経営', '企画', '人事', '総務', '財務', '広報',
]

const PREFECTURES = [
  '北海道', '青森', '岩手', '宮城', '秋田', '山形', '福島',
  '茨城', '栃木', '群馬', '埼玉', '千葉', '東京', '神奈川',
  '新潟', '富山', '石川', '福井', '山梨', '長野',
  '岐阜', '静岡', '愛知', '三重', '滋賀', '京都', '大阪', '兵庫', '奈良', '和歌山',
  '鳥取', '島根', '岡山', '広島', '山口',
  '徳島', '香川', '愛媛', '高知',
  '福岡', '佐賀', '長崎', '熊本', '大分', '宮崎', '鹿児島', '沖縄',
]

function parseRawTextFallback(rawText: string): Partial<BusinessCardOcrResult> {
  const lines = rawText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  const used = new Set<number>()
  const result: Partial<BusinessCardOcrResult> = {}

  // ── Email ────────────────────────────────────────────────────────────────
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/[\w.+\-]+@[\w\-]+\.[\w.]+/)
    if (m) {
      result.email = { value: m[0], confidence: 0.95 }
      used.add(i)
      break
    }
  }

  // ── Phone (TEL/FAX ラベル優先 → 数字パターン) ─────────────────────────
  const telLabelRe = /(?:Tel|TEL|電話|携帯|Mobile|HP)[.：:.\s]*([0-9（）()\-\s+]{8,20})/i
  const telBareRe = /(?:^|[\s：:])([0-9]{2,4}[-\s][0-9]{2,4}[-\s][0-9]{3,4})(?:$|[\s])/
  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue
    let m = lines[i].match(telLabelRe) ?? lines[i].match(telBareRe)
    if (m) {
      result.tel = { value: (m[1] ?? m[0]).trim(), confidence: 0.9 }
      used.add(i)
      break
    }
  }

  // ── Address (郵便番号 or 都道府県 or 住所キーワード) ───────────────────
  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue
    const l = lines[i]
    const isAddr =
      /〒?\d{3}-?\d{4}/.test(l) ||
      PREFECTURES.some((p) => l.includes(p)) ||
      /(?:市|区|町|村|丁目|番地|号室|\d+F|\d+階)/.test(l)
    if (isAddr) {
      let addr = l
      // 次の行がビル名などの補足なら結合する
      if (i + 1 < lines.length && !used.has(i + 1)) {
        const next = lines[i + 1]
        if (/(?:ビル|タワー|センター|フロア|号室|\d+F|\d+階)/.test(next)) {
          addr += ' ' + next
          used.add(i + 1)
        }
      }
      result.address = { value: addr, confidence: 0.82 }
      used.add(i)
      break
    }
  }

  // ── Company (法人形態キーワード) ──────────────────────────────────────
  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue
    if (COMPANY_KEYWORDS.some((k) => lines[i].includes(k))) {
      result.company = { value: lines[i], confidence: 0.88 }
      used.add(i)
      break
    }
  }

  // ── Title (役職キーワード) ────────────────────────────────────────────
  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue
    if (TITLE_KEYWORDS.some((k) => lines[i].includes(k))) {
      result.title = { value: lines[i], confidence: 0.78 }
      used.add(i)
      break
    }
  }

  // ── Name (残った短い行 = 人名候補) ───────────────────────────────────
  const remaining = lines.filter((l, i) => {
    if (used.has(i)) return false
    if (l.length > 25) return false            // 長すぎる → 名前ではない
    if (/https?:\/\/|www\./.test(l)) return false // URL
    if (/@/.test(l)) return false               // email
    if (/\d{4,}/.test(l)) return false         // 長い数字列 (電話/郵便番号)
    if (COMPANY_KEYWORDS.some((k) => l.includes(k))) return false
    if (TITLE_KEYWORDS.some((k) => l.includes(k))) return false
    return true
  })
  if (remaining.length > 0) {
    // 最も短い行 (名前は会社名より短いことが多い) を採用
    const nameLine = remaining.reduce((a, b) => (a.length <= b.length ? a : b))
    result.name = { value: nameLine, confidence: 0.6 }
  }

  return result
}

// ── Client-side polling (submit → poll loop) ──────────────────────────────

const POLL_INTERVAL_MS = 2000
const POLL_MAX_ATTEMPTS = 30 // 最大 60 秒待機

async function submitOcr(
  imageBase64: string,
  model: 'prebuilt-businessCard' | 'prebuilt-layout' | 'prebuilt-read',
  azureEndpoint: string,
  azureKey: string,
): Promise<{ operationUrl: string; azureKey: string }> {
  const res = await fetch('/api/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: imageBase64, model, azureEndpoint, azureKey }),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(err.error ?? 'OCR の送信に失敗しました')
  }
  return res.json() as Promise<{ operationUrl: string; azureKey: string }>
}

async function pollUntilDone(
  operationUrl: string,
  azureKey: string,
): Promise<Record<string, unknown>> {
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    const res = await fetch('/api/ocr/poll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operationUrl, azureKey }),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(err.error ?? 'OCR 状態の取得に失敗しました')
    }
    const result = (await res.json()) as Record<string, unknown>
    if (result.status === 'succeeded') return result
    if (result.status === 'failed') throw new Error('Azure OCR 解析が失敗しました')
    // status === 'running' の場合はループを続ける
  }
  throw new Error('OCR タイムアウト: 解析に時間がかかりすぎています')
}

// ── Public API ────────────────────────────────────────────────────────────

export async function analyzeBusinessCardFront(
  imageBase64: string,
  azureEndpoint: string,
  azureKey: string,
): Promise<BusinessCardOcrResult> {
  const { operationUrl, azureKey: key } = await submitOcr(
    imageBase64, 'prebuilt-businessCard', azureEndpoint, azureKey,
  )
  const data = await pollUntilDone(operationUrl, key)
  const analyzeResult = (data.analyzeResult ?? data) as Record<string, unknown>
  const docs = analyzeResult.documents as Array<Record<string, unknown>> | undefined
  const fields = docs?.[0]?.fields as Record<string, unknown> | undefined

  const rawText = extractRawText(analyzeResult)
  const structured = {
    name:    extractField(fields, 'ContactNames', 'Name', 'FirstName'),
    company: extractField(fields, 'CompanyNames', 'Organizations', 'Company', 'CompanyName'),
    title:   extractField(fields, 'JobTitles', 'Title', 'JobTitle'),
    email:   extractField(fields, 'Emails', 'Email', 'EmailAddress'),
    tel:     extractField(fields, 'PhoneNumbers', 'Phone', 'Tel', 'MobilePhone'),
    address: extractField(fields, 'Addresses', 'Address'),
  }

  // prebuilt-businessCard が構造化フィールドを返さなかった場合（日本語名刺等）に
  // rawText から正規表現でフォールバック抽出する
  const hasAnyField = Object.values(structured).some(Boolean)
  const fallback = (!hasAnyField && rawText) ? parseRawTextFallback(rawText) : {}

  return {
    ...structured,
    ...fallback,
    rawText,
    confidence: calcAvgConfidence(analyzeResult),
  }
}

export async function analyzeBusinessCardBack(
  imageBase64: string,
  azureEndpoint: string,
  azureKey: string,
): Promise<{ rawText: string; confidence: number }> {
  const { operationUrl, azureKey: key } = await submitOcr(
    imageBase64, 'prebuilt-read', azureEndpoint, azureKey,
  )
  const data = await pollUntilDone(operationUrl, key)
  const analyzeResult = (data.analyzeResult ?? data) as Record<string, unknown>
  return {
    rawText: extractRawText(analyzeResult),
    confidence: calcAvgConfidence(analyzeResult),
  }
}
