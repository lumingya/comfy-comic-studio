# R1-CLD-01：云端响应的绝对截止与停止

## 目标与根因

只修标准图像渠道包的原生 HTTP 阻塞读取，不改收费提交与重试政策。原实现只在 `next(response.iter_raw())` 前后检查时钟，HTTPX 则把建请求时的剩余时长固定为后续每次 read timeout；先收到一块再 stall 时，第二次读取重新等待最初的超时，突破总截止。

新回归 `test_short_json_block_then_stall_obeys_absolute_deadline` 走真实本机 `ThreadingHTTPServer` 与 socket，2 秒总截止、0.65 秒后送首字节再停顿。修复前执行：

```text
.venv/Scripts/python.exe -m unittest discover -s server/tests -t server -p test_review_cloud_deadline.py -k short_json -v
FAIL: 2s deadline took 2.659s (expected < 2.35s)
```

这里没有用忽略 timeout 的 MockTransport 模拟网络卡住。Windows 的额外实验证明：带 timeout 的 Python socket 等待于 select，仅 shutdown 实际 socket 或它的 dup 均不能及时唤醒；shutdown 后 close 实际 socket 可以。因此最终实现没有使用已被实测否定的 shutdown-only / dup 方案。

## 改动与并发清理保证

- `transport.py`：原生调用创建本 Transfer 专用 HTTP/1 transport、SSLContext 和客户端，关闭空闲连接复用，连接重试为零。每个请求的 guard 在调用 HTTPX 之前启动，并通过 HTTPcore 请求 trace 的 `connection.connect_tcp.complete` 登记实际 TCP socket。
- 新增内部 `deadline.py`：watchdog 只观察单请求 deadline / adapter cancel / activation stop，不执行任何网络请求。截止时，或每 25 ms 检查到停止时，在锁内 shutdown 并关闭本请求实际 socket，以中断真实阻塞。同步请求仍在调用方线程执行。
- TLS 使用这个 Transfer 的私有 SSLContext 的 `wrap_socket` 回调：握手前在锁内把登记对象从 TCP socket 换成实际 SSLSocket，再释放锁进行握手。没有修改全局 SSLContext、httpx 工厂或全局网络行为。测试为信任临时证书，仅局部替换本包的 context 工厂，不改 httpx / ssl 全局。
- 正常或异常返回都先设置 done、join watchdog、恢复私有 SSLContext 方法，再关闭响应。guard 仅保留实际 socket 对象，不保存裸 fd，也没有全局 socket 注册表；专用连接不向其他 Transfer 或后续请求复用，延迟取消不会随描述符复用误关其他连接。正常路径关闭由 HTTPX 负责，guard 不抢先关闭成功响应。
- 传输异常映射前重新 `check()`：watchdog 导致的异常仍明确报告取消/截止；已提交 POST 保留 `sent=True`，GET 的取消/截止不会被包装成 503 继续重试。仍然只有一次生成 POST，下载同源且去除 Authorization / Cookie，既有 429 冷却、GET 次数、HTTP 字节、图片和 ZIP 限额不变。

## 新回归范围

新文件：`server/tests/test_review_cloud_deadline.py`；原有 cloud tests 只读。

1. HTTP JSON 首块后 stall，2 秒总截止在 2.35 秒容差内结束；一次 POST、保留 sent。
2. 同源图片 GET 首块后 stall，沿用同一生成 deadline；下载无 Authorization / Cookie、没有重复 POST 或停止后的 GET 重试。
3. `cancel()`、adapter `close()`、activation `Scope.close()` 分别中断 JSON、下载与尚无响应头的读取；停止后 0.4 秒内调用线程结束。
4. TLS ClientHello 后握手 stall 的 deadline、cancel 与 activation close；没有跳过真实 socket。
5. 用 OpenSSL CLI 在 TEMP 生成短效 localhost 自签证书和私钥，验证真实 HTTPS JSON / 图片的绝对截止与取消/关闭；证书文件在上下文退出时删除，不提交或输出私钥。CLI 不存在时仅这两项 HTTPS 证书测试显式 skip，其他 HTTP 和 TLS 握手测试仍执行。本机使用 Git for Windows 附带 OpenSSL，执行时无 skip。
6. 正常分块完成后 watchdog 已退出；跨过旧截止再调用仍可成功。
7. 两个 adapter 共享 Scope、相同配置和凭据，两个 socket 同时处于分块等待；一个 cancel 或到达 deadline 时另一个仍保持读取，之后放行并成功得到图片。

## 保证边界

watchdog 在拿到 TCP socket 后可抢占 TLS 握手、响应头、响应体及 socket I/O。DNS / 尚未交回 socket 的 OS 建连只能传入当前剩余 connect timeout，不能保证这些系统调用可立即取消或严格抢占总截止。注入的自定义 transport 负责其自身阻塞取消，本包仍在返回块之间检查。`cloud_adapter v1` 没有核心逐任务取消回调，本修复没有新增远端取消 API，也不承诺取消已收费的远端任务。

## 验证

已执行结果：

- 新 9 项真实网络测试：全部通过（21.374 秒），含全部真实 HTTPS 测试，无 skip。
- 既有 `test_cloud_channel_packages.py`：修复后通过 16 项（2.178 秒）。
- `test_offline_cloud_adapter.py`：通过 1 项。
- 包内 6 个 Python 文件与新测试：ruff check / format 均通过；限定文件的 `git diff --check` 通过。
- 最终集中运行 `test_cloud*.py` 与 CTK 曾被并行导出改动的暂时导入错误阻塞：`lettering.py` 导入当时尚未写回的 `composition.character_x`；未改这些文件、未把导入失败视作网络断言失败。待相关作者完成后只重跑这些受影响检查。

未访问真实服务、未收费、未读个人运行数据、未运行浏览器或 E2E。

供新代理独立复审重点：实际 Windows timed recv 的关闭、TCP→TLS 所有权窗口、停止后的 GET 不重试、watchdog join 与并发隔离、DNS/建连前的真实边界。
