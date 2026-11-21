# R5-JOBS-SQLITE-01 独立复审

结论：建议关闭本项，未发现需要追加修改的问题。此结论针对本次连接锁和游标补修；最终跨平台整套 CI 由主控另行核对。

## 范围与独立攻击路径

基线为 `c84ce33`，复审工作树中的两个生产差异：

- `server/mio_server/jobs/delivery.py::_pending_delivery()`。
- `server/mio_server/jobs/dependencies.py::job_references()`。

先检查差异与直接调用链，再读[作者修复记录](../fixes/sqlite-concurrency.md)。独立攻击方向为：
仅持每任务 guard 的完工与异常分类是否仍绕过连接锁；依赖生成器暂停是否带着活动游标或锁返回；
为了补锁是否误把整个域回调包入连接锁，导致不同任务或跨线程读阻塞。

静态检查涵盖 `runtime.py::_finish_guarded/_run`、`delivery.py::_record_delivery/replay_result`、
`executors.py::executor_status/ensure_executor_source_idle`，以及 publication 的直接恢复读取路径。
没有在这些直接路径发现另一个漏掉的共享连接查询。内部 `_require/_aggregate/_write_executor_ref`
仍依赖调用方持锁；所检查调用点满足该约定，未要求无依据的全模块重构。

## 新的独立反证

在 TEMP 内创建独立 harness，不引用作者的护栏实现，使用真实内存 SQLite 或原 API 夹具的独立 TEMP 数据库。
五项检查全部通过：

| 攻击 | 实际断言与结果 |
| --- | --- |
| 持锁时调用 pending 读 | 主线程持真实 `engine.lock`，另一线程进入 `_pending_delivery` 后不能越锁完成；释放后正常返回 |
| 持锁时消费依赖 | 对 `next(job_references(...))` 执行相同的互斥反证，释放后得到原引用 |
| 暂停依赖生成器 | 先取 snapshot 引用，在另线程改写 input 行并成功读任务；继续消费仍得到已取回的三项原引用，证明消费不再依赖暂停后的实时游标，且未把锁留给消费者 |
| 不同任务的完工回调 | 两个真实任务的 `on_complete` 同时通过双线程 Barrier；两者都不持连接锁，且均可等待另线程 `engine.get` 成功；任务完成、attempt 均为 1 |
| 原始失败 CRUD 路径 | 对 `CrudTests.test_listings_carry_progress_and_covers` 的引擎连接加独立透明 execute/fetch/事务护栏，不替换查询结果、不重试，最终一次执行观察 2,200 次边界检查，零违规、原业务断言全过 |

最终独立五项：**5 tests，2.529 秒，OK**。之前首次执行因 unittest 收集了导入的 `CrudTests`，
另有原 CRUD 类九项一同执行，总计 14 项、16.252 秒通过；不把这次额外执行重复计作独立覆盖。
SQL 次数会随调度轮次变化，首次为 2,246、最终为 2,200，判定条件是零越界而非固定次数。

为证明上述反证能区分旧新，另起进程通过 `git show c84ce33:...` 读取两个原函数，仅在测试进程内装载，
没有修改工作树或 checkout。对前三项检查得到 **3 tests，0.007 秒，3 failures**：
两条旧读取都越过其他线程持有的锁直接完成；暂停后消费旧依赖函数得到修改后的空列表。
这次预期红结果不等同于自然重现 SQLite 的 C 层异常，但确定性证明补修针对的两条真实边界。

独立重跑持久回归：

```text
# 工作目录：server/
python -X utf8 -m unittest tests.test_review_sqlite_concurrency -q
Ran 4 tests in 0.157s
OK
```

## 规范与行为结论

- Standards：沿用引擎既有 `threading.RLock`，没有引入第二套锁、重试、异常吞噬或格式无关改写；锁覆盖 execute 和取行，符合共享连接的既有串行化约定。
- Spec：结果交付、异常分类与依赖读取都得到保护；snapshot 和 items 在锁内完整取回后才解析/yield。`on_complete` 仍在锁外，独立 Barrier 与跨线程读反证通过，没有以牺牲其他任务推进为代价修复。

## 边界

本机为 Windows / Python 3.13.6，未冒称已在 Linux 或 Python 3.11 运行这些独立探针。
作者自然循环和 CI 的原异常无完整抛出栈，因此没有断言某一条 SQL 是唯一的原始故障点；
本复审直接验证已确认的连接序列化缺口和修复后的关键业务路径。

没有修改生产代码、测试、共享台账或并行前端改动，没有提交推送，没有载入默认 app、真实运行数据或外部服务。
TEMP 测试使用 `ApiCase` 当前的空 legacy 根；未访问真实 ComfyUI 或付费 API。
