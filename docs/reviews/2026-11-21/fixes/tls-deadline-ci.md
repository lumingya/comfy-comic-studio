# R1-CLD-01：Windows CI 的 TLS 目标阶段夹具加固

状态：只补修真实 TLS 测试夹具与诊断，27 项相关回归通过；生产截止、停止及异常分类均未改动。精确最终提交的远端 CI 和新代理独立复核由主控完成。

## 远端实际失败与证据边界

固定提交 `5682a43` 的 CI `44879871255` 中，主门禁及 Ubuntu Python 3.11 全部通过。
Windows Python 3.11 的 `test_tls_handshake_stall_obeys_deadline` 在原第 294 行失败：
收到的是 `Image service connection failed`，而不是带 `deadline` 的异常。
它此前的 `first` 和 1.5 秒耗时断言已经通过。

CI 没有记录该次底层异常、剩余绝对时长、TLS record 或 watchdog 状态，
因此不能从这条消息唯一断言是生产截止竞态、真实早期连接失败或夹具阶段不稳定。
本次没有自然复现 **CI 那次 `first=True + connection failed` 的完整组合**，没有把别的红结果冒称为它。

本机环境为 Windows / Python 3.13.6，而非 CI 的 Python 3.11；没有另装运行时或访问外网。

## 诊断与已确认的夹具问题

候选依次为：

1. 底层 TLS timeout 略早于绝对时钟截止，异常分类时仍有微小正余量。
2. 真实早期 TLS / TCP 错误；此时保持 connection failure 才是正确行为。
3. 夹具没有把计时隔离到目标握手阶段，包括信任库加载和空 TCP 读取被误当 ClientHello。

检查确认 watchdog 每次 `Event.wait()` 返回后都会回到循环头重算剩余时长，
没有“wait 略早返回就直接 abort”的路径。没有因此修改生产代码。

直接运行原单项测试的本机首次结果为：

```text
python -X utf8 -m unittest tests.test_review_cloud_deadline.CloudDeadlineReviewTests.test_tls_handshake_stall_obeys_deadline -v
Ran 1 test in 1.243s
FAIL: first is False
```

这不是原 CI 的完整失败组合，但证明原测试可能在目标 TLS 阶段尚未成立时耗尽预算。
测得默认 HTTPX SSLContext 创建耗时 0.472 秒；八次只观测真实 loopback 的探针中，
默认 context 设置耗时 0.465–0.600 秒，消耗原 1.2 秒预算的显著部分。
预建专用 TLS 客户端 context 的构造约 0.00075 秒。

八次真实握手观测（默认和预建 context 各四次）都返回 deadline；
底层为 `ConnectError` 或 `ConnectTimeout`，被观测时已超过截止 4–14 毫秒。
另做 24 次短预算边界检查，未观察到 `connection failed`；仅首次 0.1 秒冷启动没有进入握手。
这些有限结果不用于证明某种 Windows / Python 3.11 竞态不存在，也不支持把所有连接错误归为截止。

## 确定性红绿：移除与目标握手无关的 CA 加载

在独立测试进程中，把本包默认 context 工厂暂时替换成“等待 1.3 秒后返回真实 SSLContext”，
模拟慢信任库加载；随后执行未放宽的原单项 TLS 测试。
这只作用于受控测试，不修改 HTTPX / SSL 全局，不替换实际 TCP 或 TLS 握手。

| 夹具 | context 工厂调用 | 结果 |
| --- | --- | --- |
| 原夹具 | 1 次 | 1.461 秒，`first=False`，确定失败 |
| 新夹具 | 0 次 | 1.229 秒，实际 ClientHello 后握手等待、deadline 断言通过 |

新夹具在开始计时前已经准备了该测试专用 context，因而不调用被注入慢 CA 加载的工厂。
这个反证证明补修消除了已确认的无关设置依赖，**不证明原 CI 恰好遭遇了 1.3 秒 CA 加载**。
原短探针及 JSON 结果使用 `%TEMP%/mio-tls-ca-fixture-*`，只含本机合成测试信息。

## 最小改动

仅修改 `server/tests/test_review_cloud_deadline.py`：

- `tls=True` 的纯握手 stall 场景提前创建本次夹具独占的 `SSLContext(PROTOCOL_TLS_CLIENT)`。
  该服务从不返回 ServerHello / 证书，故不需要加载宿主信任库；没有禁用生产证书验证。
  真实 HTTPS / 证书验证场景仍使用原临时 CA 夹具。
- 服务端确认收到 TLS handshake record 和 ClientHello 类型后才标记 `first`。
  空读取、无关 TCP 数据不再构成“已进入握手”的证据。
- 保留原 `timeout=1.2`、`elapsed < 1.5` 和异常必须含 `deadline` 的断言；未增加重试、超时或 skip。
- 测试只观察真实 Deadline 对象，不改变它的行为。失败诊断增加 elapsed、返回后的 remaining、
  底层异常类型及 errno；不复制异常正文、请求 URL、响应体或凭据。
  该 remaining 是请求返回后的观测值，不能伪称是底层异常发生瞬间的时钟值。
- 新增真实提前 TLS EOF 反向回归：收到 ClientHello 后立即关闭 peer，
  必须在仍有超过一秒预算时保持 `connection failed`，不含 `deadline`，且 `sent=False`。
  这直接防止用 blanket deadline 映射隐藏真实早期连接错误。

`examples/extensions/standard-image-channels/deadline.py` 与 `transport.py` 均未修改。

## 集中验证

```text
# 隔离 worktree 的 server/
python -X utf8 -m unittest tests.test_review_cloud_deadline tests.test_cloud_channel_packages tests.test_offline_cloud_adapter -q
Ran 27 tests in 21.730s
OK
```

包括新增的 10 项真实 HTTP / TLS / HTTPS 测试、既有 16 项渠道协议与生命周期测试、
1 项离线适配器测试，没有条件跳过。上述慢 CA 工厂反证随后在新夹具上通过。
测试文件 Ruff lint / format、编译及 UTF-8/BOM 检查通过，定向 `git diff --check` 通过。

## 边界与交接

- 本补修针对已证实的测试目标阶段依赖和可诊断性，不宣称唯一还原原 CI 的连接错误原因。
- 生产绝对截止与停止路径没有改动，真实早期 TLS 错误仍明确保留原分类。
- 未访问用户运行目录、默认 App、真实生成服务、付费 API、外部 DNS 或浏览器。
- 只编辑隔离 worktree 中约定的测试和本文；未改共享台账、其他代理文件或主工作区，未提交推送。
- 新复审者应独立确认：TLS 场景仍走实际 SSLSocket/Deadline，原时限未放宽，
  实际 ClientHello 才标阶段，早期 EOF 不被包装成 deadline；最终 Windows Python 3.11 结论由远端 CI 给出。
