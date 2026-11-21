# R3-EVENT-01 / 02 / 03：Webhook 重试、配置隔离与生命周期

范围仅限 `server/mio_server/webhooks.py`、`api/access.py` 的 Webhook 创建/更新校验及新增 `server/tests/test_review_webhook_dispatch.py`。未改令牌、WebSocket、调度器或生成接口，也未修改 API schema 与生成客户端。

## 根因与最小红回归

- **R3-EVENT-01**：`deliver` 在整个重试循环保留入口时的 Webhook 对象；真实管理接口完成配置更新后，后续尝试仍读取旧 URL、旧密钥与旧启用状态。
- **R3-EVENT-02**：原 URL 正则不解析端口；HTTPX 的 `InvalidURL` 不是 `HTTPError`，原捕获范围遗漏它，异常中止整个 fan-out。
- **R3-EVENT-03**：首次 emit 的检查/构造/赋值未同步；两个调用者可以各启动一个 worker，close 却只保留最后一个线程的引用。

修复前执行以下三项正式回归（`PYTHONPATH=server`，均无实际网络请求）：

```text
.venv/Scripts/python.exe -m unittest tests.test_review_webhook_dispatch.WebhookConfigurationTests.test_retry_uses_current_key_and_url_with_same_delivery tests.test_review_webhook_dispatch.WebhookConfigurationTests.test_legacy_bad_url_is_isolated_and_later_hook_still_receives tests.test_review_webhook_dispatch.WebhookLifecycleTests.test_simultaneous_first_emits_start_one_worker_and_close_joins_it -v

Ran 3 tests in 4.296s
FAILED (failures=2, errors=1)
```

失败信号分别为实际 URL 仍为旧路径、`InvalidURL: Invalid port` 逃出 fan-out、构造 worker 数量为 2 而非 1。并发红回归的 finally 主动结束原实现遗留的 worker，没有遗留实验线程。实验只比较内存中的凭据，不输出密钥或签名。

## 实现与约定

### 逐次读取当前配置

每次首次发送或退避结束后，重新从 store 读取相同 hook ID。检查 hook 仍存在、URL 可解析且无 userinfo、签名密钥非空；普通事件还必须仍启用且仍被订阅。读取失败、删除、停用、取消订阅或配置失效会停止该次投递；轮换密钥与变更 URL 则使用当前值继续发送。同一投递的 JSON body、body 内 ID 和 `X-Mio-Delivery` 保持不变。

手动 `ping` 明确允许测试停用或未订阅该事件的 hook，仍要求当前 hook 存在且 URL / 密钥有效。HTTP 测试接口保持同步且不重试。

### 写入拒绝与历史配置隔离

`validate_webhook_url` 由 Webhook 创建/更新入口与每次运行时发送共用：检查 HTTP(S) scheme、host、端口与 IPv6 解析，拒绝 userinfo、反斜线、空白、超长 URL 等输入。校验异常只输出固定说明，不带输入 URL、查询参数或凭据。

没有把新的 URL 解析规则放进持久化模型的反序列化 validator：历史非法端口记录仍能被逐条读取与删除，不会因新增 validator 使 `list_docs` 整批失败。运行时对该 hook 记 `attempts=0` 的失败并继续后排订阅者。HTTPX `InvalidURL` 单独按不可重试的配置错误处理；其他单 hook 异常也不再中止 fan-out。

投递历史及 warning 日志不复制传输异常的文本，也不复制失败响应正文：二者可能回显 URL 或签名凭据。网络失败只保留异常类别，HTTP 失败只保留状态码。

### 单 worker 与关闭语义

同一生命周期锁保护 closed 检查、入队、唯一 worker 的创建及关闭 sentinel。默认退避改用停止 Event 的可唤醒等待。close 停止接收新事件，唤醒退避，丢弃尚未开始的队列事件；当前已经发出的 HTTP 请求可正常完成，随后 worker 退出。普通调用线程上的 close 会 join 该 worker 后再返回，不以短 join timeout 留下线程。重复 close 不重复入队 sentinel；消费 sentinel 也配对 `task_done`。

不能撤回已开始的网络请求，也没有持有 store 锁覆盖网络调用；本修复保证每次新尝试先重新读取当前配置，不宣称配置检查与 socket 发送之间是跨线程原子事务。close 可能等待当前请求的 HTTPX 超时；自定义 transport 若自身永久阻塞，需由 transport 提供退出机制。未新增网络取消线程或外部服务调用。

## 回归范围与结果

新增 10 项正式测试覆盖：

1. 真实 HTTP PATCH 在退避期间轮换密钥并更换 URL，后续签名与地址使用当前值，投递 ID / body 稳定。
2. 真实 HTTP PATCH / DELETE 在退避期间停用、删除、取消订阅，均不再发送第二次请求。
3. 退避期间注入坏 URL、空密钥、非法事件选择，均不再尝试发送。
4. 创建与更新均拒绝非法端口、超范围端口、缺 host、非法 IPv6、userinfo、错误 scheme 与超长 URL；错误不回显敏感输入且不覆盖原配置。
5. 历史非法端口 hook 在合法 hook 之前时，失败只记给坏 hook，合法订阅者仍收到一次请求。
6. 传输异常与 503 响应正文含测试凭据时，历史错误不回显 URL 或密钥。
7. 停用且未订阅的 hook 仍能手动 ping，一次请求不重试。
8. Barrier 固定两次首次 emit 的交错，始终只构造一个 worker，关闭后线程退出。
9. 在途请求、两个排队事件、close 与关闭后的 emit 交错，只允许在途请求完成，其余不发送，任务计数归零；重复 close 无剩余任务。
10. close 唤醒默认退避，不开始下一次请求，worker 退出且任务计数归零。

集中验证：

```text
PYTHONPATH=server
.venv/Scripts/python.exe -m unittest tests.test_review_webhook_dispatch tests.test_api_v2.WebhookTests -v
Ran 12 tests in 11.004s
OK

ruff check server/mio_server/webhooks.py server/mio_server/api/access.py server/tests/test_review_webhook_dispatch.py
All checks passed!

ruff format --check server/mio_server/webhooks.py server/mio_server/api/access.py server/tests/test_review_webhook_dispatch.py
3 files already formatted
```

限定文件 `git diff --check` 与 UTF8 Text Guard 检查通过。第一次修复后集中运行中，历史坏 URL 的测试接收器本身先返回 503，产生一次正确重试，造成测试请求数预期失败；仅把该用例接收器改为 200 后，上述集中重跑全部通过。

全部使用临时 AppContext 工作区、内存 SQLite、HTTPX MockTransport、Event / Barrier 与受控线程。未访问 ComfyUI、收费接口、真实 webhook 服务或个人运行数据，未启动浏览器、E2E；全仓门禁与独立复核由主控集中执行。本记录等待全新代理独立复审，不作为作者自审关闭结论。
