# CrossAudit-4-WebUX — R3 independent audit

Status: **REQUEST CHANGES (final, cross-check complete)**

Frozen product commit: `50bb3fad2189b54f45f4cc0e0c6d2071d2e73090`. Checked HEAD and clean Git state before and after execution. Product code, build and preview service were not changed or restarted.

## Environment and method

- Real installed Google Chrome **158.0.8127.37**; executable product version and CDP version agree. App reports v4.0.0. Used the supplied isolated task Chrome CDP endpoint and only one newly created context/page. Did not inspect profile files, cookies, account data, or another page.
- Actual `window.innerWidth/innerHeight` verified as 1440×900 and 390×844, DPR 1. Actual UI theme toggled through “切换界面主题”; `data-theme` and computed background verified (light rgb(243,245,240), dark rgb(19,21,23)). Browser initially minimized; restoring this task window resolved blocked screenshot capture. No browser install or dependency install was performed.
- Browser interactions used real chooser events, buttons, text inputs, keyboard Tab/Enter/Space/ArrowDown and wheel events. Browser requests hit only the isolated preview. No GPU task, model download, real ComfyUI instance or paid service was invoked. No unit tests or static screenshots were used as substitutes for interaction.
- Reused only neutral synthetic fixture content from R2, without reading its reports or scripts. API graph: 200 nodes, 32 chained LoRAs. Additional R3 variant has a 110-character ASCII file name, a 200-character node title, and a 183-character LoRA file name; this avoids foreign author prompts or media. A UI-only WebP carries synthetic workflow EXIF metadata.
- `metrics.json` contains timings, actual geometry, response status, saved mapping values, full diagnostic text, focus observations, source hashes and persisted-state comparison. `browser-events.json` records console/page errors and request URLs. Timings are single local interaction observations, not a statistical performance benchmark.

## Findings by severity

### Blocker

None identified in the assigned browser UX scope.

### High

None identified in the assigned browser UX scope.

### Medium — WEB-R3-01: long import names overflow the dialog and crop its title

**Reproduction:** At either audited viewport and either theme, activate “导入工作流” with Enter/Space, choose `r3_long_neutral_readable_readable_readable_readable_readable_readable_readable_readable_readable_200nodes.json`, and inspect the preflight title. It cannot wrap its long unbroken name. The title is cut at the dialog's right edge and the whole dialog gains a horizontal scrollbar.

**Observed geometry:** Desktop dialog clientWidth **970**, scrollWidth **1116** (146 px overflow). Mobile dialog clientWidth **348**, scrollWidth **1116** (768 px overflow). Both light and dark reproduce. This is an ordinary valid filename, far below filesystem filename limits. Long node labels in mapping search and long LoRA names in the report do wrap correctly, so the problem is specifically the modal title, not the graph content.

**Impact:** The workflow's full identity cannot be read in the import confirmation without sideways panning, especially at 390 px; it violates the requested no overflow/truncation UX criterion. The dependency dialog also reuses the same unwrapped workflow name, showing the shared title scope.

**Root cause (independently cross-checked):** `web/src/pages/settings/WorkflowsSection.tsx:122-125` derives name directly from the filename. `WorkflowInspection.tsx:314` passes it to Modal title. `web/src/components/ui.tsx:208` renders Dialog.Title outside `.workflow-inspection`. `web/src/styles/overlays.css:55-59` does not permit unbroken title text to wrap; the parent `.dialog` has `overflow:auto` at line 31. `WorkflowInspection.css:1-7` already protects inner content with `overflow-wrap:anywhere`, but that protection cannot reach the sibling title.

**Expected correction:** Ensure shared modal titles can wrap or otherwise reveal the complete identity within the dialog, preserving the close control and avoiding horizontal scrolling; verify short and long names at both viewports/themes.

**Evidence actually viewed:** `desktop-light-api-top.png`, `mobile-light-api-top.png`, `mobile-light-long-title-stable.png`; geometry in all four main matrix cases. `*-long-title-stable.png` supplements confirm the same defect after opening animations finish. A separate read-only verifier reviewed the screenshot and source chain, independently agreeing with Medium severity. No product fix was made in this audit.

### Low

None identified in the assigned browser UX scope.

## Completed positive checks

| Case | Actual viewport | Actual theme | API preflight ms | LoRA tail search ms | Node 200 search ms | UI-only rejects (JSON/PNG/WebP) | PNG/WebP actual saves lossless |
|---|---|---|---:|---:|---:|---|---|
| desktop-light | 1440×900 | light | 411.8 | 21.4 | 16.1 | 3/3 | 2/2 |
| desktop-dark | 1440×900 | dark | 399.5 | 22.7 | 19.6 | 3/3 | 2/2 |
| mobile-light | 390×844 | light | 400.7 | 20.0 | 16.1 | 3/3 | 2/2 |
| mobile-dark | 390×844 | dark | 379.1 | 15.5 | 13.8 | 3/3 | 2/2 |

- Every main case adopted inferred mappings, searched and selected the long title of node 200 using ArrowDown/Enter, saved with Space, and persisted `prompt=/200/inputs/text`. POST returned 201, saved graph was deeply equal to the original graph, and an independent GET read-back preserved both graph and mapping. No node/link/type/prompt/LoRA content was changed by import.
- Both API-metadata PNG and WebP were actually saved in every combination (8 successful image imports, all 201 and graph-equal). Pure UI JSON, PNG and WebP were inspected in every combination (12 checks): the UI says it is a ComfyUI interface workflow, gives three actionable steps to export API JSON, displays the 200-node structural overview, and disables save. It does not imply a UI graph was converted into executable API format.
- Preflight explicitly states that ComfyUI nodes/models have not been checked and that assembly success does not prove real execution. “检查依赖” opens an actionable “还没有 ComfyUI 实例” state in this isolated workspace, without contacting real services. Uncertain graph preflight exposes “查看可能的绑定目标” with “候选仅供人工选择；未自动写入映射”; reference fixture inspected separately.
- All 32 default LoRA controls render. Actual wheel scrolling reaches the last long-name row in every combination; final scroll metrics have `lastInViewport=true`, with no horizontal overflow (desktop 826/826; mobile 274/274). Searching the 32nd LoRA works in the preflight report and defaults editor.
- Actual defaults editing at mobile dark: 32nd LoRA model weight **-0.4**, CLIP **1.2**, Space toggles it off; save returned 200. GET read-back retains the stable-key override and leaves the original 200-node graph unchanged. Persisted override: `{"groups":[{"key":"origin:40:lora_name","loras":[{"key":"origin:40:lora_name:c7e8f58a100e0502","name":"NeutralStudy_032_LandscapeStyle.safetensors","strength":-0.4,"clip":1.2,"enabled":false}]}]}`.
- Import dialog initially focuses its close button; 13 successive Tab steps stay inside the dialog in each combination. Enter/Space operate sections and buttons. Save, Cancel and close each return focus to “导入工作流”. Actual chooser cancellation results in zero new dialogs, zero POST delta, and focus retained on the import trigger.
- All six hashed source/generated fixtures retain the same SHA-256 hashes after all interactions. Console errors **0**; page errors **0**. Browser request records contain no generation submission. These checks apply to the audited neutral graphs and isolated preview only; they do not prove arbitrary plugin execution or external dependency availability.

## Visual evidence and temporary artifact inventory

All new scripts, generated neutral fixtures, metrics and screenshots are confined to this audit's temporary `audits/r3/web/` directory. No downloaded author workflows/media or private absolute paths are included in this report. The browser profile and preview workspace are parent-owned; this audit does not remove them.

Selected screenshots were actually opened for review: desktop light preflight and LoRA search, desktop dark expanded preflight, desktop light stable UI-only PNG and uncertainty diagnostic, desktop dark default LoRA tail, mobile light preflight and stable long title and default LoRA tail, mobile dark mapping popup and stable UI-only WebP. The stable captures show readable controls and content except WEB-R3-01. Some first-pass captures caught finite opening animation opacity; use the corresponding `*-stable.png` captures for settled modal appearance, and do not treat animation transparency as a product defect.

Initial independent testing is complete. Cross-audit integration and final closure status are recorded below after this report is delivered to the controller.

## Current-round cross-check and closure

After delivering the initial independent report, this audit read the current Generality, Compile and Blind reports. Their reference-stage, auxiliary-output, partial-mirror, numeric-string, mode/count and preset-size findings are semantically outside this browser corpus; the successful neutral UX checks do not contradict them and are not presented as engine-generalization proof.

A fresh neutral UI cross-check reproduced the **display side** of Compile C3: a standard chain LoRA with `strength_model="0.7"` and `strength_clip="0.2"` imports successfully but its preflight LoRA row reads **“工作流 · 默认开启 · 模型 1”**, omitting the stored CLIP strength. This was observed in the rendered preflight row text; `metrics.json:crossNumericString` records source fields and displayed row. No compile-effect claim is made from this browser check; peers separately established that effect. This is the same root cause as Compile C3, not a second independently counted defect.

WEB-R3-01 was separately checked by a read-only verifier who actually opened the screenshot and traced the title's stylesheet scope. Its Medium classification remains confirmed.

Only this audit's newly created browser context/page was closed. The local audit driver completed normally; it wrote `browser-events.json` and disconnected without closing the shared task browser. All temporary artifacts remain in this audit directory for controller review and coordinated final cleanup. No product/build/preview change or repository commit was made. **Frontend build/preview freeze is released by this auditor.**

Final assigned-scope result: **REQUEST CHANGES**, one independent Medium (WEB-R3-01), plus a UI cross-confirmation of the already counted Compile C3 root cause.
