# Final adversarial security review — 2026-11-20

## Scope and authority

- Reviewer: `adversarial_security_final`, independent from the implementation authors.
- Fixed base: `0c948c5ae850a0f34a695889fd21a77175fabc0a`.
- Reviewed current main through `622e03df2c279bcaabad78dc767209c004e6ba35`, including the staged and unstaged integration, rather than only committed changes.
- Specification: `D:\Tencent Files\tx download\ai_studio_code.txt`; repository standards: `AGENTS.md`, `README.md`, `docs/ROADMAP.md`.
- Production files were read-only during this review. Reproductions used fresh temporary `ApiCase` workspaces, synthetic values and fake services. No personal data, external API, browser installation or real generation was used.

## Standards axis

The explicit privacy rule is material here: credentials must not escape through settings responses, task snapshots or portable artifacts. Findings S2 and S3 below breach that rule. The other findings concern specified error, input and data consistency boundaries. No cosmetic style findings are reported; lint and formatting are owned by the integration gate.

## Spec axis — reproduced findings

### S1 — P2 — v2 drops the precise workflow-format error code

- Location at observation: `server/mio_server/api/v2.py:180`, contrasted with the newly updated `api/__init__.py` handler and `api/library.py`'s `WorkflowFormatError`.
- Reproduction: issue a write token in a temporary FastAPI context, then `POST /api/v2/workflows` with `graph={"nodes":[],"links":[]}`.
- Observed: HTTP 400 and guidance text, but no `code` key. The local API preserves `ui_format`, so the supposedly shared contract differs at the open interface.
- Required change: preserve the optional exception code in both handlers; cover v2 import and patch, not only inspection/local routes.
- Owner response: parent reports this change and a 10-test focused run passing. A fresh independent review should verify the final integrated version.

### S2 — P1 — Cookie and session credentials were copied into public/frozen options

- Location at observation: `pipeline/cloud_request.py:16`, `_without_secrets`; `pipeline/providers.py:126`, `redact_extra_options`.
- Reproduction: construct `ImageChannel.extra_options` containing `headers.Cookie` and `headers.X-Session-Key`, using synthetic values; compare public settings redaction and `channel_options()` output to the source values.
- Observed: both raw fields survived public redaction and frozen options. Thus task/channel snapshots and downstream portable recipes could disclose these authentication values to read clients.
- Required change: use one credential-name policy that includes Cookie/Set-Cookie and session key/id/token/secret variants; retain mask round trips and current-credential rebinding.
- Owner response: parent reports the shared matcher and corresponding settings/freeze/rebind regression are updated. Fresh review pending.

### S3 — P1 — credential-bearing URLs survive ordinary option values

- Location at observation: `pipeline/providers.py:redact_extra_options`, `pipeline/cloud_request.py:_without_secrets`.
- Reproduction: use the ordinary `endpoint` option with an HTTPS URL containing userinfo and an `access_token` query parameter, all synthetic. The encoded JSON is small and accepted by `ImageChannel`.
- Observed: both public redaction and `channel_options()` retained the entire original value. Secret field-name matching does not protect credentials embedded in an otherwise ordinary URL value.
- Required change: reject credential-bearing URL values at the untrusted options boundary while allowing ordinary URLs, or implement a complete scrub/current-secret rebind contract. Protect existing stored settings when exposing them as well. Backup code already recognizes URL credentials, so its policy must agree with request/settings handling.
- Status when this report was written: sent to parent; implementation/fresh verification pending.

### S4 — P2 — a template can retain an automatic external navigation

- Location at observation: `album/document.py:20,68`, plus the template validation/render boundary.
- Reproduction: a minimal valid formatVersion-1 template contains `<meta http-equiv="refresh" content="0; url=https://example.invalid/audit">` in its head and otherwise valid books/frames/image loops.
- Observed: `parse_template()` accepts it and `render_album()` retains the refresh element beside the nonce CSP. A script nonce and `default-src 'none'` do not constitute a top-level navigation restriction.
- Required change: reject automatic refresh at parsed-template and stored-template render boundaries. Match HTML attribute case and entity decoding, rather than one raw spelling. This is necessary for the stated offline, zero external dependency/trusted-runtime-only contract.
- No navigation was executed by the review; the retained executable navigation directive was established by a pure render reproduction.
- Status when this report was written: sent to parent; implementation/fresh verification pending.

### S5 — P2 — small deeply nested JSON produces an HTTP 500

- Location at observation: `pipeline/providers.py:45,190` (`_json_object` and `valid_extra_options`), also shared by adapter metadata validation.
- Reproduction: wrap a scalar in 600 nested `{ "a": ... }` objects. Its encoded size is only 4,205 bytes, below the 32 KiB limit.
- Observed: direct `ImageChannel` validation raises `RecursionError`; a temporary real FastAPI `PATCH /api/settings` returns HTTP 500 with a text/plain response instead of a validation error.
- Required change: bounded depth/iterative traversal before recursive copies and redaction; reject excessive nesting consistently with a 400/422 response. Test both options and adapter schema metadata.
- Status when this report was written: sent to parent; implementation/fresh verification pending.

### S6 — P2 — concurrent independent preset PATCH requests lose data

- Location at observation: `api/workshop.py:187-205`.
- Reproduction: create one preset titled `Original`. Synchronize two calls immediately before `store.update_series`: both handlers have already fetched the same preset. Allow a title PATCH (`Renamed`) to commit first, then an entries-only PATCH to commit.
- Observed: both calls succeed, final entries are present, but final title is `Original`. The second handler replaces the whole preset assembled from its stale read, discarding an unrelated successful edit.
- Required change: fetch the current preset and merge only the requested fields inside the atomic `update_series` closure, or reject stale revisions explicitly. The response must reflect the committed result.
- Status when this report was written: sent to parent; implementation/fresh verification pending.

## Positive evidence and limits

- Exercised 13 new/enhanced route shapes across anonymous/read/write/render/admin: 65 intended scope combinations with expected denial/success boundaries. First 10 route shapes passed all 50 combinations. The last three passed 15 combinations after correcting a test-only empty-storyboard fixture to one panel plus an explicit workflow.
- Routes covered: image-adapter discovery; workflow list and LoRA discovery; storyboard list/detail/create; preset list/detail/create/patch; standby workshop task creation; deliverable status and incomplete export submission.
- Verified by code inspection that auto-start requires write plus render before assembly, and that `hold_operation()` serializes assembly/render planning. Existing receipts/frozen-job lookups precede new submissions on replay.
- Reviewed credential mask restoration, frozen ordinary-value/current-secret merging, descriptor filtering, backup redaction, document shell parsing, nonce insertion and lightbox DOM writes. No additional current scope bypass or executable template script injection was established.
- This is not a full template visual review, live-provider certification, full repository audit or replacement for the parent’s full CI gates. Fresh agents must independently re-review the fixes above and update the final acceptance evidence.
