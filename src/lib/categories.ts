'use client'

import { getSupabaseClient } from './supabase'

export interface Category {
  id: string
  name: string
  color_index: number
  sort_order: number
}

const SYSTEM_DEFAULT: Category = {
  id: 'system-default',
  name: '未分類',
  color_index: 0,
  sort_order: 0,
}

export async function fetchCategories(
  supabaseUrl: string,
  supabaseAnonKey: string,
  encryptionSalt: string,
): Promise<Category[]> {
  const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey)
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, color_index, sort_order')
    .eq('encryption_salt', encryptionSalt)
    .order('sort_order', { ascending: true })

  if (error) throw new Error(`カテゴリ取得エラー: ${error.message}`)

  const rows = (data ?? []) as Category[]
  // system-default は常に先頭（DBに存在しない場合もフォールバックで挿入）
  return [SYSTEM_DEFAULT, ...rows.filter((r) => r.id !== 'system-default')]
}

export async function createCategory(
  supabaseUrl: string,
  supabaseAnonKey: string,
  encryptionSalt: string,
  name: string,
  colorIndex: number,
): Promise<Category> {
  const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey)
  const { data, error } = await supabase
    .from('categories')
    .insert({ encryption_salt: encryptionSalt, name, color_index: colorIndex, sort_order: 999 })
    .select('id, name, color_index, sort_order')
    .single()

  if (error) throw new Error(`カテゴリ作成エラー: ${error.message}`)
  return data as Category
}

export async function deleteCategory(
  supabaseUrl: string,
  supabaseAnonKey: string,
  id: string,
): Promise<void> {
  if (id === 'system-default') return
  const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey)
  const { error } = await supabase.from('categories').delete().eq('id', id)
  if (error) throw new Error(`カテゴリ削除エラー: ${error.message}`)
}
