# R6 V2 typed canonical-prefix correction

This is an identity-only ledger correction, not a new R6 audit, collection, graph recovery or product measurement.

## Evidence and attribution

The collector safe action plan has 35 original Civitai manifest rows from 34 public sources. Every row maps uniquely to an existing V1 entry using the exact public source URL plus the saved 12-character original prefix. The two rows sharing one public source retain separate prefixes and separate position identities. No guessed source attribution was needed.

Ten rows have saved complete raw and canonical hash records: all ten original prefixes match the saved canonical hash prefix, and zero match the saved raw hash prefix. This supports canonical semantics for those ten recorded prefixes. The other 25 rows (24 unique public sources) have no recorded complete raw or canonical hash. Their placement in this weak canonical-prefix archive is a conservative same-manifest-family policy, not 25 additional semantic proofs or recovered originals.

No original graph bytes were read or hashed. Even the ten saved-record observations are not a current raw-byte identity revalidation. No new public source or sample is included by this correction.

## Typed preservation and counts

All 262 V1 entries are unchanged field-for-field. All ten V1 index maps, including their attributed memberships and historical labels, are preserved exactly. The inherited algorithm descriptions and other V1 metadata remain historical records. The explicit V2 semantic correction takes precedence over the V1 raw-only prefix lookup guidance.

| Typed index | V1 distinct | Added distinct | V2 distinct | Added memberships |
|---|---:|---:|---:|---:|
| source_normalized | 245 | 0 | 245 | 0 |
| source_family | 204 | 0 | 204 | 0 |
| raw_actual | 213 | 0 | 213 | 0 |
| raw_saved | 148 | 0 | 148 | 0 |
| api_canonical_v1 | 116 | 0 | 116 | 0 |
| ui_canonical_v1 | 117 | 0 | 117 | 0 |
| topology_wl32_v1 | 193 | 0 | 193 | 0 |
| legacy_raw_prefix_unverified | 75 | 0 | 75 | 0 |
| legacy_canonical_unverified | 102 | 0 | 102 | 0 |
| legacy_topology_unverified | 39 | 0 | 39 | 0 |
| legacy_canonical_prefix_unverified | 0 | 35 | 35 | 35 |

The new layer has 35 distinct weak canonical prefixes and 35 position memberships. Each attribution retains the public source ID/URL, collector row, V1 identity and historical prefix declarations, plus a per-row distinction between the 10 supported records and 25 missing/unproven records. No short prefix is promoted to a full SHA-256.

## Lookup rules and remaining limits

- Check new normalized public source identity and revision-agnostic source family separately.
- Check exact new raw/full SHA-256 against the complete actual and saved raw layers; do not mix raw with canonical or topology hashes.
- Check new full canonical SHA-256 against the matching API/editor representation and declared canonical algorithm. Preserve the older unknown-algorithm canonical layer separately.
- Check the new directed-port WL32 signature against its own layer. A WL32 match is a conservative seen signal, not a complete graph-isomorphism proof.
- Check each relevant new full canonical SHA-256 by 12-character prefix against `legacy_canonical_prefix_unverified`. A canonical-prefix hit is conservatively seen; it is not full-hash identity equality.
- `legacy_raw_prefix_unverified` remains unchanged as a historical label whose semantics are unknown. It does not prove that every prefix is raw. Retain conservative comparisons as appropriate, but never use raw-only prefix comparison as a substitute for the new Civi canonical-prefix layer.
- The historical canonical serialization algorithm for these short prefixes is not established by this correction. Relevant canonical serializations must remain distinguishable; a no-hit under one serialization cannot prove novelty against an unresolved legacy algorithm.
- All historical missing-original limits remain: the original 25 Civi missing positions plus 5 other missing positions are not restored here. In total 30 historical positions remain unresolved. The 25 Civi positions still have no complete hash; source-level future candidates must not be relabelled as original-byte recovery.
- All 75 historical weak-prefix keys, the legacy full canonical/topology sets and original source/identity attributions remain present. No graph values, expected targets, oracle, product results or assets are included.

## Data schema

`entries` and the ten existing maps under `indexes` are identical to V1. `indexes.legacy_canonical_prefix_unverified` maps each 12hex prefix to an array of existing V1 identity strings. `legacy_canonical_prefix_attributions` supplies the safe source/row attribution and per-row evidence status. `index_semantics_correction` explicitly separates the preserved historical raw label from the new weak canonical-prefix comparison. `lookup_rules` states the typed comparisons; `set_counts` records before/added/after counts. `inherited_v1_metadata` is copied historical metadata, not a new execution claim.

## Input SHA-256 before and after

- `audits/r6/preflight/seen-ledger.json`: before `235c05a830a8f9a63b80d07806866412200e9d7191d1c708fa185e3c83d2d590`; after `235c05a830a8f9a63b80d07806866412200e9d7191d1c708fa185e3c83d2d590`; unchanged `True`.
- `repairs/r6-civitai-recovery-plan/action-plan.json`: before `a9dba5c76af313d428d75b3780af6d94035e4a86e308cd397f609b62e3a83edc`; after `a9dba5c76af313d428d75b3780af6d94035e4a86e308cd397f609b62e3a83edc`; unchanged `True`.
- `repairs/r6-civitai-recovery-plan/report.md`: before `1d96ca97517abd4646837bf3c7cdcdfe4f3e0889f32f7514a3b65828540bcb7f`; after `1d96ca97517abd4646837bf3c7cdcdfe4f3e0889f32f7514a3b65828540bcb7f`; unchanged `True`.

Only these three named safe files were read and re-read. No old manifest was opened separately, no directory inventory was traversed, and no original file, product, network or browser operation ran. Affinity 1 and BelowNormal priority 16384 were set and read back for the pure-file operation. V1, R5 seals and source files were not written.

`seen-ledger-v2.json` SHA-256: `7f2980c047ce6c209510d9a14d71f216c873b746cc109cf6cb3d5ff50dbb29e3`.
