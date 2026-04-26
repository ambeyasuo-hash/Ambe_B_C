'use client'

import type { BusinessCardOcrResult } from './azure-ocr'

const COMPANY_QUALIFIERS = [
  '一般社団法人',
  '公益財団法人',
  '株式会社',
  '有限会社',
  '合同会社',
  '社団法人',
  '財団法人',
]

export function normalizeCompany(raw: string): string {
  let result = raw.trim()
  for (const q of COMPANY_QUALIFIERS) {
    result = result.replace(new RegExp(q, 'g'), '').trim()
  }
  return result
}

export function splitName(raw: string): { family: string; given: string } {
  const parts = raw.trim().split(/\s+/)
  if (parts.length >= 2) {
    return { family: parts[0], given: parts.slice(1).join(' ') }
  }
  return { family: raw.trim(), given: '' }
}

export function buildSearchTokens(result: BusinessCardOcrResult): string[] {
  const sources = [
    result.name?.value,
    result.furigana?.value,
    result.company?.value,
    result.department?.value,
    result.title?.value,
    result.email?.value,
    result.tel?.value,
    result.mobile?.value,
    result.rawText,
  ].filter((s): s is string => !!s)

  const tokens = sources.flatMap((s) =>
    s
      .replace(/[^\w\s\u3040-\u9FFF]/g, ' ')
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 1),
  )

  return [...new Set(tokens)]
}
