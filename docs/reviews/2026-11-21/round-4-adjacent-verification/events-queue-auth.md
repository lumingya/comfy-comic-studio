# 第四轮独立复审：事件、队列、WebSocket 与测试输入隔离

复审日期：2026-11-21。基线为 `ddf8d81f5a8d3b624da9618718599374de2f61f6`
之上的当前未提交工作补丁。本审查者不是第三轮原审查者，也不是本次修复作者；结论来自
当前源码、实际故障注入及独立补充探针，没有把作者报告的测试数字当作关闭依据。

**结论：下列七项均可在本报告边界内关闭，未发现新的已实证缺陷。**

| 原 ID | 独立结论 | 判定依据 |
| --- | --- | --- |
| R3-SCHED-01 | 已关闭 | 启动 token 先持久化，任务已接单但回执失败后跨实际重开仍绑定原任务；新轮次产生新身份 |
| R3-SCHED-02 | 已关闭 | POST / PUT 保存前解析 URL；历史坏端口只隔离该实例，健康实例仍可计划、查询及释放旧端点 |
| R3-EVENT-01 | 已关闭 | 首次及每次退避后均重读当前 hook；第二次退避才变更也生效，同一投递身份保持稳定 |
| R3-EVENT-02 | 已关闭 | 无效 URL 保存被拒，历史坏 URL 记录零次尝试且不阻断后排合法 hook |
| R3-EVENT-03 | 已关闭 | 首次并发 emit 只启动一个 worker；close 唤醒退避、等待在途请求并排空剩余任务 |
| R3-ACCESS-01 | 已关闭 | hello 和后续发送前、客户端消息及 idle 均复验当前凭据身份；失效及取消均释放资源 |
| R3-ACCESS-02 | 已关闭 | 共享 ApiCase 在创建 client 前设 TEMP 空根；四项样例显式装载清单内公开 fixture |

## 执行边界

只读了本轮共享台账、两份第三轮原报告和四份对应修复记录；核心复核范围为
`queue.py`、`jobs/pool.py`、`api/library.py` 的实例段、`models.py` 的 WorkshopQueue、
`webhooks.py`、`api/access.py` 的 Webhook 段、`auth.py` 的凭据复验、
`api/jobs.py` 的 jobs WebSocket，以及共享测试夹具和对应测试。
`context.py`、`api/v2.py`、`pipeline/render.py`、`jobs/engine.py` 和
`shipped_data_fixture.py` 只按调用链局部阅读，不宣称逐行全覆盖。

所有执行均使用显式 TEMP AppContext、临时 SQLite / `:memory:`、FakeComfy / FakeLLM、
HTTPX MockTransport 或 TestClient 内存 ASGI 通道。没有外网、真实账户、真实 ComfyUI、
收费服务、默认 App 入口、TestClient lifespan、launcher / pip / 服务启动、浏览器或 E2E。
没有对被拒路径尝试打开、删除或清理。仅新增本报告，未修改代码、测试、共享表或生成物，
未派下级、未提交推送。

## R3-SCHED-01：持久启动身份与明确新轮次

`queue.py:133-143` 在新 lane entry 上生成 token，先与 lane 一起保存；历史 lane 没有
token 时，`:257-261` 也先保存意图再进入生成。`:234-245` 的恢复分支先按 token 查已提交
任务，再处理暂停、重排和磁盘条件；`:279-297` 在读取可变画册或重算缺图前找回冻结任务。
实际提交把 token 传入已有 engine 幂等路径，而不是仅依赖内存 `_active_job`。
`:109-112` 只在队列文档成功保存后更新该内存回执。

本次实际执行并检查了以下故障路径，而非只确认出现 `idempotency_key` 字段：

- 活动回执连续写失败，任务库已经有任务；关闭并重开 TEMP 中真实的两份 SQLite 数据库，
  修改画册提示词，再推进。只有原任务 ID，恢复原冻结任务并执行 FakeComfy，执行次数与
  原任务 item 数相等，没有第二任务导致的重复生成。
- 旧 lane 的 token 首次保存失败时任务数为零；恢复保存后才创建一个任务。
- render 已提交却在返回时抛异常，仍找回原任务，未把该画册跳过。
- 原任务在队列回执恢复前已完成，重开推进不会再提交或调用 FakeComfy；同一格恢复为
  缺图后明确再开始，会创建新任务。
- 两册批次回执失败后暂停、实际重开、取消原任务，暂停期间第二册不启动；恢复后才启动。
  重排也不能让第二册超越已接单第一册。之后明确重跑第一册，token 和任务 ID 均更新。
- remove / clear / forget 会移除待办 token，再次入队不会永久复用原身份。

正常 HTTP 工坊装配、顺序启动、采用、跳过已齐图、暂停/恢复、并发设置与故障提示的
`test_workshop_queue` 同批通过。由此关闭的是两个独立数据库提交之间的恢复窗口；不是
以永久画册 ID 阻止一切后续重画。

## R3-SCHED-02：坏配置隔离与正常调度

`jobs/pool.py:19-64` 的统一解析函数检查端口、主机和 IPv6 authority。
`api/library.py:372-383` 在写入前调用它，PUT 复用同一保存入口。
`pool.py:100-130` 对历史坏实例单独写 `configuration_error` 并置为不健康；
`:132-137` 不允许 health 标记绕过配置错误。没有加强持久模型解码规则而使历史坏记录
变成整批不可读，这是与运行时隔离配套的必要部分。

除本次重跑错误端口矩阵、重复 refresh、配置修正恢复、旧端点释放回归外，另用真实 TEMP
TestClient 组合验证：正常 POST 得 201；将同一实例 PUT 为 `http://fake:abc` 得 400，
原配置仍为 `http://fake`；再直接保存一条历史坏端口记录并 refresh，限定健康实例的
candidate 仍计划 1 项，历史实例 health 为 false，实例列表仍为 200。

这里保留了合法 IPv6、默认端口归一化及反向代理路径，未通过删除健康功能来规避异常。
关闭范围是配置解析与单实例故障隔离，不包含 DNS 或真实端点连通性。

## R3-EVENT-01：每次退避后重新决定是否发送

`webhooks.py:191-210` 每次尝试都重新读取相同 hook ID，检查存在性、URL、签名密钥与
当前 enabled / event 选择；签名和目标 URL 取当前记录。JSON body 和 delivery ID 在循环
之前固定。手动 ping 明确绕过启用/订阅筛选，但仍读取当前有效配置，不重试；本次正常
ping 路径也实际执行。

作者新增回归实际重跑了第一次退避中的真实 HTTP PATCH / DELETE：停用、删除和取消
订阅后没有第二次请求；轮换和 URL 修改后按当前配置发送，投递 ID / body 不变。

独立探针进一步把变更延后到**第二次退避**：前两次请求均返回 503，第一次退避不变更；
只在第二次退避分别停用、删除、取消订阅或轮换密钥并更换 URL。

```text
second_backoff_disable: requests=2; stable body/delivery
second_backoff_delete: requests=2; stable body/delivery
second_backoff_unsubscribe: requests=2; stable body/delivery
second_backoff_rotate: requests=3; stable body/delivery
```

轮换分支另外逐字节比较第三次签名与当前密钥产生的签名，并比较新 URL；只在内存比较，
没有输出密钥、签名或凭据。这反证了“只在首次重试刷新一次”的不完整修法。

## R3-EVENT-02：单订阅错误不再吞掉后排事件

`validate_webhook_url` 由创建 / 更新入口和运行时共用，HTTPX InvalidURL 不再落在遗漏的
异常类型之外。`webhooks.py:165-171` 的 fan-out 对每个订阅分别隔离异常，deliver 对历史
配置失效给出固定错误；传输错误和响应正文也不复制到日志或投递记录。

实际重跑了创建/更新拒绝矩阵及原配置不被覆盖断言；将历史坏端口 hook 排在健康 hook
之前后，坏项记录 `attempts=0` / `status=None`，后排仍收到一次请求。失败响应正文和
MockTransport 异常故意含内存实验凭据时，投递记录没有回显 URL 或密钥。

该结果支持原问题关闭，没有把失败订阅的静默跳过误当成全部发送成功；坏项仍有可查询
的失败记录。本次没有新增对真实 Webhook 接收方的外发实验。

## R3-EVENT-03：worker 唯一性与 close

`webhooks.py:130-138` 用同一生命周期锁保护 closed 检查、入队与 worker 创建；
`:243-257` 的 close 也在这把锁下设置停止事件、发送唯一结束 sentinel，再在锁外 join。
默认退避等待可由 stop Event 唤醒，消费 sentinel 也经过 task_done。

本次实际执行构造 barrier 的并发首次 emit：只构造一个 worker，close 后退出。
在途请求被 Event 阻塞时，随后再排两条事件并从另一线程 close；close 等待在途请求，
释放该请求后仅这一条发送，未开始的事件被丢弃，worker 已退出，unfinished_tasks 为零。
重复 close 及关闭后 emit 没有增加任务。默认退避中的 close 也立即唤醒并阻止下一次请求。

关闭的是原来的双 worker / 遗留 worker 缺陷。close 仍允许已经开始的请求完成；对于
自行永久阻塞的自定义 transport，本报告不声称提供了强制中断机制。

## R3-ACCESS-01：发送前、idle 与取消清理

`auth.py:124-138` 以握手时 ID 重新读当前记录，恒定时间比较原 secret_hash 身份，再检查
当前 expiry / read scope；没有写 last_used_at。`api/jobs.py:151-180` 将 hello 与后续事件
统一经 send 包装，在载荷准备完成后、send_json 前复验，并在客户端消息或一秒 idle 超时
复验。`:181-193` finally 取消并等待 getter / receiver，解除引擎订阅并清空队列。

当前 10 项专项回归实际通过，覆盖撤销、同 ID 密钥替换、scope 移除、修改 expiry、固定
绝对 expiry 跨时钟、query token、有效 read / 本机无 token 连接与 preview 过滤；同时核对
复验没有 SQLite 活动写入、listener 回到基线、无 Queue.get / receive_text 遗留。

独立补充了四条与发送时机和取消直接有关的反证：

1. 在 `engine.list(active_only=True)` 构造 hello 快照期间撤销原 token。连接接受后首个
   数据/关闭帧就是 1008 close，没有 hello；订阅和 IO 任务均回基线。这排除了把复验放在
   载荷准备之前而漏掉该窗口的实现。
2. 握手后以同 ID 替换 secret；旧连接收到 1008。用替换后的真实新凭据建立新连接，
   hello 和后续中性事件都正常，证明没有以整体禁用该 ID 代替身份复验。
3. 撤销后只发送客户端 keepalive、不发布引擎事件，连接仍以 1008 关闭。
4. 直接调用同一 job_socket，在一个中性 preview 已进入异步 send 等待时取消连接任务。
   清理后 listener 等于原基线，没有新增未完成 child task，preview 的弱引用已释放。

```text
hello_snapshot_then_revoke: first frame close=1008; no hello; no pending IO/listener
same_id_rotation: old close=1008; replacement credential receives current event
client_message_after_revoke: close=1008; no engine event needed
cancel_inflight_preview_send: listeners restored; no child tasks; preview weakref released
```

取消探针的 socket 仅提供内存事件与可阻塞 send；前三条走真实 TestClient ASGI 通道。
二者分别验证清理分支和已装配路由行为，没有把一个 mock 的结果冒称为网络传输验证。

## R3-ACCESS-02：默认空输入和四项明确公开样例

`api_harness.py:72` 在构造 TestClient 前把 legacy_root 设到该用例 TEMP/empty-legacy。
两个隔离回归先把生产 LEGACY_ROOT 改指 TEMP 哨兵、截获 importer._load_dir，再实际访问
本机工坊和 scoped storyboard API；两次都成功且 reader 零调用，默认根也确实不存在。
因此不是仅在已经导入工坊后再改 root 的表面隔离。

`test_workshop.py:15-19` 的 shipped_workshop 明确只要求 storyboards 与
presets/characters；四个公开样例用例在 `:22,43,141,175` 显式调用，普通用例不调用。
没有枚举未列入清单的数据内容，也没有复制整个 data。

本次四例执行采用更严格输入边界：先通过 `git show HEAD:data/distribution.json` 与清单内
的上述两类文件构造 TEMP public source，再对该测试模块的 copy_shipped_data 注入此 source。
原辅助函数在 source 显式指定时只读 TEMP；四例正常通过。这样既验证装配、快照、克隆和
preview 的真实样例语义，又不在本轮读取本机 repo/data 内容。

需要区分源码合同与本次实验：既有 copy_shipped_data 的默认合同允许读取清单白名单的
本地文件、校验哈希后再从 Git fallback。本补丁没有更改该辅助函数，本报告也不把它称为
“默认从不读取 repo/data”。已关闭的是**未声明样例的 ApiCase 隐式 fallback**；四例是
显式公开 fixture，且本次运行额外保证其输入来自 Git HEAD → TEMP。

## 本次实际执行记录

集中执行以下六组，四例 public source 注入如上；`PYTHONPATH=server`，解释器为仓库
`.venv/Scripts/python.exe`，没有执行 discover 全仓或任何 launcher：

```text
tests.test_review_queue_pool
tests.test_review_webhook_dispatch
tests.test_review_websocket_tokens
tests.test_review_test_isolation
tests.test_workshop
tests.test_workshop_queue

Ran 51 tests in 44.441s
OK
```

另一个从 stdin 执行、未写入仓库的独立探针进程集中运行上文四条 WS、第二次退避四变体
和 HTTP PUT / 历史实例组合，退出码 0。所有断言均比较实际记录、事件/关闭帧、任务状态、
请求内容或资源生命周期，没有输出任何凭据。

没有跑全后端门禁、前端、生成一致性或远端 CI；这些由主控协调。本报告也不证明物理断电、
底层数据库损坏、人为删除引擎历史、扩展自定义 WebSocket、DNS 别名或真实网络故障已覆盖。
配置复核与下一条 socket send 之间没有跨线程事务，不能撤回已经开始的发送；idle 复验
精度是现有一秒周期加调度延迟。上述边界不等于本次原缺陷仍未关闭。
