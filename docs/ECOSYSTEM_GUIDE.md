# 扩展 SDK v3 · 开放平台指南

Mio 的扩展系统在 v3 不再是"几个固定插槽"，而是一个开放平台：扩展可以出现在界面的任何地方、改写任何核心函数、注入任意样式、在 Python 里跑后台任务、直接返回文件，甚至互相调用。主题与自定义 CSS 的部分见 [样式工坊与主题包](STYLE_STUDIO.md)。

> 信任模型没有变：主题和扩展是**可信代码**，JavaScript 运行在页面里，Python 运行在独立子进程里，两者都拥有你本机用户的全部权限。只安装你信任的作者的包。出问题时访问 `?safe_mode=1`，那里有一键停用。

---

## 一、五分钟上手

一个扩展就是一个文件夹：

```
my-extension/
├── mio.extension.json   # 清单
├── index.js             # 前端（可选）
├── plugin.py            # Python 后端（可选）
└── style.css            # 随扩展加载的样式（可选）
```

```json
{
  "id": "my-extension",
  "name": "我的第一个扩展",
  "version": "1.0.0",
  "apiVersion": 3,
  "entry": "index.js",
  "styles": ["style.css"]
}
```

```js
// index.js
export default function (ctx) {
  ctx.anchors.register('topbar', { id: 'hello', icon: 'spark', title: '打个招呼', run: () => ctx.ui.toast('你好！') });
  return () => {};   // 卸载时执行；通过 ctx 注册的东西会自动清理
}
```

安装方式三选一（设置 → 扩展中心）：

| 方式 | 适合 | 说明 |
|---|---|---|
| **链接本地文件夹** | 开发 | 输入文件夹的绝对路径。不复制文件，**改动自动热重载**（前端重新导入模块、Python 进程重启、样式刷新）。 |
| 导入 ZIP | 分发 | 把文件夹打包成 ZIP（可带一层根目录）拖进来。 |
| 通过 Git 安装 | 分发 | 公开 HTTPS 仓库；"更新代码"重新拉取。 |

导入的扩展默认停用，需要你确认后启用；链接的文件夹默认直接启用。

---

## 二、清单 `mio.extension.json`

| 字段 | 说明 |
|---|---|
| `id` | `[a-z][a-z0-9_-]{0,63}`，也是数据目录名与所有注册项的 owner |
| `name` / `version` / `apiVersion` | `apiVersion` 写 `3`（1、2 仍可加载） |
| `entry` | 前端入口 ES module，默认 `index.js`；纯后端扩展可以省略文件 |
| `styles` | 字符串或数组，启用时自动以 `<link>` 注入，停用时移除 |
| `settings` | 设置项数组，类型：`text` `password` `number` `select` `toggle` `json` `textarea` `code` `url` `color` `range` `font` `image`；出现在扩展中心的"设置"按钮里 |
| `requirements` | pip 依赖：文件名（如 `requirements.txt`）或字符串数组。启用时后台 `pip install --target` 到该扩展私有的 `site-packages`，装完自动启动 Python 进程；状态与日志在扩展卡片上可见 |
| `contributes` | 任意 JSON（≤64 KiB），用来向其他扩展/宿主声明自己贡献了什么 |
| `permissions` `keywords` `description` `author` `homepage` `license` `preview` | 展示与自描述用 |

未知字段不会报错。

---

## 三、前端 `ctx`（index.js 收到的对象）

`export default function (ctx)` 可以返回：
- 一个函数 → 卸载时调用；
- `{ dispose, api }` → `api` 会通过 `ctx.expose()` 发布给其他扩展。

所有注册接口都返回一个"撤销函数"，但你通常不需要调用它——扩展停用/热重载时平台会按 owner 清理全部注册项、样式、补丁、快捷键、挂载点和 DOM。

### 3.1 界面：插槽、锚点、挂载

**插槽（slots）** —— 旧版的结构化位置，仍然可用：

```js
ctx.slots.nav.register({ id: 'page', label: '我的页面', icon: 'book', render(root, context) {...} });   // 侧栏整页
ctx.slots.dock.register({ id: 'panel', title: '面板', render(root) {...} });                         // 右侧抽屉
ctx.slots.inspector.register({ id: 'notes', title: '备注', render(root, { book, page }) {...} });   // 阅读室信息栏
ctx.slots.frameCard.register({ id: 'tag', label: '标记', icon: 'star', when: c => !!c.frame, run(c) {...} }); // 分镜编辑区
ctx.slots.albumCard.register({ id: 'act', icon: 'spark', run(c) {...} });                           // 画册卡片
ctx.slots.contextMenu.register({ id: 'x', label: '…', kinds: ['album', 'frame'], run(c) {...} });   // 右键菜单
ctx.slots.commands.register({ id: 'cmd', title: '…', run() {...} });                                // ⌘K 命令面板
ctx.slots.toolbar.register({ id: 'tool', label: '…', run(c) {...} });                               // 分镜工具栏
ctx.slots.settings.register({ id: 'lab', label: '我的设置页', icon: 'settings', render(root) {...} }); // 设置里的整页（v3）
```

插槽名是开放的：`ctx.slots['anything'].register(...)` 会自动创建一个新插槽，别的扩展可以用 `ctx.slots.anything.items()` 读取——这是扩展之间约定"贡献点"的最简单方式。

**锚点（anchors，v3）** —— 核心界面里的具名位置，由平台在每次渲染后自动填充：

| 锚点 | 位置 |
|---|---|
| `topbar` | 顶栏右侧 |
| `sidebar-nav` | 侧栏主导航下方 |
| `sidebar-bottom` | 侧栏个人资料上方 |
| `statusbar` | 底部状态栏 |
| `main-top` / `main-bottom` | 当前主视图的顶部/底部 |
| `settings-nav` | 设置分类导航 |
| `creation-tabs` | 创作工坊的页签行 |
| `reader-controls` | 阅读室控制条 |
| `home` | 首页 hero 下方 |

```js
ctx.anchors.register('topbar', { id: 'badge', icon: 'spark', label: 'KIT', title: '提示', run: () => ... });   // 自动生成按钮
ctx.anchors.register('statusbar', { id: 'live', live: true, html: () => `<span>${count} 项</span>` });         // live: 每次渲染重算
ctx.anchors.register('main-top', { id: 'panel', render(el, context) { el.innerHTML = ...; } });             // 完全自定义
```

主题或其他扩展在自己的 HTML 里写 `<span data-mio-anchor="my-spot"></span>`，就得到一个新锚点 `my-spot`。

**挂载（mount，v3）** —— 不依赖锚点，直接贴到任何元素旁：

```js
ctx.mount({
  id: 'tip', selector: '.workshop-page-title', position: 'after',   // before | after | prepend | append | replace
  max: 1, when: c => !!c.story,
  render(container, target, context) { container.textContent = '…'; }   // 或 html: string | () => string
});
```

核心用 innerHTML 重绘界面时，挂载会自动重新贴上（MutationObserver + 渲染钩子），不会重复。

### 3.2 补丁、过滤器、快捷键、样式

```js
// 包装任何全局函数（或 ctx.patch(obj, 'method', wrapper)）；多个扩展形成链，停用时按层还原
ctx.patch('renderShell', function (next, ...args) { const r = next(...args); /* 之后做点什么 */ return r; });

// 过滤器：核心在这些点询问最终值
ctx.filters.add('prompt.compose', text => text + ', masterpiece');        // 提示词插值之后
ctx.filters.add('command.items', items => [...items, myItem]);           // ⌘K 列表
ctx.filters.add('frame.render', frame => ({ ...frame, steps: 30 }));     // 前端生成前
ctx.filters.apply('my.filter', value, context);                          // 也可以定义自己的过滤点

// 快捷键：'mod' = ⌘/Ctrl；默认在输入框内不触发，global:true 例外
ctx.keys.register('mod+shift+k', () => ..., { description: '打开实验室' });

// 样式：owner 作用域，位于主题层之后、用户样式之前
ctx.styles.add('.my-badge{color:var(--accent)}');          // 或 add(css, 'key') 管理多段
ctx.styles.link('extra.css');                               // 相对扩展目录，或绝对 URL
ctx.styles.vars({ '--my-accent': '#e8a33d' });              // 直接写 CSS 变量
```

### 3.3 数据、设置、任务、接口

```js
await ctx.api('/notes', { text })          // POST → plugin.py 里的 ctx.route('/notes')
await ctx.api('/notes?limit=5')            // GET，查询参数传给 (body, query)
await ctx.api('/report', undefined, { raw: true })   // 原始 Response（HTML、文件……）
ctx.api.url('/badge.svg')                  // 可直接放进 <img src> / <a href>

ctx.storage.get/set/delete                 // = ctx.data.workspace（随扩展保留，卸载可选清除）
ctx.data.config / workspace / cache / tmp  // 四层：配置 / 工作数据 / 可清理缓存 / 临时
await ctx.settings.get();  await ctx.settings.set({ ... });  ctx.settings.onChange(values => ...)

// 后台任务（Python ctx.tasks.spawn 创建）
const { id } = await ctx.api('/start', {});
await ctx.tasks.wait(id, { onProgress: t => console.log(t.progress, t.message) });
await ctx.tasks.cancel(id);  await ctx.tasks.list();
```

存储限制：单值 32 MiB、每扩展 1 GiB；键名 `[a-zA-Z0-9_-]{1,100}`。

### 3.4 事件、画册门面、核心直达

```js
ctx.events.on('album.saved', (payload, meta) => ...);      // 任意事件名，'*' 监听全部
ctx.events.once('app.ready', ...);
ctx.events.emit('my-ext.something', { ... });               // 任意名字（app.* 除外），会中继到 Python

ctx.albums.list() / get(id) / current() / open(id) / goTo(step) / create(title) / update(id, patch)
ctx.albums.stories() / story(id) / updateStoryFrame(storyId, index, patch)   // 分镜工坊里的分镜资产
ctx.albums.updateFrame(planId, index, patch)                                   // 草稿分镜

ctx.core.state / ui / rt / createUI / studioUI      // 直接读写应用状态（你知道自己在做什么）
ctx.core.render() / renderShell() / save() / navigate(route)
ctx.core.modal(title, html) / closeModal() / toast(msg) / confirmAction(...) / textModal(...)
ctx.core.request(url, options) / post(body)         // 带 CSRF 的宿主 fetch
ctx.core.actions                                    // data-act → 处理函数表，可直接添加
ctx.core.globals                                    // globalThis，所有全局函数都在这里
ctx.host.request(url) / fetch(url) / production.* / status() / ecosystem(path, body)
```

`ctx.core` 是"逃生舱"：SDK 覆盖不到的地方，就直接用它。核心内部函数没有兼容承诺，但项目处于早期，鼓励大胆尝试——链接文件夹 + 热重载让试错成本很低。

### 3.5 扩展之间

```js
return { api: { note: text => ..., events: () => [...] } };   // 发布 API
const kit = ctx.extensions.get('studio-kit');                 // 同步获取（未加载返回 null）
const kit = await ctx.extensions.whenReady('studio-kit');     // 等它就绪
await ctx.extensions.call('studio-kit', '/log', {});          // 直接调它的 Python 路由
ctx.extensions.list()                                          // 含 contributes
```

### 3.6 其他

`ctx.icons.mount({ name: '<path d="…"/>' })`、`ctx.exporters.register(...)`、`ctx.importers.register(...)`、`ctx.variables.registerType(...)`、`ctx.ui.*`（toast / modal / button / field / navigate / settingsTab(...)）、`ctx.theme.*`（mode / setMode / stack / variants / setVar）、`ctx.assetURL(rel)`、`ctx.dev`（是否链接模式）、`ctx.revision`、`ctx.reload()`、`ctx.onDispose(fn)`、`ctx.log(...)`。

---

## 四、Python 后端 `plugin.py`

```python
def setup(ctx):
    @ctx.route('/notes', method='GET')          # GET 路由可声明 (body, query) 两个参数
    def notes(body, query):
        return ctx.storage.get('notes', [])[: int(query.get('limit', 50))]

    @ctx.route('/slow', timeout=600)            # 单次请求预算，默认 30 秒，最长 3600
    def slow(body): ...

    @ctx.route('/start')                        # 更长的工作交给后台任务
    def start(body):
        def work(task, n):
            for i in range(n):
                if task.cancelled(): return None
                task.report((i + 1) / n, '第 %d 步' % (i + 1))
            return {'done': n}
        return {'id': ctx.tasks.spawn(work, 20, name='演示').id}

    @ctx.route('/report', method='GET')         # 不只是 JSON：HTML / SVG / CSV / 任意文件
    def report(body):
        return ctx.response('<h1>hi</h1>', 'text/html; charset=utf-8', headers={'X-Mine': '1'})

    @ctx.route('/download', method='GET')
    def download(body):
        return ctx.file(ctx.plugin_dir / 'mio.extension.json', download=True)

    @ctx.provider({...})                        # 新的图片生成渠道（见下）
    def render(request, cancel): ...

    @ctx.filter('render.before')                # 管线钩子：assemble.before / prepare.after / render.before / render.after / page.retry / publish.before / export.before / import.after
    def tweak(payload, context): ...

    @ctx.on('page.published')                   # 事件：任意名字
    def on_page(payload, meta): ...

    @ctx.exporter({'id': 'cbz', 'label': 'CBZ', 'extension': 'cbz', 'mime': '...', 'scope': 'album'})
    def export(album, context): return {'filename': ..., 'mime': ..., 'path': 'tmp/x.cbz'}

    @ctx.importer({'id': 'zip', 'label': '…', 'accepts': ['.zip'], 'scope': 'album'})
    def import_(payload, context): return {'kind': 'albums', 'document': {...}, 'assets': {...}}
```

宿主回调 `ctx.host.*`：

| 命名空间 | 方法 |
|---|---|
| `albums` | `list(project_id)` `get(id)` `update(id, patch)` `page(id, index)` `create(document)` |
| `library` | `kinds()` `list(kind)` `get(kind, id)` `put(kind, document, expected=None, create=False)` `create(kind, document)` `delete(kind, id, expected=None)` —— 可写入 albums / storyboards / characters / scenes / collections / layouts / plans / workflows / rows / conversations |
| `images` | `read(url)` `store(raw, name)` `path(url)` `generate(prompt, **options)`（走当前生成渠道） |
| `llm` | `chat(prompt, **options)` |
| `settings` | `get(name)`（密钥字段打码） |
| `channels` | `list()` |
| `events` | `emit(name, payload)` |
| `extensions` | `list()` `call(id, method, path, body)` |
| `workspace` | `path()` |
| `queue` | `list()` |
| `notify(message, level)` | 在界面弹出提示 |

其他：`ctx.data.config / workspace / cache / tmp`（与前端同一份数据）、`ctx.data.path(tier, relative)`、`ctx.settings()`、`ctx.query()`、`ctx.plugin_dir`、`ctx.data_dir`、`ctx.log()`、`ctx.sdk == 3`。

进程模型：每个启用的后端扩展一个子进程，请求在线程池里并行，崩溃或超时只影响它自己。清单里的 `requirements` 装到 `<数据目录>/extensions/<id>/site-packages`，通过 `MIO_EXT_SITE` 注入 `sys.path`，与宿主环境互不干扰。

---

## 五、热重载与调试

- 链接文件夹后，后端每 2.5 秒比对一次文件时间戳；有变化就：重读清单 → 重启 Python 进程 → 前端按新 revision 重新 `import()` → 重新执行 `setup`。旧实例的所有注册项先被清理。
- 每张扩展卡片都有"重新加载"按钮；`ctx.reload()` 也可以。
- 扩展中心底部的**平台能力总览**实时列出：所有插槽/锚点的项数、挂载数、被补丁的函数及其层、过滤器、快捷键、注入的样式、发布的 API。
- 加载失败会显示在卡片与"加载诊断"里；`MioPlatform.failures` 保留最近 80 条运行时错误。
- 浏览器控制台里：`Mio.extensions.platform.describe()`、`Mio.extensions.context('id')`（拿到任意扩展的 ctx）、`Mio.extensions.state`。

---

## 六、图片生成渠道（provider）

```python
@ctx.provider({
    'id': 'my-channel', 'label': '我的渠道', 'kind': 'image',
    'fields': [{'key': 'apiKey', 'label': 'API Key', 'type': 'password', 'secret': True}],
    'defaults': {'model': 'x'},
    'capabilities': {'images': True, 'negative': True, 'seed': True, 'size': True, 'credentials': 'key', 'check': True},
}, check=lambda request: {'ok': True}, models=lambda request: [...])
def generate(request, cancel):
    # request: prompt / negative / images / frame(width,height,steps,cfg,seed) / config(用户填写的 fields) / task
    # cancel.wait(seconds) 协作取消
    return {'images': [{'path': 'tmp/out.png'}], 'meta': {...}}
```

渠道出现在"服务与保存"的渠道列表里，与内置 ComfyUI / NovelAI / OpenAI 兼容并列。

---

## 七、示例

- `examples/extensions/scene-notebook/` —— 最小可用扩展：一个路由、一个面板、一个工具栏按钮、一个顶栏锚点、一种变量类型。
- `examples/extensions/studio-kit/` —— 平台能力总览：渠道、钩子、事件、导出/导入、全部插槽、锚点、挂载、补丁、过滤器、快捷键、样式变量、设置页、后台任务、原始响应、跨扩展 API。
- `examples/themes/paper-atelier/` —— v3 主题包（见 [样式工坊与主题包](STYLE_STUDIO.md)）。

把示例文件夹**链接**进来是最快的学习方式：改一行，看变化。

可执行变量见 [可执行变量指南](COMPUTED_VARIABLES.md)。
