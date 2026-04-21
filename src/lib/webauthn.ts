'use client'

import { deriveWrappingKeyFromSignature, toB64, fromB64 } from './crypto'

const RP_NAME = 'あんべの名刺代わり'
const LS_CREDENTIAL_ID = 'webauthn_credential_id'

// ── Platform authenticator availability ──────────────────────────────────

export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

// ── Registration ──────────────────────────────────────────────────────────

export async function registerWebAuthn(userId: string, displayName: string): Promise<string> {
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const userIdBytes = new TextEncoder().encode(userId)

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: RP_NAME },
      user: {
        id: userIdBytes,
        name: displayName,
        displayName,
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' },   // ES256
        { alg: -257, type: 'public-key' }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60_000,
    },
  }) as PublicKeyCredential | null

  if (!credential) throw new Error('WebAuthn 登録がキャンセルされました')

  const credentialId = toB64(credential.rawId)
  localStorage.setItem(LS_CREDENTIAL_ID, credentialId)
  return credentialId
}

// ── Assertion → signature → wrapping key ─────────────────────────────────

export async function assertWebAuthn(): Promise<CryptoKey> {
  const credentialIdB64 = localStorage.getItem(LS_CREDENTIAL_ID)
  if (!credentialIdB64) throw new Error('credentialId が見つかりません')

  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const allowCredentials: PublicKeyCredentialDescriptor[] = [
    {
      id: fromB64(credentialIdB64),
      type: 'public-key',
      transports: ['internal'],
    },
  ]

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials,
      userVerification: 'required',
      timeout: 60_000,
    },
  }) as PublicKeyCredential | null

  if (!assertion) throw new Error('WebAuthn 認証がキャンセルされました')

  const response = assertion.response as AuthenticatorAssertionResponse
  const signature = response.signature

  return deriveWrappingKeyFromSignature(signature)
}

// ── Check if credential is registered on this device ─────────────────────

export function hasRegisteredCredential(): boolean {
  return !!localStorage.getItem(LS_CREDENTIAL_ID)
}

export function clearCredential(): void {
  localStorage.removeItem(LS_CREDENTIAL_ID)
}
