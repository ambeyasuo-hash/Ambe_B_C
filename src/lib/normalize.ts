'use client'

import type { BusinessCardOcrResult } from './azure-ocr'
import { hkdfDerive, hmacIndex, randomBytes, toB64 } from './crypto'

interface SearchIndexConfig {
  encryption_salt: string
  search_index_secret?: string
}

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

export function buildSearchTokensFromValues(sources: Array<string | null | undefined>): string[] {
  const tokens = sources
    .filter((s): s is string => !!s)
    .flatMap((s) =>
      s
        .replace(/[^\w\s\u3040-\u9FFF]/g, ' ')
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 1),
    )

  return [...new Set(tokens)]
}

export function buildSearchTokens(result: BusinessCardOcrResult): string[] {
  return buildSearchTokensFromValues([
    result.name?.value,
    result.furigana?.value,
    result.company?.value,
    result.department?.value,
    result.title?.value,
    result.email?.value,
    result.tel?.value,
    result.mobile?.value,
    result.rawText,
  ])
}

export function generateSearchIndexSecret(): string {
  return toB64(randomBytes(32).buffer)
}

async function searchHmacKeyBytes(material: string, version: 'v1' | 'v2'): Promise<Uint8Array<ArrayBuffer>> {
  return hkdfDerive(
    new TextEncoder().encode(material),
    version === 'v2' ? 'blind-index-hmac-v2' : 'blind-index-hmac',
    32,
  )
}

export async function buildSearchHashes(
  tokens: string[],
  config: SearchIndexConfig,
  options: { includeLegacy?: boolean } = {},
): Promise<string[]> {
  const materials: Array<{ material: string; version: 'v1' | 'v2' }> = []
  if (config.search_index_secret) {
    materials.push({ material: config.search_index_secret, version: 'v2' })
  }
  if (!config.search_index_secret || options.includeLegacy !== false) {
    materials.push({ material: config.encryption_salt, version: 'v1' })
  }

  const hashes = await Promise.all(
    materials.flatMap(async ({ material, version }) => {
      const keyBytes = await searchHmacKeyBytes(material, version)
      return Promise.all(tokens.map((t) => hmacIndex(keyBytes, t)))
    }),
  )

  return [...new Set(hashes.flat())]
}

export async function buildSearchQueryHashes(query: string, config: SearchIndexConfig): Promise<string[]> {
  const tokens = buildSearchTokensFromValues([query])
  if (tokens.length === 0) return []
  return buildSearchHashes(tokens, config, { includeLegacy: true })
}

export function buildSearchHashesOrFilter(hashes: string[]): string {
  return hashes
    .map((hash) => `search_hashes.cs.{"${hash.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"}`)
    .join(',')
}
