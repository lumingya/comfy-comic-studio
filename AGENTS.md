# AGENTS.md：给 AI 代理的协作说明

> 新代理先读三份文档：本文件、[README](README.md)（产品与使用）、[路线图](docs/ROADMAP.md)（方向与任务勾选）。

## 项目现状

- **产品**：Mio · 绘页，本地优先的「从一个故事到一部作品」工作室。
- **当前代码**（3.2.0-dev.1）是**旧架构**，功能开发已冻结。
- **方向**：按[路线图](docs/ROADMAP.md)转向「条漫 + 本地 ComfyUI + React」新架构。顺序是 Phase 0 止血 → Phase 0.5 技术验证（Spike）→ Phase 1 起重建。
- **旧版快照**：Git 标签 `legacy-v3.2`。

## 目录速览

| 路径 | 内容 |
|---|---|
| `server.py`、`backend/` | Python 标准库 HTTP 服务（:8777）、任务系统（`mio_job_store.py`、`mio_frame_jobs.py`、`production/`）、出图渠道（`providers/`）、工作流槽位（`ecosystem/workflow_slots.py`）、开放 API（`api_v1/`） |
| `js/`、`index.html`、`styles.css` | 旧前端：全局脚本，由 `js/build.js` 汇编，产物随仓库提交 |
| `data/` | 随包默认数据（清单见 `data/distribution.json`）和运行时用户数据（大多被 `.gitignore` 忽略） |
| `tests/` | `test_*.py` 是 unittest；`*.mjs` 是 Playwright 浏览器 E2E，较重，只在手动时运行 |
| `tools/` | 打包、随包清单、文档生成、开发辅助脚本 |
| `docs/` | 文档；`docs/archive/` 存放不再维护的历史文档 |
| `next/` | Phase 0.5 技术验证（Spike），独立于旧版，只用标准库；说明见 [next/README.md](next/README.md) |
| `server/` | Phase 1 新后端：FastAPI + Pydantic + SQLite。当前已有 `mio_server` 包、Series / Episode API、模型 / 存储 / API 单测 |
| `web/` | Phase 1 新前端：Vite + React + TypeScript 入口骨架，后续接设定集、剧本、出图板和条漫画布 |

## 验证命令（提交前必跑，都很轻）

```bash
node js/build.js dev                      # 汇编前端；产物已提交，跑完不应产生 git diff
node js/tests.js                          # 前端契约测试，约 1 秒
python -m unittest discover -s tests -q   # Python 单元测试，Linux 约 1 分钟
python -m unittest discover -s next/tests -t next -q   # Spike（next/）单测，约 5 秒
python -m unittest discover -s server/tests -t server -q   # 新后端单测，约 1 秒
python tools/check_distribution.py        # 随包数据与清单一致（以 CI 的干净检出为准）
python tools/package_project.py --output releases   # 打包冒烟（可选）
```

- CI（`.github/workflows/ci.yml`）每次推送都跑同一组门禁，**必须保持绿色**。
- 浏览器 E2E（`npm run test:current`）只在手动触发的 `e2e.yml` 或本机按需运行。**沙盒里禁止安装浏览器或跑 E2E**。
- 新栈前端在 `web/` 下：依赖安装后使用 `npm --prefix web run typecheck`、`npm --prefix web run test`、`npm --prefix web run build`。

## 提交规范

- **每完成一个小项，立刻提交并推送**：
  1. `git add <具体文件>`
  2. `git commit -m "feat|fix|docs|ci|chore: 做了什么"`
  3. `git push origin <当前分支>`
- 不要堆积未提交的改动，**不要用 `git add -A`**。
- 同时勾选 `docs/ROADMAP.md` 里对应的任务。

## 数据与隐私（重要）

- **随包文件会被运行时改写**：App 会把状态写回 `data/` 下的随包文件，例如 `data/settings/workspace.json`、内置工作流。本机开发前先运行一次 `python tools/protect_local_data.py`（标记为 skip-worktree），避免个人状态被提交。
- **有意修改随包默认值时**：
  1. `--undo`
  2. 修改文件
  3. `python tools/build_distribution.py`
  4. 提交
  5. 重新保护
- **彻底分离**：也可以用环境变量 `MIO_DATA_DIR` 把运行时数据放到仓库外。
- **测试夹具**只能复制随包数据（`tests/data_support.py` 里的 `copy_shipped_data`），不要整目录复制 `data/`。
- **全局执行队列**：`mio_foundation.jobs()` 会启动后台调度线程。测试结束、删除临时目录之前，先调用 `mio_foundation.close_jobs(root)`。
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
