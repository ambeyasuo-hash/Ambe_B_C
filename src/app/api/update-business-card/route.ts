import { createClient } from '@supabase/supabase-js'

interface UpdateRequestBody {
  kind: 'details' | 'thank_you'
  id: string
  encryption_salt: string
  supabaseUrl: string
  supabaseAnonKey: string
  userEmail?: string
  vaultGeneration?: number
  encrypted_data?: string
  search_hashes?: string[]
  notes?: string | null
  card_category?: string | null
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as UpdateRequestBody
    const {
      kind,
      id,
      encryption_salt,
      supabaseUrl,
      supabaseAnonKey,
      userEmail,
      vaultGeneration,
    } = body

    if (!kind || !id || !encryption_salt || !supabaseUrl || !supabaseAnonKey) {
      return Response.json(
        { error: 'kind, id, encryption_salt, supabaseUrl, supabaseAnonKey are required' },
        { status: 400 },
      )
    }

    if (kind !== 'details' && kind !== 'thank_you') {
      return Response.json({ error: 'INVALID_UPDATE_KIND' }, { status: 400 })
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey)

    if (userEmail) {
      const { data: vaultRow, error: vaultErr } = await supabase
        .from('user_vault')
        .select('encryption_salt, vault_generation')
        .eq('user_email', userEmail)
        .single()

      if (vaultErr || !vaultRow) {
        return Response.json({ error: 'VAULT_NOT_FOUND' }, { status: 404 })
      }

      if (vaultRow.encryption_salt !== encryption_salt) {
        return Response.json({ error: 'VAULT_SALT_MISMATCH' }, { status: 409 })
      }

      const clientGeneration: number = vaultGeneration ?? 1
      if (clientGeneration < vaultRow.vault_generation) {
        return Response.json(
          { error: 'VAULT_GENERATION_STALE', serverGeneration: vaultRow.vault_generation },
          { status: 409 },
        )
      }
    }

    const { data: existingCard, error: lookupError } = await supabase
      .from('business_cards')
      .select('id')
      .eq('id', id)
      .eq('encryption_salt', encryption_salt)
      .is('deleted_at', null)
      .maybeSingle()

    if (lookupError) {
      return Response.json(
        { error: `Supabase lookup error: ${lookupError.message}` },
        { status: 500 },
      )
    }

    if (!existingCard) {
      return Response.json({ error: 'CARD_NOT_FOUND' }, { status: 404 })
    }

    if (kind === 'details') {
      const { encrypted_data, search_hashes, notes, card_category } = body
      if (
        !encrypted_data ||
        !Array.isArray(search_hashes) ||
        !search_hashes.every((hash) => typeof hash === 'string') ||
        (notes != null && typeof notes !== 'string') ||
        (card_category != null && typeof card_category !== 'string')
      ) {
        return Response.json({ error: 'INVALID_DETAILS_UPDATE' }, { status: 400 })
      }

      const { error } = await supabase
        .from('business_cards')
        .update({
          encrypted_data,
          search_hashes,
          notes: notes ?? null,
          card_category: card_category ?? null,
        })
        .eq('id', id)
        .eq('encryption_salt', encryption_salt)
        .is('deleted_at', null)

      if (error) {
        return Response.json(
          { error: `Supabase update error: ${error.message}` },
          { status: 500 },
        )
      }

      return Response.json({ ok: true })
    }

    const thankYouSentAt = new Date().toISOString()
    const { error } = await supabase
      .from('business_cards')
      .update({ thank_you_sent: true, thank_you_sent_at: thankYouSentAt })
      .eq('id', id)
      .eq('encryption_salt', encryption_salt)
      .is('deleted_at', null)

    if (error) {
      return Response.json(
        { error: `Supabase update error: ${error.message}` },
        { status: 500 },
      )
    }

    return Response.json({ ok: true, thank_you_sent_at: thankYouSentAt })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return Response.json({ error: `Update error: ${msg}` }, { status: 500 })
  }
}
