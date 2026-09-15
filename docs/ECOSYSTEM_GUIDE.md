# 主题与扩展 SDK v1

本版本把界面主题、可信扩展和可执行变量分为独立模块。它允许深度自定义，而不是把第三方能力塞进几项硬编码开关。

## 先理解信任边界

**JavaScript 与 Python 扩展具有完全代码执行能力。** 可以读写本机文件、联网、访问应用数据或发起有费用的请求。SDK 的目录命名空间、Node vm、独立 Python 进程用于减少误操作及故障传播，不构成恶意代码沙箱。

只安装你审查过并信任的作者/版本。Git 安装、启用与更新都要求明确确认；更新后的代码保持停用，须再次确认启用。不要把本机服务无鉴权暴露到公网。

## 画册是源作品，历史是生成产物

创作区标题选择器只列当前工作区的源画册/草稿。分镜区直接提供“新增分镜、导入分镜、导出分镜、重命名、历史记录”，不再要求用户在共享模板和生成版本之间猜测编辑目标。

每个源画册持有自己的分镜副本。生成快照不会混入源选择器；历史与准备记录从生成队列或历史弹窗查看。生成后再编辑源稿，不回写旧生成任务。

导出分镜包含本册的有效分镜覆盖，而不是漏掉本册改动的公共模板。公共变量预设仍独立维护，应用时复制，后续互不联动。

## 全局主题

设置 → 外观与主题，支持点击选择或拖入 `.css` / `.zip`，确认后安装，点击“使用主题”立即生效，不需要重启。可以覆盖全局选择器、网格、排版、字体、动效、侧栏与布局。

单个 CSS 会获得独立 ID。ZIP 根目录格式：

```text
mio.theme.json
style.css
fonts/local.woff2
textures/paper.png
```

```json
{"id":"my-paper","name":"我的纸间","version":"1.0.0","apiVersion":1,"css":"style.css"}
```

```css
@font-face { font-family: Local; src: url('fonts/local.woff2'); }
:root { --bg: #f4eee2; --text: #3a3327; --accent: #876241; }
body { background-image: url('textures/paper.png'); }
```

支持本地 PNG/JPEG/WebP、WOFF/WOFF2/TTF/OTF；安装时内联为 data URI。禁止远程 URL、@import、CSS 转义和 image-set/src 等非标准资产入口，避免隐式网络取资源；这不是对 CSS 界面欺骗的防护。包内路径不能越界或经过符号链接。

随附示例：`examples/themes/orbital-night.css` 改成横向导航；`examples/themes/paper-atelier/` 演示材质包。将目录内容打包成 ZIP 后即可导入。不要把第三方字体随意再分发，请检查许可证。

## 界面坏了如何恢复

1. 地址添加 `?safe_mode=1`，然后重新打开。
2. 或在当前页面中按住 Shift 刷新；脚本通过键盘/卸载事件记住下次安全启动。浏览器/系统快捷键拦截情况下，请优先使用明确的 URL。
3. 安全页面不加载第三方 CSS 和前端扩展，显示独立恢复控件。点击“一键重置主题并停用扩展”，保留代码与用户数据。
4. 回到设置可以分别卸载主题/扩展，移除参数后恢复正常启动。

**URL 安全模式不会倒退撤销已经运行的 Python 代码。** 后端受影响时，关闭服务，使用环境变量 `MIO_SAFE_MODE=1` 启动；这将跳过 Python 扩展启动并禁止安装/启用。完成重置后可移除环境变量。运行中的恶意代码造成的操作无法由安全模式撤销。

## Git 与 ZIP 安装

设置 → 扩展中心 → 通过 Git 安装：填写公开 HTTPS Git 仓库 URL，可选分支；不要求 Token 或手填本机路径。需要 PATH 中的 Git。暂不支持私有仓库凭据、SSH、子模块或包安装脚本。

ZIP 使用同一校验与安装流程。包最大 32 MiB，解压最大 128 MiB/2048 项；禁止越界、符号链接、ZIP 中的 .git 和同名路径。最多安装 32 个扩展、32 个主题。

安装目录：

```text
<程序目录>/extensions/<扩展ID>/       # 代码、manifest、前端资源
<data目录>/extensions/<扩展ID>/      # 用户配置、笔记、缓存
<data目录>/ecosystem/                # 管理注册表和主题选择
```

更新先拉到临时目录，验证 ID 和 manifest，再替换代码；不复制或覆盖用户数据。网络或校验失败保留旧代码。禁用不删除数据；卸载默认只删代码，可显式勾选删除数据。ZIP 更新可先仅卸载代码，再装新 ZIP，保持相同 ID 继承数据。

## 最小前端扩展

`mio.extension.json`：

```json
{"id":"scene-notebook","name":"场记本","version":"1.0.0","apiVersion":1}
```

`index.js`：

```js
export default async function setup(ctx) {
  ctx.toolbar.register({
    id: 'note', label: '记一笔', icon: 'edit',
    run: async () => {
      await ctx.storage.set('last-album', ctx.getAlbum());
      ctx.toast('已保存');
    }
  });
  ctx.panels.register({
    id: 'notes', title: '笔记',
    render: async root => {
      const p = document.createElement('p');
      p.textContent = JSON.stringify(await ctx.storage.get('last-album'));
      root.append(p);
    }
  });
  ctx.variables.registerType('palette', {
    label: '配色词', normalize: value => String(value).trim()
  });
  ctx.on('beforePrepare', album => { /* 受信任的准备前钩子 */ });
  return () => { /* 解除自己注册的 DOM 事件、定时器等 */ };
}
```

SDK 会自动清理自己注册表中的工具栏、面板、自定义类型和钩子；扩展自己添加的 DOM/全局事件/定时器须由 disposer 清理。前端 JS 与应用同线程，死循环无法由宿主超时抢占；此时使用 URL 安全恢复。

| 能力 | 约定 |
| --- | --- |
| `ctx.id`, `ctx.apiVersion` | 安装 ID 与接口版本 |
| `ctx.getAlbum()` | 当前源画册的副本，不能靠原地修改它保存 |
| `ctx.storage.get/set/delete` | Promise，键名限英数下划线和短横线，最长 100 字符 |
| `ctx.api('/route', body?)` | 省略 body 为 GET，提供 body 为 POST；只指向本扩展命名空间 |
| `ctx.assetURL('assets/x.png')` | 带代码 revision 的本地资源地址 |
| `ctx.toolbar.register` | 工具栏动作；本地 action ID 自动加扩展前缀 |
| `ctx.panels.register` | 面板容器，由 render(root) 自行构造 DOM |
| `ctx.variables.registerType` | 自定义类型存为 `plugin:<id>:<name>`，normalize 必须返回可序列化的同步值 |
| `ctx.on` | beforePrepare、afterPrepare、afterRender；同一扩展每个事件一个回调 |

扩展 ID、action ID 和类型名使用小写字母开头，只允许小写字母、数字、短横线和下划线，最多 64 字符。重复注册直接报错，不覆盖其他包。未启用对应扩展时，自定义类型不能静默退化执行。

## 可选 Python 后端

同目录 `plugin.py`，无需修改 server.py：

```python
def setup(ctx):
    @ctx.route('/health', method='GET')
    def health(query):
        return {'ok': True, 'prefs': ctx.storage.get('prefs', {})}

    @ctx.route('/prefs', method='POST')
    def prefs(body):
        return ctx.storage.set('prefs', body)

def on_load(ctx):
    ctx.log('loaded')

def on_unload(ctx):
    ctx.log('unloaded')
```

前端 `ctx.api('/health')` 对应 `/api/extensions/<id>/health`，宿主避免不同扩展的路由冲突。`/storage` 为保留的 SDK 路由。处理器同步执行并返回 JSON；异常以错误返回，不重试。

每个后端扩展独立进程，单次启动/请求预算 15 秒，失败或超时可单独停用。POSIX 会终止进程组；Windows 仅保证父进程终止，扩展作者须自行清理派生服务。自定义网络请求应设置短于宿主预算的超时，且自行处理幂等性。

`ctx.storage` 使用原子替换和命名空间锁（线程锁加 OS 文件锁）。单值最大 2 MiB，每扩展 32 MiB；禁止路径穿越和符号链接。单次 get/set 各自原子，**get 后 set 组合并非事务**：需要读改写事务时，应使用单一后端处理器串行写入，避免前端和后端同时修改同一个聚合键。

独立进程包含崩溃，但不限制可信 Python 对操作系统、网络或其他目录的直接访问。

## 可运行示例与验证

`examples/extensions/scene-notebook/` 包括 manifest、前端面板、自定义配色词类型、后端笔记路由和独立保存。把其中三个源码文件放在 ZIP 根目录即可安装。

可执行变量见 [可执行变量指南](COMPUTED_VARIABLES.html)。相关自动化入口：

```text
python -m unittest tests.test_ecosystem -v
node tests/ecosystem.mjs
npm run lint
npm run test:contracts
```

自动化使用自有夹具/模拟提供商，不调用真实付费模型。Git 参数校验和安装更新路径可离线测试；实际公共仓库网络连接仍取决于本机网络、证书和远端可用性。
