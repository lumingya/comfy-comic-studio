# 更新安装恢复：R3-LIFE-01 / 02 / 03

## 范围与交付

修复依据为[第三轮生命周期报告](../round-3-adjacent/lifecycle.md)中三个已确认问题：双实例安装混版、移动主包后中断导致恢复器不可导入、自定义 `--data` 的 pending 永不安装。原报告保留修复前 TEMP 红证据；没有重新访问真实安装目录或真实工作区。

改动仅涉及根目录稳定引导文件 `mio_update_bootstrap.py`、`start.bat` / `start.sh`，`server/mio_server/update/{updater,recovery,__main__}.py`，发布清单的一项 include、`.gitignore`、启动器测试的必要同步，以及新回归 `server/tests/test_review_update_recovery.py`。没有修改扩展安装器、用户数据、密钥、服务和依赖环境；未提交或推送。

## 稳定宿主合同

- `mio_update_bootstrap.py`、`start.bat`、`start.sh` 是安装宿主基础设施，**不随应用程序升级或回退而替换**。新解压发行包必须同时包含它们。需要更改宿主本身时应明确发布新的宿主安装方式，不能借应用 payload 的目录交换隐式替换它们。
- 已使用本机制安装的宿主可升级和回退应用；回退包即使带有旧启动器和旧更新器，启动时仍通过原有稳定宿主安装和恢复。签名覆盖原始完整 ZIP；保留宿主文件不会改变或跳过包签名验证。
- 未提交事务只恢复本机旧备份，不执行 ZIP 内的代码，也不依赖 `mio_server`、Pydantic、httpx 或已安装的应用依赖。程序目录缺失时，`python -S mio_update_bootstrap.py recover` 仍可执行。
- 本次不能追溯修复尚未拥有稳定宿主的历史安装已经发生的中断。它也不声明磁盘损坏、断电时所有平台的完整硬件耐久性保证；本轮验证的是进程实际退出与重新启动。

## 安装与恢复协议

1. `start.*` 先调用稳定宿主的 `recover`，再运行依赖 bootstrap，再把原始 server 参数传给宿主 `apply`。宿主只解析完整 `--data X` / `--data=X`，其他参数继续原样给应用；显式参数优先于 `MIO_V3_DATA`，相对路径与默认目录保持原有 `server/` cwd 语义。
2. 安装根 `.mio-update/lock` 使用 Windows `msvcrt.locking` 或 POSIX `flock` 非阻塞独占租约。同线程嵌套可以重入，其他实例、线程、进程及不同工作区均不能同时改同一安装根。租约覆盖 download / stage / cancel / apply 与回滚 / 清理，读取 pending 在取得租约之后；锁文件永不 unlink，避免 inode/句柄分裂。
3. 每次 apply 在安装根建立唯一 `.mio-update/tx-UUID/{verified,backup}`。重新验证 pending 中的 Ed25519 清单及完整 ZIP 大小、SHA-256，从签名 ZIP 重新解压；不使用可被修改的 pending.path 或 staged 内容。备份与安装目录在同卷，目录交换使用原子 `replace`。
4. schema 1 journal 记录安装根、事务标识、数据目录、原始 pending 的 hash、受控程序 entry、原文件是否存在及已开始 entry 数。每次开始交换前先以 fsync + 原子替换落盘 journal；POSIX 还同步相关目录。程序 entry 仅接受发行包的已知根项和 server 子项，拒绝越界、未知项、链接 / Windows reparse point、恢复日志根归属变化，以及任何会覆盖当前工作区祖先的 entry。
5. `installing` journal 无论已完成几步，重新启动都按逆序恢复完整旧应用。备份存在则移回；旧项没有备份时保留原位内容，兼容“尚未移动”和“上次恢复已移回但进程又退出”。新建项无旧文件时删除。恢复再次中断后可重复重放。
6. 新程序依赖准备成功后才原子发布 `committed`。此后恢复只完成匹配 hash 的原 pending、staged 和 verified 清理，不把已提交的新应用回滚。成功安装保留旧程序备份。安装异常先恢复旧程序，再准备旧依赖；恢复或租约失败会阻止启动。
7. `data/`、`server/data/`、`.venv`、`.git`、`releases`、`.mio-update` 和稳定宿主文件不参与程序交换。没有 journal 的 `recover` 不写安装根。工作区更新路径及其直接子路径如果是链接则拒绝操作，防止包或清理动作越过所属工作区。

## 回归证据

新增 **11 项** TEMP 回归，使用现有测试签名 fixture 与自制极小应用包，没有真实网络、pip、用户程序、后台服务、发布或浏览器 E2E：

- 对 fixture 的全部 **8 个真实 rename 后切点**、commit 前后分别在真实子进程调用 `os._exit`。下次独立进程恢复后，module / requirements / web 三处均全旧或全新；stable 文件逐字相同，三处私人数据均保留，pending 状态与提交阶段一致。
- 真实退出发生在 `server/mio_server` 整目录已移走时，确认目录确实不存在，再用禁用 site 的 `python -S` 独立进程恢复。
- 回滚进程在真实备份移回后再次 `os._exit`，第三进程重放成功，随后能重新安装 pending。
- 两个 Updater 实例交错：A 移走 module 后暂停，B 的 apply / cancel / stage / download 均拒绝；A 完成后全新一致且 pending 清除。
- OS 租约跨进程且跨数据目录；另一个真实安装进程在 module 缺失窗口被稳定入口拒绝，未先导入丢失的 module。第一个提交后，另工作区的合法签名旧版本可回退安装，仍保留新宿主。
- TEMP Windows junction / POSIX symlink 拒绝、journal root / transaction / entry 归属篡改拒绝、损坏 ZIP / 未知程序路径 / 工作区祖先重叠拒绝。
- 实际 Windows `start.bat`（其他平台为 `start.sh`）在含空格、中文、`&`、括号、`!` 的 TEMP 路径运行；`--data X` 与 `--data=X` 分别成功安装 / 回退。TEMP venv 使用现有系统包，bootstrap 为无操作 fixture，不执行 pip；应用仅记录 argv 后退出。
- 新发行包静态收录 stable helper，旧启动器静态顺序测试已同步并保留原 ASCII/CRLF、引号和退出路径检查。默认目录及环境变量相对路径语义有断言。

集中验证命令（从 `server/` 运行）：

```text
python -m unittest tests.test_review_update_recovery tests.test_update tests.test_update_catalog tests.test_launchers.BatchFileTests tests.test_launchers.ShellScriptTests tests.test_launchers.BootstrapTests -q
Ran 57 tests in 16.219s
OK (skipped=1)
```

唯一跳过是 Windows 无 `sh`，因此原 `ShellScriptTests.test_syntax` 按条件跳过。新增 11 项全部执行通过；Windows junction 测试使用无需提升权限的目录链接替代需要特权的 symlink，没有跳过。

受影响 Python 文件的 ruff check / format check、py_compile、UTF-8/BOM 检查与 `git diff --check` 通过。本轮没有运行会真实调用 pip 的原 `LauncherExecutionTests`；其 fixture 仅同步新增宿主文件，实际启动器调用由上述独立离线用例覆盖。全量门禁与新代理独立复审由主控整合。
