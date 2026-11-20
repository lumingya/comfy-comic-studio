# R1-MED-01：ASGI 2.4 媒体响应的确定性清理

状态：修复完成，待新代理独立复审。未提交或推送。

## 问题范围与证据

本项是受支持 ASGI 响应路径的清理加固。原审查只在 outer scope 声明 ASGI 2.4、`send` 抛出 `OSError` 的分支证明文件和并发槽延后清理；不能据此宣称默认 Uvicorn 0.40.0 的 ASGI 2.3 路径有同一漏洞。原报告：[Bridge/UI](../round-1-changes/bridge-ui.md)。

新增回归直接调用真实 `dispatch_media`，用本地 ASGI `Response` 产生 128 KiB 二进制，再执行返回响应的 `__call__`，无网络、扩展安装或个人运行数据依赖。`TemporaryFile` 仍是真实临时文件，只记录文件关闭次数；`release` 独立计数，不使用上层已经幂等的包装掩盖重复调用。

修复前运行：

```powershell
.venv/Scripts/python.exe -m unittest discover -s server/tests -t server -p test_review_media_disconnect.py -k test_asgi_24_disconnect_at_headers_or_first_chunk_closes_immediately -v
```

结果：1 个测试中的响应头、首块两种子场景均失败；Starlette 转换为 `ClientDisconnect` 后，立即检查 `output.closed` 仍为 `False`。检查时保留 response 与 iterator，不执行 `aclose()` 或 GC。

## 修复

- `server/mio_server/extensions/panel_media.py:39`：私有 `_MediaResponse` 保留 Starlette 的流和异常语义，在整个 `__call__` 的 `finally` 同步清理资源；不依赖 `BackgroundTask` 仅在成功分支执行，也不依赖生成器何时析构。
- `panel_media.py:123`：清理回调使用本地幂等标志，文件关闭和并发槽释放最多各执行一次。即使文件关闭抛出异常，也在 `finally` 释放槽。
- `panel_media.py:223`：生成器只负责原有 64 KiB 分块和激活状态检查。清理归响应所有，避免生成器耗尽时、最终 ASGI body 标记发送前就释放槽。
- 权限、真实路由鉴权、MIME、字节和像素上限、原始二进制传输及安全响应头均未变更；`test_panel_media.py` 未修改。

## 生命周期与回归覆盖

`server/tests/test_review_media_disconnect.py` 共 7 个测试：

| 情况 | 保证 |
| --- | --- |
| ASGI 2.4 响应头或首块发送抛出 `OSError` | 保留 `ClientDisconnect`，响应调用退出前立即关闭文件、释放一次；显式 `aclose()` 不重复清理 |
| outer `send` 抛出其他异常 | 保留原异常，同样立即清理 |
| 在发送响应头或首块时取消响应 task | 保留 `asyncio.CancelledError`，退出前立即清理 |
| ASGI 2.3 listener 在响应头或首块处收到 `http.disconnect` | 原有取消响应语义正常，文件关闭和释放各一次 |
| ASGI 2.3 / 2.4 普通完成 | 每次 `send`（包含最终空 body）时文件和槽仍归响应占用，完成后各清理一次，原始 payload 完整 |
| 扩展已停用 | 不交付数据块，响应结束后清理一次 |
| 内层 producer 在返回 response 前抛出 `CancelledError` | `dispatch_media` 原有异常清理继续有效，关闭和释放各一次 |

响应头失败或响应头阶段取消覆盖了 generator 从未开始消费的情况；首块失败覆盖暂停在 yield 的情况。清理边界是服务端调用并终结响应 `__call__`。任意内部调用者若取得 response 却从不调用它、也不再保留任何负责终结它的请求生命周期，并非本次保证或实际 ASGI 调用链。

## 验证结果

```text
python -m unittest discover -s server/tests -t server -p test_review_media_disconnect.py -v
Ran 7 tests in 0.119s — OK

python -m unittest discover -s server/tests -t server -p test_panel_media.py -q
Ran 8 tests in 28.184s — OK

ruff check server/mio_server/extensions/panel_media.py server/tests/test_review_media_disconnect.py
All checks passed!

ruff format --check server/mio_server/extensions/panel_media.py server/tests/test_review_media_disconnect.py
2 files already formatted

git diff --check -- server/mio_server/extensions/panel_media.py server/tests/test_review_media_disconnect.py
exit 0
```

以上 Python 和 Ruff 均使用工作区 `.venv/Scripts/` 下的程序。未访问真实网络、ComfyUI、付费 API 或个人 data；未添加调试日志。

## 独立复审入口

先检查整个 response 调用的 finally 是否覆盖异常和取消，再确认 close 的幂等性、最终 send 前持槽，以及测试是否真实执行 `dispatch_media` 返回响应。可只重跑上面的两个媒体测试文件；默认部署未证明泄漏的限定仍须保留。
