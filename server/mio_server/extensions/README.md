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
- 停用扩展时，它注册的所有东西（钩子、贡献、主题……）会按来源 `ext:<id>` 一起移除，已挂载的后端路由也会立即拒绝新请求（404）。路由绑定本次审核并加载的代码；文件变动、重新启用或重新审核后，旧路由不能继续使用，重启服务才会挂载新路由。已经提交的任务仍由任务引擎管理，需停止时单独取消。

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

- `mode` 取 `light` 或 `dark`。没写的令牌会沿用对应模式内置主题（「纸」或「墨」）的值。
- 可用的令牌：`bg`、`bg-deep`、`panel`、`panel-2`、`hover`、`line`、`line-strong`、`text`、`soft`、`muted`、`accent`、`accent-strong`、`on-accent`、`tint`、`amber`、`red`、`blue`、`shadow`。
- 取值只能是颜色，`#hex`、`rgb()` 或 `hsl()` 都行。`shadow` 取 CSS 阴影值。含 `url(` 的值会被拒绝。
- 不装扩展也能用主题：在「设置 → 外观与阅读 → 主题」里直接导入同样格式的 JSON 文件。

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
| `mio.router` | FastAPI `APIRouter`，同时挂在 `/api/ext/<id>` 与 `/api/v2/ext/<id>`；v2 默认要求 admin，新增路由要重启 |
| `mio.route(method, path, scope="admin", **kwargs)` | 注册有明确权限的自定义路由，例如只读查询用 `scope="read"`，出图用 `scope="render"` |
| `mio.operation(id)` | 包装界面和 v2 共用的核心操作，参见下节 |
| `mio.load_settings()` / `mio.save_settings(data)` | 扩展自己的 JSON 设置，存在 `<数据目录>/extension-data/<id>.json` |
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

`GET /api/registry` 列出贡献目录。已直接连接核心执行路径的契约包括 `operation`、`workflow_binding`、`exporter`、`slice_preset`、`layout`、`theme`、`album_template`、`sfx_preset` 和 `cloud_adapter`。
其他名称目前可描述能力，但不能仅注册一个名称就改变任务执行。尤其是 `job_executor` 的目录项不支持热替换运行中的执行器；新增任务执行器仍需内部引擎接口及独立的结果重放契约。
`replace=True` 可覆盖同 ID 贡献；同来源更新只保留一层，停用来源会恢复上一层。加载失败也会移除失败来源，不会把被覆盖的核心实现丢掉。

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
`{"kind":"output","node":"42"}`；取图仍要求 ComfyUI history 的标准 `images` 输出。

## 界面面板

- `slot: "episode"` 的面板会作为剧集页的一个标签页显示，URL 查询参数里带 `episode` 和 `series` 两个 id。
- `slot: "settings"` 的面板显示在「设置 → 扩展」里。

面板运行在 `sandbox="allow-scripts"` 的 iframe 里，没有 `allow-same-origin`。服务端还会给面板文件加上 `connect-src 'none'` 的 CSP。所以面板读不到应用的存储，也不能直接联网或调用接口，扩展自己的 Python 路由同样不能直接调用。当前没有通用请求桥；需要调用后端能力时，使用显式本机 CLI 或正式开放 API，不能仅因路由存在就从沙箱面板发起请求。

## 显式 QA 扩展示例

仓库的 [`examples/extensions/qa-review`](../../../examples/extensions/qa-review/README.md) 提供可选 QA
入口、标准库 CLI 和完整打包步骤。安装与启用不提交任务，只有明确调用本机
`POST /api/ext/qa-review/queue` 才评审所选候选，且固定 `auto_adopt=False`。
示例使用不稳定的 `mio.internal.qa.submit`；远程程序可使用带 `render` 权限的正式
`POST /api/v2/episodes/{episode_id}/qa`，或同权限的 `POST /api/v2/ext/qa-review/queue`。
本例不添加主界面入口或沙箱网络请求桥。

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
