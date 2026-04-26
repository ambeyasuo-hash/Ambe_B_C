'use client'

// Nominatim (OpenStreetMap) リバースジオコーディング
// zoom=14 = 市区町村レベル / accept-language=ja で日本語地名を返す
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14&accept-language=ja`,
      { headers: { 'User-Agent': 'AmbeBusinessCard/1.0' } },
    )
    if (!res.ok) return null
    const data = await res.json() as { address?: Record<string, string>; display_name?: string }
    const addr = data.address ?? {}
    const parts = [
      addr.state,
      addr.city ?? addr.county ?? addr.town ?? addr.village,
      addr.suburb ?? addr.city_district ?? addr.neighbourhood,
    ].filter(Boolean)
    return parts.length > 0 ? parts.join(' ') : (data.display_name ?? null)
  } catch {
    return null
  }
}
