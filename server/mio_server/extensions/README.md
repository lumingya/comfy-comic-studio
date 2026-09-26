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
- 停用扩展时，它注册的所有东西（钩子、贡献、主题……）会按来源 `ext:<id>` 一起移除。新增的后端路由要重启服务后才生效。

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
- 不装扩展也能用主题：在「设置 → 主题」里直接导入同样格式的 JSON 文件。

## 画册模板

画册模板用的是旧版的 `formatVersion: 1` 格式，旧模板文件可以直接导入。

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
| `mio.router` | FastAPI `APIRouter`，挂在 `/api/ext/<id>` 下。新增路由要重启服务后生效 |
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

`mio.contribute` 支持的扩展点：`job_executor`、`exporter`、`slice_preset`、`prompt_dialect`、`pipeline_step`、`provider`、`workflow_template`、`layout`、`script_template`、`panel`、`command`、`route`、`theme`、`album_template`、`sfx_preset`、`cloud_adapter`。完整列表和说明见 `GET /api/registry`，或者 `mio_server/registry.py` 里的 `POINTS`。

举个例子，新增一种云端出图渠道类型的做法是：写一个 `HttpChannel` 的子类，实现 `_once(http, prompt, refs) -> bytes`，然后用 `mio.contribute("cloud_adapter", "my_kind", MyChannel)` 注册。注册后，「设置 → 云端出图」的类型下拉框里就会出现 `my_kind`。

## 界面面板

- `slot: "episode"` 的面板会作为剧集页的一个标签页显示，URL 查询参数里带 `episode` 和 `series` 两个 id。
- `slot: "settings"` 的面板显示在「设置 → 扩展」里。

面板运行在 `sandbox="allow-scripts"` 的 iframe 里，没有 `allow-same-origin`。服务端还会给面板文件加上 `connect-src 'none'` 的 CSP。所以面板读不到应用的存储，也不能直接联网或调用接口。面板需要的数据，应该由扩展的 Python 部分通过自己的路由提供，再由用户在界面上触发。

## 打包与安装

1. 把扩展目录打成 zip。`mio-extension.json` 可以在 zip 根目录，也可以在唯一的顶层文件夹里。
2. 在「设置 → 扩展 → 安装扩展」里选择这个 zip。
3. 确认摘要，然后启用。

覆盖安装同 id 的扩展时，要打开「覆盖同名」。

测试可以参考 `server/tests/test_extensions.py`。
