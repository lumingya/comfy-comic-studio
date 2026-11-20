# Independent Windows path and launcher recheck

Reviewer: adjacent_generation_data, not an author of the Windows theme, backup or extension
repairs. Production was read-only. Reviewed commits 2648236, fc62363 and 8ba6829, plus the
current ApiCase fixture and CI configuration. Export path ownership was repaired separately
by this reviewer in 4ac2ae5 and is not claimed as an independent review here.

## Results

- Ordinary 8.3 aliases are accepted by checking actual lstat metadata instead of comparing
  raw and resolved path strings. The real Windows GetShortPathNameW test confirms the alias
  refers to the same ordinary directory and that theme package/resource checks accept it.
- fs_paths.regular_path_metadata checks every existing ancestor before resolving or reading.
  A missing leaf does not skip the ancestor checks. Actual Windows junction rejection and
  simulated reparse-ancestor tests pass; aliases do not weaken these rejection paths.
- Backup recovery, theme and UI-data enumeration retain the source path spelling after
  component checks and compare resolved containment on both sides where needed. Their
  ordinary expanded-spelling and missing/reparse tests pass.
- Extension dependency requirements are checked by private_store.regular_path before
  inside resolves the path. The former resolved-string inequality is removed, while file
  type, ancestor/reparse checks, content bounds, reviewed activation and pip preflight
  protection remain. All pip-facing dependency tests use mocks, not network installation.
- Extension removal still validates the code/data trees before deactivation and rechecks
  them afterwards. Existing busy-service, ancestor/nested reparse, owner identity and
  data-retention tests pass. Removing resolved-string equality does not remove lstat checks.
- ApiCase uses ctx.data_dir for its exposed temporary workspace identity, so downstream
  tests compare the canonical directory actually retained by the app rather than a different
  Windows alias. No production validation or HTTP assertion was relaxed by this change.
- CI setup-python selects 3.11 for both launcher matrix jobs, and the launcher test step
  explicitly sets PY_PYTHON3='3.11'. Since start.bat invokes py -3 when available, the launcher
  now requests the tested matrix minor version rather than another installed Python 3.
  Both gate and launchers have a 30-minute budget; the Python dependency step precedes Spike.

## Actual checks and limits

Focused local Windows Python 3.13 checks: 50 cases collected, 47 passed, 3 skipped.

- Windows alias and backup path tests: 10 cases, 8 passed; 2 symlink-creation cases skipped
  because that privilege is unavailable. Real 8.3 samefile and real junction cases passed.
- Extension requirements: 22 passed, with subprocess installation mocked.
- Extension data/removal guards: 6 passed.
- Launcher static batch/shell contract: 12 cases, 11 passed, 1 unavailable shell check skipped.

No remaining concrete P0-P2 defect was established in these Windows repair boundaries.
This is not a claim that the actual GitHub Actions Python 3.11 matrix passed: that requires
the remote run. No full suite, real launcher dependency installation, service, user-data
operation, new browser installation or network request was used for this review.
