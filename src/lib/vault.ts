'use client'

import { generateDataKey, wrapKey, unwrapKey } from './crypto'
import { getSupabaseClient } from './supabase'
import type { ConfigBundle } from './config-bundle'

// ── Supabase client factory (uses runtime config from ConfigBundle) ─────────

export function makeSupabaseClient(url: string, anonKey: string) {
  return getSupabaseClient(url, anonKey)
}

// ── user_vault row ─────────────────────────────────────────────────────────

export interface VaultRow {
  encryption_salt: string
  wrapped_data_key_alpha: string
  wrapped_data_key_beta: string
}

// ── Generate Data Key and wrap with two wrapping keys ─────────────────────

export async function createVaultEntry(
  wrappingKeyAlpha: CryptoKey,
  wrappingKeyBeta: CryptoKey,
): Promise<{ dataKey: CryptoKey; wrappedAlpha: string; wrappedBeta: string }> {
  const dataKey = await generateDataKey()
  const wrappedAlpha = await wrapKey(wrappingKeyAlpha, dataKey)
  const wrappedBeta = await wrapKey(wrappingKeyBeta, dataKey)
  return { dataKey, wrappedAlpha, wrappedBeta }
}

// ── Persist wrapped keys to Supabase ──────────────────────────────────────

export async function saveVaultRow(
  config: Pick<ConfigBundle, 'supabase' | 'encryption_salt'>,
  row: VaultRow,
): Promise<void> {
  const sb = makeSupabaseClient(config.supabase.url, config.supabase.anon_key)
  const { error } = await sb.from('user_vault').upsert(
    {
      encryption_salt: row.encryption_salt,
      wrapped_data_key_alpha: row.wrapped_data_key_alpha,
      wrapped_data_key_beta: row.wrapped_data_key_beta,
    },
    { onConflict: 'encryption_salt' },
  )
  if (error) throw new Error(`vault save failed: ${error.message}`)
}

// ── Fetch wrapped keys from Supabase ──────────────────────────────────────

export async function fetchVaultRow(
  config: Pick<ConfigBundle, 'supabase' | 'encryption_salt'>,
): Promise<VaultRow | null> {
  const sb = makeSupabaseClient(config.supabase.url, config.supabase.anon_key)
  const { data, error } = await sb
    .from('user_vault')
    .select('encryption_salt, wrapped_data_key_alpha, wrapped_data_key_beta')
    .eq('encryption_salt', config.encryption_salt)
    .single()
  if (error) return null
  return data as VaultRow
}

// ── Unlock: unwrap Data Key using wrapping key alpha ──────────────────────

export async function unlockWithAlpha(
  wrappingKeyAlpha: CryptoKey,
  bundle: ConfigBundle,
): Promise<CryptoKey> {
  return unwrapKey(wrappingKeyAlpha, bundle.wrapped_data_key_alpha)
}

// ── Unlock: unwrap Data Key using wrapping key beta (mnemonic) ────────────

export async function unlockWithBeta(
  wrappingKeyBeta: CryptoKey,
  bundle: ConfigBundle,
): Promise<CryptoKey> {
  return unwrapKey(wrappingKeyBeta, bundle.wrapped_data_key_beta)
}

// ── Connection test ────────────────────────────────────────────────────────

export async function testSupabaseConnection(url: string, anonKey: string): Promise<boolean> {
  try {
    const sb = makeSupabaseClient(url, anonKey)
    const { error } = await sb.from('user_vault').select('id').limit(1)
    return !error
  } catch {
    return false
  }
}
