import { createClient } from '@supabase/supabase-js'

interface DeleteRequestBody {
  id: string
  encryption_salt: string
  supabaseUrl: string
  supabaseAnonKey: string
  userEmail?: string
  vaultGeneration?: number
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as DeleteRequestBody
    const {
      id,
      encryption_salt,
      supabaseUrl,
      supabaseAnonKey,
      userEmail,
      vaultGeneration,
    } = body

    if (!id || !encryption_salt || !supabaseUrl || !supabaseAnonKey) {
      return Response.json(
        { error: 'id, encryption_salt, supabaseUrl, supabaseAnonKey は必須です' },
        { status: 400 },
      )
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
        { error: `Supabase 削除確認エラー: ${lookupError.message}` },
        { status: 500 },
      )
    }

    if (!existingCard) {
      return Response.json({ error: 'CARD_NOT_FOUND' }, { status: 404 })
    }

    const deletedAt = new Date().toISOString()
    const { error } = await supabase
      .from('business_cards')
      .update({ deleted_at: deletedAt })
      .eq('id', id)
      .eq('encryption_salt', encryption_salt)
      .is('deleted_at', null)

    if (error) {
      return Response.json(
        { error: `Supabase 削除エラー: ${error.message}` },
        { status: 500 },
      )
    }

    return Response.json({ ok: true, deleted_at: deletedAt })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '不明なエラー'
    return Response.json({ error: `削除エラー: ${msg}` }, { status: 500 })
  }
}
