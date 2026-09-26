# AGENTS.md：给 AI 代理的协作说明

> 新代理先读三份文档：本文件、[README](README.md)（产品与使用）、[路线图](docs/ROADMAP.md)（方向与任务勾选）。

## 项目现状

- **产品**：Mio · 绘页，本地优先的「从一个故事到一部作品」工作室。
- **新版**在 `server/`（FastAPI）与 `web/`（React）；**旧版**（3.2.0-dev.1）已移到 `legacy/`，功能冻结，只作参考。
- **方向**：按[路线图](docs/ROADMAP.md)转向「条漫 + 本地 ComfyUI + React」新架构。顺序是 Phase 0 止血 → Phase 0.5 技术验证（Spike）→ Phase 1 起重建。
- **旧版快照**：Git 标签 `legacy-v3.2`。`legacy/` 按路线图会在 Phase 2 完成标准里删除（需用户确认）。

## 目录速览

| 路径 | 内容 |
|---|---|
| `legacy/` | 旧版（冻结）：`server.py`、`backend/`（标准库 HTTP 服务 :8777、任务系统、出图渠道、开放 API）、`js/`（全局脚本，由 `js/build.js` 汇编，产物随仓库提交）、`tests/`（`test_*.py` 为 unittest，`*.mjs` 为 Playwright E2E）、`tools/`（打包、随包清单、文档生成）、`docs/`（旧版文档，`docs/archive/` 为历史文档）。旧版经 `backend/mio_paths.py` 使用上一级的 `data/` |
| `data/` | 随包默认数据（清单见 `data/distribution.json`）和旧版运行时用户数据（大多被 `.gitignore` 忽略）。**留在根目录**：新版「导入旧数据」也从这里读 |
| `docs/` | 路线图 `ROADMAP.md` |
| `next/` | Phase 0.5 技术验证（Spike），独立于旧版，只用标准库；说明见 [next/README.md](next/README.md) |
| `server/` | 新后端：FastAPI + Pydantic + SQLite。领域模型、导入器、任务引擎、ComfyUI 模块、出图管线、HTTP API（`/api` 本机界面用，`/api/v2` 带令牌的开放接口）、扩展、主题、画册导出、签名更新；`python -m mio_server` 启动（根目录 `start.bat` / `start.sh` 会建 `.venv`、装依赖并先安装已暂存的更新），存在 `web/dist` 时一并托管界面 |
| `clients/` | 开放 API v2 的 OpenAPI 快照、生成的 Python 客户端（`python clients/python/generate.py`，改了接口要重新生成并提交）与 AstrBot 插件；说明见 [clients/README.md](clients/README.md) |
| `tools/` | `build_release.py`（发布 zip + 签名清单 `mio-release.json`）、`release_keygen.py`（生成发布签名密钥；私钥只放仓库 Secret `MIO_RELEASE_KEY`，公钥写入 `server/mio_server/update/keys.py`） |
| `web/` | 新前端：Vite + React + TypeScript（TanStack Query、Zustand、i18next、Radix、react-konva、dnd-kit）。API 类型由 `npm --prefix web run gen:api` 从 OpenAPI 生成到 `web/src/api/schema.d.ts`，改了接口要重新生成并提交 |

## 验证命令（提交前必跑，都很轻）

```bash
python -m unittest discover -s server/tests -t server -q   # 新后端单测，约 20 秒
ruff check server clients tools && ruff format --check server clients tools   # lint（行宽 100）
python clients/python/generate.py --check                  # 生成的 API v2 客户端与接口一致
python -m unittest discover -s next/tests -t next -q       # Spike（next/）单测，约 5 秒
python legacy/tools/check_distribution.py                  # 随包数据与清单一致（以 CI 的干净检出为准）

# 旧版：在 legacy/ 目录下运行
cd legacy
node js/build.js dev                      # 汇编前端；产物已提交，跑完不应产生 git diff
node js/tests.js                          # 前端契约测试，约 1 秒
python -m unittest discover -s tests -q   # Python 单元测试，Linux 约 1 分钟
python tools/package_project.py --output releases   # 打包冒烟（可选）
```

- CI（`.github/workflows/ci.yml`）每次推送都跑同一组门禁，**必须保持绿色**。
- 旧版浏览器 E2E（在 `legacy/` 下 `npm run test:current`）只在手动触发的 `e2e.yml` 或本机按需运行。**沙盒里禁止安装浏览器或跑 E2E**。这些套件从程序目录复制 `data/`，本机运行前先建链接：Windows 在仓库根目录 `mklink /J legacy\data data`，Linux / macOS `ln -s ../data legacy/data`（已被忽略）。
- 新栈前端在 `web/` 下（先 `npm ci --prefix web`）：

  ```bash
  npm --prefix web run format:check   # Prettier，行宽 100
  npm --prefix web run typecheck      # tsc strict
  npm --prefix web test               # Vitest + Testing Library（jsdom，不需要浏览器）
  npm --prefix web run build          # 产物在 web/dist（不提交）
  npm --prefix web run gen:api        # 接口变更后重新生成 API 类型（需要能 import fastapi 的 python）
  ```
- 开发时：`python -m mio_server`（默认 8788）+ `npm --prefix web run dev`（Vite 把 `/api` 与 WebSocket 代理到 8788）。

## 提交规范

- **每完成一个小项，立刻提交并推送**：
  1. `git add <具体文件>`
  2. `git commit -m "feat|fix|docs|ci|chore: 做了什么"`
  3. `git push origin <当前分支>`
- 不要堆积未提交的改动，**不要用 `git add -A`**。
- 同时勾选 `docs/ROADMAP.md` 里对应的任务。

## 数据与隐私（重要）

- **随包文件会被运行时改写**：App 会把状态写回 `data/` 下的随包文件，例如 `data/settings/workspace.json`、内置工作流。本机开发前先运行一次 `python legacy/tools/protect_local_data.py`（标记为 skip-worktree），避免个人状态被提交。
- **有意修改随包默认值时**：
  1. `--undo`
  2. 修改文件
  3. `python legacy/tools/build_distribution.py`
  4. 提交
  5. 重新保护
- **彻底分离**：也可以用环境变量 `MIO_DATA_DIR` 把运行时数据放到仓库外。
- **测试夹具**只能复制随包数据（旧版 `legacy/tests/data_support.py` 的 `copy_shipped_data`，新版 `server/tests/legacy_fixture.py` 的 `copy_shipped_legacy`），不要整目录复制 `data/`。
- **全局执行队列**（旧版）：`mio_foundation.jobs()` 会启动后台调度线程。测试结束、删除临时目录之前，先调用 `mio_foundation.close_jobs(root)`。
- **绝不提交**密钥、令牌、Cookie、会话抓包，也不要在对话或日志里回显它们。

## 冻结区

旧版不再加功能，只修阻断性问题：

- 扩展 SDK v3、样式工坊 / 主题包、用户脚本、可执行变量
- 更新中心、市场
- API v1 扩张
- 框选、命令面板等交互细节

新版的扩展机制见路线图 §2.4，完整清单见 §8。

## 运行环境备忘

- **沙盒（Linux）**：
  - 存储约 128 MB，容易 OOM；不要保存截图或大文件，临时文件用完即删。
  - 容器重启后先用 `git log -1` 对齐最新代码。
- **用户本机（Windows，经 Portal 连接）**：
  - PowerShell 5.1，嵌套引号容易出错；复杂命令先写成脚本文件再执行。
  - Portal 的环境设置了 `NoDefaultCurrentDirectoryInExePath=1`，调用当前目录的脚本要写成 `.\xxx.bat`。
  - 部分文件在工作区里是 CRLF（Git 提交时会归一为 LF）。修改已有文件优先用补丁方式，以保留换行风格。
- **本机 ComfyUI**：`127.0.0.1:8188`，RTX 4060 Laptop 8 GB。出图测试只用中性题材，不加载用户的 LoRA。
