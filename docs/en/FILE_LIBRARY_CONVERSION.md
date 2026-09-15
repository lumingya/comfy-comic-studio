# One-time conversion to file-native storage

> **Explicit migration for Mio 2.0.** The GUI, per-file saving, images and execution path now use v2. Stop the old service, convert to a new directory and point the new server's `MIO_DATA_DIR` to it. Keep the source; do not point the old server at v2.
>
> [Workspace guide](FILE_LIBRARY.md) · [中文](../guide/FILE_LIBRARY_CONVERSION.md)

## What is implemented

The offline converter reads a persisted workspace and writes a **new, previously nonexistent** directory. Storyboards, presets, collections, plans, albums, layouts and workflows become separate files. Internal character rows, conversations and queue snapshots are separate files too.

Album images and reference snapshots become owner-relative assets. Original bytes are preserved without resampling or generation. Passive SVG originals are validated; scripts, external resources, event attributes and entity declarations are rejected.

Recognized credential fields are relocated to `settings/secrets.json`. Durable job/frame results, request inputs, idempotency identities and deletion tombstones are retained. Converted execution remains paused; an in-flight request becomes unconfirmed, never automatically retried.

## Usage

1. Back up the old workspace and **stop the old service**, not just its browser tab.
2. Choose an output path that does not exist, even as an empty directory. Its parent directory must exist.
3. Allow enough free space for private staging and per-resource image copies.

First, build and verify privately without publishing an output directory:

```bash
python tools/convert_file_library.py \
  --source "/path/to/Mio-old" \
  --output "/path/to/Mio-data-v2" \
  --source-stopped --dry-run
```

On Windows, the same command can be written on one line using quoted Windows paths.

`--source` accepts the old project, its data directory, or a complete flat configuration JSON. For a configuration exported away from the project, supply `--project "/path/to/Mio-old"` so local assets can be resolved. A single storyboard is not a workspace conversion input; use the resource import CLI instead.

After a successful dry run, remove `--dry-run` to publish the new directory. Python 3.10+ is sufficient; conversion does not require Node, fetch images, start models or make paid requests.

## Inspecting the result

```bash
python tools/file_library.py --data "/path/to/Mio-data-v2" list albums
python tools/file_library.py --data "/path/to/Mio-data-v2" list storyboards
python tools/file_library.py --data "/path/to/Mio-data-v2" problems
```

The detailed report is `runtime/conversion/report.json`. Important fields:

- `published` in the CLI response: the private result was verified and published.
- `sourceUnchanged`: source inventory and content-hash checks passed.
- `counts`: number of resources by kind.
- `runtimeChanges`: paused or unconfirmed execution records.
- `excludedDeletedAlbumIds`: tombstoned albums were not resurrected from stale configuration.
- `unassignedAssets`: retained unused images or non-displayed quarantined files.
- `retainedOnlyInSource`: caches, old backups, locks or unknown files not carried into v2. **Keep the old directory.**
- `guiRuntimeIntegrated: true`: the output can be opened by Mio 2.0 using `MIO_DATA_DIR`; keep the original source.

Existing IDs and ordering are retained. Presets default to the character category unless they explicitly declare the scene category; titles are not used to guess resource types.

## Failure and security boundaries

The source is never repaired or overwritten. Complete config journals are interpreted only for the new output. SQLite DB/WAL/SHM files are copied before SQLite opens them, so recovery and checkpointing occur privately, not in the source directory.

Missing images, invalid resources, duplicate IDs, changed source files and output-name conflicts abort publication. The final rename refuses even an empty destination created at the last moment. Normal exceptions clean staging; abrupt termination may leave a hidden `.output-name.converting-...` directory, which is not a completed workspace.

There is no automatic remote download, text-only fallback, regeneration or paid retry. Credentials use access-controlled plaintext storage, not encryption. Arbitrary secrets written in user-authored text cannot be reliably identified.

## Executed validation

In addition to controlled file/SQLite tests, a real browser test starts the **actual delivered 1.2.1 ZIP**, creates a plan, uploads an image variable, saves through its UI, stops that service and converts its data. Storyboards, albums, characters, plans, conversations, the five original layouts and every embedded/uploaded image were checked for unchanged domain content or original bytes. Source data hashes matched before and after conversion.

A real worker opened the converted durable database and remained held, without executing the provider callback.

Tests ran in a Linux sandbox with Chromium. Native Windows/macOS publication branches and paid providers have not been verified. These are converter-specific checks. See the [2.0 acceptance record](../RELEASE_CURRENT.md) for full runtime and delivered-baseline verification.
