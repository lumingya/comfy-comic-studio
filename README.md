# Mio · 绘页

从一个故事，到一部漫画。Mio 是同时支持云端与本地生图的便捷式漫画和本子创作工具：作品与素材本地保存，按需选择 ComfyUI 或云端渠道，完成分镜、出图、挑图、留白排版与导出。

日常创作以复用分镜模板和角色预设为主，手工编辑优先，明确点击后才开始生成。条漫、画册与双页阅读使用同一份作品的不同呈现模板；专业能力通过开放 API 和可选扩展使用，主界面保持简洁与留白。

> 项目处于早期阶段，方向与待办见[路线图](docs/ROADMAP.md)。开发者和 AI 代理请先读 [AGENTS.md](AGENTS.md)。

## 目录

| 路径 | 内容 |
|---|---|
| `server/` | 后端：FastAPI + Pydantic + SQLite（领域模型、任务引擎、ComfyUI 模块、出图管线、HTTP API） |
| `web/` | 前端：Vite + React + TypeScript |
| `clients/` | 开放 API v2 的 Python 客户端与 AstrBot 插件，见 [clients/README.md](clients/README.md) |
| `tools/` | 发布打包与签名密钥工具 |
| `data/` | 随包示例数据：首次启动时把示例画册、分镜与预设载入工作区 |
| `next/` | 技术验证（Spike）：ComfyUI 绑定、结构化剧本与效果基准的原型 |
| `docs/` | 路线图 |

## 启动

**用发布包**：从 [Releases](https://github.com/lumingya/comfy-comic-studio/releases) 下载 `mio-studio-<版本>.zip` 并解压，双击 `start.bat`（Windows）或运行 `./start.sh`（macOS / Linux）。只需要 Python 3.11+。第一次启动会在程序目录建 `.venv` 并安装依赖，然后打开 http://127.0.0.1:8788 。

**从源码**：需要 Python 3.11+ 与 Node.js 20+。

```bash
npm ci --prefix web
npm --prefix web run build
./start.sh                    # Windows：start.bat；或手动：
# python -m pip install -r server/requirements.txt && cd server && python -m mio_server
```

开发时另开一个终端运行 `npm --prefix web run dev`（Vite 把 `/api` 与 WebSocket 代理到 8788）。
运行数据默认在 `server/data/runtime/v3`（`--data` 或环境变量 `MIO_V3_DATA` 可改）。
本地界面的 `/api` 不需要登录，所以服务端会拒绝别的网站发来的写请求和陌生主机名（防 CSRF 与 DNS 重绑定）。用 `--host 0.0.0.0` 在局域网里访问时，按 IP 打开即可；要用主机名访问，把它加进环境变量 `MIO_ALLOWED_HOSTS`（逗号分隔）。
启动脚本的参数会传给服务端，例如 `start.bat --port 8790`。`start.bat --check` 只检查依赖并组装一遍应用，不启动服务，排查启动问题时可以先跑它。依赖缺失或安装失败时，脚本会停下并说明原因。

## 使用教程

启动后打开 **http://127.0.0.1:8788/manual/**，或从界面「帮助 / 使用教程」进入。
[中文教程中心](server/mio_server/manual/index.html)与[英文教程中心](server/mio_server/manual/en.html)随服务器一起发布，离线可用。首页保留书册插画、指南卡片与目录搜索，具体操作在独立章节中阅读。

- 基本链路：**分镜 → 选用预设（可选）→ 选择工作流或云端服务 → 检查本次提示词与生成参数 → 开始生成 → 挑图 → 阅读 / 导出**。
- 装配前按分幕检查正负提示词和台词，查看变量来源与缺失位置；本次补值只写入新画册。多个预设按显示的选择顺序合并，后面的同名值优先。
- 导入工作流后检查映射与依赖，再用「试生成一张」确认实际可用。参数映射可按节点编号、标题或输入名搜索，并支持自定义参数和多个目标。ComfyUI 画布文件需要先导出为 API 格式；依赖浏览器脚本或特殊协议的插件仍需单独适配。
- 新建生成任务时直接选择本地工作流或云端服务，无需另建出图方案；多个工作流串联保留在「高级出图方案」。套装带来的方案可以暂不绑定服务；生成前须明确选择服务。
- 每幕张数、宽高在新建任务时设置，并按工作流记住最近一次使用值。尺寸留空保留工作流原值；已创建任务保存自己的参数和工作流快照。预设统一保存变量；在分镜正向或负向提示词中显式引用，例如自定义「负向词」变量后填写 `{负向词}`。预览显示最终发送内容。
- 创作套装保留作品的每幕张数和尺寸，重新装配时优先使用套装值，也可在新任务中修改；不携带服务密钥。
- 编辑工坊模板不会追改已经装配的画册；重跑已有分幕得到候选，需要明确采用才会替换阅读图。
- 画册菜单统一从「导出」选择 HTML、PDF、图片、可编辑源文件或创作套装；多选画册后也可从同一入口导出。
- 分镜工坊可保存「创作存档」；整个工作区可在「设置 → 数据与备份」中备份、预检并安排下次启动恢复，详见[备份与恢复](docs/WORKSPACE_BACKUPS.md)。
- 真实出图需要可用的 ComfyUI 或云端服务，云端可能计费。

## 更新

「设置 → 关于与更新」可以检查新版本。更新包下载后，程序会先校验 Ed25519 签名和 sha256，通过后暂存起来，下次用 `start.bat` / `start.sh` 启动时自动安装。安装时 `server/data`、`data/` 和 `.venv` 保持不变；安装失败会自动回滚。git 检出的开发目录不会自动更新，请用 `git pull`。

## 扩展与开放 API

- 扩展（主题、画册模板、拟声字预设、钩子、后端路由、界面面板）：见 [扩展 SDK](server/mio_server/extensions/README.md) 与[可选质检示例](examples/extensions/qa-review/README.md)。
- 开放 API v2、令牌、Webhook、Python 客户端与 AstrBot 插件：见 [clients/README.md](clients/README.md)。
- 可复用创作、恢复备份和扩展实际调用点的验证范围：见[验收索引](docs/EXTENSIBILITY_ACCEPTANCE.md)。

[MIT License](LICENSE)
