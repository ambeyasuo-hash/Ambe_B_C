// POST /api/ocr/poll
// Azure のジョブ状態を一度だけ確認して即座に返す（sleep なし）。
// クライアントが 2 秒ごとに呼び出す。
// Vercel 関数の実行時間: < 2 秒

interface OcrPollBody {
  operationUrl: string
  azureKey: string
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as OcrPollBody
    const { operationUrl, azureKey } = body

    if (!operationUrl || !azureKey) {
      return Response.json(
        { error: 'operationUrl, azureKey は必須です' },
        { status: 400 },
      )
    }

    const pollRes = await fetch(operationUrl, {
      headers: { 'Ocp-Apim-Subscription-Key': azureKey },
    })

    if (!pollRes.ok) {
      return Response.json({ error: 'OCR 状態の取得に失敗しました' }, { status: 500 })
    }

    // status: 'running' | 'succeeded' | 'failed' をそのまま返す
    const result = await pollRes.json() as Record<string, unknown>
    return Response.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : '不明なエラー'
    return Response.json({ error: `OCR ポーリングエラー: ${msg}` }, { status: 500 })
  }
}
