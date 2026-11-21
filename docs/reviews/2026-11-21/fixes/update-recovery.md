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

## CI 收尾补充：R5-WIN-PATH-01

最终基线 `c84ce33` 的 Windows Python 3.11 CI 检出三项更新恢复失败。此次在本机临时目录先创建长名称父目录，再通过真实 Windows `GetShortPathNameW` 取得 8.3 别名；让独立 Python 子进程以该别名作为 `TEMP` / `TMP` 运行三项原回归，**三项全部复现失败，15.806 秒**。没有通过延长等待、跳过或放宽业务断言处理。

- **确认的生产问题**：稳定宿主把安装根 `root` 规范化为 `resolve()`，但 `_workspace` 返回原始 `absolute()` 路径；短名数据路径与长名程序目录作词法祖先比较，实际位于 `web/` 下的工作区未被识别，导致安装可覆盖工作区。类似 `data/../web/private-workspace` 的绝对路径也能在各平台触发同类绕过。新集成回归在修复前运行，`UpdateError not raised`，0.304 秒。
- **另两项为测试暂停钩子误报**：实际交换的 source 是规范化长路径，测试 fixture 的 `self.root` 却保留短名，两者 `==` 为假，所以线程的 `entered` 和子进程的 `held` 未触发。它们没有证明租约失效。将测试 TEMP base 在 setup 时规范化后，暂停依然发生在实际 module 目录已移走的位置，原并发拒绝和最终完整性断言全部保留。
- **生产最小修复**：`_workspace` 先检查用户原始路径及祖先不存在链接 / reparse point，再返回 `data.resolve()`；不能在链接检查之前解析，否则会抹掉应当拒绝的链接证据。apply 与 journal 恢复两处重叠检查共享该函数，安装根、程序 entry、工作区采用同一形式比较。
- **新增持久回归**：`test_workspace_aliases_cannot_hide_program_overlap` 使用真实签名 fixture，通过 `..` 路径以及 Windows 文件系统支持时的真实 8.3 别名分别指向受交换程序目录内部。拒绝后核对工作区私有文件、pending 逐字内容、整套旧版本与稳定宿主均不变；每个子 case 断言完成后取消 pending，避免同一物理工作区夹具串扰。没有新增 skip；不提供 8.3 别名的卷仍执行跨平台 `..` 用例。

修复后同一强制短 TEMP 的三项原回归全部通过，**3 项，1.797 秒**。集中更新、版本目录、启动器静态和 bootstrap 回归运行 **58 项**：原 57 项无失败，其中既有无 `sh` 语法检查跳过 1 项；新增回归首次因上述 pending 夹具串扰报错，修正后只重跑该受影响回归，**1 项通过，0.241 秒**，其 Windows 两类 alias 子 case 均执行。Ruff check / format check、py_compile 通过。

此外，同次 Windows CI 的 API 隔离回归由主控修正为比较实际路径的 `resolve()` 结果；短名和长名仍指向同一个隔离 TEMP，不是读取默认 legacy 根。该测试修正不改变应用行为。

本补充只变更稳定宿主的一处返回值、更新恢复测试及本文，未接触用户运行目录、真实更新源或个人工作区。独立新代理复审和精确最终提交的跨平台 CI 由主控继续验证；这里的本机结果不代称远端已通过。

### 独立复审反证后的第二次补修

新审查者的[Windows 路径复审](../round-5-ci-verification/windows-paths.md)找出 `resolve()` 仍保留 extended-length 前缀的反例：普通根目录配 `\\?\C:\…\web\private-workspace` 数据目录，以及 extended 根配普通数据目录，都会让词法比较失效。真实签名安装后旧版变为 `4.1.0`，私有 marker 和 pending 均消失，因此第一版短名补修不能关闭此项。修复者复跑其同一 TEMP 探针，**1 项红，0.293 秒**，再进行以下补修。

- 新增仅用于身份比较的 `_path_identity`：解析文件系统别名后，将常规 DOS drive / extended drive、UNC / extended UNC 分别统一成大小写不敏感的 `PureWindowsPath`；其他设备命名空间拒绝。**文件 I/O 继续使用原始解析路径**，不会把真实长路径的必要前缀剥掉。
- apply 和 journal 的工作区祖先保护使用相同身份函数；journal 的根归属也使用该函数，但仍要求记录为绝对路径。同安装租约 key 统一相同前缀与大小写身份，避免同线程以另一种前缀访问自己持有的租约时误报忙碌。原始路径的链接 / reparse point 检查仍先于解析，未被删减。
- 持久回归增加普通 / extended 根与数据目录的三种组合，拒绝后私有 marker、pending、完整旧版断言全部保留；增加同安装不同前缀的租约重入与真实中断 journal 恢复；超过 400 字符的安装目录和独立工作区能正常安装签名包，证明长路径仍受支持。UNC 身份转换与非文件设备命名空间拒绝仅使用纯路径护栏，没有访问真实网络共享。

原 extended-prefix TEMP 探针修后 **1 项通过，0.200 秒**。包含更新恢复、版本目录、启动器静态和 bootstrap 的整批相关回归重新运行：**60 项，26.324 秒，全部通过（1 项既有无 `sh` 跳过）**。Ruff check / format check、py_compile 通过。源文件与本文已读回；独立审查者继续用原探针和额外组合复验，最终远端 CI 仍由主控核对，不以这些本机结果代称远端通过。
