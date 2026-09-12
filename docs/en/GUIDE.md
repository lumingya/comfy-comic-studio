# Mio handbook

[Home](../../README.en.md) · [简体中文](../guide/QUICKSTART.md) · [API guide](API.md)

## Installation

Install Python 3.10+ and extract the complete project. Keep `server.py`, `mio_api.py`, `mio_credentials.py`, `index.html`, `vendor/` and their relative paths intact. Run `python server.py`, or `start.bat` on Windows. Visit http://127.0.0.1:8777 and name your workspace. Check the bottom bar for successful backend saving.

Mio binds to loopback by default. To use another port, set `MIO_PORT` before starting. Node.js and Python packages are not needed for ordinary use. Cloud generation requires the server URL, not just a double-clicked HTML file.

## Image providers

### ComfyUI

Run ComfyUI separately. Configure appropriate CORS for trusted local browser access, commonly `--enable-cors-header`. Set its address in Mio. Import an **API-format** workflow, not the UI graph export. Replace checkpoint placeholders with real installed filenames and verify positive/negative text and output mappings. Image inputs need a suitable workflow and mapping.

Multiple workflow JSON files can be imported at once. Whole-album defaults and per-scene overrides are retained.

### NovelAI

Select NovelAI in **Image engines**. Defaults are `https://image.novelai.net` and `nai-diffusion-4-5-full`. Enter a valid provider key, not your account password. No workflow is required.

Use dimensions divisible by 64, such as 768×1024. The adapter currently allows 64–2048 per dimension, 1–50 steps, and cfg 0–10. Your account/model may impose tighter resolution and pricing rules. ZIP image responses are decoded locally. Image variables use ordered `reference_image_multiple` arrays. Automatic V4+ Vibe encoding and multi-character coordinate controls are not included; raw-image compatibility depends on the model.

### OpenAI-compatible Images

Use a base URL such as `https://api.openai.com/v1`, without appending `/images/generations`. Set the actual provider model ID and key. New channels default to `gpt-image-1` and Images protocol; size/quality are disabled until explicitly enabled.

Size and quality have separate optional switches. Disabled or blank values are omitted entirely, including multipart edits. Clone a profile to keep several providers. Output supports `data[].b64_json` or `data[].url`. References use multipart `/images/edits`. Size and quality come from the provider profile, not arbitrary ComfyUI scene parameters. steps/cfg/seed are not sent; negative text is appended to the prompt as an Avoid section.

### Image-returning Chat channels

Select Chat only if your service documents image output through Chat Completions. Supported output includes `message.images[].image_url.url`, image_url content blocks or an embedded base64 image data URL in text. References use multimodal image_url input.

Nano Banana is not a universal API protocol. Supply the service's real model ID. Native Gemini generateContent, OpenAI Responses and asynchronous polling are not supported. Text-only output is an error, not an image.

### Keys

Image-provider keys now persist locally per channel. Open Manage keys to add, label, select or delete multiple keys. Saved plaintext is not returned to the browser. Choose No authentication to omit Authorization even if environment keys exist; choose Server environment explicitly to use `NOVELAI_API_KEY` / `OPENAI_API_KEY`. Mio's external API token is a separate credential.

## Your first album

1. Open **Create album** and select/import a storyboard. `default_comic_template.json` is included as an example.
2. Set reusable character/scene values and an album title. For example, a prompt may include `{character}`, `{outfit}` and `{style}`. Define these values and inspect the resolved preview.
3. Edit each scene's action, composition and caption. Captions and image prompts are separate.
4. In the queue area select the image provider and a single-scene range. Test one frame before paying for an entire album.
5. Inspect the result and log. Correct model/key/size issues before resubmitting.
6. Generate the full album when ready. Full generation creates a new version; use missing-page recovery to complete an existing version.
7. Open **Albums** to read, refine or export HTML. Multi-select and right-click for batch actions.

## Queue and snapshots

The queue runs top to bottom. Pending tasks can be dragged or deleted; active tasks are locked. Pause is respected when adding more tasks. Reloading does not silently resume GPU/paid work.

Settings resolve from album defaults through scene presets to scene-specific overrides. Enqueueing binds a channel ID and an album-scoped storyboard. Every request resolves the channel’s latest saved model, endpoint, options and credential binding; in-flight calls remain unchanged. To change an API task's provider, remove the pending task and enqueue again. Deleting a queue task requires confirmation and also removes its associated album; files are recycled separately under reference safeguards.

Ordinary generation sends only prompt-referenced image variables, not an implicit character-front reference. Unsupported reference operations fail explicitly rather than silently dropping the reference. A local cancellation does not guarantee upstream cancellation or a refund. Automatic paid retry is off by default; explicitly enabled bounded retries apply only to designated transient HTTP failures, never unknown results.

Missing pages show a question mark. The original girl's demo cover is retained only for the built-in sample. Export fails honestly when an original image cannot be read.

## Backup and restore


Stop Mio and close its browser before copying data. Back up the complete `data/` folder. On a trusted target machine, restore it into the Mio project folder while the server is stopped. Start Mio and verify albums, images, presets, workflows and save status before removing any backup.

A JSON export may only contain image paths. Back up image assets too. An HTML album is for presentation, not complete editing-state recovery. Review exports for private content and old keys before sharing.

Use `MIO_HOST`, `MIO_PORT` and `MIO_ORIGINS` to configure the server. Default port is 8777; default host is 127.0.0.1.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Cannot open page | Python version, process still running, port conflict |
| Missing mio_api module | Copy the complete release, not server.py alone |
| Provider 401 | Selected local key, deletion status and binding to the current base URL |
| Provider 400 | Model ID, balance, size, quality and protocol |
| No ComfyUI output | API workflow, checkpoint and output mapping |
| Old task ignores new model | Expected snapshot behavior; enqueue again |
| Queue stays idle | Paused state or explicit restart needed after reload |
| Charge after cancellation | Provider may already have accepted the request |
| API 503 / 401 / 429 | External token disabled / incorrect / generation slot busy |
| Save conflict | Back up first; do not force-write empty config |
| Missing image | Check generation logs and data/assets/images |

See [security boundaries](../../SECURITY.md) before remote deployment. Report bugs with steps, environment and sanitized logs—not real keys or a private data directory.


## Channel and key management

Add new OpenAI/NovelAI channels, clone non-secret settings, or delete a channel with confirmation. Pending/running/paused tasks block channel deletion. Deletion preserves artwork but removes that channel's stored keys, including keys bound to its previous endpoints. Old refinement snapshots may then require new credentials. ComfyUI remains a built-in workflow entry.

Fetch models calls the configured base URL plus `/models`, using the current authentication choice. Choose an ID from the returned list or keep typing manually; discovery failure does not erase the current model, and a listed model is not guaranteed to support images. Results are only cached in page memory and scoped to the channel, URL and credential choice.

The local secret file is `data/secrets/provider-keys.json`. It uses atomic writes and POSIX 0600 file permissions, but **is not encrypted**. Protect your OS account, disk and Windows ACLs. The management API returns only labels, timestamps and IDs. Keys are bound to the channel ID, provider and normalized base URL. Changing the endpoint will not forward an old saved key to the new address.

Tasks freeze credential references, never plaintext. Deleting a referenced key makes old tasks fail explicitly, without switching to another credential. Selecting No authentication suppresses Authorization even when server environment variables are set. Empty key entries are not saved. Cloning a channel resets authentication to none.

Normal project JSON/ZIP and album exports do not include the secret file. A full physical copy of data/ **does** include it and must be protected. To migrate saved keys, stop the server and copy the credential file with matching channel configuration to a trusted machine; importing only a normal project requires saving keys again. The key input no longer requests a browser-generated new login password, though password-manager extensions may still apply their own heuristics.

## Presentation studio

Albums open with a neutral, contain-fit image view. The searchable template drawer and single-book export share one workspace. Custom HTML/CSS templates support local PNG/JPEG/WebP/GIF and MP4/WebM assets through `{{asset:ID}}` placeholders. Optional `runtimeScript` JavaScript requires `scriptEnabled` and explicit session consent; it runs inside an opaque-origin iframe, without access to workspace state or provider keys.

Default reading renders only the current image and does not compile HTML on page turns. Custom previews render at most three actual frames from the current page; export includes the entire album. Media are embedded, limited to 24 assets and 6 MiB of Base64 per template; scripts are limited to 64 KB. The whole workspace configuration limit still applies. Large external video libraries are not implemented. Sandboxing does not provide CPU quotas or guarantee that arbitrary scripts cannot cause jank.

`MioTemplate.version`, `MioTemplate.getFrames()` and `MioTemplate.onReady(callback)` expose only the template's own rendered DOM. JSON and metadata-bearing HTML packages preserve assets and script settings.


## Image variables

In **Create → Character and visual settings**, add an attribute of type **Image**, then upload PNG, JPEG or WebP. Chinese variable names are supported. Use `{portrait}` or `{图片}` in the prompt just like text variables. For example, `Reference {portrait}, {name}, background {图片}` resolves to `Reference @image_1, Wang Ming, background @image_2` and sends the two corresponding images in order.

First occurrence assigns a number; repeating the same variable reuses its attachment. Unreferenced images are not sent. Positive then negative prompts share numbering. No separate img2img switch or image-purpose selector is added. Names do not imply image roles, and `@image_N` is an application convention, not a guarantee of model understanding.

Files are content-addressed under `data/assets/images/albums/variable-assets/`. Configuration stores local references, never inline image-variable base64. Enqueueing freezes resolved prompts and ordered references; replacement does not overwrite files used by old tasks. Known missing variables and referenced-but-empty images fail explicitly. Explicitly empty text variables remain optional; undefined weight syntax and escaped braces remain unchanged.

Chat receives ordered image_url blocks; Images uses multipart edits, with `image` for one input and repeated `image[]` fields for multiple inputs. ComfyUI uploads images in order and uses existing **variable** bindings for each LoadImage input; missing bindings fail rather than dropping an image.

NovelAI receives `reference_image_multiple` with fixed protocol defaults of 1.0 information extraction and 0.6 reference strength, without a new redraw control. V4+ may require pre-encoded Vibe data; Mio does **not** automatically call additional encoding or paid endpoints. Default V4.5 compatibility with raw arrays is not guaranteed. Unsupported operations return upstream errors. Explicit refinement/API `source` remains a separate operation.

HTTP failure status and body are retained, with the request key redacted if echoed. Expand **Original response** details in the failed queue task. Paid retries require an explicit bounded queue policy; text-only fallback never occurs. Safety limits: at most 32 cloud inputs, 50 MiB combined raw images, and 2 MiB upstream error bodies; over-limit bodies fail explicitly.

Portable directory backups include current and snapshot-referenced images. Restore re-materializes them into native local files and requires the Python server. A plain configuration/preset JSON is not a standalone image backup. External `/api/v1/images/generations` accepts an ordered `images` array of local references or image data URLs; external clients must resolve their own variables.

Browser/disk, backup and intercepted protocol tests cover this feature; no paid account or real GPU generation was used.

## Server-side production

Real album jobs now run in the Python service, survive closing the page and reconcile results when reopened. For task recovery, unconfirmed results, asset provenance/recycling, controlled writes, advanced parameters and migration limits, see [Production foundation](FOUNDATION.md). Legacy synchronous and independent refinement operations remain compatibility paths, not durable jobs.

### Chat image extraction and model search

Chat responses may contain structured image URLs, Base64 data URLs, Markdown images (`![description](https://...)`) or plain HTTP(S) image links, also inside text content blocks. Explicit structured/Markdown/Base64 images take precedence; plain links are scanned when no explicit image is present, avoiding incidental website links. Multiple image URLs are retained in order and deduplicated. Extensionless download URLs are accepted based on image bytes rather than HTTP metadata. URLs must be accessible to the Python service without forwarding the provider key. HTML pages, unavailable links and unsupported image content still fail explicitly.

After **Fetch models**, type directly in the **model ID** field. Suggestions appear below it, matching case-insensitive, space-separated keywords. Click a result or use Up/Down and Enter: the complete model ID replaces the same input, is saved, and the list closes. Escape, Tab or clicking outside dismisses suggestions. Clearing the field shows the full cached list; unmatched manual IDs are still allowed.

## Mobile access

See [Mobile access and touch controls](MOBILE.md) for the responsive interface, LAN setup, upload/download behavior and verification boundaries.

## Queue policies and path selection

**Inspect current queue** is read-only and checks only each task's frame range, not unrelated album pages. Deleting a queue task asks to delete its album and all linked tasks; original disk images are retained for reference-safe cleanup. Stop running work first.

The durable queue defaults to **retain failed frames and continue remaining scenes**. Optional pause blocks only that task’s future dispatch, not other active pools or current responses. Explicit bounded retry permits HTTP 429/502/503/504 except moderation rejection, with 1–5 extra attempts per frame and a 5–300 second delay. Unknown frames never auto-retry, but other scenes may continue. Resume the same job with fresh progress and billing confirmation; all completed indices remain untouched, including out-of-order images. Each task has its own 1–16-frame sliding window. Tasks normally run FIFO; manually starting a second task at 4 gives another four slots (eight combined). See [execution details](FOUNDATION.md). Last 30 error-history summaries are retained, up to 16,384 characters each. Legacy synchronous endpoints are unchanged.

In album multi-select mode, hold the mouse and paint across cards: only cards along the path are selected. Start on a selected card to remove selection. Revisiting a card in one gesture does not toggle it repeatedly. Near viewport edges, the current displayed page can auto-scroll; it does not automatically change pages. Escape clears the selection and exits, while open dialogs handle their own Escape. Touch scrolling remains scrolling; phones use checkboxes. Normal browsing retains drag-to-reorder.

The homepage has a prominent tutorial link. Reader fullscreen targets the document root rather than the native dialog. Browser F11 and the web Fullscreen API are independent; unavailable web fullscreen produces one dismissible explanation instead of repeated permission errors.
