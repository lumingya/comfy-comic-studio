# Mio · 绘页

从一个故事，到一部条漫。本地优先：剧本、设定集、ComfyUI 出图、条漫画布与导出都在你自己的电脑上完成。

> 项目正按[路线图](docs/ROADMAP.md)重建（条漫 + 本地 ComfyUI + React）。开发者和 AI 代理请先读 [AGENTS.md](AGENTS.md)。

## 目录

| 路径 | 内容 |
|---|---|
| `server/` | 新后端：FastAPI + Pydantic + SQLite（领域模型、任务引擎、ComfyUI 模块、出图管线、HTTP API） |
| `web/` | 新前端：Vite + React + TypeScript |
| `clients/` | 开放 API v2 的 Python 客户端与 AstrBot 插件，见 [clients/README.md](clients/README.md) |
| `tools/` | 发布打包与签名密钥工具 |
| `data/` | 随包默认数据与旧版工作区；新版的「导入旧数据」从这里读取 |
| `next/` | Phase 0.5 技术验证（Spike） |
| `legacy/` | 旧版 3.2（功能已冻结，只作参考），用法见 [legacy/README.md](legacy/README.md) |
| `docs/` | 路线图 |

## 启动新版

**用发布包**：从 [Releases](https://github.com/lumingya/comfy-comic-studio/releases) 下载 `mio-studio-<版本>.zip` 并解压，双击 `start.bat`（Windows）或运行 `./start.sh`（macOS / Linux）。只需要 Python 3.11+。第一次启动会在程序目录建 `.venv` 并安装依赖，然后打开 http://127.0.0.1:8788 。

**从源码**：需要 Python 3.11+ 与 Node.js 20+。

```bash
npm ci --prefix web
npm --prefix web run build
./start.sh                    # Windows：start.bat；或手动：
# python -m pip install -r server/requirements.txt && cd server && python -m mio_server
```

开发时另开一个终端运行 `npm --prefix web run dev`（Vite 把 `/api` 与 WebSocket 代理到 8788）。
新版的运行数据默认在 `server/data/runtime/v3`（`--data` 或环境变量 `MIO_V3_DATA` 可改）。
本地界面的 `/api` 不需要登录，所以服务端会拒绝别的网站发来的写请求和陌生主机名（防 CSRF 与 DNS 重绑定）。用 `--host 0.0.0.0` 在局域网里访问时，按 IP 打开即可；要用主机名访问，把它加进环境变量 `MIO_ALLOWED_HOSTS`（逗号分隔）。
启动脚本的参数会传给服务端，例如 `start.bat --port 8790`。`start.bat --check` 只检查依赖并组装一遍应用，不启动服务，排查启动问题时可以先跑它。依赖缺失或安装失败时，脚本会停下并说明原因。

## 更新

「设置 → 更新」可以检查新版本。更新包下载后，程序会先校验 Ed25519 签名和 sha256，通过后暂存起来，下次用 `start.bat` / `start.sh` 启动时自动安装。安装时 `server/data`、`data/` 和 `.venv` 保持不变；安装失败会自动回滚。git 检出的开发目录不会自动更新，请用 `git pull`。

## 扩展与开放 API

- 扩展（主题、画册模板、拟声字预设、钩子、后端路由、界面面板）：见 [扩展 SDK](server/mio_server/extensions/README.md)。
- 开放 API v2、令牌、Webhook、Python 客户端与 AstrBot 插件：见 [clients/README.md](clients/README.md)。

## 旧版

旧版仍可运行：在 `legacy/` 目录执行 `python server.py`，或双击 `legacy/start.bat`（端口 8777）。
工作区仍是仓库根目录的 `data/`，也可以用 `MIO_DATA_DIR` 指定。快照标签：`legacy-v3.2`。

[MIT License](LICENSE)
