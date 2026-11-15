# Text metrics task example

This example runs entirely locally and does not contact a model or network service. Copy this
folder into `<data>/extensions/text-metrics`, inspect its code, enable its current digest through
`POST /api/v2/extensions/text-metrics/enable`, then restart once to mount its typed route.
Installation and enabling require `admin` scope.

1. Discover the reviewed identity with `GET /api/v2/job-executors` (`read`).
2. Submit `POST /api/v2/ext/text-metrics/count` (`render`) with
   `{"text":"A quiet room", "idempotency_key":"example-1"}`. It returns `202` with `job_id`.
   Repeating the same payload and key returns the same task; a changed payload conflicts.
3. Poll `GET /api/v2/jobs/{job_id}` (`read`). Once completed,
   `items[0].result` is `{"characters":12,"words":3}`.
4. Read `GET /api/v2/jobs/{job_id}/events` or `/deliveries` for diagnostics (`read`).
   If execution fails, use `POST /api/v2/jobs/{job_id}/retry` with `{"indexes":[0]}` (`render`).
   If a result has already arrived, use `POST /api/v2/jobs/{job_id}/items/0/replay-result`
   (`render`); it applies the saved result without calling `execute` again.

The task retains its exact kind/source/digest across restarts. A changed or missing extension
blocks queued work, and missing result handlers cannot silently fall back to another executor.
Re-enable the original reviewed bytes to recover. Administrative rebinding to a different
identity is only permitted for tasks with zero attempts and no results or endpoint lease.

`replay_safe = True` is appropriate here because delivery has no external side effects. An
extension that changes a work must save its mutation and a receipt for `item['delivery_id']`
in one transaction before making that declaration. See the
[SDK executor contract](../../../server/mio_server/extensions/README.md#任务执行器).
