# Independent CI evidence audit

Auditor: CrossAudit-5-Privacy-Hygiene-CI / CI evidence delegate.
Scope: remote CI only; no repository files changed.
Conclusion: VERIFIED PASS for CI coverage at the exact frozen product commit. This is not a signature for local tests, repository privacy, final cleanup, final Git status, or later documentation-only commits.

## Proven identity

- Run: [CI 45630099226](https://github.com/lumingya/comfy-comic-studio/actions/runs/45630099226), push event, completed, success.
- `headSha`: `6f9bdf2c56994397754f4ec2c782f1ab63bc75a0`.
- Raw checkout output confirms this SHA independently for Ubuntu launchers (line 106), Windows launchers (606), and gate (1118).
- All 3 jobs and their validation steps report success in `ci-run-45630099226.json`.
- Raw log: 2,487 lines, 412,766 bytes; SHA-256 `727efe9730d1e770e97ab4e4fb2f8c3367bb56fef14da8ab043c47330e20ae6c`.
- Reviewed AGENTS.md and `.github/workflows/ci.yml`, then checked actual logged commands/results. README and ROADMAP were also read for context.

## Coverage

References below are one-based lines in the raw log; `ci-excerpts.txt` retains the relevant payloads with original line numbers. Successful continuation under logged `bash -e` plus step/job success proves silent commands exited successfully; results are not inferred from the workflow file alone.

| Required check | Actual log evidence | Verified result |
| --- | --- | --- |
| Server unit tests | 1271; 1516-1518 | Gate: 1,699 tests in 1036.152s, OK, 3 skipped (1,696 passed). |
| Ruff server check + format | 1269-1270; 1281-1282 | All checks passed; 415 files already formatted across server and extensions. |
| Ruff clients/tools check + format | 1530-1531; 1576-1577 | All checks passed; 32 files already formatted. Combined with server step, this covers AGENTS' `server clients tools` scope. |
| API v2 generated client consistency | 1524; 1544 | `python clients/python/generate.py --check`; clients up to date. |
| Extension generated contracts | 1523; 1543 | Contracts up to date. |
| Spike `next/` unit tests | 1254; 1265-1267 | 80 tests, OK. |
| Web dependencies + API generation + clean generated diff | 1581-1583; 1602-1605 | `npm ci`, `gen:api`, schema generation, generated schema/protocol diff exits clean before later commands. |
| Web formatting | 1584; 1607-1611 | All matched files use Prettier style. |
| Web typecheck | 1585; 1613-1614 | `tsc --noEmit`, success before Vitest starts. |
| Web unit tests | 1586; 2238-2239 | 116 files, 956 tests passed. |
| Offline professional panel checks | 1587; 2243-2281 | 6 offline panel test scripts passed. |
| Web production build | 1588; 2283-2284; 2377 | `tsc --noEmit && vite build`; built in 7.74s. |
| Shipped data check + manifest consistency | 2379-2380; 2390-2391 | 64 release files verified; manifest matches 64 shipped files. |
| Extension/theme package validation | 1525; 1545-1570 | 25 packages checked; 0 invalid. |
| Assistant extension formatting/tests/build/fresh dist | 2393-2397; 2411; 2430-2431; 2436-2437; 2452 | Prettier passed, 2 files/34 tests passed, built in 3.83s, generated dist diff clean. |
| Release package smoke | 2453-2465 | `tools/build_release.py` built `mio-studio-4.0.0.zip`, 5,116,205 bytes, SHA-256 `eacd92579835453ecbd2645b8f42cfe3f87a11c93edc18dbc62259eec1908020`; step success. |
| Ubuntu Python 3.11 launchers | 109; 119; 215-225; 245-246; 261-263 | CPython 3.11.18; MIO_LAUNCHER_FULL=1; 31 tests OK, including actual awkward-folder launcher and bootstrap failure tests. |
| Windows Python 3.11 launchers | 609; 619; 709-718; 738-739; 754-756 | CPython 3.11.9; MIO_LAUNCHER_FULL=1; 31 tests OK, including actual awkward-folder launcher and bootstrap failure tests. |
| Ubuntu Python 3.11 full server suite | 265; 489-491 | 1,699 tests in 1046.140s, OK, 3 skipped (1,696 passed). |
| Windows Python 3.11 full server suite | 758; 987-989 | 1,699 tests in 1693.797s, OK, no skips reported. |
| Additional documentation/example/bootstrap checks | 1526-1533; 1571-1579 | Link checker self-test passed; 0 broken links; example and bootstrap Ruff checks/formats passed. |

Launcher evidence was additionally matched against `server/tests/test_launchers.py` lines 283-351: full mode omits the prepared virtual environment, invokes start.bat on Windows or start.sh elsewhere, verifies `--check`, the database and dependency stamp, then repeats startup. This supports the claimed fresh-environment launcher coverage.

## Findings and limitations

- Blocker: 0. High: 0. Medium: 0. Low: 0 within the CI coverage scope.
- The Linux server totals explicitly include 3 skips. Do not call those runs 1,699 passed; Windows reports all 1,699 without skips.
- The smoke archive is intentionally unsigned because this CI run has no release signing key. The log explicitly says the in-app updater would refuse that unsigned package. This audit verifies packaging smoke, not release signing or publication.
- Existing warnings (Node action runtime deprecation, whatwg-encoding deprecation, Vite chunk-size advisory) are non-fatal and do not remove any required check; this review found no new CI coverage defect.
- No claim is made about the local environment-isolation rerun. Its evidence remains the root agent's responsibility.
- Final temporary-directory cleanup and final clean/pushed worktree have NOT been verified by this delegate.

## Temporary evidence retained for root cleanup

All files written by this delegate are under the external task directory:
`<task-temp>/audits/r2/privacy/`

Files: `ci.md`, `ci-run-45630099226.log`, `ci-run-45630099226.json`, `ci-excerpts.txt`.
No other scripts, raw samples, or repository files were created by this delegate. The parent/root separately downloaded `<task-temp>/ci-45630099226.log`; it was reused as a location check, not deleted or modified here.
