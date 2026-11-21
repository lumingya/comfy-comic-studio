# R3-ACCESS-01：WebSocket 令牌生命周期修复

状态：实施与回归完成，待新审查者独立复验；本文不代替独立复审结论。未提交、未推送。

## 根因与修改范围

握手依赖会验证凭据并把 `ApiToken` 存入连接状态，但 jobs WebSocket 后续只等待事件或客户端消息；没有再次读取当前凭据记录。因此 HTTP 已拒绝的旧凭据仍能从既有订阅读取后续任务及预览事件。

仅修改以下生产文件；未修改 `api/access.py`、`api/v2.py`、令牌管理 HTTP 契约、生成客户端或前端：

- `server/mio_server/auth.py`：新增 `TokenStore.revalidate(original, scope=...)`。按握手时的 ID 读取当前记录，以恒定时间比较原始 `secret_hash` 身份，再检查当前绝对到期时间及所需 scope。记录消失、同 ID 密钥轮换、到期、移除 read 均失败；不调用 `verify()` / `touch_api_token()`，不修改活动时间或到期时间，不保留额外明文凭据。
- `server/mio_server/api/jobs.py`：从已有 `ws.state.api_token` 取得握手身份。所有 hello / 任务 / 预览发送共用发送函数，在载荷准备完成后、实际 `send_json()` 前复验。等待循环每隔 1 秒复验闲置连接，也在收到客户端消息时复验；无需等待下一次引擎事件。失效连接关闭码为 1008，错误理由不包含凭据。
- 无令牌的本机 `/api/ws/jobs` 没有上述握手状态，继续工作，也保留 `previews=false` 过滤行为。
- 接收与队列等待任务各保留一个，退出时取消并等待完成；`finally` 取消引擎订阅并清空队列。ASGI 外层作用域已取消时，用 AnyIO shield 完成清理，避免正常 TestClient 断开因清理 await 再次被取消而抛出 `CancelledError`。业务异常没有被通用捕获后吞掉。

## 红 → 绿与回归证据

新文件：`server/tests/test_review_websocket_tokens.py`。每个用例直接构建 TEMP + `memory=True` 的真实 AppContext/TestClient，显式把 `legacy_root` 设到本用例 TEMP 的空根；不创建默认应用、不启动真实任务或模型服务、不进入 TestClient lifespan，不输出凭据。

修复前先执行（工作目录 `server/`）：

```text
python -m unittest tests.test_review_websocket_tokens -q
Ran 1 test in 1.015s
FAIL: expected websocket.close, got websocket.send
```

对应场景是收到 hello 后经本机 HTTP API 撤销 read 令牌，新 HTTP 请求返回 401，接着发布非持久化中性事件。失败断言准确捕获旧 WebSocket 仍收到新事件。最小修复后同一测试 `Ran 1 / OK`。

最终新增的 10 项回归覆盖：

1. 握手后撤销：新 HTTP 401，下一条事件不会转发，WS 1008。
2. 握手后到期：排队的 preview 不转发；用弱引用确认预览载荷在清理后没有被连接持有。
3. 固定的绝对 expires_at 跨过时钟边界：不改令牌记录、不发新事件，空闲连接由真实 asyncio 轮询关闭；时钟是测试注入，不以改过期字段冒充该项。
4. 空闲时撤销：没有新事件也释放订阅。
5. 现有令牌移除 read：后续事件被拒绝。
6. 同一个 ID 轮换到新的密钥：旧连接不能继承新身份。
7. 握手前缺少、已撤销、已到期或没有 read 的凭据均返回 1008，且不建立引擎订阅。
8. 有效 read 连接继续接收任务和 preview；把鉴权模块的单调时间推进到活动节流窗口以后，仍确认活动时间及 SQLite `total_changes` 均未改变，证明复验无 DB 写入。
9. 浏览器 `access_token` 查询参数取得的连接也在撤销后关闭。
10. 无令牌的本机连接正常，并保持 preview 过滤。

失效场景同时核对引擎 listener 恢复基线，事件循环没有残留的 `Queue.get` / `WebSocket.receive_text` 任务。测试传输读设置 3 秒上限，缺失空闲关闭会确定性失败而不会挂住整套测试。

最终发送函数收拢之后执行：

```text
python -m unittest tests.test_review_websocket_tokens -q
Ran 10 tests in 12.345s / OK
```

集中鉴权回归（此前实现已包含完整复验与 shield；随后只收拢发送函数以保证 hello 快照准备完成后才复验，相关最终 10 项已重新通过）：

```text
tests.test_review_websocket_tokens
tests.test_guard
tests.test_api_v2.ScopeTests
tests.test_api_v2.ApiV2Tests
Ran 26 tests in 29.511s / OK
```

该次集中验证通过运行包装器在 `ApiCase.setUp()` 后显式设置 `ctx.legacy_root = Path(self.tmp) / 'empty-legacy'`，再交给 unittest 装载器运行上述四组测试；未修改共享夹具文件。当时标准 ApiCase 尚未修复默认 legacy 根。本轮完成时，另一位修复者已经把该隔离永久移到共享 ApiCase 创建 TestClient 之前。

最终额外执行与本次身份/只读复验有关的既有竞态回归，同样强制 TEMP legacy 根：

```text
tests.test_other_api_review.OtherApiReviewTests.test_first_use_last_seen_write_cannot_resurrect_a_revoked_token
tests.test_other_fresh_recheck.OtherFreshApiTests.test_activity_touch_preserves_scope_edits_and_rejects_rotated_credential
Ran 2 tests in 2.527s / OK
```

对本次三个 Python 文件运行 `ruff check`、`ruff format --check`、`py_compile` 和 UTF-8 文本检查均通过。

## 真实边界与执行偏差

- 本次修复只适用于现有 jobs WebSocket；不声称覆盖扩展自定义 WebSocket。空闲关闭以 1 秒检查周期加事件循环调度延迟为界，未提供跨进程撤销通知或主动中断一个已经阻塞在传输层的 send 的机制。
- 采用真实 TestClient ASGI 通道与 TEMP 数据库验证，没有外部网络、浏览器/E2E、真实 ComfyUI 或付费 API。未运行全仓测试；总门禁、提交与推送由主控协调。
- 初次扩展的 10 项测试命令运行超过工具默认等待时，操作者只返回了 output、遗漏该次会话句柄；没有保存该次完整结果，因此不把它计作验收。后续保留了会话句柄并取得完整结果。
- **第一次集中鉴权命令漏加共享夹具的 TEMP legacy 根包装**。当时共享 `ApiCase` 仍有 R3-ACCESS-02 的已知缺口，执行到工坊权限用例可能读取仓库 `data/`。发现后检查进程时该次已经结束，未回显任何读入数据或令牌，未再读取个人数据确认；该次 `26 tests / 1 ERROR`（正常 WS 断开时清理被取消）不作为隔离验收。之后先修复清理取消问题，再以显式 TEMP 包装重新执行，取得上文 26 项通过的有效证据。此偏差已即时通知主控，不能把首次执行描述成全程纯 TEMP。

建议独立复审优先尝试：在 hello 快照准备与发送之间使原凭据失效；连续客户端消息/高频预览期间撤销；空闲时跨过固定绝对到期时间；同 ID 替换 secret 后验证旧连接关闭且新凭据仍能建立正常连接；确认关闭后没有残留订阅、等待任务或预览引用。
