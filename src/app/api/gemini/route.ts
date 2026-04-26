interface GeminiRequest {
  prompt: string
  geminiKey: string
}

interface GeminiApiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>
    }
  }>
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GeminiRequest
    const { prompt, geminiKey } = body

    if (!prompt || !geminiKey) {
      return Response.json(
        { error: 'prompt と geminiKey は必須です' },
        { status: 400 },
      )
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      },
    )

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return Response.json(
        { error: `Gemini API エラー (${res.status}): APIキーを確認してください。${errText}` },
        { status: res.status },
      )
    }

    const data = (await res.json()) as GeminiApiResponse
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

    return Response.json({ text })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '不明なエラー'
    return Response.json({ error: `Gemini 接続エラー: ${msg}` }, { status: 500 })
  }
}
