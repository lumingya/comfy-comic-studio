# Second-stage review of other API boundaries

Review target: HEAD `4709022` and current integration. This pass read the shared context,
`final-security-adversarial.md`, `security-fresh-recheck.md` and the earlier adjacent API
report, then focused on existing token activity writes, the extension panel broker,
extension private settings identity checks and portable bundle imports. It did not repeat
the already verified workflow/task-route or template-security audit.

Production files were read-only for this reviewer. Reproductions used temporary `ApiCase`
workspaces and synthetic archives, without network calls, personal data, live services or
a full suite. Only the new regression file and this report belong to the reviewer.

## Findings reproduced and fixed by the owner

### O1 — P1 — an activity write could resurrect a revoked bearer token

- Location before the fix: `server/mio_server/auth.py:141-146` and the generic upsert in
  `server/mio_server/storage.py:540-550`; revocation deletes the document in
  `server/mio_server/api/access.py:54-56`.
- Reproduction: pause verification after loading a live token and immediately before the
  first `last_used_at` write. Revoke the token through the local API, then release the
  verifier. Its generic `put_doc` upsert recreated the deleted token. A subsequent real
  `/api/v2/series` call with the old bearer returned 200 instead of 401.
- Impact: any scope carried by the revoked token could become usable again; this was not
  limited to completion of the already in-flight request.
- Owner fix: verification now calls `touch_api_token`, which conditionally updates only
  an existing document with the same token id and secret hash (`storage.py:562-572`).
  No upsert occurs. The regression delays that activity-update boundary and confirms
  the old bearer remains rejected after revocation.
- Verification: the deterministic race first failed with HTTP 200, then passed with
  HTTP 401 after the production fix.

### O2 — P2 — malformed bundle metadata returned an unhandled HTTP 500

- Location before the fix: `server/mio_server/bundle.py:118-121` assumed a JSON object
  manifest and called `.get`; `series.json` was also read without a missing-member guard.
- Reproduction: upload a small valid ZIP containing `manifest.json=[]`; the local API
  returned plain-text HTTP 500. After the initial shape fix, a valid format/version
  manifest without `series.json` still returned 500.
- Impact: malformed client input escaped the normal JSON error contract; callers could
  not distinguish a corrupt archive from an internal server failure.
- Owner fix: require an object manifest and an exact supported positive integer version;
  require `series.json` before asset writes; map missing/corrupt ZIP member reads to
  `BundleError` (`bundle.py:111-138`). Existing database transaction rollback remains.
- Verification: seven metadata subcases cover list/null manifests, null/list/bool/zero
  versions, and a missing `series.json`. They now return JSON 400/422 and leave the
  isolated series store empty.

## Other boundaries checked

- The sandbox broker selects only an exact reviewed operation template, rejects undeclared
  requests, cross-extension targets and recursion, encodes individual path segments, and
  rejects collisions with other typed operations. It forwards only the caller's bearer,
  so target read/write/render/admin checks run again; no host credential is added.
- Direct extension routes require the current enabled activation and matching reviewed
  digest. Private settings identifiers use the shared owner/path contract; invalid names
  cannot become filesystem traversal paths.
- Existing token list/revoke/authentication checks continue to reject anonymous or
  insufficient-scope callers and omit stored secret hashes.

## Validation and remaining limits

- New `test_other_api_review.py`: 2 tests passed (the malformed-bundle test has 7 subcases).
- Existing panel broker: 6 tests passed.
- Existing extension private-data tests: 6 tests passed.
- Existing token/scope API case: 1 test passed.
- No additional current P0-P2 issue was established within this scoped pass after the
  two owner fixes. This does not claim the whole repository is bug-free, certify external
  services or replace the owner's final integration checks.
