# Live browser and ComfyUI acceptance

## Isolation and actual limits

The existing Chrome installation was used through Playwright CLI. No browser was installed. The production web build ran against a temporary SQLite workspace with neutral generated test images, an empty legacy source and no enabled ComfyUI instance. A separate temporary directory served six exported HTML files. The user's protected `data/` files were neither changed nor copied.

Initial browser setup disabled the updater object and caused `/api/update` errors; this was a fixture error. The fixture was corrected to keep the updater and suppress only its startup network check. Checks below used a new isolated workspace and newly loaded pages. CLI file navigation was unavailable, so the six self-contained files were served over loopback; their CSP and zero external dependency were preserved.

## Browser observations

- At 1280×800, storyboard text search returned the expected six matching rows and the variables filter returned the other six. Actual keyboard drag (pickup, next-row announcement, drop) changed the order from Study 1/Study 2 to Study 2/Study 1 and saved it. A single rapid scripted sequence and HTML dragTo did not move rows; the observed successful keyboard interaction used the real sensor and its live announcement.
- At 390×844, the new filter block initially competed horizontally with the list because a legacy media rule changed its parent to a row. The local stylesheet now keeps the stacked layout in a column, with two filter columns and actions beneath the scrollable list. A fresh build and screenshot confirmed both filter/list widths at 358 px, document width 390 px, and no horizontal overflow.
- The workflow trial displayed independently addressable LoRA on/off, model weight 0.7 and CLIP weight 0.3 at desktop and mobile sizes. Turning off retained both values, and turning back on retained the same values. No GPU call was made from this visual fixture. Narrow controls were subsequently adjusted to place the range label above the slider.
- The saved workflow defaults editor was also checked after its final build. A temporary fixture used a 137-character LoRA filename at 390 px. The row and CLIP area both measured 260 px with no internal or document overflow; the page produced zero console errors. No test was submitted for this deliberately nonexistent model filename.
- Saving that fixture's LoRA default as off and reloading retained the unchecked state with model 0.7 and CLIP 0.3. This used the actual editor/PATCH path, without generation. The owned browser and temporary HTTP servers were closed after visual acceptance; the user's ComfyUI was left running.
- All six new exported templates (ATELIER, FOLIO, CINEMA, EDITORIAL, CONTACT, CHROMATIC) ran at both viewport sizes: 12 combinations. Each opened its directory and image lightbox, zoomed, navigated with ArrowRight, closed with Escape, changed layout, and accepted Home/End. Every combination had zero page/console errors, zero inert elements left behind and no document overflow. Screenshots were inspected as a contact sheet and at mobile size.
- The actual export drawer displayed all 13 template cards. Selecting FOLIO and opening full-screen trial reading created the sandboxed iframe; its next-page control worked. This page had zero console errors.

Screenshots are local temporary artifacts under `%TEMP%/mio-*.png`; no private workflow, server state or raw capture was committed.

## Authorized real ComfyUI run

After the user stated ComfyUI was running and supplied their complex workflow, the existing endpoint at `127.0.0.1:8188` was inspected. It reported ComfyUI 0.14.1, one CUDA device with 8 GB VRAM, and one pre-existing running job. That job was left alone; the neutral acceptance job was submitted only after the queue became empty.

The supplied API graph contains 138 nodes, including seven ParameterControlPanel nodes and 43 LoRA rows in one linked object-list control group. All custom node classes were installed. Import was valid; compilation correctly required the frontend-only parameter snapshots and explicit text/size bindings. These were captured read-only into a temporary document. The original JSON was not rewritten.

Two originally active LoRAs and 41 originally disabled LoRAs were all disabled for actual execution. A separate local compilation verified that an individual row can be switched off and reopened with its original model/CLIP weights and native state intact. The run used a neutral still life, no people, 512×512, one candidate, four Euler steps, fixed seed and the selected base preview output. It did not load user LoRAs or execute the full upscaling/detail branches.

The actual Mio trial path created an album, froze the workflow and submitted a normal `comfy.render` job. Job `job_f5fe932aac864be3` completed on its first attempt, received one 512×512 PNG, delivered and adopted it. ComfyUI prompt ID was `b5415251-dcad-48f3-a97d-fd6ba013b3a0`; the run reported 9.44 seconds and four preview frames. The compiled branch contained 91 nodes and two of the captured parameter panels. All seven panel states compared equal before/after, and the original workflow file's SHA-256 compared equal before/after. The queue was empty afterwards.

The complete local evidence is `%TEMP%/mio-comfy-acceptance-ha14213s/result.json`; the neutral image is in that temporary workspace's assets directory. These files were not committed. Paid cloud APIs and full quality/upscale execution were not exercised.
