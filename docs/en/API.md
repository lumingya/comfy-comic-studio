# Mio public API (path v1 · contract 2.0)

[Home](../README.en.md) · [Route table](../api/ROUTES.md) · [OpenAPI](../api/openapi.json) · [Python example](../../examples/mio_client.py) · [中文详细教程](../api/README.md)

## Overview

`/api/v1` is Mio's automation API. Almost everything the studio UI does is available through it:

- the file library (storyboards, presets, albums, collections, plans, layouts, workflows, conversations);
- settings, image channels and write-only keys;
- production and durable jobs, LLM chat and the vision critic;
- import/export, the recycle bin and asset maintenance;
- extensions, themes and updates.

About 210 operations are generated from one route table. The [route table](../api/ROUTES.md) and [OpenAPI document](../api/openapi.json) match the running server (tests enforce it). A live copy is available at `GET /api/v1/openapi.json` and `GET /api/v1/routes`.

## Enable

Generate a random token of at least 32 characters and set it in the server process:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
export MIO_API_TOKEN="the-generated-token"      # PowerShell: $env:MIO_API_TOKEN = "..."
python server.py
```

Every request, including health and the schema, needs `Authorization: Bearer YOUR_MIO_TOKEN`.

| Situation | Response |
|---|---|
| No token configured, or shorter than 32 characters | 503 `api_disabled` |
| Wrong token | 401 |
| Browser request from an Origin not in `MIO_ORIGINS` | 403 |

**The token is an administrator credential.** It grants full read/write access to creative data, settings, extensions and paid generation.

## Conventions

**Envelopes.** Success is `{data, requestId}`. Errors are `{error: {code, message, details?}, requestId}`. Every response carries an `X-Request-Id` header. Files, images, SSE and `openapi.json` are returned raw.

**Request bodies.**

- JSON objects with `Content-Type: application/json`. PATCH also accepts `application/merge-patch+json`.
- Action routes that need no input accept an empty body.
- Some uploads accept raw bytes: images for `/assets/upload`, and `application/zip` for `/library/import` and `/albums/import`.

**Optimistic concurrency.**

- Single-resource reads return an `ETag`.
- Send `If-Match: "<etag>"` (or `?expectedEtag=`) on writes. A concurrent change, including one from the browser UI, yields `409 revision_conflict` instead of being overwritten.
- Fine-grained routes (frames, variables, album pages) use the parent document's ETag.

**PATCH.** RFC 7396 merge patch: objects merge recursively, `null` deletes a field, and arrays are replaced.

**Destructive operations.** These need `"confirm": true`:

- permanently deleting recycle-bin contents;
- applying, rolling back or restarting updates.

Enabling extension or theme code still needs `"trusted": true`, as in the UI.

**Credentials are write-only.**

- Secret fields in settings are moved into the local vault and read back as empty strings; `secrets` lists which JSON pointers hold a key.
- Channel key pools list metadata only.
- No endpoint ever returns a key.

## Areas

| Area | Main routes |
|---|---|
| Workspace | `GET /workspace`, `GET /workspace/snapshot`, `PUT /workspace/active-collection` |
| Library | `GET/POST /library/{kind}`, `GET/PUT/PATCH/DELETE /library/{kind}/{id}`, `/duplicate`, `/bundle`, `/reorder`, `/import`, `/inspect`, `/export` |
| Frames / variables | `/library/storyboards/{id}/frames[/{frame}]`, `/library/{characters\|scenes}/{id}/entries/{key}` |
| Albums | `POST /albums`, `GET/PATCH/DELETE /albums/{id}`, `/albums/{id}/steps/{n}`, `POST /albums/export`, `POST /albums/{id}/export`, `POST /albums/import`, `/exporters`, `/importers` |
| Settings | `GET/PUT/PATCH /settings/{workspace\|comfy\|llm\|xml}`, `/settings/{name}/secrets` |
| Channels | `GET /providers`, `/channels` CRUD, `/activate`, `/check`, `/models`, `/keys` |
| Generation | `POST /images/generations` (sync, cloud only), `/jobs` (durable, idempotent), `/production/*` (storyboard + presets → album) |
| Workflows | `POST /comfy/check`, `GET /comfy/object-info`, `POST /library/workflows/{id}/activate`, `POST /library/workflows/{id}/analyze` |
| LLM | `POST /llm/chat`, `POST /vision/audit`, `POST /albums/{id}/steps/{n}/critique` |
| Assets | `GET /assets`, `GET /assets/raw`, `POST /assets/upload`, `POST /assets/fetch`, `/assets/catalog`, `/maintenance/*` |
| Recycle bin | `GET /recycle`, `POST /recycle/restore\|purge\|empty\|auto-clean` |
| Marketplace | `GET /marketplace`, `POST /marketplace/fetch`, `POST /marketplace/install` |
| Ecosystem | `/ecosystem/*` (extensions, themes, styles, scripts, preparations, events), `/extensions/{id}/*` (extension backends) |
| Update | `GET /update/status`, `POST /update/check\|apply\|rollback\|restart` |
| Bot catalogue | `GET /catalog`, `/resources/*`, `GET /storyboards`, `GET /albums` |

Library kinds are `storyboards`, `characters`, `scenes`, `collections`, `plans`, `albums`, `layouts`, `workflows`, `rows`, `conversations`, and `tasks` (read-only).

- **Create** (`POST`): an omitted `id` is generated. An omitted `projectId` defaults to the active collection, then to the first collection; with no collection at all the call fails with `400 collection_required`, so create one first (`POST /library/collections`). `POST /library/import` follows the same rule.
- **Images**: fields accept `data:image/...` or `/images/...` URLs and are stored as owned assets.
- **Delete** moves the resource to the recycle bin. A non-empty collection needs `?cascade=true`.

Synchronous generation:

- Only one call runs at a time; a concurrent call gets 429.
- Paid requests are never retried automatically.
- Use a read timeout of at least 330 seconds.

For resumable execution use `/jobs` (see the [foundation guide](FOUNDATION.md)) or the production queue.

Production queue (`/production/*`, the UI's assembly wizard):

- `POST /production/tasks` assembles storyboard + presets + channel/workflow into a task. It only takes a snapshot: no image service is called and nothing is billed.
  - `requestId` is optional; repeating one returns the same task.
  - `title` (the album name) is optional and defaults to the storyboard title. Preset previews (`preview: true` with `previewPrompt`) default to "preset title · 试绘".
- `POST /production/tasks/{id}/start|pause|resume|cancel|clone|rename`. Starting (`start`, `start-many`, `start-sequence`) always needs `"trusted": true` to acknowledge that generation may incur charges; otherwise the call fails with `403 forbidden`.
- `status` goes `standby` (assembled, not started) → `ready` (queued) → `preparing` → `running` → `complete`, `partial`, `failed`, `cancelled` or `interrupted`. Per-page state is in `pages[].state`.

## Migrating from 1.x

The path prefix stays `/api/v1`; the contract version is **2.0.0**.

| 1.x | 2.0 |
|---|---|
| `GET /providers` listed saved channels | It lists provider **types**. Saved channels are at `GET /channels`. |
| `providerId` in `images/generations` | Now `channelId`; `providerId` remains an alias. |
| `production/*` errors were `{"error": "text"}` | They use the standard error envelope. |
| `resources/storyboards\|plans` upserts | Kept but deprecated; use `/library/{kind}`. |
| — | PUT, PATCH and DELETE are supported; CORS exposes `ETag` and `X-Request-Id`. |
| `/health` `version` was 1.0.1 | `version` is the API contract version; the program version is `appVersion`. |

## Security

- Keep the service on loopback or behind an authenticated HTTPS proxy that protects **every** path. The token protects `/api/v1` only.
- `/assets/fetch` and `/marketplace/fetch` make server-side requests to URLs you supply; treat the token accordingly.

See [Security](../SECURITY.md) and [Development](../DEVELOPMENT.md).
