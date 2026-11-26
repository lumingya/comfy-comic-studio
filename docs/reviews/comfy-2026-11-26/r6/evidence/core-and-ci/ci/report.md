# Fixed-head CI verification

Fixed branch HEAD: `fe914065c7aafb0672bfe10274361f83179ce7f1`. Both exact event runs and all six jobs completed successfully. Final observation: 2026-11-26T08:35:27.733537+00:00.

Read-only CI verification for fixed branch HEAD and its two exact event runs. This is not an R6 final review, cleanup, product-runtime validation, or overall-task completion claim.

## Checkout identity and CI scope

- Branch `codex/static-workflow-compat` was `fe914065c7aafb0672bfe10274361f83179ce7f1` at initial and final metadata collection. Its parent is `6122ccab6aae015d1fb20295db4a66158e8f790f`.

- Push jobs actually checked out `fe914065c7aafb0672bfe10274361f83179ce7f1`.

- PR metadata head is `fe914065c7aafb0672bfe10274361f83179ce7f1`, but all PR jobs actually checked out merge `c59eaf873ce98d0940a08ee70c0a1991475e5139`. Remote merge parents are `6ed78255bca6487ce874946118f26a26ec22c3dc` then `fe914065c7aafb0672bfe10274361f83179ce7f1`. [Remote merge commit](https://github.com/lumingya/comfy-comic-studio/commit/c59eaf873ce98d0940a08ee70c0a1991475e5139).

- Each checkout below is established by the job log command `git log -1 --format=%H` and its next-line SHA, not merely by run or PR head metadata.

- Gate budgets are 30 minutes for both checkouts. Launcher budgets are 30 minutes at branch HEAD and 60 minutes at the merge checkout; the emitted command lists are identical. Different suite totals below reflect different checked-out code.

| Event/run | Job | Checkout | Result | Job seconds | Full backend suite |
|---|---|---|---|---:|---|
| push / 45779838148 | [launchers (ubuntu-latest, Python 3.11)](https://github.com/lumingya/comfy-comic-studio/actions/runs/45779838148/job/139772444799) | `fe914065c7aa` | success | 1268 | 1831 tests, 1228.023s, 3 skips |
| push / 45779838148 | [launchers (windows-latest, Python 3.11)](https://github.com/lumingya/comfy-comic-studio/actions/runs/45779838148/job/139772445054) | `fe914065c7aa` | success | 1492 | 1831 tests, 1402.771s, 0 skips |
| push / 45779838148 | [gate](https://github.com/lumingya/comfy-comic-studio/actions/runs/45779838148/job/139772445202) | `fe914065c7aa` | success | 1169 | 1831 tests, 973.788s, 3 skips |
| pull_request / 45779847204 | [gate](https://github.com/lumingya/comfy-comic-studio/actions/runs/45779847204/job/139772479333) | `c59eaf873ce9` | success | 1135 | 1977 tests, 939.812s, 3 skips |
| pull_request / 45779847204 | [launchers (ubuntu-latest, Python 3.11)](https://github.com/lumingya/comfy-comic-studio/actions/runs/45779847204/job/139772479613) | `c59eaf873ce9` | success | 1238 | 1977 tests, 1195.789s, 3 skips |
| pull_request / 45779847204 | [launchers (windows-latest, Python 3.11)](https://github.com/lumingya/comfy-comic-studio/actions/runs/45779847204/job/139772479662) | `c59eaf873ce9` | success | 1954 | 1977 tests, 1875.03s, 0 skips |


## Executed command ledger

The following commands are copied from the actual emitted job scripts. Both gate steps completed successfully with `bash -e`; retained result anchors and the full step ledger are in `ci-verified.json`. Sequential command completion is inferred from fail-fast shell success, rather than treating a workflow plan as execution. The AGENTS lint scope is covered by the server+extensions and clients+tools command groups.

### Gate step 5: Install Python dependencies

Executed in both push and PR gate jobs; result: success.

```text
python -m pip install -r server/requirements-dev.txt
```

### Gate step 6: Spike unit tests (next/)

Executed in both push and PR gate jobs; result: success.

```text
python -m unittest discover -s next/tests -t next -q
```

### Gate step 7: v4 server (lint + unit tests)

Executed in both push and PR gate jobs; result: success.

```text
ruff check server extensions
ruff format --check server extensions
python -m unittest discover -s server/tests -t server -q
```

### Gate step 8: API v2 clients and release tools (generated client current + lint)

Executed in both push and PR gate jobs; result: success.

```text
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
```

### Gate step 9: v4 web (API types current + format + typecheck + tests + build)

Executed in both push and PR gate jobs; result: success.

```text
npm ci --prefix web --no-audit --no-fund
npm --prefix web run gen:api
git diff --exit-code -- web/src/api/schema.d.ts web/src/api/extensionProtocol.ts
npm --prefix web run format:check
npm --prefix web run typecheck
npm --prefix web test
python tools/check_extension_examples.py --panel-tests
npm --prefix web run build
```

### Gate step 11: Shipped data manifest

Executed in both push and PR gate jobs; result: success.

```text
python tools/check_distribution.py
python tools/build_distribution.py --check
```

### Gate step 12: Standalone assistant extension

Executed in both push and PR gate jobs; result: success.

```text
npm ci --no-audit --no-fund
npx prettier --check .
npm test
npm run build
git diff --exit-code -- dist
```

### Gate step 13: v4 release package smoke test

Executed in both push and PR gate jobs; result: success.

```text
python tools/build_release.py --out "$RUNNER_TEMP/mio-release-smoke"
```

### Launcher commands

All four launcher jobs executed these commands, with full launcher mode observed in each log. The launcher test command runs from `server/`; each verbose launcher suite reports 31 tests and zero skips.

```text
python -m pip install -r server/requirements-dev.txt
python -m unittest tests.test_launchers -v
python -m unittest discover -s server/tests -t server -q
```

## Distinct output evidence

| Check | Push gate | PR merge gate |
|---|---|---|
| Spike | 80 tests / 19.387s / 0 skips | 80 tests / 19.38s / 0 skips |
| Server+extensions format | 431 files already formatted | 448 files already formatted |
| Generated contracts/client | extension bridge contracts up to date; clients up to date | extension bridge contracts up to date; clients up to date |
| Extension/theme packages | Checked 25 extension/theme packages; 0 invalid | Checked 25 extension/theme packages; 0 invalid |
| Documentation | Checked 272 tracked Markdown/HTML documents: {'checked': 1597, 'declared-route': 55, 'embedded': 1, 'external': 128}; 0 broken links; 55 explicit notices | Checked 289 tracked Markdown/HTML documents: {'checked': 1656, 'declared-route': 57, 'embedded': 1, 'external': 134, 'template': 1}; 0 broken links; 58 explicit notices |
| Client/tool format | 32 files already formatted | 38 files already formatted |
| Web Vitest | Test Files  119 passed (119); Tests  965 passed (965) | Test Files  133 passed (133); Tests  1100 passed (1100) |
| Web build | ✓ built in 5.92s | ✓ built in 5.63s |
| Distribution | Verified 64 release data files (not a runtime requirement); data/distribution.json matches 64 shipped files | Verified 64 release data files (not a runtime requirement); data/distribution.json matches 64 shipped files |
| Assistant Vitest | Test Files  2 passed (2); Tests  34 passed (34) | Test Files  2 passed (2); Tests  34 passed (34) |
| Assistant build | ✓ built in 3.01s; committed-dist diff passed | ✓ built in 2.77s; committed-dist diff passed |
| Release smoke archive | Release archive built: 5129107 bytes; sha256 624e0fb6de5c040adacc6d0e5a222133187e33c31b6e01d90cc4085cebf98b89 | Release archive built: 5185397 bytes; sha256 9bce32e39732faf68a7f38de0ec4ebe68f8f55c64cd31b2d1a7141aeb2f38778 |


The API-generation step also completed the generated-file diff, format, strict typecheck, extension panel checks and build. Both distribution commands, assistant format/test/build/diff, example/bootstrap lint, and release smoke commands completed. Both smoke manifests are explicitly unsigned; no signed-update acceptance is claimed.

The candidate direct parent is the archived-document commit `6122ccab6aae015d1fb20295db4a66158e8f790f`; current candidate metadata lists only ROADMAP and three source/test paths as changed. The documentation counts above are actual new-run outputs, not a presumption that every historical edit adds a document.

## Quiet-suite skip and real TLS/HTTPS evidence

This is a source-anchored inference from the exact checkout and actual aggregate results, not a fabricated verbose TLS log. The two relevant remote source blobs are identical at branch HEAD and merge checkout.

Both blobs also match the retained `fa6308384826fad7629b2c727d70230cc7951d05` source contract byte for byte. Historical CI results are not used as evidence for these new runs. The TLS timing/classification/cancellation assertions remain unchanged.

- `server/tests/test_review_cloud_deadline.py`: Git blob `6587c4595e6ef5d2430a00cb8cbc453b4e1b790e`; SHA-256 `44ead6ec575660bde8dbcd5f87a342d13c014cdc2ac7f7dae2e19be9fc217706`. [HEAD source](https://github.com/lumingya/comfy-comic-studio/blob/fe914065c7aafb0672bfe10274361f83179ce7f1/server/tests/test_review_cloud_deadline.py), [merge source](https://github.com/lumingya/comfy-comic-studio/blob/c59eaf873ce98d0940a08ee70c0a1991475e5139/server/tests/test_review_cloud_deadline.py).

- `server/tests/test_windows_path_aliases.py`: Git blob `05414310f0ef0e36777a76da5d5a1e3358ce815c`; SHA-256 `3d616d8dddcd51e1be50fa478b4b0808b1c0e9d76ed17cf8ddd10e6cd729a308`. [HEAD source](https://github.com/lumingya/comfy-comic-studio/blob/fe914065c7aafb0672bfe10274361f83179ce7f1/server/tests/test_windows_path_aliases.py), [merge source](https://github.com/lumingya/comfy-comic-studio/blob/c59eaf873ce98d0940a08ee70c0a1991475e5139/server/tests/test_windows_path_aliases.py).


All four Linux full suites report exactly three skips. The following three discovered methods are obligatorily skipped by `os.name == "nt"` on Linux and exhaust that total:


- `test_ordinary_short_path_is_accepted_by_package_and_resource_checks`; [decorator at line 39](https://github.com/lumingya/comfy-comic-studio/blob/fe914065c7aafb0672bfe10274361f83179ce7f1/server/tests/test_windows_path_aliases.py#L39).

- `test_missing_child_below_ordinary_short_path_is_allowed`; [decorator at line 46](https://github.com/lumingya/comfy-comic-studio/blob/fe914065c7aafb0672bfe10274361f83179ce7f1/server/tests/test_windows_path_aliases.py#L46).

- `test_real_junction_ancestor_is_rejected`; [decorator at line 81](https://github.com/lumingya/comfy-comic-studio/blob/fe914065c7aafb0672bfe10274361f83179ce7f1/server/tests/test_windows_path_aliases.py#L81).


Both Windows full suites report `OK` without a skip count, establishing zero skips. Thus there is no extra TLS/HTTPS fixture skip in any of the six full suites. The HTTPS fixture falls back from OpenSSL on PATH to Git-bundled OpenSSL; its possible `SkipTest` would have increased the observed skip counts. Launcher `test_syntax` is explicitly `ok` in all four verbose launcher logs; the required ruff dependency was installed and no additional generated-client skip remains.


The checked source uses a real loopback HTTP server, a live TLS ClientHello check, and SSLContext-wrapped HTTPS sockets. The full-discovery success therefore covers these real-transport methods:


- [`test_tls_handshake_stall_obeys_deadline`](https://github.com/lumingya/comfy-comic-studio/blob/fe914065c7aafb0672bfe10274361f83179ce7f1/server/tests/test_review_cloud_deadline.py#L321): A live ClientHello is received, elapsed is below 1.5 seconds, and the error is a deadline.

- [`test_tls_peer_close_is_not_classified_as_deadline`](https://github.com/lumingya/comfy-comic-studio/blob/fe914065c7aafb0672bfe10274361f83179ce7f1/server/tests/test_review_cloud_deadline.py#L339): A live ClientHello is received; remaining budget is over one second; connection failure, not deadline; sent is false.

- [`test_tls_handshake_stall_is_interrupted_by_cancel_and_scope_close`](https://github.com/lumingya/comfy-comic-studio/blob/fe914065c7aafb0672bfe10274361f83179ce7f1/server/tests/test_review_cloud_deadline.py#L349): Both cancel and scope close interrupt the TLS worker; the worker is no longer alive after the 0.4-second join and reports cancellation.

- [`test_https_json_and_download_stalls_obey_absolute_deadline`](https://github.com/lumingya/comfy-comic-studio/blob/fe914065c7aafb0672bfe10274361f83179ce7f1/server/tests/test_review_cloud_deadline.py#L244): HTTPS JSON and download bodies both use the absolute-deadline stall check.

- [`test_https_body_stall_is_interrupted_by_cancel_and_scope_close`](https://github.com/lumingya/comfy-comic-studio/blob/fe914065c7aafb0672bfe10274361f83179ce7f1/server/tests/test_review_cloud_deadline.py#L374): Both cancellation methods interrupt both HTTPS body variants.


Successful quiet output does not expose individual TLS timings. No separate TLS-only job or local test was run.

## Web artifacts

Artifact identities and expected ZIP digests come only from the new runs GitHub artifact API records. This observer did not download either archive. The push artifact belongs to the frozen candidate checkout; the PR artifact belongs to its wider merge checkout and is recorded separately.

- [web-preview-fe914065c7aafb0672bfe10274361f83179ce7f1](https://github.com/lumingya/comfy-comic-studio/actions/runs/45779838148/artifacts/15098114848): ID `15098114848`, run `45779838148`, branch head `fe914065c7aafb0672bfe10274361f83179ce7f1`, build checkout `fe914065c7aafb0672bfe10274361f83179ce7f1`, 758554 bytes, digest `sha256:d6a13e6d7c10125e2c96e62253bf90309bede137e41847fbb68e630bcee7d1dd`, created 2026-11-26T08:21:57Z, expired=False.

- [web-preview-c59eaf873ce98d0940a08ee70c0a1991475e5139](https://github.com/lumingya/comfy-comic-studio/actions/runs/45779847204/artifacts/15098358802): ID `15098358802`, run `45779847204`, branch head `fe914065c7aafb0672bfe10274361f83179ce7f1`, build checkout `c59eaf873ce98d0940a08ee70c0a1991475e5139`, 766799 bytes, digest `sha256:41091c188ad17bf794513f3e58596b5e6c42f8b1ed3b953e6aac41ea9dcb22bc`, created 2026-11-26T08:21:29Z, expired=False.


## Complete step ledger

### push run [45779838148](https://github.com/lumingya/comfy-comic-studio/actions/runs/45779838148)

Attempt 1; created 2026-11-26T08:02:26Z; terminal metadata updated 2026-11-26T08:27:40Z; completed/success.

#### launchers (ubuntu-latest, Python 3.11) / 139772444799

Actual checkout `fe914065c7aafb0672bfe10274361f83179ce7f1` at 2026-11-26T08:02:48.8159326Z, archived job-log lines 105-106; raw-log SHA-256 `7b61f4828a7b5848862dab05bbb5e16ac40b73f4507223cc30627e9e8ac7fb6a`.

| Step | Name | State/result | Started UTC | Completed UTC |
|---:|---|---|---|---|
| 1 | Set up job | completed / success | 2026-11-26T08:02:46Z | 2026-11-26T08:02:47Z |
| 2 | Run actions/checkout@v4 | completed / success | 2026-11-26T08:02:47Z | 2026-11-26T08:02:48Z |
| 3 | Run actions/setup-python@v5 | completed / success | 2026-11-26T08:02:48Z | 2026-11-26T08:02:49Z |
| 4 | Install server dependencies | completed / success | 2026-11-26T08:02:49Z | 2026-11-26T08:02:54Z |
| 5 | Launchers (static, bootstrap, real start.bat / start.sh from scratch) | completed / success | 2026-11-26T08:02:54Z | 2026-11-26T08:03:20Z |
| 6 | v4 server unit tests | completed / success | 2026-11-26T08:03:20Z | 2026-11-26T08:23:51Z |
| 11 | Post Run actions/setup-python@v5 | completed / success | 2026-11-26T08:23:51Z | 2026-11-26T08:23:51Z |
| 12 | Post Run actions/checkout@v4 | completed / success | 2026-11-26T08:23:51Z | 2026-11-26T08:23:52Z |
| 13 | Complete job | completed / success | 2026-11-26T08:23:52Z | 2026-11-26T08:23:52Z |



#### launchers (windows-latest, Python 3.11) / 139772445054

Actual checkout `fe914065c7aafb0672bfe10274361f83179ce7f1` at 2026-11-26T08:03:21.5943643Z, archived job-log lines 92-93; raw-log SHA-256 `adcd29e0452e2386124c2348c30ab82b577964c926118d7349fb51ebea3fdd8d`.

| Step | Name | State/result | Started UTC | Completed UTC |
|---:|---|---|---|---|
| 1 | Set up job | completed / success | 2026-11-26T08:02:47Z | 2026-11-26T08:02:50Z |
| 2 | Run actions/checkout@v4 | completed / success | 2026-11-26T08:02:50Z | 2026-11-26T08:03:21Z |
| 3 | Run actions/setup-python@v5 | completed / success | 2026-11-26T08:03:21Z | 2026-11-26T08:03:21Z |
| 4 | Install server dependencies | completed / success | 2026-11-26T08:03:21Z | 2026-11-26T08:03:34Z |
| 5 | Launchers (static, bootstrap, real start.bat / start.sh from scratch) | completed / success | 2026-11-26T08:03:34Z | 2026-11-26T08:04:10Z |
| 6 | v4 server unit tests | completed / success | 2026-11-26T08:04:10Z | 2026-11-26T08:27:36Z |
| 11 | Post Run actions/setup-python@v5 | completed / success | 2026-11-26T08:27:36Z | 2026-11-26T08:27:36Z |
| 12 | Post Run actions/checkout@v4 | completed / success | 2026-11-26T08:27:36Z | 2026-11-26T08:27:37Z |
| 13 | Complete job | completed / success | 2026-11-26T08:27:37Z | 2026-11-26T08:27:38Z |



#### gate / 139772445202

Actual checkout `fe914065c7aafb0672bfe10274361f83179ce7f1` at 2026-11-26T08:02:50.4538307Z, archived job-log lines 107-108; raw-log SHA-256 `2b1f15121d2e51d66d8c217871fc2b5ac02f9dc1300b271478cc3d87f28df38a`.

| Step | Name | State/result | Started UTC | Completed UTC |
|---:|---|---|---|---|
| 1 | Set up job | completed / success | 2026-11-26T08:02:47Z | 2026-11-26T08:02:48Z |
| 2 | Run actions/checkout@v4 | completed / success | 2026-11-26T08:02:48Z | 2026-11-26T08:02:50Z |
| 3 | Run actions/setup-python@v5 | completed / success | 2026-11-26T08:02:50Z | 2026-11-26T08:02:50Z |
| 4 | Run actions/setup-node@v4 | completed / success | 2026-11-26T08:02:50Z | 2026-11-26T08:02:54Z |
| 5 | Install Python dependencies | completed / success | 2026-11-26T08:02:54Z | 2026-11-26T08:03:01Z |
| 6 | Spike unit tests (next/) | completed / success | 2026-11-26T08:03:01Z | 2026-11-26T08:03:21Z |
| 7 | v4 server (lint + unit tests) | completed / success | 2026-11-26T08:03:21Z | 2026-11-26T08:19:38Z |
| 8 | API v2 clients and release tools (generated client current + lint) | completed / success | 2026-11-26T08:19:38Z | 2026-11-26T08:19:44Z |
| 9 | v4 web (API types current + format + typecheck + tests + build) | completed / success | 2026-11-26T08:19:44Z | 2026-11-26T08:21:56Z |
| 10 | Preserve built web for isolated browser verification | completed / success | 2026-11-26T08:21:56Z | 2026-11-26T08:21:58Z |
| 11 | Shipped data manifest | completed / success | 2026-11-26T08:21:58Z | 2026-11-26T08:21:58Z |
| 12 | Standalone assistant extension | completed / success | 2026-11-26T08:21:58Z | 2026-11-26T08:22:11Z |
| 13 | v4 release package smoke test | completed / success | 2026-11-26T08:22:11Z | 2026-11-26T08:22:12Z |
| 24 | Post Run actions/setup-node@v4 | completed / success | 2026-11-26T08:22:12Z | 2026-11-26T08:22:12Z |
| 25 | Post Run actions/setup-python@v5 | completed / success | 2026-11-26T08:22:12Z | 2026-11-26T08:22:12Z |
| 26 | Post Run actions/checkout@v4 | completed / success | 2026-11-26T08:22:12Z | 2026-11-26T08:22:12Z |
| 27 | Complete job | completed / success | 2026-11-26T08:22:12Z | 2026-11-26T08:22:12Z |



### pull_request run [45779847204](https://github.com/lumingya/comfy-comic-studio/actions/runs/45779847204)

Attempt 1; created 2026-11-26T08:02:31Z; terminal metadata updated 2026-11-26T08:35:25Z; completed/success.

#### gate / 139772479333

Actual checkout `c59eaf873ce98d0940a08ee70c0a1991475e5139` at 2026-11-26T08:02:53.3599414Z, archived job-log lines 123-124; raw-log SHA-256 `852d955675208f9fe2c078c33d2df9a4cdc7d153be118dfcfc966334b45dd9aa`.

| Step | Name | State/result | Started UTC | Completed UTC |
|---:|---|---|---|---|
| 1 | Set up job | completed / success | 2026-11-26T08:02:51Z | 2026-11-26T08:02:51Z |
| 2 | Run actions/checkout@v4 | completed / success | 2026-11-26T08:02:51Z | 2026-11-26T08:02:53Z |
| 3 | Run actions/setup-python@v5 | completed / success | 2026-11-26T08:02:53Z | 2026-11-26T08:02:53Z |
| 4 | Run actions/setup-node@v4 | completed / success | 2026-11-26T08:02:53Z | 2026-11-26T08:02:56Z |
| 5 | Install Python dependencies | completed / success | 2026-11-26T08:02:56Z | 2026-11-26T08:03:02Z |
| 6 | Spike unit tests (next/) | completed / success | 2026-11-26T08:03:02Z | 2026-11-26T08:03:21Z |
| 7 | v4 server (lint + unit tests) | completed / success | 2026-11-26T08:03:21Z | 2026-11-26T08:19:04Z |
| 8 | API v2 clients and release tools (generated client current + lint) | completed / success | 2026-11-26T08:19:04Z | 2026-11-26T08:19:10Z |
| 9 | v4 web (API types current + format + typecheck + tests + build) | completed / success | 2026-11-26T08:19:10Z | 2026-11-26T08:21:29Z |
| 10 | Preserve built web for isolated browser verification | completed / success | 2026-11-26T08:21:29Z | 2026-11-26T08:21:30Z |
| 11 | Shipped data manifest | completed / success | 2026-11-26T08:21:30Z | 2026-11-26T08:21:30Z |
| 12 | Standalone assistant extension | completed / success | 2026-11-26T08:21:30Z | 2026-11-26T08:21:42Z |
| 13 | v4 release package smoke test | completed / success | 2026-11-26T08:21:42Z | 2026-11-26T08:21:43Z |
| 24 | Post Run actions/setup-node@v4 | completed / success | 2026-11-26T08:21:43Z | 2026-11-26T08:21:43Z |
| 25 | Post Run actions/setup-python@v5 | completed / success | 2026-11-26T08:21:43Z | 2026-11-26T08:21:43Z |
| 26 | Post Run actions/checkout@v4 | completed / success | 2026-11-26T08:21:43Z | 2026-11-26T08:21:44Z |
| 27 | Complete job | completed / success | 2026-11-26T08:21:44Z | 2026-11-26T08:21:44Z |



#### launchers (ubuntu-latest, Python 3.11) / 139772479613

Actual checkout `c59eaf873ce98d0940a08ee70c0a1991475e5139` at 2026-11-26T08:02:54.3130983Z, archived job-log lines 121-122; raw-log SHA-256 `bd059c14350abe46e734c3a6bc1683badcb84b7c9d2d673cd7cee71637b9a3ab`.

| Step | Name | State/result | Started UTC | Completed UTC |
|---:|---|---|---|---|
| 1 | Set up job | completed / success | 2026-11-26T08:02:51Z | 2026-11-26T08:02:52Z |
| 2 | Run actions/checkout@v4 | completed / success | 2026-11-26T08:02:52Z | 2026-11-26T08:02:54Z |
| 3 | Run actions/setup-python@v5 | completed / success | 2026-11-26T08:02:54Z | 2026-11-26T08:02:54Z |
| 4 | Install server dependencies | completed / success | 2026-11-26T08:02:54Z | 2026-11-26T08:03:01Z |
| 5 | Launchers (static, bootstrap, real start.bat / start.sh from scratch) | completed / success | 2026-11-26T08:03:01Z | 2026-11-26T08:03:27Z |
| 6 | v4 server unit tests | completed / success | 2026-11-26T08:03:27Z | 2026-11-26T08:23:25Z |
| 11 | Post Run actions/setup-python@v5 | completed / success | 2026-11-26T08:23:25Z | 2026-11-26T08:23:26Z |
| 12 | Post Run actions/checkout@v4 | completed / success | 2026-11-26T08:23:26Z | 2026-11-26T08:23:26Z |
| 13 | Complete job | completed / success | 2026-11-26T08:23:26Z | 2026-11-26T08:23:26Z |



#### launchers (windows-latest, Python 3.11) / 139772479662

Actual checkout `c59eaf873ce98d0940a08ee70c0a1991475e5139` at 2026-11-26T08:03:01.7214819Z, archived job-log lines 108-109; raw-log SHA-256 `494b89adff06f23cb3ede417d47de46cde90248725fc68baecd1c105ebce0ca6`.

| Step | Name | State/result | Started UTC | Completed UTC |
|---:|---|---|---|---|
| 1 | Set up job | completed / success | 2026-11-26T08:02:52Z | 2026-11-26T08:02:53Z |
| 2 | Run actions/checkout@v4 | completed / success | 2026-11-26T08:02:53Z | 2026-11-26T08:03:01Z |
| 3 | Run actions/setup-python@v5 | completed / success | 2026-11-26T08:03:01Z | 2026-11-26T08:03:01Z |
| 4 | Install server dependencies | completed / success | 2026-11-26T08:03:01Z | 2026-11-26T08:03:16Z |
| 5 | Launchers (static, bootstrap, real start.bat / start.sh from scratch) | completed / success | 2026-11-26T08:03:16Z | 2026-11-26T08:04:02Z |
| 6 | v4 server unit tests | completed / success | 2026-11-26T08:04:02Z | 2026-11-26T08:35:21Z |
| 11 | Post Run actions/setup-python@v5 | completed / success | 2026-11-26T08:35:21Z | 2026-11-26T08:35:21Z |
| 12 | Post Run actions/checkout@v4 | completed / success | 2026-11-26T08:35:21Z | 2026-11-26T08:35:23Z |
| 13 | Complete job | completed / success | 2026-11-26T08:35:23Z | 2026-11-26T08:35:23Z |



## Observation limits and sealing

One external sampler used a 60-second schedule, 31 observations, and exited normally after both runs reached terminal state. There were 1 transient GitHub API EOF reads; subsequent scheduled reads recovered. No failures, reruns or cancellations occurred in these two attempts.

Only read-only GitHub retrieval and standard-library evidence processing were performed locally. No local product import, test, lint, build, service, browser, product HTTP call, source/workflow edit, push, rerun or job cancellation was performed. Raw sources, metadata, scripts and logs remain in this evidence directory and are not publication deliverables. The two safe publication deliverables are `report.md` and `ci-verified.json`. No R6 final-review or overall completion claim is made.
