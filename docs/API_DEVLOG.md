# 开放 API 全量化 · 开发日志

> 这份日志用来防止上下文丢失。每完成一个小项，就更新本文件并推送。
> 基线是 `main @ 1f8202a`。当时的测试结果：`node js/build.js dev` OK，`node js/tests.js` 91/91，`python3 -m unittest discover -s tests` 617 OK（skipped 4）。
> 目标：项目的功能基本都能通过公开 API（`/api/v1/`）使用。项目处在早期开发阶段，**不要求向后兼容**，可以大改。

## 沙盒规则（用户要求）

- 每完成一个小项，立即执行 `git add` → `commit` → `push origin main`，不要攒着不提交。
- 只跑 `node js/build.js dev`、`node js/tests.js` 和 `python3 -m unittest`。不安装浏览器，也不跑 Playwright（`.mjs` e2e）。
- 工作区里不保留 PNG 截图。临时目录用完立即 `rm -rf`。
- 容器重启后先看 `git log -1`，从最后推送的地方继续。
- 推送用的是临时 PAT，只存在 remote URL 里。它**绝不能写进任何文件或日志**。仓库是公开的。

## 审查结论：现状

### 三套 HTTP 接口

| 前缀 | 调用者 | 鉴权 | 说明 |
|---|---|---|---|
| `/api/*` | 浏览器界面（私有） | 同源 + `X-Mio-CSRF`（`mio_http.authorize_private`） | 功能最全：配置增量保存、文件库、回收站、密钥、渠道测试、LLM 代理、视觉审图、市场、更新、生态 |
| `/api/foundation/*` | 浏览器 + v1 共用 | 同上 | 生成任务（jobs）、页面编辑、素材上传/清理、画册删除、分镜/计划的修订号 upsert |
| `/api/v1/*` | 外部程序（公开） | `Authorization: Bearer $MIO_API_TOKEN`（≥32 字符） | 只覆盖一小部分功能：只读目录、单次出图、生成任务、生产队列转发 |

### v1 现有路由（1.0.1，37 个 path）

- `mio_api.py`：
  - `health`、`capabilities`、`openapi.json`
  - `providers`（实际上是已保存的渠道列表）
  - `storyboards`、`albums`
  - `assets?path=`（dataUrl）
  - `images/generations`（同步单张，只支持 novelai/openai）
- `mio_api_ext.py`：
  - `catalog`
  - `resources/{workflows,characters,scenes,presets,layouts,channels,collections}`，均为只读
  - `albums/{id}`、`albums/export`
  - `production/*`（原样转发给 `production.api.dispatch`，错误没有统一信封）
- `mio_foundation.py`（公开的部分）：
  - `albums/page`、`albums/page-edits`、`albums/delete`
  - `jobs`、`jobs/events`、`jobs/activity`、`jobs/reorder`、`jobs/{id}`
  - `assets/upload`、`assets/catalog`、`assets/cleanup`
  - `resources/storyboards`、`resources/plans`（expectedRevision upsert）
- OpenAPI 是 `mio_api.openapi()` 手写的字典，外加 `mio_contracts.extend()`。`docs/api/openapi.json` 必须和运行时输出一致（`tests/test_external_api.py::test_openapi_file_matches_runtime`）。
- 只支持 GET 和 POST，其他方法一律返回 405。

### 缺口：只有私有接口有、v1 没有的功能

1. **文件库写入**：v1 不能增删改工作流、角色和场景预设、画册集、版式、LLM 会话、角色行；分镜和计划只有 upsert，没有删除；画册不能创建或修改。
2. **单项读取、导出、导入、检查、重建索引**：对应私有路由 `/api/library/entity|export|import|inspect|export-document|rescan|problems`。
3. **设置**：`comfy`、`llm`、`xml`、`workspace` 四份设置文档无法读写。密钥的"忘记"只能走 `/api/library/forget-key`。
4. **图像渠道**：渠道 CRUD、切换当前渠道、测试连接、拉取模型列表、密钥池（`/api/image/credentials`）都没有。`/api/image/check|models|generate` 同样缺失。
5. **LLM 与视觉**：`/api/chat`（LLM/XML/critic 三个作用域）、`/api/vision/audit`。
6. **回收站与维护**：recycle 的 list/restore/purge/empty/auto-clean；maintenance 的 assets/gc/restore/purge-trash。
7. **素材**：store-image、save-image（抓取远程图片）、inline-image；原始字节流读取（v1 只能拿 dataUrl）。
8. **市场**：`/api/marketplace/index`、`/api/fetch-remote`。
9. **更新中心**：status/check/apply/rollback/restart。
10. **生态**：`/api/ecosystem/*`（扩展、主题、样式、脚本、预处理、活动、导出器和导入器）和 `/api/extensions/<id>/*`，全部没有。
11. **生产队列**：assemble-batch、start-sequence、recover-publication、clone、reorder、clear-finished、concurrency、live-sync、rename、update-frame、analyze-slots、apply-slots、`tasks/{id}/clone-source`、`tasks/{id}/frames/{n}` 这些路由能转发，但没有文档，错误格式也不统一。

## 设计决策

- **新包 `backend/api_v1/`**：用声明式路由表登记每个路由的 method、path 模板、摘要、标签、请求和响应 schema、handler，OpenAPI 由路由表**自动生成**，文档和实现不会再漂移。`backend/mio_api.py` 只保留门面（`VERSION`、`GENERATION_SLOT`、`generation_payload`、`openapi()`、`handle()`），`mio_api_ext.py` 和 `mio_contracts.py` 并入新包后删除。
- **统一信封**：
  - 成功时返回 `{"data": …, "requestId": "…"}`。
  - 失败时返回 `{"error": {"code", "message", "details"?}, "requestId"}`。
  - 每个响应都带 `X-Request-Id`。
  - 文件和流式响应（ZIP、图片、SSE）不套信封。
- **错误映射**：

  | 异常 | HTTP 状态 | 错误码 |
  |---|---|---|
  | `ApiError` | 原样 | 原样 |
  | `LibraryError` | `status` | `code`（默认按状态推导） |
  | `ProviderHTTPError` | 上游状态 | `upstream_error`（信息脱敏） |
  | `ServiceUnreachable` | 502 | — |
  | `PayloadTooLargeError` | 413 | — |
  | `UpdateError` | `status` | — |
  | `ValueError`、`TypeError` | 400 | `invalid_request` |
  | 其他异常 | 500 | `internal_error`（不回显内容） |

- **方法**：v1 支持 GET、POST、PUT、PATCH、DELETE。PATCH 采用 JSON Merge Patch（RFC 7396）。
- **并发控制**：写操作可带 `If-Match: "<etag>"` 头或 `expectedEtag` 查询参数，不一致时返回 `409 revision_conflict`。读操作返回 `ETag`。
- **文件库写入全部走 `NativeStore.apply`**：和浏览器保存同一条路径，会自动本地化 `/images/` 和 data URL 素材、校验、写回收站回执、更新目录修订号。
- **密钥永不回显**：设置读取会去掉 `_secretRefs`，只返回"哪些指针已保存密钥"。渠道密钥只返回元数据（id、label、状态）。
- **信任模型**：v1 令牌 = 完全信任的管理令牌，可以读取非机密配置（包括服务地址）。接口不返回任何密钥明文。更新、重启、回滚、永久删除这些操作要求 body 里带 `confirm: true`。
- **`/providers` 语义变更（破坏性）**：
  - 改为返回**图像服务类型注册表**，即 `backend/providers/registry.py`。
  - 已保存的渠道改到 `/channels`。
  - `images/generations` 的 `providerId` 字段改名为 `channelId`（保留 `providerId` 作为别名以便过渡）。
- `resources/*` 只读视图和 `catalog` 保留，给机器人做轻量浏览用。`resources/storyboards|plans` 的 upsert 保留，因为 `tests/foundation.mjs` 在用它；OpenAPI 里标注为 deprecated，推荐改用 `/library`。

## 审查中发现的潜在问题

1. `backend/ecosystem/api.py` 的 `host_call` 里，`library.put` 和 `library.delete` 调的是 NativeStore 的 `put`/`delete`，但**这两个方法不存在**，只有 FileLibrary 有，所以会抛 AttributeError。另外 `library.put` 读取 `stored["id"]`，而 FileLibrary.put 返回的是 `{document,etag,file}`，也会出错。结果是扩展 SDK 的 `host.library.put/delete` 实际上不可用。计划在 A2 里修复：改成走 `NativeStore.apply`。
2. `mio_native_store.prepare_execution` 读取的是 `settings.imageProviders.profiles`，但当前键名是 `imageGeneration`。这是遗留问题，优先级低，先记录。
3. 私有路由 `/api/production/*` 的错误没有统一格式：有的是 `{"error": 文本}`，有的带 `code`。v1 统一后，私有接口继续沿用原格式。

## 任务计划

- [x] A0 审查、计划，写本日志
- [ ] A1 框架：`backend/api_v1`（路由表、上下文、信封和错误、OpenAPI 生成、PUT/PATCH/DELETE、ETag/If-Match、X-Request-Id、CORS），迁移全部现有 v1 路由，删除 `mio_api_ext.py` 和 `mio_contracts.py`
- [ ] A2 文件库通用 CRUD：
  - 路由：`/library`、`/library/{kind}`、`/library/{kind}/{id}`
  - 附加操作：duplicate、bundle 导出、import/inspect、order、problems、rescan
  - 修复 `host.library.put/delete`
- [ ] A3 细粒度子资源：分镜 frames、预设 entries、画册 steps
- [ ] A4 设置：`/settings`、`/settings/{name}`（GET/PUT/PATCH），`/settings/{name}/secrets`
- [ ] A5 渠道与密钥：
  - `/providers` 改为类型注册表
  - `/channels` CRUD，以及 activate、check、models、keys
  - `/comfy/check`、`/comfy/object-info`
- [ ] A6 LLM 与视觉：`/llm/chat`、`/vision/audit`，连接信息在服务端从已保存的设置读取
- [ ] A7 回收站与维护：`/recycle*`、`/maintenance/*`
- [ ] A8 画册：
  - PATCH 和 DELETE `/albums/{id}`，以及 steps
  - `/albums/import`（HTML 或导入器）
  - `/albums/{id}/export`（导出器）
- [ ] A9 生产队列：所有路由都登记进路由表，统一信封，写文档，并提供 REST 风格的 `tasks/{id}/{action}`
- [ ] A10 生态桥接：`/ecosystem/*`、`/extensions/{id}/*`
- [ ] A11 更新中心：`/update/*`
- [ ] A12 市场、素材（raw、fetch、二进制上传）、工作流（analyze、apply、activate）、`/workspace`（状态、快照、rescan）
- [ ] A13 文档：
  - `docs/api/README.md` 重写，`openapi.json` 重新生成
  - 更新 `examples/mio_client.py`、`docs/astrbot-api.md`、CHANGELOG
- [ ] A14 全量测试，给用户汇报

## 进度记录

（每完成一项追加一行，格式：日期 · 任务 · 内容）

- 2026-09-25 · A0 · 审查三套接口和存储层（NativeStore、FileLibrary、FileSettings、credentials、providers registry、production、ecosystem、update），写出缺口表、设计决策和计划。
