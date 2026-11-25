# Wave 4 round 2 independent privacy, hygiene, and CI audit

Auditor: CrossAudit-5-Privacy-Hygiene-CI. Independent reviewer; no implementation participation.

**VERIFIED PASS for the audited product source, synthetic regressions, sanitized documentation, and exact-commit remote CI.** Blocker: 0. High: 0. Medium: 0. Low: 0 within this remit. Final task completion, final temporary-directory deletion, the local full-suite rerun, and the final clean/pushed Git state have **not** been signed off by this report.

## Fixed scope and method

- Base: `38838ab43cf3d056951f2fc6c52afb737d34e3c6`.
- Frozen product: `6f9bdf2c56994397754f4ec2c782f1ab63bc75a0`.
- Read AGENTS.md, README.md, ROADMAP.md principles and relevant task entry, and the complete supplied original task. Reviewed current acceptance/retest documentation, including the untracked private-138 statistics file.
- Reviewed 53 distinct current changed/untracked text paths, all seven task commits, and 84 distinct changed blobs. Intermediate commits introduce no additional paths outside the final file set. Current source, generated clients/types, fixture changes, and new regression-test data were included.
- Independently inspected document structures, public URLs, literal-value patterns, all seven commits' added lines, generated-client diffs, image import/API behavior, and fixture expectation changes. Inspected content to adjudicate pattern matches; keyword hits were not treated as proof of leakage.
- No repository file was modified by this auditor. All audit outputs are confined to the designated external audit directory. No credential values, existing browser-profile contents, private workflow payloads, or other Codex conversations were read.

## Standards findings

| Severity | Count | Finding |
| --- | ---: | --- |
| Blocker | 0 | None |
| High | 0 | None |
| Medium | 0 | None |
| Low | 0 | None |

All 53 task paths are UTF-8 text. No downloaded PNG/WebP, other binary file, embedded image/base64 payload, copied browser artifact, credential value, user-machine path, or temporary script occurs in the current task diff. The seven commits' added lines likewise contain no private-path, key-material, credential-value, large-payload, or browser-artifact match. All historical versions of new JSON evidence documents contain zero `class_type`, `inputs`, `widgets_values`, `links`, or `extra_pnginfo` graph-payload keys.

The only credential-pattern match in complete current files is an existing OpenAPI description explaining the bearer placeholder. The exact line exists in the base commit and is documentation rather than authentication material. The new authenticated API test issues its own ephemeral token and uses it in memory; no token literal is committed or printed.

The ignored-file inventory contains only conventional dependency, Python/tool cache, and build-output locations after excluding `node_modules`, `.venv`, `__pycache__`, tool caches, and `dist`. No unusual ignored task artifact was found. `git diff --check` passed. Git is intentionally not yet clean: the coordinator is updating the compatibility/retest reports and adding the sanitized 138-node read-only statistics file.

## Spec findings

| Severity | Count | Finding |
| --- | ---: | --- |
| Blocker | 0 | None |
| High | 0 | None |
| Medium | 0 | None |
| Low | 0 | None |

New regression graphs are assembled in test code with short neutral text and synthetic filenames. Image-container regressions generate white 2-by-2 images in memory and construct metadata/chunks programmatically; they do not embed downloaded sample pixels. New regression tests do not open external workflow files or copy a data directory. Mock private-marker strings exercise non-echoing diagnostics and are not real private data.

The existing slot-contract fixture changes consist of analysis revision fields and three corrected expected output strings. Each LoRA tag in those three strings already exists in the base fixture. The only text outside tags is the neutral phrase `trigger words here` or separators. These changes preserve inherited fixture content rather than introducing a downloaded author's prompt.

The evidence JSON contains public source URLs, hashes, structural class sets, counts, target pointers, annotations, and measured outcomes. It contains no executable third-party graph or original image/model filenames outside public source URLs. Reviewed URL hosts are GitHub/raw GitHub, Civitai, Hugging Face, and the local loopback service; none contains URL user information or query parameters. Public repository/publisher names are source attribution, not private account data.

The private-138 evidence exports counts, booleans, issue categories, a product revision, and command/result metadata. It exports no graph, document identifier, database path, original prompt, model name, or stable slot key. It explicitly records full compilation failure due to missing frontend state and separates committed tag regressions from the private graph, which has zero explicit tags. This is a truthful limited check, not an unsupported full-execution claim.

## Import and authentication boundary

The new decoder reads bounded JSON/PNG/WebP metadata, not pixels, and contains no persistence, node execution, network request, or secret logging. Relevant errors are fixed actionable messages without uploaded literal values. File and metadata limits, duplicate/corrupt metadata checks, and finite-number checks are present. The file-inspection handler reads the bounded body and returns review data without saving images or queueing work.

The public API operation inherits the normal bearer-authenticated write operation. Its OpenAPI snapshot declares the existing bearer security requirement; generated Python clients and frontend types expose the same binary-body operation. Regression coverage includes anonymous rejection, an ephemeral authenticated request, no network/persistence side effects, and non-echoing malformed-literal errors. This review did not find an authentication bypass or new data-exfiltration path.

## Exact-commit remote CI

[CI run 45630099226](https://github.com/lumingya/comfy-comic-studio/actions/runs/45630099226) is completed/success for exactly `6f9bdf2c56994397754f4ec2c782f1ab63bc75a0`. Actual checkout log lines independently confirm the SHA for all three jobs. Actual command/result logs were reviewed in addition to workflow configuration and run metadata; detailed one-based log references are in `ci.md`.

| Required area | Observed result |
| --- | --- |
| Gate backend, Ruff check/format | 1,699 tests OK, 3 explicitly skipped; lint/format passed |
| Linux Python 3.11 backend | 1,699 tests OK, 3 explicitly skipped |
| Windows Python 3.11 backend | 1,699 tests OK, no skips reported |
| Linux and Windows full launchers | 31 tests OK on each; `MIO_LAUNCHER_FULL=1`, actual clean-start launcher coverage |
| Generated client and extension contracts | Current; checks passed |
| Spike | 80 tests OK |
| Frontend dependencies and API generation | Installed, regenerated, clean schema/protocol diff |
| Frontend format/types/tests/build | Passed; 116 files / 956 tests |
| Shipped-data/manifest checks | 64 files verified; manifest matches |
| Extension/example checks | 25 packages valid; six professional panel scripts passed |
| Assistant extension | Formatting, 34 tests, build, clean generated-dist diff passed |
| Release smoke | Archive built successfully; intentionally unsigned smoke artifact |

The combined CI Ruff steps cover AGENTS' server/clients/tools scope. All frontend `gen:api`, format, typecheck, test, and build commands actually ran. The additional documentation links, examples, bootstrap lint/format, and release checks passed. Linux totals must not be described as all 1,699 passed because three cases were skipped. Release smoke is not signing/publication approval or GPU/plugin runtime validation.

The coordinator reported that two local Git-initialization tests were affected by inherited empty Windows process environment entries and is running the full suite with process-only Git configuration isolation. This report does **not** mark that local run passed before its final exit/result evidence is supplied. Exact-commit cross-platform remote CI is independently verified above.

## Final cleanup and Git closeout: pending

The following are completion conditions, not source defects:

1. The coordinator must collect the other independent verdicts and complete the local rerun evidence.
2. Final sanitized documentation must be committed/pushed and task-worktree Git status confirmed clean. Current remote CI covers the frozen product SHA, not later documentation-only commits.
3. After all reviewers release their materials, stop task-owned temporary services and remove the entire designated recovery/hunt root, including originals, images, probes, databases/workspaces, generated browser test state, audit evidence, and these audit scripts. Preserve the desired sanitized report first.
4. Recheck absence of the old hunt root and current recovery root. This report does not assert deletion while those materials are intentionally retained.

The old `mio-wf-hunt-74af19ae` directory was observed absent. The current recovery root still exists. No material was deleted by this audit and no browser profile was opened. Directory names alone are not evidence of copied credentials.

## Temporary directories retained / ownership inventory

All files created by this auditor and its CI delegate are under:

`<task-temp>/audits/r2/privacy/`

Files: `report.md`, `scan.py`, `scan.json`, `content-review.json`, `history_review.py`, `history-review.json`, `ci.md`, `ci-run-45630099226.log`, `ci-run-45630099226.json`, and `ci-excerpts.txt`.

The task root `<task-temp>/` has these observed direct child directories; deleting the verified task root after reviewer release covers their descendants:

```text
.browser-workspace.mio-recovery/
__pycache__/
audits/
before/
blind-r1/
browser-profile/
browser-workspace/
civitai/
community/
gate-instrument/
supplement-complex/
supplement-official/
```

Other names observed directly under system TEMP include numerous `.tmp*.mio-recovery` / `.mio-context-long-directory-*.mio-recovery` test-recovery directories, `mio-goal-browser-20261125`, `mio-professional-browser-m2h7lmyi`, and `mio-professional-final-shots`. Their ownership was not established by this audit; their contents were not inspected and they are not automatically authorized for cleanup. The coordinator was informed so task-owned residues can be handled while unrelated user work is preserved.

Standards: 0 findings. Spec within privacy/hygiene/CI: 0 findings. **VERIFIED PASS is scoped to the source and verified remote CI above. Final cleanup and clean/pushed Git remain pending direct evidence.**
