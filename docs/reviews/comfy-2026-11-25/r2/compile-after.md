# R2 compile repair retest

Date: 2026-11-26. Result: **PASS for the original repair cases only**. No still-failing case was found in this assigned retest scope. This is not the next independent final audit. The frozen R2 audit remains **REQUEST CHANGES** and all original failure evidence remains unchanged.

Target: current uncommitted repair working tree on HEAD `6f9bdf2c56994397754f4ec2c782f1ab63bc75a0`. Product files were not edited, no commit was made, and no database, live service, GPU, browser, paid API, or model was used. This retest executed only neutral synthetic compile/inspect/diagnose functions. Product source fingerprints are recorded in `summary.json` to identify the observed working tree independently of its unchanged HEAD.

## Preservation of original failure evidence

Before retesting, the original compiler JSON still contained tests=8, failures=3, errors=0 and all original graph cases. The original LoRA JSON still contained eight cases with null-placeholder AttributeError, blank-placeholder deletion, integer-gate 1-to-On conversion, float-to-int conversion and numeric-string conversion. These match the semantic content captured in this audit's first tool outputs. The original report still says REQUEST CHANGES.

The initial audit did not capture a creation-time hash. Therefore this check cannot certify that a restored file is byte-for-byte identical to its November 25 creation; it confirms that the reported old failures remain and that all original `.py`, `.json`, and `.md` files stayed byte-identical throughout this retest. Hash manifests are in `evidence_preservation_before.json`, `evidence_preservation_after.json`, and `original_final_hashes.json`. The LoRA sub-audit additionally recorded copy and integrity hashes in its own files.

Key preserved SHA-256 values:

| Historical file | SHA-256 |
|---|---|
| compile/report.md | A476C38909EEF144263339D303ADC46574ED0908739D06A2CD3F2E962D28EBDC |
| compile/probe_results.json | E4B962073A4E2ADC16209FB282E7C8536C5A84DC4C2DBDC1508333AE22D8F9BD |
| compile/lora/results.json | CDC644685F395467650562C0D3454DAC72D74AFE50D3EAEE90E91A986FF1BB86 |

Count correction recorded here without editing history: the frozen report said nine compiler graph cases; its JSON actually contains ten (two selector states and two stage/regional cases account for the extra records). It still has eight test methods and three original failing methods. This was a report count error, not a loss of an original case.

No original entry point was run. The compiler source was copied byte-for-byte into `source-copies`, loaded with a non-main run name, and its eight methods were executed with results directed here. The obsolete-LoRA test's old deliberate failure after unsafe compilation was replaced in the retest subclass with the expected structured BindingError assertion; the exact original graph and compile call remained unchanged. The LoRA worker ran byte-identical script copies in the new LoRA directory, never the original paths.

## Original findings after repair

| Finding | Result | Evidence |
|---|---|---|
| C1 Medium: reference-image size was overwritten | Repaired for the original case. Only generation latent width/height/batch change; reference 256x256 remains intact. Type-sensitive whole-graph expected diff has no unexpected change. | `compile-after.json`, `exact-regression-checks.json` |
| C2 Medium: inferred seed changed the final selector after binding | Repaired for the original case. Final select=2 binds and updates q, while p stays unchanged. Inspection now reports q.text. | `compile-after.json`, `exact-regression-checks.json` |
| C2 second manifestation: stale LoRA activity escaped validation | Repaired by clear BindingError for the exact original keyed request after final seed changes the active model branch. Source document remains unchanged. | `compile-after.json`, `exact-regression-checks.json` |
| C3 Medium: null/blank object placeholder crashed or disappeared | Repaired for original raw-list cases and independently rechecked wrapped-null case. Placeholder order, marker and wrapper data remain; only selected ink strength changes. | `lora/results.json`, `exact-regression-checks.json` |
| C4 Medium: untouched integer gates became strings | Repaired. Both gates remain int1; only strength_1 changes. Declared INT diagnostic has no invalid input after compilation. | `lora/results.json`, `exact-regression-checks.json` |
| C5 Low: untouched active object representation changed | Repaired for original integral-float/numeric-string/on-only cases. Unedited types and optional fields remain exact. | `lora/results.json`, `lora/summary.json` |

No original Blocker or High existed. All four original Medium roots and the Low representation issue are covered above. The old ungraded observation concerning an extra same-name mirror tag also now preserves the additional tag and prose; the first owned tag alone changes (`lora/summary.json`).

## Checks run and limits

- Compiler retest: eight method-equivalent expectations pass, with no failure or error. Ten graph-case records are retained in `compile-after.json`. Six additional explicit checks pass in `exact-regression-checks.json`, including final inspection target, wrapped-null preservation and declared integer-gate validity.
- The original compiler positive coverage remains green: simultaneous core scalar/text/reference writes; unrelated metadata/types/links; pointer and selector priority for both states; second-stage/reference-conditioning and distinct regional prompt protection; bool numeric exclusion; shared dimensions; unknown transforms and auxiliary selector output refusal.
- LoRA retest: all eight original cases pass exact expected deltas, plus all five original positive probes. These include sparse repeated stable keys, disabled saved weights, and dormant simple/advanced-mode values. Detailed independent report: `lora/report.md`.
- The first local retest-runner launch stopped before any product probe because its preservation precheck repeated the frozen report's incorrect nine-case count. Reading the existing JSON established ten, and only the new runner was corrected. All later after results use the correct count.
- No full gate, CI rerun, new blind hunting or new final-audit claim is included. The fixes' generalization beyond the assigned original cases remains for the next review round. Static compile delta correctness does not certify real ComfyUI plugin validation, installed dependencies, GPU execution or image quality.

## Evidence and temporary directories

Primary files: `report.md`, `summary.json`, `compile-after.json`, `compile-unittest-after.txt`, `exact-regression-checks.json`, the three original-evidence hash manifests, `retest_compile.py`, and `finalize_retest.py`. LoRA artifacts and copied script details are listed in `lora/report.md`.

New retained directories created/used for this retest:

1. `<task-temp>\repairs\r2-compile-retest`
2. Its `source-copies` subdirectory.
3. Its `lora` subdirectory.

Historical directories were read only: `audits\r2\compile` and `audits\r2\compile\lora`. Original R2 outcome and failure JSON files were not rewritten. Collect the new after evidence independently from the original failed-audit materials before final cleanup.
