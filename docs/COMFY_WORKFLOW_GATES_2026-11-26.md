# 静态工作流 R2 集成修复门禁（2026-11-26）

本页记录新一轮独立终审前的本机完整门禁。产品源码在北京时间 2026-11-26 00:12:32 完成最后修改，后端全套于 00:13:05—00:31:26 执行。文档整理不改变产品代码；这份记录不代替下一轮五路审查或最终提交的远程 CI。

| 命令 | 本机结果 |
|---|---|
| `python -m unittest discover -s server/tests -t server -q` | 运行 1,724 项，1,097.772 秒，退出 0；`OK (skipped=8)`，不能表述为 1,724 项全部通过 |
| `ruff check server clients tools` | 退出 0 |
| `ruff format --check server clients tools` | 退出 0，424 个文件无需改动 |
| `python clients/python/generate.py --check` | 退出 0，clients up to date |
| `python -m unittest discover -s next/tests -t next -q` | 80 项，退出 0 |
| `python tools/check_distribution.py` | 退出 0，64 个随包文件 |
| `npm --prefix web run format:check` | 退出 0 |
| `npm --prefix web run typecheck` | 退出 0 |
| `npm --prefix web test` | 118 个文件、964 项通过，退出 0 |
| `npm --prefix web run build` | 退出 0；保留 Vite 既有大 chunk 警告，不把警告写成失败或消失 |
| `npm --prefix web run gen:api` | 退出 0；生成后的类型与已提交接口一致，无新差异 |
| `python tools/check_doc_links.py` | 新增审查材料纳入后，212 文档、1,434 个本地目标检查，0 个坏链接 |
| `git diff --cached --check` | 退出 0 |

本机环境为 Windows、Python 3.13、Node 22。后端子进程仅设置 `GIT_CONFIG_COUNT=0`，隔离当前工具进程注入的 Git 配置；没有修改全局 Git 配置或打印其值。此前的两项临时仓库初始化错误已独立定位为 Windows 空环境项恢复问题，不能用该解释直接宣称通过；上表采用的是隔离后完整运行的实际退出结果。

LoRA 数值零状态补修前启动的一次旧源码全套被主动停止，未计作通过；上表的 1,724 项来自最后源码修改之后的新进程。前端、Spike、生成物和随包门禁分别有独立退出结果；最后的纯后端数值判据修复后又复核了 Ruff 与 Python 客户端一致性。

真实语料复测与源码冻结见 [R2 集成复测](COMFY_WORKFLOW_R2_RETEST_2026-11-26.md)，发现和关闭记录见 [R2 修复台账](COMFY_WORKFLOW_R2_REPAIRS_2026-11-26.md)。下一轮五路审查、最新跨平台 CI、最终缓存删除和干净推送状态待收口后另记。
