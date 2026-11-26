# R6 V3 pure supplemental identity union

This is a two-file identity merge, not an audit, collection, product replay or original-byte recovery.

## Preserved boundary

All 262 V2 entries remain unchanged field-for-field and in order. Every V2 index key and attributed membership remains present. The complete V2 weak-prefix maps, 35 per-row canonical-prefix attributions, semantic correction and typed lookup rules are copied exactly. The historical raw-prefix label remains unknown semantics; the new canonical-prefix layer must still be compared with new full canonical hash candidates, not substituted with raw-only prefix checks.

The increment contributes one supplemental identity from public source 2539304. Its existing public source keys gain one new content membership; no new public source key is added. Full raw, editor/UI canonical and WL32 each gain one attributed membership; the exact new-versus-overlapping key counts are shown separately below. This UI fingerprint does not imply an executable API workflow or successful product import.

The upstream collector measured the supplemental file. No raw file was opened or rehashed here. The original missing record is retained, and identity with its historical bytes is not proven. No missing-original count is reduced: the historical 25 Civi missing positions plus 5 other missing positions remain unproven. The upstream increment reference to an older ledger is retained only as collector provenance; the actual merge base is the explicitly hashed V2 input.

## Exact typed counts

| Layer | Before keys | Increment keys | Overlap keys | New keys | After keys | Before memberships | New memberships | After memberships |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| source_normalized | 245 | 1 | 1 | 0 | 245 | 255 | 1 | 256 |
| source_family | 204 | 1 | 1 | 0 | 204 | 215 | 1 | 216 |
| raw_actual | 213 | 1 | 0 | 1 | 214 | 232 | 1 | 233 |
| raw_saved | 148 | 0 | 0 | 0 | 148 | 158 | 0 | 158 |
| api_canonical_v1 | 116 | 0 | 0 | 0 | 116 | 157 | 0 | 157 |
| ui_canonical_v1 | 117 | 1 | 0 | 1 | 118 | 136 | 1 | 137 |
| topology_wl32_v1 | 193 | 1 | 0 | 1 | 194 | 259 | 1 | 260 |
| legacy_raw_prefix_unverified | 75 | 0 | 0 | 0 | 75 | 75 | 0 | 75 |
| legacy_canonical_unverified | 102 | 0 | 0 | 0 | 102 | 102 | 0 | 102 |
| legacy_topology_unverified | 39 | 0 | 0 | 0 | 39 | 49 | 0 | 49 |
| legacy_canonical_prefix_unverified | 35 | 0 | 0 | 0 | 35 | 35 | 0 | 35 |

Position entries: 262 + 1 = 263. No new typed index layer is required. There are still eleven separately typed maps; hashes are never merged into a single untyped set.

## Schema and provenance

`entries` appends one compatible supplemental record while preserving all upstream collector fields. `indexes` retains every V2 key/list prefix and appends only the new memberships. `set_counts` separates overlapping source keys from new content keys and from membership additions. `source_attribution_addition` connects the supplemental content with its existing public-source position without replacing that historical position.

`index_semantics_correction`, `lookup_rules` and `legacy_canonical_prefix_attributions` are exact V2 copies. `inherited_v2_metadata` and `increment_metadata` retain historical receipts without relabelling them as current raw-byte observations. `source_inputs` contains the only two inputs and before/after hashes.

## Input SHA-256 before and after

- `audits/r6/preflight/seen-ledger-v2.json`: before `7f2980c047ce6c209510d9a14d71f216c873b746cc109cf6cb3d5ff50dbb29e3`; after `7f2980c047ce6c209510d9a14d71f216c873b746cc109cf6cb3d5ff50dbb29e3`; unchanged `True`.
- `repairs/r6-civitai-static-recovery-redirectfix/seen-increment.json`: before `fbc00ba3a7a6a005fecd7ac119c7f2fc73e3459de055dae0a7bbabfcd518870d`; after `fbc00ba3a7a6a005fecd7ac119c7f2fc73e3459de055dae0a7bbabfcd518870d`; unchanged `True`.

Only the two named JSON identity files were read and re-read. There was no directory inventory, original graph, oracle, result, network, browser or product access. Affinity 1 and BelowNormal priority 16384 were set and read back for this pure-file operation. Earlier ledger and sealed files were not written.

`seen-ledger-v3.json` SHA-256: `a6b4c101ba737e458a87e95222abadad68916cb06d3826b5211d9f0e8bab0d53`.
