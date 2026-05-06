import { createClient } from '@supabase/supabase-js'

interface ConsumeQrRequestBody {
  token: string
  supabaseUrl: string
  supabaseAnonKey: string
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ConsumeQrRequestBody
    const { token, supabaseUrl, supabaseAnonKey } = body

    if (!token || !supabaseUrl || !supabaseAnonKey) {
      return Response.json(
        { error: 'token, supabaseUrl, supabaseAnonKey は必須です' },
        { status: 400 },
      )
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey)
    const { data, error } = await supabase.rpc('consume_qr_transfer', { p_token: token })

    if (error) {
      return Response.json(
        { error: `QR転送取得エラー: ${error.message}` },
        { status: 500 },
      )
    }

    const rows = (data ?? []) as Array<{ ct: string }>
    const row = rows[0]
    if (!row?.ct) {
      return Response.json({ error: 'QRコードは無効、期限切れ、または使用済みです' }, { status: 404 })
    }

    return Response.json({ ct: row.ct })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '不明なエラー'
    return Response.json({ error: `QR転送取得エラー: ${msg}` }, { status: 500 })
  }
}
