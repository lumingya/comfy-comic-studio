# Fresh re-review of other-file fixes — 2026-11-20

## Review boundary

Reviewer: `adversarial_security_final`. This reviewer did not author the production fixes below. The review began at main `40b259f` plus the current uncommitted integration and focused on the second-stage fixes in token activity updates, bundle decoding, trash operations, legacy imports and scheduler claims. It did not repeat the earlier workflow/cloud/album feature review or expand into another full-repository search.

Production was read-only. Only `server/tests/test_other_fresh_recheck.py` and this document belong to this reviewer. All probes used temporary workspaces, synthetic archives and fake/local executors. There were no external calls, personal-data reads, service restarts, browser actions or full-suite runs.

## Standards axis

The scoped fixes preserve the repository's key boundaries: credentials stay in token storage, management takes the operation lock before the store transaction, composable store transactions roll back visible records, and malformed client files use a domain error. No remaining documented-standard violation was established in the reviewed final implementation. No tooling-only style or speculative refactoring finding is included.

## Spec axis — residual findings and owner repairs

### OF1 — P2 — corrupt compressed members still escaped as HTTP 500

- Original follow-up fix caught missing members, `BadZipFile`, unsupported compression and runtime errors, but not errors raised directly by decompression libraries.
- Reproduction: a ZIP with one compressed `manifest.json`; corrupt the DEFLATE block type, BZIP2 stream signature, or LZMA filter properties while leaving the ZIP structure intact.
- Observed before repair: DEFLATE raised `zlib.error` and the real `/api/bundles` route returned plain-text 500. Further isolated probes identified `OSError` from BZIP2 and `_lzma.LZMAError` from LZMA.
- Owner repair: `bundle.read_member` maps all three decompression exceptions, plus EOF/IO errors, to `BundleError`. The API consequently retains its JSON client-error contract and transaction rollback.
- Regression: `OtherFreshApiTests.test_corrupt_compressed_members_return_json_client_error` checks all three compression backends and an unchanged series/asset store.
- Final result: passed in the owner's complete five-test run and in this reviewer's focused affected-test rerun.

### OF2 — P1 — a successful restore could be erased by an already planned purge

- The active-job guard covered delete/purge, but restore operations did not share its serialization, and purge checked `deleted_at` outside an atomic check/delete transaction.
- Reproduction: pause `store.delete_series` after purge has accepted a trashed item; concurrently restore it. Restore returned successfully and the work was live, then releasing purge deleted it without an error. The equivalent episode race also reproduced.
- Owner repair: series and episode restore now hold the engine operation lock and a store transaction; purge checks the trashed state and deletes inside one store transaction. Concurrent restore can therefore succeed and survive, or observe that purge already won and report a normal conflict/not-found outcome.
- Regression: `OtherFreshApiTests.test_successful_restore_cannot_be_deleted_by_a_stale_purge` exercises both series and episodes and rejects a successful restore followed by disappearance. Events coordinate the competing operations; no external process is used.
- Final result: both subcases passed in the owner's five-test run and in this reviewer's affected-test rerun.

### OF3 — P2 — a failed legacy album overwrite published asset metadata

- Building replacement work/episode documents before deleting the old work protected that work, but `assets.put()` still ran before the transaction covering replacement documents.
- Reproduction: an album overwrite contains a valid image in its first frame and invalid dimensions in a later frame. Conversion raises `ValidationError`; the original work survives, but `asset_ids()` grew from zero to one.
- Owner repair: `LegacyImporter.import_albums` wraps the complete album batch in a composable store transaction, and `run` wraps the complete legacy import batch. Visible asset metadata and recipe/work records now roll back together. Content-addressed filesystem blobs may remain reusable; this review does not claim disk-file rollback.
- Regression: `OtherFreshImporterTests.test_failed_album_overwrite_does_not_publish_asset_metadata` verifies unchanged assets and exact original series/episode documents after the later-frame failure.
- Final result: passed in the owner's five-test run and in this reviewer's affected-test rerun.

## Other fixes independently checked

- `touch_api_token` uses an existing-row update constrained by token id and secret hash. The fresh regression confirms an activity touch preserves a concurrent scope reduction and cannot overwrite a rotated credential. The original deterministic revocation regression remains in `test_other_api_review.py`.
- Trash guards include the series owner and all child episode ids through SQL, including children of a trashed parent. Episode guards also include their parent owner. The shared active-operation check covers pending/running/uncertain items, pending deliveries, state leases and running callbacks; paused pending jobs therefore remain busy.
- The legacy importer validates replacement work/episode documents before destructive replacement, and nested store methods use savepoints rather than committing their caller's transaction. The API import also holds the engine operation guard.
- `_claim` re-reads paused/blocked/canceled job state while holding the engine lock before changing an item to running. New probes show a job pausing itself cannot claim its next already planned item, and canceling another job from a started-event listener leaves that job's item unattempted.

## Verification and remaining boundary

- New file: five test methods. Initial run passed the token and claim methods and reproduced the three residual issues above (the trash method failed for both series and episode).
- After owner repairs: parent ran all five methods successfully, including three compression subcases, two trash subcases and two claim scenarios.
- Independent affected-only rerun: three methods passed in 3.362 seconds; no failed assertion was weakened to accommodate a defect.
- New test file passed scoped Ruff and formatting checks. The parent owns the final full CI gates.
- No unresolved P0/P1/P2 issue was established within this bounded re-review. Because this pass found additional defects, the user-requested fresh-agent process should include a different reviewer verifying OF1–OF3 against the final integration; this document provides its handoff.
