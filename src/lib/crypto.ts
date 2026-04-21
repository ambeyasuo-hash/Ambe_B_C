'use client'

// ── Helpers ────────────────────────────────────────────────────────────────

function toB64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}

function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

// "v1:<iv_b64>:<ct_b64>"
function encodeWrapped(iv: ArrayBuffer, ct: ArrayBuffer): string {
  return `v1:${toB64(iv)}:${toB64(ct)}`
}

function decodeWrapped(wrapped: string): { iv: Uint8Array; ct: Uint8Array } {
  const [, ivB64, ctB64] = wrapped.split(':')
  return { iv: fromB64(ivB64), ct: fromB64(ctB64) }
}

// ── Random ─────────────────────────────────────────────────────────────────

export function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n)
  crypto.getRandomValues(buf)
  return buf
}

// ── AES-256-GCM ────────────────────────────────────────────────────────────

export async function generateDataKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ])
}

export async function aesEncrypt(key: CryptoKey, plaintext: BufferSource): Promise<string> {
  const iv = randomBytes(12)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  return encodeWrapped(iv.buffer, ct)
}

export async function aesDecrypt(key: CryptoKey, wrapped: string): Promise<ArrayBuffer> {
  const { iv, ct } = decodeWrapped(wrapped)
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
}

export async function aesEncryptString(key: CryptoKey, text: string): Promise<string> {
  const enc = new TextEncoder()
  return aesEncrypt(key, enc.encode(text))
}

export async function aesDecryptString(key: CryptoKey, wrapped: string): Promise<string> {
  const buf = await aesDecrypt(key, wrapped)
  return new TextDecoder().decode(buf)
}

// ── Key wrap / unwrap (AES-KW) ─────────────────────────────────────────────

export async function wrapKey(wrappingKey: CryptoKey, dataKey: CryptoKey): Promise<string> {
  const iv = randomBytes(12)
  const exported = await crypto.subtle.exportKey('raw', dataKey)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, exported)
  return encodeWrapped(iv.buffer, ct)
}

export async function unwrapKey(wrappingKey: CryptoKey, wrapped: string): Promise<CryptoKey> {
  const { iv, ct } = decodeWrapped(wrapped)
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, wrappingKey, ct)
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ])
}

// ── PBKDF2 → wrapping key (PIN) ────────────────────────────────────────────

export async function deriveWrappingKeyFromPIN(
  pin: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(pin),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// ── HKDF → wrapping key (WebAuthn assertion signature) ────────────────────

export async function deriveWrappingKeyFromSignature(
  signature: ArrayBuffer,
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    signature,
    'HKDF',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: new TextEncoder().encode('config-bundle-wrapping-key'),
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// ── HKDF generic ──────────────────────────────────────────────────────────

export async function hkdfDerive(
  ikm: BufferSource,
  info: string,
  length: number,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: new TextEncoder().encode(info),
    },
    keyMaterial,
    length * 8,
  )
  return new Uint8Array(bits)
}

// ── HMAC-SHA256 (Blind Indexing) ───────────────────────────────────────────

export async function hmacIndex(
  hmacKeyBytes: Uint8Array,
  value: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    hmacKeyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return toB64(sig)
}

// ── Export helpers ─────────────────────────────────────────────────────────

export { toB64, fromB64 }
