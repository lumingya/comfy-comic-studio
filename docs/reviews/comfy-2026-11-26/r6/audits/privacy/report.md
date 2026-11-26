# R6 privacy / hygiene / CI — initial review

Frozen candidate: `fe914065c7aafb0672bfe10274361f83179ce7f1`.
Full review range: `38838ab43cf3d056951f2fc6c52afb737d34e3c6..fe914065c7aafb0672bfe10274361f83179ce7f1`.

Initial product assessment: **no product Medium or higher finding identified in this role's static scope**. This is an initial assessment, not a cross-review verdict or a delivery signature. No same-round peer-role report or finding was read before this seal. The internally delegated CI sub-audit is part of this privacy role and is disclosed below.

The formal common brief, role acceptance and root authorization match their supplied SHA256 values. The original task, AGENTS, README and ROADMAP were loaded under bounded projections. The candidate worktree was clean on entry. This role made no repository write, commit, push, product import, product call, browser call, network request, local gate, build, E2E run, installation or restart. All generated files are confined to `audits/r6/privacy/` under the owned evidence root.

## Independent evidence checks

- Examined the complete range as 224 actual candidate Git blobs. Six private-path / credential-pattern classes produced zero matching files. This is a bounded static scan, not a claim that arbitrary natural-language strings can never identify a person. The added Python-line boundary review found two production error-construction calls with constant strings; it found no added print/log/write/serialization sink in the changed production Python paths. The broader AST call inventory, including test-only calls, is preserved in `static-boundaries.json`.
- Checked all 29 changed fixture/contract/test files selected by the server fixture/test and frontend test paths, without emitting asset literals. The 77 changed documentation JSON files contain zero graph-shaped API/UI graph containers and zero large embedded data URLs. The filename-field projection has 105 matches: 93 are public-source basenames and 12 are audit-screenshot reference identifiers. These are identifiers in evidence, not evidence of local model data or credentials. Neither those names nor screenshot contents were projected.
- Verified all **71** history-publication rows against actual candidate Git bytes, SHA256 and Git blob SHA1, including independent `git rev-parse <tip>:<path>` identity. All match. Resolved all **62** manifest-whitelisted source rows to bytes matching their recorded original SHA256. The source count includes multiple explicitly declared projections to a destination; it is not 62 unique published files. All declared published hashes and blob identities match. Forty-four source rows differ at most by LF/EOF normalization; 22 are byte-identical.
- Checked retained values and conclusions separately from publication hashes. There are 39 JSON-source rows; after declared projection-field selection there are zero modified shared non-string scalar values and zero modified shared verdict/status/result scalars. The Markdown source/publication verdict-marker sequences are unchanged. Projected records intentionally omit private operational fields or contain a bounded derived summary; these are not claimed to be byte-identical copies. The failed-R5 round retains its failed status, two deduplicated product Medium findings, all three distinct process events, the two truncated-scope non-clearance flags, the third event's separate request-block accounting, and the requirement for a fresh five-role review. It does not claim cleanup or delivery was signed.
- The eleven exact removed-token cross-hits in the R4 archive were independently adjudicated. Every one is a `public_sample` field at corpus sample indices 50–60, equals the basename of the same row's public HTTPS GitHub/raw source URL, and has a full source SHA256. They are public provenance identifiers, not a local-asset inference. Their values were not echoed. Thirty-one targeted name fields in the failed-R5 privacy seal publications have no unchanged exact source value; unchanged `name` fields elsewhere are public CI/job/test or allowlisted source-artifact metadata. All **69** relative Markdown links found in the 71-file archive resolve in the candidate Git tree.

Evidence: `core-machinechecks.json`, `static-boundaries.json`, `archive-adjudication.json`, `token-adjudication.json`, `retention-machinechecks.json`, `anonymization-machinechecks.json`.

## CI proof and limits

The independent CI sub-audit used existing raw metadata/logs and exact-ref workflow/test source, rather than treating `ci-verified.json` as the proof. It verified two runs, six successful jobs, 70 successful steps, zero step skips, 14 required command groups, 32 group occurrences and 76 nonblank echoed issued script lines. Those lines match the exact-ref workflow source. Push job checkout is the candidate; PR jobs check out the recorded merge commit, with the ordered parents verified against the saved GitHub commit envelope. The merge object is unavailable in local Git, so that part of the proof is explicitly the saved exact-ref GitHub envelope, not an invented local-object claim. Both artifact metadata/digest records match their upload-log anchors; archive bytes were not reread by this role.

TLS/HTTPS proof is suite-level plus exact-source anchoring: six full-suite observations; Linux's three skips map to mandatory Windows-only source decorators, and Windows has zero suite skips. Five TLS/HTTPS methods are inferred from the exact loaded suite source and suite success. There are zero method-name log anchors and no per-method timing proof. No local TLS suite was executed. CI execution counts are not a claim that every method emitted a separate log line.

Evidence: `ci/report.json`, SHA256 `4d49cbd29dff7d4ba2f98bb8e4ca8f3d3399fcbc7b124ec28c512c4802d0801a`.

## Ledger and preserved denominators

All three sealed revision-8 draft hashes match the author's supplied snapshot and were stable on readback. The ledger has 53 unique requirement rows; all have evidence, limits and an explicit non-final-acceptance flag. The ledger's original-task hash matches the provided original task, and both candidate fields name the frozen candidate. The 46-entry safe-source index is checked through its explicit evidence-root alias; none is a same-round peer-role result.

The historical/current split remains 75 original positions, 50 recovered originals, 25 unavailable originals and 25 current public supplements. The current 230-request comparison remains Python whole-graph value equality, with complete strict typed deltas unmeasured. The original 29 manual-required abstention judgments remain **zero** actual current75 explicit manual operations, with 15 origin-candidate fields present and 14 absent. No independent supplement is added to that original denominator. Historical weak identity/prefix and missing-frontend-state boundaries, other fixed cohorts/tags, the failed R5 review and its three process events remain historical limitations; same-round facts will only be assessed during cross-review. The draft correctly leaves final cleanup, final document commit/push and role verdicts pending.

Evidence: `ledger-machinechecks.json`; sealed source pointers are recorded there.

## Workspace preservation and delivery boundary

The authorized private baseline matches SHA256 `6bba8b4c0f01d3bc4273a7719331b79deceaa68989e18d72dbaf932839ada61d`. For each of the two explicitly mapped workspaces, all 65 recorded data hashes and all 64 skip-worktree flags match. Staged and unstaged diff hashes also match the baseline. The task workspace is clean at the candidate; its HEAD changed by the authorized task history.

The original workspace cannot be described as wholly unchanged: its baseline HEAD advanced by three descendant commits, its current HEAD equals local `origin/main`, and its untracked record count changed from five to one. The last three reflog action categories are `commit`. The baseline contains only status digest/class counts, not the old path records, so a per-file present/ignored/tracked attribution cannot be reconstructed without guessing. No untracked content was read. This role neither attributes the external change to a person nor restores/resets the original workspace. This is an explicit preservation/delivery boundary, not a discovered product Medium.

Evidence: `protected-workspaces-machinechecks.json`, `workspace-metadata-followup.json`. The root's eventual actual delivery/cleanup signature is separate from this role's review signature.

## Process deviation in this role

The delegated CI auditor's first read incorrectly projected the three formal authorization documents as raw text. The auditor reported that this included authorization paths, a private identity filename and operational metadata. Raw projection stopped and the parent/root were notified immediately. No raw CI log, graph/request/asset structure or credential exposure is asserted by this event's known scope. It is retained as **one R6 output-policy/process deviation**, separate from product findings. This role does not claim a clean process PASS and does not erase or merge the earlier three R5 events. Other local audit-harness failures produced only trace/type/pointer output and were corrected without product execution or workspace writes.

No future cleanup, final publication, final push, root delivery signature or unknown peer result is pre-signed. Await cross-review.
