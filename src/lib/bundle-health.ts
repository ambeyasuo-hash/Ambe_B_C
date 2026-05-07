'use client'

import type { ConfigBundle } from './config-bundle'
import { generateSearchIndexSecret } from './normalize'
import { getSupabaseClient } from './supabase'

export type BundleHealthStatus =
  | 'READY'
  | 'AUTO_FIXED'
  | 'STALE_BUNDLE'
  | 'KEY_MISMATCH'
  | 'CONFIG_CONNECTION_FAILED'
  | 'REMOTE_VAULT_MISSING'
  | 'MISSING_LOCAL_FIELDS'

export interface BundleHealthResult {
  status: BundleHealthStatus
  bundle: ConfigBundle
  changed: boolean
  issues: string[]
  serverGeneration?: number
  error?: string
}

interface VaultMetaRow {
  user_email: string | null
  encryption_salt: string
  vault_generation: number
}

function getStoredPinSalt(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('config_bundle_pin_salt')
}

function withIssue(issues: string[], issue: string): string[] {
  return issues.includes(issue) ? issues : [...issues, issue]
}

export function getBundleVaultGeneration(bundle: ConfigBundle): number {
  return bundle.vault_generation ?? 1
}

export function classifyBundleWriteError(error: string): BundleHealthStatus {
  if (error === 'VAULT_GENERATION_STALE') return 'STALE_BUNDLE'
  if (error === 'VAULT_SALT_MISMATCH') return 'KEY_MISMATCH'
  if (error === 'VAULT_NOT_FOUND') return 'REMOTE_VAULT_MISSING'
  return 'CONFIG_CONNECTION_FAILED'
}

export async function ensureFreshBundle(bundle: ConfigBundle): Promise<BundleHealthResult> {
  let nextBundle: ConfigBundle = { ...bundle }
  let changed = false
  let issues: string[] = []

  if (!nextBundle.search_index_secret) {
    nextBundle = { ...nextBundle, search_index_secret: generateSearchIndexSecret() }
    changed = true
    issues = withIssue(issues, 'SEARCH_INDEX_SECRET_ADDED')
  }

  if (!nextBundle.pin_salt) {
    const storedPinSalt = getStoredPinSalt()
    if (storedPinSalt) {
      nextBundle = { ...nextBundle, pin_salt: storedPinSalt }
      changed = true
      issues = withIssue(issues, 'PIN_SALT_ADDED')
    } else {
      issues = withIssue(issues, 'PIN_SALT_MISSING')
    }
  }

  try {
    const supabase = getSupabaseClient(nextBundle.supabase.url, nextBundle.supabase.anon_key)
    let query = supabase
      .from('user_vault')
      .select('user_email, encryption_salt, vault_generation')

    query = nextBundle.userEmail
      ? query.eq('user_email', nextBundle.userEmail)
      : query.eq('encryption_salt', nextBundle.encryption_salt)

    const { data, error } = await query.maybeSingle()

    if (error) {
      return {
        status: 'CONFIG_CONNECTION_FAILED',
        bundle: nextBundle,
        changed,
        issues: withIssue(issues, 'VAULT_LOOKUP_FAILED'),
        error: error.message,
      }
    }

    const vaultRow = data as VaultMetaRow | null
    if (!vaultRow) {
      return {
        status: 'REMOTE_VAULT_MISSING',
        bundle: nextBundle,
        changed,
        issues: withIssue(issues, 'REMOTE_VAULT_MISSING'),
      }
    }

    if (vaultRow.encryption_salt !== nextBundle.encryption_salt) {
      return {
        status: 'KEY_MISMATCH',
        bundle: nextBundle,
        changed,
        issues: withIssue(issues, 'ENCRYPTION_SALT_MISMATCH'),
        serverGeneration: vaultRow.vault_generation,
      }
    }

    if (!nextBundle.userEmail && vaultRow.user_email) {
      nextBundle = { ...nextBundle, userEmail: vaultRow.user_email }
      changed = true
      issues = withIssue(issues, 'USER_EMAIL_ADDED')
    }

    if (nextBundle.vault_generation != null && nextBundle.vault_generation < vaultRow.vault_generation) {
      return {
        status: 'STALE_BUNDLE',
        bundle: nextBundle,
        changed,
        issues: withIssue(issues, 'VAULT_GENERATION_STALE'),
        serverGeneration: vaultRow.vault_generation,
      }
    }

    if (nextBundle.vault_generation == null) {
      nextBundle = { ...nextBundle, vault_generation: vaultRow.vault_generation }
      changed = true
      issues = withIssue(issues, 'VAULT_GENERATION_SYNCED')
    }

    return {
      status: issues.includes('PIN_SALT_MISSING')
        ? 'MISSING_LOCAL_FIELDS'
        : changed
        ? 'AUTO_FIXED'
        : 'READY',
      bundle: nextBundle,
      changed,
      issues,
      serverGeneration: vaultRow.vault_generation,
    }
  } catch (e) {
    return {
      status: 'CONFIG_CONNECTION_FAILED',
      bundle: nextBundle,
      changed,
      issues: withIssue(issues, 'VAULT_LOOKUP_FAILED'),
      error: e instanceof Error ? e.message : 'Unknown error',
    }
  }
}
