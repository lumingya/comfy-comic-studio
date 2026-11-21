# 第三轮：旧调度模块与 Webhook 发送端

审查基线：`ddf8d81f5a8d3b624da9618718599374de2f61f6`。本报告独立检查原始 `6aa0f8f...ddf8d81` 改动清单之外的模块，不重新申报前两轮已关闭的 publication、SDK 接收端问题。结论为 **4 项 P2、1 项 P3**，尚未修复。

所有实验只用 SQLite `:memory:`、`TemporaryDirectory`、内存 `httpx.MockTransport`、仓库 `FakeComfy` / `FakeLLM`；没有访问实际 ComfyUI、云端、收费接口或用户运行数据，没有修改生产代码、生产测试与共享台账。密钥只在进程内比较，没有输出密钥或签名。

## R3-SCHED-01 — P2：队列状态写失败后，下一次推进重复创建生成任务

- 位置：`server/mio_server/queue.py:237-249,252-264`；关键是 `render.render(...)` 已创建任务后，才保存 `active_job`，且未提供幂等键。
- 触发：`start` 已保存待办 lane，`_start_album` 提交任务成功，随后 `_save(q)` 出现写盘错误或进程在两次独立提交之间退出。持久 lane 仍含该画册，`active_job` 仍为空。
- 预期：重新推进应找回同一已创建任务，不再次请求生成。
- 实际：重新 `advance()` 创建第二个不同 ID 的任务；只跟踪第二个，第一个仍留在任务引擎中可被调度。实测 `jobs_after_failure=1`、`jobs_after_retry=2`、`distinct_jobs=2`、`active_job_matches_first=False`。
- 影响：恢复时可能重复 GPU / 云端生成和计费，串行画册队列出现未跟踪的并行任务。实验停在提交阶段，没有执行上游；重复提交本身已由真实引擎确认。
- 最小修法：在启动前持久化该次 lane entry 的稳定启动 token，将它传作生成幂等键，并恢复/复用已经创建的任务。不能只用永久 `album_id`，否则用户以后明确重跑会复用旧任务。

最短离线复现（仓库根目录执行 `python`，代码从标准输入传入即可；模拟的是第二次队列文档写入失败，不改任务引擎）：

```python
import sys, tempfile
from unittest.mock import patch
sys.path.insert(0, "server")
from mio_server.context import AppContext
from mio_server.models import Series, Episode, Panel, PanelOverrides
from mio_server.render_models import ComfyInstance
from tests.api_harness import FakeComfy, FakeLLM

with tempfile.TemporaryDirectory() as root:
    ctx = AppContext.create(root, autostart=False, memory=True, seed_instance=False,
                            llm_factory=FakeLLM, comfy_client_factory=FakeComfy)
    try:
        ctx.store.put_doc(ComfyInstance(id="probe", base_url="http://fake"))
        ctx.refresh_instances()
        s = ctx.store.create_series(Series(title="queue-probe"))
        ep = ctx.store.create_episode(Episode(series_id=s.id, order=0, title="one",
            panels=[Panel(order=0, description="room",
                          overrides=PanelOverrides(raw_prompt="a quiet room"))]))
        real_put, writes = ctx.store.put_doc, [0]
        def put(doc):
            if type(doc).__name__ == "WorkshopQueue":
                writes[0] += 1
                if writes[0] == 2:
                    raise OSError("queue state save failed")
            return real_put(doc)
        with patch.object(ctx.store, "put_doc", side_effect=put):
            try:
                ctx.queue.start([s.id])
            except OSError:
                pass
        assert ctx.queue.state().active_job is None
        assert len(ctx.engine.list(owner=ep.id)) == 1
        ctx.queue.advance()
        assert len(ctx.engine.list(owner=ep.id)) == 2  # actual; expected 1
    finally:
        ctx.close()
```

## R3-SCHED-02 — P2：一条已保存的错误端口配置使健康实例也无法调度

- 位置：`server/mio_server/jobs/pool.py:19-26,135-150`；入口校验仅检查协议，见未改动的 `server/mio_server/render_models.py:168-174`（`ComfyInstance.http_only`）与 `server/mio_server/api/library.py:370-374`。
- 触发：已有健康实例后新增 `base_url="http://fake:abc"`。真实 `create_instance` 成功保存并刷新；初次加入时 `set_instances` 没有旧 slot，未触发其条件中的地址归一化。
- 预期：保存阶段拒绝非法端口；已有坏配置也应被隔离，不阻止其他实例。
- 实际：`plan` 先逐个遍历空闲实例、归一化地址，之后才检查 candidate 的允许实例。`urlsplit(...).port` 抛 `ValueError`，整个计划中止；即使唯一候选明确只允许健康 `b` 仍失败。删除错误实例后同一候选可计划 1 项。后续刷新实例时也可能因已有坏 slot 再次抛错。
- 影响：一次连接地址输入错误可持续阻断整个 Comfy 调度，后台循环只能重复记录异常，健康实例空闲也不能接单。
- 最小修法：统一严格验证实例 URL（包括 hostname、端口和 IPv6），持久化之前完成校验；资源池对历史非法 slot 进行隔离并报告诊断，不让一个 slot 使整轮计划失败。

```python
import sys
from types import SimpleNamespace
sys.path.insert(0, "server")
from mio_server.api.library import create_instance
from mio_server.storage import SQLiteStore
from mio_server.render_models import ComfyInstance
from mio_server.jobs.pool import ResourcePool, Candidate, COMFY

store, pool = SQLiteStore(":memory:"), ResourcePool()
ctx = SimpleNamespace(store=store,
    refresh_instances=lambda: pool.set_instances(store.list_docs("instance")))
try:
    create_instance(ctx, ComfyInstance(id="b", base_url="http://healthy"))
    create_instance(ctx, ComfyInstance(id="a", base_url="http://fake:abc"))
    candidate = Candidate("job", 0, COMFY, instances=("b",))
    try:
        pool.plan([candidate])
    except ValueError:
        print("healthy-only plan failed")  # actual
    store.delete_doc("instance", "a")
    ctx.refresh_instances()
    assert len(pool.plan([candidate])) == 1
finally:
    store.close()
```

## R3-EVENT-01 — P2：重试继续使用已停用 / 已轮换密钥的 Webhook 快照

- 位置：`server/mio_server/webhooks.py:119-132,142-156`。管理接口已正确更新数据库，发送端却在整个重试循环保留最初的 `Webhook` 对象。
- 触发：首个请求返回 503，2 秒退避期间通过真实 `update_webhook` 轮换 secret 或停用该 hook；下一次尝试开始时变更已经完成。
- 预期：下一次未发出的尝试尊重最新启停状态；轮换后使用当前密钥，或显式取消旧配置版本的待发送投递。
- 实际：轮换后第二次请求 `last_uses_current_key=False, last_uses_old_key=True`；停用后仍发送第二次请求并得到 200。这里没有要求撤回已经发出的请求，问题发生在退避结束后新建的请求。
- 影响：正常密钥轮换可使尚未完成的事件被接收方拒绝并停止重试；紧急停用后仍继续对原地址外发事件。更改 URL / 删除 hook 也缺少重试前重新确认，但这两种变体本轮未另跑实验。
- 最小修法：为 hook 配置提供版本，逐次尝试前重新读取并核对其存在性、启用与事件选择；对轮换/地址变更制定明确的取消或重签策略，保持同一投递 ID 不变。手动 `ping` 也要有明确例外语义。

```python
import sys, httpx
from types import SimpleNamespace
sys.path.insert(0, "server")
from mio_server.storage import SQLiteStore
from mio_server.webhooks import Dispatcher, Webhook, sign
from mio_server.api.access import update_webhook, WebhookPatch

store = SQLiteStore(":memory:")
try:
    hook = store.put_doc(Webhook(url="https://example.test/hook", events=["*"]))
    requests, rotated = [], {}
    def receive(req):
        requests.append(req)
        return httpx.Response(503 if len(requests) == 1 else 200)
    d = Dispatcher(store, transport=httpx.MockTransport(receive))
    ctx = SimpleNamespace(store=store)
    def rotate(_):
        rotated.update(update_webhook(ctx, hook.id, WebhookPatch(rotate_secret=True)))
    d.sleep = rotate
    d._fan_out("take.created", {"probe": True})
    req = requests[-1]
    stamp = req.headers["x-mio-timestamp"]
    assert req.headers["x-mio-signature"] == sign(hook.secret, stamp, req.content)
    assert req.headers["x-mio-signature"] != sign(rotated["secret"], stamp, req.content)
    requests.clear()
    d.sleep = lambda _: update_webhook(ctx, hook.id, WebhookPatch(enabled=False))
    d._fan_out("take.created", {"probe": True})
    assert not store.get_doc("webhook", hook.id).enabled
    assert len(requests) == 2  # actual; expected no second request after disable
finally:
    store.close()
```

## R3-EVENT-02 — P2：被配置校验放行的非法 URL 会吞掉后续其他订阅者的事件

- 位置：`server/mio_server/webhooks.py:50,131-132,154-162`。
- 触发：先配置 `http://example.test:abc/hook`，再配置合法 hook，两者均订阅同一事件。模型正则和真实创建接口的模型校验会放行错误端口；`httpx` 在发请求前抛 `InvalidURL`。
- 预期：创建时拒绝错误 URL；一个 hook 的投递错误只记录该 hook 的失败，后续 hook 仍收到事件。
- 实际：`InvalidURL` 不属于当前捕获的 `httpx.HTTPError`；异常逃出 `deliver` 和整个 `_fan_out`，被 `_run` 外层吞下并将事件视为出队。后排合法 hook 请求数和投递记录均为 0，且没有该事件的重投入口。
- 影响：一个错误订阅会持续静默阻断其他合法订阅的生成完成 / 采用 / 导出事件，自动化消费者可能一直等不到完成信号。
- 最小修法：保存前进行实际 URL 解析校验；`_fan_out` 按 hook 隔离异常并记录失败；不要把配置错误当作可重试网络错误，也不要中止其他订阅者。

```python
import sys, httpx
sys.path.insert(0, "server")
from mio_server.storage import SQLiteStore
from mio_server.webhooks import Dispatcher, Webhook

store, requests = SQLiteStore(":memory:"), []
try:
    store.put_doc(Webhook(id="invalid", url="http://example.test:abc/hook", events=["*"]))
    store.put_doc(Webhook(id="valid", url="https://example.test/good", events=["*"]))
    d = Dispatcher(store, transport=httpx.MockTransport(
        lambda req: requests.append(req) or httpx.Response(200)))
    try:
        d._fan_out("take.created", {"probe": True})
    except httpx.InvalidURL:
        pass
    assert requests == []  # valid hook was also skipped
    assert not d.deliveries.get("valid")
finally:
    store.close()
```

## R3-EVENT-03 — P3：并发首次 emit 可创建两个发送线程，close 遗留一个

- 位置：`server/mio_server/webhooks.py:98-104,172-176`。
- 触发：两个作业 / 请求线程同时首次发布事件，均观察 `_thread is None`。构造线程和赋值之间发生一次合法线程切换。
- 预期：只创建一个发送线程；关闭时该发送线程全部退出。
- 实际：在构造器处用 barrier 固定上述抢占，得到 `created_workers=2, alive_after_close=1`。两个线程都消费队列，但只保留一个引用；`close` 只放一个结束 sentinel，只 join 最后引用。实验结束前已补发 sentinel 并 join，未留下实验线程。
- 影响：违背模块声明的单线程投递保证；已关闭 dispatcher 遗留 daemon worker 和对象引用，多次生命周期会积累。未据此声称实际事件丢失或跨进程数据泄漏。
- 最小修法：用同一把生命周期锁保护 closed 检查、worker 唯一创建和关闭；或在构造 dispatcher 时即启动唯一线程，并定义关闭时的队列清理。

```python
import sys, threading
from unittest.mock import patch
sys.path.insert(0, "server")
from mio_server.storage import SQLiteStore
from mio_server.webhooks import Dispatcher

store = SQLiteStore(":memory:")
d, workers = Dispatcher(store), []
real_thread, barrier = threading.Thread, threading.Barrier(2)
def construct(*args, **kw):
    worker = real_thread(*args, **kw)
    workers.append(worker)
    barrier.wait(2)
    return worker
senders = [real_thread(target=d.emit, args=("take.created", {"n": n})) for n in range(2)]
try:
    with patch("mio_server.webhooks.threading.Thread", side_effect=construct):
        for t in senders: t.start()
        for t in senders: t.join(3)
    d.flush()
    d.close()
    assert len(workers) == 2
    assert sum(t.is_alive() for t in workers) == 1
finally:
    for t in workers:
        if t.is_alive(): d._queue.put(None)
    for t in workers: t.join(2)
    store.close()
```

## 实际覆盖与反证

- 完整阅读旧模块：`jobs/pool.py`、`jobs/lease.py`、`jobs/dependencies.py`、`jobs/state_leases.py`、`queue.py`、`webhooks.py`、`api/jobs.py`、`api/access.py`。上述文件均不在原始变更清单中。
- 为验证接口边界另读：`api/workshop.py` 队列接口、`api/library.py` 实例 CRUD、`render_models.py` 实例模型、`api/series.py` 画册状态/删除回调、`context.py` 初始化/关闭、`extensions/sdk.py` 作业提交、`registry.py` 和 `comfy/contracts.py` 的身份解析。读取关联实现不代表逐行审查这些完整文件。
- 原变更文件只作依赖证据阅读：`jobs/engine.py` 启动/提交/取消/重试/删除，`jobs/runtime.py` claim/finish/aggregate，`jobs/executors.py` 绑定/重绑，`jobs/operations.py` 锁序；以及 `pipeline/render*.py` 的提交链。没有重新审计 publication 或 SDK 消费去重。
- 自有并发探针：两线程同时 claim 同一 item，容量设为 2，仍只成功 1 次、busy=1；执行完成 busy=0、`endpoint_active={}`。这反证了本次固定时序下的重复 claim 和普通释放泄漏，不证明所有重配竞态。
- 自有 OS 租约探针：TEMP 同路径数据库的第二个引擎被 `LeaseHeld` 拒绝；第一个 close 后可重新打开。文件锁没有 TTL，持久 state lease 也刻意不自动过期；按契约保留未知远端状态不作为“过期租约”缺陷。
- 定向执行 `tests.test_state_leases.StateLeaseTests` 的五项：`test_claim_rechecks_endpoint_after_configuration_changes_during_plan`、`test_claim_rollback_clears_runtime_ownership_and_capacity`、`test_restart_keeps_presend_lease_uncertain_and_other_jobs_blocked`、`test_update_replaces_data_and_stale_token_cannot_release_new_lease`、`test_cancel_keeps_token_valid_and_restore_never_adopts`。5 项通过，0.190 秒。它们只支持对应实例重配/回滚/重启/旧 token/取消恢复时序，没有被当成整个调度正确的证明。
- 依赖解析核对了快照、逐项 stages、refinement、内置 adapter 和固定来源/digest 路径；本轮未发现可由正常核心提交触发的新增缺陷。未将畸形扩展自定义输入推测包装成已复现漏洞。
- 交付前从本报告提取并逐段执行全部 5 个 Python 复现块，全部复现，随后检查 UTF-8 无 BOM、无替换字符。报告复现块既是复核入口，也是修复后可转为正式回归测试的最小夹具；其中缺陷现状断言在修复后应改为对应的预期行为。

未验证：真实服务、付费请求、真实进程强退 / 断电窗口、跨平台 Linux 文件锁、DNS/IP 别名表示同一物理服务、真实 HTTP 慢响应/无限正文、无限事件积压、浏览器 WebSocket 事件竞争、全量生产调度组合。队列窗口用精确故障注入确认，没有冒称做过物理断电实验。未运行全量测试，也未修改任何生产测试。
