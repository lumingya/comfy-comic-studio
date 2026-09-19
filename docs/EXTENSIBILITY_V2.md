# 自由定制：样式工作台与扩展 SDK 2

本轮基于 `50fbeca582e2571bce654ea42821ded22d26ea5f`，为早期开发项目增加真正可用的定制入口与扩展宿主。没有迁移到新框架，也没有把已有创作、生产、阅读系统替换为演示页面。

## 不会编程也能使用

### 1. 改变外观

进入 **工作室设置 → 主题 → 样式工作台**（主题页的「样式工作台」按钮）。

- 左侧选择颜色，或点击「纸页配色」「深海配色」。
- 界面字体可以填 `"Microsoft YaHei", sans-serif`。
- 侧栏宽度可填 `240px`；控件圆角可填 `12px`。留空跟随主题。
- 点击「新建 CSS 片段」后，可以粘贴别人提供的 CSS。确认其来源可信。
- 每段 CSS 有独立名称、启用开关、顺序和工作区范围。后面的样式按正常 CSS 级联规则参与覆盖，不保证胜过前面更高优先级或带 `!important` 的规则。
- 编辑只改变草稿，不会立即改坏正在使用的界面。
- 勾选信任说明，点击「试用 30 秒」。时间到自动恢复，**不会自动保存**。按 Esc 可提前恢复。
- 满意后勾选「启用已保存的自定义样式」，再点击「保存设置」。

**保存且启用的样式会在下次启动时生效。**「仅停用样式」保留源码；不会停用另行安装的主题。主题可在主题页切换到官方。

### 2. 撤销与迁移

- 「重新读取已保存」放弃当前草稿，读取服务端保存版本。
- 「恢复浏览器草稿」找回本浏览器自动留存的未保存编辑；浏览器草稿不是可靠备份。
- 「历史版本」保留最近 10 次保存前的状态。载入历史只改草稿，需要再次保存才能生效。
- 「导出草稿」输出 `.mio-style.json`。可在另一台设备的样式工作台导入。
- 导入 `.css` 会新增一个片段；导入 JSON 会在确认后替换整个草稿。导入本身不会执行 CSS。
- 如果另一窗口已经保存更新，本窗口保存会拒绝覆盖。先导出草稿，再重新读取或导入合并。

### 3. 扩展不再只是弹窗

在 **设置 → 扩展中心** 安装可信的 ZIP 或公开 HTTPS Git 仓库。

随附示例 `examples/extensions/studio-toolkit/` 提供：

- 独立「创作工具箱」工作区；
- 本机保存的创作便签；
- 「统计当前企划分镜」命令；
- 创作工坊底部提示插槽；
- `Ctrl / ⌘ + Shift + Y` 打开工作区；
- 一个装配请求前的标题处理钩子。

程序顶部「扩展命令」或 `Ctrl / ⌘ + Shift + P` 可搜索所有已注册命令。单个扩展支持「重新加载」，无需刷新整个网页。停用会清理 SDK 注册的 UI、CSS、事件和定时器；数据保留。

## 界面出问题时

1. 在网址末尾添加 `?safe_mode=1` 后打开，例如 `http://127.0.0.1:8777/?safe_mode=1`。
2. 本次访问不加载第三方主题、自定义 CSS 和前端扩展。
3. 点击安全恢复控件，一次停用主题、自定义样式和扩展。源码、历史和扩展数据不删除。
4. 移除网址参数，回到正常界面后分别检查。

**URL 安全模式只隔离前端启动。** Python 扩展可能已经随服务启动执行。后端异常需关闭服务，以 `MIO_SAFE_MODE=1` 环境变量重启，再停用扩展。可信代码和完整 CSS 都不是沙箱：不要安装来历不明的包。

## 样式架构

加载顺序为内置样式、扩展/主题样式、自定义设计变量与按顺序启用的 CSS 片段。CSS 仍遵循浏览器正常的来源、选择器优先级、层与 `!important` 规则。

### 公开选择器

| 选择器 | 含义 |
| --- | --- |
| `[data-mio-part="sidebar"]` | 应用侧栏 |
| `[data-mio-part="topbar"]` | 顶栏 |
| `[data-mio-part="workspace"]` | 主工作区 |
| `[data-mio-part="statusbar"]` | 状态栏 |
| `[data-mio-part="dialog"]` | 主对话框 |
| `[data-mio-part="style-workbench"]` | 样式工作台 |
| `html[data-workspace="creation"]` | 当前是创作工坊 |
| `[data-mio-slot="workspace.after"]` | 扩展插槽根节点 |
| `[data-extension-owner="studio-toolkit"]` | 指定扩展拥有的 UI |

内置工作区名：`home`、`gallery`、`creation`、`queue`、`workflow`、`stories`、`settings`、`logs`、`laboratory`、`marketplace`。其中一些工作区是否显示取决于原有可选功能开关；`stories` 是原索引 4 的写作工作区。扩展工作区名为 `<扩展ID>:<工作区ID>`。

工作区范围是**整个样式表的启用条件**，不是选择器隔离：匹配时，CSS 仍能影响整个页面，包括侧栏、弹窗等。要更细地限定位置，使用上述选择器。

设计变量经 CSSOM 序列化后写入 `:root:root`，带 `!important`；这使可视化设置能覆盖一般主题变量，而不会把输入拼接为任意新 CSS 规则。需要更复杂的级联时，留空对应变量，直接使用 CSS 片段。

### 两种主题包策略

旧的 `.css` 主题导入与缺省 ZIP 策略是 `local`：仅包内资源，保留原有校验。**不受限 CSS 请导入样式工作台，或使用 `trusted` 主题包。**

```json
{
  "id": "my-atelier",
  "name": "我的自由主题",
  "version": "1.0.0",
  "apiVersion": 2,
  "css": "styles/main.css",
  "cssPolicy": "trusted"
}
```

`trusted` 样式通过真实的 `/theme-assets/<id>/styles/main.css` URL 加载。因此 `@import`、字体和图片相对路径按目录正常解析，无需正则替换 CSS。可使用远程资源、转义、媒体查询、动画等浏览器支持的语法。包内资源端点仅允许 CSS、图片和字体，拒绝路径穿越、符号链接和非公开文件类型。SVG 文档响应使用 CSP sandbox。

完整示例：`examples/themes/unrestricted-atelier/`；本示例使用包内 `@import`，不访问外网。

样式工作台的 CSS 是内联样式，相对 URL 相对于应用页面，而非导入文件原目录。**携带多个相对资源时，请使用 ZIP 主题包。**

### 保存格式

`data/ecosystem/customization.json` 包含当前文档、递增 revision 与历史。文档版本为 1（与扩展 API 版本不同）：

```json
{
  "version": 1,
  "enabled": true,
  "tokens": { "--accent": "#93c7a8", "--nav-width": "240px" },
  "snippets": [
    { "id": "roomy", "name": "宽松编辑", "enabled": true,
      "scope": "workspace:creation",
      "css": ".workshop-prompt { min-height: 280px; }" }
  ]
}
```

最多 64 个片段、100 个变量，整个文档 UTF-8 JSON 最大 128 KiB；保留 10 个历史版本。限制用于控制本地存储体积，不限制 CSS 选择器与语法能力。完整主题资源另有原有 ZIP / 资源体积限制。

## SDK 2 开发约定

### 包入口

根目录 `mio.extension.json` 与 `index.js`：

```json
{"id":"my-tools","name":"我的工具","version":"1.0.0","apiVersion":2}
```

```js
export default function setup(ctx) {
  ctx.commands.register({
    id: 'hello', label: '你好', shortcut: 'mod+shift+h', toolbar: true,
    run: () => ctx.toast('扩展已接入真实工作区')
  });
  // 可以返回同步或异步清理函数。
  return () => console.log('扩展已停用');
}
```

注册 ID 使用小写字母开头的小写字母、数字、短横线和下划线，最多 64 字符。宿主自动加扩展前缀，同一命名空间重复注册会报错。

### 能力表

所有 register/on 返回可重复调用的注销函数；停用自动调用未注销资源的清理函数。

| API | 功能 |
| --- | --- |
| `ctx.commands.register({id,label,run,shortcut?,toolbar?,when?,order?})` | 命令、快捷键、条件和工具栏入口 |
| `ctx.commands.execute('owner:command', ...args)` | 执行已注册命令，返回 Promise |
| `ctx.commands.list()` | 公开命令描述列表 |
| `ctx.toolbar.register({id,label,run})` | 快捷的工具栏命令注册 |
| `ctx.panels.register({id,title,render})` | 扩展弹窗 |
| `ctx.workspaces.register({id,title,render,order?})` | 侧栏一级工作区 |
| `ctx.workspaces.open('local-id')` | 打开本扩展的工作区 |
| `ctx.slots.register({id,slot,render,when?,order?})` | 给内置页面插入 DOM |
| `ctx.styles.add(css, {media?})` | 注册自动卸载的全局 CSS |
| `ctx.on(event,handler,{priority?})` | 多监听器、排序、可注销事件 |
| `ctx.events.emit(name,data)` | 发出 `plugin:<owner>:<name>` 自定义事件 |
| `ctx.variables.registerType(name,{label,normalize})` | 自定义同步 JSON 变量类型 |
| `ctx.dom.listen(target,event,handler,options?)` | 自动清理 DOM 监听器 |
| `ctx.timers.interval(fn,ms)` / `timeout(fn,ms)` | 自动清理的定时器 |
| `ctx.dispose(fn)` | 注册额外清理工作 |
| `ctx.signal` | 扩展停用时触发的 AbortSignal |
| `ctx.storage.get/set/delete` | 原子、按扩展 ID 隔离的服务端 JSON 存储 |
| `ctx.api('/path', body?)` | 本扩展 Python 后端路由（GET / POST） |
| `ctx.assetURL('assets/x.png')` | 带安装 revision 的资源 URL |
| `ctx.getAlbum()` | 当前源画册的副本 |
| `ctx.toast(text)` | 带扩展来源标记的提示 |

快捷键格式按顺序使用 `mod+alt+shift+字母或数字`，修饰键可省略。`mod` 表示 Ctrl 或 Command。`mod+shift+p` 是宿主保留键。已注册扩展之间不允许重复快捷键；与浏览器或原应用其他快捷键冲突时可能无法生效。普通扩展快捷键不在输入框、可编辑内容、对话框或 IME 输入时触发，命令面板快捷键除外。

### 应用 API

- `ctx.app.getContext()`：工作区、当前企划、分镜、源画册 ID。
- `ctx.app.navigate('creation')`：导航到内置工作区。
- `ctx.app.getStories()` / `getPresets()`：当前企划资源的深副本，不是可直接保存的引用。
- `await ctx.app.updateStory(id, draft => { draft.title = '新标题'; })`：更新分镜、调用原有保存队列并发出 `story:changed`。更新器可返回一个新的分镜对象；必须保持 ID、标题和 frames 数组。该 API 没有独立事务撤销，扩展应在破坏性修改前请求确认。
- `ctx.app.runAction(name, data)`：接入现有应用命令。命令名称沿用内部动作表，不保证像 SDK 注册接口那样稳定；受信任高级扩展的逃生口。
- `ctx.app.production(route, body?)`：调用现有生产 API。写入仍受服务端校验与计费确认字段约束。扩展必须明确征得用户同意，不应后台偷偷启动付费生成。

### 插槽与挂载生命周期

可用插槽：`sidebar.bottom`、`topbar.end`、`workspace.before`、`workspace.after`、`story.toolbar`、`settings.toolbar`。不存在目标区域时跳过，不伪造控件。

```js
ctx.slots.register({
  id: 'scene-info', slot: 'workspace.after',
  when: ({workspace}) => workspace === 'creation',
  render(root, mountCtx) {
    const button = document.createElement('button');
    button.textContent = '查看企划';
    button.addEventListener('click', () => ctx.toast(ctx.app.getContext().projectId),
      {signal: mountCtx.mountSignal});
    root.append(button);
    return () => { /* 释放本次挂载的第三方编辑器等资源 */ };
  }
});
```

`render(root, mountCtx)` 可以是异步函数，返回本次挂载的 disposer。`mountCtx` 包含常规 ctx 与 `mountSignal`。离开区域、替换弹窗、停用扩展会终止该信号；异步返回时应检查 `mountSignal.aborted`。异步 render 超时后才返回的 disposer 也会被补充执行。

插槽可能随内置界面重绘而重新挂载，不能把重要未保存数据只放在 DOM 中。**独立扩展工作区**在普通宿主重绘时保留 DOM，离开后清理；跨导航的草稿由扩展自行保存。

### 事件与流程拦截

| 事件 | 数据与行为 |
| --- | --- |
| `afterRender` | `{workspace}`；微任务通知，避免同步递归重绘 |
| `workspace:changed` | `{workspace}`；工作区改变时通知 |
| `story:changed` | `{id}`；SDK updateStory 成功后通知，不是所有原生编辑事件的全局广播 |
| `beforePrepare` / `afterPrepare` | 原可执行变量准备流程，before 阻断式、after 通知式 |
| `production:beforeRequest` | `{route, body, cancel:false}`；生产 API 写请求发出前，可修改 body、设置 cancel 或抛错 |
| `production:afterRequest` | `{route, data}`；成功写请求完成后的结果副本，不影响已提交请求 |
| `plugin:<扩展ID>:<名称>` | 扩展间自定义事件 |

同一事件可注册多个监听器，`priority` 小的先执行，相同值按注册顺序。before 钩子失败会阻止本次操作；通知式钩子失败记录诊断并继续其他监听器。生产钩子覆盖浏览器经 `productionRequest` 发起的写操作，**不等于每帧后台生成钩子**，也不覆盖直接由外部程序发起的 HTTP 请求。扩展关闭后后端队列仍按原机制执行已提交任务。

### 清理、失败与重载

- setup、回调默认有 15 秒异步等待预算；失败不会自动重试付费操作。
- 加载失败会回收已经注册的 SDK 资源；扩展中心可重新加载。
- 刷新/启用串行化；代码 revision 改变时卸载旧实例再加载。
- SDK 保存最近 100 条诊断，区分扩展来源与阶段。
- JavaScript 在同一主线程。同步死循环不能被 Promise 超时或 AbortSignal 抢占，必须使用安全启动恢复。
- AbortSignal 是合作式取消，不会撤回已提交的网络请求。扩展自己调用原生 DOM、定时器、网络 API、写全局变量的行为无法自动全部撤销，需在 disposer 中清理。
- 「重新加载」重新执行 setup；同 revision 的浏览器模块缓存仍然存在，顶层模块代码不保证再次执行。Git 更新会换 revision。ZIP 更新沿用原流程：停用 → 仅卸载代码 → 安装同 ID 新 ZIP，保留数据。
- Python 后端仍使用原 `plugin.py` 路由机制，详见 [主题与扩展](ECOSYSTEM_GUIDE.md)。这次没有引入插件依赖自动安装、私有 Git 凭据或远程市场审核机制。

## 开发与验证

```bash
npm ci
npx playwright install --with-deps chromium
node js/build.js dev
npm run lint
npm run test:extensibility
npm run test:current
python tools/check_distribution.py
python tools/package_project.py --output releases
```

新增模块：`js/extension-runtime.js`（独立内核）、`js/extension-host.js`（应用桥接）、`js/customization.js`（编辑与预览）、`backend/ecosystem/customization.py`（校验、版本和持久化）。新增测试：`tests/extension_runtime.mjs`、`tests/extensibility.mjs`、`tests/test_customization.py`。生成的 index.html 已包含这些模块，不需要普通用户再运行构建。
