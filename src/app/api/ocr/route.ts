interface OcrRequestBody {
  image: string
  model: 'prebuilt-businessCard' | 'prebuilt-layout' | 'prebuilt-read'
  azureEndpoint: string
  azureKey: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as OcrRequestBody
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
    const url = `${base}formrecognizer/documentModels/${model}:analyze?api-version=2023-07-31`

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

    // Poll up to 10 times with 3-second intervals
    for (let i = 0; i < 10; i++) {
      await sleep(3000)
      const pollRes = await fetch(operationUrl, {
        headers: { 'Ocp-Apim-Subscription-Key': azureKey },
      })
      if (!pollRes.ok) {
        return Response.json({ error: 'OCR 結果の取得に失敗しました' }, { status: 500 })
      }
      const result = (await pollRes.json()) as { status: string }
      if (result.status === 'succeeded') {
        return Response.json(result)
      }
      if (result.status === 'failed') {
        return Response.json({ error: 'Azure OCR 解析が失敗しました' }, { status: 500 })
      }
    }

    return Response.json(
      { error: 'OCR タイムアウト: 解析に時間がかかりすぎています' },
      { status: 504 },
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : '不明なエラー'
    return Response.json({ error: `OCR エラー: ${msg}` }, { status: 500 })
  }
}
