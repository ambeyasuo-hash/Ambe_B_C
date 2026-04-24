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

// 日本人名の正規表現（姓 + 任意のスペース + 名）
// 漢字・ひらがな・カタカナのみで構成される 2〜8 文字
const JP_NAME_RE = /^[\u4e00-\u9faf\u3040-\u309f\u30a0-\u30ff]{1,4}[\s\u3000]{0,2}[\u4e00-\u9faf\u3040-\u309f\u30a0-\u30ff]{1,4}$/
// アルファベット名（First Last 形式）
const EN_NAME_RE = /^[A-Z][a-z]+([\s][A-Z][a-z]+){1,3}$/

function parseRawTextFallback(rawText: string): Partial<BusinessCardOcrResult> {
  const lines = rawText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  const used = new Set<number>()
  const result: Partial<BusinessCardOcrResult> = {}

  // ── Email ────────────────────────────────────────────────────────────────
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/[\w.+\-]+@[\w.\-]+\.[a-zA-Z]{2,}/)
    if (m) {
      result.email = { value: m[0], confidence: 0.95 }
      used.add(i)
      break
    }
  }

  // ── URL（使用済みマークのみ、フィールドには含めない） ─────────────────
  for (let i = 0; i < lines.length; i++) {
    if (/https?:\/\/|www\./i.test(lines[i])) used.add(i)
  }

  // ── Phone (TEL/FAX ラベル優先 → 裸の数字パターン) ────────────────────
  // ラベル付きを優先 (Tel:, TEL, 電話, 携帯, Mobile, HP, FAX)
  const telLabelRe = /(?:Tel|TEL|Fax|FAX|電話|携帯|Mobile|HP)[.：:.\s]*([0-9０-９（）()\-\s+]{7,20})/i
  // 裸のパターン: 市外局番-市内局番-加入者番号 (固定・携帯・フリーダイヤル)
  const telBareRe = /(?:^|[\s　])(\+?(?:81[-\s]?)?(?:0\d{1,4}[-\s]\d{2,4}[-\s]\d{3,4}|0\d{9,10}))(?:$|[\s　,，])/
  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue
    const ml = lines[i].match(telLabelRe)
    if (ml) {
      result.tel = { value: ml[1].trim(), confidence: 0.92 }
      used.add(i)
      break
    }
    const mb = lines[i].match(telBareRe)
    if (mb) {
      result.tel = { value: mb[1].trim(), confidence: 0.85 }
      used.add(i)
      break
    }
  }

  // ── Company (法人形態キーワード) ──────────────────────────────────────
  // ★ Address より先に検出して「社名が住所に誤認定」を防ぐ
  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue
    if (COMPANY_KEYWORDS.some((k) => lines[i].includes(k))) {
      result.company = { value: lines[i], confidence: 0.9 }
      used.add(i)
      break
    }
  }

  // ── Address (郵便番号アンカー → 都道府県 → 住所キーワード) ────────────
  // 〒XXX-XXXX がある行を最優先アンカーとし、以降の連続行を結合する
  let addrStart = -1
  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue
    if (/〒\s?\d{3}[-ー]\d{4}/.test(lines[i])) { addrStart = i; break }
  }
  if (addrStart === -1) {
    for (let i = 0; i < lines.length; i++) {
      if (used.has(i)) continue
      const l = lines[i]
      if (
        PREFECTURES.some((p) => l.includes(p)) ||
        /(?:市|区|町|村|丁目|番地|番|号室|\d+F|\d+階)/.test(l)
      ) { addrStart = i; break }
    }
  }
  if (addrStart !== -1) {
    let addr = lines[addrStart]
    used.add(addrStart)
    // 直後の行がビル名・フロア等の補足なら結合 (最大 2 行)
    for (let j = addrStart + 1; j <= addrStart + 2 && j < lines.length; j++) {
      if (used.has(j)) break
      const next = lines[j]
      if (/(?:ビル|タワー|センター|プラザ|フロア|号室|\d+F|\d+階|building|Building)/.test(next)) {
        addr += ' ' + next
        used.add(j)
      } else {
        break
      }
    }
    result.address = { value: addr, confidence: 0.85 }
  }

  // ── Title + Name の同行分割 ───────────────────────────────────────────
  // 例: "代表取締役社長 田中 太郎" → title="代表取締役社長", name="田中 太郎"
  if (!result.name || !result.title) {
    for (let i = 0; i < lines.length; i++) {
      if (used.has(i)) continue
      const l = lines[i]
      const matchedTitle = TITLE_KEYWORDS.find((k) => l.startsWith(k))
      if (matchedTitle) {
        const rest = l.slice(matchedTitle.length).trim()
        if (rest.length > 0 && (JP_NAME_RE.test(rest) || EN_NAME_RE.test(rest))) {
          // 役職と名前が同じ行に入っている → 分割する
          if (!result.title) result.title = { value: matchedTitle, confidence: 0.82 }
          if (!result.name)  result.name  = { value: rest, confidence: 0.75 }
          used.add(i)
          break
        } else if (!result.title) {
          // 後ろに名前候補がなければ役職のみとして記録
          result.title = { value: l, confidence: 0.8 }
          used.add(i)
          break
        }
      }
    }
  }

  // ── Title (単独行) ────────────────────────────────────────────────────
  if (!result.title) {
    for (let i = 0; i < lines.length; i++) {
      if (used.has(i)) continue
      if (TITLE_KEYWORDS.some((k) => lines[i].includes(k))) {
        result.title = { value: lines[i], confidence: 0.78 }
        used.add(i)
        break
      }
    }
  }

  // ── Name (未使用行から人名パターンで優先検出) ──────────────────────
  if (!result.name) {
    // まず日本人名・英語人名のパターンに合致する行を探す
    for (let i = 0; i < lines.length; i++) {
      if (used.has(i)) continue
      const l = lines[i]
      if (JP_NAME_RE.test(l) || EN_NAME_RE.test(l)) {
        result.name = { value: l, confidence: 0.82 }
        used.add(i)
        break
      }
    }
  }
  if (!result.name) {
    // パターン不一致の場合は「短くて連絡先でも会社名でもない行」から推定
    const remaining = lines.filter((l, i) => {
      if (used.has(i)) return false
      if (l.length > 20) return false
      if (/@/.test(l)) return false
      if (/\d{4,}/.test(l)) return false
      if (COMPANY_KEYWORDS.some((k) => l.includes(k))) return false
      if (TITLE_KEYWORDS.some((k) => l.includes(k))) return false
      return true
    })
    if (remaining.length > 0) {
      const nameLine = remaining.reduce((a, b) => (a.length <= b.length ? a : b))
      result.name = { value: nameLine, confidence: 0.55 }
    }
  }

  // ── Company フォールバック (キーワードなしの場合) ─────────────────────
  // 会社名キーワードが一切ない名刺向けに、未使用の長めの行を会社名候補とする
  if (!result.company) {
    const candidates = lines.filter((l, i) => {
      if (used.has(i)) return false
      if (l.length < 4) return false
      if (/@/.test(l)) return false
      if (/\d{4,}/.test(l)) return false
      if (/https?:\/\/|www\./i.test(l)) return false
      if (TITLE_KEYWORDS.some((k) => l.includes(k))) return false
      return true
    })
    if (candidates.length > 0) {
      // 最も長い行を会社名候補とする
      const compLine = candidates.reduce((a, b) => (a.length >= b.length ? a : b))
      result.company = { value: compLine, confidence: 0.45 }
    }
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
