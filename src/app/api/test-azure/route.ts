export async function POST(request: Request) {
  try {
    const { endpoint, key } = await request.json() as { endpoint: string; key: string }

    if (!endpoint || !key) {
      return Response.json({ error: 'endpoint と key は必須です' }, { status: 400 })
    }

    // Normalize endpoint: ensure trailing slash
    const base = endpoint.endsWith('/') ? endpoint : `${endpoint}/`

    // Send an empty POST to trigger auth validation.
    // A valid key returns 400 (bad request body) — auth passed.
    // An invalid key returns 401/403 — auth failed.
    const url = `${base}formrecognizer/documentModels/prebuilt-layout:analyze?api-version=2023-07-31`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/json',
      },
      body: '{}',
    })

    // 400 = auth OK (bad body), 200 = unexpected but OK
    // 401/403 = auth failed
    if (res.status === 400 || res.status === 200) {
      return Response.json({ ok: true })
    }

    return Response.json(
      { error: `Azure エラー (${res.status}): APIキーまたはエンドポイントを確認してください` },
      { status: 400 },
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : '不明なエラー'
    return Response.json({ error: `接続エラー: ${msg}` }, { status: 500 })
  }
}
