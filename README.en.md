<div align="center">
  <img src="docs/assets/mio-logo.png" alt="Mio folded-page mark" width="132">
  <h1>Mio</h1>
  <p><strong>One story. Many frames. Your own book.</strong><br>A local-first workspace for storyboards, image providers and illustrated albums.</p>
  <p><a href="README.md">简体中文</a> · <b>English</b></p>
  <p><a href="#quick-start">Quick start</a> · <a href="docs/en/GUIDE.md">Handbook</a> · <a href="docs/en/API.md">External API</a> · <a href="docs/api/openapi.json">OpenAPI</a></p>
</div>

```text
                         ███╗   ███╗██╗ ██████╗
                         ████╗ ████║██║██╔═══██╗
                         ██╔████╔██║██║██║   ██║
                         ██║╚██╔╝██║██║██║   ██║
                         ██║ ╚═╝ ██║██║╚██████╔╝
                         ╚═╝     ╚═╝╚═╝ ╚═════╝
                          S T O R I E S  I N  F R A M E S
```

## What Mio does

Mio connects **storyboards → reusable character settings → image providers → execution → albums**. It does not train or host image models. It organizes existing services into a traceable creative workflow; character consistency still depends on prompts, references and the model.

Previously named **ComfyComic Studio**, Mio now treats ComfyUI as one provider, not a prerequisite. Internal storage identifiers and legacy formats remain compatible.

## Features

| Area | Capabilities |
| --- | --- |
| Storyboards | Per-scene prompts, captions, variables and overrides |
| Reusable settings | Character presets, blank preset creation and reference images |
| Image production | ComfyUI, NovelAI, OpenAI-compatible Images and image-returning Chat APIs |
| Queue | FIFO, pause, pending-task sorting/deletion, execution snapshots and missing-page recovery |
| Albums | Reader, page refinement, manual order, context-menu batch actions and HTML export |
| Storage | Local files, original images, structured folders and migration |
| Integration | Opt-in Bearer-authenticated `/api/v1`, read-only resources, single-image generation and OpenAPI |
| Optional tools | Separately configured LLM writing and visual review |

Missing or failed frames stay missing; no demonstration image is substituted. The original sample girl's cover remains only on the built-in demo album.

## Provider support

- **ComfyUI:** API-format workflows, node mapping, workflow library and scene overrides. Reference support depends on the workflow.
- **NovelAI:** no workflow required; configurable model ID, V4/V4.5 prompt structure, ZIP image responses and img2img.
- **OpenAI-compatible Images:** generations, multipart edits, base64 or URL image output.
- **OpenAI-compatible Chat:** multimodal references and supported image response formats. Text-only output is a failure.

GPT Image and Nano Banana are model/service names, not interchangeable protocols. Use the model ID and protocol documented by your provider. Native Gemini, OpenAI Responses, asynchronous polling and NovelAI Vibe Transfer are not implemented. See the [provider chapter](docs/en/GUIDE.md#image-providers).

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
| Migration and backup | [Handbook: migration](docs/en/GUIDE.md#migration-and-backup) |
| Security and deployment | [Security policy, bilingual](SECURITY.md) |
| Architecture and adapter development | [Development guide](docs/DEVELOPMENT.md) |
| Release changes and verification | [Changelog](docs/CHANGELOG.md), [test log](docs/TEST_RESULTS.txt) |

An [offline navigation page](docs/index.html) is included.

## External API

The public API is versioned separately from the browser's private synchronization endpoints. It is disabled unless `MIO_API_TOKEN` contains at least 32 characters.

```bash
export MIO_API_TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
python server.py
# In a second shell, set the same token:
curl -H "Authorization: Bearer $MIO_API_TOKEN" http://127.0.0.1:8777/api/v1/capabilities
```

On PowerShell use `$env:MIO_API_TOKEN = "your-generated-token"`.

v1 offers capability discovery, storyboard/album metadata reads, provider identifiers, synchronous NovelAI/OpenAI image generation and local asset reads. **It does not write the browser queue, generate whole albums in a background worker, execute ComfyUI externally or emit webhooks.** Do not use the internal config endpoint as a substitute. See the [integration contract](docs/en/API.md).

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

## License and attribution

Code: [MIT](LICENSE). The Mio name and newly generated logo are a project identity, not a claim of trademark registration or clearance. Third-party services, libraries, models and sample artwork retain their own terms. The original demo cover remains owned by its rightsholder.
