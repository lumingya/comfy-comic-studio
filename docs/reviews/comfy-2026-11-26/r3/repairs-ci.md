# R3 repair commit: remote CI verification

**Result: VERIFIED CI SUCCESS for fixed repair commit `eb876cfbb8cf14de34a99b6544469460c11acc24`.**

This covers two fixed GitHub Actions runs only. It is not a new Wave4 independent review and does not approve overall functional correctness, subsequent commits, cleanup or final repository state. Interrupted local gates are not counted as passes.

## Observation and checkout identity

Both runs were observed with `gh run watch --interval 120 --exit-status`; both watchers exited 0. Completed metadata, every job and step result, complete logs, and workflow contents at the actual checkout refs were obtained through read-only `gh` commands. No local tests, builds, browser actions, product edits, Git worktree operations, CI reruns or CI cancellations were performed in this observation task.

| Run | Event | Actual checkout in all three jobs | Terminal result |
| --- | --- | --- | --- |
| 45662331378 | push | `eb876cfbb8cf14de34a99b6544469460c11acc24` | success |
| 45662342855 | pull_request | `030430d706b4af97d893b362daf1a10d0a176ccd` | success |

Both API head SHAs are `eb876cfbb8cf14de34a99b6544469460c11acc24`. The PR checkout is GitHub's merge commit. Its parents, independently confirmed through the commit API, are `d9cfa801c42f19db29788ea044d31eaf1c50c221` and the fixed repair commit. Its larger suite totals are preserved separately because it includes the then-current base.

Final API updates were November 25, 2026 at 17:41:28Z (push) and 17:42:30Z (PR), which are November 26 in Asia/Shanghai. All timestamps in the JSON companion are UTC.

## Six completed jobs

| Event | Job | Actual runtime | Full server suite | Additional results | Job result |
| --- | --- | --- | --- | --- | --- |
| push | gate | 3.13.18, Node v20.20.2 | 1764, OK (skipped=3) | next 80; web 118 files / 964 tests; assistant 2 files / 34 tests | success |
| push | launchers (windows-latest, Python 3.11) | 3.11.9 | 1764, OK | launcher suite 31, OK | success |
| push | launchers (ubuntu-latest, Python 3.11) | 3.11.18 | 1764, OK (skipped=3) | launcher suite 31, OK | success |
| pull_request | launchers (ubuntu-latest, Python 3.11) | 3.11.18 | 1875, OK (skipped=3) | launcher suite 31, OK | success |
| pull_request | gate | 3.13.18, Node v20.20.2 | 1875, OK (skipped=3) | next 80; web 129 files / 1067 tests; assistant 2 files / 34 tests | success |
| pull_request | launchers (windows-latest, Python 3.11) | 3.11.9 | 1875, OK | launcher suite 31, OK | success |

Every API-reported step concluded `success`. All four launcher jobs explicitly log `MIO_LAUNCHER_FULL: 1` and `PY_PYTHON3: 3.11`. Native-launcher execution cases, including the awkward-folder check and bootstrap-failure handling, end in `ok` on Windows and Ubuntu in both runs. The 31-test launcher suite is followed by full server discovery.

## Required gate coverage

The JSON companion records each logged command, job ID, step and timestamp in both runs. Workflow source at each actual checkout has no `continue-on-error`.

- Backend: full `python -m unittest discover -s server/tests -t server -q` in gate and both launcher jobs; counts above.
- Ruff: `ruff check server extensions` and `ruff format --check server extensions`, plus the corresponding `clients tools` checks. Together they cover the required server, clients and tools scopes, with successful steps and clean Ruff summaries.
- Python client consistency: `python clients/python/generate.py --check` completed in the successful client/tool step.
- Spike: full `next/tests` discovery ran 80 tests, OK in each gate.
- Distribution: `python tools/check_distribution.py` verified 64 files and `python tools/build_distribution.py --check` confirmed the manifest in both runs.
- Web: API generation, clean generated-type diff, format check, strict typecheck, test suite and production build all completed in successful steps. The command log explicitly includes every AGENTS-required web command.

Additional successful CI gates were extension contract generation, extension example and panel checks, documentation link self-test and check, extension/example/bootstrap Ruff checks, standalone assistant formatting/tests/build with a clean generated-dist diff, and release-package smoke build.

Gate timeout is 30 minutes in both workflow refs. Launcher timeout is 30 minutes in the branch workflow and 60 minutes in the PR merge workflow.

## Limits and evidence hygiene

GitHub displayed Node 20 action-runtime deprecation warnings. The separately logged application Node runtime was v20.20.2. Release smoke warned that its manifest was unsigned; this verifies package construction, not a signed production release.

Publishable files are `report.md` and `ci-verified.json`. They contain public run/commit/job identifiers, neutral commands, step metadata and test summaries. They contain no local absolute paths, downloaded samples, original author text, model names, credentials or raw environments.

Complete logs are retained temporarily as `raw-ci-45662331378.log` and `raw-ci-45662342855.log` in the designated observation directory. Raw logs contain runner paths and must not be committed with the sanitized files. Cleanup and final Git cleanliness/push state were outside this task and are not asserted.
