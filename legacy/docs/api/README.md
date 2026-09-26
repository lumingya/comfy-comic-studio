# Mio 开放 API（v1 路径 · 契约 2.0）

[教程中心](../README.md) · [English](../en/API.md) · [路由总表](ROUTES.md) · [OpenAPI 3.1](openapi.json) · [Python 客户端](../../examples/mio_client.py)

## 1. 概览

`/api/v1` 是 Mio 的公开自动化接口。界面能做的事基本都能通过它完成：

- 管理文件库：分镜、预设、画册、画册集、计划、版式、工作流、会话。
- 配置图像渠道与密钥，修改设置。
- 装配并运行生产任务，调用 LLM 和视觉审图。
- 导入导出、回收站、素材维护、扩展与主题、更新。

一共约 210 个操作，全部由同一张路由表生成：

- [路由总表](ROUTES.md)：给人看的完整清单。
- [openapi.json](openapi.json)：给代码生成器和调试工具用。
- 运行中的服务也会提供 `GET /api/v1/openapi.json` 和 `GET /api/v1/routes`，内容与文件一致（测试会校验）。

| 功能区 | 主要路由 | 能做什么 |
|---|---|---|
| 工作区 | `/workspace`、`/workspace/snapshot`、`/workspace/active-collection` | 状态、完整快照、切换当前画册集 |
| 文件库 | `/library/{kind}`、`/library/{kind}/{id}` | 11 类资源的增删改查（`tasks` 只读）、复制、排序、导入导出 |
| 分镜 / 预设 | `/library/storyboards/{id}/frames`、`/library/{characters\|scenes}/{id}/entries` | 逐幕、逐变量修改 |
| 画册 | `/albums`、`/albums/{id}`、`/albums/{id}/steps/{n}` | 详情、改标题标签、逐页改台词和图片、导出 HTML/ZIP/PDF、导入 |
| 设置 | `/settings/{workspace\|comfy\|llm\|xml}` | 读写设置；密钥只写不读 |
| 渠道 | `/providers`、`/channels`、`/channels/{id}/keys` | 图像服务类型、渠道增删改、设为当前、测试连接、模型列表、Key 池 |
| 生成 | `/images/generations`、`/jobs`、`/production/*` | 同步单张、持久任务、分镜装配成画册 |
| 工作流 | `/comfy/check`、`/comfy/object-info`、`/library/workflows/{id}/activate` | ComfyUI 连接、节点信息、槽位分析、设为当前 |
| LLM | `/llm/chat`、`/vision/audit`、`/albums/{id}/steps/{n}/critique` | 用已保存的连接对话、审图并写回画册 |
| 素材 | `/assets`、`/assets/raw`、`/assets/upload`、`/assets/fetch`、`/maintenance/*` | 读图、缩略图、上传、抓取远程图、清理未引用素材 |
| 回收站 | `/recycle` | 列出、恢复、永久删除、自动清理 |
| 市场 | `/marketplace` | 目录、抓取远程分镜、安装到文件库 |
| 生态 | `/ecosystem/*`、`/extensions/{id}/*` | 扩展、主题、样式工坊、用户脚本、预处理、扩展自己的后端路由 |
| 更新 | `/update/*` | 检查、应用、回滚、重启 |
| 精简目录 | `/catalog`、`/resources/*`、`/storyboards`、`/albums` | 给聊天机器人的小而稳定的只读视图 |

## 2. 启用与鉴权

先生成一个随机令牌：

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

然后在**启动服务的那个进程**里设置它：

```bash
export MIO_API_TOKEN="至少 32 个字符的令牌"      # Windows PowerShell: $env:MIO_API_TOKEN = "..."
python server.py
```

每个请求（包括 health 和 OpenAPI）都要带：

```http
Authorization: Bearer YOUR_MIO_TOKEN
```

- 令牌缺失或短于 32 字符：返回 `503 api_disabled`。
- 令牌错误：返回 `401 unauthorized`。
- 浏览器带着不在允许列表里的 `Origin`：返回 `403 origin_denied`。可信来源用 `MIO_ORIGINS` 配置。

**这个令牌等同于管理员权限。**持有它可以读写全部创作内容、修改设置、安装扩展、触发付费生成。它不支持多用户隔离，也不要写进 URL。

## 3. 通用约定

### 响应信封

成功：

```json
{"data": {"status": "ok", "name": "Mio", "version": "2.0.0"}, "requestId": "req_…"}
```

失败：

```json
{"error": {"code": "revision_conflict", "message": "文件已被其他编辑者修改：story_x", "details": null}, "requestId": "req_…"}
```

- 每个响应头都带 `X-Request-Id`，便于和服务端日志对照。
- 文件、图片、SSE 和 `openapi.json` 直接返回原始内容，不套信封。

### 常见错误码

| HTTP | code | 含义 |
|---|---|---|
| 400 | `invalid_request` / `invalid_field` / `invalid_json` / `invalid_id` / `unknown_field` / `missing_field` | 请求不合法（`message` 说明原因） |
| 400 | `invalid_resource` | 内容校验未通过，例如分镜为空、试绘缺少描述（`message` 是可以直接展示给用户的中文说明） |
| 400 | `collection_required` / `unknown_collection` | 还没有任何画册集；`projectId` 指向的画册集不存在 |
| 401 | `unauthorized` | Mio 令牌错误 |
| 403 | `origin_denied` / `confirmation_required` / `forbidden` | 来源不允许；危险操作缺少 `confirm: true`；开始生成时缺少 `trusted: true`，或处于安全模式 |
| 404 | `not_found` / `unknown_kind` / `channel_not_found` / `job_not_found` … | 资源不存在 |
| 405 | `method_not_allowed` / `read_only_kind` | 方法不支持（响应头 `Allow` 列出可用方法）；`tasks` 为只读 |
| 409 | `revision_conflict` / `conflict` / `already_exists` / `collection_not_empty` / `credential_binding_changed` / `builtin_channel` / `album_deleted` / `llm_not_configured` | 并发冲突或状态不允许（如 LLM 尚未配置） |
| 413 | `payload_too_large` | 请求体过大 |
| 415 | `unsupported_media_type` | Content-Type 不对，或上传的不是支持的图片 |
| 429 | `generation_busy` | 同步生成槽被占用 |
| 502 | `upstream_error` / `upstream_unreachable` / `upstream_failure` | 图像服务、模型服务、ComfyUI 或更新源出错（`details.upstreamStatus` 可能给出上游状态） |
| 503 | `api_disabled` | 没有配置 `MIO_API_TOKEN` |
| 504 | `upstream_timeout` | 上游操作超时 |

### 请求体

- JSON 请求使用 `Content-Type: application/json`（PATCH 也接受 `application/merge-patch+json`），请求体必须是对象。
- 不需要参数的动作（如 `POST /channels/{id}/activate`）可以不带请求体。
- 部分上传接口可以直接发送文件字节，不必转 base64：
  - `POST /assets/upload`：`image/png` 等图片类型，可加 `?name=`。
  - `POST /library/import` 和 `POST /library/inspect`：`application/zip`，可加 `?kind=&projectId=`。
  - `POST /albums/import`：`application/zip`，可加 `?importer=&projectId=&filename=`。

### 分页与筛选

列表返回 `{items, total, limit, offset}`。`GET /library/{kind}` 支持以下参数：

| 参数 | 说明 |
|---|---|
| `limit` | 1–200，默认 50 |
| `offset` | 默认 0 |
| `q` | 按标题、ID、简介搜索 |
| `projectId` | 只看某个画册集 |
| `status` | 画册状态 |
| `sort` | `order`（界面顺序，默认）、`id`、`title`、`updated`、`created` |
| `full` | 为 true 时附带完整文档，此时 limit 最大 50 |

### 并发控制（ETag）

- 读取单个资源时，响应头带 `ETag`，响应体里也有 `etag`。
- 写入时带上 `If-Match: "<etag>"`，或者 `?expectedEtag=<etag>`。如果期间有人（包括浏览器界面）改过它，返回 `409 revision_conflict`，不会覆盖。
- 不带 `If-Match` 时是“最后写入者生效”，但单次读-改-写本身仍是原子的。
- 细粒度接口（分幕、变量、画册页）用的是**父文档**的 ETag。

### 合并补丁

所有 PATCH 都按 RFC 7396 处理：

- 对象递归合并。
- 值为 `null` 表示删除该字段。
- 数组整体替换。

### 危险操作

以下操作要求请求体带 `"confirm": true`，否则返回 `403 confirmation_required`：

- 永久删除回收站内容，以及清理素材垃圾桶。
- 应用更新、回滚、重启。

安装或启用扩展、主题的代码仍然需要 `"trusted": true`，与界面上的确认对话框一致。

### 密钥只写不读

- 设置文档里的 `key`、`apiKey`、`token`、`password` 等字段，写入时会被移进本地密钥库，读取时永远是空字符串。响应里的 `secrets` 列出哪些位置已经保存了密钥。
- 渠道的 Key 池只返回 ID、标签和创建时间。
- 任何接口都不会返回密钥明文。

### 与浏览器界面同时使用

API 和界面共用同一套存储与事务：

- API 写入的内容，界面刷新（或“重新读取”）后就能看到。
- 如果界面里还开着同一份内容的旧草稿，界面保存时会提示版本冲突，不会覆盖 API 的修改。
- 写入会广播扩展事件 `library.saved` / `library.deleted`（source 为 `api`），扩展可以据此刷新。

## 4. 快速上手

```bash
export MIO=http://127.0.0.1:8777/api/v1
export AUTH="Authorization: Bearer $MIO_API_TOKEN"

# 1. 服务状态与当前选择
curl -s -H "$AUTH" $MIO/workspace

# 2. 新建画册集并设为当前（空工作区必须先有画册集，否则新建分镜会返回 400 collection_required）
curl -s -H "$AUTH" -H 'Content-Type: application/json' -X POST $MIO/library/collections -d '{"title":"夏日短篇"}'
curl -s -H "$AUTH" -H 'Content-Type: application/json' -X PUT $MIO/workspace/active-collection -d '{"id":"collection_…"}'

# 3. 新建分镜（id、分幕 id、分幕名称都会自动补全）
curl -s -H "$AUTH" -H 'Content-Type: application/json' -X POST $MIO/library/storyboards -d '{
  "title": "海边的信", "outline": "夏天的告别",
  "frames": [{"prompt": "{character}, seaside town, morning", "caption": "风从窗边经过"},
             {"prompt": "{character}, train station, dusk", "caption": "列车进站"}]}'

# 4. 新建角色预设，之后逐个修改变量
curl -s -H "$AUTH" -H 'Content-Type: application/json' -X POST $MIO/library/characters -d '{
  "id": "nanami", "title": "七海", "entries": [{"key": "character", "value": "nanami, white shirt"}]}'
curl -s -H "$AUTH" -H 'Content-Type: application/json' -X PUT $MIO/library/characters/nanami/entries/hair -d '{"value": "black bob hair"}'

# 5. 新建云端渠道并保存 Key（Key 不会出现在任何响应里）
curl -s -H "$AUTH" -H 'Content-Type: application/json' -X POST $MIO/channels -d '{
  "provider": "openai", "title": "我的网关", "baseUrl": "https://api.example.com/v1",
  "model": "gpt-image-1", "apiKey": "sk-…", "activate": true}'

# 6. 装配生产任务并开始（title 可省略，默认取分镜标题；开始生成必须带 trusted: true）
curl -s -H "$AUTH" -H 'Content-Type: application/json' -X POST $MIO/production/tasks -d '{
  "storyId": "storyboard_…", "channelId": "provider_…", "presets": [{"kind": "characters", "id": "nanami"}]}'
curl -s -H "$AUTH" -H 'Content-Type: application/json' -X POST $MIO/production/tasks/assembly-…/start -d '{"trusted": true}'

# 7. 轮询进度，完成后导出画册
curl -s -H "$AUTH" $MIO/production/tasks/assembly-…          # status、pages[].state、albumId
curl -s -H "$AUTH" -H 'Content-Type: application/json' -X POST $MIO/albums/export \
     -d '{"albumIds": ["album_…"], "format": "zip"}' -o album.zip
```

完整的 Python 示例见 [examples/mio_client.py](../../examples/mio_client.py)。

## 5. 各功能区要点

### 5.1 文件库

`{kind}` 的取值如下：

| kind | 内容 | 说明 |
|---|---|---|
| `storyboards` | 分镜 | `frames[]`：`name`、`prompt`、`negative`、`caption`、`camera`、`width`、`height`… |
| `characters` / `scenes` | 角色 / 场景预设 | `entries[]`：`key`、`type`（`text`/`number`/`boolean`/`json`/`image`）、`value` |
| `collections` | 画册集 | 其他资源通过 `projectId` 归属到画册集 |
| `plans` | 创作计划 | |
| `albums` | 画册 | `steps[]`：`stepIndex`、`caption`、`prompt`、`image`… |
| `layouts` | 导出版式 | |
| `workflows` | ComfyUI 工作流 | `workflow` 为 API 格式节点图 |
| `rows` | 角色行（批量矩阵） | |
| `conversations` | LLM 会话 | |
| `tasks` | 浏览器队列任务 | 只读 |

- **新建**：`POST /library/{kind}`，请求体就是文档本身。
  - 省略 `id` 时自动分配。
  - 省略 `projectId` 时归入当前画册集；没有当前画册集时归入第一个画册集；一个画册集都没有时返回 `400 collection_required`。`POST /library/import` 的规则相同。
  - 图片字段可以直接写 `data:image/...` 或已有的 `/images/...` 地址，保存时会复制成该资源自己的图片。
- **替换**：`PUT /library/{kind}/{id}`，资源不存在时会创建；带 `If-None-Match: *` 则只允许创建。
- **修改**：`PATCH /library/{kind}/{id}`，合并补丁。
- **删除**：`DELETE /library/{kind}/{id}`。
  - 内容进入回收站，可以恢复。
  - 删除画册会同时停止并删除它的任务。
  - 删除非空画册集会返回 409，`details` 给出各类成员数；带 `?cascade=true` 则连同成员一起删除。
- **复制**：`POST /library/{kind}/{id}/duplicate`。
- **排序**：`POST /library/{kind}/reorder`，传 `{ids}`，列出的 ID 排在最前，其余保持原顺序。
- **分享包**：
  - `GET /library/{kind}/{id}/bundle`：下载 .mio.zip。
  - `POST /library/inspect`：只读预览待导入的内容。
  - `POST /library/import`：导入 .mio.zip、独立 JSON 或 HTML 画册，总是分配新 ID。
  - `POST /library/export`：把一份尚未保存的文档打包成 .mio.zip。
- **分幕**：
  - `POST /library/storyboards/{id}/frames` 可以新增单个分幕、`{frames:[…]}`，或者用 `{count, namePattern:"第 {n} 幕", basePrompt}` 批量生成；`?index=` 指定插入位置。
  - `{frame}` 既可以是分幕 ID，也可以是序号。
- **变量**：`PUT /library/{kind}/{id}/entries/{key}` 按变量名新增或覆盖，`DELETE` 删除。

### 5.2 设置与密钥

- `GET /settings/{name}`：`name` 为 `workspace`、`comfy`、`llm` 或 `xml`。comfy 加 `?view=true` 会返回界面使用的展开视图。
- `PUT` 替换整个设置文档，`PATCH` 合并补丁。例如修改 LLM 模型：`PATCH /settings/llm {"model":"gpt-4.1"}`。
- 密钥字段留空，表示保持原来的密钥。
- **密钥与端点绑定**：只改 `baseUrl` 而不提供新密钥，会返回 `409 credential_binding_changed`，防止旧密钥被发往新地址。
- 单独管理密钥：
  - 保存：`PUT /settings/{name}/secrets {"pointer":"/key","value":"sk-…"}`。
  - 删除：`DELETE /settings/{name}/secrets?pointer=/key`。
  - 审图模型的密钥在 `/ui/comfyStudio/settings/critic/key`。

### 5.3 渠道与 Key 池

- `GET /providers`：图像服务**类型**（comfyui、novelai、openai，以及扩展注册的类型），包括字段定义、默认值和能力。
- 渠道的增删改：`POST /channels`、`PATCH /channels/{id}`、`DELETE /channels/{id}`。
  - 新建时可以在请求体里带 `apiKey` 或 `apiKeys`，也可以带 `activate: true` 直接设为当前渠道。
  - 删除渠道会同时删除它的全部 Key。
  - 内置 ComfyUI 渠道不能删除；修改它的 `baseUrl` 实际写入 comfy 设置。
- 更换渠道地址或服务类型时，如果没有提供新 Key，旧 Key 会被解除，响应返回 `keysReset: true`。
- Key 池：
  - `POST /channels/{id}/keys` 添加，多个 Key 会轮流使用。
  - `DELETE /channels/{id}/keys/{keyId}` 删除。
  - 公网地址必须用 HTTPS 才能保存 Key。
- `POST /channels/{id}/check`：测试连接。ComfyUI 检查系统状态，云端渠道读取模型列表。
- `GET /channels/{id}/models`：模型列表（ComfyUI 返回节点信息和模型目录）。

### 5.4 生成：三种方式

1. **同步单张**：`POST /images/generations`。只支持 NovelAI 和 OpenAI 兼容渠道；并发上限为 1，被占用时返回 429；不会自动重试。
   - 使用已保存的渠道：`{"channelId":"…","prompt":"…"}`。旧字段 `providerId` 仍可作为别名使用。
   - 使用临时配置：`{"config":{provider, baseUrl, model, …},"prompt":"…"}`，可附带一次性的 `apiKey`（不保存、不回显）。
   - 可选字段：`negative`；`images`（最多 32 张参考图）；`source`（图生图）；`frame`（width、height、steps、cfg、seed、denoise）。
   - 返回的 `assetEndpoint` 可以直接 GET 取回图片。客户端读取超时建议不少于 330 秒。
2. **持久任务**：`/jobs`。与浏览器队列共用同一个执行器，支持 ComfyUI。
   - 用 `idempotencyKey` 做幂等提交；支持暂停、继续、取消、重试、失败策略、逐任务并发。
   - 事件通过 `GET /jobs/events`（SSE，支持 `Last-Event-ID` 续读）回放。
   - 列表只返回轻量摘要（`results` 为空），完整产物请读 `GET /jobs/{id}`。
   - 未知结果的帧永远不会自动重发；手动 `retry` 或 `continue` 需要带上最新的 `recovery` 确认。
   - 状态机与 JSON 示例见 [生产基座教程](../guide/FOUNDATION.md)，示例客户端见 [jobs_client.py](../../examples/jobs_client.py)。
3. **生产队列**：`/production/*`。把分镜、预设和渠道/工作流装配成一本画册，与界面的“装配向导”相同。
   - 装配：`POST /production/tasks`（等同 `POST /production/assemble`）。
     - `requestId` 可省略；带上它时，重试是幂等的（同一个 `requestId` 返回同一个任务）。
     - `title`（画册名称）可省略，默认取分镜标题；预设试绘（`preview: true`，需带 `previewPrompt`）默认为「预设名 · 试绘」。
     - 装配只是生成快照，不会调用图像服务，也不会产生费用。
   - 单任务控制：`POST /production/tasks/{id}/start|pause|resume|cancel|clone|rename`。
     - 开始生成（`start`、`start-many`、`start-sequence`）必须带 `trusted: true`，表示确认启动生成和可能产生的费用，否则返回 `403 forbidden`。
   - 任务状态 `status`：`standby`（已装配、未开始）→ `ready`（排队）→ `preparing` → `running` → `complete` / `partial`（部分页失败）/ `failed` / `cancelled` / `interrupted`。每一页的状态在 `pages[].state`。
   - 修改任务里的某一幕：`PATCH /production/tasks/{id}/frames/{n}`（name、prompt、negative、caption）。
   - 批量与全局操作：`start-many`、`start-sequence`、`reorder`、`concurrency`、`live-sync`、`clear-finished` 等。
   - 读取任务列表时支持 `If-None-Match`，内容没有变化则返回 304。
   - 任务 ID 形如 `assembly-…`。

### 5.5 画册

- `GET /albums/{id}`：每一页都带 `assetEndpoint`。
- `PATCH /albums/{id}`：修改标题、简介、标签、喜欢等。
- `PATCH /albums/{id}/steps/{n}`：修改某一页的台词、提示词，或替换图片（可用 data URL）。页不存在时会自动创建。
- `POST /albums/page`：非破坏式的图片编辑记录（保存、移除、恢复），与界面的图片工作室相同。
- 导出：
  - `POST /albums/export`：多本画册导出为自包含 HTML（`layoutId` 指定版式）、ZIP 或 PDF。
  - `POST /albums/{id}/export`：用导出器导出，默认 `pages-zip`。可用的导出器见 `GET /exporters`。
- 导入：`POST /albums/import`，用导入器导入。HTML 画册请用 `/library/import` 的 `html` 字段。
- 审图：`POST /albums/{id}/steps/{n}/critique` 审查这一页，并把结果写入 `critique`。

### 5.6 LLM 与视觉

- `POST /llm/chat`：`scope` 为 `llm`、`xml` 或 `critic`。服务端使用已保存的地址、模型和密钥，客户端只提供 `messages`（可选 `model`、`temperature`、`max_tokens`、`tools`、`response_format` 等）。
- 连接的选择规则与界面一致：
  - xml 没有开启“独立连接”时，使用 llm 的连接。
  - 审图设置为“共用连接”时，使用 llm 的连接。
- `POST /vision/audit`：传 `image`（本地 `/images/…` 或 data URL），返回分数、一致性、解剖结构和修改建议。

### 5.7 素材与维护

- `GET /assets?path=`：返回 data URL。
- `GET /assets/raw?path=`：返回原始字节；`thumb=256x256` 返回 WebP 缩略图，`download=true` 以附件下载。
- `POST /assets/upload`：接受 JSON 的 data URL，或直接发送图片字节。
- `POST /assets/fetch`：抓取一张远程图片。
- `GET /assets/catalog`：素材索引、引用关系和缺失文件。
- `/maintenance/assets/gc`：先预览，再用预览返回的 token 回收未引用的文件。回收的文件进入回收站，可以恢复。

### 5.8 生态与更新

- `/ecosystem/*` 与界面的扩展中心、样式工坊共用同一套实现：安装/启用/卸载扩展、主题叠加、样式片段与设计令牌、用户脚本、预处理、事件广播、一键恢复。未单独列出的生态路由也可以通过通用桥接访问。
- `/extensions/{id}/{path}`：调用已启用扩展自己的后端路由，以及扩展的 `storage`、`settings`、`tasks`、`capabilities`。
- 更新中心：
  - `GET /update/status`、`POST /update/check`。
  - `POST /update/apply`：后台进行，返回 202。
  - `POST /update/rollback`、`POST /update/restart`。
  - 除 status 和 check 外都需要 `confirm: true`。

## 6. 限额与重试

- **同步单张生成**：并发上限为 1；请求体上限约 66.7 MiB（50 MiB 图片的 base64 加上其他字段）；上游读取上限为 50 MiB。
- **不会自动重试付费请求**：重复提交同一个同步请求可能重复扣费；断开 HTTP 连接也不保证上游会取消。需要可恢复的执行请用 `/jobs` 或生产队列。
- **其他请求体上限**：
  - 默认 2 MiB。
  - 设置文档 20 MiB。
  - 文件库文档、新建画册 96 MiB；持久任务提交 90 MiB。
  - 文件库导入 860 MiB；画册导入 700 MiB。
  - 扩展与样式文件 64 MiB。
- **`requestId` 只是关联用的标识**，不能用来轮询任务状态。

## 7. 安全边界

- 只在本机或可信网络上运行。令牌只保护 `/api/v1`；公网部署需要反向代理保护**所有路径**（包括 `/images/` 和私有 `/api/`）。
- 抓取远程内容的接口（`/assets/fetch`、`/marketplace/fetch`）会从服务端访问你给出的 URL。它们属于管理员能力，不要把令牌交给不可信的程序。
- 任何接口都不返回密钥明文；`/workspace/snapshot` 也会去掉密钥引用。
- 不要在自动化中依赖浏览器里的 `globalThis.Mio` 内部对象。

## 8. 从 1.x 迁移

路径前缀仍是 `/api/v1`，契约版本升为 **2.0.0**。破坏性变更如下：

| 1.x | 2.0 |
|---|---|
| `GET /providers` 返回已保存渠道 | 返回图像服务**类型**；已保存渠道改用 `GET /channels`（精简视图仍有 `/resources/channels`） |
| `images/generations` 的 `providerId` | 改名为 `channelId`（`providerId` 仍可作为别名使用） |
| `production/*` 的错误是 `{"error":"文本"}` | 统一为 `{"error":{"code","message"},"requestId"}` |
| `resources/storyboards\|plans` 的 upsert | 保留但标记为弃用，建议改用 `/library/{kind}` |
| 只支持 GET / POST | 支持 PUT / PATCH / DELETE；CORS 同步放开，并暴露 `ETag`、`X-Request-Id` |
| `/health` 的 `version` 为 1.0.1 | `version` 为 API 契约版本，程序版本见 `appVersion` |

[安全说明](../SECURITY.md) · [开发日志](../API_DEVLOG.md) · [OpenAPI](openapi.json)
