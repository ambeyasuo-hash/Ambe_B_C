'use client'

import { aesEncryptString, aesDecryptString, randomBytes, deriveWrappingKeyFromPIN } from './crypto'

// ── Config Bundle type ────────────────────────────────────────────────────

export interface ConfigBundle {
  v: 1
  encryption_salt: string
  ambe_generation: number
  last_exported_at: string
  supabase: { url: string; anon_key: string }
  azure: { endpoint: string; key: string }
  gemini: { key: string }
  wrapped_data_key_alpha: string   // WebAuthn PRF 由来鍵で wrap
  wrapped_data_key_pin: string     // PIN 由来鍵で wrap (Level 1b)
  wrapped_data_key_beta: string    // Mnemonic 由来鍵で wrap (Level 2)
  /** PIN wrapping salt (hex). .ambe インポート時に pin_salt が分かるようバンドル内に保持 */
  pin_salt?: string
  userEmail: string
  fontSizePreference: 'small' | 'standard' | 'large' | 'xlarge'
}

// localStorage keys
const LS_WRAPPED_ALPHA = 'config_bundle_wrapped_alpha'
const LS_WRAPPED_PIN   = 'config_bundle_wrapped_pin'
const LS_PIN_SALT      = 'config_bundle_pin_salt'

// ── Serialize / deserialize ───────────────────────────────────────────────

function serialize(bundle: ConfigBundle): string {
  return JSON.stringify(bundle)
}

function deserialize(json: string): ConfigBundle {
  return JSON.parse(json) as ConfigBundle
}

// ── Encrypt and save to localStorage ─────────────────────────────────────

export async function saveBundleWithAlpha(
  wrappingKeyAlpha: CryptoKey,
  bundle: ConfigBundle,
): Promise<void> {
  const wrapped = await aesEncryptString(wrappingKeyAlpha, serialize(bundle))
  localStorage.setItem(LS_WRAPPED_ALPHA, wrapped)
}

// salt を外から渡すことで wrapped_data_key_pin の導出と同じ salt を使える。
// 省略時は内部でランダム生成する（後方互換）。
export async function saveBundleWithPIN(
  pin: string,
  bundle: ConfigBundle,
  existingSalt?: Uint8Array<ArrayBuffer>,
): Promise<void> {
  const salt = existingSalt ?? randomBytes(16)
  const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, '0')).join('')
  const wrappingKey = await deriveWrappingKeyFromPIN(pin, salt)
  // pin_salt をバンドル内に埋め込む（.ambe インポート時に再利用可能にする）
  const bundleWithSalt: ConfigBundle = { ...bundle, pin_salt: saltHex }
  const wrapped = await aesEncryptString(wrappingKey, serialize(bundleWithSalt))
  localStorage.setItem(LS_WRAPPED_PIN, wrapped)
  localStorage.setItem(LS_PIN_SALT, saltHex)
}

// ── Decrypt from localStorage ─────────────────────────────────────────────

export async function loadBundleWithAlpha(
  wrappingKeyAlpha: CryptoKey,
): Promise<ConfigBundle> {
  const wrapped = localStorage.getItem(LS_WRAPPED_ALPHA)
  if (!wrapped) throw new Error('config_bundle_wrapped_alpha が見つかりません')
  const json = await aesDecryptString(wrappingKeyAlpha, wrapped)
  return deserialize(json)
}

export async function loadBundleWithPIN(pin: string): Promise<ConfigBundle> {
  const wrapped = localStorage.getItem(LS_WRAPPED_PIN)
  const saltHex = localStorage.getItem(LS_PIN_SALT)
  if (!wrapped || !saltHex) throw new Error('PIN で保護された Bundle が見つかりません')
  const salt = Uint8Array.from(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)))
  const wrappingKey = await deriveWrappingKeyFromPIN(pin, salt)
  const json = await aesDecryptString(wrappingKey, wrapped)
  return deserialize(json)
}

// ── localStorage presence check ───────────────────────────────────────────

export function hasBundleAlpha(): boolean {
  return !!localStorage.getItem(LS_WRAPPED_ALPHA)
}

export function hasBundlePIN(): boolean {
  return !!localStorage.getItem(LS_WRAPPED_PIN)
}

// ── Clear all bundle data from localStorage ───────────────────────────────

export function clearBundles(): void {
  localStorage.removeItem(LS_WRAPPED_ALPHA)
  localStorage.removeItem(LS_WRAPPED_PIN)
  localStorage.removeItem(LS_PIN_SALT)
}

// WebAuthn credential を含む全セットアップデータを削除して初期状態に戻す
export function clearAllSetupData(): void {
  localStorage.removeItem(LS_WRAPPED_ALPHA)
  localStorage.removeItem(LS_WRAPPED_PIN)
  localStorage.removeItem(LS_PIN_SALT)
  localStorage.removeItem('webauthn_credential_id')
  localStorage.removeItem('webauthn_prf_enabled')
}

// ── .ambe file format (portable, PIN-encrypted) ───────────────────────────

export interface AmbeFile {
  kind: 'ambe-config-bundle'
  created_at: string
  ambe_generation: number
  iv: string
  ct: string
}

export async function exportAmbeFile(pin: string, bundle: ConfigBundle): Promise<string> {
  const salt = randomBytes(16)
  const wrappingKey = await deriveWrappingKeyFromPIN(pin, salt)
  const exportBundle: ConfigBundle = {
    ...bundle,
    ambe_generation: bundle.ambe_generation + 1,
    last_exported_at: new Date().toISOString(),
  }
  const wrapped = await aesEncryptString(wrappingKey, serialize(exportBundle))
  const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, '0')).join('')
  const [, iv, ct] = wrapped.split(':')
  const ambeFile: AmbeFile = {
    kind: 'ambe-config-bundle',
    created_at: exportBundle.last_exported_at,
    ambe_generation: exportBundle.ambe_generation,
    iv: `${saltHex}:${iv}`,
    ct,
  }
  return JSON.stringify(ambeFile, null, 2)
}

export async function importAmbeFile(pin: string, fileContent: string): Promise<ConfigBundle> {
  const ambeFile = JSON.parse(fileContent) as AmbeFile
  if (ambeFile.kind !== 'ambe-config-bundle') throw new Error('無効な .ambe ファイルです')
  const [saltHex, iv] = ambeFile.iv.split(':')
  const salt = Uint8Array.from(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)))
  const wrappingKey = await deriveWrappingKeyFromPIN(pin, salt)
  const wrapped = `v1:${iv}:${ambeFile.ct}`
  const json = await aesDecryptString(wrappingKey, wrapped)
  return deserialize(json)
}

// ── QR pairing bundle (temporary, 5-min expiry handled by caller) ─────────

export async function encodeQrBundle(
  pairingPin: string,
  bundle: ConfigBundle,
): Promise<string> {
  const salt = randomBytes(16)
  const wrappingKey = await deriveWrappingKeyFromPIN(pairingPin, salt)
  const wrapped = await aesEncryptString(wrappingKey, serialize(bundle))
  const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, '0')).join('')
  return JSON.stringify({
    kind: 'config-bundle',
    v: 1,
    salt: saltHex,
    wrapped,
    issued_at: Date.now(),
  })
}

export async function decodeQrBundle(
  pairingPin: string,
  qrData: string,
): Promise<ConfigBundle> {
  const obj = JSON.parse(qrData)
  if (obj.kind !== 'config-bundle') throw new Error('無効な QR データです')
  const salt = Uint8Array.from((obj.salt as string).match(/.{2}/g)!.map((h: string) => parseInt(h, 16)))
  const wrappingKey = await deriveWrappingKeyFromPIN(pairingPin, salt)
  const json = await aesDecryptString(wrappingKey, obj.wrapped)
  return deserialize(json)
}
