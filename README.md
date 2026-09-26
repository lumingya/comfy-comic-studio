# Mio · 绘页

从一个故事，到一部条漫。本地优先：剧本、设定集、ComfyUI 出图、条漫画布与导出都在你自己的电脑上完成。

> 项目正按[路线图](docs/ROADMAP.md)重建（条漫 + 本地 ComfyUI + React）。开发者和 AI 代理请先读 [AGENTS.md](AGENTS.md)。

## 目录

| 路径 | 内容 |
|---|---|
| `server/` | 新后端：FastAPI + Pydantic + SQLite（领域模型、任务引擎、ComfyUI 模块、出图管线、HTTP API） |
| `web/` | 新前端：Vite + React + TypeScript |
| `data/` | 随包默认数据与旧版工作区；新版的「导入旧数据」从这里读取 |
| `next/` | Phase 0.5 技术验证（Spike） |
| `legacy/` | 旧版 3.2（功能已冻结，只作参考），用法见 [legacy/README.md](legacy/README.md) |
| `docs/` | 路线图 |

## 启动新版

需要 Python 3.11+ 与 Node.js 20+。

```bash
python -m pip install -r server/requirements.txt
npm ci --prefix web
npm --prefix web run build

cd server
python -m mio_server          # http://127.0.0.1:8788 ，同时托管 web/dist
```

开发时另开一个终端运行 `npm --prefix web run dev`（Vite 把 `/api` 与 WebSocket 代理到 8788）。
新版的运行数据默认在 `server/data/runtime/v3`（`--data` 或环境变量 `MIO_V3_DATA` 可改）。

## 旧版

旧版仍可运行：在 `legacy/` 目录执行 `python server.py`，或双击 `legacy/start.bat`（端口 8777）。
工作区仍是仓库根目录的 `data/`，也可以用 `MIO_DATA_DIR` 指定。快照标签：`legacy-v3.2`。

[MIT License](LICENSE)
