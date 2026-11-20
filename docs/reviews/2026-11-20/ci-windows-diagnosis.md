# Windows path-guard CI diagnosis

Scope: the pre-existing Windows/Python 3.11 failures in run `44592216873`, using the
read-only log `%TEMP%/mio-ci-previous-failure.log`. Investigation and focused repairs used
fresh temporary folders. No personal data, model request or production service was used.

## Established cause

The main failure is a path-identity mistake, not evidence that ordinary files have the
Windows reparse-point attribute. Theme package and attached-resource checks compared
`path.resolve()` with `path.absolute()` and treated different spellings as links. A normal
Windows 8.3 alias resolves to the long name, so this rejects a safe ordinary directory.

The CI log contains the diagnostic pair `C:/Users/runneradmin/...` and
`C:/Users/RUNNER~1/...` in `test_sdk_data_is_isolated_and_default_uninstall_keeps_all_data`.
Many imports fail on a not-yet-created theme directory below that temporary root, producing
the shorter missing-path error before any asset read. The old Windows job reported 35
failures and 13 errors, including theme installation, extension removal and retained state.

## Tight reproduction

The initial probe created one temporary ordinary long directory and called Windows
`GetShortPathNameW`, then passed that alias to the actual `_regular_path` implementation:

```text
samefile: True
leaf_reparse: False
absolute: ...\MIO-CI~1\ALONGD~1
resolved: ...\mio-ci-long-path-...\a long directory with spaces
RESULT=ThemePackageError
```

`python -m unittest tests.test_windows_path_aliases -v` before the production repair returned
2 errors for ordinary short aliases and 1 failure for a mocked reparse ancestor. After the
repair the same cases pass; the new real junction test also passes. This loop tests both
acceptance of aliases and preservation of the rejection boundary.

Ranked hypotheses and outcomes:

1. 8.3 long/short-name canonicalization is mistaken for redirection — confirmed by the
   same-file probe and CI's `runneradmin`/`RUNNER~1` path mismatch.
2. Ordinary temporary files have reparse metadata on Windows/Python 3.11 — not established;
   the reproduced ordinary alias has no reparse bit and the check still failed.
3. The reported `expected 400, got 200` symlink test indicates the actual guard accepts a
   link — the CI case instead patches a short-name fixture path while the application uses
   the canonical long path, so its `Path.lstat` patch does not match the application's path.

The latter mismatch is in `ApiCase.self.tmp = tmp.name` versus canonical `ctx.data_dir`.
The owner normalized the shared fixture identity while retaining the original HTTP 400
assertions. Existing private-store component checks already inspect link/reparse metadata.

## Scoped repair

- New `fs_paths.regular_path_metadata` inspects every existing ancestor and the target with
  `lstat`, checks regular file/directory type and rejects symlinks plus Windows reparse
  attributes before later filesystem operations. It accepts ordinary aliases and supports
  a missing final component without trusting a redirected ancestor.
- `theme_packages._regular_path` and `theme_media.validate_theme_resources` use that common
  check instead of resolved-string equality.
- The existing missing-root test keeps its safety assertions but now simulates the actual
  ancestor `lstat` boundary rather than substituting a string returned by `resolve()`.
- Root separately owns extension removal/dependency guards and fixture identity changes;
  the same raw `resolve() != absolute()` pattern was reported in backup helpers for review.

This does not claim to defeat a same-user process racing filesystem operations. Metadata
checks still run before reads and writes; no safety check was removed merely to pass CI.

## Validation and limit

- New alias/link tests: 5 run, 4 passed and 1 skipped because creating symbolic links is
  not permitted locally. Real Windows junction rejection passed without that privilege.
- `tests.test_theme_packages`: 29 passed.
- `tests.test_theme_preferences`, `tests.test_private_store`,
  `tests.test_extensions.ThemeApiTests`: 18 passed.
- Ruff check/format and `git diff --check` passed for owned files.
- The local runtime is Windows Python 3.13; Python 3.11 was not installed for this probe.
  Actual matrix confirmation remains the next GitHub Actions run. These focused results
  predict closure of the theme alias failures, not a verified count of all 48 old failures.
