<div align="center">
  <img src="docs/assets/mio-banner.svg" alt="Mio — Stories in frames" width="900">
  <h1>Mio</h1>
  <p><strong>One story. Many frames. Your own book.</strong><br>A local-first workspace for storyboards, image providers and illustrated albums.</p>
  <p><a href="README.md">简体中文</a> · <b>English</b></p>
  <p><a href="#quick-start">Quick start</a> · <a href="docs/en/GUIDE.md">Handbook</a> · <a href="docs/en/API.md">External API</a> · <a href="docs/api/openapi.json">OpenAPI</a></p>
</div>



## What Mio does

Mio connects **storyboards → reusable character settings → image providers → execution → albums**. It does not train or host image models. It organizes existing services into a traceable creative workflow; character consistency still depends on prompts, references and the model.


## Features

| Area | Capabilities |
| --- | --- |
| Storyboards | Per-scene prompts, captions, variables and overrides |
| Reusable settings | Character presets, blank preset creation and reference images |
| Image production | ComfyUI, NovelAI, OpenAI-compatible Images and image-returning Chat APIs |
| Queue | Per-task frame pools, configurable timeouts, durable snapshots, same-job continuation and queue ordering |
| Albums | Reader, page refinement, manual order, context-menu batch actions and HTML export |
| Storage | Local files, original images, structured folders and backups |
| Integration | Bearer-authenticated uploads, durable jobs/SSE, revision-checked resource edits and OpenAPI |
| Optional tools | Separately configured LLM writing and visual review |

Missing or failed frames stay missing; no demonstration image is substituted. The original sample girl's cover remains only on the built-in demo album.

## Provider support

- **ComfyUI:** API-format workflows, node mapping, workflow library and scene overrides. Reference support depends on the workflow.
- **NovelAI:** no workflow required; configurable model ID, V4/V4.5 prompt structure, ZIP image responses and ordered reference arrays (model-dependent).
- **OpenAI-compatible Images:** generations, multipart edits, base64 or URL image output.
- **OpenAI-compatible Chat:** multimodal references and supported image response formats. Text-only output is a failure.

GPT Image and Nano Banana are model/service names, not interchangeable protocols. Use the model ID and protocol documented by your provider. Native Gemini, OpenAI Responses, asynchronous polling and automatic NovelAI V4+ Vibe encoding are not implemented. See the [provider chapter](docs/en/GUIDE.md#image-providers).

## Quick start

Requirements: **Python 3.10+** and a modern browser. Runtime uses the Python standard library; Node.js is only needed for development.

1. Download and extract the project. Run `python server.py` from its root, or double-click `start.bat` on Windows.
2. Open **http://127.0.0.1:8777**. In **Image engines**, configure one real provider. Cloud providers need a key; ComfyUI needs an installed checkpoint and valid API workflow.
3. In **Create album**, select your storyboard and settings, edit prompts, choose a provider in the queue area and test one scene before generating the entire album.
4. Open **Albums** to read, refine and export.

Image-provider keys can be saved locally per channel and persist across reloads. Multiple keys can be selected or deleted; plaintext is never returned after saving. No-auth and explicit server-environment authentication are also supported. No automatic switch to mock generation occurs. Cloud requests may cost money.

[Step-by-step handbook →](docs/en/GUIDE.md)

## Documentation

| Goal | Guide |
| --- | --- |
| First album, providers, queue and export | [English handbook](docs/en/GUIDE.md) |
| External software integration | [API guide](docs/en/API.md), [OpenAPI](docs/api/openapi.json), [Python example](examples/mio_client.py) |
| Full Chinese tutorial directory | [Documentation index](docs/README.md) |
| Backup and restore | [Handbook: backups](docs/en/GUIDE.md#backup-and-restore) |
| Security and deployment | [Security policy, bilingual](SECURITY.md) |
| Architecture and adapter development | [Development guide](docs/DEVELOPMENT.md) |
| Release changes and verification | [Changelog](docs/CHANGELOG.md), [test log](docs/TEST_RESULTS.txt) |

The redesigned [handbook homepage](docs/index.html) includes search, language switching and offline HTML chapters. Markdown URLs render a readable page; append `?raw=1` for UTF-8 Markdown source.

## External API

The public API is versioned separately from the browser's private synchronization endpoints. It is disabled unless `MIO_API_TOKEN` contains at least 32 characters.

```bash
export MIO_API_TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
python server.py
# In a second shell, set the same token:
curl -H "Authorization: Bearer $MIO_API_TOKEN" http://127.0.0.1:8777/api/v1/capabilities
```

On PowerShell use `$env:MIO_API_TOKEN = "your-generated-token"`.

v1 provides capabilities, metadata, uploads/assets, durable album jobs including ComfyUI, SSE and controlled resource writes. It does not offer webhooks or arbitrary browser-state replacement. Do not use the internal config endpoint as a substitute. See the [integration contract](docs/en/API.md).

## Privacy and deployment

Data is stored locally, but cloud generation sends prompts and references to your selected service. Saved image-provider secrets are excluded from new snapshots and normal project exports; only credential references remain; older exports and other service settings may still contain secrets.

The server binds to loopback by default. The external API token protects `/api/v1` only, not the entire app. Do not expose the server publicly without a trusted authenticated reverse proxy. Stopping a local request does not guarantee upstream cancellation or a refund. Back up assets as well as JSON.

## Development

```bash
npm ci
npx playwright install chromium
npm run build
npm test
```

Use Node.js 18+. Linux may require additional Playwright system dependencies. Tests cover source contracts, storage, provider transports, actual HTTP API behavior and browser flows. Real paid-provider generation and Windows executable compilation have not been verified in this environment.

## License

[MIT License](LICENSE)

## Image variables

Upload images through ordinary image-typed variables. Referenced variables become `@image_1`, `@image_2` in first-occurrence order, with attachments in the same order. Repeated variables reuse an attachment; unused images are not sent. Files persist locally, queued prompts and references are frozen, and portable backups include the assets. [Details and protocol limits](docs/en/GUIDE.md#image-variables).


## Durable production foundation

Real album jobs execute in Python and continue after the page closes. SQLite/WAL stores snapshots, per-frame results and upstream IDs. Idempotent submissions do not repeat generation; interrupted attempts become unconfirmed rather than automatically retrying. ComfyUI reconciliation only reads existing history.

Built-in adapters are modular. Advanced JSON parameters cannot overwrite bound fields or credentials, and results retain full artifact lists. The asset catalog tracks metadata, provenance and references; stale/conflicting edits are rejected, and explicitly confirmed cleanup only recycles old unreferenced files. New external integrations use the same job scheduler as the UI.

[Foundation handbook and limits](docs/en/FOUNDATION.md) · [Standard-library jobs client](examples/jobs_client.py)

Legacy synchronous/refinement endpoints remain compatible but are not durable jobs. LLM sessions, multi-tenant hosting, arbitrary Python plugins and video generation are outside this release. Stop the service before copying the entire data directory, including its task database and credential vault.

### Image responses and searchable models

Chat image channels accept structured images, Base64, Markdown image syntax and ordinary HTTP(S) image URLs, including extensionless and signed downloads. Actual image bytes are still validated. After fetching models, type directly in the model ID field to show matching suggestions. Click a result or use arrow keys and Enter: the full ID replaces the same input and is saved. Manual IDs remain supported. Downloads do not forward provider credentials.

### Mobile workspace

Phones use labeled bottom navigation, single-column editing, larger controls and touch-friendly model suggestions, queue ordering and album menus. Complete-image reading and HTML export are retained. Trusted-LAN access requires explicit listening/origin configuration; Internet access is not enabled automatically. See [Mobile access](docs/en/MOBILE.md).

### Predictable queue and selection controls

Queue inspection reports only existing task ranges without creating work. Confirmed queue deletion removes the associated album and linked tasks, not the underlying files immediately. Failed frames do not block remaining scenes by default; task-local pause or explicitly authorized bounded retry can be configured. Unknown outcomes are never automatically replayed. In multi-select mode, drag across albums to select along the path, start on a selected album to deselect, and press Escape to clear and exit. Normal browsing still supports drag-to-reorder. Tutorials are prominently linked from the homepage.


### Parallel albums and same-job continuation

The queue page saves a **per-task frame limit** (1–16, default 1) and network wait timeout (30–7200 seconds, default 600). A 20-frame task at 4 starts frames 1–4 and refills on any completion, without a batch barrier. Tasks normally run FIFO. Explicitly starting a second task grants its own four slots: up to eight requests, not a shared four. Continue a failed, canceled or unconfirmed attempt in the original job and album without regenerating any confirmed results, including out-of-order completions. Unknown outcomes require explicit acknowledgement that resubmitting the current frame may incur duplicate charges. Network wait limits are not hard album deadlines. [Execution and recovery details](docs/en/FOUNDATION.md).


### Direct controls and diagnosis

Stop immediately ends local tracking and discards late output while retaining confirmed images; upstream cancellation/billing is not guaranteed. Queue diagnostics distinguish held/failed work from available concurrency. Edit task-local scenes in the original Story editor; the service reads their latest saved input before each request. In-flight input and completed images stay unchanged, and actual attempt inputs are recorded. No separate prompt-editing dialog is needed. Persisted execution logs survive reload. Export samples prioritize generated images, with lightweight preview caching and full-resolution exports. Fullscreen reader layering and cleanup are covered by browser regressions.

## Live channel configuration and a quieter queue

Tasks reference a saved channel ID. Before each request, the service resolves its latest saved model, endpoint, protocol, options and credential binding. Changing a channel affects all linked tasks’ unsent requests, not in-flight calls or completed images. Missing/invalid channel configuration blocks further dispatch without old-config fallback. Cards show the server-saved next-request model; compact runtime controls replace large settings panels and diagnostics are folded into details.

## Reader and queue update

The default release uses a roughly 7 KB HTML shell plus separately cached, feature-organized JS/CSS. Custom readers now contain the whole book, with one scene per page on phones; only explicit export samples are capped at three images. Fresh installations automatically retry all HTTP 5xx up to five extra times (configurable 1–100). No HTTP 4xx is auto-retried; 422 scenes are marked skipped without blocking later scenes. Manual retries have no lifetime cap and refresh the automatic budget. Existing saved policies are preserved. Uncertain outcomes still require reconciliation or explicit billing acknowledgment. Per-attempt logs expose prepared prompts, model and safe parameters without attaching old errors to new requests. Failed/held tasks yield naturally to later albums. This is source/cache separation, not a claim of lazy loading or lower total execution cost.
