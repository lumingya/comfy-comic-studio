# Current75 core replay: fixed-queue result

The parent executed the one serial guarded replay on candidate `fe914065c7aafb0672bfe10274361f83179ce7f1`. This publication only parses its existing results offline. The entry completed without a recorded execution error in 3.538806800 seconds; source and frozen-input snapshots remained unchanged.

## Exact denominator

The 230 requests are the same original fixed group: 46 API graphs times five scalar request kinds. Their frozen truth classification remains **160 automatic + 29 manual-required + 41 absent**. All 75 ordered source identities and raw SHA256 values match both the original before result and the R4 immediate before result. No source was substituted and no before run was repeated.

The 75 source queue contains 46 API graphs and 29 canvas graphs. The API graphs exercise the existing in-process import/get, inspection, LoRA descriptor, compile and diagnose paths. The 29 canvas graphs exercise decode/inspection and export guidance only. This is not 75 all-five execution, HTTP transport, ComfyUI, GPU or image-quality validation.

| Existing classification | Fixed requests | Original before equality true | R4 before equality true | Candidate equality true | Candidate equality false |
|---|---:|---:|---:|---:|---:|
| Automatic | 160 | 138 | 156 | 156 | 4 |
| Manual required: unmapped abstention | 29 | 27 | 29 | 29 | 0 |
| Absent | 41 | 41 | 41 | 41 | 0 |
| Total | 230 | 206 | 226 | 226 | 4 |

These are the existing harness's Python whole-graph value-equality checks. They are **not complete strict type-aware deltas for 230 requests**. The four candidate mismatches remain visible; completion is not a claim that every request passed.

## The 29 manual-required cases are not 29 selected mappings

The 29 cases are 18 prompt and 11 negative requests. Their original expected-target lists are empty or absent. The harness calls compile on an unconfigured document and checks conservative abstention/no write. It does not pick a target for these cases. In the existing harness, the explicit mapping loop is guarded by the separate R1 group; current75 has **zero explicit mapping operations**. R1's 20 mappings are excluded from this queue and cannot satisfy this missing coverage.

The original annotation schemas contain an origin-candidate field in 15 of these cases and omit it in 14. None of the 29 stores a selected target through the expected-target field consumed by this core harness. The 29 manual selections remain **unmeasured** by this replay. This report neither invents a selection oracle nor changes those expectations.

The classification comes from the existing repository truth document (105 requests) and frozen supplement truth (125 requests). The original harness loads them at lines 38-43, chooses the annotation source at lines 214-222, calculates classification/status and the unmapped request comparison at lines 225-234, and restricts explicit mapping checks to R1 at lines 235-249. Its aggregate count is at lines 320-322.

## Preserved scope

The existing raw-file, source-graph and source-document preservation checks remain reported with their actual observed denominators in `summary.json`. Real LoRA coverage is 2 active items and 4 weight/disable operations, with 4 whole-graph equality successes and 4 connection-preservation successes. This queue does not replace dedicated M1/M2 regressions or a fresh independent audit.

## Recorded identity

- Entry UTC: 2026-11-26T08:04:08.928806+00:00 to 2026-11-26T08:04:12.467611+00:00.
- PID: 6700; pre-import affinity read-back `0x1`; priority class `16384`; one Python process.
- Candidate backend: 218 files, SHA256 `a00155daa5515501eb3ee117f284c2ae1f8152ac038d7efa7f6208c46b8ad487`.
- Full server: 407 files, SHA256 `018c572cec3c9a629b13e4ea3bf6f6b5fd1323b0581c5f696c294007c61f7b32`.
- New helper SHA256: `e9a50786e9beeb38810feb096e4d6a28bda2c1639eca567dd755c580aedbd4ae`.
- Original before result SHA256: `a98280b29744188bcd71b03677a514b1a82b9515db8b178e46468cc5c2643ab0` (206/230).
- R4 before result SHA256: `3ee3aabd2538cc13a64f28ccdefee38593811fd4fa990b306b362f188155dcdc` (226/230).
- Candidate private result SHA256: `9ef0b4784a88e30e0bb442617b079f8c0f9a577cdb9168f6749b2007c370fe48` (226/230).

Input hashes, private-artifact hashes and successful source/input read-backs are recorded in `provenance-safe.json`. Safe per-source identities, raw hashes and fixed counts are in `summary.json`; source URLs are hashed. No source text, asset names, source values, private paths or credentials are projected.
