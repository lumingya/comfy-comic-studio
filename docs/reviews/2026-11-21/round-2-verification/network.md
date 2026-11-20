# 第二轮独立复验：云端网络截止与停止

结论：**R1-CLD-01 可关闭；本次复验没有确认的新开放问题。** 对已经取得实际 TCP socket 的原生 HTTP/HTTPS 请求，总截止、停止、连接所有权和清理均有真实 Windows loopback 证据。DNS / 尚未交回 socket 的建连阶段仍存在明确边界，不能把本结论扩大成所有系统调用均可立即取消。

本代理未参与原实现、第一轮审查或修复。只读取共享台账、相关原报告、修复说明与当前工作代码；只新增本报告，没有修改代码、测试、共享台账，也没有提交或推送。

## 复验对象与环境

- 基线 HEAD：`125e07f`，验证的是其上的当前未提交修复。
- Windows，Python 3.13.6，HTTPX 0.28.1，HTTPcore 1.0.9。没有声称已经覆盖 Python 3.11 或其他操作系统。
- `examples/extensions/standard-image-channels/transport.py` SHA-256：`2317CB2DAA3EA1CF3F1994B70C1D83BA0248CBBF279B668BCC54169F7229CA6F`。
- 新增 `deadline.py` SHA-256：`9D9688C0D3584B543000B916109CC55D0BCD7212DD1006C00454B8E6CFEECE4F`。
- 新增 `server/tests/test_review_cloud_deadline.py` SHA-256：`FBCA2386E5A3A11500A9F6D605CBD7578B2C4C59980CF72E3102742DDD646EBB`。
- 实验只使用本机 loopback、临时测试证书与合成凭据；未访问真实图像服务、个人运行数据或付费 API，未安装依赖，未运行浏览器或 E2E。

## 对实现的独立挑战

1. **取得 TCP 后、TLS 前的所有权。** `transport.py:139–144` 给每个 Transfer 创建私有 SSLContext 和原生 transport，连接重试为零、HTTP/1、空闲复用为零。`deadline.py:42–65` 从 HTTPcore `connection.connect_tcp.complete` 获取实际 TCP socket，TLS 包装时在同一把锁内换成实际 SSLSocket，禁用包装内的自动握手，释放锁后才执行握手。没有把全局 SSLContext 或全局 HTTPX 工厂改成补丁。
2. **Windows 的真正中断。** `deadline.py:67–88` 对持有的 socket 对象先 shutdown 再 close；不是只 shutdown，不是关闭 dup，也没有保存可能被复用的裸 fd。真实 timed recv 负对照证实这种区别，见下表。
3. **迟到的连接与停止竞态。** watchdog 在发送之前启动；若它在 DNS / connect 返回 socket 前已经结束，`capture()` 仍在登记后检查 Transfer 并立即关闭过期或取消的 socket。TLS 所有权切换与 abort 使用同一把锁，没有在网络握手时持锁阻止 watchdog。
4. **清理与并发隔离。** `deadline.py:90–96` 先 done、join、撤销私有 context 的实例覆盖，随后正常响应由 HTTPX 关闭；Transfer 退出关闭整个客户端。每次调用有独立连接与 context，不会把仍受旧 guard 控制的连接交给另一次调用。并发 HTTPS 和正常返回后的实际 fd / handle 检查支持此结论。
5. **失败分类与收费提交。** `transport.py:280–296` 在把传输错误映射成可重试 GET 状态之前重新 `check()`，所以 watchdog 导致的取消 / 截止不会被吞成 503 而继续下载。guard 本身不发请求；生成 POST 不增加重试，下载仍只重试 GET。

以上是对当前代码及当前依赖实现的判断，不是对任意未来 HTTPcore trace 行为的保证。

## 实验与结果

### 既有回归的必要子集

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s server/tests -t server -p test_review_cloud_deadline.py -v
.\.venv\Scripts\python.exe -m unittest discover -s server/tests -t server -p test_cloud_channel_packages.py -v
```

- 新增真实网络模块：**9 项通过，21.701 秒，无 skip**。实际执行了 HTTP JSON / 图片首块后 stall、cancel / adapter close / activation Scope.close 的 JSON / 下载 / 无响应头阻塞、TLS ClientHello 后握手 stall、真实 HTTPS body、正常返回后跨过旧 deadline，以及两个 HTTP Transfer 的并发隔离。
- 原渠道模块：**16 项通过，2.353 秒**。包括四种线协议、参考图、宿主冻结参数与当前凭据、最多一次 POST 的故障矩阵、同源无凭据下载与拒绝跳转、GET 次数、429 冷却重新入场、取消、字节 / 压缩 / 像素 / ZIP 限额和完整解码。这里的协议 / 限额检查主要使用 MockTransport，不能代替真实阻塞证据。

### 独立真实网络探针

补充探针通过 stdin 执行，没有新增测试文件。上传 / 无响应头探针另行构造服务器，复用现有模块加载及临时证书生成辅助；HTTPS 并发、资源计数和 DNS 边界探针复用既有 loopback 服务器夹具，另加私有 context 工厂、对象 / 句柄观测和受控 resolver 阻塞断言。

| 挑战 | 构造与观测 | 结果 |
| --- | --- | --- |
| HTTP / HTTPS 真正上传阻塞 | 原生 Transfer，共用 adapter 的取消 Event / Scope；服务器读完请求头后不读取 body；请求内容为 128 块 × 64 KiB，夹具把两端发送 / 接收缓冲设为 8 KiB。只对 guard 增加事件 / 对象观测，没有替换实际网络 transport。必须看到 `http11.send_request_body.started`，且停止时不能已有 `send_request_body.complete` | 8 个组合全部满足真实写阻塞条件。HTTP / HTTPS 的 0.9 秒总截止分别在 **0.909 / 0.902 秒**结束 |
| 上传中的 cancel / adapter close / Scope.close | 上述 HTTP / HTTPS 阻塞各执行三种停止 | 从发出停止到调用线程退出为 **0.002–0.019 秒**；每次服务器只见 **1 个 POST**，异常保留 `sent=True`；HTTP 关闭对象是 `socket`，HTTPS 是 `SSLSocket` |
| HTTP / HTTPS 无响应头截止 | 服务器读取小请求 body 后完全不发送响应头 | 0.75 秒截止分别在 **0.764 / 0.757 秒**结束，各 1 个 POST，保留 `sent=True` |
| Windows timed recv 负对照 | 真正本机 TCP socket 的 `recv(1)`，timeout=3 秒；另一个线程先 shutdown，等 0.12 秒再 close 同一个实际 socket | shutdown 后线程仍阻塞，close 后在 0.4 秒 join 窗口内结束；整个观察约 **0.129 秒**，最终为 OSError。支持修复必须 close 实际对象的依据 |
| 并发 HTTPS socket / SSLContext 所有权 | 两个 adapter 具有相同配置、凭据和 Scope，同时等在各自 HTTPS 响应体首块后；仅停止一个，分别试 cancel 与 deadline。每个 Transfer 都通过真实原生 context 工厂新建 context，再加入临时测试 CA | 两种情形中，另一个请求始终仍在等待，释放后成功得到原 PNG；每种情形共 2 个 POST（两个独立调用各一次），两个 context 对象不同，仅目标 guard abort 了 SSLSocket |
| guard 与实际 socket 清理 | 上述上传及并发探针记录 guard、TCP 对象、TLS 对象；结束后检查 thread、context 实例覆盖、socket 引用与 fileno | 所有观测 guard 都已 join、`socket is None`；context 中无实例级 `wrap_socket` 覆盖；并发 HTTPS 持有的 TCP 与 TLS 对象全部 `fileno() == -1`，全局 `ssl.SSLContext.wrap_socket` 未变化 |
| 正常短请求资源循环 | 预热一次，再连续完成 20 次原生 HTTP 图片请求；在同一已启动服务器下，通过正确声明 64 位 ctypes 函数原型的 `GetProcessHandleCount` 计数，不调用 `gc.collect()` | Windows 进程 handle **201 → 201**，watchdog 为 0；总共 21 次独立调用、21 个 POST |
| 无 socket 的 DNS 边界 | 只在测试进程中延迟 resolver 回调，进入后取消并先等待 0.12 秒，然后显式释放 resolver；释放后仍走真实本机解析 / 建连及 trace | 释放前调用仍阻塞，释放后明确返回取消，服务器没有收到 POST，watchdog 为 0。此项是受控的 resolver 阻塞，不冒充真实公网 DNS 故障测试 |

上传夹具特意检查阻塞阶段：最初把一次性 8 MiB JSON 当作上传探针时，Windows 可以先完整接受该次 send，trace 显示已经进入响应头等待，因而不将其计作上传证据；正式结果来自有上述 trace 断言的分块请求。底层 Transfer 的上传证据覆盖原生写路径与 adapter 的停止信号，不声称所有渠道参考图编码方式均已逐一实服验收。

## 保留的准确边界

- **DNS / 尚未交回 socket 的 OS 建连不是立即可中断阶段。** 当前剩余时长传给 HTTPX 的 connect timeout，但 resolver 与操作系统的底层行为不由 watchdog 抢占；不能由此声称 DNS 一定被该数值严格截断，也不能承诺这段时间内立即 close / cancel。受控探针实际展示了取消须等 resolver 返回。现有 README 与修复说明已明确这一点，不应把它重新写成无条件的严格总截止保证。
- 已有 socket 后也只是本机实测容差内的响应，不是硬实时调度保证。watchdog 最多每 25 ms 轮询停止，线程调度和系统负载可能增加延迟。
- 自定义注入 transport 的内部阻塞由其自身负责；当前 guard 只用于原生 transport。cloud_adapter v1 也没有核心逐任务取消回调；adapter / activation 停止不代表已收费的远端任务已停止。
- 20 次成功循环和本轮有限并发未见资源泄漏，不能证明任意长期负载、所有网络异常或所有未来依赖版本都不存在泄漏。没有运行全量测试，未重复主控的其他验证，也未访问外部 DNS / 服务来扩大覆盖。

综上，原始“首块之后 stall 使总截止超时”的缺陷及其相关 socket 阶段已得到实际修复，新的取消与所有权路径未在本轮挑战中发现回归；建议按上述边界关闭 R1-CLD-01。
