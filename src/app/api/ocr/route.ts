// POST /api/ocr
// Azure AI Document Intelligence にジョブを提出し、operationUrl を即座に返す。
// ポーリングはクライアント側が /api/ocr/poll を叩いて行う。
// Vercel 関数の実行時間: < 5 秒（タイムアウト問題を根本解決）

interface OcrSubmitBody {
  image: string
  model: 'prebuilt-businessCard' | 'prebuilt-layout' | 'prebuilt-read'
  azureEndpoint: string
  azureKey: string
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as OcrSubmitBody
    const { image, model, azureEndpoint, azureKey } = body

    if (!image || !model || !azureEndpoint || !azureKey) {
      return Response.json(
        { error: 'image, model, azureEndpoint, azureKey は必須です' },
        { status: 400 },
      )
    }

    // Strip data URI prefix and decode Base64 to binary
    const base64Data = image.includes(',') ? image.split(',')[1] : image
    const binaryStr = atob(base64Data)
    const bytes = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i)
    }

    const base = azureEndpoint.endsWith('/') ? azureEndpoint : `${azureEndpoint}/`
    const params = new URLSearchParams({
      'api-version': '2023-07-31',
      locale: 'ja-JP',
    })
    const url = `${base}formrecognizer/documentModels/${model}:analyze?${params}`

    const analyzeRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': azureKey,
        'Content-Type': 'image/jpeg',
      },
      body: bytes,
    })

    if (analyzeRes.status !== 202 && analyzeRes.status !== 200) {
      return Response.json(
        { error: `Azure エラー (${analyzeRes.status}): APIキーまたはエンドポイントを確認してください` },
        { status: 400 },
      )
    }

    const operationUrl =
      analyzeRes.headers.get('Operation-Location') ??
      analyzeRes.headers.get('operation-location')

    if (!operationUrl) {
      return Response.json({ error: 'Azure から操作 URL が返されませんでした' }, { status: 500 })
    }

    // operationUrl と azureKey を返す（ポーリングはクライアント側で行う）
    return Response.json({ operationUrl, azureKey })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '不明なエラー'
    return Response.json({ error: `OCR 提出エラー: ${msg}` }, { status: 500 })
  }
}
