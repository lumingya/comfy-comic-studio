# Fresh recheck: canonical workspace identity after link validation

Target: `fe28588` and the current integration. This pass only reviewed the final Windows
path-identity fix in `AppContext.create`, the component guard it calls, shared fixture
identity and the directly affected existing tests. Production files remained read-only.

## Evidence for the failure

The Windows/Python 3.11 log from run `44725113411`, saved as
`%TEMP%/mio-final-windows311.log`, shows the remaining failures comparing ordinary aliases:

```text
WindowsPath('C:/Users/runneradmin/.../extensions_data/demo')
!= WindowsPath('C:/Users/RUNNER~1/.../extensions_data/demo')
```

The prior fixture correction to `self.tmp = str(ctx.data_dir)` alone could not reconcile
these paths while `ctx.data_dir` still retained its supplied short spelling and
`PrivateStore` canonicalized its workspace. The mocked link/reparse-path targets then used
a different spelling from the paths inspected by production code.

## Rechecked fix and security order

`AppContext.create` now performs:

1. Convert the supplied directory to an absolute path.
2. Call `regular_path_metadata(..., directory=True, missing=True)` on that spelling.
   The helper inspects every existing ancestor and the target with `lstat`, rejecting
   symlinks, Windows reparse points and non-regular filesystem nodes.
3. Resolve to one canonical spelling, then acquire the workspace lease and construct all
   services from that same path.

This preserves the critical validation order: canonicalization does not hide an existing
junction before it is inspected. The workspace is checked before `prepare_workspace` and
before `_create` calls `mkdir`. `ApiCase.self.tmp`, extension code roots and SDK private
roots now derive from the same canonical `ctx.data_dir`.

## Independent validation

- `tests.test_context_path_identity`: 2 tests passed.
- The SDK isolation case, theme symlink-preference case and
  `tests.test_private_data_lifecycle`: 14 tests passed.
- An extra temporary Windows probe generated an actual 8.3 alias with
  `GetShortPathNameW`; results were `alias_different=True`, `samefile=True`,
  `context_matches_canonical=True`, `SDK_root_matches_context=True`.
- An extra actual Windows junction probe supplied a missing workspace below a junction.
  It was rejected with `ValueError`; a spy confirmed `prepare_workspace` was not called,
  and the target directory was not created in the referenced directory.

No residual P0-P2 issue was established in this specific context-identity change. The
helper documents the limit against a separate same-user process racing filesystem calls;
this review does not claim to solve that race. Local validation used Windows Python 3.13,
so the next Windows/Python 3.11 Actions result remains the final matrix confirmation.

No network/model call, personal data, broad repository search, full suite or production
service was used in this recheck.
