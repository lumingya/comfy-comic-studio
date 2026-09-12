# 通用生产基座：任务、素材与开放接口

[教程中心](../README.md) · [图片变量](IMAGE_VARIABLES.md) · [外部 API](../api/README.md) · [English](../en/FOUNDATION.md)

## 这次改变了什么

日常创作入口不变：选渠道、写分镜、设变量、生成画册。但**真实画册的执行者已经由浏览器改为 Python 服务**。浏览器只负责编辑、冻结快照、提交和显示结果；不会再负责维持整册的生成循环。

- 任务保存在 `data/execution/jobs.sqlite3`，以 SQLite WAL 事务记录状态、每幕结果、上游 ID 和事件。
- 同一个任务目录只允许一个工作进程持有租约，防止误开两份服务重复执行。
- 外部任务 API 和界面共用调度器；每任务有独立的 1–16 幕请求窗口，任意完成立即补位。任务默认 FIFO，明确手动启动另一个任务才增加独立池；两个任务各 4 路即合计 8 路。同步生成接口独立，不属于持久任务或队列并发限额。
- 上传素材、任务 API、事件、资源写入与素材清理使用独立 DTO，不开放整个浏览器状态树给外部覆写。
- 新代码使用明确的 `foundationFrameInput → submitFoundationQueue → providers` 边界。真实队列入口直接指向服务提交函数；原离线测试执行器仅用于开发测试，未重写全部已有界面模块。

## 关页、暂停、关闭服务分别意味着什么

| 操作 | 结果 |
| --- | --- |
| 关闭网页 | Python 已接收并启动的整册任务继续执行，结果落盘 |
| 重新打开网页 | 从持久任务记录恢复进度和画册结果，不重新提交已接收的请求 |
| 暂停队列 | 停止后续分镜调度；已经提交给供应商的所有在途分镜继续等待并保存结果 |
| 中止任务 | 立即停止本地任务并关闭已建立的连接；丢弃未确认的迟到结果，先前已确认图片保留；上游仍可能计费 |
| 关闭或崩溃的 Python 服务 | 浏览器无法替它执行；未确认的运行中任务在重启后标为 `unknown`，并暂停调度 |
| 再次提交相同幂等键和相同快照 | 返回原任务，不再次生成 |
| 相同幂等键却使用不同快照 | 返回 HTTP 409，不覆盖旧任务 |

不要把“取消本地等待”当成供应商取消或退款。Mio 默认不自动重试付费请求；队列页可明确启用有限重试，结果不明仍不自动重发。

**尚未提交的本地草稿不属于服务端任务。** 正在等待浏览器写作助手完成的台词也不会凭空在后台继续生成；本轮服务化对象是图像生产，不是 LLM 对话。

## 状态与未知结果的处理

`pending → running → complete` 是正常路径。另有 `paused`、`failed`、`unknown`、`canceled`、`archived`。

- `failed`：收到明确 HTTP 拒绝、输入校验失败或其他明确错误。保留错误正文，默认继续本任务其他分镜，可配置仅暂停本任务；仅明确启用有限策略后可重试指定暂时性 HTTP 错误。
- `unknown`：超时、连接中断或服务停止导致结果无法确认。界面显示**结果未确认**，不是假装完成，也不会自动补齐重试。
- ComfyUI 已保存 `prompt_id` 时，点击**查询 ComfyUI 已有结果**。只查历史和下载结果，**不重新上传或调用 `/prompt`**；调度暂停时也允许这个只读核对。
- OpenAI/NovelAI 同步接口通常没有可供 Mio 查询的任务 ID。先自行检查供应商记录，再明确确认风险并**继续未完成分镜**，或选择**核对后放弃跟踪**。放弃跟踪不表示上游已取消。
- 对未确认的原画册，普通补齐优先进入原任务恢复确认，不新建画册。未经明确确认，不重发未知幕；其他尚未请求的分镜默认仍可继续。

`archive` 仅用于已结束任务：保留幂等记录，不再列入正常任务列表或占用服务端素材引用。原画册和变量仍然会独立保护其文件。

## 查看外部任务

队列页的「服务端任务」或设置中的「全部服务端任务」会列出界面与外部客户端任务。列表只读取轻量状态；点击「查看结果 / 原始错误」才读取完整结果与错误。可以暂存、继续、立即停止、修订未完成提示词、核对或归档任务。归档前会把已投影的画册结果落盘，不因隐藏历史而丢图；工作区中的任务/画册快照仍可能引用这些文件。

## 参数和结果契约

每幕输入包含：`config`、已解析的 `prompt/negative`、有序本地 `images`、`frame` 参数，以及 ComfyUI 的 `workflow`。图片先上传，持久任务中不存 Base64 或明文 API Key。

结果包含：

```json
{
  "contractVersion": 1,
  "image": "/images/albums/example/first.png",
  "artifacts": [
    {"kind": "image", "url": "/images/albums/example/first.png", "mime": "image/png", "bytes": 12345}
  ],
  "provider": "openai",
  "offlineFallback": false,
  "appliedExtraParams": ["output_compression"]
}
```

`image` 保留给现有画册使用；`artifacts` 保留供应商返回的全部支持图片，最多 32 张、合计 50 MiB。当前没有因此引入视频或音频生成。

### 高级请求参数

云渠道配置中展开「高级请求参数 · JSON」，例如：

```json
{"output_compression": 80}
```

这是一个协议扩展字段示例，具体模型未必支持。关联渠道的高级参数在每次请求前读取最新保存值，本次实际输入仍记录快照；结果的 `appliedExtraParams` 列出已加入请求的字段。

不能覆盖标准配置已经产生的字段、模型、提示词、有序图片、消息体或鉴权。不要在这里写密钥。ComfyUI 使用现有工作流和节点映射扩展，而不是把任意 JSON 塞进不相关接口。接口不接受参数时，保留脱敏后的上游状态和正文，不换模型、不降级。

## 外部完整生产流程

先按 [API 教程](../api/README.md) 配置 `MIO_API_TOKEN`。下列接口均要求 `Authorization: Bearer ...`。

1. `POST /api/v1/assets/upload`：上传图片，取得 `/images/` 引用。
2. `POST /api/v1/jobs`：提交不可变输入和幂等键。
3. `GET /api/v1/jobs/{id}`：查看进度、结果和错误。
4. `GET /api/v1/jobs/events?after=0`：读取 SSE 事件；断开后用最后事件 ID 重连。
5. `POST /api/v1/jobs/{id}`：控制或核对任务。

### 提交例子

先在本机保存渠道密钥，或给服务进程设置 `OPENAI_API_KEY`。不使用明文密钥作为任务字段：

```json
{
  "idempotencyKey": "my-client-book-001",
  "input": {
    "label": "我的第一份外部任务",
    "frames": [{
      "config": {
        "provider": "openai",
        "protocol": "images",
        "baseUrl": "https://api.openai.com/v1",
        "model": "gpt-image-1",
        "keyMode": "environment",
        "sendSize": false,
        "sendQuality": false
      },
      "prompt": "A quiet seaside town at sunrise",
      "images": []
    }]
  }
}
```

`input.frames` 可含多幕；`hold: true` 可先持久保存而不执行，然后对该任务发送 `{"action":"resume"}`。更换提示词请使用新的业务幂等键，不能复用同一个键覆盖旧请求。

控制操作：

| 路径/操作 | 含义 |
| --- | --- |
| `POST jobs/scheduler`，`pause` / `resume` | 暂停/恢复全局后续调度 |
| `POST jobs/{id}`，`cancel` | 立即停止该任务，隔离并丢弃未确认响应，保留之前已确认图片 |
| `pause` / `resume` | 暂存/释放尚未调度的任务；不能直接恢复 unknown |
| `continue` | 以新读取的 `expectedCursor` / `expectedUpdated` 继续 failed / unknown / 未完成 canceled；unknown 要求 `acknowledgeUnconfirmed: true`；不自动恢复全局调度 |
| `POST jobs/scheduler`，`runtime` | 保存每任务分镜窗口 `runtime.concurrency` / `runtime.requestTimeoutSeconds` |
| `start` | 携带最新 recovery 确认，给一个普通待办任务启用独立池；不隐式解除全局暂停 |
| `defer` | 无在途请求时暂留此任务、释放其 FIFO 占位，不重发；其他待办可接着执行 |
| `reconcile` | 仅核对有上游 ID 的 unknown ComfyUI 任务 |
| `abandon` | 明确放弃跟踪 unknown；不取消上游 |
| `archive` | 归档已结束任务并释放其服务端引用 |
| `POST jobs/reorder`，`{"ids":[...]}` | 排序未开始的待执行任务；不能移动已产生进度的任务 |

应用安全限额：最多 32 个已启用任务池（不是所有任务共用 32 个请求槽）；已启用但暂留的池也计入，结束或 defer/cancel 后释放。每个任务最多 1,000 幕、快照最多 10 MiB；最多 1,000 个未结束/未确认任务。列表返回活动任务与近期历史，最多 2,000 条；旧任务可按 ID 查询。事件每次最多返回 200 条，按最后 ID 继续读取。SSE 是可重连的短响应，不是 Webhook；原生浏览器 EventSource 不能自定义 Authorization，请使用支持请求头的客户端。

### ComfyUI 外部任务

`config.provider` 使用 `comfyui`，填写 `baseUrl` 和可选 `outputNodeId`，并提供 API 格式 `workflow`。图片在 `images` 中有序排列；对应 LoadImage 字段使用字符串 `mio-image://1`、`mio-image://2`。服务端依次上传，再将占位值替换为 ComfyUI 返回的文件名。提示词里的 `@image_N` 不是文件字段占位符，两者不要混淆。

### 同步接口边界

`POST /api/v1/images/generations` 和私有同步图像端点保留，以免破坏已有客户端和独立精修调用。它们不是持久任务 API，没有幂等恢复语义；需要可靠编排的新客户端使用 `/jobs`。供应商适配器没有覆盖整个生成过程的全局互斥锁；每次请求使用独立上下文。队列并发限额不限制直接同步接口。

## 素材索引、检查和安全回收

入口：**设置 → 保存服务 → 素材索引 / 引用 / 安全清理**。

索引记录文件名称、格式、尺寸（支持解析时）、大小、SHA-256、时间及已记录的上传/生成来源。引用会指向工作区字段、变量、任务输入或结果。已有历史文件若没有来源记录，不编造来源。

- `GET assets/catalog`：读取索引与引用报告。
- `GET assets/catalog?verify=1`：重算内容摘要，检查按内容命名的文件是否不一致；界面的完整性入口使用此模式。摘要一致不等于模型质量或完整解码验证。
- 缺失引用单独列出，不拿示范图替代。
- 没有任何引用、且至少超过 **24 小时** 的文件才成为候选。
- 清理必须携带预览 `token` 和明确选择的 `paths`。引用变化返回 409，要求重新预览。
- 活动或 unknown 任务存在时禁止清理。归档任务不再保护资产，但画册/变量引用仍有效。
- 清理只移到 `data/trash/<时间>/...`，没有自动永久删除。误操作可以停服务后按原相对路径搬回 `data/assets/images/`。

## 受控资源写入与冲突

`GET /api/v1/resources/storyboards` 或 `/resources/plans` 返回 DTO 和 `revision`。POST 使用：

```json
{
  "expectedRevision": 123456789,
  "item": {
    "id": "external_story",
    "title": "海边",
    "projectId": "填写已存在的画册集 ID",
    "frames": [{"prompt": "A quiet seaside town"}]
  }
}
```

分镜上限沿用界面的 512 幕。计划写入支持名称、现有角色/分镜/预设引用等基本字段；当前不接受外部直接覆写复杂类型变量和单幕覆盖，使用界面维护它们。不会允许 arbitrary 全量状态覆写。

浏览器保存也携带已读取的版本。另一个页面或外部程序更新后，旧页面保存返回 409；先备份尚未保存的编辑，再重新读取后端。不做盲目自动合并，也不静默覆盖。

## 备份和部署

完整备份先停止服务，再复制整个 `data/`，包括 SQLite 文件、素材、引用索引和密钥库。不要在服务运行时只拷贝 `jobs.sqlite3` 而丢掉 WAL；默认启动脚本保持不变。

便携目录 ZIP 仍包含画册、变量和快照图片，不是服务端事务数据库的替代。恢复到另一服务时，未结束的服务端任务会标记为需人工核对，不自动重新付费生成。素材索引可重建，回收目录不会自动清空。

这是单用户、可信本地基座，不是多租户 SaaS。默认绑定回环地址；若改为公网监听，必须给**整个站点包括私有 API**加可靠鉴权，不能只保护 `/api/v1`。

## 验收清单

- 三幕生成后关网页，确认 Python 完成其余分镜；重开能看到结果。
- 相同幂等键重交不增加上游请求数，变更快照返回 409。
- 暂停不抹掉当前结果，中止不继续下一幕。
- 重启时运行中任务变 unknown，不自动重试；ComfyUI 核对不调用 `/prompt`。
- 素材引用阻止回收，预览后新增引用会使确认 token 失效。
- 外部修改后，旧浏览器保存返回 409。

自动化测试使用真实本地 HTTP、SQLite、文件系统和浏览器；供应商由本地协议服务或替身替代。**没有真实云端扣费验证，没有真实 GPU 执行，也没有在本环境执行 Windows 启动/文件锁测试。** 查看 [测试记录](../TEST_RESULTS.txt)。


## 运行配置与人工续生成 API

队列页提供同样的设置，详见 [并发、超时和原画册恢复](../QUEUE_AND_COLLECTION_UPDATE.md)。外部调用示例：

```json
{"action":"runtime","runtime":{"concurrency":3,"requestTimeoutSeconds":900}}
```

向 `POST /api/v1/jobs/scheduler` 发送。`GET jobs` 返回 `runtime`；每个任务的 `active_timeout` 是最近一次已领取请求的秒数。正在请求中的超时不会被事后修改；降低并发不会中断请求。自动重试等待不占请求槽；其他到期或尚未请求的分镜可先补位。任务仍默认 FIFO；并发值不会自动启动第二个任务，需明确 `start`。

先 `GET /api/v1/jobs/{id}`，把最新的 `cursor` 和 `updated` 代入：

```json
{"action":"continue","recovery":{"expectedCursor":1,"expectedUpdated":1789120000.25,"acknowledgeUnconfirmed":true}}
```

时间只是示意，必须使用真实最新值。发送到同一任务的 POST 地址。无在途请求的 failed / unknown / 未完成 canceled 以及暂存或重试等待任务可继续；未知结果必须明确承认可能重复计费。操作只把未完成/失败/未知/取消的幕放回待办，已确认索引不会重发。不允许从不一致的持久结果静默回到第一幕。操作保留 cursor/results/input/幂等键，过期或重复确认返回 409。之后如确需执行，再向 scheduler 发送 `{"action":"resume"}`。

`progressVersion: 2` / `executionModel: "per-task-frame-pools"` 标识独立分镜进度。`cursor` 是已确认数量，**不是连续前缀、不是下一幕索引**。例如只完成第 2、4 幕时 cursor=2，completedIndices=[1,3]，nextIndex=0。`results` 按 index 排序但可有空洞；`results[].index` 是任务内索引，始终按该索引投影画册。`frameStates` 给出各幕状态/尝试/重试时间/上游 ID，`runningIndices` / `running_count` 表示在途，`nextIndex` 是最早未完成幕。输入可携带零基 `frameIndex`，读取会返回 `frameIndices` 和 `nextFrameIndex`。浏览器对子集优先采用其保存的 `serverIndices` 映射原画册幕号。旧任务未提供原索引时，外部调用只能得到任务内索引，不能推断原始幕号。


## 立即停止、输入修订和活动记录

`cancel` 现在立即把活动任务置为 canceled、使旧请求批次失效并关闭可访问的本地传输连接。即使稍后收到响应也不增加 cursor/results；继续后旧响应不得覆盖新结果。停止后再继续仍需接受上游可能已计费的风险。暂停 scheduler 仍表示只暂停后续调度，不丢弃正在执行的响应。服务商取消不受本地保证。

`GET /api/v1/jobs/activity?after=0` 返回最近最多 200 条持久事件（JSON `data` 数组）。附时间、任务 ID/名称、渠道类型、已确认幕数、尝试次数、超时和至多 4000 字符错误摘要；用最后 id 增量读取。`jobs/events` SSE 重放仍可用。运行日志页面同步这些记录，并额外展示调度数量，旧事件缺失字段不编造。

### 外部客户端的显式 amend API（不是界面编辑入口）

界面直接使用原分镜故事编辑区，服务在每次发送前读取该画册最新已保存的输入。修改范围可选择具体画册版本，详见 [队列与编辑说明](../QUEUE_AND_COLLECTION_UPDATE.md)。`requestHistory` 返回最近 100 次准备发送的输入：索引、尝试号、时间、完整输入摘要、提示词、图片引用和参数。完整输入保存在 SQLite；不代表上游已经接受请求。核对 ComfyUI 时使用原请求输入，不使用新草稿。

外部客户端仍可在失败、未知、停止或暂存的云渠道任务上：

1. POST 同一任务 `{"action":"hold"}`，撤销自动重试倒计时；活动请求需先 cancel。
2. GET 最新任务，读取 `editableFrames`（任务内索引、正/负提示词、渠道）、cursor、updated。
3. POST `{"action":"amend","recovery":{"expectedCursor":1,"expectedUpdated":1789120000.25},"edits":[{"index":1,"prompt":"修改后符合供应商规则的场景","negative":""}]}`。
4. 上面的时间戳只是示例，必须替换为 GET 返回的最新 updated。保存不开始生成，不改动任何已确认幕，即使它位于失败幕之后。再次 GET 后按 continue 的确认流程执行。

这里修改的是实际发送的展开后文字，不重新解释变量；原图片列表/模型/渠道不变。只可修改未完成的云渠道分镜，ComfyUI 已编译工作流不支持该文字接口。原输入幂等摘要不变，相同原始提交仍返回同一个任务；每次显式修订保存 before/after 历史。结果中的 prompt/negative 记录该次实际输入，刷新后也不会显示旧文本。迟到请求不会改变新执行状态。

## 渠道关联与配置读取

新浏览器任务保存 channelId 和渠道类型，发送前统一解析该渠道最新已保存的模型、地址、参数、协议与密钥绑定。历史快照不作为动态渠道的回退配置。所有关联任务的未发送请求一起生效；缺失或无效配置暂停该任务后续派发。currentChannels 显示服务端的安全预览，requestHistory 记录实际准备输入。ComfyUI 核对沿用原请求；工作流图结构仍属于任务版本。[完整架构说明](CONFIGURATION.md)。
