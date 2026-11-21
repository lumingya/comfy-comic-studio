# R3-LIFE-04 / R3-LIFE-05 扩展生命周期修复

范围：`server/mio_server/extensions/manager.py`、`server/mio_server/extensions/trust.py` 与新增 `server/tests/test_review_extension_lifecycle.py`。未改真实扩展包、用户私有数据、依赖安装器、启动器或前端；提交与推送由主控统一执行。

## 原始短红

使用真实 `AppContext`、TEMP 下的工作区与恢复目录、真实 Python 扩展、服务 / hook / 路由 / 注册项以及合法 ZIP，仅在错误边界注入故障：

```powershell
$env:PYTHONPATH='server'
.venv/Scripts/python.exe -m unittest tests.test_review_extension_lifecycle -v
```

原始结果：2 tests / 1.222s，`FAILED (failures=2)`。

- 最终 staging → target 的 `Path.rename` 抛 `OSError` 后，唯一的旧 `custom-original.txt` 已不存在。
- `remember_package` 抛 `OSError` 后，新实例仍在 `manager.loaded`。

排除单纯状态展示问题：断言读取的是实际原件与 `Loaded` 实例，不是仅比较 UI 文本。

## 发布与回滚边界

### R3-LIFE-04

- 在扩展根下由 `mkdtemp` 创建本次独有的 `.install-<id>-*/`，其中 `package/` 是候选，`previous/` 是原目录；不再递归删除固定 `.staging-<id>`。
- 原 target 须为普通目录树，清单有效且身份与本次扩展相同；不覆盖无清单或身份不符的未知目录。
- 先写 `transaction.json`（扩展身份、原启用 / 摘要状态、prepared 阶段），再原目录 → previous、候选 → target。两个目录位于同一扩展根，避免跨卷复制替代交换。
- 新目录发布与 disabled 状态保存均完成后才提交并卸载旧实例。任一提交前错误均反向 rename 恢复原目录，并恢复原状态；失败路径从未提前关闭旧服务或撤销旧贡献。
- 清理仅针对本次事务中的 previous；旧文件被系统锁住时保留 committed 日志与旧目录，安装仍返回成功，避免把提交后的清理错误伪装成安装失败。
- 如果连回滚 rename 也失败，保留 previous 与 prepared 日志，绝不让 finally 删除唯一原件。此双重故障仍显式返回错误，目录需在外部锁解除后恢复；本轮没有新增启动时自动恢复器。

### R3-LIFE-05

- `enable()` 调用 `load(..., remember=True)`；可信包快照与索引提交放进现有 load 的 try 尾部，在旧实例停用、loaded 替换与路由发布之前完成。
- 信任 I/O 失败沿用普通加载失败的完整回滚：新 API 禁用、新服务关闭、新贡献 / hook 移除、旧服务 / 来源层级 / 模块恢复，enable 恢复原持久状态。首次启用得到 error 状态；失败重启用保留旧实例并附错误，与原有普通 load 失败语义一致。
- 普通 `activate()` 抛错时不调用 remember，不把可信索引从旧成功版本切到失败版本。普通 startup `load()` 默认 `remember=False`，不新增每次启动的快照写入。
- `trust.py` 仅补快照复制发布的小段：复制到唯一 `.snapshot-*` 目录、校验完整摘要，再 rename 到摘要目标；复制失败只清理本次临时目录。因此半份复制不再占住最终摘要目录，恢复磁盘后同一包可以重新启用。可信索引仍使用原有临时文件替换提交。

## 串行与平台边界

沿用 `@operation_serialized` → engine `hold_operation()` / `threading.RLock`，覆盖安装 / 启停与备份的整个逻辑操作；递归调用 load / unload 可重入。正常 `AppContext.create()` 在打开数据库前通过 `prepare_workspace()` 获得工作区 OS 租约，并持有至 close：Windows 使用 `msvcrt.locking`，POSIX 使用 `fcntl.flock`。本次不新增锁平台。

此保证针对正常 AppContext 管理的同一工作区。手工构造多个不同工作区的 manager 并指定同一自定义 extension root、同用户外部进程替换路径、真实断电刷盘与跨卷发布不在本轮覆盖内。transaction 日志用于保留可辨认的恢复内容，不宣称已实现断电后的自动恢复或多文件持久原子性。

## 集中验证

生产修改与当轮 11 条新回归全部完成后，集中运行以下相邻测试与静态检查：

```powershell
$env:PYTHONPATH='server'
.venv/Scripts/python.exe -m unittest tests.test_review_extension_lifecycle tests.test_extensions tests.test_extension_services tests.test_extension_publication tests.test_extension_market tests.test_extension_dependencies tests.test_extension_data tests.test_private_data_lifecycle tests.test_private_store tests.test_backup_participants tests.test_backup_extension_data tests.test_operation_extensions tests.test_extension_backend_priority tests.test_extension_contracts tests.test_extension_boundary_corpus tests.test_extension_ctk -q
.venv/Scripts/ruff.exe check server/mio_server/extensions/manager.py server/mio_server/extensions/trust.py server/tests/test_review_extension_lifecycle.py
.venv/Scripts/ruff.exe format --check server/mio_server/extensions/manager.py server/mio_server/extensions/trust.py server/tests/test_review_extension_lifecycle.py
.venv/Scripts/python.exe C:/Users/QIU/.codex/skills/utf8-text-guard/scripts/text_guard.py check server/mio_server/extensions/manager.py server/mio_server/extensions/trust.py server/tests/test_review_extension_lifecycle.py
git diff --check -- server/mio_server/extensions/manager.py server/mio_server/extensions/trust.py server/tests/test_review_extension_lifecycle.py
```

结果：147 tests / 108.111s，`OK`，无 skip。静态检查通过：ruff `All checks passed!`、`3 files already formatted`、UTF-8 与 diff whitespace 检查无错误。

新回归矩阵：最终发布 rename 失败；保存状态后抛错；成功替换并保留私有数据 / 未知 staging；拒绝未知 target；回滚 rename 再失败保留原件 / 日志；提交后旧包清理失败；首次信任失败关闭服务 / 移除注册；失败重启用保留旧实例；普通 activate 失败不提前切换信任；真实快照半复制失败后可重试；真实索引 replace 失败后保留旧信任并可重试。

所有新增测试只写 TEMP；使用受控扩展，不安装真实依赖、不访问真实服务、不读取用户 extensions / private data，不运行浏览器或 E2E。日志中的预期异常来自明确故障注入。尚待全新代理独立复核，本文不自行宣告关闭台账。
