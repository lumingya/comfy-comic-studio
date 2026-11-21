# R3-SCHED-01 / R3-SCHED-02 修复与复审入口

修复基线：`ddf8d81f5a8d3b624da9618718599374de2f61f6`。原发现见
[scheduler-events.md](../round-3-adjacent/scheduler-events.md)。本报告只覆盖队列持久启动身份与
ComfyUI 实例 URL 保存边界、历史配置隔离，不覆盖同报告的 Webhook 问题。

所有新回归均使用 `TemporaryDirectory` / SQLite `:memory:`、`autostart=False` 与仓库
`FakeComfy` / `FakeLLM`。没有访问真实 ComfyUI、云端、收费服务或用户运行数据，没有浏览器
E2E，没有安装依赖、重启服务或提交推送。队列重启实验真实关闭并重新创建临时目录中的
`AppContext` 和两份 SQLite 数据库；故障注入代替物理断电。

## R3-SCHED-01：稳定意图覆盖任务提交与队列回执的独立提交窗口

### 原因与修复

原队列只在 `render.render(...)` 返回后保存 `active_job`。任务库已提交而队列库保存失败时，
下一次推进无法辨认原提交，重新创建任务。

- `models.py:840` 的 `WorkshopQueue.lane_tokens` 保存「画册 ID → 本次入队 token」。旧文档
  默认空字典，仍可读取；不是永久以 `album_id` 复用任务。
- `queue.py:132-143`：每次画册新入 lane 时生成新 token，与 lane 一起先落盘。已在 lane
  中的画册不重置 token。旧 lane 在首次提交前补 token 并先保存，保存失败时尚无任务。
- `queue.py:229-276`：恢复先按 token 使用 `engine.find_submission` 找回已冻结任务，再
  处理暂停、磁盘与后续画册。即使卡片被重排，已接单任务仍先绑定，不被其他画册超车。
- `queue.py:279-297`：任务查找优先于读取可变画册、计算缺图和重新构造请求；新提交将
  token 传给现有渲染/任务引擎幂等路径。提交已落盘但返回时抛异常，也会找回原任务。
- 原任务回执与 lane/token 消费在同一队列文档保存。保存失败，持久 lane/token 仍可恢复；
  保存成功，活动任务 ID 已持久化。`_active_job` 也只在文档保存成功后更新。
- 正常消费、移出、清空和遗忘均清理对应 token。完成或取消后的明确新轮次，以及原格
  再次成为缺图后的明确重画，生成新 token 与新任务。

### 已验证的回归

`server/tests/test_review_queue_pool.py::QueueRecoveryTests`：

1. 活动任务回执连续三次写失败，关闭并重开真实临时数据库；重开前后只有一个任务 ID。
   恢复前修改提示词仍返回原冻结任务，不重算请求；实际 FakeComfy 执行次数等于原任务
   item 数，没有第二任务引起的重复上游执行。
2. 旧 lane 的 token 首次落盘失败，任务数为零；恢复写入后创建且只创建一个带幂等键任务。
3. 提交已经 commit 而返回时异常，队列仍绑定原任务，不把画册当作失败跳过。
4. 任务在回执恢复前已完成；重开后清理旧 lane/token，既不新提交也不新增 FakeComfy 调用。
   将同一格候选恢复为未采用后明确重画，得到新任务 ID。
5. 两本画册按入选顺序执行；第一本回执失败后暂停、实际重启、取消第一任务，暂停期间
   不创建第二任务；恢复后才启动第二本。之后明确再跑第一本，使用新 token。
6. 回执失败后重排卡片，仍先恢复已接单第一本，第二本没有任务。
7. `remove` / `clear` / `forget` 清理 token；再次入队使用不同 token。

## R3-SCHED-02：入口拒绝错误配置，历史坏实例单独隔离

### 原因与修复

原模型只检查协议前缀；资源池在调度前直接访问 `urlsplit(...).port`。错误端口可先保存，
并在后续整轮计划中抛异常，即使候选只允许另一个健康实例。

- `jobs/pool.py:19` 的 `normalize_endpoint` 同时负责 URL 实际解析校验和稳定身份归一化：
  检查 HTTP(S)、主机名、空白/控制字符/反斜线、端口以及 IPv6 authority。默认端口与
  尾随斜线仍归并为原身份，保留合法 IPv6、反向代理路径及查询串。
- `api/library.py:372`：POST 保存前调用同一解析函数；PUT (`:380`) 复用 POST，因此
  更新同样先校验，非法更新不覆盖原实例。HTTP 错误仍沿现有 `ValueError` → 400 路径。
- **故意没有强化 `ComfyInstance` 的持久化解码 validator**。历史非数字端口或坏 IPv6
  仍可解码、列出、修改或删除，不会让整个 `list_docs("instance")` 返回 500。
- `ResourcePool.set_instances` 对每个错误实例独立捕获 `ValueError`，标记 `healthy=False`
  并保存 `configuration_error`。快照暴露 `error` 诊断，其他实例继续计划；重复 refresh
  不会再抛异常。手动 `mark_health(True)` 不能绕过配置错误，修正配置后恢复可调度。
- `/instances/{id}/health` 也先验证 URL；历史错误配置返回 `ok=False` 及错误说明，
  不构造真实客户端。已在运行的旧端点仍按运行时捕获的地址释放，不解析当前坏配置。

### 已验证的回归

`server/tests/test_review_queue_pool.py::InstanceIsolationTests`：

1. 拒绝非数字、越界、零和空端口，缺失主机、非法主机字符、缺括号/无括号/带尾缀 IPv6；
   保存前失败，数据库无新增实例。
2. 非法 PUT 保留原健康实例配置。
3. 默认 HTTP/HTTPS 端口、IPv6 默认/显式端口和反向代理路径稳定归一化。
4. 历史坏实例 a 与健康 b 同时存在，限制只用 b 的候选成功计划；重复刷新、实例列表和
   健康诊断继续可用，a 有诊断且不可调度；修正 a 后可调度。
5. 真实临时 FastAPI 路由拒绝坏 POST 为 400；注入历史坏实例后 GET 列表为 200，包含
   原配置及 pool 错误诊断。
6. 繁忙 a 被替换为历史坏配置后，健康 b 仍可计划；按运行时捕获的旧地址释放时，旧
   `endpoint_active` 计数归零，不被新坏配置阻断。

## 执行证据与复审命令

在修复之前已经真实执行最短红灯：

```powershell
$env:PYTHONPATH='server'
python -m unittest tests.test_review_queue_pool -q
```

当时 3 项、0.277 秒，`FAILED (failures=2, errors=1)`：跨实际重启 `2 != 1`、坏端口保存
未抛错，以及 `pool.plan` 抛 `ValueError: Port could not be cast to integer value as 'abc'`。

完成生产修改后集中执行：

```powershell
$env:PYTHONPATH='server'
python -m unittest tests.test_review_queue_pool tests.test_workshop_queue tests.test_jobs tests.test_state_leases -q
```

当时 58 项、17.459 秒，全部通过。随后只增加三个边界回归，没有再修改生产实现；定向重跑
`tests.test_review_queue_pool` 为 13 项、3.224 秒，全通过。原集中覆盖因此合计 61 项。

```powershell
python -m ruff check server/mio_server/queue.py server/mio_server/jobs/pool.py server/mio_server/models.py server/mio_server/api/library.py server/tests/test_review_queue_pool.py
python -m ruff format --check server/mio_server/queue.py server/mio_server/jobs/pool.py server/mio_server/models.py server/mio_server/api/library.py server/tests/test_review_queue_pool.py
git diff --check
```

上述 lint、格式和 diff 检查通过。`WorkshopQueue` schema 增加了持久字段；生成的 OpenAPI /
前端类型由主控统一更新，本分支任务不写生成物。

## 未验证边界

没有物理断电、真实 GPU、付费云端、浏览器 E2E 或全后端门禁。没有新增跨两个数据库的
事务；这里使用先持久启动意图、后提交幂等任务、再保存回执的可恢复协议。用户明确删除
任务引擎中的历史任务、底层数据库本身损坏、外部直接篡改 token 不在本轮恢复契约内。
URL 检查不做 DNS/连通性探测，也不识别不同域名或代理地址是否实际指向同一物理服务。
