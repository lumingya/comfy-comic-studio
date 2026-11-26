# Wave 4 / audit 4 / round 1 — real Chrome UX

Pinned runtime: HEAD `71457f6`; current built web served by the isolated local preview on port 8797. Existing native Chrome `158.0.8127.37` via CDP; no browser installed or launched. Only audit-owned local pages were operated. No repository files changed, no generation, model, cloud or paid requests.

**VERIFIED PASS for the requested four-context functional and visual matrix, with one Low finding.** No Blocker, High or Medium finding. The Low is explicitly retained below; this is not a zero-finding claim.

| Context | API JSON 200 nodes / 35 LoRAs | UI-only JSON | API PNG | UI-only PNG | Visual review |
|---|---|---|---|---|---|
| 1440 × 900 light | PASS | PASS | PASS | PASS | PASS |
| 1440 × 900 dark | PASS | PASS | PASS | PASS | PASS |
| 390 × 844 light | PASS | PASS | PASS | PASS | PASS |
| 390 × 844 dark | PASS | PASS | PASS | PASS | PASS |

## Concrete evidence

- `matrix.json`: sixteen import cases, four real save POSTs. Each saved API JSON graph is exactly equal to the 200-node synthetic original. All four saves contain correct explicit prompt `/40/inputs/text`, negative `/41/inputs/text`, seed `/43/inputs/seed`, width `/42/inputs/width`, height `/42/inputs/height` and output `/45`.
- Each context exposed 12 detected bindings and 35 LoRA entries; name filter reduced 35 → 1 → 35. Mapping catalog had 435 choices and mounted no more than 60. Exact-pointer search returned the correct choice in 15–20 ms under this machine's local conditions; this is a single observed run, not a performance benchmark.
- Each context used actual search input, ArrowDown and Enter to choose the prompt node, then the visible one-click adopt button for remaining detected bindings. Values were checked in the visible controls and real save request.
- UI-only JSON and PNG show plain-language ComfyUI export guidance with three steps and disabled save. They do not expose a cold `400 JSON invalid` error. The API PNG exposes correct prompt/output bindings and enabled save; its format label is the normalized `Mio 工作流包`.
- `explore.json`: desktop/mobile workflow list correctly filters by workflow name and checkpoint model, reaches an empty list for an unmatched query and restores all entries when cleared. Mapping search no-match, Escape focus return and ArrowDown reopening pass. An additional real PNG save retains the exact original 200-node graph and the manual prompt choice.
- `stale.json`: actual backend inspection response delayed while switching to final output variant. Adopt, manual mapping and save are disabled, a loading status is visible, and a real pointer click on the disabled adopt control causes no extra request. After response release, adoption sends `variant=final` and correct prompt pointer. Two inspection requests total.
- No page errors in the four primary matrix contexts. Recorded local write paths contain inspection and workflow save only; no trial, diagnose, generate or job call.
- Twenty-eight matrix screenshots plus two stale-state screenshots were saved. Sixteen initial/format screenshots were recaptured after modal opacity reached 1; `stable-layout.json` confirms all sixteen modal rectangles within their exact viewport. No horizontal control overflow or internal horizontal scroll was measured. Scrollable modal bodies remain usable; save/cancel were reached and operated.
- An independent visual-only agent inspected the four sizes/themes, LoRA, mapping, adopted and UI-only renders. The parent also visually inspected desktop light mapping, desktop dark initial, mobile light UI-only and mobile dark mapping. Stable screenshots have readable text, working popover layering, visible close controls, and usable UI-only footer actions. No Medium+ visual defect found.

## Low finding — focus indicator disappears after confirming a manual mapping

Reproduce in the mobile dark API PNG import preview: expand mapping, open positive prompt, search `/40/inputs/text`, press ArrowDown then Enter, and wait for the new inspection to settle. The value is correct but `document.activeElement` is BODY. ArrowDown no longer reopens that selector. Tab resumes at “为正向提示词添加目标”, then negative prompt and seed; there is no trap or restart of the entire form. Escape from the search without selection correctly restores trigger focus.

Evidence: `focus-probe.json`, `explore.json`; deterministic driver `explore.py`. Likely contributors are target-row remounting when an automatic mapping becomes explicit (`WorkflowMappings.tsx`) and disabling the mapping fieldset during the inspection refresh (`WorkflowInspection.tsx`). This cause is a hypothesis, not a source-confirmed fix. Main coordinator has received the finding and will address it.

## Verification limits and cleanup

Only synthetic neutral fixtures and the isolated preview workspace were used. Imported workflows were not executed against ComfyUI. No claim is made about real model availability or generated-image quality. Earlier failed automated expectations were driver issues: substring `40` also matched 140/240, and PNG normalization changes the format label. Stable final matrix assertions pass.

The unrelated native Chrome 157 connection rejected newly created targets as crashed; the successful audit used the existing Chrome 158 connection. No existing user tab, account, profile or cookie content was accessed. Audit-created tabs are closed after evidence capture; the existing Chrome process is retained. Temporary artifacts stay outside the repository for coordinator review and eventual cleanup.
