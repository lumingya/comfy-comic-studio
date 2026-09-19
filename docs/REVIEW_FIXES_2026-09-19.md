# 新用户评测复核与修复（2026-09-19）

对照《Mio绘页-新用户视角深度评测综合报告》逐条复现了仍未修复的 C1–C7，全部属实。以下为最终采用的修复策略（部分与报告建议不同）、对应的自动化测试，以及同批完成的品牌标识与首页改版。

## C1 · 种子映射被前后端双重误判（阻塞级）

- **现象**：映射向导与内置工作流写入的是 `sceneParameter / seed`，而 `designerSeedReady()`（前端）与 `seed_binding_ready()`（后端）只认 `random`，导致种子开关始终不可用；同时 `compile_workflow` 把所有分镜参数映射都挂在「渲染覆盖」开关之后，未开启覆盖的分镜全部沿用蓝图里的固定种子，整本画面雷同。
- **修复**：
  - `backend/ecosystem/workflow.py`：`sceneParameter/seed` 不再受渲染覆盖门控，每一幕都会写入本幕种子（可复现 = 基准 + 幕序号；否则每次新随机）。宽高、步数、CFG 等其它分镜参数仍只在单幕开启覆盖时写入。
  - `backend/production/api.py`：新增 `is_seed_binding()`；分镜自带的 seed 只在开启渲染覆盖时视为显式种子。
  - `js/architecture.js` / `js/engine.js` / `js/workflow-workbench.js`：前端判定与浏览器端编译镜像同样的规则，并更新帮助文案（映射列表中种子显示为「seed · 每幕自动写入」）。
  - 装配向导新增非阻塞提示：所选 ComfyUI 工作流没有任何种子映射时明确告知后果与入口。
- **测试**：`tests/fixtures/workflow_mapping_contract.json` 新增 `frame-seed-not-gated` / `frame-seed-with-override` / `frame-seed-missing-keeps-original`（前后端共享契约）；`tests/test_production_adapter.py::test_seed_gate_accepts_scene_parameter_seed_mapping`。

## C2 · 纯文生图工作流引用图片变量导致整本失败（严重）

- **修复策略**：不再在 `comfyui.py` 抛出 `Unbound image N` 终止任务。`backend/production/api.py` 新增 `prune_unbound_images()`：编译后只保留图中确有节点消费的参考图，剩余 `mio-image://N` 令牌重新连号；被忽略的参考图通过 `report_attempt` 写入任务的 `notices`，在装配工坊的诊断面板中可见。文字提示词照常生成。
- 装配向导第三步新增预检提示：预设含图片变量、提示词引用了它、而工作流没有任何图片输入映射时，提前说明「参考图会被忽略」与修复入口。
- **测试**：`test_unbound_reference_images_are_dropped_instead_of_failing`。

## C3 · NovelAI CFG 上限与前端滑杆不一致（严重）

- `backend/providers/novelai.py`：`scale` 允许范围改为 0–30，与分镜编辑器一致（NovelAI API 接受大于 10 的引导值）。
- 装配向导对 NovelAI 渠道新增提示：CFG 高于 10 的分幕列出幕号，说明可能过饱和但不阻塞。
- **测试**：`test_novelai_accepts_the_editor_cfg_range`。

## C4 · Chat 协议的模型拒绝理由被「invalid image」吞掉（严重）

- `backend/providers/openai_chat.py`：
  - 新增 `message_text()` 汇总 `content` / `refusal` 文本；新增 `looks_like_page()`，散文中的站点根路径、目录页与 `.html/.pdf` 等链接不再被当作图片候选（Markdown 图片语法与无扩展名的下载链接仍然接受）。
  - 新增 `ModelTextResponse`：模型只回复文字时抛出「模型没有返回图片，而是回复了文字：…」；附带链接下载失败时抛出「模型回复中的链接无法作为图片下载（原因）。模型原文：…」。
- `backend/providers/cloud.py` 接入上述异常；`reliability.failure_summary` 对这两类消息原样透传，不再折叠成泛化分类。
- **测试**：`test_chat_refusal_text_surfaces_instead_of_download_error`。

## C5 · Chat 协议的画幅提示依赖被禁用的 sendSize 开关（严重）

- 新增独立配置 `sendAspectHint`（默认开启）：`openai_chat.build` 只看这个开关；`CONFIG_FIELDS`、外部 API 白名单与 OpenAPI 文档同步。
- 设置页在 Chat 协议下不再显示灰掉的尺寸/质量项，改为「把分镜画幅比写进提示词」开关及说明。
- **测试**：`test_chat_requests_image_modality_and_describes_aspect_ratio` 改为断言 `sendSize` 不再影响提示；`tests/first_use_journeys.mjs` 同步。

## C6 · 正方形分镜没有画幅提示（轻微）

- `aspect_hint()` 对正方形输出 `Output a single square image with aspect ratio 1:1 (1024x1024).`。
- **测试**：`test_chat_square_frames_get_an_aspect_hint_too`。

## C7 · 导出互斥的 409 被压成 400（轻微）

- `backend/mio_http.py`：`/api/export/portable` 透传 `LibraryError.status`（及 `code`）。
- `js/ui-export.js`：校验请求遇到 409 时自动退避重试最多 3 次，并在状态栏说明「另一份导出仍在传输」。
- **测试**：`tests/test_audit_round2.py::ExportStatusTests`。

## 品牌标识

- 新标识为「漫画页」：一格带太阳的画面、一格空白与一个对话气泡（画面 + 对白 = 漫画）。
- 应用内 `.brand-mark` 改为纯 CSS：底色 `var(--accent)`，图形通过 `mask-image` 使用新增变量 `--on-accent`，因此浅色模式不再出现烧死在位图里的黑色底块。
- 更新 `favicon.svg`、`index.html` 内联图标、`docs/assets/mio-banner.svg`、`docs/assets/mio-logo.png`、`vendor/mio-logo.webp`。

## 首页

- 引导语改为具体描述工作方式；按钮下方加入「无需先连接模型，也可以编辑分镜与阅读画册」；新增「写分镜 → 连服务 → 出画册」三步说明条。
- 首屏插画改为与新标识同一语言的漫画页（画面、人物、对话气泡）。
- 首次使用卡片标题由「初光映格，微墨生花」改为「第一步，连接你的图像服务。」，并补充「配置不会自动生成」的说明；第三节补齐副标题。
- 所有新增可见文案均有英文对应（`js/ui-locale.js`）。

## 其它

- `data/settings/workspace.json` 的默认主题恢复为 `dark`（上一提交把个人工作区状态一并提交了），并重新生成 `data/distribution.json`，修复 `tests/test_storage.py` 中长期存在的 `MIO-DATA-001` 错误。
- 浅色模式下 `.provider-options` 边框沿用主题变量。
