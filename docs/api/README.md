# Mio 外部 API v1

[教程中心](../README.md) · [English](../en/API.md) · [OpenAPI 3.1](openapi.json) · [Python 客户端](../../examples/mio_client.py)

## 1. 设计边界

公共入口为 `/api/v1`，与浏览器私有 `/api/config`、`/api/image/generate` 分离。目标是让脚本、桌面工具和未来适配器通过稳定 DTO 接入，而不依赖整个内部状态树。

当前能力：服务健康、能力发现、渠道标识、分镜与计划资源、画册元数据、持久图像任务、素材管理，以及旧同步单图生成兼容接口。

新增服务端 `/jobs`：外部 ComfyUI/云渠道任务、整册异步执行、幂等提交、控制、SSE 事件；另有素材上传/索引/回收和版本校验的分镜/计划写入。完整端点与限制见 [生产基座教程](../guide/FOUNDATION.md)。不提供 Webhook、多租户权限隔离或任意内部状态覆写。

## 2. 启用与鉴权

生成随机 Token：

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

将它设置在**服务启动进程**中：

```bash
# macOS / Linux
export MIO_API_TOKEN="上一步生成的至少32字符Token"
python server.py
```

```powershell
# Windows PowerShell
$env:MIO_API_TOKEN = "上一步生成的至少32字符Token"
python server.py
```

所有公共 GET/POST（包括 health 和 OpenAPI）需要：

```http
Authorization: Bearer YOUR_MIO_TOKEN
```

Token 缺失或短于 32 字符时服务返回 `503 api_disabled`；错误令牌返回 `401 unauthorized`。不要把令牌放进 URL。该令牌代表对本地资源和付费生成能力的完整信任，并没有用户级权限隔离。

**供应商密钥是另一回事**：生成体的 `apiKey` 或 `NOVELAI_API_KEY` / `OPENAI_API_KEY` 环境变量用于图像供应商；不能用 Mio Token 替代。

## 3. 通用格式

成功：

```json
{"data":{"status":"ok","name":"Mio","version":"1.0.0"},"requestId":"req_..."}
```

失败：

```json
{"error":{"code":"unauthorized","message":"A valid Mio Bearer token is required"},"requestId":"req_..."}
```

`GET /api/v1/openapi.json` 是唯一成功响应例外：直接返回原始 OpenAPI 对象，方便导入工具。错误仍使用错误信封。

请求体使用 JSON 对象和 `Content-Type: application/json`；不接受任意表单、未知生成字段或两个冲突的渠道选择。供应商 HTTP 错误保留状态与脱敏后的原始正文（最多读取 2 MiB）；其他内部错误不暴露实现细节。任务 DTO 不返回密钥或完整执行载荷。

## 4. 端点清单

| 方法 | 路径 | 返回/作用 |
| --- | --- | --- |
| GET | `/api/v1/health` | 名称、版本、服务存活；不代表供应商可用 |
| GET | `/api/v1/capabilities` | 当前真实支持的操作和限制 |
| GET | `/api/v1/providers` | 已落盘渠道的 id/title/provider/model/protocol；不返回地址或密钥 |
| GET | `/api/v1/storyboards?limit=50&offset=0` | 模板与分镜提示词 DTO，无执行快照 |
| GET | `/api/v1/albums?limit=50&offset=0` | 画册元数据，不包含 sourceSnapshot 或原图 |
| POST | `/api/v1/images/generations` | 同步生成一张图，存入本地外部素材组 |
| GET | `/api/v1/assets?path=%2Fimages%2F...` | 本地图片的 `dataUrl`；不接受远程 URL 或目录穿越 |
| GET | `/api/v1/openapi.json` | 原始 OpenAPI 3.1 文档 |

列表返回 `{items,total,limit,offset}`，limit 为 1–100，offset ≥ 0。渠道列表可能为空：需先在界面配置并成功落盘，或直接在生成请求中提供 config。

## 5. 生成请求

### 使用已经保存的渠道

先查询 `providers`，选择实际返回的 id：

```json
{
  "providerId": "openai",
  "prompt": "A quiet illustrated bookshop, soft morning light",
  "negative": "blur, watermark",
  "apiKey": "YOUR_PROVIDER_KEY"
}
```

### 显式渠道配置

使用服务器供应商环境变量时可不传 apiKey：

```bash
curl -X POST http://127.0.0.1:8777/api/v1/images/generations \
  -H "Authorization: Bearer $MIO_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"config":{"provider":"openai","baseUrl":"https://api.openai.com/v1","model":"gpt-image-1","protocol":"images","size":"1024x1024","quality":"auto"},"prompt":"A quiet illustrated bookshop, soft morning light"}'
```

`providerId` 和 `config` 必须二选一。config 支持 provider/baseUrl/model/protocol/size/quality/sampler/id/title/keyMode/keyId 字符串，以及 sendSize/sendQuality 布尔开关。关闭开关或参数留空则不发送；keyMode 为 none/stored/environment，providerId 可使用本机绑定的已保存 keyId。显式传 `apiKey: ""` 或 `keyMode: "none"` 禁止鉴权，不使用环境变量后备；provider 为 novelai/openai，protocol 为 images/chat。远端地址要求 HTTPS，本机兼容服务允许回环 HTTP。baseUrl 填 API 根路径而非完整操作路径。

NovelAI 示例：

```json
{
  "config": {
    "provider": "novelai",
    "baseUrl": "https://image.novelai.net",
    "model": "nai-diffusion-4-5-full",
    "sampler": "k_euler_ancestral"
  },
  "prompt": "1girl, reading a book, soft light",
  "negative": "low quality, blurry",
  "frame": {"width":768,"height":1024,"steps":28,"cfg":5,"seed":-1}
}
```

可选 `images` 是有序字符串数组（最多 32 项），每项为本地 `/images/` 引用或 PNG/JPEG/WebP data URL；原始图像合计上限 50 MiB。顺序保留到 Images multipart / Chat image_url / NovelAI reference_image_multiple；不会解析浏览器变量。服务商 HTTP 错误保留状态与密钥脱敏后的详情（正文最多读取 2 MiB），通过 `upstream_error` 返回，不自动重试。

可选 `source` 为 PNG/JPEG/WebP 的 base64 data URL。用于 NovelAI img2img、OpenAI edits 或 Chat reference。`frame.denoise` 对 NovelAI 是图生图 strength；OpenAI 不发送 steps/cfg/seed 等不兼容采样参数。提示词在 API 层按原文发送；不会展开浏览器变量。需要模板变量的外部程序自行解析并传最终文本。

### 返回

```json
{
  "data": {
    "image": "/images/...png",
    "provider": "openai",
    "offlineFallback": false,
    "assetEndpoint": "/api/v1/assets?path=%2Fimages%2F...png"
  },
  "requestId": "req_..."
}
```

使用同一 Bearer Token GET assetEndpoint，解码 `data.dataUrl`。生成素材落盘，但不会自动进入画册或改写浏览器队列。生成耗时可能数分钟，客户端读取超时应至少 330 秒。

## 6. 限额、重试与错误

本节的**直接同步单图端点**并发上限为 1（不是异步 `/jobs` 的限额）。执行槽占用时返回 429；这是并发限制，不是每分钟限流。界面生成不受这个槽控制，预算仍需调用者协调。

请求体上限约 66.7 MiB（50 MiB 图片的 base64 加少量字段），上游读取与 ZIP 单图解压上限为 50 MiB。实际可用大小还受供应商限制。

| HTTP | 常见错误码 | 处理 |
| --- | --- | --- |
| 400 | invalid_request / invalid_prompt / invalid_frame / generation_rejected | 检查 JSON、参数、模型、密钥或额度，不自动重复付费 |
| 401 | unauthorized | 检查 Mio Token |
| 403 | origin_denied | 浏览器 Origin 必须在允许列表 |
| 404 | not_found / provider_not_found / asset_not_found | 检查路径和已保存 ID |
| 405 | method_not_allowed | 使用文档列出的 GET/POST；HEAD 返回 405，无正文 |
| 413 | payload_too_large | 缩小参考图 |
| 429 | generation_busy | 等前一请求结束后再决定是否提交 |
| 502 | upstream_failure | 上游失败/超时；重试前检查是否已扣费 |
| 503 | api_disabled | 在启动服务时配置强 Token |

**没有自动重试或 Idempotency-Key 支持。** 同一个请求重复提交可能重复扣费。取消 HTTP 连接不保证取消上游任务。requestId 用于调用方关联响应，不是可轮询的任务 ID。

## 7. 安全与接口边界

- v1 只暴露明确列出的 DTO 字段，排除执行快照、全量配置和供应商秘密。分镜文本仍可能是私人创作内容。
- 新增可选字段与能力可保持 v1；移除字段或改变语义应进入 v2。调用者忽略未知响应字段，但不要发送未知请求字段。
- 不允许浏览器任意跨域访问。需要指定可信 Origin 时设置 `MIO_ORIGINS`，逗号分隔完整 origin；不支持通配符。
- 只在本机或可信网络运行。Token 不保护私有 `/api/config`、静态页面和 `/images` 路径；公网部署需代理隔离并保护**所有路径**。
- 不在自动化中依赖 `globalThis.Mio` 内部对象；它们是浏览器实现细节。

[安全说明](../../SECURITY.md) · [Python 客户端用法](../../examples/mio_client.py)

## 持久任务、素材与资源写入

新增接口及状态机见 [生产基座教程](../guide/FOUNDATION.md)，对应路径已纳入 [OpenAPI](openapi.json)。新客户端优先完成“上传素材 → 幂等提交任务 → 查询/订阅状态 → 读取 artifacts”，不把同步 HTTP 等待当作可靠队列。示例：[jobs_client.py](../../examples/jobs_client.py)。

### 任务列表与详情

`GET /api/v1/jobs` 返回轻量状态摘要，列表的 `results` 为空，错误只作详情提示。需要完整产物列表和脱敏原始错误时，请读取 `GET /api/v1/jobs/{id}`；不要把列表中的空数组当成没有生成结果。

### 失败策略与人工重试

`POST /api/v1/jobs/scheduler` 支持 `{"action":"policy","policy":{"mode":"retry","maxRetries":2,"delaySeconds":15,"onExhausted":"pause"}}`。默认 `mode=continue` / `onExhausted=continue`；可选 pause/retry。配置在服务端共享，但仅影响发生错误的任务；pause 不暂停其他任务。默认保留失败/未知幕并继续同任务其他幕，未知幕本身永不自动重发。有限重试需明确授权，可能再次计费；仅适用 HTTP 429/502/503/504，明确内容拒绝除外。`POST jobs/{id}` 的 `retry` 只允许 failed，也要求 recovery 中最新 expectedCursor/expectedUpdated，保留已有结果和原输入，不自动解除全局暂停；客户端需另行确认 resume。详情新增 retry_count/ready_at/attempts/errors。完整语义见 [队列操作说明](../QUEUE_AND_COLLECTION_UPDATE.md)。


### 任务并发、超时与原任务恢复

异步 `/jobs` 的 `runtime.concurrency` 是**每任务分镜请求上限**，任意完成立即补位。默认任务 FIFO，`start` 携带最新 recovery 确認后另启独立池；两任务各 4 可合计 8 路。`defer` 在无在途时释放暂留任务的 FIFO 占位，不重发。`continue` 需最新已确认数量/时间戳和未知费用确认。`cursor` 只是已确认数量，不表示前缀；按 `results[].index` / `frameStates` / `nextIndex` 处理空洞。GET 任务给出 progressVersion=2 / executionModel=per-task-frame-pools；capabilities 给出 jobConcurrencyScope=frames_per_task / jobProgressVersion=2。它们不改变直接同步端点的执行限额或默认超时。请见 [完整契约与 JSON 示例](../guide/FOUNDATION.md#运行配置与人工续生成-api) 和 [OpenAPI](openapi.json)。

### 每次请求的输入记录

任务详情新增 `requestHistory`（最近 100 条）。含 index、attempt、time、inputHash、prompt、negative、images、config、frame；config 只含渠道类型、模型等安全字段，不返回端点 URL、密钥引用或任意配置扩展；代表已准备的请求版本，不代表上游已接受或扣费。浏览器任务每次执行前读取已保存的画册局部输入，不读取公共模板；无画册关联的外部任务继续使用提交输入或显式 amend 版本。原幂等键不变。

### 动态渠道引用

JobFrame 可设置 channelId，config 至少给出 provider 类型。每次新请求按该 ID 读取最新保存的渠道配置；不可用时明确失败并暂停该任务后续派发。currentChannels 返回安全的下次请求配置预览，不返回端点或密钥。未设置引用的显式外部任务不猜测当前活动渠道。ComfyUI 历史核对使用原请求配置。[完整示例](../guide/CONFIGURATION.md)。
