# Final R3 repair HEAD: remote CI evidence

**Result: VERIFIED CI SUCCESS for `3e994bb80794dea7be9773f5cb9c47119bf34c27`.**

This is a verification of two completed CI runs, not a new independent final review. No older run substitutes for this HEAD. It makes no claim about later commits, overall functional review approval, final cleanup, or final repository cleanliness/push state.

## Fixed run and checkout identity

| Run | Event | API head SHA | Actual checkout in every job | Terminal result |
| --- | --- | --- | --- | --- |
| 45670345960 | push | `3e994bb80794dea7be9773f5cb9c47119bf34c27` | `3e994bb80794dea7be9773f5cb9c47119bf34c27` | success |
| 45670360530 | pull_request | `3e994bb80794dea7be9773f5cb9c47119bf34c27` | `e9f72beb7c7fd99875e7d19728673d2928485b16` | success |

The PR merge commit's parents were independently read through the commit API: `d9cfa801c42f19db29788ea044d31eaf1c50c221` and `3e994bb80794dea7be9773f5cb9c47119bf34c27`. Its larger test totals include the then-current base and are preserved separately.

Run metadata final updates were November 25, 2026, 18:24:16Z for push and 18:22:43Z for PR (November 26 in Asia/Shanghai). Evidence timestamps are UTC.

## Six jobs and all required gates

All **6 jobs and 68 API-reported steps** completed with `success`. There were **0 skipped jobs and 0 skipped steps**. Linux server suites explicitly report three skipped test cases; Windows server suites report none. Those case-level skips are not hidden or described as skipped CI gates.

| Event | Job | Actual runtime | Full server discovery | Additional results | Job result |
| --- | --- | --- | --- | --- | --- |
| push | launchers (windows-latest, Python 3.11) | 3.11.9 | 1769, OK | full launcher 31, OK | success |
| push | gate | 3.13.18, Node v20.20.2 | 1769, OK (skipped=3) | next 80; web 118/964; assistant 2/34; data 64 | success |
| push | launchers (ubuntu-latest, Python 3.11) | 3.11.18 | 1769, OK (skipped=3) | full launcher 31, OK | success |
| pull_request | launchers (ubuntu-latest, Python 3.11) | 3.11.18 | 1880, OK (skipped=3) | full launcher 31, OK | success |
| pull_request | launchers (windows-latest, Python 3.11) | 3.11.9 | 1880, OK | full launcher 31, OK | success |
| pull_request | gate | 3.13.18, Node v20.20.2 | 1880, OK (skipped=3) | next 80; web 129/1067; assistant 2/34; data 64 | success |

Web and assistant numbers above are files/tests. All reported Vitest tests passed. Each Linux/Windows launcher job logs `MIO_LAUNCHER_FULL: 1` and `PY_PYTHON3: 3.11`, runs 31 launcher tests with no skips, and then runs full server discovery. The actual awkward-folder launcher check and bootstrap-failure execution cases both end in `ok` in all four jobs.

Every required AGENTS command is present in the actual logs for both runs, with the successful API step recorded in the JSON companion:

- Full backend and next unit-test discovery.
- Ruff lint and format checks covering server, clients and tools. CI uses the server/extensions command and the clients/tools command to cover the required scopes.
- `python clients/python/generate.py --check`.
- Shipped data verification and manifest check: 64 release files. Separate backend fixture output about two files is not used as the release-data gate.
- Web API generation, clean generated schema/protocol diff, formatting, strict typecheck, tests, and production build.

All additional workflow commands were also matched to actual logged commands: extension contract generation, extension examples and panel tests, documentation link self-test/check, example and bootstrap Ruff checks, assistant formatting/tests/build with clean generated dist, and release package smoke build.

Workflow contents were read at both actual checkout refs. They have no conditional steps and no `continue-on-error`. Gate uses Python 3.13 / Node 20 with a 30-minute timeout. Launchers use Python 3.11 on Ubuntu and Windows; branch timeout is 30 minutes and PR merge timeout is 60 minutes.

## Method and publication limits

Only read-only remote `gh` observation and evidence-file writes were performed. No polling/watch was needed; no local tests, builds, product calls, source/Git changes, CI reruns or cancellations were performed.

The archived `gh run view --log` renderer labelled lines `UNKNOWN STEP`. Step association was therefore verified by exact logged-command matching against each fetched workflow definition; API step names and conclusions were retained independently. Checkout SHA, runtime and test summaries are taken from actual log content, not inferred from the requested HEAD or a green badge.

Publishable files are `report.md` and `ci-verified.json`; they contain neutral commands, public commit/run/job IDs, step conclusions and test summaries. Publication checks exclude local absolute paths, credentials, raw environments, original author text, model names and downloaded private material.

Raw logs are temporary evidence only: `raw-ci-45670345960.log` and `raw-ci-45670360530.log`. They contain runner paths and must not be committed with the sanitized files. Interrupted local gates are not counted as passes.
