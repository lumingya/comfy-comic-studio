> Updated in 2.2: sharing controls now belong to each resource page, not Settings. The package includes populated native `data/`. See [current content and sharing instructions](CONTENT_AND_SHARING.md).

# File-native workspaces

[Handbook](GUIDE.md) · [中文](../guide/FILE_LIBRARY.md) · [Release and acceptance](../RELEASE_CURRENT.md)

Mio 2.x uses independent resources throughout the GUI, save transport, image routes and execution adapters. It does **not** read or automatically migrate the old aggregate format.

## Start safely

Extract the complete package into a new directory. Python 3.10+ is sufficient; use `start.bat`, `bash start.sh`, or `python server.py`. Keep the populated data/, external JS/CSS, vendor files, Python modules and providers together. Open the local server URL, not a standalone `index.html`.

The default workspace is `data/` beside the application. Keep data separate from application upgrades with:

```powershell
$env:MIO_DATA_DIR = 'D:\Comics\My workspace'
python server.py
```

```bash
MIO_DATA_DIR="$HOME/Comics/My workspace" python server.py
```

For 1.x data, stop the old service and follow the [explicit converter guide](FILE_LIBRARY_CONVERSION.md). Convert into a previously nonexistent directory, then point the new server to it. Keep the old source and a backup. Do not overwrite the only copy or manually relabel its schema.

## Layout

- `workspace.json`: workspace marker, not an aggregate content database.
- `settings/comfy.json`, `llm.json`, `xml.json`: independent connection settings.
- `settings/workspace.json`: UI, order and channel metadata.
- `settings/secrets.json`: private plaintext vault, never a public resource.
- `storyboards/<title>--<id>.json`: one storyboard per file.
- `presets/characters/` and `presets/scenes/`: independent typed presets.
- `collections/` and `plans/`: grouping and creation plans.
- `albums/<title--id-suffix>/album.json` plus `images/`: owned artwork, captions, prompts, references, source/edit snapshots.
- `workflows/`, `layouts/`, `records/`: independent workflows, layouts and internal records.
- `runtime/queue/`, `runtime/execution/jobs.sqlite3`: snapshots, idempotency, requests, results and tombstones.
- `runtime/materialization/`: interrupted album-projection recovery receipts.
- `.cache/catalog.sqlite3`: disposable metadata index.
- `.transactions/`, `.trash/`: committed-write recovery and resource removal records.

Non-album resources with images use a same-stem `.assets/images/` directory. IDs identify resources; readable filenames need not change whenever titles do.

## Copy and share

Use the album menu for a native album share ZIP, the gallery for album imports, the toolbar beside the storyboard selector for storyboard sharing, and the variable settings page for variable sharing. Layouts and workflows stay in their own libraries. Settings only retains global maintenance and services. HTML and native album ZIP source options are independent and default off. Importing creates a **new ID**, includes owned images, and associates it with the recipient's current collection. It does not install credentials, authorize generation or silently replace an existing resource. Custom scripts retain the established consent and sandbox policy.

A resource JSON without images can be imported alone. For image-bearing resources use ZIP, or copy the JSON together with its `.assets/`. For an album copy the entire `<id>/` directory. Reload or choose scan/reload to discover copied files. Duplicate IDs or invalid files are reported rather than overwritten.

A collection JSON is grouping metadata; it does not magically contain every referenced plan or album. Use a whole-workspace backup when you need all dependencies.

```bash
python tools/file_library.py --data "/workspace" scan
python tools/file_library.py --data "/workspace" list storyboards
python tools/file_library.py --data "/workspace" export albums ALBUM_ID --output "/backup/book.mio.zip"
python tools/file_library.py --data "/other-workspace" import albums "/backup/book.mio.zip"
```

## Persistence rules

The GUI loads album summaries first and hydrates bodies only when required. It submits explicit entity changes/deletions, never treating an unopened summary as a complete album. Save versions permit disjoint field merges; overlapping edits retain the local draft and return a conflict. Acknowledgements return canonical merged content so subsequent saves cannot restore stale fields.

Resource JSON, vault changes and file removals share a recoverable filesystem commit intent. SQLite remains authoritative for requests, image overrides and deletion fencing; interrupted album materialization is recovered without re-submitting a provider request. Previously enabled queues do not automatically resume when the service restarts.

Deleting an album still needs only one confirmation. It does not require abandoning unknown results or authorizing another charge. Late results and stale tabs cannot resurrect the album. Reference replacements do not alter queued image bytes.

## Secrets and backups

The vault is **permissions-restricted plaintext, not encrypted storage**. Saved text/vision keys are resolved by the same-origin backend and are not returned to password inputs. Blank inputs preserve the existing binding; the explicit forget action removes it. Changing an endpoint requires selecting/entering the appropriate key or forgetting the old one. Image channels continue using endpoint-bound credential IDs.

- **Private full backup:** stop the service and copy all of `data/`, including execution SQLite/WAL and secrets. Never publish it.
- **Portable workspace ZIP:** the GUI loads all album bodies and includes owned images and edit/source snapshots. Load it through the GUI; its portable directory layout is not the native service directory layout.
- **Configuration JSON:** contains local image references, not all image files. It is not a complete cross-device backup.
- **Album HTML:** a reading/share artifact, not a full execution-state backup.

Inspect free-text prompts and captions for private information before sharing; arbitrary secrets in prose cannot be reliably detected.

## Measured performance and limits

A real HTTP/Chromium benchmark used 5000 albums × 12 frames, 183,302,780 bytes of authoritative JSON and no image-decoding workload. Server readiness was approximately 3.34 seconds cold / 0.28 seconds warm; browser boot after service startup was 1.24 / 1.26 seconds. Startup requested **zero album bodies**; first detail hydration took approximately 12 / 10 ms. The metadata response was about 2.72 MB. This is a synthetic Linux sandbox measurement, not a physical-device or real-photo-library guarantee.

Acceptance also exercises the actually delivered 1.2.1 ZIP, old-UI image upload, conversion, native GUI reading/saving/reloading/sharing, and unchanged source hashes. Controlled local interfaces cover slow responses, disconnects, HTTP errors, late results and restarts. Desktop/mobile viewports and light/dark themes were checked in Chromium. Native Windows/macOS, physical phones, Safari/Firefox and live paid suppliers are not claimed as verified.
