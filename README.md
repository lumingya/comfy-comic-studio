# ComfyComic Studio

本地运行的连环画批量制作工作台。用原生 HTML/CSS/JavaScript 提供模板、角色矩阵、剧情、画廊和 ComfyUI 工作流界面，由一个只依赖 Python 标准库的本地服务负责配置与图片落盘。

**完全离线可用**：Tailwind 与 Lucide 图标随包分发在 `vendor/` 下，不请求任何 CDN；示例画面和降级占位图都在本地用 SVG 生成。断网、内网、CDN 被墙都不影响使用。

## 启动

环境要求：Python 3.10 或更高版本。没有任何第三方 Python 依赖，也不需要构建步骤。

在 Windows 上双击 `start.bat`，或在项目目录运行：

```powershell
python server.py
```

然后访问 <http://127.0.0.1:8777/index.html>。

想换端口就设 `COMFY_COMIC_PORT`：

```powershell
$env:COMFY_COMIC_PORT = "8899"; python server.py
```

ComfyUI 默认地址为 <http://127.0.0.1:8188>；如浏览器直接连接失败，请为 ComfyUI 启用 CORS（启动参数加 `--enable-cors-header`）。

**还没装 ComfyUI？** 在「ComfyUI 工作流 → 运行模式」里打开**模拟模式**，不连接任何外部服务就能把模板、角色矩阵、批量出图、画廊阅读整条流程跑一遍。

## 主要流程

1. 在「ComfyUI 工作流」中导入 API 格式 JSON，并选择积极提示词与输出节点。
2. 在「连环画模板配置」中维护分镜及 `{character}`、`{style}`、`{outfit}` 等变量。编辑会自动保存。
3. 在「批量角色矩阵」中填写替换值并选择模板。变量列可以随时新增、重命名、删除——重命名会同步改写所有模板里的占位符。
4. 可先在「LLM 剧情与模板」里写全局主线大纲、生成或调整剧情，再启动批量绘图。
5. 生成结果进入画廊，可搜索筛选、单页重绘、**补齐中断的分镜**，或导出自包含 HTML。

## 快捷操作

| 快捷键 | 作用 |
| --- | --- |
| `Ctrl` / `⌘` + `K` | 命令面板：搜索任意模板、画册、角色，或直接执行操作 |
| `Ctrl` / `⌘` + `S` | 保存当前模板 |
| `Alt` + `1`～`5` | 在五个主标签页之间跳转 |
| `Esc` | 关闭最上层的弹窗 |

任务中断或某几幕失败时，画廊卡片上会出现「补齐 N 幕」按钮，只重跑缺失和降级的分镜，已经画好的不会重画。

## 数据位置

- `data/*.json`：模板、工作流、LLM、聊天与界面配置。
- `images/`：从 ComfyUI 持久化的图片。
- `comfy_comic_data.json`：旧版单文件配置，仅用于首次迁移。

这些目录默认被 Git 忽略。命令面板里的「导出全部配置备份」会把 `data/` 的全部内容打成一个 JSON，换机器时配合拷贝 `images/` 即可迁移；「从备份文件恢复配置」是整体覆盖，会先让你确认影响范围。

备份文件内含 LLM API Key，请勿提交或分享。

## 目录结构

```
index.html          应用外壳
styles.css          自定义样式（Tailwind 之外的部分）
server.py           本地服务：配置落盘、图片持久化与内联
js/core.js          全局状态、通用工具、配置读写、启动引导
js/ui.js            提示、对话框、快捷键、命令面板
js/sync.js          磁盘持久化、保存队列、备份与恢复
js/templates.js     模板编辑器
js/matrix.js        角色矩阵与剧本编辑弹窗
js/workflow.js      ComfyUI 工作流导入与节点映射
js/gallery.js       画廊、阅读器、单页重绘、离线导出
js/batch.js         批量出图流水线与断点续画
js/story.js         LLM 剧情引擎与 XML 模板设计
js/chat.js          AI 聊天精修
js/comfy.js         ComfyUI 通信
js/llm.js           大模型请求与工具定义
vendor/             随包分发的 Tailwind 与 Lucide
```

`js/*.js` 是一组经典脚本，共享同一个全局词法作用域，加载顺序在 `index.html` 里有意义（`core.js` 必须最先）。

## 验证

```powershell
python -m unittest discover -s tests -v      # 服务端单元测试
node tests/smoke.mjs                          # 端到端冒烟（会自动拉起 server.py）
npx --yes eslint@8 js/*.js
npx --yes html-validate index.html
```

`tests/smoke.mjs` 需要 Playwright（`npm install`）。它会屏蔽所有 CDN 与外部图床后再跑，因此同时也是"离线可用"这条性质的回归测试。改动 `js/*.js` 的顶层声明后，跑一次 `python tools/sync_eslint_globals.py` 更新 ESLint 的跨文件 globals 列表。

## 安全边界

本地服务只监听 `127.0.0.1`。静态服务只公开应用外壳、`js/`、`vendor/` 下的前端资源（按扩展名白名单，且做了目录逃逸防护）以及 `images/` 中的图片；不会公开 `data/`、源码、Git 元数据或旧配置文件。图片代理限制单张 50 MB，只允许读取项目 `images/` 目录中的本地文件；LLM 请求默认 120 秒超时。

## License

MIT，见 [LICENSE](LICENSE)。
