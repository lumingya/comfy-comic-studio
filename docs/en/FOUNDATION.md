# Production foundation

[Handbook](GUIDE.md) · [简体中文](../guide/FOUNDATION.md) · [OpenAPI](../api/openapi.json)

## Execution model

Real album generation runs in the Python service, not a browser loop. The UI freezes resolved prompts, ordered local image references, channel/workflow configuration and metadata, saves the snapshot, then submits a held durable job and releases it. Closing a page does not stop an accepted album. Reopening projects durable results back into the original album; a manual image replacement takes precedence over an older result.

`data/execution/jobs.sqlite3` stores transactional state, per-frame results, upstream IDs and replayable events using SQLite WAL. One process lease per directory prevents duplicate workers. Browser and external jobs share FIFO task admission with an independent sliding request window for every explicitly enabled task. Synchronous image endpoints are outside that concurrency limit and do not acquire durable/idempotent semantics; use jobs for managed production. Provider adapters use isolated request contexts without a global generation mutex.

The explicit frontend boundary is `foundationFrameInput → submitFoundationQueue`. Built-in request builders live under `providers/`; arbitrary third-party Python plugin loading is not supported. Existing UI composition has not been entirely rewritten. LLM chat/story-writing sessions are not background image jobs.

## States and billing safety

States: `pending`, `paused`, `running`, `complete`, `failed`, `unknown`, `canceled`, `archived`.

Stop immediately cancels the local task, closes established transport sockets and discards late unconfirmed output. Previously confirmed results remain. The provider may still process or charge the submitted operation. Network uncertainty or service interruption produces `unknown`, never automatic paid retry. Restarting after an interrupted attempt pauses dispatch. A global pause does not discard any in-flight frames.

For unknown ComfyUI jobs with a recorded prompt ID, **Reconcile** only reads history and downloads output; it does not upload or submit another prompt. Read-only reconciliation is allowed while scheduling is paused. Synchronous OpenAI/NovelAI operations generally cannot be queried by Mio: check provider records before explicitly continuing the same job with acknowledged billing risk, or abandoning tracking. Unknown album jobs block ordinary missing-page resubmission until acknowledged.

Archiving a finished job retains its idempotency record but releases that job's asset references. Albums, variables and other snapshots continue protecting the same files independently.

## All server jobs

Open **Server jobs** from the queue footer or storage settings to see both UI and external work. The list is lightweight; **Results / original error** loads a single full record on demand. It supports holding, resuming, cancellation, reconciliation and archiving. Album result projections are materialized before archiving so hiding server history does not remove album images; local workspace snapshots may still protect those assets.

## Input, output and advanced parameters

Each job frame carries `config`, resolved `prompt` / `negative`, ordered local `images`, numeric `frame` parameters and, for ComfyUI, an API `workflow`. Upload files first; durable jobs reject inline image base64 and direct API-key fields. Use saved key references or server environment credentials. Do not put secrets into advanced parameters.

Results retain `image` for existing views and add `contractVersion: 1` plus `artifacts: [{kind: "image", url, mime, bytes}]`. All supported returned images are retained, with a 32-output / 50 MiB combined safety cap. This is not a video/audio generation implementation.

Cloud profiles expose a collapsed **Advanced request parameters — JSON** field. It adds provider-specific parameters, freezes them with the job and reports `appliedExtraParams` in results. Existing standard fields, prompts, messages, images, model selection and authentication cannot be overridden. ComfyUI uses graph/node mappings instead. Unsupported parameters return the upstream error; no silent model change or text-only fallback.

## External workflow

Enable `MIO_API_TOKEN` and send `Authorization: Bearer ...` on every public route:

1. `POST /api/v1/assets/upload` with `{dataUrl, name}` returns a local asset URL.
2. `POST /api/v1/jobs` with `{idempotencyKey, input: {label, frames}}` returns a durable job.
3. `GET /api/v1/jobs/{id}` returns progress, artifact lists and errors.
4. `GET /api/v1/jobs/events?after=0` returns SSE events. Reconnect with the last event ID; each short response contains at most 200 events. This is not a webhook. Native EventSource cannot add Authorization headers, so use an appropriate HTTP client.
5. `POST /api/v1/jobs/{id}` with `{action}` controls execution.

The same idempotency key and snapshot return the same job. A different snapshot with that key returns 409. `hold: true` persists without executing; `resume` releases the held job. `/jobs/scheduler` accepts global `pause` / `resume`. Individual actions include `cancel`, `pause`, `resume`, `start`, `defer`, `reconcile`, `abandon`, `archive`, and safe removal. `start` requires fresh recovery confirmation and enables an independent pool; `defer` releases a held/failed task from the FIFO lane without replay, after its in-flight attempts have ended. `/jobs/reorder` accepts `{ids}` for not-yet-started waiting jobs.

Limits: 32 enabled task pools (not a shared 32-request cap); a held enabled pool still counts until completed, deferred or canceled. 1,000 frames / 10 MiB per job, 1,000 unfinished/unconfirmed jobs. The list includes active jobs and recent history, up to 2,000; older records remain readable by ID. Cloud inputs and supported outputs each have a 32-image / 50 MiB combined cap. Provider error bodies are bounded at 2 MiB and redact echoed request credentials.

ComfyUI external frames specify `{provider: "comfyui", baseUrl, outputNodeId}` plus `workflow`. Put `mio-image://1`, `mio-image://2`, etc. into corresponding image-loader fields. These file placeholders are different from the textual `@image_N` prompt convention.

See [`examples/jobs_client.py`](../../examples/jobs_client.py) for a standard-library client and the complete [OpenAPI schema](../api/openapi.json).

## Asset catalog and recovery

Open **Settings → Storage → Asset index / references / safe cleanup**. Metadata includes size, format, dimensions when parsable, SHA-256, timestamps, recorded upload/generation provenance and workspace/job references. Historical provenance is not fabricated.

`GET assets/catalog?verify=1` recomputes hashes and reports missing paths or mismatches against content-addressed names. This verifies file identity, not visual quality or full decoding. Only unreferenced files older than 24 hours are eligible for recycling. Cleanup requires a fresh preview token plus explicitly selected paths; changed references return 409. Active or unknown jobs block cleanup.

Files move to `data/trash/`, never automatic permanent deletion. To recover, stop the service and restore original relative paths under `data/assets/images/`. Asset indexes can be rebuilt.

## Controlled resource writing

`GET /api/v1/resources/storyboards` and `/resources/plans` return editable DTOs plus `revision`. POST `{expectedRevision, item}` performs an upsert, rejecting stale writers with 409. Storyboards retain the UI's 512-frame limit. Plan writing supports basic fields and references to existing rows/templates/presets; complex typed-variable and scene-override updates remain in the UI and are explicitly rejected, not silently ignored.

Browser saves also use the last-read revision. After another client writes, back up unsaved local edits and reload rather than blindly overwriting or automatically merging them.

## Backup and deployment

Stop the service before copying the entire `data/`, including SQLite, any WAL files, images and the credential vault. Do not copy only a live `jobs.sqlite3`. Portable directory exports preserve albums, variables, snapshot images and secondary artifact images, but are not a replacement for the service database. Restored unfinished server tasks require manual checking instead of automatic paid resubmission.

This is a trusted, single-user local application, not a multi-tenant public service. If exposing it beyond loopback, authenticate the entire site including private APIs; protecting only `/api/v1` is insufficient.

Tests exercise real SQLite/files, local HTTP and browser close/reopen behavior. Provider traffic is intercepted or served by a local protocol fixture; real cloud billing and GPU generation are not verified. Windows execution/locking remains untested in this environment.

## Failure policy API

`POST /api/v1/jobs/scheduler` accepts `{action:"policy", policy:{mode:"pause"|"retry"|"continue", maxRetries:2, delaySeconds:15, onExhausted:"pause"|"continue"}}`. The policy configuration is durable and shared; its effects are task-local. Default mode and exhaustion behavior are `continue`: retain a failed or unknown frame while dispatching other pending scenes. Optional `pause` only blocks that task’s further dispatch; other in-flight results and other enabled pools continue. Retry must be explicitly enabled and may incur additional charges. Only HTTP 429/502/503/504 auto-retry, excluding explicit moderation rejection; unknown frames never auto-retry. `POST jobs/{id}` with `{action:"retry", recovery:{expectedCursor,expectedUpdated}}` requeues failed frames only when there are no unknown/canceled-unconfirmed or active attempts; it does not release the global pause by itself. Successful frames and frozen inputs are retained. Job details include `retry_count`, `ready_at`, `attempts` and recent `errors`.


## Concurrency, timeout and acknowledged continuation

Use the queue-page runtime panel, or POST `/api/v1/jobs/scheduler` with `{"action":"runtime","runtime":{"concurrency":3,"requestTimeoutSeconds":900}}`. Defaults are 1 in-flight frame per task and 600 seconds; accepted integer ranges are 1–16 and 30–7200. Settings persist in SQLite and apply to newly claimed attempts. A lower limit does not interrupt in-flight requests. A 20-frame task at 4 immediately starts frames 1–4. Any completion opens a slot for the next dispatchable frame; there is no batch barrier. Tasks normally run FIFO, with drag ordering before their first attempt. Manually start another queued task to enable a separate pool: two tasks at 4 can hold 8 HTTP requests. Separate jobs sharing the same album ID may not overlap; unresolved same-album outcomes must be handled first. Retry waits do not occupy slots, so other scenes in that task can proceed. They do not implicitly enable the next task.

OpenAI/NovelAI timeouts limit network connection/read waits, separately for the generation response and each remote image download—not hard frame/album wall time. ComfyUI shares a deadline budget across upload, submission, polling and downloads, with remaining time passed to each request. A slowly streaming read can still last longer; this is not upstream cancellation. Synchronous refinement/direct API calls are outside runtime settings.

Continue buttons are available for failed, unknown, unfinished canceled or held tasks after in-flight attempts end. The UI fetches fresh progress before confirmation and displays the original unresolved scene numbers, including sparse and subset tasks. Gallery resume uses the existing recoverable job rather than a new album. Confirmed results and frozen inputs are retained. For unknown results, the user must acknowledge that unconfirmed frames may still be running or already billed; resubmitting them may duplicate charges. No unknown request is automatically replayed. The UI then resumes global dispatch, which may start other waiting albums too.

External clients first GET `/api/v1/jobs/{id}`, then POST `{"action":"continue","recovery":{"expectedCursor":1,"expectedUpdated":1789120000.25,"acknowledgeUnconfirmed":true}}` with the **actual latest** cursor and timestamp. Stale/duplicate confirmations or inconsistent saved progress are rejected with 409. `continue` does not resume the global scheduler: send a separate scheduler `resume` if intended. `retry` remains failed-only and also requires a fresh recovery count/timestamp. Optional input `frameIndex` maps each task-local result index to the original zero-based scene; outputs expose `frameIndices`, `nextFrameIndex` and `active_timeout`. `progressVersion: 2` and `executionModel: "per-task-frame-pools"` identify indexed progress: `cursor` is the confirmed count, NOT a completed prefix or next index. `results` are sorted by local index and may have holes. Use `completedIndices`, `runningIndices`, `running_count`, `nextIndex` and per-frame `frameStates`. For example, completed scenes 2 and 4 mean cursor=2, completedIndices=[1,3], nextIndex=0. Recovery and editing never replay/modify either completed scene. Old jobs without original-index metadata only expose task-local fallback indices; the UI uses its persisted `serverIndices` mapping.


## Input revisions and durable activity

There is no separate task-prompt editor. Use the original **Story** editor and its **scope** selector to choose a specific album version; its own scene list remains stable even if the shared template changes. The latest unfinished version is initially selected; the selection never silently falls back to an older job when that version finishes. Multiple versions can be selected in the same existing editor.

Save scene text, negative prompts, captions and per-frame rendering fields, then wait for Python’s save acknowledgement. Before each request, the service reads the latest saved input belonging to that album, not the shared template. Leaving the browser does not stop this. Pending frames adopt the edit without another apply action. In-flight requests retain their captured input; successful images are not redrawn. Editing does not pause scheduling or retry timers. Failed/stopped/unknown outcomes still need the normal continuation and billing acknowledgement.

Channel identity stays tied to the task, but its latest saved model, endpoint, protocol, options and credential binding are resolved before every new request. Graph structure and variable bindings stay tied to the album version; edited placeholders resolve using its saved scope. ComfyUI uses the existing graph compiler and mappings rather than replacing a running public workflow. Invalid saved input fails visibly instead of quietly submitting an old prompt. Scene count/order are not edited within a submitted version.

`GET jobs/{id}` exposes the latest 100 `requestHistory` records: index, attempt, timestamp, input hash, prompt, negative, images, safe config fields and frame parameters. Endpoint URLs, key references and arbitrary profile metadata are excluded from this public history. The database retains the full prepared input. Preparation is not proof of upstream acceptance or billing. Read-only ComfyUI reconciliation uses the original upstream attempt’s input, not a newly edited draft.

For external clients, the explicit `amend` API remains available with fresh recovery count/timestamp, held task state and unfinished-only validation. It is not an additional GUI entry. Original idempotency keys/digests and completed results remain unchanged; API before/after changes are retained in `revisions`.

Clearly identified content rejection inside a wrapped 502 is not automatically retried. Unknown error formats remain visible for manual review. Retry-wait cards expose actions immediately rather than hiding them until exhaustion.

`GET /jobs/activity?after=0` returns the latest 200 persisted events with timestamps, task labels, provider, confirmed progress, attempts, timeouts and bounded error summaries. The UI restores this history after reload and displays scheduler counts. Held albums can be explicitly released as a batch; releasing ordinary held tasks restores FIFO eligibility, not independent parallel pools. Previously explicitly enabled pools retain their identity. Raising concurrency does not replay failed/stopped frames.

Each frame owns its state, retry deadline, upstream ID, timeout, result and attempt epoch. Cancellation uses a separate attempt epoch, not a fabricated request count. Closing local sockets cannot revoke upstream computation or billing, and connection setup/DNS may still finish in the background. Late results are fenced out even after immediate continuation. Global pause still waits for current output; Stop discards it.

## Channel registry and configuration authority

Browser frames now carry channelId plus provider type rather than a fixed execution model. mio_channels resolves profiles from a single saved-workspace snapshot; scene inputs and channel settings share that read. Missing channels, empty model/address or changed provider type fail closed and block that task’s future dispatch, without old-config or active-channel fallback. External clients may opt in with channelId; explicit unlinked configurations remain client-owned. Existing browser jobs with config.id retain their original channel association. currentChannels exposes safe next-request previews, while requestHistory retains actual prepared configuration. A ComfyUI graph/checkpoint remains part of the task workflow version; reconciliation uses the original request snapshot.
