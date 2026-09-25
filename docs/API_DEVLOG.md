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
3. （A8 审查中发现）`Ecosystem.import_document` 同样调用了不存在的 `NativeStore.put`，并且导入器返回的图片名是裸名（`<sha>.png`），而画册校验要求 `images/...`，所以 `/api/ecosystem/import`（pages-zip 导入）原本不可用。已修复：先把资源内联为 data URL，再调用 `put_document`，总是分配新 ID，projectId 取 options 中的值或当前画册集。
4. 私有路由 `/api/production/*` 的错误没有统一格式：有的是 `{"error": 文本}`，有的带 `code`。v1 统一后，私有接口继续沿用原格式。

## 任务计划

- [x] A0 审查、计划，写本日志
- [x] A1 框架：`backend/api_v1`（路由表、上下文、信封和错误、OpenAPI 生成、PUT/PATCH/DELETE、ETag/If-Match、X-Request-Id、CORS），迁移全部现有 v1 路由，删除 `mio_api_ext.py` 和 `mio_contracts.py`
- [x] A2 文件库通用 CRUD：
  - 路由：`/library`、`/library/{kind}`、`/library/{kind}/{id}`
  - 附加操作：duplicate、bundle 导出、import/inspect、order、problems、rescan
  - 修复 `host.library.put/delete`
- [x] A3 细粒度子资源：分镜 frames、预设 entries、画册 steps
- [x] A4 设置：`/settings`、`/settings/{name}`（GET/PUT/PATCH），`/settings/{name}/secrets`
- [x] A5 渠道与密钥：
  - `/providers` 改为类型注册表
  - `/channels` CRUD，以及 activate、check、models、keys
  - `/comfy/check`、`/comfy/object-info`
- [x] A6 LLM 与视觉：`/llm/chat`、`/vision/audit`，连接信息在服务端从已保存的设置读取
- [x] A7 回收站与维护：`/recycle*`、`/maintenance/*`
- [x] A8 画册：
  - PATCH 和 DELETE `/albums/{id}`，以及 steps
  - `/albums/import`（HTML 或导入器）
  - `/albums/{id}/export`（导出器）
- [x] A9 生产队列：所有路由都登记进路由表，统一信封，写文档，并提供 REST 风格的 `tasks/{id}/{action}`
- [x] A10 生态桥接：`/ecosystem/*`、`/extensions/{id}/*`
- [x] A11 更新中心：`/update/*`
- [x] A12 市场、素材（raw、fetch、二进制上传）、工作流（analyze、apply、activate）、`/workspace`（状态、快照、rescan）
- [ ] A13 文档：
  - `docs/api/README.md` 重写，`openapi.json` 重新生成
  - 更新 `examples/mio_client.py`、`docs/astrbot-api.md`、CHANGELOG
- [ ] A14 全量测试，给用户汇报

## 进度记录

（每完成一项追加一行，格式：日期 · 任务 · 内容）

- 2026-09-25 · A0 · 审查三套接口和存储层（NativeStore、FileLibrary、FileSettings、credentials、providers registry、production、ecosystem、update），写出缺口表、设计决策和计划。
- 2026-09-25 · A1 · 框架落地，旧路由全部迁移：
  - 新包 `backend/api_v1/`：
    - `core.py`：Router、Route、Context、ApiError/Reply/Raw/SENT、错误映射、鉴权、信封、`merge_patch`。
    - `spec.py`：OpenAPI 生成与共享 schema。
    - `common.py`：工作区设置读写、渠道、排序、锁顺序。
    - 路由模块 `system`、`catalog`、`albums`、`assets`、`generation`、`jobs`、`production`。
  - `mio_api.py` 改为门面。`mio_api_ext.py` 和 `mio_contracts.py` 已删除。
  - `mio_http.external_api` 改为传入 HTTPServices（`ctx.services`），`ctx.host` 为 application。CORS 放开 PUT/PATCH/DELETE、If-Match，并暴露 ETag/X-Request-Id。
  - `mio_foundation.dispatch` 拆出可复用函数：`annotate_jobs`、`mutate_page`、`page_edits`、`delete_albums`、`submit_job`、`control_job`、`event_stream`、`upload_asset`、`asset_catalog`。
  - `production/api.py` 的 dispatch 改为 `ACTIONS` 表加 `run_action`、`list_tasks`、`read_task`，私有和公开接口共用。`snapshot` 缺 `storyId` 或预设引用格式不对时，返回可读的 400（原先是 KeyError）。
  - 路由匹配规则：字面段优先（specificity），同一路径方法不符时返回 405 和 Allow。集合级动作一律用 POST（如 `POST /library/{kind}/reorder`），避免和 `{id}` 冲突。
  - `/images/generations` 的字段改为 `channelId`（`providerId` 仍可用作别名），渠道从工作区设置文档读取。
  - 文档工具 `tools/build_api_docs.py` 生成 `docs/api/openapi.json` 和 `docs/api/ROUTES.md`，测试校验两者与运行时一致。
  - 测试夹具 `tests/api_support.py`：临时 DATA_DIR 加真实 HTTP 服务，teardown 时关闭 ecosystem、foundation 和 native store。
  - `test_external_api` 改为使用真实临时工作区。新增 `test_api_v1_core`（9 个）。全量 Python：619 OK。
  - 注意：生产任务 ID 必须形如 `assembly-*`，否则返回 400 Invalid production identity；空工作区没有导出版式，HTML 导出会返回 404。
- 2026-09-25 · A2 · 文件库通用 CRUD，模块 `backend/api_v1/library.py`：
  - 路由：
    - `GET /library`：概览。
    - `GET|POST /library/{kind}`：列表（limit、offset、q、projectId、status、sort、full）和新建。
    - `GET|PUT|PATCH|DELETE /library/{kind}/{id}`。
    - `POST /library/{kind}/{id}/duplicate`、`GET /library/{kind}/{id}/bundle`、`POST /library/{kind}/reorder`。
    - `POST /library/inspect|import`（二进制 application/zip，或 JSON 的 zip/document/html）、`POST /library/export`、`GET /library/problems`、`POST /library/rescan`。
  - 共享函数：`put_document`、`remove_document`、`normalize`、`save`。
  - 规则：
    - 写操作走 `NativeStore.apply`。
    - 画册写入前先套 `mio_pictures.project`，已有墓碑的画册 ID 返回 409 album_deleted。
    - 删除画册走 `mio_foundation.delete_albums`，同时删除相关任务，并写入回收站。
    - 删除非空画册集返回 409 collection_not_empty（`details` 给出各类成员数），传 `cascade=true` 时一起删除成员。
  - 补全：
    - 缺省 projectId 用当前画册集。
    - 分幕补 id、名称（第 N 幕）和空文本字段。
    - 预设写入 category，条目补 id 和 type。
    - 画册补 album_defaults 和 generatedSteps，新建时根据图片数推断 status。
    - 每次写入更新 updatedAt（PATCH 显式带 updatedAt 时除外）。
  - 排序：界面顺序取 `workspace.ordering[field]`；预设两类共用 `variableSets`，reorder 时同时更新。
  - **修复潜在问题 1**：扩展 `host.library.put/delete` 改为调用 `put_document` 和 `remove_document`（原先会抛 AttributeError）。
  - 注意：
    - 缺 title 时 `_resource` 会用 id 兜底，这是原有行为。
    - PATCH 会补回默认字段（如 storyboard.outline）。
  - 测试 `tests/test_api_library.py` 10 个，全量 638 OK。测试夹具改用静默 handler，不再输出请求日志。
- 2026-09-25 · A3 · 细粒度子资源，模块 `backend/api_v1/parts.py`：
  - 所有操作都对父文档读-改-写，用父文档的 ETag 做 CAS；If-Match 或 `?expectedEtag` 与父文档不一致时返回 409。
  - 分幕：
    - `GET|POST /library/storyboards/{id}/frames`：新增接受单个对象、`frames` 数组，或 `count` + `namePattern` + `basePrompt` 批量生成；可用 `?index=` 指定插入位置。
    - `GET|PATCH|DELETE .../frames/{frame}`：`{frame}` 可以是 frame id，也可以是序号。
    - `POST .../frames/reorder`。
  - 预设变量：`GET /library/{characters|scenes}/{id}/entries`；`PUT|DELETE .../entries/{key}`，按变量名 upsert。
  - 画册：
    - `POST /albums`，别名，等同 POST /library/albums。
    - `PATCH /albums/{albumId}`：合并补丁。
    - `DELETE /albums/{albumId}`。
    - `GET|PATCH|DELETE /albums/{albumId}/steps/{index}`：PATCH 在页不存在时创建，并自动提升 totalSteps；图片可以是 data URL。
  - 注意：`merge_patch` 返回新对象，原地修改时要先 clear 再 update，否则 null 删除不生效。
  - 测试 `tests/test_api_parts.py` 4 个。
- 2026-09-25 · A4 · 设置，模块 `backend/api_v1/settings.py`：
  - 路由：
    - `GET /settings`。
    - `GET|PUT|PATCH /settings/{workspace|comfy|llm|xml}`：`?view=true` 返回 comfy 展开后的视图。
    - `GET|PUT|DELETE /settings/{name}/secrets`：`slots` 列出可以存放密钥的指针，`stored` 列出已保存的指针。
  - 读取时去掉 `_secretRefs`，只返回已保存密钥的 JSON 指针，不返回任何值。
  - 写入时让 apply 从磁盘重新挂回原有的 refs：字段留空则保持原密钥；换了端点又没给新密钥，返回 409 credential_binding_changed（原有语义）。
  - PUT secrets 在替换密钥时会用 clearSecrets 从密钥库删除旧值，避免被替换的密钥一直残留。
  - 私有接口 `forget-key` 的对应用法：`DELETE /settings/llm/secrets?pointer=/key`；critic 的指针是 `/ui/comfyStudio/settings/critic/key`。
  - 测试 `tests/test_api_settings.py` 4 个。注意：同一个测试类共用一个工作区，断言不要依赖测试执行顺序。
- 2026-09-25 · A5 · 渠道与密钥，模块 `backend/api_v1/channels.py`：
  - 路由：
    - `GET /providers`、`GET /providers/{id}`：图像服务类型注册表（破坏性变更）。
    - `GET|POST /channels`、`GET|PATCH|DELETE /channels/{id}`。
    - `POST /channels/{id}/activate`、`POST /channels/{id}/check`、`GET /channels/{id}/models`。
    - `GET|POST /channels/{id}/keys`、`DELETE /channels/{id}/keys/{keyId}`。
    - `POST /comfy/check`、`GET /comfy/object-info`。
  - 新建渠道：
    - 新 ID 为 `provider_<hex>`（与界面的 `uid('provider')` 风格一致）。
    - 用 provider spec 的 defaults 补全字段；按 spec 字段类型校验（toggle 须为 bool，select 须在选项内）。
    - 不允许直接写 keyId/keyIds，Key 走 `/keys` 或请求体里的 `apiKey`/`apiKeys`。
  - Key 规则：
    - 存储在 `mio_credentials`，按 `{profileId, provider, baseUrl}` 作用域绑定；公网地址必须用 HTTPS，否则拒绝保存 Key。
    - 更换 baseUrl 或 provider 而没有给新 Key 时，清掉 keyIds、改为 keyMode none，并返回 `keysReset: true`（与界面行为一致，Key 不会被发往新地址）。
    - 删除最后一个 Key 时，keyMode 改为 none。
  - 内置 ComfyUI 渠道：不可删除、不可新建、不可改 provider（409 builtin_channel）。PATCH 它的 baseUrl 实际写入 comfy 设置。
  - 删除渠道时 purge 该渠道的全部 Key。没有检查在途任务：持久任务按引用解析渠道，渠道缺失时直接失败，不会回退到快照。
  - check：provider 有 check 能力就用 check，否则用 models 数量代替；两者都没有时返回 400。上游异常返回 502 upstream_error。
  - 测试 `tests/test_api_channels.py` 5 个。
- 2026-09-25 · A6 · LLM 与视觉，模块 `backend/api_v1/llm.py`：
  - 路由：
    - `POST /llm/chat`：scope 为 llm、xml 或 critic；messages；可选 model；白名单透传 temperature、max_tokens、tools、response_format 等；返回 content、message、usage 和 raw。
    - `POST /vision/audit`：image 为 /images/ 或 data URL，可选 promptText 和 model。
    - `POST /albums/{albumId}/steps/{index}/critique`：审图后把 `critique` 写回该页（默认 save:true）。
  - 连接选择与界面一致：xml 未开启 `separate` 时用 llm 连接；critic 的 `connection: shared` 时用 llm 连接。Key 在服务端从密钥库解析，客户端无法传入，也看不到。
  - 上游 HTTPError 返回 502 upstream_error，`details.upstreamStatus` 给出上游状态码；不回显上游响应体，报错信息里的 Key 会被脱敏。
  - 测试 `tests/test_api_llm.py` 3 个：用 127.0.0.1 上的假模型服务器（http 只允许私有地址，正好覆盖），验证 Authorization 是服务端解析出的 Key。
- 2026-09-25 · A7 · 回收站与维护，模块 `backend/api_v1/recycle.py`：
  - 路由：
    - `GET /recycle?all=`。
    - `POST /recycle/restore|purge|empty|auto-clean`。
    - `GET /maintenance/assets`、`POST /maintenance/assets/gc|restore`、`POST /maintenance/trash/purge`。
  - 永久删除（purge、empty、trash/purge）要求 `confirm: true`，兼容私有接口的 `trusted: true`；否则返回 403 confirmation_required。
  - 新增 `mio_recycle.restore_target(host, body)`，私有和公开接口共用；私有 `/api/library/recycle/restore` 已改为调用它。
  - 测试 `tests/test_api_recycle.py` 3 个，覆盖分镜删除→恢复→永久删除，以及画册恢复后墓碑被清除。
- 2026-09-25 · A8 · 画册导入导出：
  - 路由：
    - `GET /exporters`、`GET /importers`：放在顶层，避免和 `/albums/{albumId}` 冲突。
    - `POST /albums/{albumId}/export`：用导出器导出，默认 pages-zip，返回原始文件。
    - `POST /albums/import`：用导入器导入，支持二进制上传加 `?importer&projectId&filename`，或 JSON 的 `{importer, payload, options}`。
    - HTML 画册导入走 `/library/import` 的 html 字段，多本画册的 HTML/ZIP/PDF 导出仍走 `POST /albums/export`。
  - **修复潜在问题 3**：ecosystem 的 `import_document`。
  - 测试：`test_api_parts.AlbumTransferTests` 覆盖 pages-zip 导出后再导入的往返，图片成为新画册自己的资源。
- 2026-09-25 · A9 · 生产队列收尾：
  - A1 中已登记全部 19 个动作的文档化请求体，以及 REST 风格别名：
    - `POST /production/tasks`：装配。
    - `DELETE /production/tasks/{id}`：支持 `?deleteAlbums`。
    - `POST /production/tasks/{id}/{start|pause|resume|cancel|clone|rename}`。
    - `PATCH /production/tasks/{id}/frames/{index}`：update-frame。
  - 本次补充：API 调用装配时可以省略 `requestId`，服务端自动生成 `api-<uuid>`；带上它则重试是幂等的（队列要求必须有，界面总是会传）。assemble-batch 的每一项同样处理。
  - 测试 `test_api_v1_core.ProductionFlowTests`：用云渠道装配，不启动生成；覆盖详情、逐幕来源、重命名、改台词、clone-source、克隆、暂停、列表、删除和批量删除。任务 ID 形如 `assembly-*`。
- 2026-09-25 · A10 · 生态桥接，模块 `backend/api_v1/ecosystem.py`：
  - 桥接到 `ecosystem_api._ecosystem_route` 和 `_extension_route`，与界面走同一套实现。
  - 登记 40 个带文档的生态路由（status、platform、activity、watch、themes/*、styles/*、scripts/*、preparations/*、extensions/install|enable|update|uninstall|purge|link|reload|deps、events/emit、cache/clear、reset），另有：
    - `GET /ecosystem/scripts/{id}`、`GET /ecosystem/preparations/{id}`、`GET /ecosystem/themes/css/{id}`。
    - 扩展文件：`GET|PUT|POST|DELETE /ecosystem/extensions/{id}/files/{path}`。
    - 通用兜底 `GET|POST|PUT|DELETE /ecosystem/{route:path}`：贪婪路由优先级最低。
  - 扩展后端：`GET /extensions`；`GET|POST|PUT|PATCH|DELETE /extensions/{id}/{tail:path}`，覆盖自定义路由、storage、settings、capabilities、tasks。扩展的原始响应（`raw_response` 和 `__mio_response__`）会转成 Raw，不套信封。
  - 请求体缺少字段（KeyError）时返回 400 missing_field。安装或启用代码仍要求 `trusted: true`，安全模式下由底层拒绝。
  - 测试 `tests/test_api_ecosystem.py` 3 个：用 zip 安装示例扩展 scene-notebook，调用它的 Python 路由 `/notes`、storage 和扩展文件读写，再停用、卸载。
- 2026-09-25 · A11 · 更新中心，模块 `backend/api_v1/update.py`：
  - 路由：`GET /update/status`；`POST /update/check|apply|rollback|restart`。
  - apply、rollback、restart 要求 `confirm: true`（403 confirmation_required）；apply 返回 202。UpdateError 按自身 status 映射。
  - 测试 `tests/test_api_update.py` 2 个。网络和重启一律打补丁：**测试里绝对不能真的调用 request_restart**。
  - 测试夹具在 teardown 时同时清理 `mio_update._services` 中临时工作区对应的条目。
- 2026-09-25 · A12 · 工作区、工作流、素材、市场：
  - `backend/api_v1/workspace.py`：
    - `GET /workspace`：状态、计数、当前画册集/渠道/工作流、问题数。
    - `GET /workspace/snapshot`：`read_merged_config` 的完整快照，递归去掉 `_secretRefs`，结构不承诺稳定。
    - `GET /workspace/content`：随程序附带的内容。
    - `PUT /workspace/active-collection`。
    - `POST /library/workflows/{id}/activate`：写入 comfy.activeWorkflowId。
    - `POST /library/workflows/{id}/analyze`：槽位分析。
  - `backend/api_v1/assets.py` 新增：
    - `GET /assets/raw`：原始字节；`thumb=宽x高` 时生成 WebP 缩略图；`download=true` 以附件下载。
    - `POST /assets/upload` 支持二进制图片（image/png、jpeg、webp、svg+xml、octet-stream），`?name=`。
    - `POST /assets/fetch`：抓取远程图片，并记录来源 `{kind: remote, url}`。
    - 注意：`image_type` 不接受 GIF，所以不宣称支持 GIF。
  - `backend/api_v1/marketplace.py`：
    - `GET /marketplace`、`POST /marketplace/fetch`。
    - `POST /marketplace/install`：可按目录 id、远程 url 或内联 data 安装；市场格式 steps 与分镜格式 frames 都能转成分镜，归入 projectId 或当前画册集。
  - 测试 `tests/test_api_workspace.py` 4 个。全量 Python 见下一行。

