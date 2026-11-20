# Other-file review: backup path spelling compatibility

## Final assigned scope

This pass owns only `backups/service.py`, `backups/themes.py`, `backups/ui_data.py`,
the new `test_backup_path_aliases.py`, and this report. Existing template CSP and today’s
feature-contract reviews were not repeated. Other working-tree and staged changes were kept.

## Finding and fix

**P2 — ordinary Windows 8.3 paths were treated as redirected filesystem paths.**
`service.Backups.__init__`, `service.Backups._folder`, `themes.theme_files`, and
`ui_data._directory` compared a resolved path to its original spelling. Windows may expand
an ordinary `RUNNER~1` component when resolving it, without any symlink or junction. The
comparison therefore rejected valid local backup directories.

The three modules now use filesystem metadata to establish safety. The service’s former
leaf-only checker delegates to `private_store.regular_path`, which checks all existing
ancestors and rejects symbolic links, Windows junction/reparse points, and nonregular files.
The remaining containment comparison resolves both sides. Themes and UI catalogs retain
the original absolute path, check it before traversal, and no longer reject a harmless spelling
change. No security assertion was removed or weakened to make tests pass.

## Independent regressions

`test_backup_path_aliases.py` covers:

- recovery-directory initialization and child lookup when resolution expands an ordinary alias;
- theme enumeration and typed UI-preference file paths under the same expansion;
- a mocked ancestor reparse point rejected before any recovery directory is created;
- real ancestor symbolic links when the host permits their creation.

These portable alias tests model a Windows spelling expansion without creating a redirect.
They do not claim that an actual NTFS short-name alias was provisioned on this host.

## Validation

- New alias regressions: 5 tests, 4 passed and 1 skipped because this host could not create
  a real symbolic link. The ancestor reparse-point regression ran and passed.
- Existing `test_backup_catalog`: 8 passed, including preflight rejection of links/reparse
  points and retained restore protection.
- Existing `test_backup_themes`: 3 passed, including real restart restore.
- Existing `test_backup_ui_data`: 10 passed, including reparse rejection, private-state
  preservation and restore coordination.
- Ruff check, Ruff format check and whitespace checks passed for the owned files.

All fixtures used fresh temporary directories. No personal data, external requests, full-suite
run, global deletion, browser installation or live generation was involved.

## Earlier read-only storage observations handed to the coordinator

Before the narrowed compatibility assignment, temporary probes identified an outstanding
render/trash lifecycle failure and a restore-imported absolute export-job ID containment
failure. Those were reported directly to the root agent for separate ownership; they are not
claimed as fixed or re-reviewed by this compatibility commit. The new short-path fix does not
modify export jobs, trash, assets, restore database validation or the previously reported CSP.
