# TLS stall 夹具独立窄复审

日期：2026-11-21。范围：相对 `c1efed0` 的 `server/tests/test_review_cloud_deadline.py` 补修。

## 结论

**本轮未发现需要补修的问题，可关闭“TLS stall 测试夹具是否绕过真实 TLS / Deadline、放宽时限或污染早期连接错误分类”的审查项。**

这不等于还原了固定 CI 中 `first=True + connection failed` 的唯一原因，也不代替最终提交在 Windows Python 3.11 上的远端 CI。独立探针环境是 Windows / Python 3.13.6 / HTTPX 0.28.1。

## 独立反证路径与实际结果

先读实际 `AGENTS.md`、项目入口文档、目标 diff 与生产 `Deadline` / `Transfer` 路径，先确定以下反证，再读取作者 `../fixes/tls-deadline-ci.md`。未重复作者的 27 项集中回归。

1. **真实 TLS 与真实绝对截止。** 对 `SSLSocket.do_handshake`、`Deadline.abort` 只加调用原实现的观测包装，不替换握手、时钟、watchdog 或 socket。客户端实际进入原生 `SSLSocket.do_handshake`，loopback 服务实际读到 TLS handshake record / ClientHello 前缀；原始 `Deadline.abort` 由 `mio-image-deadline` 线程调用，当时绝对截止剩余 **-0.006273 秒**，被关闭对象是实际 `SSLSocket`。输入仍为 `timeout=1.2`，请求在 **1.206771 秒**返回包含 `deadline` 的 `LLMError`，低于原 1.5 秒上限，返回后 watchdog 已 join。排除了用模拟异常、空 TCP 读取或仅靠伪造 guard 让正例通过的路径。
2. **提前 TLS EOF 仍为连接失败。** 用同一真实客户端向 `tls_close=True` 的 loopback peer 握手；peer 收到 ClientHello 后立即关闭。请求在 **0.001705 秒**返回，仍有 **2.998371 秒**预算，异常包含 `connection failed`、不包含 `deadline`，且 `sent=False`；`first=True`，watchdog 已 join。没有把所有握手失败一律改称 deadline。
3. **无 ClientHello 不能抢先标记阶段。** 分别向 `tls=True` 服务发送空 EOF、6 字节无关数据和仅 3 字节的 TLS record 头，均等待服务关闭连接以确认输入已处理；三者均保持 `first=False`。这与第 1、2 组的真实 TLS 正例形成可区分对照。此检查针对受控夹具阶段标记，不把 6 字节前缀识别宣称为完整 TLS 协议校验器。
4. **生产证书验证仍有效。** 夹具内私有 context 仍为 `CERT_REQUIRED` 且 `check_hostname=True`；退出夹具后包内 context 工厂恢复为原对象。在有真实临时自签名证书的 HTTPS loopback 服务上，明确恢复原生产 context 工厂后再调用真实适配器：默认验证在 **0.614594 秒**拒绝该证书，返回 `connection failed`、`sent=False`，服务未收到 HTTP 请求。实际原工厂仍以 `trust_env=False` 创建 `CERT_REQUIRED` / `check_hostname=True` 的 context。

## diff 与作用域检查

- `test_review_cloud_deadline.py:176–199`：无 ServerHello / 证书的 `tls=True` 握手停滞场景预建本次夹具独占 context；已有 `https=True` 分支继续使用临时 CA / 服务证书。补修没有关闭 TLS 验证。包内 `create_ssl_context` 的临时替换由 `ExitStack` 恢复，不修改 SSL / HTTPX 全局工厂。
- `test_review_cloud_deadline.py:190–199`：`observe_start` 记录 guard 后立即调用保存的原 `Deadline.start`，没有替换 watchdog 行为；第 1 组进一步观测到真实原生握手与实际截止后的 socket 中断。
- `test_review_cloud_deadline.py:321–347`：保留 `timeout=1.2`、`elapsed < 1.5` 和 deadline 消息要求；新增 EOF 负例同时约束剩余预算、消息分类及 `sent=False`，没有增加 retry、skip 或停滞正例预算。
- 失败诊断仅记录 elapsed、返回后的 remaining、异常类名与 errno，不复制异常正文、响应体、URL 或凭据。该 remaining 是返回后观测值，不能推断为底层异常发生瞬间的值。
- 相对 `c1efed0`，生产 `examples/extensions/standard-image-channels/deadline.py` 与 `transport.py` 均为零 diff。

## 作者证据对照与边界

独立探针完成后读取作者说明。其报告明确区分了已证实的夹具设置依赖、慢 CA 注入的确定性红绿结果，以及尚未自然复现的原 CI 完整失败组合；没有把 CA 加载宣称为原 CI 唯一根因。这一证据边界应在最终台账中保留。

作者报告的 27 项相关回归通过、慢 CA 注入红绿结果属于作者证据，本复审未重复执行，也不将它们列作独立实测。本复审没有发现需要继续扩大到生产截止实现的具体证据。

## 隔离与执行说明

探针在 `%TEMP%/mio-tls-independent-*` 中运行，`MIO_V3_DATA` 指向相应临时目录；临时包装 `socket.socket.connect` 拒绝非 loopback 连接。仅导入目标测试夹具、适配器及所需模块，核验未导入默认 `mio_server.app`；未读取真实用户 data、访问真实服务或付费 API。未写源码、未提交或推送。

首个探针脚本的业务断言全部完成后，因脚本仍以临时目录为当前目录，Windows 拒绝删除空目录，进程退出 1。随后已在独立脚本中核对该目录确为 TEMP 下的空目标并清除；后续探针在 `finally` 中恢复 cwd，脚本退出 0 且确认临时目录已删除。该清理错误属于本次探针脚本，不计作产品或测试夹具通过 / 失败的证据。
