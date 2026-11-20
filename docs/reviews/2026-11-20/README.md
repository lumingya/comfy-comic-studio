# 2026-11-20 审查档案索引

本目录保存 **41 份审查与验收记录，以及本索引，共 42 份 Markdown**。原报告保留原名、原路径和正文，用于追溯发现、修复与复验；本页只整理阅读顺序，不把历史记录当作对当前版本的新验收。

这些记录对应上一份 `ai_studio_code.txt` 任务。原文中的“三波”“13 套模板”和旧模板名称均描述当时版本，**不等同于本次 `ai_studio_code (1).txt` 的 Wave 0–4**。特别是旧模板的桌面 1280 px / 手机 390 px 验收，不能替代新三套模板要求的桌面 1440 px、深浅主题及移动端检查。

## 先看哪些结论

| 要回答的问题                       | 优先阅读                                                                                              | 结论的适用范围                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 上一份任务的规格是否补齐？         | [最终规格增量复审](final-delta-spec.md)                                                               | 对指定提交与当时整合树的定向复核；完整发行包门禁由主控另行完成           |
| 后端冻结与 LoRA 覆写是否可靠？     | [后端独立复审](backend-fresh-recheck.md)、[LoRA 精度复审](lora-precision-recheck.md)                  | 稳定键、多方案快照、极小值及范围校验；不代表所有工作流实机可运行         |
| 凭据与校验错误是否脱敏？           | [云端配方隐私复审](cloud-recipe-privacy-recheck.md) → [最终校验隐私复审](validation-final-recheck.md) | 嵌套配方、历史记录读取、当前凭据绑定和共享校验响应                       |
| 恢复、清理与导出路径问题是否闭环？ | [相邻文件最终独立复审](other-final-independent.md)、[导出路径独立复审](export-path-independent.md)    | 明确列出的竞态、压缩包与文件身份边界；不承诺抵御同权限进程的任意文件竞态 |
| Windows 与调度测试最后怎样？       | [工作区身份复审](context-identity-recheck.md)、[调度夹具复审](scheduler-test-recheck.md)              | 本机 Python 3.13 的定向证据；远端 Python 3.11 全矩阵须看对应 CI          |
| 实际浏览器和 GPU 做过什么？        | [真实浏览器与 ComfyUI 验收](live-acceptance.md)                                                       | 当时六套新增模板、隔离工作区及中性基础分支；未覆盖付费云端或全质量精修   |

## 按主题查找全部记录

### 1 · 基线、首轮发现与相邻代码检查（7 份）

这些是发现问题时的快照；其中“尚未实现”只代表报告当时的状态。阅读时继续沿下两组的补验和最终复审追踪，不将首轮清单重复计算为当前遗留问题。

| 记录                                          | 内容与后续去向                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| [共享上下文](context.md)                      | 原始基线与分工；末尾“进行中 / 待创建”表属于过程状态，后续结果以本索引为准 |
| [首轮后端](agent-backend.md)                  | 云端快照与嵌套凭据；后续见安全复审链                                      |
| [首轮契约与规格](agent-contracts.md)          | API/SDK、槽位契约、摘要与分页缺口；最终规格见 `final-delta-spec`          |
| [首轮前端与阅读器](agent-frontend.md)         | 参数类型、缓存及当时缺失的阅读交互；后续见终轮前端与真实浏览器记录        |
| [相邻 API 安全](adjacent-api-security.md)     | scope、Host 与同源边界的只读检查，保留未模拟的代理场景                    |
| [相邻导出与存储](adjacent-exports-storage.md) | 缺失文档头导致 CSP 缺口的原始发现；后续见 `recheck-final` 与安全复审      |
| [相邻生成快照](adjacent-generation-data.md)   | `extra_options` 冻结丢失的原始发现；后续见后端独立复审                    |

### 2 · 首轮修复的连续复验（4 份）

同一问题多次出现表示逐步收紧回归边界，不能把它们当成四次独立全仓验收。

| 记录                                        | 本次增加的证据                                       |
| ------------------------------------------- | ---------------------------------------------------- |
| [安全与缓存复验](recheck-security-cache.md) | 已修复项之外继续发现 schema 枚举的凭据字面值         |
| [第二轮复审](recheck-round2.md)             | 凭据、类型保持、缓存、LoRA 摘要与分镜分页的定向确认  |
| [第二轮全新复审](recheck-round2-fresh.md)   | 继续发现原始值数组合并损失；保留当时尚未完成的主规格 |
| [该轮最终定向复审](recheck-final.md)        | 关闭上述凭据、CSP 与缓存增量；其“最终”仅指这一轮修复 |

### 3 · 实现与可执行验收（7 份）

| 记录                                           | 覆盖内容与限制                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| [槽位统一分发](core-slot-dispatch.md)          | 注册器、稳定键与默认值；离线编译证据                                   |
| [工作流默认 LoRA 界面](ui-defaults.md)         | 独立开关、权重保留与重置；不含真实出图                                 |
| [导出预览模块拆分](preview-modules.md)         | 职责拆分与预览刷新回归；没有独立模板工作室测试的边界保留               |
| [工作流拓扑与生命周期](workflow-acceptance.md) | 14 种合成拓扑、原生关闭状态、冻结及往返；首跑缺陷和最终复验均保留      |
| [画册与阅读器矩阵](album-acceptance.md)        | 旧版模板极端数据、DOM 交互与往返；不能证明真实视觉布局                 |
| [120 幕与渠道参数压力测试](frontend-stress.md) | 自动保存、排序、撤销与 JSON 类型；测试桩优化未放宽超时或行为断言       |
| [通用 Python SDK](sdk-acceptance.md)           | 真实 FastAPI 与生成客户端的离线全流程、同步/异步导出；生成执行器为模拟 |

### 4 · 终轮对抗与新审查者复验（8 份）

| 记录                                          | 状态与替代关系                                                |
| --------------------------------------------- | ------------------------------------------------------------- |
| [终轮后端对抗](final-backend-adversarial.md)  | 四项修复及严格回归；独立确认接下项                            |
| [全新后端复审](backend-fresh-recheck.md)      | 再核同名稳定键、混合路线及同渠道不同配方                      |
| [终轮前端对抗](final-frontend-adversarial.md) | 灯箱重复打开、扩展启停缓存、导出预览陈旧三项均有修复回归      |
| [终轮安全对抗](final-security-adversarial.md) | S1–S6 原始复现；文中“待修复”须连同下一项阅读                  |
| [全新安全复审](security-fresh-recheck.md)     | 对 S1–S6 的独立确认，补充 URL、HTML 注释与错误响应边界        |
| [最后 API 增量](final-delta-api.md)           | 渠道发现、SDK 目录与预检错误                                  |
| [最后界面增量](final-delta-ui.md)             | 默认 LoRA、预览拆分及原生表单精度保护；不是另一次全量视觉验收 |
| [最后规格增量](final-delta-spec.md)           | 汇总上一任务的完成性；不替代最终全门禁与发行包记录            |

### 5 · 相邻系统、恢复与导出路径（7 份）

| 记录                                               | 状态与后续确认                                             |
| -------------------------------------------------- | ---------------------------------------------------------- |
| [相邻 API 终查](other-api-final.md)                | 撤销令牌复活与异常归档输入；修复后定向通过                 |
| [相邻任务引擎终查](other-engine-final.md)          | 旧导入事务与计划后暂停/取消的 claim 复核                   |
| [存储与路径兼容](other-storage-final.md)           | Windows 普通短路径；其末尾移交问题不由该报告宣称闭环       |
| [相邻修复的全新复审](other-fresh-recheck.md)       | 进一步发现 OF1–OF3；继续读下一项                           |
| [OF1–OF3 最终独立复审](other-final-independent.md) | 压缩成员、恢复/清理竞态及失败覆盖的独立回归                |
| [恢复后的导出路径修复](export-path-recheck.md)     | ID、路径叶子、回滚与备份引用校验                           |
| [导出路径独立复审](export-path-independent.md)     | 硬链接、reparse 与实际定向回归；保留符号链接权限导致的跳过 |

### 6 · 实机、平台与最后隐私增量（8 份）

| 记录                                                 | 结论边界                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| [真实浏览器与 ComfyUI](live-acceptance.md)           | 隔离服务、真实键盘拖放、旧模板 12 组合及中性 GPU 基础分支     |
| [LoRA 精度独立复审](lora-precision-recheck.md)       | 极小十进制、五类形态、有限值与范围；不重跑完整门禁            |
| [Windows CI 诊断](ci-windows-diagnosis.md)           | 普通路径别名与实际链接的区别；原始诊断，不是远端矩阵通过证明  |
| [Windows 路径与启动器复审](windows-fresh-recheck.md) | 8.3 短路径、真实 junction 及平台权限限制                      |
| [工作区规范身份复审](context-identity-recheck.md)    | 先拒绝链接、再规范化身份的顺序与影响路径                      |
| [云端配方隐私复审](cloud-recipe-privacy-recheck.md)  | 配方嵌套凭据、历史读取及冻结/当前值分离，继而发现共享错误回显 |
| [最终校验隐私复审](validation-final-recheck.md)      | 全新进程复核共享校验处理器与前项的隐私断言                    |
| [调度回归夹具复审](scheduler-test-recheck.md)        | 等时间戳下确定性排序与变异探针，验证测试能发现 claim 守卫缺失 |

## 如何使用历史结论

- 先核对每份报告的提交、所有权和受测边界，再看结论；相同测试被后文引用，不等于后文重新执行过。
- 未运行、跳过、模拟执行、真实浏览器、真实 GPU 与远端 CI 分开记录。目录内任一“无剩余 P0–P2”均限于相应已检查路径。
- 旧报告内的本机临时文件只作当时证据位置，不是分发文件或长期下载链接。原有文件路径全部保留，避免破坏外部引用。
- 本地链接可用 `python tools/check_doc_links.py docs/reviews/2026-11-20` 检查；全仓检查运行 `python tools/check_doc_links.py`。外链不联网验证，占位 URL 单列；历史记录与已提交构建产物的断链仍使检查失败。

## 原始整合台账（归档）

以下折叠保留上一版索引中的规格表、提交映射与独有门禁数据，以便追溯。它描述原任务的整合过程，**不是 2026-11-21 新执行的验证或本次 Wave 0–4 完工证明**；其中“latest CI”链接是可变入口，不替代具体运行编号与结果。

<details>
<summary>展开上一版英文索引与历史门禁台账</summary>

### Upgrade acceptance and review index

The task source is the user-provided `ai_studio_code.txt`. The implementation base is `0c948c5`. The tables below retain the requested three waves and distinguish implementation evidence from execution limits. Later dated reports supersede earlier review findings only when a regression or independent recheck is named.

## Wave 1

| Task                                  | Current implementation and evidence                                                                                                                                                                                                                                           |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 · Slot extension contract          | `workflow_slot_adapter` contract v1; five generic codecs in `comfy/builtin_slot_adapters.py`, common dispatch, registration/removal, stable keys and independent enabled state; `test_core_slot_dispatch.py`, `test_workflow_slot_adapters.py`                                |
| 02 · Compile, control surface, freeze | Detail/import/PATCH/inspection/compile/query expose controls. Default → task → panel merging reaches multi-stage/local/hybrid/final/edit and secondary profiles. UI-format errors share `ui_format`. Tests: workflow format, slot lifecycle, backend review and fresh recheck |
| 03 · Cloud plug-in base               | Bounded JSON options, discoverable metadata and safe channel-ID catalog, frozen ordinary parameters with current credentials, retry/unknown-result behavior retained. Tests: providers, generation tasks, security review and channel discovery                               |
| 04 · Backend adversarial matrix       | Five shapes, duplicate names, native-off rows, Switch/Mute/Bypass, custom codec lifecycle, 14 graph topologies and source immutability: topology/core/adapter suites; two offline extension examples                                                                          |
| 05 · Album engine                     | Existing v1 format and seven templates retained; six layouts added; frame index/total/progress, cover/synopsis/signature/palette variables escape HTML and braces. All 13 templates × eight extreme datasets in `test_album_matrix.py`                                        |
| 06 · Offline reader                   | Single nonce script, no external dependency, paged/spread/zoom/directory/progress/immersive/ambient/fullscreen/keyboard/swipe/reduced motion and parent protocol. Reader suites and actual Chrome 12-combination visual check                                                 |
| 07 · Album safety                     | Structural HTML parser, trusted nonce runtime, inert metadata, malformed-comment/meta-refresh rejection, image/multi-book/missing-image roundtrip. Album matrix, security fresh recheck, lightbox wrapper tests                                                               |
| 08 · Generic resource API             | Workflow LoRA summary/query, paged storyboard summaries/detail/create/PATCH, preset list/detail/create/PATCH; shared local/v2 operations and scope. API/workshop tests and permission audit                                                                                   |
| 09 · Task and deliverable API         | One-shot idempotent assembly/start/adopt; write/render conditional permission before mutation; readiness query and four async formats, existing synchronous download paths. `test_workshop_flow.py`                                                                           |
| 10 · Full caller lifecycle            | Real isolated FastAPI, fake execution, scoped tokens, concurrent replay/conflicts and all four outputs in workshop-flow and SDK-flow integration suites                                                                                                                       |

## Wave 2

| Task                                 | Current implementation and evidence                                                                                                                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 · Storyboard modules              | Main editor 168 lines; frame list, menus, draft/selection/reorder hook, frame editor and variables separated. Search/status/drag, autosave flush, progress and assembly entry preserved; storyboard and stress suites |
| 02 · Reusable LoRA UI                | Shared keyed controls in trial, workflow defaults editor and summaries; model/CLIP values retained while off, saved-default reset and provenance. UI defaults/trial/inspection tests                                  |
| 03 · Task/panel and dynamic channels | Task controls and panel inherit/on/off overrides; schema-driven extension parameters with JSON fallback, nested sentinel preservation, cancel reset and invalid-save blocking. Assemble/storyboard/channel tests      |
| 04 · Interaction/i18n                | English/Chinese entries and i18n consistency; 120-frame filter, save race, keyboard sensor, selection/delete/undo and panel isolation. Test instrumentation was optimized without changing timeouts or assertions     |
| 05 · ATELIER/FOLIO/CINEMA            | Dark gallery, warm book-spread, dark screening room; standalone files and gallery/folio/cinema reader modes. Matrix and actual desktop/mobile visual checks                                                           |
| 06 · EDITORIAL/CONTACT/CHROMATIC     | Magazine, contact-sheet and long-scroll treatments; zero external assets, responsive/print styles. Same automated and actual-browser evidence                                                                         |
| 07 · Template/export preview         | Visual cards with layout/palette, sandboxed full-screen trial and template-studio expansion. Reopening fetches current content; export preview freshness regression                                                   |
| 08 · Python SDK helpers              | Resource discovery includes full workflow LoRA controls and selectable channel IDs, one-shot task/wait, synchronous or async four-format save. Generated client stays generated; SDK-flow tests                       |
| 09 · Extension examples              | `comfy-slot-codec` and `offline-cloud-adapter`; isolated/MockTransport tests and static CTK pass; neither requires a core edit for registration                                                                       |
| 10 · Integration documentation       | Generic clients and extension contracts, bilingual offline chapters, original external-consumer example retained. No new platform-named core files or special endpoints                                               |

## Wave 3

| Task                            | Evidence                                                                                                                                                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 · Complex workflows          | 14 synthetic topologies plus the user's actual 138-node graph. Actual neutral base-branch generation completed; original file and seven parameter states unchanged                                                                             |
| 02 · Durable fidelity           | Slot lifecycle covers kit import/export/remapping, clone, panel rerun, trial, close/reopen, complete default-redacted backup/startup restore and receipts; per-profile cloud recipes preserve source model/options under destination rebinding |
| 03 · 120 frames                 | Five stress cases plus normal editor suites; full frontend run passed after eliminating quadratic test geometry work                                                                                                                           |
| 04 · 13-template extreme matrix | 104 combinations plus explicit nonce/variable contracts; metadata/image roundtrip and XSS text stay inert                                                                                                                                      |
| 05 · Reader matrix              | 27 reader/lightbox cases, embed restore/report, touch and reduced-motion checks; actual Chrome template matrix also exercised controls/focus                                                                                                   |
| 06 · API abuse and permission   | Anonymous plus four scope groups across 65 route cases; bounded deep JSON/URL credentials, idempotency and concurrent presets, unsafe imports, revoked-token race regressions                                                                  |
| 07 · SDK caller integration     | Four scenarios and eight sync/async format combinations through the generated MioClient and real FastAPI, fake generation only for automated tests                                                                                             |
| 08 · Offline handbook           | English/Chinese chapter updates and seven handbook tests                                                                                                                                                                                       |
| 09 · Actual browser             | Existing Chrome, isolated workspace, 1280×800 and 390×844; search/filter/real keyboard drag, LoRA values, export sandbox and six HTML templates; see [live acceptance](live-acceptance.md)                                                     |
| 10 · Hygiene/release            | Generated contracts/API/client checks, Ruff/Prettier/typecheck, server/Spike/frontend/assistant tests, three extension CTKs and theme CTK. Final clean-data release package evidence is recorded below after completion                        |

## Review sequence

Implementation was integrated in overlapping increments rather than ten atomic merges per wave. The traceable commit groups are:

| Wave                                   | Commits                                                                                                                 | Integration                                                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1 · Contracts, runtime and generic API | `10126d6`, `8a52749`, `880af38`, `c839bae`                                                                              | Discoverable cloud adapters, versioned slot codecs, structured controls, task/deliverable endpoints and hardened album engine |
| 2 · Creator UI, templates and SDK      | `898449f`, `a6cd6d8`, `920b96b`, `d123b3c`, `e48a51b`, `29c4caa`, `c839bae`                                             | Storyboard split/drag/search, reusable LoRA controls, six templates, full-screen preview and generated SDK helpers            |
| 3 · Acceptance and repairs             | `8b14e33`, `26a5a7c`, `6ad7e1b`, `622e03d`, `89e54ae`, `a5d180a`, `4709022`, `f39e643`, `0e710ff`, `d44a294`, `43a4b86` | Matrix/lifecycle/SDK/stress/precision regressions, three adversarial reviews, independent rechecks and the other-file review  |

Subsequent repairs include `267be1c` (tested schema stack and dependency ordering), `fc62363`/`2648236` (ordinary Windows short paths), `8ba6829` (canonical fixtures and actual Python 3.11 launcher selection), and `4ac2ae5`/`375fcc5` (owned export paths and their independent review). Each wave used the available three active child slots. Review reports name their exact ownership and evidence; source and generated artifacts were consolidated by the root agent.

Three final adversarial reviewers covered today's backend, frontend and security changes. Findings were repaired with reproductions, then different reviewers checked the repaired backend/security boundaries. The frontend author of each repair did not author its reviewer tests. The shared handoffs are:

- [Backend adversarial](final-backend-adversarial.md) → [fresh backend recheck](backend-fresh-recheck.md)
- [Security adversarial](final-security-adversarial.md) → [fresh security recheck](security-fresh-recheck.md)
- [Frontend adversarial](final-frontend-adversarial.md), including six fresh regressions

The requested second stage inspected other project files in three areas. It found and repaired token resurrection, malformed/corrupted ZIP failures, busy-work deletion, restore/purge races, non-atomic legacy import and stale scheduler claims:

- [Other API](other-api-final.md), [other engine](other-engine-final.md), [other storage](other-storage-final.md)
- [Fresh other-file recheck](other-fresh-recheck.md) → [final independent recheck](other-final-independent.md)
- The final Windows compatibility repair was independently checked in [Windows recheck](windows-fresh-recheck.md): 47 passed and three permission/platform skips, including actual ordinary short paths and an actual junction rejection. The later export/restore path repair and opaque provider identifiers were independently verified in [export path review](export-path-independent.md).
- Portable cloud recipes reject nested credential fields before profiles can expose or export them. Channel settings still keep current credentials separately, and execution combines them with the frozen ordinary recipe. A final independent [privacy recheck](cloud-recipe-privacy-recheck.md) covers nested arrays, historical invalid records, current credential binding, and validation diagnostics that omit raw request bodies.

The environment allowed the root plus three active children, so actual parallel child count was three; the requested ten simultaneous agents were unavailable. Most feature work used separate worktrees, while later test/review integration used exclusive file ownership in the shared checkout. These execution differences are not represented as ten-agent concurrency or ten atomic worktree merges.

## Final gate ledger

Local fixed-checkout server gate: 1,309 methods passed, one launcher/environment skip. The last LoRA precision correction then passed the five-shape/tiny-value/finite-bound matrix and all 43 workflow cases plus six core dispatch and 12 lifecycle cases. Frontend: 838 tests in 93 files passed, including the precision form-validity regression; typecheck, formatting and production build passed. Spike: 80 passed. Standalone assistant: 22 passed, its build and committed-dist check passed. Generated client/extension contracts have zero drift; Ruff passes after the later path repairs too. All three extension CTKs and the wallpaper-theme CTK passed. The clean checkout verified all 64 distribution files, `build_distribution.py --check`, and a 13-template package with 239-route extracted-application startup.

The last local full server attempt initially hit the existing update test's nondeterministic ZIP timestamps: the fixture regenerated archive bytes separately for the signed manifest and download. It now reuses one archive per version. Its 12-case module and the subsequent 1,309-method full run passed. An earlier live-edit full run hit a newly generated route before the already imported app had it; the final gate uses a fixed checkout. Neither failure was treated as a product pass or fixed by weakening an assertion.

Production integration was pushed as `c839bae`; the first remote run revealed CI installed Spike's Pillow dependency too late and resolved newer FastAPI/Pydantic versions than the checked-in schema generator environment. `267be1c` installs Python dependencies first and pins the tested schema stack. Its Ubuntu Python 3.11 job passed all 1,314 tests. Its Windows launcher selected the machine's Python 3.15 rather than the matrix's 3.11; CI now explicitly sets the launcher version. Normal short path aliases are accepted while actual link/reparse ancestors remain rejected; canonical test paths retain the original security assertions. Gate time budgets are 30 minutes to accommodate the observed roughly 13-minute Python 3.11 backend run and the remaining frontend/package checks.

Production integration `4ac2ae5` was followed by the portable-recipe validation guard and independent regression evidence. The authoritative final gate is the [latest main CI run](https://github.com/lumingya/comfy-comic-studio/actions/workflows/ci.yml?query=branch%3Amain); final delivery identifies its exact run and observed result. Clean-checkout smoke packages verify all 64 shipped files and pass extracted startup with 239 routes. They are unsigned local test artifacts, not releases published or installed over the user's application.

ComfyUI testing covered one selected neutral base output, 512×512 and four steps, with all 43 user LoRAs disabled. It did not exercise production-quality upscaling, every optional branch, or paid cloud APIs. Review conclusions cover the inspected paths and reproduced boundaries; they do not establish that every possible defect in the whole repository has been eliminated.

</details>
