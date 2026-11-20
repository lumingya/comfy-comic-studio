# Restored export path repair and verification

## Finding and boundary

P1: a terminal export restored from SQLite could use an absolute or traversing jobs.id.
ExportService.result previously joined exports / job_id / file without validating job_id,
so an absolute identifier selected a different directory containing a numeric .bin leaf.
All probes in this repair use temporary neutral sentinel files; no user files were read.

## Repair

- Export job IDs now require bounded job_[0-9a-f]+ syntax before result lookup, execution,
  cleanup or removal joins. Numeric result leaves are bounded and exclude separators,
  drive syntax, alternate streams and non-string metadata. Attempt identities are
  non-negative SQLite-range integers.
- Existing path components are inspected with regular_path_metadata before resolving.
  Symlinks, Windows reparse points, unexpected node types and multiply linked output
  leaves are rejected. Canonical containment compares both sides, preserving ordinary
  Windows short-name aliases without accepting redirected ancestors.
- Abort, writer rollback, stale-file cleanup and synchronous-download finalizers recheck
  ownership before unlinking. A replaced directory is retained for manual inspection;
  cleanup does not follow it into another temporary or user directory.
- Backup validation rejects invalid jobs.id values, actual job_id database columns,
  workshop launch receipt IDs, typed Take.job_id fields and export result filenames.
  It deliberately leaves opaque workflow inputs, cloud options and extension payload
  fields named job_id uninterpreted. An independent reviewer caught that overbroad
  first draft; it was removed before this commit.

## Verification

- New test_export_restore_paths.py covers invalid IDs before any lookup/write, bounded
  result leaves, simulated ancestor reparse points, ordinary alias spelling and backup
  database IDs/references. Link/rollback/finalizer cases use temporary sentinels only.
- Combined new tests, independent test_export_path_independent.py, test_export_jobs.py
  and test_backup.py: 47 cases passed, with 4 real symbolic-link cases skipped because
  this Windows host cannot create those links. The simulated reparse case runs, and
  the independent reviewer verified real hardlink rejection in its separate tests.
- Ruff check, Ruff format check and diff whitespace validation pass for owned files.

No network, running service, browser or personal data was used. This path check does
not claim to defeat a malicious same-user process racing filesystem operations between
validation and opening a file; the shared component guard documents that limitation.
