# R5 finding carry-forward replay

This is a bounded replay of three frozen R5 sources and five frozen manual requests, not a new R6 blind audit.

Result: the finite replay did not satisfy every strict check; see the retained failures.

## Execution and identity

- Frozen HEAD: `fe914065c7aafb0672bfe10274361f83179ce7f1`.
- Runtime source: 218 Python files, SHA-256 `a00155daa5515501eb3ee117f284c2ae1f8152ac038d7efa7f6208c46b8ad487`.
- All server source: 407 Python files, SHA-256 `018c572cec3c9a629b13e4ea3bf6f6b5fd1323b0581c5f696c294007c61f7b32`.
- Candidate helper SHA-256: `e9a50786e9beeb38810feb096e4d6a28bda2c1639eca567dd755c580aedbd4ae`.
- Start UTC: `2026-11-26T08:13:12.039696+00:00`; end UTC: `2026-11-26T08:13:13.986035+00:00`.
- Real PID/affinity/priority/time readbacks and source identities are in `provenance-safe.json`. The guard must read affinity 1 and BelowNormal priority 16384 before Mio import.
- Source identity unchanged: `True`; declared frozen inputs unchanged: `True`.

## Inspection checks

- C02: inspection passed `False`; automatic bindings and output scope exactly equal frozen R5: `True`.
  - `/275/inputs/image`: roles `init, ref`; pre-call requirement met `True`.
- C03: inspection passed `False`; automatic bindings and output scope exactly equal frozen R5: `True`.
  - `/3/inputs/prompt`: roles `negative, prompt`; pre-call requirement met `True`.
  - `/3/inputs/negative_prompt`: roles `negative, prompt`; pre-call requirement met `True`.
- C05: inspection passed `False`; automatic bindings and output scope exactly equal frozen R5: `True`.
  - `/21/inputs/image`: roles `control, init, ref`; pre-call requirement met `True`.
  - `/5/inputs/image`: roles `ref`; pre-call requirement met `True`.

C03 empty strings were checked as exact strings of length zero. C05 base and independent style targets were checked separately; the style target must offer only the reference role. These are manual selection hints and do not establish automatic binding identity.

## Five unchanged manual compile requests

| Source | Frozen operation | Mode | Passed | Source delta | Oracle delta |
|---|---:|---|---|---:|---:|
| C02 | 9 | explicit_mapping | True | 2 | 0 |
| C03 | 0 | explicit_mapping | True | 1 | 0 |
| C03 | 1 | explicit_mapping | True | 1 | 0 |
| C05 | 9 | explicit_mapping | True | 2 | 0 |
| C05 | 11 | exact_pointer_override | True | 2 | 0 |

Every successful row requires strict Python type and full graph equality against the unchanged pre-product oracle and frozen R5 manual result, exact output closure, preserved connections, exact effective targets, and unchanged warnings. Complete source deltas are retained, including legitimate existing pruning; no one-delta assumption is imposed. C05 independent style preserves the original exact-pointer override mode.

## Limits and evidence

- Only C02, C03 and C05 source bytes were used. Only three inspect calls and five compile calls were authorized; actual attempted counts are in `results.json`.
- Automatic binding comparison is limited to default bindings and selected output scope in those inspections. Automatic value-edit behavior for other controls and the remaining R5 or any new R6 samples was not replayed.
- Calls used an in-memory store and empty registry; no HTTP, browser, GPU, model execution, shared database, dependency installation or test suite ran.
- Raw workflow content, full product responses and errors remain in private evidence. Public values are restricted to safe pointers, roles, types, lengths, hashes, counts and synthetic numeric deltas.
- R5 first/cross seals and the R6 seen ledger were not edited.
- Results SHA-256: `9098921c9a9c81be8520bccb06c85f4377d39beef2a37e9bf03c527d88a20409`.
- Provenance SHA-256: `473e3a79bdb003167d1d2748259653310f323e66b3555cfe9ad58677a0069f7a`.
- Recorded top-level failures: `0`.

## Offline readback assessment: additional harness format condition

The first evaluator reported inspection composite 0/3 because it additionally required the label `api`. That condition was added by the replay harness and was not a pre-call candidate requirement. The exact decoded payloads are envelopes, and the sealed R5 inspections and current inspections both report `mio` for all three. This is a harness condition error, not evidence that the requested candidates were absent.

The original `results.json`, provenance, pre-call seal, and false composite remain unchanged. `report-first.md` preserves the first report bytes. No product call was repeated, no request or pre-product expected graph was changed, and no strict typed graph assertion was relaxed.

The recorded facts satisfy every requested candidate check: C03 both empty text fields offer their corresponding roles; C02 base offers init; C05 base offers init/control while the independent style target offers only ref. Candidate requirements are identical to the pre-call seal (3/3); automatic bindings, selected nodes and outputs exactly match frozen R5 (3/3); the format label also exactly matches frozen R5 (3/3). All five original manual compile requests retain their original strict graph/closure/delta checks and pass. The unplanned API-label composite remains 0/3 as an explicit execution limitation; this assessment does not rewrite it into a successful original composite.

`assessment-safe.json` SHA-256: `8ef177319b7462a320b3553344232d4ae0fe227edb70899126c29a9916fce98b`.
