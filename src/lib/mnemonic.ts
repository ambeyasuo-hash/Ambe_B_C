'use client'

import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { hkdfDerive, deriveWrappingKeyFromPIN } from './crypto'

// ── Generate 24-word mnemonic ─────────────────────────────────────────────

export function generateMnemonic24(): string {
  // 256 bits → 24 words
  return generateMnemonic(wordlist, 256)
}

export function validateMnemonic24(phrase: string): boolean {
  return validateMnemonic(phrase, wordlist)
}

// ── Derive seed bytes from mnemonic ───────────────────────────────────────

export function mnemonicToSeed(phrase: string): Uint8Array {
  return mnemonicToSeedSync(phrase)
}

// ── Derive encryption_salt from mnemonic (deterministic, 16 bytes → UUID-like hex) ──

export async function deriveEncryptionSalt(phrase: string): Promise<string> {
  const seed = mnemonicToSeed(phrase)
  const bytes = await hkdfDerive(seed, 'encryption-salt', 16)
  // Format as UUID v4-like hex string
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// ── Derive wrapping key beta from mnemonic ────────────────────────────────

export async function deriveWrappingKeyFromMnemonic(phrase: string): Promise<CryptoKey> {
  const seed = mnemonicToSeed(phrase)
  // Use mnemonic seed as a "PIN-like" material with PBKDF2 for consistent strength
  // salt is derived from "mnemonic-wrapping-key" domain info (32 zero bytes via HKDF)
  const saltBytes = await hkdfDerive(seed, 'mnemonic-wrapping-salt', 16)
  const seedPhrase = Array.from(seed)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return deriveWrappingKeyFromPIN(seedPhrase, saltBytes)
}

// ── HMAC key derivation from encryption_salt ─────────────────────────────

export async function deriveHmacKeyBytes(encryptionSalt: string): Promise<Uint8Array> {
  const enc = new TextEncoder()
  return hkdfDerive(enc.encode(encryptionSalt), 'blind-index-hmac', 32)
}
