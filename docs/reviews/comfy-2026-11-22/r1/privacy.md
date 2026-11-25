# Wave 4 audit 5: Privacy, repository hygiene, and CI

Verdict: **VERIFIED PASS for the audited source and CI.** No Blocker, High, Medium, or Low source findings. Final task completion still requires the coordinator's cleanup and documentation closeout listed below; this report does not claim those actions have already happened.

## Scope and fixed revisions

- Read the supplied original task, repository AGENTS.md, README.md, relevant ROADMAP.md principles, compatibility report, and pending truth documentation.
- Independent, read-only audit of `38838ab43cf3d056951f2fc6c52afb737d34e3c6...71457f6f8599a8595c500a5b8da904dcc7565d93`, its six commits, and pending acceptance documents.
- Reviewed 35 changed tracked paths across all six commits; no extra paths appeared only in intermediate commits. The current tracked diff plus pending documents contains 37 distinct text files.
- Reviewed the new upload decoder and HTTP operation, public API authentication/scope path, generated API/client changes, and synthetic regression fixture strings.
- No product source changes, repository edits, commits, or deletions were made by this audit. Audit output is confined to the designated directory outside the repository.

## Standards findings

| Severity | Count | Result |
|---|---:|---|
| Blocker | 0 | None |
| High | 0 | None |
| Medium | 0 | None |
| Low | 0 | None |

The task branch has exactly the expected pending report modification and two new truth documents. Ignored non-dependency/build artifacts are absent. No downloaded workflow/image, temporary script, browser profile, credential, embedded image data URI, or private machine path was found in task changes or pending documentation. Pattern checks covered current contents and added lines in all six task commits; no sensitive values were printed.

The original checkout was queried read-only and never modified by this audit. Unrelated user work and other worktrees are outside the audit's cleanup authority.

## Spec findings

| Severity | Count | Result |
|---|---:|---|
| Blocker | 0 | None |
| High | 0 | None |
| Medium | 0 | None |
| Low | 0 | None |

Permanent tests use short neutral strings, synthetic model/image names, and generated 2-by-2 image containers. New fixture literals contain no author prompt text or private model paths. The source-derived matrix has 75 public source URLs and the truth file contains public upstream/source URLs, measurements, node/field pointers, policy explanations, and assertions. Both contain zero executable workflow-node objects and no non-URL image/model filenames. The truth file pins the actual audited HEAD and states its 21-sample/105-parameter scope without claiming GPU execution or universal plugin compatibility.

## Upload and API evidence

- `workflow_import.py` bounds file bytes at 64 MiB, combined metadata at 8 MiB, image dimensions at 100 million pixels, and graph nodes at 20,000. Compressed metadata uses bounded inflation; truncated input, duplicate metadata, corrupt relevant PNG CRCs, and malformed metadata receive fixed actionable errors.
- JSON decoding rejects NaN, Infinity, and overflowing exponent values. Direct request configuration/overrides and graphs also undergo finite-number validation before inference/compilation. Malformed literal values are not echoed in the relevant error responses.
- The decoder does not decode pixels, execute workflow nodes, contact ComfyUI, or persist uploaded images. The default endpoint's no-network/no-persistence contract is covered by the import-media tests.
- The new `/api/v2/workflows/inspect-file` route inherits the standard token guard and `write` scope, matching the existing workflow inspection operation. Its OpenAPI entry declares bearer authentication and binary input. Anonymous access rejection and authenticated operation are covered by tests. No scope or authentication code was changed.
- Frontend generated types, the OpenAPI v2 snapshot, and both generated Python clients contain the matching operation. The local generated-client check and CI generated-type regeneration/diff check pass.

## Authoritative CI evidence

Run: https://github.com/lumingya/comfy-comic-studio/actions/runs/44923800420

The run head SHA is exactly `71457f6f8599a8595c500a5b8da904dcc7565d93`. All three jobs and every required step completed successfully. This audit read actual job logs in addition to the run status, filtering out checkout/authentication material.

| Job | Actual log evidence |
|---|---|
| gate, Ubuntu, Python 3.13 / Node 20 | Backend: 1,680 tests, OK, 3 skipped; Spike: 80 tests, OK; frontend: 115 files / 952 tests passed; assistant extension: 2 files / 34 tests passed; extension panel checks, lint, format, types, generation checks, builds, shipped-data checks, and release smoke succeeded |
| launchers, Ubuntu, Python 3.11 | Launcher suite: 31 tests, OK; backend: 1,680 tests, OK, 3 skipped |
| launchers, Windows, Python 3.11 | Launcher suite: 31 tests, OK; backend: 1,680 tests, OK, no skips reported |

Commands confirmed in the passing gate job:

```text
python -m unittest discover -s next/tests -t next -q
ruff check server extensions
ruff format --check server extensions
python -m unittest discover -s server/tests -t server -q
python tools/generate_extension_contracts.py --check
python clients/python/generate.py --check
python tools/check_extension_examples.py
python tools/check_doc_links.py --self-test
python tools/check_doc_links.py
ruff check --config server/pyproject.toml examples/extensions/comfy-complex-adapters examples/extensions/standard-image-channels examples/extensions/qa-review/cli.py
ruff format --check --config server/pyproject.toml examples/extensions/comfy-complex-adapters examples/extensions/standard-image-channels examples/extensions/qa-review/cli.py
ruff check clients tools
ruff format --check clients tools
ruff check --config server/pyproject.toml mio_update_bootstrap.py
ruff format --check --config server/pyproject.toml mio_update_bootstrap.py
npm ci --prefix web --no-audit --no-fund
npm --prefix web run gen:api
git diff --exit-code -- web/src/api/schema.d.ts web/src/api/extensionProtocol.ts
npm --prefix web run format:check
npm --prefix web run typecheck
npm --prefix web test
python tools/check_extension_examples.py --panel-tests
npm --prefix web run build
python tools/check_distribution.py
python tools/build_distribution.py --check
```

In `extensions/ai-assist/page`, `npm ci --no-audit --no-fund`, `npx prettier --check .`, `npm test`, `npm run build`, and `git diff --exit-code -- dist` passed. `python tools/build_release.py --out "$RUNNER_TEMP/mio-release-smoke"` passed. The unsigned smoke artifact warning is expected for a CI build without a release key and does not assert installation approval.

Both Python 3.11 platform jobs confirmed `MIO_LAUNCHER_FULL=1` launcher execution with `python -m unittest tests.test_launchers -v` from `server/`, followed by the full backend discovery command above. These are real clean-start launcher runs, not merely syntax checks.

## Narrow local verification

```text
python clients/python/generate.py --check
    clients up to date; exit 0
git diff --check
    exit 0
cd server
python -m unittest tests.test_workflow_import_media -q
    20 tests; OK; exit 0
```

Additional read-only structured checks confirmed the current API scopes, sanitized document structures, fixture strings, all task commit paths, and absence of credential/private-path patterns. The full backend was not rerun locally because exact-HEAD cross-platform CI is the authoritative full-suite evidence.

## Coordinator closeout still required

1. Finish the other four independent audit roles and resolve any findings from them.
2. Finish the sanitized report/truth documentation and commit/push those intended files, then require clean task-worktree status. Current pending documentation has passed this audit's content and whitespace checks; it is not yet included in the cited CI SHA.
3. After all audits release their samples, stop task-owned temporary services if present and remove the task's entire hunt directory under the system temporary directory, including downloaded originals/images, working copies, probes, temporary databases, and audit output after retaining the desired sanitized findings.
4. Preserve unrelated user changes and all unrelated temporary directories/worktrees.

The designated hunt root resolves directly below the system temporary directory, outside the repository, with no reparse points beneath it. No browser secret/profile filenames were found there; a focused check of 182 relevant temporary text files found no literal credential/header values. The live corpus was deliberately retained for the other audits. Its pending cleanup is a coordinated final action, not an implementation defect.

Standards: 0 findings. Spec within this privacy/hygiene/CI remit: 0 findings. **VERIFIED PASS** applies to the source and evidence above; final completion depends on the explicit coordinator closeout actions.
