# 开发与扩展 / Development

[教程中心](README.md)

## 第二轮主动排查（2026-09-18）

`test:current` 追加 `test:audit-round2`，Python 自动发现 `test_audit_round2.py`。第二轮覆盖重复 key/200 次确定性 DOM 变换、弹窗延后刷新、画册补齐确认、批量补齐不部分启动、传输结果未确认、关闭后句柄、Host 与畸形 CSRF 边界。

- 新增 Host 白名单：默认 localhost / 127.0.0.1 / ::1 与实际绑定地址。使用自定义域名、反向代理或 `0.0.0.0` 下的局域网 IP 时，通过 `MIO_ORIGINS` 指定完整可信 origin，例如 `https://studio.example`。不要信任任意 Host、不要用通配域名代替显式入口。跨站能力令牌不等于公网身份认证。
- 画册“补齐”复用任务卡的费用确认与未确认结果额外确认。没有关联任务时转到装配队列，不再回落到旧执行器。
- 旧“批量补齐”不是原子批次，会出现第一本已开始而第二本报错。现改为转入任务卡逐本确认，**不再承诺该入口一键批量执行**；也不会以顺次启动所有队列任务代替所选范围。
- 传输超时、断连、截断与上游已有 ID 但结果不可读，进入 page.state=uncertain，禁止无额外同意重发。明确的 ExecutionError 仍是 failed；保存结果后的发布错误保留无付费恢复路径。

## 2026-09-18 审计修复后的验收入口

以 `npm test` / `npm run test:current` 为当前受维护的合并门禁：lint → 56 项前端契约 → Python unittest → assembly / architecture / reading-stage / presentation / pictures / review → 桌面 smoke → 手机 Chromium 回归。清单校验另运行 `npm run test:distribution`。Linux CI 执行这套门禁并校验源码 ZIP；Windows launcher CI 独立保留。

- `tests/audit_browser.mjs` 驱动目前的画册集、创作工坊、可选功能与设置；使用空的隔离数据目录，拦截外部浏览器网络，不调用付费模型。覆盖 DOM 类型、注释、焦点/IME、插入与重排、HTTP 存储边界、CSRF、304、服务器时钟、字体隐私、核对清单下载和启动恢复。
- 原 smoke/mobile 脚本保存在 `tests/legacy_smoke.mjs`、`tests/legacy_mobile.mjs`，仍包含旧编辑器/队列的功能案例，但其选择器不代表当前工坊，**不计入本轮通过数**。其余历史专项入口也不因本次默认门禁通过而自动视为通过；`test:legacy` 保留旧的广泛串行入口供逐项迁移。
- review 仍执行真实 ZIP/PDF 下载与图片/图层/编辑回归；并非仅用 DOM 存在性替换所有旧覆盖。模型选择器、历史队列策略、真机系统键盘/相册等仍需对应专项迁移或人工验收。
- WebKit 可选入口保留，须单独安装该浏览器；本轮 Linux Chromium 通过不代表 WebKit 或真实 iOS/Android 验收。
- 当前主队列实现是 `backend/production/{queue,store,api}.py`，UI 是 `js/assembly-workshop.js`；下文部分 foundation/task-pool 段落记录的是仍保留的兼容子系统，不应误认为同一套状态机。

安全约定：默认只绑定回环地址；私有浏览器 API（包括读取）要求服务首页注入的进程级能力令牌。`Origin: null` 无条件拒绝。此机制防跨站浏览器访问，**不是公网身份认证**：无浏览器来源头的 CLI 仍兼容，`/api/v1` 维持独立 bearer 规则。不要直接公开本地服务。文件 HTTP 模式不会导入/写回旧浏览器工程快照。重启后未确认的付费结果必须核对并再次明确确认，不会自动重发。

## 环境与命令

Python 3.10+ 与 Pillow 11.3–12.x 运行后端；先执行 `python -m pip install -r packaging/requirements.txt`。Node.js 20+ 用于可执行变量、前端构建、lint 和测试。

```bash
npm ci
npx playwright install chromium
npm run build
npm test
```

Linux 若缺浏览器系统库，可在合适权限环境执行 `npx playwright install --with-deps chromium`。不要手改生成的 index.html 再运行 build：它会由模块与 shell 重新生成。

## 模块图

```text
js/state.js                    state definitions and normalization
js/sync.js                     native configuration and file synchronization
js/engine.js                   ComfyUI mapping + provider snapshot/dispatch
js/creation.js                 storyboards, plans, FIFO execution, refinement
js/ui.js                       shared UI state, common views and routing
js/ui-reader.js                 native image reader
js/ui-presentation.js           whole-book reader and explicit export samples
js/ui-templates.js              template compiler, sandbox and page runtime
js/ui-export.js                 export formats; authored content lives in data/
js/ui-editors.js                editor dialogs
js/ui-{locale,assistant,storyboard,gallery,settings}.js  feature-specific views
js/workspace.js                 workflow library, scene overrides, queue composer
js/organize.js                  task order, album order and batch actions
js/app.js                      initialization and module installation
server.py                      local storage, private API, provider transports
mio_api.py                     opt-in /api/v1 contract, auth, DTOs, OpenAPI
mio_credentials.py             local endpoint-bound credential store (not encrypted)
mio_docs.py                    UTF-8 Markdown reader and offline HTML generation
docs/reader-template.html      self-contained reader template
tools/build_docs.py            builds HTML siblings from maintained Markdown
examples/mio_client.py          stdlib integration example
```

运行时 JS 顺序见 `js/build.js`。部分安装器通过包装现有函数组合功能，因此要检查调用顺序与重复包装，不应只添加一个同名声明。`js/shell.js` 提供 HTML 外壳，`styles.css` 是样式源。


## 添加一种图像协议

1. 定义渠道配置及能力：是否需要工作流、支持什么尺寸/参考图、哪些参数有意义。
2. 在 `ensureImageProviders` 中提供真实默认地址/模型配置，不提供伪造凭证。
3. 保持统一生成输入：已解析提示词、负向提示词、帧参数、参考图与冻结配置。
4. 在 `generate_provider_image` 或独立适配模块中实现协议转换；禁止返回模拟成功；明确拒绝不支持的能力。
5. 处理响应大小、图片格式、超时、凭证、重定向和上游错误，不自动重试付费请求。
6. 若向公共 API 开放，更新 generation_payload、capabilities、OpenAPI schema、教程和契约测试。私有适配器实现不等于公共 API 已支持。
7. 添加无真实付费的请求拦截测试、失败测试、参考图测试与浏览器配置持久化检查。

供应商请求构建已拆入 providers/ 并通过显式注册表分派。它不是动态安装/任意执行第三方插件的平台。保持 DTO 和 v1 语义稳定；破坏性改变使用 v2。

## 公共接口演进

- 浏览器状态保存与外部只读 DTO 分离，避免 schema 泄露和全量覆写。
- 新增 /jobs 持久任务 API，和界面共用服务端调度器。旧同步单图接口仅保留兼容；新集成使用不可变快照与幂等提交。owner 是可信本地关联标记，不是多租户权限隔离。
- 更新 schema 后运行：

```bash
python -c "import json,mio_api; from pathlib import Path; Path('docs/api/openapi.json').write_text(json.dumps(mio_api.openapi(),ensure_ascii=False,indent=2)+'\n')"
```

## 测试与发布

- `js/tests.js`：前端契约；`tests/test_storage.py`：数据布局与恢复。
- `tests/test_providers.py`：上游 wire format、ZIP、base64、multipart 与错误。
- `tests/test_external_api.py`：真实本地 HTTP 服务器、鉴权、DTO、错误、并发锁与 OpenAPI 一致性。
- `tests/smoke.mjs`：独立数据目录、Playwright 操作与外部网络拦截。

付费服务只使用替身；不要把协议通过宣称为真实供应商连通。未测试的系统环境和编译步骤必须在发行说明中注明。

完整源码 ZIP 由 `python tools/package_project.py --output releases` 或 `python tools/build_release.py` 构建。无需 PyInstaller，不假装生成未经验证的 EXE。运行模块、vendor、docs、示例与 `data/distribution.json` 明确批准的内容随包携带。禁止自动把整个运行工作区打包；密钥、任务、缓存不分发。

`python tools/check_distribution.py` 验证内容清单。内容变更须审核具体文件后更新该文件哈希，不自动发现个人数据。`npm run test:complete` 覆盖实际导出/导入；设置 `MIO_UPGRADE_BASELINE` 可指定原始 2.1 交付 ZIP，未提供基线时明确跳过该一项升级对照。

## English summary

Build from JS modules, not from generated index.html. Runtime is Python stdlib + vanilla browser JS. Public integrations use `mio_api.py`, not the private browser state. Add adapters with explicit capabilities, immutable execution snapshots, bounded image decoding, sanitized errors and no implicit paid retries. Update the API schema, documentation and transport/browser tests together. Queue integrations use the durable coordinated worker, not direct writes into browser state. Windows and paid-provider verification must be reported separately from automated fixture tests.


## 文档构建与编码

`npm run build` 包含 `python tools/build_docs.py`；仅改教程时也可运行 `npm run build:docs`。编辑 Markdown 源文件或 `docs/reader-template.html` 后必须重建，不要手改生成的 HTML 副本。教程首页 `docs/index.html` 单独维护，不会被此步骤覆盖。

HTTP 下 `.md` 默认返回 UTF-8 HTML 阅读器，添加 `?raw=1` 返回 UTF-8 原文；已有 `.html` 教程链接在 HTTP 下从对应 Markdown 动态渲染；源码树不再跟踪这些生成副本。源码 ZIP 打包时直接生成离线 HTML 并验证哈希，`build:docs` 仍可按需生成本地副本。阅读器将文档内部的相对 `.md` 链接转换为 `.html`，以支持离线文件跳转。README 源文件仍保留 Markdown 链接供 GitHub 等平台使用。

前端文档渲染依赖随包提供的 `vendor/marked.min.js`（15.0.12）和 `vendor/purify.min.js`（DOMPurify 3.4.15），不需要 pip 或运行时 CDN。对应许可证同目录分发。原始文档只作为转义 JSON 嵌入，HTML 经过净化后才放入页面；禁止取消这一步。文档 HTTP/渲染覆盖见 `tests/test_docs_server.py`；旧文档浏览器操作案例保存在 `tests/legacy_smoke.mjs`，本轮未计入通过数。

## Production foundation modules

- `mio_jobs.py`: SQLite/WAL state machine, immutable idempotent snapshots, one-worker lease, scheduling, controls and replay events. Interrupted attempts are not retries.
- `mio_foundation.py`: shared private/public task endpoints, asset catalog/provenance/recycling, revision-checked resource edits, and read-time album result projection.
- `mio_contracts.py`: public foundation schemas and OpenAPI paths.
- `providers/__init__.py`: explicit built-in builder registry, protected advanced parameters, isolated per-request adapter contexts and result normalization.
- `providers/openai_images.py`, `openai_chat.py`, `novelai.py`: protocol request builders; `cloud.py` shares bounded transport and image decoding. `comfyui.py` handles server uploads, one-time submission, history polling and read-only reconciliation.
- `js/foundation.js`: explicit frozen-input creation, held-job submission, status reconciliation and service actions. Real `runQueue` points directly to this service entry; mock fixtures retain their isolated executor.

When adding a provider, preserve ordered image semantics, `contractVersion: 1` artifact lists, error redaction and no implicit paid retries. Provider-specific parameters may be extended but cannot override prompts, image bindings or credentials. Update the schema, transport tests and acceptance guide together.

Regression entry points: `tests/test_jobs.py`, `tests/test_foundation.py`, `tests/foundation.mjs`; `npm run test:foundation`. The close-page acceptance fixture uses a real Python worker and local HTTP image provider rather than browser route interception.

### 手机专项回归

`npm test` 包含 Chromium 触控模拟；`npm run test:mobile` 可单独执行。安装 WebKit（`npx playwright install --with-deps webkit`）后执行 `npm run test:mobile:webkit`，覆盖另一套浏览器引擎。测试无真实付费请求；手机系统键盘和相册仍需真机验收。响应式 CSS 集中在 styles.css 的 Mobile workspace 区域，可视窗口事件只调整布局变量，不重新渲染编辑器。

体验专项：`npm run test:experience` 覆盖路径滑选、Esc、检查无副作用、关联删除、策略确认与全屏目标。服务端重试预算/暂停/继续/未知结果由 `tests/test_jobs.py` 覆盖。


### Recovery and parallel execution regression

`npm run test:recovery` drives the browser through a real local Python service and intercepted HTTP provider. It checks first-success/second-disconnect wire order `0,1,1,2`, same-job/book recovery, fresh billing consent, subset mapping and request counts (sorted: `1,3,3,5`), stale confirmation rejection, configured within-task HTTP overlap, default FIFO task admission, timeout persistence, and the held-job polling/submission race. Python tests additionally cover actual HTTP timeout arguments, ComfyUI remaining budget, consistency guards, concurrency reductions and process-lease retention during shutdown. No paid/GPU requests are made.


### Immediate stop, revisions and presentation regressions

`providers/transport.py` installs per-request HTTP(S) connections whose established sockets can be shut down by the job controller. A separate SQLite epoch per frame fences late results/checkpoints; cancel does not fabricate a provider attempt count. DNS/connect phases may finish in the background, but invalidated attempts cannot submit after registration or adopt output. Provider-side cancellation/billing is not guaranteed.

`tests/recovery_parallel.mjs` additionally verifies within-task overlap, immediate stop before response, local socket closure, discarded late output, held-batch release, wrapped content rejection, prompt amendment with retained images/identity/history, and persistent logs after reload. `tests/presentation.mjs` covers missing-scene export samples, decoded images, real Chromium fullscreen top-layer ordering, close cleanup and reopening. These use local fixtures, not paid generation.

### Per-task window acceptance

`npm run test:pools` drives a real browser → Python dispatcher → controlled local HTTP provider. It holds request responses independently, verifies four in-flight frames in one task, refill while an earlier frame is still blocked, explicit second-task start yielding eight real requests, sparse album projection, pause/drain, tail windows, FIFO next-task admission and reload persistence. Python tests cover task-local failure pause, independent socket cancellation, retries/amendments around completed holes, per-frame restart migration, fail-closed migration, indexed consistency and active-pool admission.

`mio_jobs.py` owns the shared schema/lease/dispatcher helpers; `mio_frame_jobs.py` owns per-frame scheduling and controls. The dispatcher has no shared 32-worker throttle: the explicit limit is 32 enabled task pools. Never use cursor as a prefix, iterate futures in submission order, or wait for a whole batch before refilling. Every read used for state projection must see one SQLite snapshot. Add new module files to all isolated browser fixtures and release packaging.

Presentation tests also verify custom CSS positions narration over the image in both preview and the actual downloaded offline HTML; no new presentation framework was needed.

### Read-before-request inputs

`Jobs(..., resolve_frame=...)` resolves a saved album-local input outside the dispatcher/SQLite lock immediately before provider execution. `latest_frame_input` reads raw saved workspace data, never execution projection (avoiding a lock cycle), and checks fixed channel/album/index bindings. The browser’s ordinary storyboard editor saves compiled per-frame inputs in that album’s `sourceSnapshot.liveInputs`. Invalid drafts are explicit errors, not fallback prompts. Original submission digests remain unchanged. Each attempt captures durable `request_inputs`; canceled epochs cannot send/adopt stale work. Reconcile uses the original attempt snapshot. Historical request input image references remain protected until archive.

The existing editor’s scope selector chooses an exact album version; it must not switch to an older unfinished job after completion. Version-specific scene lists may differ from current shared templates. Request records preserve sent prompt versions even if UI text changes during the request. API `amend` remains separately audited for external clients, with newer explicit amendments taking precedence over older saved drafts.

New regressions: original-editor retry, eight-slot HTTP fixture with task-local edits after enqueue, version selection with differing scene lists, in-flight edit isolation, leaving the page before next dispatch, immutable shared templates, actual request history, invalid input refusal and original-input ComfyUI reconciliation.

### Channel-reference architecture and queue UI

`mio_channels.py` is the shared resolver for execution and safe configuration previews. New browser frames persist channelId + provider type; existing browser config.id is recognized for migration. `latest_frame_input` reads scene content and channel registry from ONE saved-workspace snapshot outside the scheduler lock. It replaces, rather than merges, current channel configuration. Request preparation records the resolved config; historical input is not a fallback for missing references. `ChannelConfigurationError` blocks only that task’s further dispatch, avoiding an error storm. Reconciliation deliberately bypasses current configuration.

Task-pool HTTP tests change the actual model and endpoint fields, assert both linked tasks use the new values, retain old in-flight inputs and inspect request history. Unit tests cover key-reference replacement/removal, invalid/deleted channels, legacy ID resolution and no provider call on configuration failure. Queue refresh preserves open disclosures. Runtime settings are compact, per-task diagnostics are folded, irrelevant cloud workflow controls are omitted.

## 默认发布结构 / External release

`npm run build` 与 `node js/build.js` 默认产生外链 HTML：`styles.css` 与按顺序加载的 `/js/*.js`，资源附内容哈希查询串用于升级缓存失效。`index.html` 约 7 KB。使用 Python 服务打开工作台，不是双击 HTML。显式 `node js/build.js bundle` 仅供诊断内联输出，会覆盖 index；正式发布前再运行 `npm run build`。

功能文件先声明，UI 共享数据随后初始化，最终 app.js 安装功能。此轮是可维护性及缓存拆分，不宣称已经按需懒加载或减少总执行量。全册自定义模板按最多四张并行准备图片；普通 512 幕阅读仍只渲染当前画面。整册模板对超大型画册仍有载入及内存开销。

`tests/presentation.mjs` 验证 24 幕完整顺序、无重复/换文档、最后页结尾、手机单幕，以及显式样张三张。`tests/test_jobs.py` 覆盖多种 4xx/5xx、422 稀疏完成、四轮手动续试的新自动额度、逐幕事件与旧错误隔离。

最终请求体在适配器完成参数构造后单独记录为 `requestParameters`，包括实际模型、合成提示词及 NovelAI 已确定的随机种子；不修改初始输入哈希或 ComfyUI 核对快照。图片二进制、URL、密钥字段与鉴权头不会记录；图片顺序见输入引用。尚未进入适配器发送阶段的失败只有准备输入，没有伪造的最终请求体。最终参数记录仍不证明上游受理。
