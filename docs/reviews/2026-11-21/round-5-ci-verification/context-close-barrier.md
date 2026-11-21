# AppContext 最终关闭屏障独立窄复审

结论：在本轮限定范围内未发现新的生产问题，最终关闭屏障通过独立反证探针。该结论不代表整套 CI 或其他生命周期路径已经通过。

## 范围与独立性

- 工作树：`C:\Users\QIU\.codex\worktrees\adversarial-ci-20261121\comfy-comic-studio`。
- 基线与当时 HEAD：`f87a6132d36658d0763a367ad18fb0fc0c1a85a2`；复审对象是尚未提交的 `server/mio_server/context.py`、`server/mio_server/update/updater.py` 改动。
- 先读实际 AGENTS、README、路线图及两文件 diff，独立形成并发排空、同线程重入、清理异常与迟到写入反例，再读作者的 `fixes/close-race.md`。
- 不改源码、测试、共享台账，不提交或推送，不接触主工作区。除本报告外未写入仓库文件；探针由 Python stdin 执行。

## 源码判断

`AppContext.close()` 的同一把 `RLock` 覆盖完整 closer 序列，因此另一个线程不能在第一个调用等待 updater 时继续取走数据库和租约清理函数。锁内的 `_closing` 使同线程 closer 回调再次调用 `ctx.close()` 时直接返回，剩余清理由外层继续执行。

`Updater.close()` 在状态锁内封闭入站操作，随后在不持有状态锁的情况下等待 worker，并经过 `_execution` 等待同步检查。`check()` 保存最终状态所需的锁仍然可用。`serialized` 只允许同一已接纳操作的嵌套步骤越过封口，新的顶层变更会被拒绝。

## 独立探针与实测

在创建任何 AppContext 前替换 `Updater._http` 为受控 `httpx.MockTransport`，并将 `catalog.API` 指向 `http://127.0.0.1/releases`。处理器断言所有请求主机均为 `127.0.0.1`；数据仅在系统 TEMP，未导入默认 app、未连接真实外网。

只重跑一个成功 worker 场景，同时包含三个并发关闭者、同线程递归回调和有意抛出的清理异常。复用现有测试中的合法协议响应 `httpx.Response(200, json=[])`。事件卡住 HTTP 响应，代理锁只记录锁请求并委托原始锁，代理 join 只记录进入屏障并委托真实 join；没有 sleep，也没有改变生产串行语义。

独立运行结果：**exit 0 / 1.338518 秒 / PASS**。

| 验证点 | 实际证据 |
| --- | --- |
| 2 个以上并发 close 等待相同屏障 | 3 个线程都已请求关闭锁；第一个已进入 worker join；响应未放行时 3 个完成事件均未置位，原锁不能被探针线程非阻塞取得 |
| 更新未完成时资源仍保留 | 数据库查询成功，真实 `FileLease` 再次取得工作区租约抛 `LeaseHeld`，其余真实 closer 均尚未执行 |
| 同线程递归不会排空剩余资源 | 回调中再次调用 `ctx.close()` 前后，closer 数目与调用计数完全相同；数据库仍可读且租约仍被持有 |
| 清理异常不会漏掉后续清理或重复执行 | 递归回调随后抛出预期 `RuntimeError`；捕获到恰好 1 条带该异常的生产日志，8 个真实 closer 均恰好执行 1 次；重复 close 后计数不变 |
| 状态保存先于资源释放 | 包装器调用真实 `_save_state()`，保存时再次核实 store 可读及真实租约仍持有；真实 `state.json` 保存恰好 1 次 |
| 关闭完成与无迟到写入 | 放行后 3 个关闭线程与 worker 全部 join，worker 为 idle，租约可重新取得；实际删除 updates 后，7 个变更命令均抛 `UpdateError`，启动检查及重复 close 不新增请求、不重建目录；真实 `shutil.rmtree(workspace)` 成功 |

7 个拒绝命令为 `check`、`start_check`、`preferences`、`download`、`stage`、`cancel_pending`、`apply_pending`。整条探针仅发生 1 次 MockTransport 请求；线程错误列表为空。

## 实验偏差与边界

首个探针用了自行构造的签名清单，在成功保存断言处得到 `writes=[]`，进程 **1.303 秒 / exit 1** 退出。该次已经经过并发等待、资源保留、递归不排空和清理计数断言，但没有证明成功保存路径；不将这一失败算作产品问题或完整通过。所有自建线程均在 finally 中放行并 join，没有挂起 exec、遗留线程或生产死锁。随后按上述合法目录协议仅修正探针输入，单次重跑通过。

本轮没有独立重跑作者的 48 项或 7 项测试，也没有重新运行旧版 close；作者记录的旧版 0.161 秒红环不是本代理新取得的证据。同步 check 的等待关系在源码中核对，本轮动态结果专指上述 worker 场景及 closer 抛异常场景，不扩称为完整异常矩阵。

HTTPX 的现有 I/O 超时不是整个更新操作的硬性总截止。屏障会等待已接纳操作，本报告不承诺 close 在固定总时长内返回。
