# Independent final validation privacy recheck - 2026-11-20

Reviewer: `backend_gap_audit`, who did not author the portable-recipe guard or the shared
request-validation handler. Review input was HEAD `428a1af` plus the current working-tree
repairs in `api/validation.py`, its main/v2 registrations and `CloudRecipe.bounded_options`.
This review owns only this report. Production and tests remained read-only.

## Scope and conclusion

No remaining actionable issue was established within this bounded review. The previous
credential echo in FastAPI's default request-validation response is closed for the portable
recipe paths under review, and the structured HTTP 422 contract is retained.

- `api/validation.py:request_validation_error` returns status 422 with a `detail` array. Each
  entry is restricted to `loc`, `msg` and `type`; request `input`, validation `ctx`, the raw body
  and exception string are not serialized. Tuple locations are encoded as ordinary JSON arrays.
  This preserves the standard field-location/message/type information used for form errors.
- `api/__init__.py:create_app` registers this handler for `RequestValidationError` on the main
  application, and `api/v2.py:build_v2` registers the same handler on the mounted v2 app.
  The v2 scope/authentication setup and domain-error handlers remain in place.
- `CloudRecipe.bounded_options` validates bounded JSON before its iterative dictionary/list
  traversal and rejects the shared credential-field policy at nested depths, including nested
  arrays. Its error messages are fixed text and contain no submitted credential value, so the
  retained `msg` is safe for the reviewed rejection path. Ordinary channel configuration can
  still hold credentials; only portable ordinary-parameter recipes reject them.
- Historical invalid stored profiles continue through the domain validation-error response
  with status 400 and `kind: invalid`, without echoing the stored credential. That is distinct
  from the HTTP request-validation 422 path and remains covered by the independent regression.
- Current-secret binding still combines the recipe's frozen ordinary model/options with the
  current configured credential, without putting old or current secrets into the snapshot or
  mutating the current channel configuration.

## Fresh-process verification

Executed from `server/` in a new Python process:

```text
python -m unittest tests.test_cloud_recipe_privacy tests.test_cloud_recipe_privacy_recheck -v
Ran 5 tests in 5.900s
OK
```

The five methods cover the owner's credential-name matrix and nested configured-channel
capture, plus the earlier independent review's nested-array local/v2 rejection, historical
list/detail read privacy, and current-credential/frozen-option fidelity. Local/v2 HTTP 422
responses omit the synthetic request credential, rejected profiles leave no stored document,
and the owner's response-shape assertion permits only `loc`, `msg` and `type` keys.

No assertion was changed and no new production or test file was written. There were no external
requests, personal-data reads, service actions or full-suite runs. This result applies to the
shared handler and portable-recipe contract inspected here; it does not claim automatic
recognition of secrets stored as arbitrary unlabelled text or audit every extension's custom
validation message. The parent agent owns the final integrated gates, commit and push.
