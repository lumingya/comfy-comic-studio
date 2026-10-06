# AGENTS.md：给 AI 代理的协作说明

> 新代理先读三份文档：本文件、[README](README.md)（产品与使用）、[路线图](docs/ROADMAP.md)（方向、架构与待办）。

## 项目现状

- **产品**：Mio · 绘页，本地优先的条漫工作室，从一个故事到一部作品。
- **代码**：后端在 `server/`（FastAPI），前端在 `web/`（React）。
- **阶段**：早期项目，不承诺向后兼容，允许根本性重构。改动不需要写迁移代码或兼容提示，除非任务明确要求。
- **界面原则**：基座保持精简。界面只放日常创作入口；修图、质检、成品档、批量变体、剧本助手、动态漫等专业能力只在后端和开放 API 里（见路线图 §2.2），不要擅自接回界面。

## 目录速览

| 路径 | 内容 |
|---|---|
| `server/` | 后端：FastAPI + Pydantic + SQLite。领域模型、任务引擎、ComfyUI 模块、出图管线、HTTP API（`/api` 本机界面用，`/api/v2` 带令牌的开放接口）、扩展、主题、画册导出、签名更新；`python -m mio_server` 启动（根目录 `start.bat` / `start.sh` 会建 `.venv`、装依赖并先安装已暂存的更新），存在 `web/dist` 时一并托管界面 |
| `web/` | 前端：Vite + React + TypeScript（TanStack Query、Zustand、i18next、Radix、react-konva、dnd-kit）。API 类型由 `npm --prefix web run gen:api` 从 OpenAPI 生成到 `web/src/api/schema.d.ts`，改了接口要重新生成并提交 |
| `clients/` | 开放 API v2 的 OpenAPI 快照、生成的 Python 客户端（`python clients/python/generate.py`，改了接口要重新生成并提交）与 AstrBot 插件；说明见 [clients/README.md](clients/README.md) |
| `data/` | 随包示例数据（清单见 `data/distribution.json`）：首次启动时把示例画册、分镜与预设载入工作区。本机运行时状态大多被 `.gitignore` 忽略 |
| `docs/` | 路线图 `ROADMAP.md` |
| `next/` | 技术验证（Spike），只用标准库；说明见 [next/README.md](next/README.md) |
| `tools/` | `build_release.py`（发布 zip + 签名清单 `mio-release.json`）、`release_keygen.py`（生成发布签名密钥；私钥只放仓库 Secret `MIO_RELEASE_KEY`，公钥写入 `server/mio_server/update/keys.py`） |
| `legacy/` | 早期原型，不再维护，不要在这里加功能。CI 仍运行它的测试，随包数据工具也在 `legacy/tools/` 下 |

## 验证命令（提交前必跑，都很轻）

```bash
python -m unittest discover -s server/tests -t server -q   # 后端单测，约 20 秒
ruff check server clients tools && ruff format --check server clients tools   # lint（行宽 100）
python clients/python/generate.py --check                  # 生成的 API v2 客户端与接口一致
python -m unittest discover -s next/tests -t next -q       # Spike（next/）单测，约 5 秒
python legacy/tools/check_distribution.py                  # 随包数据与清单一致（以 CI 的干净检出为准）
```

前端在 `web/` 下（先 `npm ci --prefix web`）：

```bash
npm --prefix web run format:check   # Prettier，行宽 100
npm --prefix web run typecheck      # tsc strict
npm --prefix web test               # Vitest + Testing Library（jsdom，不需要浏览器）
npm --prefix web run build          # 产物在 web/dist（不提交）
npm --prefix web run gen:api        # 接口变更后重新生成 API 类型（需要能 import fastapi 的 python）
```

- CI（`.github/workflows/ci.yml`）每次推送都跑上面这些门禁，外加 `legacy/` 的构建、测试和打包冒烟，**必须保持绿色**。
- **沙盒里禁止安装浏览器或跑 E2E**。
- 开发时：`python -m mio_server`（默认 8788）+ `npm --prefix web run dev`（Vite 把 `/api` 与 WebSocket 代理到 8788）。

## 提交规范

- **每完成一个小项，立刻提交并推送**：
  1. `git add <具体文件>`
  2. `git commit -m "feat|fix|docs|ci|chore: 做了什么"`
  3. `git push origin <当前分支>`
- 不要堆积未提交的改动，**不要用 `git add -A`**。
- 完成路线图里的待办时，同步更新 `docs/ROADMAP.md`。

## 数据与隐私（重要）

- **随包文件会被运行时改写**：本机运行会把状态写回 `data/` 下的随包文件。本机开发前先运行一次 `python legacy/tools/protect_local_data.py`（标记为 skip-worktree），避免个人状态被提交。
- **有意修改随包默认值时**：
  1. `python legacy/tools/protect_local_data.py --undo`
  2. 修改文件
  3. `python legacy/tools/build_distribution.py`
  4. 提交
  5. 重新保护
- **运行数据**默认在 `server/data/runtime/v3`，可用 `--data` 或环境变量 `MIO_V3_DATA` 放到仓库外。
- **测试夹具**只能复制随包数据（`server/tests/legacy_fixture.py` 的 `copy_shipped_legacy`），不要整目录复制 `data/`。
- **绝不提交**密钥、令牌、Cookie、会话抓包，也不要在对话或日志里回显它们。

## 运行环境备忘

- **沙盒（Linux）**：
  - 存储约 128 MB，容易 OOM；不要保存截图或大文件，临时文件用完即删。
  - 容器重启后先用 `git log -1` 对齐最新代码。
- **用户本机（Windows，经 Portal 连接）**：
  - PowerShell 5.1，嵌套引号容易出错；复杂命令先写成脚本文件再执行。
  - Portal 的环境设置了 `NoDefaultCurrentDirectoryInExePath=1`，调用当前目录的脚本要写成 `.\xxx.bat`。
  - 部分文件在工作区里是 CRLF（Git 提交时会归一为 LF）。修改已有文件优先用补丁方式，以保留换行风格。
- **本机 ComfyUI**：`127.0.0.1:8188`，RTX 4060 Laptop 8 GB。出图测试只用中性题材，不加载用户的 LoRA。
