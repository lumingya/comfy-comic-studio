# Independent cloud-recipe privacy recheck — 2026-11-20

## Scope

Reviewer: `adversarial_security_final`, who did not author this production fix. Review began at main `cbf81ad` plus the new `CloudRecipe.bounded_options` validation. It was limited to portable recipe credential rejection, nested arrays, historical malformed profile reads, request error diagnostics and current-credential binding. Production files were read-only; the reviewer owns only this report and `server/tests/test_cloud_recipe_privacy_recheck.py`.

All probes used temporary `ApiCase` workspaces, synthetic credential strings and an in-memory client object. No personal data, external calls, real generation, service restart or full-suite run was involved.

## Standards and spec conclusions

- The portable recipe is an ordinary-parameter snapshot. `CloudRecipe` now applies the bounded JSON policy first, then iteratively checks dictionaries and lists for the shared sensitive field-name policy. It rejects credential fields at any reviewed depth rather than depending on later response masking.
- The normal `ImageChannel` configuration remains the place for credentials. Its mask/current-secret behavior is retained; the recipe validator does not prevent configured channels from using current credentials at execution time.
- No unresolved privacy or documented-standard defect was established within the final reviewed delta. This conclusion is scoped to the contract above, not a claim that arbitrary text can be recognized as a credential.

## Independent evidence

### Nested arrays fail closed before persistence

The new test submits a portable profile whose `extra_options.accounts` contains an array inside an array, then a metadata object with `X-Session-Key`. Both `/api/profiles` and `/api/v2/profiles` reject it with 422. The profile id is absent from the document table after each rejection. This checks a shape beyond the owner's single-array fixtures.

### Historical invalid profiles do not disclose stored values

A temporary raw SQLite profile record represents data written before the new validator: its portable options contain an `auth` credential. With a read-only v2 token, both profile-list and profile-detail reads return a structured 400 error. Neither response contains the synthetic stored value or Pydantic's `input_value` diagnostic. The existing `StrictModel.hide_input_in_errors` setting therefore protects this historical read-error path; no successful credential-bearing profile is returned.

### Current credentials and frozen ordinary values remain distinct

`capture_channels` copies a configured channel into a portable recipe while removing a nested Cookie value. The configured channel is then changed to a new model, quality, limit and Cookie. `bind_request` produces an execution client using the current Cookie while retaining the recipe's original model, quality and limit. The current channel object remains unchanged, and neither the old nor current Cookie appears in the frozen snapshot. The recipe contains no Cookie field.

## Additional request-error issue found and repaired

During the first run, the credential-bearing new profile was correctly rejected but FastAPI's default 422 response included the submitted credential in `detail[].input`. This was request-body echo, not a leak of a historical stored credential to a read-only caller. The parent elected to remove that echo as well.

The owner added `api/validation.py` and registered its `RequestValidationError` handler on both the main app and the v2 subapp. It retains only `loc`, `msg` and `type`, excluding raw input and validation context. The generic CloudRecipe rejection message contains no submitted values. The local handler landed during the first test process; only the v2 assertion still failed in that run. A new process after both registrations were complete passed the affected method for both routes.

## Validation record and handoff

- New test file: three methods. First run passed historical read privacy and current-credential/frozen-option fidelity; nested-array rejection passed its status/persistence boundaries but detected the v2 request echo described above.
- Independent affected-only rerun after the shared validation-handler fix: one method passed in 1.041 seconds, covering both local and v2 requests.
- Scoped Ruff, formatting, UTF-8 and diff checks passed for the two owned files.
- The parent owns broader lifecycle/backend and final CI gates. No generated schema or production file was edited by this reviewer.
- A different reviewer can finish the requested fresh-agent loop by checking the small shared request-validation handler and its two app registrations, using this report and the new test. The original portable-recipe fix and the historical read/current-binding invariants are independently verified here.
