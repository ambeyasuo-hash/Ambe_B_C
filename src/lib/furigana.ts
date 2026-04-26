'use client'

// Hepburn ローマ字 → カタカナ変換テーブル（3文字→2文字→1文字の順で参照）
const KANA_MAP: Record<string, string> = {
  sha: 'シャ', shi: 'シ', shu: 'シュ', sho: 'ショ',
  chi: 'チ', cha: 'チャ', chu: 'チュ', cho: 'チョ',
  tsu: 'ツ',
  kya: 'キャ', kyu: 'キュ', kyo: 'キョ',
  gya: 'ギャ', gyu: 'ギュ', gyo: 'ギョ',
  nya: 'ニャ', nyu: 'ニュ', nyo: 'ニョ',
  hya: 'ヒャ', hyu: 'ヒュ', hyo: 'ヒョ',
  bya: 'ビャ', byu: 'ビュ', byo: 'ビョ',
  pya: 'ピャ', pyu: 'ピュ', pyo: 'ピョ',
  mya: 'ミャ', myu: 'ミュ', myo: 'ミョ',
  rya: 'リャ', ryu: 'リュ', ryo: 'リョ',
  ja: 'ジャ', ji: 'ジ', ju: 'ジュ', jo: 'ジョ',
  ka: 'カ', ki: 'キ', ku: 'ク', ke: 'ケ', ko: 'コ',
  sa: 'サ', si: 'シ', su: 'ス', se: 'セ', so: 'ソ',
  ta: 'タ', ti: 'チ', tu: 'ツ', te: 'テ', to: 'ト',
  na: 'ナ', ni: 'ニ', nu: 'ヌ', ne: 'ネ', no: 'ノ',
  ha: 'ハ', hi: 'ヒ', fu: 'フ', hu: 'フ', he: 'ヘ', ho: 'ホ',
  ma: 'マ', mi: 'ミ', mu: 'ム', me: 'メ', mo: 'モ',
  ya: 'ヤ', yu: 'ユ', yo: 'ヨ',
  ra: 'ラ', ri: 'リ', ru: 'ル', re: 'レ', ro: 'ロ',
  wa: 'ワ', wo: 'ヲ',
  ga: 'ガ', gi: 'ギ', gu: 'グ', ge: 'ゲ', go: 'ゴ',
  za: 'ザ', zi: 'ジ', zu: 'ズ', ze: 'ゼ', zo: 'ゾ',
  da: 'ダ', di: 'ヂ', du: 'ヅ', de: 'デ', do: 'ド',
  ba: 'バ', bi: 'ビ', bu: 'ブ', be: 'ベ', bo: 'ボ',
  pa: 'パ', pi: 'ピ', pu: 'プ', pe: 'ペ', po: 'ポ',
  a: 'ア', i: 'イ', u: 'ウ', e: 'エ', o: 'オ', n: 'ン',
}

// 文字列がローマ字のみ（ASCII 英字・スペース・ハイフン）で構成されるか
export function isRomaji(s: string): boolean {
  return /^[A-Za-z\s\-.]+$/.test(s.trim()) && s.trim().length > 0
}

// 文字列に漢字が含まれるか
export function hasKanji(s: string): boolean {
  return /[一-龯]/.test(s)
}

// Hepburn ローマ字文字列 → カタカナ（1単語分）
export function romajiToKatakana(romaji: string): string {
  const s = romaji.toLowerCase().trim()
  let result = ''
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === ' ' || c === '-' || c === '.') { result += ' '; i++; continue }
    // 子音の重なり → ッ（aa/ii/uu は長音母音扱いなので除外）
    if (i + 1 < s.length && c === s[i + 1] && !/[aiueo]/.test(c)) {
      result += 'ッ'; i++; continue
    }
    // n + 母音/y → ン（直後の母音/y は次のループで処理）
    if (c === 'n' && i + 1 < s.length && /[aiueoy]/.test(s[i + 1])) {
      result += 'ン'; i++; continue
    }
    // 3 文字
    if (i + 2 < s.length && KANA_MAP[s.slice(i, i + 3)]) {
      result += KANA_MAP[s.slice(i, i + 3)]; i += 3; continue
    }
    // 2 文字
    if (i + 1 < s.length && KANA_MAP[s.slice(i, i + 2)]) {
      result += KANA_MAP[s.slice(i, i + 2)]; i += 2; continue
    }
    // 1 文字
    if (KANA_MAP[c]) { result += KANA_MAP[c]; i++; continue }
    i++
  }
  return result.trim()
}

// スペース区切りのローマ字氏名を各単語ごとにカタカナ変換
export function romajiNameToKatakana(name: string): string {
  return name.trim().split(/\s+/).map(romajiToKatakana).join(' ')
}

// Gemini API で漢字名 → カタカナフリガナを取得
export async function fetchFuriganaFromGemini(
  name: string,
  geminiKey: string,
): Promise<string | null> {
  if (!name.trim() || !geminiKey) return null
  try {
    const sanitized = name.replace(/[\n\r\x00-\x1f]/g, ' ').slice(0, 100)
    const prompt = `次の日本人名のフリガナをカタカナのみで出力してください。姓と名の間にスペースを入れ、フリガナ以外は一切出力しないでください。\n氏名: ${sanitized}`
    const res = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, geminiKey }),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { text?: string }
    const text = (json.text ?? '').trim().replace(/[^゠-ヿ぀-ゟ\s　・ー]/g, '')
    return text.length > 1 ? text : null
  } catch {
    return null
  }
}

// フリガナ自動生成（ローマ字ならカタカナ変換、漢字なら Gemini）
export async function autoFurigana(name: string, geminiKey?: string): Promise<string | null> {
  if (!name.trim()) return null
  if (isRomaji(name)) return romajiNameToKatakana(name)
  if (hasKanji(name) && geminiKey) return fetchFuriganaFromGemini(name, geminiKey)
  return null
}
