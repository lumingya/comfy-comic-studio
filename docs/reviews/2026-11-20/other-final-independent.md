# Independent final re-review of OF1-OF3 - 2026-11-20

Reviewer: `backend_gap_audit`, independently assigned after the findings and repairs recorded in
`other-fresh-recheck.md`. This reviewer did not author those production changes. Review input was
HEAD `6c8738d` plus the current uncommitted integration. Production files remained read-only;
only this report and `server/tests/test_other_final_recheck.py` belong to this reviewer.

The review was limited to OF1-OF3: corrupt compressed bundle members, restore versus purge
serialization, and failed legacy overwrite rollback. It did not repeat the earlier feature review,
review unrelated fixes, access personal data, contact external services, restart anything, or run
the full suite. All fixtures were synthetic and used temporary workspaces or in-memory stores.

## Standards axis

No actionable documented-standard violation was established in the scoped implementation.
Management acquires the engine operation lock before the work-store transaction. Store transactions
hold a reentrant lock and use nested savepoints; nested metadata or document writes cannot commit
their caller's transaction. Malformed bundle files retain the domain JSON client-error contract.
The additional tests are offline and do not weaken an existing assertion.

## Spec axis

### OF1 - resolved within the reviewed boundary

`bundle.py:99` places import inside a store transaction. All reads of required bundle members pass
through `read_member` at line 112, which maps ZIP errors and direct DEFLATE, BZIP2 and LZMA
decompression exceptions to `BundleError`. The API maps that error to JSON HTTP 400.

The earlier regression corrupts the manifest before any asset write. The independent added probe
instead leaves the manifest and a correctly hashed image valid, then corrupts `series.json` for
each of the three compression backends. This exercises failure after `assets.put()` has run.
Every response was exactly HTTP 400 with `kind: invalid`, and the existing series, episodes,
documents, asset metadata and episode snapshots were byte-for-byte unchanged in SQLite.

### OF2 - resolved within the reviewed boundary

`Trash._restore_guard` at `trash.py:57` obtains `engine.hold_operation()` before `store.tx()`;
without an engine, the same store transaction still serializes the restore. `Trash.purge` at
line 127 obtains `_guard` and then a store transaction covering both the deleted-state check
and the hard delete. The `_guard` engine inspection releases the engine lock before entering
the store transaction; there is no engine-lock/store-lock inversion on these paths.

The earlier regression exercises a purge that wins first. Its series and episode cases pass.
The added probe exercises the other ordering: restore is paused inside its transaction before
the write, then purge begins concurrently. After restore commits successfully, purge raises
`Conflict` and the restored object remains live. All four combinations of series/episode and
engine-present/engine-absent pass. Both race directions therefore preserve the required outcome:
a restore that reports success cannot subsequently disappear because of that stale purge.

### OF3 - resolved within the reviewed boundary

`LegacyImporter.import_albums` at `importer.py:314` wraps the complete album batch, including
`assets.put()` at line 351, in a store transaction. `run` at line 416 wraps the complete legacy
import, including nested album and recipe writes. `SQLiteStore.tx` at `storage.py:130` rolls
back to its savepoint on failure; `put_asset` at line 588 participates in the same outer
transaction. `AssetStore.put` releases its filesystem-write lock before `put_asset`, so the
new outer transaction does not add an asset-lock/store-lock cycle on this path.

The earlier regression fails during one overwritten album and passes. The added probe begins
with an imported album, image, workflow and storyboard; it then replaces the album and image,
writes the replacement workflow, and fails on a later malformed storyboard frame. A wrapped
`put_doc` confirms the replacement workflow write was reached. After failure, all five observed
SQLite tables match their pre-import state, including the original recipe and asset metadata.

## Verification

- Existing affected-only regressions: 3 methods passed in 4.003 seconds, covering corrupt
  compressed manifests, purge-first restore races, and failed album overwrite metadata rollback.
- New independent probes: `python -m unittest tests.test_other_final_recheck -v` from `server/`;
  3 methods passed in 4.595 seconds, including 3 compression backends and 4 restore-first cases.
- `ruff check server/tests/test_other_final_recheck.py`: passed.
- `ruff format --check server/tests/test_other_final_recheck.py`: passed.

No unresolved P0, P1 or P2 issue was established for OF1-OF3. This is a bounded result, not a
claim about unreviewed endpoints or the full repository. Failed imports may leave reusable,
content-addressed filesystem blobs; rollback of those physical files was not promised or tested.
The parent agent owns the final integration checks and push.
