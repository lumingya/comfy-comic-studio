# External API v1

[Home](../../README.en.md) · [OpenAPI](../api/openapi.json) · [Python example](../../examples/mio_client.py) · [中文详细教程](../api/README.md)

## Enable

Generate a cryptographically random token of at least 32 characters:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
export MIO_API_TOKEN="the-generated-token"
python server.py
```

PowerShell: `$env:MIO_API_TOKEN = "the-generated-token"`.

Every public GET/POST, including health and the schema, requires `Authorization: Bearer YOUR_MIO_TOKEN`. Without a sufficiently long server token the API returns 503; a wrong token returns 401. Provider credentials are separate: pass `apiKey` for generation or configure `NOVELAI_API_KEY` / `OPENAI_API_KEY` on the server.

## Contract

The versioned namespace is separate from private browser synchronization endpoints. Current capabilities:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/health` | Process health and product version, not provider availability |
| GET | `/api/v1/capabilities` | Discover actual supported operations |
| GET | `/api/v1/providers` | Saved provider IDs and non-secret labels; no base URLs or keys |
| GET | `/api/v1/storyboards?limit=50&offset=0` | Storyboards and selected frame fields, no execution snapshots |
| GET | `/api/v1/albums?limit=50&offset=0` | Album metadata, no source snapshots |
| POST | `/api/v1/images/generations` | One synchronous NovelAI/OpenAI generation |
| GET | `/api/v1/assets?path=%2Fimages%2F...` | Local asset as a data URL |
| GET | `/api/v1/openapi.json` | Raw OpenAPI 3.1 schema |

Lists return `{items,total,limit,offset}`. Limit is 1–100; offset is nonnegative. Saved providers may be empty until the browser configuration has been persisted.

Success responses are `{data: ..., requestId: "req_..."}`. Errors are `{error: {code, message}, requestId: "req_..."}`. The schema endpoint returns the raw schema on success for tooling compatibility. Provider HTTP errors preserve status and redacted upstream bodies, subject to a 2 MiB safety limit. Internal implementation details and raw credentials are not returned.

The new `/jobs` API supports durable whole-album inputs, external ComfyUI execution, idempotent submission, controls and SSE. Use the [foundation API](FOUNDATION.md), not private configuration writes. Webhooks and multi-tenant permissions are not provided.

## Generate an image

Either reference a saved profile:

```json
{"providerId":"openai","prompt":"A quiet illustrated bookshop","apiKey":"YOUR_PROVIDER_KEY"}
```

Or supply its configuration explicitly:

```bash
curl -X POST http://127.0.0.1:8777/api/v1/images/generations \
  -H "Authorization: Bearer $MIO_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"config":{"provider":"openai","baseUrl":"https://api.openai.com/v1","model":"gpt-image-1","protocol":"images","size":"1024x1024"},"prompt":"A quiet illustrated bookshop"}'
```

The second example uses the server provider key. Supply **exactly one** of providerId/config. Provider is novelai/openai; protocol is images/chat. Config values are strings except boolean `sendSize` / `sendQuality` switches and the optional `extraParams` object. False or blank values omit those parameters. Saved providerId configurations can use endpoint-bound local `keyMode: stored` / `keyId` references. Explicit `apiKey: ""` or `keyMode: none` disables authentication; `keyMode: environment` explicitly uses server environment keys. Use an API base URL, not a full operation URL. Remote providers require HTTPS; loopback HTTP is allowed.

For NovelAI, use `https://image.novelai.net`, a supported model such as `nai-diffusion-4-5-full`, and optional numeric frame parameters `{width:768,height:1024,steps:28,cfg:5,seed:-1}`. Width/height must be multiples of 64. The optional `source` is a PNG/JPEG/WebP base64 data URL. NovelAI uses img2img; OpenAI Images uses edits; Chat uses image_url. OpenAI does not receive ComfyUI sampling fields. Prompts are passed literally: external clients must resolve template variables themselves.

The generated result includes `image`, `provider`, `offlineFallback:false` and `assetEndpoint`. GET assetEndpoint with the same token; decode `data.dataUrl`. The image is saved locally under the external asset group, but is not automatically added to an album or browser queue.

Set a client read timeout of at least 330 seconds. The Python example uses 360 seconds and never automatically retries. Its default command only reads capabilities; generation requires `--prompt` and `--provider-id` explicitly.

## Errors and limits

400 means invalid/rejected inputs or generation; 401 bad token; 403 denied browser Origin; 404 missing endpoint/provider/asset; 405 wrong method; 413 oversized body; 429 generation busy; 502 upstream failure/timeout; 503 API disabled. Record requestId in your client. It is not a pollable job ID.

For the direct synchronous image endpoint, one external generation may run at a time. This does not cap durable `/jobs`, which use independent per-task frame pools. This is a concurrency limit, not a per-minute quota; browser generation is independent. Request bodies permit approximately 66.7 MiB for base64 input, and upstream image/ZIP-entry content is bounded to 50 MiB. Provider limits may be smaller.

The legacy synchronous endpoint has no idempotency semantics and never automatically retries. For durable submissions use `/jobs` with an explicit JSON `idempotencyKey`; repeating synchronous requests or choosing new task keys can incur repeated charges. Disconnecting a client does not guarantee upstream cancellation. Check provider billing before retrying after a timeout.

## Security and evolution

Tokens grant trusted-client access to private creative data and paid providers. The API excludes full config and execution snapshots, not private prose inside prompts. Only trust configured endpoints, especially with server-side provider keys.

`MIO_API_TOKEN` protects `/api/v1` only. Keep the entire local service behind loopback or an authenticated HTTPS proxy; private application routes and image URLs are not protected by this token. Browser clients need explicitly allowed Origins via `MIO_ORIGINS`, never wildcard access.

New optional response fields may be added to v1; ignore unknown response fields. Breaking semantics require a new major API namespace. Do not rely on browser global objects as stable integration APIs. See [Security](../../SECURITY.md) and [Development](../DEVELOPMENT.md).

## Ordered image inputs

`POST /api/v1/images/generations` accepts optional `images`: an ordered array of up to 32 local `/images/` references or PNG/JPEG/WebP data URLs (50 MiB combined raw input limit). Clients resolve their own prompt variables. Provider HTTP errors retain status and redacted response details as `upstream_error`, subject to a 2 MiB error-body safety limit. No automatic paid retries or text-only fallback. NovelAI raw reference-array support is model-dependent; no automatic V4+ Vibe encoding is performed.

## Durable foundation API

The new jobs, asset-management and revision-checked resource APIs are documented in [Production foundation](FOUNDATION.md) and included in OpenAPI. They support server-side ComfyUI and cloud execution, idempotency, control, short reconnectable SSE responses, uploads and safe recycling. Older synchronous-generation limitations apply only to that compatibility endpoint, not to `/jobs`.

### Task summaries versus details

`GET /api/v1/jobs` returns lightweight summaries: `results` is empty and errors indicate that details are available. Read `GET /api/v1/jobs/{id}` for complete artifacts and the original sanitized error. An empty summary array does not mean the task produced no output.
