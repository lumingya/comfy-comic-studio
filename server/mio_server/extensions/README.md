# Mio 扩展 SDK

扩展是 `<数据目录>/extensions/<id>/` 下面的一个文件夹，打包成 zip 后在「设置 → 扩展」里安装。扩展可以做下面这些事：

- 只提供数据：主题、画册模板、拟声字样式、平台切片预设；
- 提供 Python 代码：注册钩子、后端路由，或者往注册表里添加任意贡献（比如新的云端出图适配器、导出器）；
- 提供界面面板：在沙箱 iframe 里显示一个 HTML 页面。

## 信任模型

- 安装扩展后**不会自动启用**。用户点「启用」时，服务端会记下扩展文件夹当前的 sha256 摘要，也就是用户确认过的内容。
- 以后扩展里任何文件变了，摘要就对不上，扩展状态会变成「文件已变动」，不再加载，要用户重新确认。
- 带 `main` 或 `panels` 的扩展算作「含代码」，确认对话框里会有更醒目的警告。Python 代码和本程序拥有相同的权限，这里没有沙箱，信任靠的是用户自己的审阅。
- 启动时设置环境变量 `MIO_SAFE_MODE=1`，所有扩展都不会加载。扩展把服务搞坏的时候用这个办法恢复。
- 停用扩展时，它注册的所有东西（钩子、贡献、主题……）会按来源 `ext:<id>` 一起移除，已挂载的后端路由也会立即拒绝新请求（404）。路由绑定本次审核并加载的代码；文件变动、重新启用或重新审核后，旧路由不能继续使用，重启服务才会挂载新路由。该来源有正在执行、结果不确定、等待保存结果或端点状态未恢复的任务时，会拒绝停用和替换；仅排队的任务可以保留，缺少原执行器时会阻塞。

## 目录结构

```
my-ext/
├── mio-extension.json   必需
├── main.py              可选：Python 入口
├── themes/dusk.json     可选：主题
├── album/zine.json      可选：画册模板
└── panel.html           可选：界面面板
```

## `mio-extension.json`

```json
{
  "id": "my-ext",
  "name": "我的扩展",
  "version": "0.1.0",
  "description": "示例",
  "author": "you",
  "homepage": "https://example.com",
  "main": "main.py",
  "contributes": {
    "themes": ["themes/dusk.json"],
    "album_templates": ["album/zine.json"],
    "sfx_presets": {
      "boom": { "fill": "#ffdd00", "stroke": "#000000", "stroke_width": 4, "effect": "shake" }
    },
    "slice_presets": [
      { "id": "tall", "label": "超长切片", "width": 1080, "max_height": 4000, "fmt": "JPEG" }
    ],
    "panels": [
      { "id": "stats", "slot": "episode", "title": "字数统计", "entry": "panel.html" }
    ]
  }
}
```

- `id` 只能用小写字母、数字、`-` 和 `_`，长度 2 到 48 个字符。
- 所有路径都相对于扩展目录。绝对路径和 `..` 都会被拒绝。

## 主题

```json
{
  "id": "dusk",
  "name": "黄昏",
  "mode": "dark",
  "author": "you",
  "tokens": { "bg": "#1a1420", "panel": "#231b2b", "accent": "#f0a868", "on-accent": "#2a1606" }
}
```

- `mode` 取 `light` 或 `dark`。没写的基础色沿用对应模式内置主题；没写的控件变量由 CSS 从基础色派生。
- 基础颜色：`bg`、`bg-deep`、`panel`、`panel-2`、`hover`、`line`、`line-strong`、`text`、`soft`、`muted`、`accent`、`accent-strong`、`on-accent`、`tint`、`amber`、`red`、`blue`。
- 按钮颜色：`button-border`、`button-hover`、`button-primary`、`button-primary-text`、`button-danger`、`button-active`。普通按钮保持透明。
- 控件与表面颜色：`control-surface`、`control-border`、`control-focus`、`surface-panel`、`surface-raised`。
- 尺寸：`radius-control`、`radius-card`、`control-height`、`button-height`、`button-small-height`、`button-large-height`、`space-control`（字段内部间距）、`space-panel`（卡片内边距）。接受 `px`、`rem`；圆角与间距可用 `0`。尺寸上限为 256px，其中控件圆角上限为 128px；高度范围为 1–256px。校验按 1rem = 16px 计算上限。
- 阴影：`shadow`、`shadow-sm`。接受 `none` 或最多四层 CSS 阴影，每层由颜色、2–4 个长度和可选的 `inset` 组成；长度绝对值不超过 1024px，模糊半径非负。
- 颜色接受 `transparent`、`#hex`、`rgb()` / `rgba()`、`hsl()` / `hsla()`。主题不能包含任意 CSS 声明、`url()`、`var()` 或计算表达式。
- 不装扩展也能用主题：在「设置 → 外观与阅读 → 主题」里直接导入同样格式的 JSON 文件。

例如在上面的 `tokens` 中加入 `"radius-control": "10px"`、`"control-height": "40px"`、`"button-hover": "#302536"`，即可统一调整公共控件。具体维护入口与范围见 [UI 样式与主题](../../../docs/UI_STYLES.md)。

## 画册模板

画册模板使用 `formatVersion: 1` 格式。

- 模板是一个 HTML 文档，里面可以用 `{{变量}}`。
- 模板里必须恰好有一个 `{{#books}}…{{/books}}` 循环，这个循环里必须恰好有一个 `{{#frames}}…{{/frames}}` 循环，`{{image}}` 要写在 frames 循环里面。
- `layout` 可选 `webtoon`、`manga`、`artbook`、`flip`。
- `assets` 里的图片是 data URL，模板里用 `{{asset:key}}` 引用。

出于安全考虑，模板里不能有 `<script>`。导出的文件只运行 Mio 自带的阅读脚本，旧模板里的自定义脚本会被忽略。内置模板在 [`../album/builtin/`](../album/builtin/)，可以参考。

## Python 入口

```python
# main.py
def activate(mio):
    @mio.hook("prompt.compiled")
    def add_style(value, **context):
        value["positive"] += ", watercolor"
        return value

    @mio.hook("take.created")
    def on_take(payload):
        mio.log.info("new take %s", payload["take_id"])

    @mio.router.get("/hello")  # 挂在 /api/ext/my-ext/hello
    def hello():
        return {"hello": mio.load_settings().get("name", "world")}


def deactivate():  # 可选：停用时调用
    pass
```

`activate(mio)` 收到的 `mio` 对象提供下面这些接口，它们是稳定接口：

| 接口 | 说明 |
| --- | --- |
| `mio.hook(name, fn=None, *, priority=100)` | 注册钩子，可以当装饰器用。`priority` 越小越先执行 |
| `mio.contribute(point, id, value, *, title="")` | 往注册表的扩展点里添加一项 |
| `mio.job_executor(kind, executor, *, resources=("local",), replace=False, title="")` | 注册执行器，自动绑定已审核扩展的来源与摘要 |
| `mio.submit_job(kind, items, snapshot=None, *, owner="", title="", idempotency_key=None)` | 提交本次启用且当前选中的执行器，`items` 使用 `mio_server.jobs.ItemSpec` |
| `mio.router` | FastAPI `APIRouter`，同时挂在 `/api/ext/<id>` 与 `/api/v2/ext/<id>`；v2 默认要求 admin，新增路由要重启 |
| `mio.route(method, path, scope="admin", **kwargs)` | 注册有明确权限的自定义路由，例如只读查询用 `scope="read"`，出图用 `scope="render"` |
| `mio.operation(id)` | 包装界面和 v2 共用的核心操作，参见下节 |
| `mio.load_settings()` / `mio.save_settings(data)` | 扩展自己的 JSON 设置，存在 `<数据目录>/extension-data/<id>.json`，顶层对象、单文件最多 1 MiB；原子保存并随工作区备份恢复，含凭据时需明确选择包含凭据 |
| `mio.log` | `logging.Logger`，名字是 `mio.ext.<id>` |
| `mio.internal` | 整个 `AppContext`（全部存储和服务）。这是**不稳定**的后门，可能随版本变化 |

### 钩子

「过滤」类钩子的签名是 `fn(value, **context) -> value`，返回修改后的值；返回 `None` 表示不修改。「通知」类钩子的签名是 `fn(payload)`，没有返回值。钩子抛出的异常会被记录到日志里，不会中断主流程。

| 钩子 | 类型 | 内容 |
| --- | --- | --- |
| `prompt.compiled` | 过滤 | 每格提示词编译后、提交前。value 是 `{positive, negative}`，context 有 `series`、`episode`、`panel`、`dialect` |
| `render.workflow` | 过滤 | ComfyUI 工作流提交前。value 是 API 格式的 graph，context 有 `workflow_id`、`stage` |
| `script.generated` | 过滤 | 一句话生成剧本后、入库前。value 是 Episode，context 有 `series`、`sentence` |
| `strip.lettering` | 过滤 | 自动嵌字后。value 是嵌字层列表，context 有 `series`、`episode` |
| `take.created` | 通知 | 新的出图结果入库：`{episode_id, panel_id, take_id, stage, job_id}` |
| `take.status` | 通知 | 出图结果被采用、淘汰或恢复：`{episode_id, take_id, status}` |
| `episode.exported` | 通知 | 导出完成：`{episode_id, fmt, bytes, filename}` |
| `job.event` | 通知 | 统一任务引擎的事件，原样转发 |

服务运行时，`GET /api/extensions` 返回的 `hooks` 字段里也有这份列表。

### 扩展点

`GET /api/registry` 列出贡献目录。已直接连接核心执行路径的契约包括 `operation`、`job_executor`、`workflow_binding`、`exporter`、`slice_preset`、`layout`、`theme`、`album_template`、`sfx_preset` 和 `cloud_adapter`。
其他名称目前可描述能力，但不能仅注册一个名称就改变任务执行。
`replace=True` 可覆盖同 ID 贡献；同来源更新只保留一层，停用来源会恢复上一层。加载失败也会移除失败来源，不会把被覆盖的核心实现丢掉。

### 任务执行器

`mio.contribute("job_executor", kind, executor, resources=("local",), replace=False)` 与
`mio.job_executor(...)` 使用同一注册路径。执行器必须提供 `execute(ctx) -> dict`，可选方法为
`on_complete(job, item, result)`、`reconcile(ctx) -> dict | None`、
`recover_state(ctx, record, *, confirm_stopped=False, discard_result=False) -> dict`。
资源只能选择已有的 `local` 或 `comfy`；资源容量和 ComfyUI 端点状态锁继续由任务引擎管理。
`ctx.input`、`ctx.snapshot` 是提交时冻结的数据；通过 `ctx.mark_sent(upstream)` 或
`ctx.checkpoint(upstream)` 记录已经发出的请求，通过 `ctx.on_abort(fn)` 注册该次执行的取消回调。
修改作品的任务必须把作品或话的 ID 传为 `owner`；空 owner 会保守阻止所有作品的恢复管理操作。

提交时保存 `(kind, source, digest)`：扩展摘要来自用户审核的整个扩展目录，内置执行器使用明确的
`mio-executor-v1:<kind>` 契约摘要。内置执行/结果协议有不兼容变化时必须提升此版本。
同 kind 的新覆盖只影响新提交；已经排队的任务仍精确解析仍在注册表中的旧来源层。
运行中的任务捕获执行器对象，执行、结果回调和取消始终使用同一对象。
重启后的核对、端点恢复与结果重放也必须找到相同来源和摘要，不能退回当前顶层执行器。
没有绑定的任务不会因后来注册同名执行器而自动运行。`GET /api/v2/job-executors`（`read`）
列出全部已加载层及其 `current`、`resources`、`replay_safe`；任务的 `executor` 字段报告原身份、
是否可用，以及 `executor_missing` / `executor_unbound` 原因。

返回结果会先写入持久交付记录，再调用 `on_complete`。只有明确声明 `replay_safe = True` 的执行器
才允许重启自动交付或 `POST /jobs/{job_id}/items/{idx}/replay-result`（`render`）显式重放。
结果已经收到但尚未完成交付时，`retry` 会拒绝再次执行。声明重放安全的回调需要用 `item['delivery_id']` 与
`item['delivery_sha']` 将作品修改和去重回执放进同一事务；重复回调返回原结果，不得重复新增或采用。
无需额外交付副作用、仅返回任务结果的执行器也可以声明重放安全。未声明的扩展保留结果并等待处理。

只有零执行尝试、没有任何交付记录或端点状态租约的任务，才允许管理员显式使用
`POST /api/v2/jobs/{job_id}/rebind-executor`，请求为
`{"expected": <原身份或 null>, "target": {"kind":"...","source":"ext:...","digest":"..."}}`。
目标必须已加载、kind 相同且支持任务资源；原身份不符会返回冲突。恢复原扩展摘要通常无需改绑。
停用、替换与激活共享任务规划锁；激活失败会恢复旧贡献、钩子与启用状态，激活期间不能提交任务。
扩展的 `activate` / `deactivate` 应只管理贡献与资源；任意外部写操作无法由加载器撤销。

新任务入口由扩展自己的类型化 `mio.route(..., scope="render")` 提供，再调用 `mio.submit_job`。
未提供通用任意任务提交 HTTP 接口，以保留核心出图规划校验。完整无需联网的示例在
[`examples/extensions/text-metrics`](../../../examples/extensions/text-metrics/README.md)，涵盖提交、
幂等、状态、重试和结果读取。直接修改 `mio.internal.registry` 或私有引擎字段属于不稳定逃生接口，
不享有 SDK 的生命周期、身份和恢复保证；执行器依赖发生协议变化也应更新扩展内容并重新审核。

### ComfyUI 输出与插件状态

`GET /api/v2/comfy-adapters` 列出适配器及其来源、摘要和契约版本。工作流配置用
`output_adapters: {"节点 ID": {"id": "适配器 ID", "options": {}}}` 选择输出协议；
`state_adapters: {"节点 ID": "适配器 ID"}` 选择状态协议。普通 history 图片和
ParameterControlPanel 继续使用内置协议。新注册点不会增加默认页面。

| 注册点 | 契约版本 1 |
| --- | --- |
| `comfy_output_adapter` | `freeze(node, options) -> JSON` 为纯函数；`collect(output, plan, transport) -> list[OutputImage]` 解析该节点的 history 输出。`OutputImage` 从 `mio_server.comfy.client` 导入，可返回图片字节或 filename/subfolder/type；核心校验图片并存入素材库。transport 只提供当前端点的 `view`。 |
| `comfy_state_adapter` | `validate(state, *, nonempty=False)`、`change(saved, changes) -> state`、`capture(client, node_id) -> state`、`push(client, node_id, state)`。状态为 JSON 对象或列表；client 提供当前端点 HTTP 请求。核心持久记录原状态、独占端点并恢复状态，扩展不自行重做事务。 |

SDK 自动绑定已审核包的来源和摘要。任务冻结该身份、输出解析计划、原状态及覆盖值，更新配置不改变已提交任务。
缺少原适配器版本时，待执行任务阻塞且不增加尝试次数；运行中、结果不确定、待交付或待恢复状态时，禁止停用或替换其来源。
核对和恢复使用同一解析协议，解析失败不自动重发生图。扩展 Python 代码仍是受信任代码，transport 不是安全沙盒。

后续 `RenderStage` 可设置 `feed_output: {"node_id": "42", "index": 1}`，传入上一启用阶段
节点 42 的第二张图片。未设置时沿用第一张。全部输出均保留；不存在节点或索引越界时明确失败，不回退。

可安装示例：[内联图片](../../../examples/extensions/comfy-inline-images/README.md)（附无模型 Comfy 节点）和
[参数面板协议](../../../examples/extensions/comfy-pcp-adapter/README.md)。这些示例展示已定义的协议，不承诺未知插件无需适配。

### 包装核心操作

`GET /api/v2/operations` 返回核心 HTTP 操作的 ID、实际参数名称、所需权限与当前包装来源；OpenAPI 的
`x-mio-operation` 与 `x-mio-arguments` 提供同一信息。ID 是相对 `/api` 的 `METHOD /path/{parameter}`。
包装发生在认证与请求校验之后，响应仍按接口声明校验；不包含静态文件、健康检查、WebSocket 和后台内部服务调用。

```python
def activate(mio):
    @mio.operation("POST /series")
    async def title_prefix(next, ctx, payload):
        payload = payload.model_copy(update={"title": "日常 · " + payload.title})
        return await next(payload=payload)
```

支持同步或异步包装器；`next` 是异步函数，最多调用一次。新启用的包装器位于外层，可传修改后的同名参数、
处理返回值或直接返回替代结果。扩展应维持原 API 类型与业务约束；安装的 Python 扩展是受信任代码。
失败会向调用者报告，**不会自动重试核心写操作**，因为核心可能已经成功。直接返回 `Response` 与普通 FastAPI
路由一样绕过响应模型验证。停用扩展影响之后的新调用，已经开始的请求继续使用其捕获的包装链。

扩展安装、启停或重新加载尚未完成时，新的核心 HTTP 请求会快速返回 `409`，此时尚未执行包装器或核心操作，
可在扩展变化完成后重试。包装链只在完整发布或回滚后捕获，捕获时的短锁不会跨异步执行持有。
普通出图规划或备份占用任务操作锁时，不会因此拒绝只读 HTTP 请求。

### 导出和版式

`exporter` 的 `interface="strip"` 契约是
`fn(image, strip, fmt, *, preset_id, title, subtitle, quality) -> (bytes, mime, filename)`，
由 `GET /episodes/{id}/export?fmt=<贡献ID>` 调用，`GET /export/formats` 可发现格式。
已有 `album` 与 `motion` 导出器分别使用原画册和动态漫函数签名，也经过注册表调用。
`layout` 使用 `fn(series, episode, images, faces, *, relayout_lettering) -> (Strip, scaled_images)`；
替换 `strip.default` 会同时影响自动排版与阅读合成，须尊重已保存的手动构图。显式排版请求也可传 `layout_id`。
更换版式贡献会清空阅读缓存。

可直接打包的 [`page-notes`](../../../examples/extensions/page-notes/README.md) 示例同时演示操作包装、
真实 JPEG 导出与带 `read` 权限的扩展查询。所有实例与候选数据均来自已有作品，不触发生成。

举个例子，新增一种云端出图渠道类型的做法是：写一个 `HttpChannel` 的子类，实现 `_once(http, prompt, refs) -> bytes`，然后用 `mio.contribute("cloud_adapter", "my_kind", MyChannel)` 注册。注册后，「设置 → 云端出图」的类型下拉框里就会出现 `my_kind`。

### 工作流识别规则

`workflow_binding` 的贡献是纯函数 `fn(graph) -> Iterable[Binding | dict]`，接收工作流副本，
返回 `kind/node/field` 等绑定字段。例如为自定义节点贡献提示词识别：

```python
def activate(mio):
    def identify(graph):
        for node_id, node in graph.items():
            if node["class_type"] == "MyPromptNode" and isinstance(node["inputs"].get("text"), str):
                yield {"kind": "prompt", "node": node_id, "field": "text"}

    mio.contribute("workflow_binding", "my-prompts", identify, title="自定义提示词节点")
```

规则同时参与导入检查、编译预览与实际任务冻结；优先级为明确标签 / 手动映射、扩展、核心启发式。
规则只补充缺失的种类，不覆盖作者的显式选择；无效目标、试图写入连线或规则异常会成为诊断警告。
停用扩展后不再使用其规则，已提交任务保留冻结结果。输出绑定选择节点，不是写输入：
`{"kind":"output","node":"42"}`；默认读取 ComfyUI history 的标准 `images` 输出，其他输出格式通过
`comfy_output_adapter` 显式适配。长篇导出器可以加入[文件写入接口](../../../docs/EXPORT_JOBS.md#文件导出扩展)，
逐区域生成并报告进度，旧式整图接口保持可用。

## 界面面板

- `slot: "episode"` 的面板会作为剧集页的一个标签页显示，URL 查询参数里带 `episode` 和 `series` 两个 id。
- `slot: "settings"` 的面板显示在「设置 → 扩展」里。

面板运行在 `sandbox="allow-scripts"` 的 iframe 里，没有 `allow-same-origin`，并带有
`connect-src 'none'` CSP。它不能直接联网或读取应用存储；通过受限操作桥访问清单明确声明的请求：

```json
{
  "id": "review", "slot": "episode", "title": "候选评审", "entry": "panel.html",
  "requests": [
    {"id":"episode", "method":"GET", "path":"/episodes/{episode_id}", "scope":"read"},
    {"id":"review", "method":"POST", "path":"/ext/my-ext/queue", "scope":"render"}
  ]
}
```

`path` 必须精确对应核心 OpenAPI 操作模板或本扩展的已挂载路由，不带 `/api` 前缀，不能是 URL、
通配或其他扩展路由。`scope` 必须与实际接口权限一致；自定义路由未声明权限时需要 `admin`。
每面板最多 32 个声明，只声明实际需要的接口。管理员允许敏感接口意味着面板可收到其原始 JSON
结果，包括接口正常返回的设置或新建令牌；桥不会自行增加权限或向面板透露请求头。

协议版本为 `1`。面板从 `location.hash` 的 `mio-session` 读取会话 nonce，然后向 `parent` 发送
`{type:"mio:panel:ready", version:1, session}`。父窗口返回同会话的 `mio:panel:init`，包含
`context:{episode_id?,series_id?}`、`requests` 与 `limits`。面板也必须检查 `event.source === parent`
和会话。只有用户明确点击操作时，发送：

```js
parent.postMessage({
  type: 'mio:panel:request', version: 1, session, rid: crypto.randomUUID(),
  request_id: 'episode', path_params: { episode_id: context.episode_id },
  // 可选 query（标量或字符串数组）和 JSON body；不能指定 URL、headers 或 context。
}, '*');
```

回应为 `{type:"mio:panel:response", version:1, session, rid, status, ok, data}`；操作失败会返回
原 HTTP 状态与 JSON 错误。父窗口只接受实际 iframe 的消息、匹配的随机会话与未使用的 `rid`。
每会话最多 256 个请求、同时 4 个、输入 64 KiB、输出 1 MiB；只支持 JSON/204，不能下载文件、
跟随重定向或递归调用桥。切换、重载或关闭面板会中止未完成请求并丢弃迟到结果。
中止或超时不保证服务端写入未发生，变更操作应使用原接口的 revision / expected_head / 幂等键，
先检查状态再显式重试。桥不会自动重试或启动生成任务。

正式开放接口是 `POST /api/v2/extension-panels/{ext_id}/{panel_id}/requests`，请求体含
`activation`、`digest`（来自面板目录）、`request_id`、`path_params`、`query`、`body` 和可选
`context`。本机 UI 使用同路径的 `/api` 前缀。后端检查当前启用实例和摘要、声明白名单、真实路由
及上下文存在性，随后调用原 FastAPI 路由，保留类型校验、操作包装和鉴权。v2 桥入口需要 `read`，
目标操作仍要求其原有权限；`read` 令牌不能通过桥出图或管理设置。停用影响后续请求，已开始的操作
可能继续完成；重新启用需要重新打开面板，自定义路由仍需重启挂载。

## 显式 QA 扩展示例

仓库的 [`examples/extensions/qa-review`](../../../examples/extensions/qa-review/README.md) 提供可选 QA
入口、标准库 CLI 和完整打包步骤。安装与启用不提交任务，只有明确调用本机
`POST /api/ext/qa-review/queue` 才评审所选候选，且固定 `auto_adopt=False`。
示例使用不稳定的 `mio.internal.qa.submit`；远程程序可使用带 `render` 权限的正式
`POST /api/v2/episodes/{episode_id}/qa`，或同权限的 `POST /api/v2/ext/qa-review/queue`。
示例提供可选面板，安装启用后才显示；读取候选和提交评审都需要明确点击，不添加主导航。

## 打包与安装

这些管理操作也可通过 `/api/v2/extensions` 完成，需 `admin` 令牌。安装、读取摘要、明确启用、
停用和删除沿用本机界面的同一实现；新增路由仍在重启后挂载。主题列表与导入 / 删除也有 v2
接口，分别使用 `read` / `write`。扩展自定义路由默认需 `admin`，可用 `mio.route` 明确声明更窄权限；
同一份请求类型、响应和启用摘要检查用于本机与 v2。路由内容变动、停用或重新加载后，旧挂载拒绝新请求。

1. 把扩展目录打成 zip。`mio-extension.json` 可以在 zip 根目录，也可以在唯一的顶层文件夹里。
2. 在「设置 → 扩展 → 安装扩展」里选择这个 zip。
3. 确认摘要，然后启用。

覆盖安装同 id 的扩展时，要打开「覆盖同名」。

测试可以参考 `server/tests/test_extensions.py`。
