# Mio 后续开发路线图（建议稿 · 2026-09-25）

> 基线：`main @ 79ea9c0`。本文是一次完整代码审查后的建议，供后续开发（人或 AI 代理）按阶段推进。
> 项目处于早期阶段，**不要求向后兼容**，允许根本性重构，一切以「效果」为准。
> 审查时的轻量验证：`node js/build.js dev` 通过；`node js/tests.js` 91/91；`python -m unittest` 672 项 OK（跳过 4 项）。

---

## 0. 结论

工程纪律很强：沙盒里的轻量门禁全绿，付费请求安全语义做得很细。不过 GitHub 上的完整 CI 门禁从未通过，见 §2.2 第 9 条。但**投入明显偏向「平台化」**：主干 135 个提交里有 99 个是最近 7 天提交的，主要做了开放 API（操作数 40→210）、扩展 SDK v3、样式工坊、更新中心、回收站、框选与命令面板。

真正决定作品效果的创作核心，目前仍是「文本变量替换 + 基础文生图」，包括四块：角色一致性、结构化剧本、漫画排版嵌字、出图质检。

建议分四步：

1. **冻结平台功能**
2. **重写前端**
3. **按新的领域模型重组后端**
4. **集中做四件事**：参考图驱动的一致性出图、结构化剧本、排版嵌字、质检闭环

每次改动都用一套固定的「效果基准」衡量。

---

## 1. 对开发意图的理解

- **产品**：Mio · 绘页（原 ComfyComic Studio），本地优先的「从一个故事到一本画册」工作室。
- **主链路**：
  1. 分镜：逐幕提示词和台词
  2. 预设：角色、服装、画风变量，以及参考图、LoRA
  3. 装配：分镜 × 预设，生成不可变的任务快照
  4. 生产队列：多任务并发、付费安全、可恢复
  5. 画册：阅读模板、气泡编辑
  6. 导出：HTML / ZIP / PDF / `.mio.zip`
- **目标用户**：用 ComfyUI、NovelAI 或 OpenAI 兼容中转的二次元插画创作者。早期卖点是批量生产，即「批量角色矩阵」：角色 × 故事模板。
- **辅助能力**：LLM 分镜助手、台词生成、用 XML 生成模板、视觉审图；`/api/v1` 面向机器人集成（AstrBot）；扩展和主题生态。
- **开发方式**：多个 AI 代理并行。提交记录里有「AI 1 / AI 2 融合」、红队审查、T1–T11 任务单；靠验收测试和开发日志对抗上下文丢失。

---

## 2. 现状体检

### 2.1 值得保留的资产

| 资产 | 位置 | 新架构中的用法 |
|---|---|---|
| 付费请求安全语义：不可变快照、幂等提交、结果未确认（uncertain）、不隐式重试、立即停止并关闭 socket | `mio_jobs.py`、`mio_frame_jobs.py`、`providers/transport.py`、`reliability.py` | 作为统一任务引擎的**规格与测试来源**，语义原样继承 |
| ComfyUI 映射启发式（模型、LoRA 堆栈、种子识别） | `backend/ecosystem/workflow_slots.py` | 作为显式绑定之外的兜底识别 |
| 导出管线：元数据清洗、WebP 轻量发布、离线 HTML | `mio_export_images.py`、`mio_layout_export.py`、`data/layouts/` | 作为「插画画册」输出模式保留 |
| 声明式路由与自动 OpenAPI | `backend/api_v1/` | 思路保留，迁到 FastAPI 后交给框架承担 |
| 错误码体系与付费确认文案 | `docs/guide/TROUBLESHOOTING.md` 等 | 直接复用 |

### 2.2 主要问题

| # | 问题 | 证据 | 影响 |
|---|---|---|---|
| 1 | **投入失衡** | 近 7 天 99 个提交几乎都在平台和交互细节上。随包工作流仍是 `CheckpointLoaderSimple → KSampler` 基础图，模型名是占位符 `your-anime-model.safetensors` | 出图效果没有提升，复杂度持续上涨 |
| 2 | **一致性全靠文本** | 分镜提示词形如 `{character}, {outfit}, {style}, {scene}, {weapon}, …`。参考图只是可选的「图片变量」，ComfyUI 还要手动映射 `LoadImage` | 多幕角色漂移。2026 年的主流做法已是参考图驱动的多参考编辑模型 |
| 3 | **还不是「漫画」** | 数据模型是「一幕一图」（`book.steps`），没有页、格、版式的概念。分幕只有 name/camera/prompt/caption 等少量字段，缺少出场角色、表情、说话人、场景引用。LLM 用中文标签的 XML 生成模板 | 缺少漫画核心：分格节奏、排版、自动嵌字 |
| 4 | **前端难以演进** | `js/` 运行时约 1.98 MB，有 1353 个全局函数，`.eslintrc.json` 登记了 1311 个全局名。812 行超过 400 字符，最长 3216。`handleAction` 被 16 个模块包装，`render` 被 12 处包装。扩展 SDK 按函数名 patch 全局函数。i18n 用 TreeWalker 逐条替换 DOM 文本（2000+ 条中英对照） | 每加一个功能就多叠一层包装，回归只能靠 61 个 Playwright 脚本兜底。AI 代理读一行就要耗掉大量上下文 |
| 5 | **数据有两处真相** | 浏览器持有整份 `state`（schema 2.2，整体校验，存储有 IndexedDB、localStorage、目录、原生同步几种模式）；服务端另有文件库、生产队列 JSON、任务 SQLite。为此需要「防冲刷保护」：资产数骤减 40% 时拒绝保存 | 同步、快照、修订号类缺陷反复出现 |
| 6 | **两套任务系统** | `backend/production/*`（JSON TaskStore）与 `mio_jobs` / `mio_frame_jobs`（SQLite/WAL）。文档明确写着它们是两套状态机 | 维护成本翻倍 |
| 7 | **内部命名与界面术语不一致** | 代码里叫 templates / rows / books / steps / projects / matrix，界面上叫分镜 / 预设 / 画册 / 分幕 / 画册集 | 新人和新代理的理解成本高 |
| 8 | **公开仓库里有杂物** | 根目录有 `jam_events.json`（一次 gemini.google.com 浏览器会话抓包，472 KB）、`stream_generate_resp.txt`、`parse_stream.py`、`check_err.py`、`dump_blocks.py`。33 个生成的 HTML 文档（2.9 MB）入库。`CURRENT_STATUS.md` 还停在 3.1.0-dev.2 | 暴露个人使用痕迹，也给代理制造噪声 |
| 9 | **CI 门禁从未变绿** | GitHub Actions 上「Linux reliability and browser regression」68 次运行全部失败。最近一次卡在 `test:current` 的第一项 `tests/production_scene_ui.mjs`，断言「mobile queue has no horizontal overflow」失败。门禁用 `&&` 串联，其后约 30 项 E2E 在 CI 里从未执行。另外 `python tools/check_distribution.py` 在 main 上报 MIO-DATA-001：`settings/comfy.json`、`settings/workspace.json` 和随包工作流的清单哈希已过期 | 沙盒里的轻量测试是绿的，但完整门禁实际没有守住 main。61 个 E2E 脚本的维护成本远高于它们带来的保护 |

---

## 3. 重新定义「效果」

| 层面 | 指标 | 初始目标 |
|---|---|---|
| 画面 | **角色一致性通过率**：每格按设定集的外观清单做 VLM 检查，通过的比例 | 大于等于 85% |
| 画面 | **镜头符合率**：景别、出场人物、动作是否与剧本一致 | 大于等于 80% |
| 叙事 | 一本 12–24 格的作品能读懂：分格有节奏、台词可读、气泡不挡脸 | 人工评审通过 |
| 效率 | 从一句话创意到可读初稿的时间 | 不超过 15 分钟 |
| 效率 | 修一格的时间；每张被采用图的成本（候选数 × 单价） | 不超过 1 分钟；可统计 |

**效果基准（`bench/`）**：固定 1–2 个黄金故事（例如 2 个角色、3 个场景、12 格），覆盖近景、远景、背影、双人互动、情绪变化、夜景。每次改动管线都跑一遍，输出联系表和 `metrics.json`，与上一次对比。图片不入库，只提交指标摘要。

---

## 4. 目标架构

### 4.1 领域模型 v3（代码与界面同名）

```text
Project 作品
├─ Bible 设定集
│  ├─ Character 角色：名字、外观清单（发色/瞳色/发型/服装件/饰品）、自然语言描述、标签描述、
│  │                 参考图集（正/侧/背/表情）、服装变体、各模型族的 LoRA
│  ├─ Location 场景 / Prop 道具：描述 + 参考图
│  └─ Style 画风：各模型族的风格描述、风格参考图、LoRA
├─ Script 剧本：梗概 → 节拍 → Page 页 → Panel 格
│  └─ Panel：镜头（景别/角度）、出场角色 [角色, 服装, 表情, 动作, 位置]、场景、时间/光线、画面描述、
│            台词 [说话人, 文本, 类型: 对白/心声/旁白/拟声]、覆盖项（追加提示词/负向/种子/工作流参数）
├─ Take 候选：某格的一次出图结果 + 完整参数快照 + 评分 + 是否采用
├─ Layout 版式 + Lettering 嵌字层（气泡/文字/拟声）
└─ Output 输出：条漫长图 / 漫画页 / 插画画册（现有阅读模板）/ PDF / CBZ / .mio.zip

RenderProfile 出图配置：渠道 + 模型或工作流 + 提示词方言（标签/自然语言）+ 能力（最多参考图数、是否支持编辑、尺寸）
Job / Attempt：统一任务引擎（继承现有付费安全语义）
```

现有的 `{变量}` 保留为高级覆盖层，给熟练用户用，但不再是默认的创作方式。

### 4.2 后端

- **框架**：Python 3.11+、FastAPI、Pydantic、uvicorn。OpenAPI 自动生成，再用它生成前端的 TS 类型；WebSocket/SSE 原生支持。如果坚持零依赖，也可以保留现有声明式路由，但要解决 `http.server` 做 SSE/WS 的限制。
- **存储**：一个 SQLite 库作为元数据的**唯一真相**。素材按 sha256 存到 `data/assets/`。`.mio.zip` 只作导入、导出、分享格式，现有文件库 JSON 降级为交换格式。
- **统一任务引擎**：合并生产队列与 `mio_jobs`。要保留的语义：不可变快照、幂等键、租约、uncertain 状态、不隐式重试付费请求、每任务的并发窗口。事件通过 SSE 或 WebSocket 推给前端。
- **管线模块**：
  - `pipeline/script`：LLM 结构化输出
  - `pipeline/prompt`：提示词编译器，按方言输出
  - `pipeline/refs`：参考图解析与挂载
  - `pipeline/qa`：VLM 质检
  - `pipeline/layout`：版式
  - `pipeline/lettering`：气泡布局
- **providers**：每个适配器都要声明能力。清单：comfyui、gemini、openai-gpt-image、bfl-flux2、seedream（火山方舟）、qwen（阿里云百炼）、novelai、openai 兼容中转。

### 4.3 前端

- **技术栈**：Vite、React、TypeScript（strict）。
  - 状态：TanStack Query 管服务端状态，Zustand 管界面状态。
  - 类型：`openapi-typescript` 生成。
  - 文案：i18next 键值式。
  - 组件：Radix 或 shadcn/ui。
  - 画布：react-konva（版式与气泡编辑）。
  - 拖拽：dnd-kit。
- 换成 Vue 3 + Pinia + Naive UI 同样可行。关键在于 TS、组件化、显式 import、**没有全局函数、没有包装链**。
- **为什么重写而不是渐进重构**：1353 个全局函数加上 16 层 `handleAction` 包装链，逐个拆解的成本高于按已验证的交互重写。而且扩展 SDK 直接依赖全局函数名，渐进重构会同时打破 SDK。现在还没有外部扩展用户，重写代价最低。
- **迁移方式**：新前端放在 `web/`，由后端在 `/` 提供。旧界面迁移期保留在 `/legacy`，核心链路达标后删除。

### 4.4 核心管线（效果的主战场）

```text
一句话创意 / 小说片段
   │  LLM（JSON Schema 结构化输出）
   ▼
剧本：梗概 → 节拍 → 页 → 格（镜头 / 出场角色 / 表情 / 动作 / 场景 / 台词）   ← 用户可编辑
   │  自动抽取角色、场景草稿
   ▼
设定集：角色外观清单 + 参考图集（三视图 / 表情表）、场景、画风                ← 用户挑选锁定
   │  提示词编译（标签方言 / 自然语言方言）+ 按引擎能力挂载参考图
   ▼
出图：每格 K 个候选（ComfyUI 本地 / 云端多参考模型）
   │  VLM 质检（外观清单 + 剧本符合度）→ 自动挑选 / 标红 → 单格指令修图
   ▼
版式：版式模板 → 每格画幅 → 反推出图尺寸 → 裁切适配
   │  嵌字：人物/人脸框 → 气泡避让 + 阅读顺序 + 尾巴指向说话人
   ▼
输出：条漫长图 / 漫画页 PDF·CBZ / 插画画册（现有阅读模板）/ .mio.zip
```

**A. 结构化剧本**

- 流程：一句话或小说片段 → 梗概 → 节拍 → 分页分格。
- 输出方式：用 JSON Schema 结构化输出。网关不支持时，退回 `json_object` 模式，再做校验和自动修复。
- 同一步里抽取角色和场景草稿，放进设定集。
- 取代现在用中文标签 XML 生成模板的做法。

**B. 设定集**

- 为角色一键生成设定图（三视图 + 表情表），用户挑选并锁定。
- 外观清单自动生成，提示词编译和质检共用同一份。

**C. 提示词编译器（纯函数，便于单测）**

同一格编译成两种方言：

- 标签方言，用于 Illustrious / NoobAI / NovelAI：
  `1girl, nanami, silver hair, white shirt, navy skirt, medium shot, holding letter, train station, dusk, <画风标签>`
- 自然语言方言，用于 FLUX.2 / Qwen-Image-Edit / Nano Banana / GPT Image / Seedream：
  `Medium shot. Nanami (image 1) stands on an old train platform at dusk, holding a letter. Keep her face, hair and outfit exactly as in image 1.`，并附上每张参考图的角色说明。

参考图自动挂载：根据出场角色选图，再按引擎允许的最大参考图数裁剪。优先级：角色 > 场景 > 上一格。

**D. 候选与质检闭环**

- 每格出 K 个候选：本地便宜，可以多出；云端少出。
- VLM 按外观清单和剧本逐项打分，输出 JSON。
- 自动选出最优，低分标红。
- 一键「修这一格」：用指令编辑改表情、去掉多余手指、换姿势。
- 保留 Take 历史。

**E. 版式与嵌字**

- 版式模板：四格、六格、日漫动态格、条漫、单页大图。
- 由版式决定每格画幅，再反推出图尺寸，并吸附到模型支持的尺寸。
- 气泡自动布局：
  - 由 VLM 或检测器给出人脸和人物框
  - 在低显著区域放气泡，按阅读顺序排列（日漫从右到左，条漫从上到下）
  - 尾巴指向说话人
- 支持中日文竖排和拟声字，复用现有图片编辑器的气泡与竖排能力。

**F. ComfyUI 集成升级**

- **显式绑定约定，零插件**：在节点标题里写 `[mio:prompt]`、`[mio:negative]`、`[mio:seed]`、`[mio:ref:1]`、`[mio:width]`、`[mio:height]`、`[mio:output]`。API 格式导出本身带 `_meta.title`，不需要装任何插件。显式绑定优先，现有启发式识别作兜底。
- **WebSocket 进度与预览**：连接 `/ws?clientId=…`，接收 executing、progress 和预览帧，取代轮询 `/history`。
- **缺失节点提示**：用 `/object_info` 对比工作流里的 `class_type`，直接告诉用户缺哪些自定义节点。
- **3–4 个精选官方模板**，每个附所需模型清单：
  - Illustrious / NoobAI 动漫 + LoRA：快，用标签方言
  - Qwen-Image-Edit-2511 多参考：重一致性，FP8 约需 16 GB 显存
  - FLUX.2 Klein 9B：4 步，编辑与生成都支持，多参考
  - 放大与精修

**G. 云端引擎**

- Nano Banana 2 / Pro、GPT Image 2、FLUX.2 Pro/Max、Seedream 5.0 等多参考模型作为一等公民。
- 国内用户优先接可直连的渠道，例如火山方舟、阿里云百炼。

---

## 5. 分阶段路线图

每个阶段都要写明**交付物**和**完成标准**，一次只推进一个垂直切片。

### Phase 0 · 止血与瘦身（1–2 天）

- [ ] 删除调试遗留文件：`jam_events.json`、`stream_generate_resp.txt`、`parse_stream.py`、`check_err.py`、`dump_blocks.py`。可以考虑用 `git filter-repo` 清理历史。
- [ ] 根目录的 `FIXES.md`、`SELECTION_CHANGES.md` 和过时的状态文档移到 `docs/archive/`。
- [ ] 生成的 HTML 文档移出版本库，发布时再构建。演示画册和截图移到 Release 附件。
- [ ] 新增 `AGENTS.md`，一页说清架构、常用命令、禁区和沙盒协作规范，取代散落在各开发日志里的「沙盒规则」段落。
- [ ] 在本文 §6 宣布冻结清单。
- [ ] **让 CI 变绿**：
  - 每次推送只跑轻量门禁，并且必须通过：`node js/build.js dev`、`node js/tests.js`、`python -m unittest`、`python tools/check_distribution.py`。
  - E2E 改为手动或每夜运行，并拆成互不阻断的并行任务。
  - 修复 `production_scene_ui.mjs` 的手机横向溢出问题。
  - 运行 `python tools/build_distribution.py` 更新随包清单。
- **完成标准**：根目录只剩源码和必要配置；新代理读 README、AGENTS.md、ROADMAP.md 即可上手；main 的 CI 显示绿色。

### Phase 1 · 效果基准与领域模型 v3（约 1 周）

- [ ] `bench/`：黄金故事和运行脚本。先支持对「已有图片目录」做离线评估，VLM 可选；输出联系表和 `metrics.json`。先用现有管线跑出基线。
- [ ] `docs/DOMAIN_V3.md`：v3 规格、SQLite schema、Pydantic 模型和单测。
- [ ] `pipeline/prompt` 提示词编译器（双方言）和单测。纯逻辑，可以在沙盒里用 `python -m unittest` 验证。
- [ ] ComfyUI `[mio:*]` 标题绑定。先接进现有 `workflow_slots.py`，优先级高于启发式，并补单测。**这项对现有版本立即有收益。**
- [ ] 旧数据一次性导入器，只导分镜、预设、工作流。
- **完成标准**：基线指标入库；v3 schema 评审通过；编译器和标题绑定的测试通过。

### Phase 2 · 新骨架与第一条垂直切片（2–3 周）

- [ ] 旧代码移到 `legacy/`，迁移期仍可运行。建立 `server/`（FastAPI）和 `web/`（Vite + React + TS）。
- [ ] 统一任务引擎：移植付费安全语义及对应的测试用例。
- [ ] providers 迁移，并加上能力声明。
- [ ] 切片：一句话 → 结构化剧本 → 设定集 → 分格出图板（候选与采用）→ 用现有阅读模板阅读。
- **完成标准**：黄金故事能在新链路上跑通，指标不低于基线。

### Phase 3 · 一致性与质检闭环（约 2 周）

- [ ] 参考图驱动出图，接入能力矩阵。
- [ ] 2 个精选 ComfyUI 模板，2 个云端多参考适配器。
- [ ] VLM 质检自动挑选，单格指令修图，Take 历史。
- **完成标准**：一致性通过率大于等于 85%，修一格不超过 1 分钟。

### Phase 4 · 版式与嵌字（约 2 周）

- [ ] 版式模板，由画幅反推出图尺寸。
- [ ] 自动气泡布局，支持竖排和拟声字。
- [ ] 导出 PDF、CBZ、条漫长图；插画画册模式沿用现有模板。
- **完成标准**：黄金故事能自动出一版可读的漫画页，人工只需微调。

### Phase 5 · 再开放（之后）

- [ ] 基于新领域模型自动生成 API v2，以及 TS / Python 客户端；恢复机器人集成。
- [ ] 扩展改为少量稳定的领域钩子：provider、exporter、提示词编译、版式。不再按函数名 patch 核心。
- [ ] 主题、市场、更新中心按需回归。更新中心需要先做签名校验。
- [ ] 删除 `legacy/`。
- 可选方向：动态漫 / 漫剧，即分格加镜头运动和配音。

---

## 6. 冻结与删除清单

**冻结**：不再加功能，只修阻断性问题，新架构里按需重建。

- 扩展 SDK v3，尤其是按函数名 patch 核心的能力
- 样式工坊 / 主题包 v3（含 `theme.js`）、用户脚本、可执行变量（Node 沙箱）
- 更新中心、市场
- API v1 扩张：现有 210 个操作已足够，新接口等 v2 自动生成
- 桌面框选、命令面板等锦上添花的交互

**迁移完成后删除**：

- 浏览器端的多种存储模式：IndexedDB、localStorage、目录、单文件 HTML bundle
- 「批量角色矩阵」遗留的 rows / storyVersions
- 离线 mock 演示，改为提供一个带预生成图片的示例作品
- 按 DOM 文本替换的 i18n

---

## 7. AI 协作开发规范建议

- **入口文档只保留三份**：README（给用户）、AGENTS.md（给代理）、ROADMAP.md（任务勾选）。开发日志只追加，不另起新文件。
- **代码格式**：前端用 Prettier，Python 用 ruff format，行宽 100。禁止压缩风格的单行函数。TS 用 strict。单文件尽量不超过 400 行。
- **测试金字塔**：
  - 主体是领域单测：提示词编译、版式、气泡布局、任务状态机。
  - 加上 API 契约测试。
  - E2E 只保留 3–5 条主链路冒烟，在本地机器上跑。
  - 效果基准单独跑。
- **任务单**：每个任务写明完成标准和要跑的轻量命令，一次只推进一个垂直切片。
- **不入库**：生成物、大文件、截图。沙盒里用 `git clone --filter=blob:none`：本次实测 `.git` 只有 338 KB，工作树 26 MB。完整仓库历史约 57 MB。
- **密钥**：PAT 用细粒度权限、只限本仓库、设短有效期；在对话里出现过的 PAT，用完即撤销。

---

## 8. 需要拍板的决策

1. **主形态**：条漫（竖屏）、漫画页（多格）还是插画画册？
   建议：数据模型按「页—格」设计，默认条漫或漫画页，画册作为一种输出。
2. **主力出图**：本地 ComfyUI 还是云端多参考模型？
   建议：两者都是一等公民，但先各做一个。
3. **前端框架**：React 还是 Vue？
4. **旧数据**：是否只做分镜、预设、工作流的一次性导入？
5. **迁移期**：机器人 / API 集成是否必须一直可用？这决定旧后端要保留多久。

---

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| 重写陷入「功能对等」泥潭 | 以垂直切片和效果基准为验收标准，不追求与旧功能对等 |
| 云端模型更新快 | 用适配器、能力声明、提示词方言三层隔离 |
| VLM 质检不稳定 | 结构化清单、多次投票，最终由人拍板 |
| 本地显存门槛高（Qwen-Image-Edit FP8 约 16 GB） | 提供 GGUF、FLUX.2 Klein 等轻量档，以及云端档 |
