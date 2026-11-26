# Fixed-head CI verification

Fixed branch HEAD: `fa6308384826fad7629b2c727d70230cc7951d05`. Both exact event runs and all six jobs completed successfully. Final observation: 2026-11-26T06:58:54.515406+00:00.

Read-only CI verification for fixed branch HEAD and its two exact event runs. This is not an R5 final review, cleanup, product-runtime validation, or overall-task completion claim.

## Checkout identity and CI scope

- Branch `codex/static-workflow-compat` was `fa6308384826fad7629b2c727d70230cc7951d05` at initial and final metadata collection. Its parent is `6e302081e650210202b232990ab05bbd6961e149`.

- Push jobs actually checked out `fa6308384826fad7629b2c727d70230cc7951d05`.

- PR metadata head is `fa6308384826fad7629b2c727d70230cc7951d05`, but all PR jobs actually checked out merge `8b9318a7ceba2e37f1f24e6d113cf39d49510d2a`. Remote merge parents are `e7a4eac44bacb64f6d74dd5a028d0380b0aa69f8` then `fa6308384826fad7629b2c727d70230cc7951d05`. [Remote merge commit](https://github.com/lumingya/comfy-comic-studio/commit/8b9318a7ceba2e37f1f24e6d113cf39d49510d2a).

- Each checkout below is established by the job log command `git log -1 --format=%H` and its next-line SHA, not merely by run or PR head metadata.

- Gate budgets are 30 minutes for both checkouts. Launcher budgets are 30 minutes at branch HEAD and 60 minutes at the merge checkout; the emitted command lists are identical. Different suite totals below reflect different checked-out code.

| Event/run | Job | Checkout | Result | Job seconds | Full backend suite |
|---|---|---|---|---:|---|

| push / 45768262520 | [launchers (windows-latest, Python 3.11)](https://github.com/lumingya/comfy-comic-studio/actions/runs/45768262520/job/139734369066) | `fa6308384826` | success | 1694 | 1823 tests, 1619.314s, 0 skips |

| push / 45768262520 | [launchers (ubuntu-latest, Python 3.11)](https://github.com/lumingya/comfy-comic-studio/actions/runs/45768262520/job/139734369257) | `fa6308384826` | success | 1071 | 1823 tests, 1026.747s, 3 skips |

| push / 45768262520 | [gate](https://github.com/lumingya/comfy-comic-studio/actions/runs/45768262520/job/139734369302) | `fa6308384826` | success | 1140 | 1823 tests, 934.532s, 3 skips |

| pull_request / 45768270363 | [launchers (windows-latest, Python 3.11)](https://github.com/lumingya/comfy-comic-studio/actions/runs/45768270363/job/139734394871) | `8b9318a7ceba` | success | 1885 | 1969 tests, 1811.003s, 0 skips |

| pull_request / 45768270363 | [launchers (ubuntu-latest, Python 3.11)](https://github.com/lumingya/comfy-comic-studio/actions/runs/45768270363/job/139734395186) | `8b9318a7ceba` | success | 1302 | 1969 tests, 1259.874s, 3 skips |

| pull_request / 45768270363 | [gate](https://github.com/lumingya/comfy-comic-studio/actions/runs/45768270363/job/139734395292) | `8b9318a7ceba` | success | 1541 | 1969 tests, 1270.131s, 3 skips |


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

| Spike | 80 tests / 19.385s / 0 skips | 80 tests / 19.620s / 0 skips |

| Server+extensions format | 429 files already formatted | 446 files already formatted |

| Generated contracts/client | contracts and clients up to date | contracts and clients up to date |

| Extension/theme packages | 25 checked / 0 invalid | 25 checked / 0 invalid |

| Documentation | 240 documents / 0 broken references / 55 explicit notices | 252 documents / 0 broken references / 58 explicit notices |

| Client/tool format | 32 files already formatted | 38 files already formatted |

| Web Vitest | 119 files / 965 tests passed | 133 files / 1100 tests passed |

| Web build | 6.07s | 7.92s |

| Distribution | 64 verified and manifest current | 64 verified and manifest current |

| Assistant Vitest | 2 files / 34 tests passed | 2 files / 34 tests passed |

| Assistant build | 3.07s; committed-dist diff passed | 3.75s; committed-dist diff passed |

| Release smoke archive | 5125955 bytes / SHA-256 60d465cc76869de8629c11e6d26029b1382a0cffaeb1620b454d8bc901798755 | 5182245 bytes / SHA-256 e99362c83ee533f014d2eae23e1b7f94df4a1b3c9d68a6ac1b6569446e75fdd0 |


The API-generation step also completed the generated-file diff, format, strict typecheck, extension panel checks and build. Both distribution commands, assistant format/test/build/diff, example/bootstrap lint, and release smoke commands completed. Both smoke manifests are explicitly unsigned; no signed-update acceptance is claimed.

## Quiet-suite skip and real TLS/HTTPS evidence

This is a source-anchored inference from the exact checkout and actual aggregate results, not a fabricated verbose TLS log. The two relevant remote source blobs are identical at branch HEAD and merge checkout.

- `server/tests/test_review_cloud_deadline.py`: Git blob `6587c4595e6ef5d2430a00cb8cbc453b4e1b790e`; SHA-256 `44ead6ec575660bde8dbcd5f87a342d13c014cdc2ac7f7dae2e19be9fc217706`. [HEAD source](https://github.com/lumingya/comfy-comic-studio/blob/fa6308384826fad7629b2c727d70230cc7951d05/server/tests/test_review_cloud_deadline.py), [merge source](https://github.com/lumingya/comfy-comic-studio/blob/8b9318a7ceba2e37f1f24e6d113cf39d49510d2a/server/tests/test_review_cloud_deadline.py).

- `server/tests/test_windows_path_aliases.py`: Git blob `05414310f0ef0e36777a76da5d5a1e3358ce815c`; SHA-256 `3d616d8dddcd51e1be50fa478b4b0808b1c0e9d76ed17cf8ddd10e6cd729a308`. [HEAD source](https://github.com/lumingya/comfy-comic-studio/blob/fa6308384826fad7629b2c727d70230cc7951d05/server/tests/test_windows_path_aliases.py), [merge source](https://github.com/lumingya/comfy-comic-studio/blob/8b9318a7ceba2e37f1f24e6d113cf39d49510d2a/server/tests/test_windows_path_aliases.py).


All four Linux full suites report exactly three skips. The following three discovered methods are obligatorily skipped by `os.name == "nt"` on Linux and exhaust that total:


- `test_ordinary_short_path_is_accepted_by_package_and_resource_checks`; [decorator at line 39](https://github.com/lumingya/comfy-comic-studio/blob/fa6308384826fad7629b2c727d70230cc7951d05/server/tests/test_windows_path_aliases.py#L39).

- `test_missing_child_below_ordinary_short_path_is_allowed`; [decorator at line 46](https://github.com/lumingya/comfy-comic-studio/blob/fa6308384826fad7629b2c727d70230cc7951d05/server/tests/test_windows_path_aliases.py#L46).

- `test_real_junction_ancestor_is_rejected`; [decorator at line 81](https://github.com/lumingya/comfy-comic-studio/blob/fa6308384826fad7629b2c727d70230cc7951d05/server/tests/test_windows_path_aliases.py#L81).


Both Windows full suites report `OK` without a skip count, establishing zero skips. Thus there is no extra TLS/HTTPS fixture skip in any of the six full suites. The HTTPS fixture falls back from OpenSSL on PATH to Git-bundled OpenSSL; its possible `SkipTest` would have increased the observed skip counts. Launcher `test_syntax` is explicitly `ok` in all four verbose launcher logs; the required ruff dependency was installed and no additional generated-client skip remains.


The checked source uses a real loopback HTTP server, a live TLS ClientHello check, and SSLContext-wrapped HTTPS sockets. The full-discovery success therefore covers these real-transport methods:


- [`test_tls_handshake_stall_obeys_deadline`](https://github.com/lumingya/comfy-comic-studio/blob/fa6308384826fad7629b2c727d70230cc7951d05/server/tests/test_review_cloud_deadline.py#L321): A live ClientHello is received, elapsed is below 1.5 seconds, and the error is a deadline.

- [`test_tls_peer_close_is_not_classified_as_deadline`](https://github.com/lumingya/comfy-comic-studio/blob/fa6308384826fad7629b2c727d70230cc7951d05/server/tests/test_review_cloud_deadline.py#L339): A live ClientHello is received; remaining budget is over one second; connection failure, not deadline; sent is false.

- [`test_tls_handshake_stall_is_interrupted_by_cancel_and_scope_close`](https://github.com/lumingya/comfy-comic-studio/blob/fa6308384826fad7629b2c727d70230cc7951d05/server/tests/test_review_cloud_deadline.py#L349): Both cancel and scope close interrupt the TLS worker; the worker is no longer alive after the 0.4-second join and reports cancellation.

- [`test_https_json_and_download_stalls_obey_absolute_deadline`](https://github.com/lumingya/comfy-comic-studio/blob/fa6308384826fad7629b2c727d70230cc7951d05/server/tests/test_review_cloud_deadline.py#L244): HTTPS JSON and download bodies both use the absolute-deadline stall check.

- [`test_https_body_stall_is_interrupted_by_cancel_and_scope_close`](https://github.com/lumingya/comfy-comic-studio/blob/fa6308384826fad7629b2c727d70230cc7951d05/server/tests/test_review_cloud_deadline.py#L374): Both cancellation methods interrupt both HTTPS body variants.


Successful quiet output does not expose individual TLS timings. No separate TLS-only job or local test was run.

## Web artifacts

- [web-preview-fa6308384826fad7629b2c727d70230cc7951d05](https://github.com/lumingya/comfy-comic-studio/actions/runs/45768262520/artifacts/15093284680): ID `15093284680`, run `45768262520`, branch head `fa6308384826fad7629b2c727d70230cc7951d05`, build checkout `fa6308384826fad7629b2c727d70230cc7951d05`, 758554 bytes, digest `sha256:4eeffd1d5b2f337506cfd89eae400cd72e2cc9bb1467445056cacaa7b5af7ff0`, created 2026-11-26T06:45:42Z, expired=False.

- [web-preview-8b9318a7ceba2e37f1f24e6d113cf39d49510d2a](https://github.com/lumingya/comfy-comic-studio/actions/runs/45768270363/artifacts/15093853953): ID `15093853953`, run `45768270363`, branch head `fa6308384826fad7629b2c727d70230cc7951d05`, build checkout `8b9318a7ceba2e37f1f24e6d113cf39d49510d2a`, 766799 bytes, digest `sha256:2a948fb96d71a31c918802bea493bde893f067811b5e46ebfb5f0d70114c7b37`, created 2026-11-26T06:52:24Z, expired=False.


## Complete step ledger

### push run [45768262520](https://github.com/lumingya/comfy-comic-studio/actions/runs/45768262520)

Attempt 1; created 2026-11-26T06:26:57Z; terminal metadata updated 2026-11-26T06:55:15Z; completed/success.

#### launchers (windows-latest, Python 3.11) / 139734369066

Actual checkout `fa6308384826fad7629b2c727d70230cc7951d05` at 2026-11-26T06:27:08.0882033Z, archived job-log lines 92-93; raw-log SHA-256 `a5b8243fba513035877af78f091cc7fc415620391fe31df530f395fafeae02cf`.

| Step | Name | State/result | Started UTC | Completed UTC |
|---:|---|---|---|---|

| 1 | Set up job | completed / success | 2026-11-26T06:27:01Z | 2026-11-26T06:27:01Z |

| 2 | Run actions/checkout@v4 | completed / success | 2026-11-26T06:27:01Z | 2026-11-26T06:27:08Z |

| 3 | Run actions/setup-python@v5 | completed / success | 2026-11-26T06:27:08Z | 2026-11-26T06:27:08Z |

| 4 | Install server dependencies | completed / success | 2026-11-26T06:27:08Z | 2026-11-26T06:27:23Z |

| 5 | Launchers (static, bootstrap, real start.bat / start.sh from scratch) | completed / success | 2026-11-26T06:27:23Z | 2026-11-26T06:28:08Z |

| 6 | v4 server unit tests | completed / success | 2026-11-26T06:28:08Z | 2026-11-26T06:55:11Z |

| 11 | Post Run actions/setup-python@v5 | completed / success | 2026-11-26T06:55:11Z | 2026-11-26T06:55:11Z |

| 12 | Post Run actions/checkout@v4 | completed / success | 2026-11-26T06:55:11Z | 2026-11-26T06:55:13Z |

| 13 | Complete job | completed / success | 2026-11-26T06:55:13Z | 2026-11-26T06:55:13Z |



#### launchers (ubuntu-latest, Python 3.11) / 139734369257

Actual checkout `fa6308384826fad7629b2c727d70230cc7951d05` at 2026-11-26T06:27:07.0253003Z, archived job-log lines 105-106; raw-log SHA-256 `7d1cd0b9d01e45aad8808345bbd6c8e8b30231924eeae8b6c9d0c9d31fc04f9a`.

| Step | Name | State/result | Started UTC | Completed UTC |
|---:|---|---|---|---|

| 1 | Set up job | completed / success | 2026-11-26T06:27:01Z | 2026-11-26T06:27:02Z |

| 2 | Run actions/checkout@v4 | completed / success | 2026-11-26T06:27:02Z | 2026-11-26T06:27:07Z |

| 3 | Run actions/setup-python@v5 | completed / success | 2026-11-26T06:27:07Z | 2026-11-26T06:27:07Z |

| 4 | Install server dependencies | completed / success | 2026-11-26T06:27:07Z | 2026-11-26T06:27:14Z |

| 5 | Launchers (static, bootstrap, real start.bat / start.sh from scratch) | completed / success | 2026-11-26T06:27:14Z | 2026-11-26T06:27:38Z |

| 6 | v4 server unit tests | completed / success | 2026-11-26T06:27:38Z | 2026-11-26T06:44:48Z |

| 11 | Post Run actions/setup-python@v5 | completed / success | 2026-11-26T06:44:48Z | 2026-11-26T06:44:48Z |

| 12 | Post Run actions/checkout@v4 | completed / success | 2026-11-26T06:44:48Z | 2026-11-26T06:44:48Z |

| 13 | Complete job | completed / success | 2026-11-26T06:44:48Z | 2026-11-26T06:44:48Z |



#### gate / 139734369302

Actual checkout `fa6308384826fad7629b2c727d70230cc7951d05` at 2026-11-26T06:27:04.6904808Z, archived job-log lines 107-108; raw-log SHA-256 `b4fbf0c5cf6ba10961f0dae8a845d08fcc56141fbd7a11202795dea5835ed380`.

| Step | Name | State/result | Started UTC | Completed UTC |
|---:|---|---|---|---|

| 1 | Set up job | completed / success | 2026-11-26T06:27:01Z | 2026-11-26T06:27:02Z |

| 2 | Run actions/checkout@v4 | completed / success | 2026-11-26T06:27:02Z | 2026-11-26T06:27:04Z |

| 3 | Run actions/setup-python@v5 | completed / success | 2026-11-26T06:27:04Z | 2026-11-26T06:27:05Z |

| 4 | Run actions/setup-node@v4 | completed / success | 2026-11-26T06:27:05Z | 2026-11-26T06:27:11Z |

| 5 | Install Python dependencies | completed / success | 2026-11-26T06:27:11Z | 2026-11-26T06:27:22Z |

| 6 | Spike unit tests (next/) | completed / success | 2026-11-26T06:27:22Z | 2026-11-26T06:27:42Z |

| 7 | v4 server (lint + unit tests) | completed / success | 2026-11-26T06:27:42Z | 2026-11-26T06:43:21Z |

| 8 | API v2 clients and release tools (generated client current + lint) | completed / success | 2026-11-26T06:43:21Z | 2026-11-26T06:43:27Z |

| 9 | v4 web (API types current + format + typecheck + tests + build) | completed / success | 2026-11-26T06:43:27Z | 2026-11-26T06:45:40Z |

| 10 | Preserve built web for isolated browser verification | completed / success | 2026-11-26T06:45:40Z | 2026-11-26T06:45:42Z |

| 11 | Shipped data manifest | completed / success | 2026-11-26T06:45:42Z | 2026-11-26T06:45:42Z |

| 12 | Standalone assistant extension | completed / success | 2026-11-26T06:45:42Z | 2026-11-26T06:45:55Z |

| 13 | v4 release package smoke test | completed / success | 2026-11-26T06:45:55Z | 2026-11-26T06:45:57Z |

| 24 | Post Run actions/setup-node@v4 | completed / success | 2026-11-26T06:45:57Z | 2026-11-26T06:45:57Z |

| 25 | Post Run actions/setup-python@v5 | completed / success | 2026-11-26T06:45:57Z | 2026-11-26T06:45:57Z |

| 26 | Post Run actions/checkout@v4 | completed / success | 2026-11-26T06:45:57Z | 2026-11-26T06:45:57Z |

| 27 | Complete job | completed / success | 2026-11-26T06:45:57Z | 2026-11-26T06:45:57Z |



### pull_request run [45768270363](https://github.com/lumingya/comfy-comic-studio/actions/runs/45768270363)

Attempt 1; created 2026-11-26T06:27:01Z; terminal metadata updated 2026-11-26T06:58:30Z; completed/success.

#### launchers (windows-latest, Python 3.11) / 139734394871

Actual checkout `8b9318a7ceba2e37f1f24e6d113cf39d49510d2a` at 2026-11-26T06:27:11.9738015Z, archived job-log lines 108-109; raw-log SHA-256 `f299382b95d0a77d3a6003c70a56579a5b9d750380e55ae379c0585abde36b97`.

| Step | Name | State/result | Started UTC | Completed UTC |
|---:|---|---|---|---|

| 1 | Set up job | completed / success | 2026-11-26T06:27:04Z | 2026-11-26T06:27:05Z |

| 2 | Run actions/checkout@v4 | completed / success | 2026-11-26T06:27:05Z | 2026-11-26T06:27:11Z |

| 3 | Run actions/setup-python@v5 | completed / success | 2026-11-26T06:27:11Z | 2026-11-26T06:27:12Z |

| 4 | Install server dependencies | completed / success | 2026-11-26T06:27:12Z | 2026-11-26T06:27:28Z |

| 5 | Launchers (static, bootstrap, real start.bat / start.sh from scratch) | completed / success | 2026-11-26T06:27:28Z | 2026-11-26T06:28:11Z |

| 6 | v4 server unit tests | completed / success | 2026-11-26T06:28:11Z | 2026-11-26T06:58:26Z |

| 11 | Post Run actions/setup-python@v5 | completed / success | 2026-11-26T06:58:26Z | 2026-11-26T06:58:26Z |

| 12 | Post Run actions/checkout@v4 | completed / success | 2026-11-26T06:58:26Z | 2026-11-26T06:58:28Z |

| 13 | Complete job | completed / success | 2026-11-26T06:58:28Z | 2026-11-26T06:58:28Z |



#### launchers (ubuntu-latest, Python 3.11) / 139734395186

Actual checkout `8b9318a7ceba2e37f1f24e6d113cf39d49510d2a` at 2026-11-26T06:27:08.4569874Z, archived job-log lines 121-122; raw-log SHA-256 `da2b47b886d16117049606ff355853359f99ae068b8cf95af3edb7418276e7a8`.

| Step | Name | State/result | Started UTC | Completed UTC |
|---:|---|---|---|---|

| 1 | Set up job | completed / success | 2026-11-26T06:27:05Z | 2026-11-26T06:27:06Z |

| 2 | Run actions/checkout@v4 | completed / success | 2026-11-26T06:27:06Z | 2026-11-26T06:27:08Z |

| 3 | Run actions/setup-python@v5 | completed / success | 2026-11-26T06:27:08Z | 2026-11-26T06:27:08Z |

| 4 | Install server dependencies | completed / success | 2026-11-26T06:27:08Z | 2026-11-26T06:27:14Z |

| 5 | Launchers (static, bootstrap, real start.bat / start.sh from scratch) | completed / success | 2026-11-26T06:27:14Z | 2026-11-26T06:27:41Z |

| 6 | v4 server unit tests | completed / success | 2026-11-26T06:27:41Z | 2026-11-26T06:48:44Z |

| 11 | Post Run actions/setup-python@v5 | completed / success | 2026-11-26T06:48:44Z | 2026-11-26T06:48:44Z |

| 12 | Post Run actions/checkout@v4 | completed / success | 2026-11-26T06:48:44Z | 2026-11-26T06:48:44Z |

| 13 | Complete job | completed / success | 2026-11-26T06:48:44Z | 2026-11-26T06:48:44Z |



#### gate / 139734395292

Actual checkout `8b9318a7ceba2e37f1f24e6d113cf39d49510d2a` at 2026-11-26T06:27:08.0200965Z, archived job-log lines 123-124; raw-log SHA-256 `98c874fde203837ff9a8c9831e7011dff96b846c121832b2926611425ced5e3a`.

| Step | Name | State/result | Started UTC | Completed UTC |
|---:|---|---|---|---|

| 1 | Set up job | completed / success | 2026-11-26T06:27:05Z | 2026-11-26T06:27:06Z |

| 2 | Run actions/checkout@v4 | completed / success | 2026-11-26T06:27:06Z | 2026-11-26T06:27:08Z |

| 3 | Run actions/setup-python@v5 | completed / success | 2026-11-26T06:27:08Z | 2026-11-26T06:27:08Z |

| 4 | Run actions/setup-node@v4 | completed / success | 2026-11-26T06:27:08Z | 2026-11-26T06:27:11Z |

| 5 | Install Python dependencies | completed / success | 2026-11-26T06:27:11Z | 2026-11-26T06:27:17Z |

| 6 | Spike unit tests (next/) | completed / success | 2026-11-26T06:27:17Z | 2026-11-26T06:27:37Z |

| 7 | v4 server (lint + unit tests) | completed / success | 2026-11-26T06:27:37Z | 2026-11-26T06:48:52Z |

| 8 | API v2 clients and release tools (generated client current + lint) | completed / success | 2026-11-26T06:48:52Z | 2026-11-26T06:49:01Z |

| 9 | v4 web (API types current + format + typecheck + tests + build) | completed / success | 2026-11-26T06:49:01Z | 2026-11-26T06:52:23Z |

| 10 | Preserve built web for isolated browser verification | completed / success | 2026-11-26T06:52:23Z | 2026-11-26T06:52:24Z |

| 11 | Shipped data manifest | completed / success | 2026-11-26T06:52:24Z | 2026-11-26T06:52:24Z |

| 12 | Standalone assistant extension | completed / success | 2026-11-26T06:52:24Z | 2026-11-26T06:52:41Z |

| 13 | v4 release package smoke test | completed / success | 2026-11-26T06:52:41Z | 2026-11-26T06:52:43Z |

| 24 | Post Run actions/setup-node@v4 | completed / success | 2026-11-26T06:52:43Z | 2026-11-26T06:52:43Z |

| 25 | Post Run actions/setup-python@v5 | completed / success | 2026-11-26T06:52:43Z | 2026-11-26T06:52:43Z |

| 26 | Post Run actions/checkout@v4 | completed / success | 2026-11-26T06:52:43Z | 2026-11-26T06:52:44Z |

| 27 | Complete job | completed / success | 2026-11-26T06:52:44Z | 2026-11-26T06:52:44Z |



## Observation limits and sealing

One external sampler used a 60-second schedule, 31 observations, and exited normally after both runs reached terminal state. There were 1 transient GitHub API EOF reads; subsequent scheduled reads recovered. No failures, reruns or cancellations occurred in these two attempts.

Only read-only GitHub retrieval and standard-library evidence processing were performed locally. No local product import, test, lint, build, service, browser, product HTTP call, source/workflow edit, push, rerun or job cancellation was performed. Raw sources, metadata, scripts and logs remain in this evidence directory and are not publication deliverables. The two safe publication deliverables are `report.md` and `ci-verified.json`. No R5 final-review or overall completion claim is made.
