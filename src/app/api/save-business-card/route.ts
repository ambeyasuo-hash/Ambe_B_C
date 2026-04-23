import { createClient } from '@supabase/supabase-js'

interface SaveRequestBody {
  encrypted_data: string
  encrypted_thumbnail_front: string | null
  encrypted_thumbnail_back: string | null
  search_hashes: string[]
  industry_category: string | null
  card_category: string | null
  notes: string | null
  ocr_raw_text: string | null
  ocr_confidence: number
  scanned_at: string
  encryption_salt: string
  supabaseUrl: string
  supabaseAnonKey: string
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SaveRequestBody
    const {
      encrypted_data,
      encrypted_thumbnail_front,
      encrypted_thumbnail_back,
      search_hashes,
      industry_category,
      card_category,
      notes,
      ocr_raw_text,
      ocr_confidence,
      scanned_at,
      encryption_salt,
      supabaseUrl,
      supabaseAnonKey,
    } = body

    if (!encrypted_data || !supabaseUrl || !supabaseAnonKey) {
      return Response.json(
        { error: 'encrypted_data, supabaseUrl, supabaseAnonKey は必須です' },
        { status: 400 },
      )
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey)

    const { data, error } = await supabase
      .from('business_cards')
      .insert({
        encrypted_data,
        encrypted_thumbnail_front,
        encrypted_thumbnail_back,
        search_hashes,
        industry_category,
        card_category,
        notes,
        ocr_raw_text,
        ocr_confidence,
        scanned_at,
        encryption_salt,
      })
      .select('id')
      .single()

    if (error) {
      return Response.json(
        { error: `Supabase 保存エラー: ${error.message}` },
        { status: 500 },
      )
    }

    return Response.json({ id: (data as { id: string }).id })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '不明なエラー'
    return Response.json({ error: `保存エラー: ${msg}` }, { status: 500 })
  }
}
