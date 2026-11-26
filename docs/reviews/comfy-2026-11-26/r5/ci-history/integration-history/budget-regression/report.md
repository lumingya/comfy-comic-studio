# Fixed-HEAD remote CI evidence

**Result: FAILED. Both fixed runs are terminal; this round is not accepted as all green.**

Head: `6e302081e650210202b232990ab05bbd6961e149`. Evidence was obtained using read-only GitHub metadata and completed job logs. No local product import, test, build, service, browser, source edit, workflow edit, rerun, or push was performed by this observer.

## Run identity and actual checkout

| Event | Run | Conclusion | Actual checkout in every job |
|---|---:|---|---|
| push | [45764508808](https://github.com/lumingya/comfy-comic-studio/actions/runs/45764508808) | failure | `6e302081e650210202b232990ab05bbd6961e149` |
| pull_request | [45764513053](https://github.com/lumingya/comfy-comic-studio/actions/runs/45764513053) | failure | `f8f2bf71d2541e57bb3d37471f720b20323585aa` |

Both API head values equal the fixed head. The PR jobs actually checked out merge `f8f2bf71d2541e57bb3d37471f720b20323585aa`. Its remote commit parents are `196660f19041802ae8e3b271ac6260b719e94e29`, `6e302081e650210202b232990ab05bbd6961e149`. This separates the PR API head from the actual merge checkout.

## Jobs and every reported step

### push run 45764508808

**launchers (windows-latest, Python 3.11)** — job `139722065903`, `failure`. Checkout `6e302081e650210202b232990ab05bbd6961e149`. Started 2026-11-26T05:53:32Z; completed 2026-11-26T06:20:58Z.

| Step | Name | Status / conclusion |
|---:|---|---|
| 1 | Set up job | completed / success |
| 2 | Run actions/checkout@v4 | completed / success |
| 3 | Run actions/setup-python@v5 | completed / success |
| 4 | Install server dependencies | completed / success |
| 5 | Launchers (static, bootstrap, real start.bat / start.sh from scratch) | completed / success |
| 6 | v4 server unit tests | completed / failure |
| 11 | Post Run actions/setup-python@v5 | completed / skipped |
| 12 | Post Run actions/checkout@v4 | completed / success |
| 13 | Complete job | completed / success |

Actual logged command sequence:

- `python -m pip install -r server/requirements-dev.txt` (private log line 109)
- `python -m unittest tests.test_launchers -v` (private log line 197)
- `python -m unittest discover -s server/tests -t server -q` (private log line 245)

Actual test summaries:

- 31 tests in 42.246s; `OK` (private log line 241).
- 1822 tests in 1569.373s; `FAILED (failures=1, errors=1)` (private log line 502).

- ERROR: `tests.test_cloud_channel_packages.ChannelPackageTests.test_poll_get_faults_retry_with_a_finite_budget_and_one_post`
  - Terminal result: `mio_server.llm.LLMError: Image request deadline exceeded; submitted work was not repeated`.
  - Trace sites: `test_cloud_channel_packages.py:332` -> `channels.py:43` -> `channels.py:70` -> `channels.py:373` -> `transport.py:286`.

- FAIL: `tests.test_cloud_channel_packages.ChannelPackageTests.test_post_fault_matrix_never_repeats_or_echoes_credentials`
  - Terminal result: `AssertionError: True != False`.
  - Assertion: `self.assertEqual(caught.exception.sent, sent)`.
  - Trace sites: `test_cloud_channel_packages.py:221`.

Raw evidence remains private as `job-139722065903.log`; SHA-256 `441f3a5c0d5dc2d78246202196c2fff8f6001f280c2b8febb4ea2d4c45fb4236`.

**gate** — job `139722066175`, `failure`. Checkout `6e302081e650210202b232990ab05bbd6961e149`. Started 2026-11-26T05:53:32Z; completed 2026-11-26T06:10:58Z.

| Step | Name | Status / conclusion |
|---:|---|---|
| 1 | Set up job | completed / success |
| 2 | Run actions/checkout@v4 | completed / success |
| 3 | Run actions/setup-python@v5 | completed / success |
| 4 | Run actions/setup-node@v4 | completed / success |
| 5 | Install Python dependencies | completed / success |
| 6 | Spike unit tests (next/) | completed / success |
| 7 | v4 server (lint + unit tests) | completed / failure |
| 8 | API v2 clients and release tools (generated client current + lint) | completed / skipped |
| 9 | v4 web (API types current + format + typecheck + tests + build) | completed / skipped |
| 10 | Preserve built web for isolated browser verification | completed / skipped |
| 11 | Shipped data manifest | completed / skipped |
| 12 | Standalone assistant extension | completed / skipped |
| 13 | v4 release package smoke test | completed / skipped |
| 24 | Post Run actions/setup-node@v4 | completed / skipped |
| 25 | Post Run actions/setup-python@v5 | completed / skipped |
| 26 | Post Run actions/checkout@v4 | completed / success |
| 27 | Complete job | completed / success |

Actual logged command sequence:

- `python -m pip install -r server/requirements-dev.txt` (private log line 150)
- `python -m unittest discover -s next/tests -t next -q` (private log line 244)
- `ruff check server extensions` (private log line 259)
- `ruff format --check server extensions` (private log line 260)
- `python -m unittest discover -s server/tests -t server -q` (private log line 261)

Actual test summaries:

- 80 tests in 19.547s; `OK` (private log line 255).
- 1822 tests in 1008.148s; `FAILED (failures=1, errors=1, skipped=3)` (private log line 548).

- ERROR: `tests.test_cloud_channel_packages.ChannelPackageTests.test_poll_get_faults_retry_with_a_finite_budget_and_one_post`
  - Terminal result: `mio_server.llm.LLMError: Image request deadline exceeded; submitted work was not repeated`.
  - Trace sites: `test_cloud_channel_packages.py:332` -> `channels.py:43` -> `channels.py:70` -> `channels.py:373` -> `transport.py:286`.

- FAIL: `tests.test_cloud_channel_packages.ChannelPackageTests.test_post_fault_matrix_never_repeats_or_echoes_credentials`
  - Terminal result: `AssertionError: True != False`.
  - Assertion: `self.assertEqual(caught.exception.sent, sent)`.
  - Trace sites: `test_cloud_channel_packages.py:221`.

Raw evidence remains private as `job-139722066175.log`; SHA-256 `eadb9356784c13238157d6217ff642cf95a3b4905e872c17bb9b8319f0b92606`.

**launchers (ubuntu-latest, Python 3.11)** — job `139722066192`, `failure`. Checkout `6e302081e650210202b232990ab05bbd6961e149`. Started 2026-11-26T05:53:32Z; completed 2026-11-26T06:07:58Z.

| Step | Name | Status / conclusion |
|---:|---|---|
| 1 | Set up job | completed / success |
| 2 | Run actions/checkout@v4 | completed / success |
| 3 | Run actions/setup-python@v5 | completed / success |
| 4 | Install server dependencies | completed / success |
| 5 | Launchers (static, bootstrap, real start.bat / start.sh from scratch) | completed / success |
| 6 | v4 server unit tests | completed / failure |
| 11 | Post Run actions/setup-python@v5 | completed / skipped |
| 12 | Post Run actions/checkout@v4 | completed / success |
| 13 | Complete job | completed / success |

Actual logged command sequence:

- `python -m pip install -r server/requirements-dev.txt` (private log line 122)
- `python -m unittest tests.test_launchers -v` (private log line 216)
- `python -m unittest discover -s server/tests -t server -q` (private log line 265)

Actual test summaries:

- 31 tests in 18.223s; `OK` (private log line 261).
- 1822 tests in 830.769s; `FAILED (failures=1, errors=1, skipped=3)` (private log line 516).

- ERROR: `tests.test_cloud_channel_packages.ChannelPackageTests.test_poll_get_faults_retry_with_a_finite_budget_and_one_post`
  - Terminal result: `mio_server.llm.LLMError: Image request deadline exceeded; submitted work was not repeated`.
  - Trace sites: `test_cloud_channel_packages.py:332` -> `channels.py:43` -> `channels.py:70` -> `channels.py:373` -> `transport.py:286`.

- FAIL: `tests.test_cloud_channel_packages.ChannelPackageTests.test_post_fault_matrix_never_repeats_or_echoes_credentials`
  - Terminal result: `AssertionError: True != False`.
  - Assertion: `self.assertEqual(caught.exception.sent, sent)`.
  - Trace sites: `test_cloud_channel_packages.py:221`.

Raw evidence remains private as `job-139722066192.log`; SHA-256 `e6b090211291d101ec62532375a8a6a910f4bdbfa95683c63c18b915cf55fc04`.

### pull_request run 45764513053

**launchers (windows-latest, Python 3.11)** — job `139722081023`, `failure`. Checkout `f8f2bf71d2541e57bb3d37471f720b20323585aa`. Started 2026-11-26T05:53:35Z; completed 2026-11-26T06:25:16Z.

| Step | Name | Status / conclusion |
|---:|---|---|
| 1 | Set up job | completed / success |
| 2 | Run actions/checkout@v4 | completed / success |
| 3 | Run actions/setup-python@v5 | completed / success |
| 4 | Install server dependencies | completed / success |
| 5 | Launchers (static, bootstrap, real start.bat / start.sh from scratch) | completed / success |
| 6 | v4 server unit tests | completed / failure |
| 11 | Post Run actions/setup-python@v5 | completed / skipped |
| 12 | Post Run actions/checkout@v4 | completed / success |
| 13 | Complete job | completed / success |

Actual logged command sequence:

- `python -m pip install -r server/requirements-dev.txt` (private log line 125)
- `python -m unittest tests.test_launchers -v` (private log line 213)
- `python -m unittest discover -s server/tests -t server -q` (private log line 261)

Actual test summaries:

- 31 tests in 42.423s; `OK` (private log line 257).
- 1952 tests in 1823.257s; `FAILED (failures=1, errors=1)` (private log line 519).

- ERROR: `tests.test_cloud_channel_packages.ChannelPackageTests.test_poll_get_faults_retry_with_a_finite_budget_and_one_post`
  - Terminal result: `mio_server.llm.LLMError: Image request deadline exceeded; submitted work was not repeated`.
  - Trace sites: `test_cloud_channel_packages.py:332` -> `channels.py:43` -> `channels.py:70` -> `channels.py:373` -> `transport.py:286`.

- FAIL: `tests.test_cloud_channel_packages.ChannelPackageTests.test_post_fault_matrix_never_repeats_or_echoes_credentials`
  - Terminal result: `AssertionError: True != False`.
  - Assertion: `self.assertEqual(caught.exception.sent, sent)`.
  - Trace sites: `test_cloud_channel_packages.py:221`.

Raw evidence remains private as `job-139722081023.log`; SHA-256 `097d85f911e7a760104b54da4a9d09f18ba5892afe6e0d83f091f20c91246183`.

**gate** — job `139722081248`, `failure`. Checkout `f8f2bf71d2541e57bb3d37471f720b20323585aa`. Started 2026-11-26T05:53:35Z; completed 2026-11-26T06:08:06Z.

| Step | Name | Status / conclusion |
|---:|---|---|
| 1 | Set up job | completed / success |
| 2 | Run actions/checkout@v4 | completed / success |
| 3 | Run actions/setup-python@v5 | completed / success |
| 4 | Run actions/setup-node@v4 | completed / success |
| 5 | Install Python dependencies | completed / success |
| 6 | Spike unit tests (next/) | completed / success |
| 7 | v4 server (lint + unit tests) | completed / failure |
| 8 | API v2 clients and release tools (generated client current + lint) | completed / skipped |
| 9 | v4 web (API types current + format + typecheck + tests + build) | completed / skipped |
| 10 | Preserve built web for isolated browser verification | completed / skipped |
| 11 | Shipped data manifest | completed / skipped |
| 12 | Standalone assistant extension | completed / skipped |
| 13 | v4 release package smoke test | completed / skipped |
| 24 | Post Run actions/setup-node@v4 | completed / skipped |
| 25 | Post Run actions/setup-python@v5 | completed / skipped |
| 26 | Post Run actions/checkout@v4 | completed / success |
| 27 | Complete job | completed / success |

Actual logged command sequence:

- `python -m pip install -r server/requirements-dev.txt` (private log line 166)
- `python -m unittest discover -s next/tests -t next -q` (private log line 260)
- `ruff check server extensions` (private log line 275)
- `ruff format --check server extensions` (private log line 276)
- `python -m unittest discover -s server/tests -t server -q` (private log line 277)

Actual test summaries:

- 80 tests in 18.685s; `OK` (private log line 271).
- 1952 tests in 826.608s; `FAILED (failures=1, errors=1, skipped=3)` (private log line 564).

- ERROR: `tests.test_cloud_channel_packages.ChannelPackageTests.test_poll_get_faults_retry_with_a_finite_budget_and_one_post`
  - Terminal result: `mio_server.llm.LLMError: Image request deadline exceeded; submitted work was not repeated`.
  - Trace sites: `test_cloud_channel_packages.py:332` -> `channels.py:43` -> `channels.py:70` -> `channels.py:373` -> `transport.py:286`.

- FAIL: `tests.test_cloud_channel_packages.ChannelPackageTests.test_post_fault_matrix_never_repeats_or_echoes_credentials`
  - Terminal result: `AssertionError: True != False`.
  - Assertion: `self.assertEqual(caught.exception.sent, sent)`.
  - Trace sites: `test_cloud_channel_packages.py:221`.

Raw evidence remains private as `job-139722081248.log`; SHA-256 `e6cb408bd9cbb2197e943f5b3c84bedd58e39ecddd1cff4afb6955ac8747d071`.

**launchers (ubuntu-latest, Python 3.11)** — job `139722081410`, `failure`. Checkout `f8f2bf71d2541e57bb3d37471f720b20323585aa`. Started 2026-11-26T05:53:35Z; completed 2026-11-26T06:08:43Z.

| Step | Name | Status / conclusion |
|---:|---|---|
| 1 | Set up job | completed / success |
| 2 | Run actions/checkout@v4 | completed / success |
| 3 | Run actions/setup-python@v5 | completed / success |
| 4 | Install server dependencies | completed / success |
| 5 | Launchers (static, bootstrap, real start.bat / start.sh from scratch) | completed / success |
| 6 | v4 server unit tests | completed / failure |
| 11 | Post Run actions/setup-python@v5 | completed / skipped |
| 12 | Post Run actions/checkout@v4 | completed / success |
| 13 | Complete job | completed / success |

Actual logged command sequence:

- `python -m pip install -r server/requirements-dev.txt` (private log line 138)
- `python -m unittest tests.test_launchers -v` (private log line 232)
- `python -m unittest discover -s server/tests -t server -q` (private log line 281)

Actual test summaries:

- 31 tests in 18.350s; `OK` (private log line 277).
- 1952 tests in 866.717s; `FAILED (failures=1, errors=1, skipped=3)` (private log line 534).

- ERROR: `tests.test_cloud_channel_packages.ChannelPackageTests.test_poll_get_faults_retry_with_a_finite_budget_and_one_post`
  - Terminal result: `mio_server.llm.LLMError: Image request deadline exceeded; submitted work was not repeated`.
  - Trace sites: `test_cloud_channel_packages.py:332` -> `channels.py:43` -> `channels.py:70` -> `channels.py:373` -> `transport.py:286`.

- FAIL: `tests.test_cloud_channel_packages.ChannelPackageTests.test_post_fault_matrix_never_repeats_or_echoes_credentials`
  - Terminal result: `AssertionError: True != False`.
  - Assertion: `self.assertEqual(caught.exception.sent, sent)`.
  - Trace sites: `test_cloud_channel_packages.py:221`.

Raw evidence remains private as `job-139722081410.log`; SHA-256 `bebaa5366abfe0552d9e1f6e76dcd6f48110fc3c1740dd92b15f33e719c0927a`.

## Required gates: actual coverage

| Gate | Actual result in this round |
|---|---|
| Backend unit suite (`python -m unittest discover -s server/tests -t server -q`) | executed_failed |
| Python lint and format across server, clients, tools (`ruff check server clients tools && ruff format --check server clients tools`) | partial_only_server_and_extensions_executed_successfully; clients_and_tools_skipped |
| Generated API v2 client current (`python clients/python/generate.py --check`) | skipped_after_backend_failure |
| Spike unit suite (`python -m unittest discover -s next/tests -t next -q`) | executed_success_in_both_gate_jobs |
| Shipped distribution manifest (`python tools/check_distribution.py`) | skipped_after_backend_failure |
| Web formatting (`npm --prefix web run format:check`) | skipped_after_backend_failure |
| Web typecheck (`npm --prefix web run typecheck`) | skipped_after_backend_failure |
| Web unit tests (`npm --prefix web test`) | skipped_after_backend_failure |
| Web production build (`npm --prefix web run build`) | skipped_after_backend_failure |
| Regenerated web API types (`npm --prefix web run gen:api`) | skipped_after_backend_failure |

The additional contract/example/document checks, client/tool lint, web artifact upload, shipped-data build check, standalone extension checks/build, and release smoke step were skipped after the backend failure. There is no web artifact for either fixed run. Launcher suite results are recorded per job above. The two failing methods have no separately logged elapsed time or remaining deadline; the durations above are suite totals.

The PR checkout workflow gives launcher jobs a 60-minute bound; the pushed-head workflow gives them 30 minutes. Both gate jobs have 30-minute bounds. Runtime alone was not treated as a hang or failure.

Only `report.md` and `ci-verified.json` are intended for publication. Raw logs and collection utilities remain external private evidence. Neither publication contains original test text, graph payloads, model filenames, local user paths, or credentials.
