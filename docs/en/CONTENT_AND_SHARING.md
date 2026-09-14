# Content files, album sharing and safe upgrades — 2.2

[Handbook](GUIDE.md) · [File library](FILE_LIBRARY.md) · [中文完整教程](../guide/CONTENT_AND_SHARING.md)

## A populated, editable `data/`

This is a complete source runtime, not a patch or an empty workspace shell. It includes native album files and owned artwork, storyboards, variable presets, plans, workflows, seven presentation layouts, marketplace content and practice content. Authored content is read from files rather than reconstructed by JavaScript factories or embedded cover images.

- `data/albums/<folder>/album.json` and `images/`: independent albums and their images.
- `data/storyboards/`: one JSON per storyboard.
- `data/presets/characters/` and `scenes/`: reusable variables, with owned asset folders where necessary. There is no separate top-level presets distribution.
- `data/collections/`, `plans/`, `records/`: collections, plans, character rows and conversations.
- `data/layouts/`: one editable layout per file. The accepted AFTERGLOW design remains; Seamless is image-only with zero gaps, without deleting original captions.
- `data/workflows/`, `settings/`: workflows and credential-free initial settings.
- `data/catalog/`: registry, individual marketplace entries, practice content, SVGs, base-layout materials and reader sizing rules.
- `data/distribution.json`: an explicit shipping allowlist with SHA-256 checksums, not a request to include all personal workspace files.

Application JavaScript, CSS and Python remain separate. Runtime databases, credentials and caches are not shipped.

## Install and upgrade

Extract the whole ZIP into a new directory. Keep `data/`, `js/`, `vendor/`, `providers/` and `docs/`. Run `start.bat` on Windows or `bash start.sh` on macOS/Linux, or `python server.py`. Python 3.10+ is required; Node.js is only needed for development tests/builds.

For an existing 2.1 workspace:

1. Save drafts, stop the old service and make a private full backup.
2. Extract the new program into a different directory. **Do not overlay its populated `data/` onto your only personal workspace.**
3. Start the new program with `MIO_DATA_DIR` pointing to your existing data directory.
4. Missing content catalogs are added without replacing existing albums, storyboards, presets or layouts. Edited layout content, default export choices and per-album presentation choices remain yours.

A genuinely empty external workspace receives the shipped content. Existing resources are not automatically “repaired” by restoring deleted artwork, renaming characters or replacing built-in IDs. Refresh or scan after editing native files. Missing dependencies require an explicit import or a different selection.

Older 1.x aggregate data still requires the explicit conversion tool, writing to a new destination. Do not overwrite the only original or merely change its schema label.

## Resource-local controls

| Resource | Where |
| --- | --- |
| Import album | Gallery/collection home; Mio HTML, independent JSON or `.mio.zip` |
| Share editable album | The album’s own menu → export share package |
| Export reading HTML | Reader presentation/export panel or album export |
| Storyboard | Import/export beside the storyboard selector |
| Variables | Character and scene settings page; images travel in the ZIP |
| Workflow / layout | Their respective libraries |
| Global maintenance | Settings: services, saving, scanning and genuine whole-workspace maintenance |

Use ZIP for resources with images. A standalone JSON file cannot carry neighboring asset files by itself.

## Independent source consent

HTML and native album ZIP exports have separate options for **storyboard** and **variables**, initially unchecked. Variables can include reference images and per-frame overrides; source prompts and captions can contain private information.

The recipient sees one confirmation dialog with two independent, default-off choices. They can import the album alone, either source type, or both. Import creates fresh album/resource/frame/variable IDs and owned images. A new source-linked plan is disabled and references only the newly imported resources. Imported variables are presets; they do not silently replace an existing plan’s values.

Inspection and cancellation do not write resources. Invalid metadata, missing images, unsupported types, bad checksums and unsafe assets fail before the import transaction. Service configuration, credentials and execution permissions are not source materials.

## Preview and originals

Ordinary native reading remains lazy. Export preview uses the same layout compiler as downloaded HTML. It can decode lighter preview bitmaps while retaining actual original dimensions for geometry. Compare the same available viewport, layout and options: large portrait/landscape images follow the same column rules, small images are not enlarged, and complete aspect ratios are retained. Downloads read the actual originals/edited full-resolution rasters, not requested generation dimensions.

## Security and limits

HTML is parsed as inert data: scripts are not executed and external/network/local-file images are not fetched. New exports use `mio.album-html.v1`; older Mio HTML is accepted only through designated frame markers with fully inline images. Arbitrary websites are not album imports. Passive SVG validation and ZIP path/type/size/hash checks remain in force.

HTML limit: 192 MiB; metadata: 16 MiB; up to 64 albums per import and 512 scenes per album. Split large files.

HTML is a reading/source-sharing format, not a full execution recovery backup. Use native ZIP to retain editable album layers and originals. Full physical workspace backups include the permissions-restricted plaintext credential vault and must remain private. Free-form prompts, captions and images still require human privacy review.

Scanning, opening, importing and upgrading do not submit paid generation. Unknown paid attempts are not automatically replayed. Album deletion still uses one deletion confirmation, not a provider-lookup or tracking-abandonment prerequisite.


## 2.2.2: separate album settings and preset drafts

In 2.3, the global album selector owns both the storyboard and the main settings editor. Public presets live in a separate library dialog with persistent private drafts. Update saves that library resource only; Apply copies its draft to the explicitly named album. Saved album edits affect unsent frames, never submitted requests. Closing the library returns to the album.

Save As creates a fresh ID and selects that independent copy as the subsequent update target. Creating a blank preset does not clear the album. Contextual export follows the displayed editor, including its owned image bytes. Delayed image uploads keep their original draft/property owner, and cannot resurrect deleted properties or presets.

Failed or unacknowledged writes remain explicitly unconfirmed with drafts retained. Ordinary retries retain the same identity. A saved draft based on an externally changed preset cannot overwrite that newer version; use Save As to preserve a separate copy. The complete package and safe upgrade instructions above still apply.


## 2.2.3: rename and a consecutive-failure guard

The album context menu now offers Rename, prefilling the existing full title of each selected album. It replaces each name directly rather than appending a prefix. Existing tags remain searchable and are not deleted; tag entry no longer appears in the rename dialog.

Queue → Failure policy adds `maxConsecutiveFailures` (default 5, range 0–100; 0 disables this guard). Failed generation attempts accumulate per task across frames and retries; success resets the streak. Reaching the limit stops pending retries and further generation dispatch for this task, not other albums. Already submitted requests retain their results, but late success, page/server restart, policy changes and global resume cannot clear an already latched stop. Explicit continuation resets it while preserving completed frames. Unconfirmed paid attempts still require recovery consent, and deletion still takes one confirmation.
