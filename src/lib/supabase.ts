'use client'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// ── Supabase シングルトンキャッシュ ──────────────────────────────────────────
// createClient() を同一 URL で複数回呼ぶと GoTrueClient の二重初期化警告が出る。
// url をキーにしてインスタンスをキャッシュし、同一セッション内で使い回す。

const cache = new Map<string, SupabaseClient>()

export function getSupabaseClient(url: string, anonKey: string): SupabaseClient {
  const existing = cache.get(url)
  if (existing) return existing
  const client = createClient(url, anonKey)
  cache.set(url, client)
  return client
}
