# Generic Python SDK offline acceptance

Owner: `sdk_acceptance`. Scope: generated Python SDK and real FastAPI workshop/deliverable
endpoints, with isolated temporary persistence and the existing fake Comfy executor.

## Evidence

- `server/tests/test_sdk_workshop_flow.py` adds four integration cases. The transport bridge
  forwards the SDK's actual urllib request bytes and headers into FastAPI `TestClient` and
  translates real HTTP errors back into urllib `HTTPError`. It does not stub SDK methods,
  API routes, authentication, job polling, compilation, adoption or exports.
- A complete external workflow discovers catalogs; imports a workflow; creates and reads a
  storyboard and preset; discovers stable LoRA keys; disables a pinned LoRA; creates and
  waits for a two-panel generation task; verifies both compiled strengths are zero and the
  saved workflow is unchanged; checks both panels are adopted; verifies same-key replay
  and changed-request rejection; saves HTML, PDF, ZIP and PNG both synchronously and via
  asynchronous export jobs. Saved bytes are checked for format, HTML metadata and captions,
  and the selected gallery template.
- Additional cases verify SDK 401/403 error decoding before task mutation; incomplete
  episodes cannot create export files; invalid export options do not send requests;
  existing local files are preserved; and a planning failure returns the frozen assembly
  without a job until the caller explicitly retries the same intent and key.
- The real engine is advanced on each job poll because the fixture disables its automatic
  runner. The SDK's actual `wait_job` runs with its own deadline and polling behavior.

## Validation

- First targeted run: three cases passed; the lifecycle test had a test-only `KeyError`
  because it expected the job list's `done` summary in the job detail response. The test
  now checks both actual item records are `complete`, matching the detail API contract.
- Re-ran the affected full lifecycle case: passed, including all eight export combinations.
- Ruff check and formatting: passed for the new test.
- UTF-8 guard and `git diff --check`: passed for owned source and documentation.

No production defect was found in this acceptance slice. This is executable acceptance
evidence, not a substitute for the separately requested adversarial source review. No live
ComfyUI, paid cloud, browser installation, personal data copy or external network was used.
