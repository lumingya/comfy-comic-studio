# Mio · 绘页

从一个故事，到一部条漫。本地优先：剧本、设定集、ComfyUI 出图、条漫画布与导出都在你自己的电脑上完成。

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
[中文手册源码](server/mio_server/manual/index.html)与[英文手册源码](server/mio_server/manual/en.html)随服务器一起发布，离线可用。

- 基本链路：**分镜 + 文本预设 → 装配画册快照 → 开始生成 → 采用候选 → 阅读 / 导出**。
- 导入工作流后，还要在出图配置里选择它；添加云端渠道后，还要在出图配置里启用。
- 编辑工坊模板不会追改已经装配的画册；重跑已有分幕得到候选，需要明确采用才会替换阅读图。
- 真实出图需要可用的 ComfyUI 或云端服务，云端可能计费。

## 更新

「设置 → 关于与更新」可以检查新版本。更新包下载后，程序会先校验 Ed25519 签名和 sha256，通过后暂存起来，下次用 `start.bat` / `start.sh` 启动时自动安装。安装时 `server/data`、`data/` 和 `.venv` 保持不变；安装失败会自动回滚。git 检出的开发目录不会自动更新，请用 `git pull`。

## 扩展与开放 API

- 扩展（主题、画册模板、拟声字预设、钩子、后端路由、界面面板）：见 [扩展 SDK](server/mio_server/extensions/README.md)。
- 开放 API v2、令牌、Webhook、Python 客户端与 AstrBot 插件：见 [clients/README.md](clients/README.md)。

[MIT License](LICENSE)
