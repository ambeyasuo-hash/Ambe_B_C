'use client'

import { deriveWrappingKeyFromSignature, toB64, fromB64 } from './crypto'

const RP_NAME = 'あんべの名刺代わり'
const LS_CREDENTIAL_ID         = 'webauthn_credential_id'
const LS_PRF_ENABLED           = 'webauthn_prf_enabled'
const LS_CREDENTIAL_TRANSPORTS = 'webauthn_credential_transports'
const PRF_SALT = new TextEncoder().encode('config-bundle-wrapping-key')

function getRpId(): string | undefined {
  return process.env.NEXT_PUBLIC_WEBAUTHN_RP_ID || undefined
}

export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

// ── Registration ───────────────────────────────────────────────────────────

export async function registerWebAuthn(userId: string, displayName: string): Promise<string> {
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const userIdBytes = new TextEncoder().encode(userId)

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: RP_NAME, ...(getRpId() ? { id: getRpId() } : {}) },
      user: { id: userIdBytes, name: displayName, displayName },
      pubKeyCredParams: [
        { alg: -7,   type: 'public-key' }, // ES256
        { alg: -257, type: 'public-key' }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      extensions: { prf: {} },
      timeout: 60_000,
    },
  }) as PublicKeyCredential | null

  if (!credential) throw new Error('WebAuthn 登録がキャンセルされました')

  const credentialId = toB64(credential.rawId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prfEnabled = !!(credential.getClientExtensionResults() as any)?.prf?.enabled

  // 登録時の実際の transport を保存する。
  // アサーション時にこれを allowCredentials に渡すことで、Chrome が
  // Windows Hello 登録の場合は GPM を無視し、GPM 登録の場合は GPM を使う。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transports: string[] = (credential as any).response?.getTransports?.() ?? []

  localStorage.setItem(LS_CREDENTIAL_ID, credentialId)
  localStorage.setItem(LS_PRF_ENABLED, String(prfEnabled))
  localStorage.setItem(LS_CREDENTIAL_TRANSPORTS, JSON.stringify(transports))

  return credentialId
}

// ── Assertion result ───────────────────────────────────────────────────────

export type AssertResult =
  | { kind: 'prf';       wrappingKey: CryptoKey }
  | { kind: 'no-prf' }   // iOS Safari など PRF 非対応: 生体認証は成功したが PIN で復号が必要

// ── Assertion → wrapping key ───────────────────────────────────────────────

export async function assertWebAuthn(): Promise<AssertResult> {
  const credentialIdB64 = localStorage.getItem(LS_CREDENTIAL_ID)
  if (!credentialIdB64) throw new Error('credentialId が見つかりません。セットアップをやり直してください')

  const prfEnabled = localStorage.getItem(LS_PRF_ENABLED) === 'true'
  const challenge  = crypto.getRandomValues(new Uint8Array(32))

  // 登録時に保存した transports を復元し allowCredentials に渡す。
  // これにより Chrome は登録時と同じ認証器を優先して選択する:
  //   ['internal']       → Windows Hello のみ表示（GPM ポップアップを抑制）
  //   ['hybrid', ...]    → Google Password Manager を使用（Android 等）
  //   []                 → 保存なし → transport 未指定でフォールバック
  const storedTransports = localStorage.getItem(LS_CREDENTIAL_TRANSPORTS)
  const parsedTransports: AuthenticatorTransport[] = storedTransports
    ? (JSON.parse(storedTransports) as AuthenticatorTransport[])
    : []
  // transports 未保存 or 空の場合は 'internal' に固定する。
  // 未指定のままにすると Chrome が Windows Hello + GPM を同時表示する既知の挙動がある。
  // 本アプリは常に authenticatorAttachment: 'platform' で登録するため 'internal' が正しい。
  const transports: AuthenticatorTransport[] =
    parsedTransports.length > 0 ? parsedTransports : ['internal']

  const allowCredential: PublicKeyCredentialDescriptor = {
    id: fromB64(credentialIdB64),
    type: 'public-key',
    transports,
  }

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [allowCredential],
      userVerification: 'required',
      timeout: 60_000,
      ...(getRpId() ? { rpId: getRpId() } : {}),
      ...(prfEnabled
        ? { extensions: { prf: { eval: { first: PRF_SALT } } } }
        : {}),
    },
  }) as PublicKeyCredential | null

  if (!assertion) throw new Error('WebAuthn 認証がキャンセルされました')

  if (prfEnabled) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prfOutput: ArrayBuffer | undefined = (assertion.getClientExtensionResults() as any)?.prf?.results?.first
    if (prfOutput) {
      const keyMaterial = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey'])
      const wrappingKey = await crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: PRF_SALT },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      )
      return { kind: 'prf', wrappingKey }
    }
  }

  // PRF 非対応 (iOS Safari 等): 生体認証は成功。呼び出し元が PIN フォールバックを行う。
  return { kind: 'no-prf' }
}

export function isPrfEnabled(): boolean {
  return localStorage.getItem(LS_PRF_ENABLED) === 'true'
}

export function hasRegisteredCredential(): boolean {
  return !!localStorage.getItem(LS_CREDENTIAL_ID)
}

export function clearCredential(): void {
  localStorage.removeItem(LS_CREDENTIAL_ID)
  localStorage.removeItem(LS_PRF_ENABLED)
  localStorage.removeItem(LS_CREDENTIAL_TRANSPORTS)
}
