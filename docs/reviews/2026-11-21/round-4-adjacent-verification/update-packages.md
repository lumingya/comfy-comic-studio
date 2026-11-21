# 第四轮独立复核：更新恢复与扩展包生命周期

- 复核日期：2026-11-21，Windows / Python 3.13。
- 对象：`ddf8d81` 上的当前 **working tree** 补丁，包括未跟踪的稳定宿主、恢复适配器与两份回归测试；不是仅复核 HEAD。
- 已读：仓库 `AGENTS.md`、README、路线图、审查 README / FINDINGS、第三轮 `lifecycle.md`、`fixes/update-recovery.md` 与 `fixes/extension-lifecycle.md`。
- 本轮只新增本报告；没有修改生产代码、测试、共享台账，没有提交或推送，没有派下级代理。

## 结论

**R3-LIFE-01 / 02 / 03 / 04 / 05 可关闭。** 当前补丁在下列受控 TEMP 回归和正常业务组合中符合原修复目标，未发现新的已确认缺陷。结论不覆盖尚未执行的安全拒绝或故障边界。

| ID | 独立复核结果 | 当前证据 |
| --- | --- | --- |
| R3-LIFE-01 | 通过 | A 在移走主模块后暂停，另一 Updater 的 apply / cancel / stage / download 全部拒绝；跨进程、跨工作区共用安装根也拒绝；释放后安装与合法签名回退正常，最终模块 / requirements / web 同版 |
| R3-LIFE-02 | 通过 | 8 个真实 rename 后切点、commit 前后实际 `os._exit`；下个独立进程恢复为全旧或全新；主模块确实缺失后 `python -S` 通过稳定宿主恢复；恢复自身再被终止后，第三进程重放成功并可重试安装 |
| R3-LIFE-03 | 通过 | 真实 TEMP Windows 启动器的 `--data X` / `--data=X` 分别完成升级 / 回退；故意冲突的环境变量不抢占显式参数；相对参数、相对环境变量及默认路径保持 `server/` cwd 语义 |
| R3-LIFE-04 | 通过 | 发布 rename 失败、状态保存后抛错均恢复旧文件、旧持久启用状态和旧 Loaded / 服务 / 注册对象；正常覆盖禁用新包并保留私有数据；双 rename 故障保留唯一原件与 prepared 日志；提交后清理失败保持安装成功且留下可辨认旧包 |
| R3-LIFE-05 | 通过 | 首次 trust I/O 失败撤销新服务 / 注册 / hook / 路由与持久状态；失败重启用保留旧实例与旧信任；半快照复制失败不占最终 digest 目录，下一次启用成功；索引 replace 失败保留旧信任并可重试；普通 activate 失败不推进信任 |

关闭判断已通知主控，R3-LIFE-04 / 05 同时通知原作者。共享台账由主控更新。

## 实际检查的实现与合同

### 更新安装与恢复

阅读当前 `mio_update_bootstrap.py`、`server/mio_server/update/{updater,recovery,__main__,manifest,catalog,__init__}.py`、`start.bat` / `start.sh`、发布构建 include 及相关测试。`server/mio_server/__main__.py` 仅用于核对应用参数和实际应用创建位置，不作为该文件全覆盖审计。

1. **稳定宿主是明确合同。** 根 helper 的模块说明和作者修复说明都明确：helper 与两个 launcher 属于安装宿主，不随应用升级 / 回退替换；新发行包包含三者，宿主变更应使用明确的新宿主安装方式。`PRESERVE` 真正排除三者，发行构建 include 含 helper，TEMP 升级 / 回退后逐字比较三者保持相同。此合同只适用于已有新宿主的安装，不追溯声称历史残缺安装可自救。
2. **恢复先于应用导入。** 两个 launcher 都先调用 `recover`，再调用依赖 bootstrap，之后执行 stable `apply` 和应用入口。stable `recover` 分支只走标准库。`apply` 在安装根租约内先恢复 journal，再导入可被替换的签名验证模块，避免第二进程在主模块暂缺时先导入失败。
3. **默认导入不会创建真实 App。** 另以 `.venv/Scripts/python.exe -S -B` 直接经 `importlib` 导入当前 working helper，断言结果为 `loaded_mio_server_modules=[]`。没有调用 helper 的默认真实安装根 `main()`。只读追踪 `apply` 所需 `mio_server.update` 的包初始化链，只导入类 / 常量 / 验签代码，不调用 `AppContext.create()` / `create_app()`、不导入应用 `__main__`。实际模块缺失恢复由上述独立 `-S` TEMP 用例证明。
4. **租约与持久记录覆盖受测交错。** 安装根锁使用 Windows `msvcrt.locking`（POSIX 分支为 `flock`），锁文件不 unlink；同线程可重入。Updater 的四类变更操作在读 pending 前取同一宿主租约并恢复。真实测试验证了本机 Windows 分支和跨工作区共用安装根；POSIX 锁不因阅读而算作本机执行。
5. **安装信任源未转移到 staging。** apply 重新验证原 pending 的签名清单、ZIP 大小和 SHA-256，再从完整签名 ZIP 解压到本次唯一事务目录；当前 `pending.path` / staged 内容不构成信任来源。既有正常组合实测篡改 staged 被忽略、ZIP 改坏被拒、签名 / 密钥不符被拒、git 开发目录拒绝应用。
6. **恢复可重复。** installing 按逆序恢复受控 entry；已恢复而备份不存在的旧项被保留，新建项会删除。committed 仅完成匹配原 pending hash 的清理，不回滚新程序。本轮对 commit 后真实退出、独立恢复、再次恢复以及安装恢复自身再次退出有直接证据；没有在 committed 清理的每一条 unlink / rmtree 之间另设新切点。
7. **数据保护有执行与阅读两类证据。** 实测默认 `data/`、`server/data/` 和自定义工作区私人 marker 均保留，工作区位于待替换 web 目录内时拒绝，未知根 payload 被拒。源码还明确排除 `.git` / `.venv` / `releases` / `.mio-update`，恢复日志对 schema、安装根、事务名、entry、绝对工作区和 pending hash 作归属校验；后半部分属于本轮阅读证据。

### 扩展覆盖与可信快照

阅读当前 `server/mio_server/extensions/{manager,trust}.py` 及作者完整 11 项 TEMP 回归。

- 覆盖使用扩展根内唯一 `.install-<id>-*/{package,previous}`，先保留旧目录，再发布新目录并保存 disabled 状态；这些提交前步骤均成功后才卸载旧实例。发布失败或状态保存失败不会提前关闭旧服务。
- 旧目录必须通过普通路径树检查且清单身份匹配；未知 target 不被覆盖。正常替换不会清理无关的固定 `.staging-*` 内容。
- finally 仅在本次事务不存在 previous 时清理候选；双故障保留旧原件及事务记录。该记录不是启动自动恢复器：外部文件锁解除后的人工处理边界仍如作者说明，本轮不把它称作自动崩溃恢复。
- trust 的副作用位于 load 原有 try 内，旧实例退役与新 Loaded / 路由正式发布之前；可信快照在唯一 `.snapshot-*` 中复制并校验完整 digest 后 rename 发布。索引提交失败的旧信任、旧实例及服务恢复和后续重试均直接验证。
- 生命周期继续依赖原有逻辑操作屏障与正常 AppContext 的工作区租约；没有宣称手工构造的不同工作区 manager 共用自定义 root 也拥有新的跨进程扩展根事务协议。

## 集中验证与可重跑范围

从仓库根使用现有 `.venv/Scripts/python.exe -B` 执行 `unittest.TestSuite`，选取以下类；更新新回归按方法名排除两个安全拒绝实验，其余全部选取：

```text
tests.test_review_update_recovery.UpdateRecoveryTests                         9
tests.test_review_extension_lifecycle.ExtensionLifecycleReviewTests          11
tests.test_update.Ed25519Tests                                                2
tests.test_update.ManifestTests                                               2
tests.test_update.UpdaterTests                                                4
tests.test_update_catalog.ReleaseCatalogTests                                11
tests.test_launchers.BatchFileTests                                           8
tests.test_launchers.ShellScriptTests                                         4
tests.test_launchers.BootstrapTests                                           9

Ran 60 tests in 14.954s
OK (skipped=1)
```

唯一 skip：`ShellScriptTests.test_syntax`，原因是 Windows 本机无 `sh`。`BootstrapTests` 是依赖安装 callback / probe 的 mock 单测；真实 launcher TEMP 用例的 venv 使用 `system_site_packages=True, with_pip=False`，bootstrap 为无操作 fixture。没有执行原 `LauncherExecutionTests` 或任何真实 pip / 网络 / 发布 / 运行中用户服务操作。

显式排除并只读检查：

- `test_linked_program_or_updates_paths_are_rejected_before_mutation`
- `test_invalid_journal_ownership_is_fatal_and_does_not_touch_other_root`

没有新增链接或根外文件实验，没有访问或清理此前被拒实验的临时目录。测试只管理各自本次创建的 TEMP 夹具。预期错误日志均来自现有测试显式注入的 I/O / activate 失败。

## 保留的验证边界

- 本轮没有执行链接 / Windows junction 新矩阵、journal 归属篡改或更多恶意 ZIP 语料；相应拒绝逻辑只有阅读证据。
- 没有验证真实断电 / 文件系统与硬件耐久性、真实依赖安装副作用、运行中的旧服务与安装器并存、完整 Linux / macOS launcher 或 POSIX 文件锁行为。
- 没有扩展到 committed 清理内部每一条文件操作的进程切点、宿主本身的原地升级、旧宿主已经中断后的迁移恢复，以及外部同用户进程恶意替换路径。
- 未把这 60 项抽样通过解释为全仓零缺陷；未运行全仓门禁，生成物与最终 CI 由主控整合。
