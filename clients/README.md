# Mio 开放 API v2 与客户端

`/api/v2` 是给机器人、脚本和其他程序用的开放接口。它和网页界面用的 `/api` 是**同一套领域接口**：同样的路由、模型和错误格式 `{detail, kind}`，由领域模型自动生成，所以界面上能做的事都能通过 API 做。两者的区别：

- `/api/v2` 的领域操作都要带令牌：`Authorization: Bearer mio_…`；`/meta` 和 OpenAPI 文档用于公开发现，不返回作品或密钥；
- 令牌与扩展生命周期管理使用 `admin` 权限；扩展启用仍须提交审核过的内容摘要；
- 它有自己的 OpenAPI 文档 `/api/v2/openapi.json`（仓库里的快照是 [`openapi-v2.json`](openapi-v2.json)），客户端就是从这份文档生成的。

本机网页用的 `/api` 不需要令牌，只应该在本机或可信的局域网里访问。

`GET /api/v2/operations` 可发现所有核心 HTTP 操作及扩展包装来源，详细请求与响应类型在 OpenAPI。
扩展自定义路由同时挂在 `/api/v2/ext/<id>`，默认需要 `admin`；扩展可明确声明 read / write / render 权限。
无论从本机还是 v2 调用，都使用相同的类型校验、业务规则和已启用扩展；扩展 SDK 见
[`server/mio_server/extensions/README.md`](../server/mio_server/extensions/README.md)。

## 模型目录

模型发现使用 `POST /api/v2/settings/models`（`admin`，客户端方法 `fetch_models`）。
传 `kind`、`base_url`、`api_key` 与可选 `channel_id`，可查询未保存的连接草稿；不写配置、不调用生成。
`kind` 支持 `openai`（共享文本/视觉/聊天出图）、`openai_images`、`chat_image`、`novelai`、`comfyui`。
响应为 `models[{id,name,group}]`、`source`（`remote` 或 `bundled`）与 `notice`。
NovelAI 返回明确标记的内置参考目录，ComfyUI 返回节点公开的模型选项；目录不保证模型能力或账户权限。
密钥掩码只能用于对应已保存渠道与相同地址，地址改变后需重新传入或清除密钥。
扩展可通过 `fetch_models` operation wrapper 为自定义渠道提供目录；客户端始终可手工指定模型 ID。

## 生成任务与试生成

任务装配与预览接受 `generation`：`workflow_id`、`cloud_channel_id`、`profile_id` 至多指定一个，
以及 `candidates`、可选 `width` / `height`。尺寸显式传 `null` 表示保留工作流原值；省略时可使用
`settings.generation_defaults` 中按 `workflow:<id>` / `channel:<id>` / `profile:<id>` 保存的最近值。
装配成功后保存最近值，预览不写入。任务冻结方案、工作流与云端模型参数；重跑和克隆使用该快照。
云端地址与凭据在运行时读取当前连接，不写入快照；列表只返回轻量摘要，单个作品接口返回完整快照。

`POST /api/v2/workflows/{workflow_id}/trial` 需要 `render` 权限，接受 `prompt`、可选 `negative_prompt`、
`instance_id`、宽高、`values`、`overrides` 与 `idempotency_key`，实际生成一张并返回 `series`、`episode`、`job`。
通过普通任务事件、详情和取消接口跟踪执行；`/compile` 仍只预览提交数据，不出图。
预设通过 `entries` 定义普通变量，不自动追加正负提示词。分镜的 `overrides.raw_prompt` /
`overrides.raw_negative` 显式引用 `{变量名}`，`/workshop/assemble/preview` 返回与执行一致的最终提示词。

## 长篇整理与检查点

- `POST /series/{id}/panels/transfer`：同作品内跨话复制或移动，传来源 / 目标 ID、两边 revision 和选择的 panel IDs。
  复制会重映射候选和画布引用；锁定内容或跨选择边界的引用默认拒绝，跨边界气泡需要显式拆开。
  不同画布宽度且已有图形内容时拒绝自动搬运。追加选区保留相对位置，源画布留白不自动压缩。
- `POST /episodes/{id}/copy` 和 `POST /series/{id}/episodes/reorder`：复制整话或按完整话列表与 revisions 原子重排。
- `POST /series/{id}/variables/find`、`preview`、`apply`：精确处理合法 `{变量}`，保留 `{{转义}}`。
  预览返回明确字段、差异、冲突和 head；应用必须使用该 `expected_head`。不修改候选生成历史与未知扩展 JSON。
  find / preview 使用 read，实际修改使用 write。
- `GET /series/{id}/head`；`GET/POST /series/{id}/checkpoints`；`GET/DELETE /series/{id}/checkpoints/{checkpoint_id}`；
  `GET .../{checkpoint_id}/preview`；`POST .../{checkpoint_id}/restore`，恢复请求传 `expected_head`。
  恢复前自动保存当前内容为保护检查点。目标引用缺失、版本过时、相关作业未结束或有待交付结果时拒绝恢复。

这些路径均相对 `/api/v2`。检查点包括作品、设定集、预设、话和回收站内容；不包含图片字节和全局服务配置，
不能替代工作区备份。原作品需仍存在，已彻底清除的作品不能凭检查点重建。

工作区备份使用 `POST /backups`、`POST /backups/inspect` 与 `/backups/restore-plans`；所有接口（包括读取和下载）要求 `admin`。
恢复明确提交暂存计划的 `expected_head` 和 `inspection.sha256`，先保护当前工作区，再安排下次启动安装；不会立即替换或远程重启服务。
默认导出移除已配置凭据，恢复后队列、扩展和外部回调保持停用。完整契约、停机命令与边界见[工作区备份与恢复](../docs/WORKSPACE_BACKUPS.md)。

套装内容沿用 `/series/{id}`、`/series/{id}/episodes` 和 `/episodes/{id}` 的编辑接口。
`POST /creation-kits/{series_id}/preview-preset` 接受 `preset_ids`、`prompt`、可选 `title` 与 `profile_id`，
使用套装自身预设创建独立的一格待生成画册，不调用模型；需要 `write`。不存在的套装或预设不会回退默认工坊。
编辑后重新导出、预览或装配使用最新源，已经创建的成品保留原快照。

创作操作覆盖如下，界面与脚本使用同一规则：

| 操作 | v2 接口（省略 `/api/v2`） |
| --- | --- |
| 分镜、角色与预设 | `/series`、`/episodes`、`/episodes/{id}/panels` |
| 预览与装配 | `/workshop/assemble/preview`、`/workshop/assemble` |
| 工作流与渠道 | `/workflows`、`/profiles`、`/instances`、`/settings` |
| 明确生成与核对 | `/episodes/{id}/render`、`/jobs`、任务事件 / 取消 / 重试 / 恢复 |
| 采用与排版 | `/episodes/{id}/takes/{take_id}/adopt`、`/episodes/{id}/strip` |
| 阅读与输出 | `/episodes/{id}/reading`、`/episodes/{id}/panels/{panel_id}/image`、各导出接口 |
| 专业处理 | `/episodes/{id}/edit`、`qa`、`finalize`、`assistant/*`、动态漫接口 |

令牌签发、吊销、扩展安装 / 启用 / 停用 / 删除及主题操作均可通过 v2 完成。
首次令牌通过本机 `/api/tokens` 或设置页创建；后续由 `admin` 令牌调用 `/api/v2/tokens` 管理。
安装扩展只保存为停用状态；读取 `/api/v2/extensions` 的摘要并明确提交到启用接口后才加载。
`GET/PUT /api/v2/extensions/{id}/settings` 读写扩展自身 JSON 设置，需要 `admin`，使用与 SDK 相同的原子保存规则。
已安装但停用的扩展也可配置；卸载后已有设置可继续管理，未知 ID 不会凭空创建记录。设置会纳入工作区备份与恢复版本检查。
可选质检扩展示例见 [qa-review](../examples/extensions/qa-review/README.md)，默认不增加主界面入口。

`GET /api/v2/job-executors`（read）可发现真实执行器与精确身份，任务详情的 `executor` 给出原绑定及可用性。
缺少执行器时先恢复原摘要的扩展。`POST /api/v2/jobs/{id}/rebind-executor` 仅供 admin 明确提交 `expected` / `target` 身份，
并且任务必须尚未尝试且没有结果交付或端点租约。核对、端点恢复、结果重放及明确重提均需 `render`；
`resolve` 的 `resubmit` 只重试所选不确定项，不改变执行器身份。完整本地扩展示例见 [text-metrics](../examples/extensions/text-metrics/README.md)。

## 令牌与权限

在「设置 → 模型与连接 → API 令牌」里生成令牌。明文令牌只显示一次，服务端只保存它的 sha256。

| 权限 | 能做什么 |
| --- | --- |
| `read` | 作品、工坊、任务等读取，以及订阅任务事件的 WebSocket；配置管理类读取仍需 `admin` |
| `write` | 编辑作品、剧本、画布，采用或淘汰出图结果，导出 |
| `render` | 会消耗算力或额度的操作：一句话生成剧本、出图、定稿、修图、质检、剧本助手、重跑任务 |
| `admin` | 设置、ComfyUI 实例、Webhook、数据导入、更新、令牌及扩展生命周期 |

权限之间**不互相包含**，例如出图的机器人通常需要 `read + write + render`。令牌可以设置过期时间，也可以随时吊销。

`admin` 包含签发其他令牌和启用扩展代码的管理权，应分配给需要管理工作区的程序。
主题列表和面板目录使用 `read`，导入 / 删除用户主题使用 `write`；扩展文件读取使用 `admin`。
接口覆盖测试会核对每个已记录的本机操作都存在有鉴权的 v2 操作，防止新增功能遗漏开放接口。

浏览器里的 WebSocket 不能设置请求头，这时可以把令牌放在查询参数里：`?access_token=mio_…`。

## Python 客户端

[`python/mio_client.py`](python/mio_client.py) 是一个单文件客户端，只使用 Python 标准库（`urllib`），不需要安装 `httpx`。每个接口操作对应一个方法，方法名就是 OpenAPI 的 operationId：

```python
from mio_client import MioClient, MioError

mio = MioClient("http://127.0.0.1:8788", token="mio_…")
print(mio.whoami())
series = mio.list_series()
job = mio.render_episode(episode_id, body={"candidates": 1})  # 不传 panel_ids = 全部分格
mio.wait_job(job["id"])  # 轮询到完成 / 失败 / 取消
```

出错时抛出 `MioError`，带 `status`、`kind` 和 `detail`。`wait_job` 返回终态记录，调用方仍需检查
`state == "completed"`；对于 `uncertain` 条目应先核对上游记录，不要盲目重发付费请求。

### 工坊装配（与界面相同的链路）

`GET /api/v2/workshop` 需要 `read`；装配预览和装配使用 `write`，不消耗模型额度。
`POST /api/v2/workshop/assemble/preview` 只返回替换结果与诊断，不创建作品或任务；
`POST /api/v2/workshop/assemble` 原子保存画册和分幕快照。后续出图仍需 `render`。例如：

```python
workshop = mio.get_workshop()
boards = mio.list_episodes(workshop["id"])["items"]
board = next((b for b in boards if b["panel_count"] > 0), None)
if board is None:
    raise ValueError("请先在分镜工坊创建至少一幕")
request = {
    "storyboard_id": board["id"],
    "preset_ids": [p["id"] for p in workshop["presets"][:1]],
    "title": "API 装配示例",
    "variables": {"character_display_name": "七海"},  # 只用于这部作品
    "idempotency_key": "my-script-assembly-001",  # 每次新的创作意图使用新键
}
review = mio.preview_assembly(request)
for panel in review["panels"]:
    print(panel["title"], panel["positive"], panel["negative"], panel["dialogues"])
    for variable in panel["variables"]:
        if variable["status"] in ("missing", "cycle", "depth_limit"):
            print(variable["field"], variable["chain"], variable["status"])
assembled = mio.assemble(request)
# 检查预设变量和出图配置后，才显式调用 render_episode。
# body={"candidates": 1, "adopt_first": True} 会填入尚未有采用图的分格。
```

装配会固定当前分镜、预设、变量和画布设置；修改工坊模板不会追改已装配画册。
变量优先级为逐格 `$变量` → 本次 `variables` → 按 `preset_ids` 顺序后者覆盖前者 → 工坊变量
→ 内置变量。空字符串也是有效覆盖；未知提示词变量保留原文，阅读台词中的未知普通变量留空。
预览按实际逐格出图配置编译，变量记录包含来源、字段和嵌套引用链；这是核心编译结果，
扩展仍可能在生成时修改提示词。

网络响应丢失后，用同一个 `idempotency_key` 和同一请求重试会返回原作品；键已使用但请求不同
返回 409。工坊模板后来改动或删除不会让同键重放重复创建。需要另一部作品时使用新键；
修改输入后也应换键。预览不锁定模板版本，首次装配以提交时模板为准。

### 工作流导入检查

`POST /workflows/inspect` 接收 `{"workflow": API图或Mio工作流包}`，返回有类型的格式、绑定来源、
候选、未绑定参数、选中节点、模型依赖与问题清单。它不写库、不联网、不出图；可选 `object_info`
由调用方提供以核对节点与模型。`compilable` 表示可由 Mio 编译，`diagnostics.ok` 仅表示通过已声明
节点约束的静态检查，不执行自定义 `VALIDATE_INPUTS`。界面 `nodes/links` 文件会给出 API 导出指引。

工作流输出映射使用 `config.mapping.output="/节点ID"`，独立于输入字段；提示词等输入映射仍不能
覆盖连线。`POST /workflows/{id}/diagnose` 可传编译请求的 `variant/values/overrides`，只诊断对应实际图。

### 创作套装

`POST /creation-kits/export` 按 `series_id/episode_ids/preset_ids/title` 导出 `.mio-kit.zip`。
`POST /creation-kits/inspect` 接受原始 zip，只读返回内容与外部服务依赖。
`POST /creation-kits/import` 接收 `archive_base64`、`idempotency_key` 和 `profiles` 目标映射。
每个源配置必须明确选择 `instances` / `cloud_channel`，或明确 `{"unbound":true}` 延后绑定。
套装不包含服务密钥；同 ID 工作流会重新映射，避免误用目标工作区的另一份配置。

导入结果是独立 `kind=kit` 资源，用 `/creation-kits` 列出，不混入画册书架。
`POST /creation-kits/{series_id}/preview` 和 `/assemble` 接受 `episode_id/preset_ids/title/variables/idempotency_key`，
可选 `profile_id` 覆盖本次作品的默认出图配置，省略则沿用套装；逐格配置仍优先。预览与装配共用校验，
配置变更参与幂等请求比对，不改写源套装。模板修改不追改已装配作品。未绑定配置允许编辑与预览，生成前须
通过出图配置 API 设置服务并将 `binding_required` 设为 `false`。所有操作无需自动调用模型。

### 已收到结果的恢复

`GET /jobs/{id}/deliveries` 需要 `read`，查询本地结果的待应用 / 已应用 / 丢弃状态。
`POST /jobs/{id}/items/{idx}/replay-result` 需要 `render`，重放本地结果的保存，不重复原生成请求；
混合路线可补交已经冻结的后续精修任务。存在待应用结果时，普通生成重试和删除任务会被拒绝。
重启后仅对明确支持幂等回放的执行器尝试恢复，第三方执行器需显式声明 `replay_safe=True`。

作品候选与交付回执同事务保存，重放不会再次采用旧图、重复候选或改变后来手工修改的采用状态。
取消后不再补写，但不撤销此前已经保存的结果。网络响应到执行器落盘之前仍遵循 `uncertain`
对账语义；事件不是严格恰好一次交付，`delivery_id` 可用于消费者去重。

### 本地、纯云端与显式混合

出图配置使用两个字段指定路线：

| `cloud_shape` | `cloud_refine` | 行为 |
| --- | --- | --- |
| `false` | `false` | 本地运行 `draft` 阶段 |
| `true` | `false`（默认） | 仅调用云端，不自动执行保留的 `draft/final`；候选阶段为 `draft` |
| `true` | `true` | 云端 `shape` 后执行本地精修，精修成功后才自动采用 `draft` |

`cloud_refine=true` 必须同时设置 `cloud_shape=true`。混合使用 `final`，若为空则使用
`draft[1:]`；必须有启用阶段且能接收云端图的 `init` 输入。提交时预编译并固定后续节点图、
参数、实例选择和分组，运行中修改或删除配置不影响已提交计划；未通过编译不会先发送云端请求。
默认界面只提供本地和纯云端创建入口，已有混合配置会明确标注。

实际配置按「每格覆盖 → 变体覆盖 → 请求配置 → 作品默认 → `profile_default`」选取。
一次请求可以只生成某种路线的格；同批实际选中格混用本地和云端时拒绝提交，应分批请求。
渠道按「配置渠道 → 设置默认渠道 → 模型连接」回退。纯云端也可在采用后明确调用
`finalize_episode` 运行本地成品工作流，不会因保存或切换路线自动执行。

### PCP 参数面板：捕获、预览与恢复

`ParameterControlPanel` 的参数存在 ComfyUI 插件中，API 节点图里的 `pcp_ui` 不能代替参数快照。
先在 ComfyUI 中打开工作流并保存面板参数，再按以下顺序调用（路径均以 `/api/v2` 为前缀）：

1. `POST /workflows/{workflow_id}/capture-state?instance_id={instance_id}` 读取已有参数，返回
   `{"state":{"节点ID":[参数对象]}}`。需要 `write`，只读取远端状态，不保存工作流、不出图。
   插件不可用或任一面板状态为空时会明确报错。
2. `GET /workflows/{workflow_id}` 取出当前配置，把捕获结果的 `state` 合入完整 `config`，再
   `PATCH /workflows/{workflow_id}`，请求体为 `{"config":完整配置}`。这样保留已有绑定、变体和覆盖。
   `config.frontend` 可按节点 ID、参数名声明覆盖值，例如 `{"1":{"steps":20}}`。
3. `POST /workflows/{workflow_id}/compile`，请求体如 `{"variant":"draft","values":{}}`。
   检查返回的 `frontend_state` 中 `saved`、`changes`、`desired`；编译只做预览，不访问远端。
4. 在出图配置的 `draft` 中引用该工作流后，明确调用 `POST /episodes/{episode_id}/render`，
   请求体如 `{"profile_id":"profile_x","candidates":1}`，需要 `render`。提交时固定参数计划，
   后续修改工作流不会追改已提交任务。

Mio 在执行前记录并临时应用面板参数，确认远端执行结束并取得结果后恢复原值。
同一规范化端点的 PCP 任务独占该端点，其他端点可并行。为每个 ComfyUI 使用唯一规范 URL；
例如不要同时用 `localhost`、`127.0.0.1` 或不同代理地址登记同一个服务。租约只约束 Mio 的任务，
外部浏览器和其他客户端不受约束；它们改过面板后出现恢复冲突时，Mio 保留其当前值并等待人工处理。

出现 `uncertain`、取消后仍有恢复记录或恢复失败时，先用
`GET /jobs/{job_id}/state-recovery`（`read`）查看记录，再调用
`POST /jobs/{job_id}/items/{idx}/restore-state`（`render`），请求体默认为 `{}`。
运行中的任务始终拒绝恢复；上游执行状态未知时，只有先确认执行已停止，才传
`{"confirm_stopped":true}`，服务端仍会要求远端队列为空。未知执行不会自动重新提交，也不会为恢复
调用影响整个 ComfyUI 的全局 interrupt。

正常恢复会尝试取回结果，下载失败时保留待恢复参数和租约。若历史已丢失或决定明确放弃结果，
可传 `{"discard_result":true}`（状态未知时同时传 `confirm_stopped:true`）；这仍不能绕过运行中检查。
响应 `restored:false` 时记录继续阻塞端点；`restored:true` 才解除租约。已取消的任务不会采用结果，
需要重跑时在恢复完成后显式调用 retry。

### 云端参数与候选记录

分镜编译出的负向、宽高和种子随任务固定；渠道中的负向作为附加约束。逐格画幅优先，
未指定宽高的云端分镜按画幅比例计算约一百万像素；配置基宽仍只用于本地工作流。
渠道尺寸只在没有分镜画幅参数时作为默认值。渠道生成选项和模型也随提交固定，密钥不会
写入任务或候选记录。更改密钥可影响后续执行，删除渠道或改变渠道类型则明确失败。

| 渠道 | 画幅 | 负向 | 种子 | 参考图 |
| --- | --- | --- | --- | --- |
| OpenAI Images 兼容 | 传入 `size=WIDTHxHEIGHT`；不支持时由服务拒绝，不静默换尺寸 | 追加提示约束 | 不发送 | 多张图片通过 edits 发送 |
| 聊天接口出图 | 写入提示语，不保证精确像素 | 追加提示约束 | 不发送 | 按顺序发送全部图片，不按模型名截断 |
| NovelAI | 传入宽高，按 64 对齐并记录调整 | 独立负向字段 | 固定为 32 位种子，超范围取模并记录 | 沿用 V3 / V4 vibe 条件，不保证人物身份一致 |

生成成功的 `Take.cloud_request` 是有类型的请求记录，缺失时为 `null`，不能据此猜测
旧候选是否支持某参数。`requested` 保存编译意图；`effective` 保存实际提交参数，
`parameter_modes` 区分原生参数、提示约束、不支持和未知；`adjustments` 是稳定的调整代码。
参考图记录保留素材 ID、顺序、角色及来源。`effective.options` 只记录生成选项，不含
连接密钥。图片的真实宽高仍读取 `Take.width/height`。

```python
take = mio.get_episode(episode_id)["takes"][0]
request = take.get("cloud_request")
if request:
    print("请求画幅", request["requested"]["width"], request["requested"]["height"])
    print("提交画幅", request["effective"]["size"], request["parameter_modes"]["size"])
    print("实际图片", take["width"], take["height"])
    print("种子能力", request["parameter_modes"]["seed"], take["seed"])
```

只有原生使用的种子才写入云端候选的 `Take.seed`，Images / Chat 为 `null`；混合任务
后续本地精修的种子仍来自其独立快照。固定种子不承诺跨模型版本、服务配置的像素一致。
扩展未声明参数能力时记录未知，不把编译参数伪报为服务已使用的参数。

云端适配器可实现 `generate_image_request(request, refs, timeout, retries)`，返回图片字节和
`Reply`，通过 `Reply.image_request` 提供符合 `CloudRequestSnapshot` 的实际请求记录。
原有 `generate_image` 签名仍可使用，其参数能力标为未知。扩展生成选项遵循无密钥记录
约定；只有带明确“参考图不支持”证据的拒绝才允许合图重试，普通 400、超时或结果不明
不能成为重新发送付费请求的理由。

接口边界参考 [OpenAI Images 生成参数](https://developers.openai.com/api/reference/resources/images/methods/generate)、
[图像编辑参数](https://developers.openai.com/api/reference/resources/images/methods/edit) 和
[NovelAI 图像说明](https://docs.novelai.net/en/image/basics/)（核对日期：2026-11-14）。
OpenAI 官方接口未列出 seed / negative_prompt 字段；兼容服务的额外字段不作统一假定。
NovelAI 的 Swagger 参数详情本次无法读取，既有 V3 / V4 协议仍以仓库模拟请求契约验证，未宣称新增实服认证。

改了服务端接口之后要重新生成客户端：

```bash
python clients/python/generate.py          # 重写 openapi-v2.json 和两份 mio_client.py
python clients/python/generate.py --check  # CI 用：不一致时失败
```

生成器从服务端应用直接读 OpenAPI，不需要先启动服务。

### 阅读、裁切与输出格式

`GET /episodes/{id}/reading`（`read`）返回阅读宽高、格坐标、完整台词 `captions`、去除已嵌入正文的
`display_captions` 及内容摘要 `revision`；`GET /episodes/{id}/panels/{panel_id}/image?width=1600`
返回采用单格 PNG。未保存排版时保留原图比例和透明通道；保存过分格、裁切或嵌字时尊重保存的版面。
无采用图时前者返回空的格坐标和台词映射，后者为 404。`width` 是预览宽度上限（64–3200），
缓存容量不足时可能降低分辨率，正式导出保持自己的分辨率策略。

同一个工作区和快照的单格请求共用一次画布合成；作品变量、设定集、采用图及排版变化都会
使缓存失效。图片响应不使用素材的永久缓存策略；客户端可把 `revision` 追加到 URL，确保
嵌入的图片随内容刷新。这些读取不保存布局、不调用模型、不发出导出事件。

| 接口 | 输出与留白行为 |
| --- | --- |
| `GET /episodes/{id}/strip.png` | 完整合成画布，包含手动留白及跨格文字 |
| `GET /episodes/{id}/export?fmt=long\|slices\|pdf\|html` | 完整条漫；PDF 沿条漫切页，切片按平台宽高处理 |
| `POST /export/album` | 选择 HTML 模板，默认取合成单格；模板间距替代条漫间距，格外文字在格界截断 |
| `POST /export/portable` | ZIP 图片与简单阅读页，或每格一页 PDF；不接受 HTML 模板，不继承双页阅读布局 |

后两种接口默认 `lettered:true`；`false` 直接使用原始采用图，裁切也不应用。
`deduplicate_captions:true` 只去掉同格中已经完整嵌入且文字匹配的正文，保留其他对白与旁白；
SFX 和跨边界裁断的文字不触发去重。该参数默认 `false`，应用阅读器默认开启。
Portable 的 `show_captions` 只控制 ZIP 阅读页，PDF 仅含图片。HTML 画册、ZIP、PDF 和可编辑
`.mio.zip` 作品包分别服务不同用途，不能互相当作同一格式。

## AstrBot 插件

[`astrbot_mio/`](astrbot_mio/) 是 AstrBot 插件，把整个目录复制到 AstrBot 的 `data/plugins/` 下面即可。插件自带一份客户端副本，不需要再装别的包。

| 指令 | 作用 |
| --- | --- |
| `/mio 帮助` | 显示用法 |
| `/mio 画 <一句话>` | 写剧本、出图、自动采用、嵌字，然后把整条漫画发回来 |
| `/mio 任务` | 查看进行中的任务 |
| `/mio 作品` | 列出作品 |

插件配置项：`base_url`、`token`、`allowed_ids`（允许出图的用户，留空表示仅 AstrBot 管理员）、`series_title`、`candidates`、`strip_width`、`timeout`、`render_timeout`。令牌需要 `read + write + render` 权限。

## Webhook

在「设置 → 模型与连接 → Webhook」里添加 Webhook 后，事件发生时服务端会向指定 URL 发送 JSON POST 请求。可订阅的事件有：

| 事件 | 触发时机 |
| --- | --- |
| `job.completed` / `job.failed` / `job.canceled` | 任务结束 |
| `take.created` | 出图结果入库 |
| `take.status` | 采用或淘汰某张图 |
| `episode.exported` | 导出完成（包括画册和动态漫） |

`*` 表示订阅全部事件。请求体格式是 `{"id", "event", "at", "data"}`，请求头包括：

```
X-Mio-Event: job.completed
X-Mio-Delivery: dlv_…
X-Mio-Timestamp: 1790000000
X-Mio-Signature: sha256=<hex>
```

签名是 `HMAC-SHA256(secret, timestamp + "." + body)`。接收方要校验签名，还要拒绝时间戳太旧的请求：

```python
import hashlib, hmac, time


def verify(secret: str, headers, body: bytes, tolerance: int = 300) -> bool:
    stamp = headers["X-Mio-Timestamp"]
    if abs(time.time() - int(stamp)) > tolerance:
        return False
    mac = hmac.new(secret.encode(), stamp.encode() + b"." + body, hashlib.sha256)
    return hmac.compare_digest("sha256=" + mac.hexdigest(), headers["X-Mio-Signature"])
```

投递失败（网络错误或 5xx）时会重试两次，间隔分别是 2 秒和 10 秒。设置页的「测试」按钮会立刻发一个 `ping` 事件，「投递记录」里能看到最近的结果。

签名密钥只在创建 Webhook 时显示一次。以后要换密钥，可以 `PATCH /api/webhooks/{id}`，请求体带 `{"rotate_secret": true}`。
