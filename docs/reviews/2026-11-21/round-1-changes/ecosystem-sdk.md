# 第一轮：扩展生态与 SDK 对抗审查

固定范围：`git diff 6aa0f8f...125e07f`。以下行号均指 `125e07f`；复现时 HEAD 仍为该提交。生产代码、测试及共享台账只读。

## 主要结论

1. **P2 — 合法 CLI 键在出图后必然导致导出失败。** `clients/python/markdown_album.py:178–179` 接受 180 字符键，`:261` 追加 `.html`，但 `server/mio_server/api/deliverables.py:47` 上限为 160。156 字符键通过创建与模拟生成后，导出返回 422；相同命令不能完成，改键又违反 receipt 指纹。应稳定派生有界阶段键，并考虑已有 receipt；补 155/156/180 边界全链回归。现有 SDK 测试只使用短键。影响一条命令及原键续跑承诺（`clients/python/AUTOMATION.md`）。

2. **P2 — HTTP 阻塞读取未遵守总截止。** `examples/extensions/standard-image-channels/transport.py:210` 将初始余量一次写入 HTTPX timeout，`:250–255` 只在 `next(iterator)` 前后检查。真实 loopback 服务先及时给出一块再停顿，第二次读取仍可等最初的 read timeout。2 秒总截止实测 3.016 秒才结束，`sent=True`，POST 仅一次。应让实际阻塞读取受绝对截止约束；补真实本地短读后 stall 回归。现有 Mock raw-chunk 测试只能检查返回块之间的时钟，未覆盖该阻塞。这不符合包 README 的总截止承诺及路线图 Wave 3 的有界轮询要求。

3. **P2 — pending 绑定接受额外的生成内容。** `clients/python/markdown_album.py:100–105` 按 expected 子集比较字典，`:126–130` 因而将不同分镜保存为匹配。相同标题/简介/原始提示词/对白，但额外带 `overrides.raw_negative` 和 `seed` 的分镜可绑定、生成并完成；实际任务使用这些未在 Markdown 意图中出现的值。应按服务模型补默认值后比较完整业务内容，只排除明确的服务元数据；新增额外字段和嵌套覆盖项测试。现有绑定回归只修改 expected 已有字段，未覆盖增加字段。影响显式恢复时的内容核对承诺；不是旧的正文不匹配探针重复报告。

## 覆盖与边界

已读六个专业包的请求声明、面板控制与媒体/任务桥，以及两个适配器包、SDK Webhook/receipt 路径；独立检查幂等意图、原图采用、陈旧结果、明示取消、HTTP/ZIP 限制与凭据输出。未将 Webhook 去重当作恰好一次业务处理；文档已经要求业务收件箱事务，未对此重复报缺陷。未发现另一个可确认的包级问题。既有测试仅用于构建隔离夹具和定位覆盖缺口，不作通过结论。

仅执行下面三个定向探针，全部使用临时工作区、中性图片模拟器或 loopback；未读个人运行数据，未调用外部生成服务，未跑浏览器或全量门禁。源代码抽样审查不证明任意上游服务、浏览器长会话和所有专业交互均无缺陷。主控负责修复与后续独立复审。

## 附录：最短离线证据

以下脚本从仓库根目录用 `.venv/Scripts/python.exe` 执行；Python 代码只用 ASCII，复用现有隔离 API 夹具，不改仓库文件。

### A. 156 字符键与额外字段绑定

```python
import json
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path("server").resolve()))
from tests.test_sdk_automation import SDKMarkdownAutomationTests

T = SDKMarkdownAutomationTests
T.setUpClass()
t = T("test_markdown_to_frozen_task_adoption_html_pdf_and_idempotent_resume")
t.setUp()
try:
    story = "# Neutral\n## Panel\na red chair"
    common = dict(
        source={"workflow_id": "builtin_t2i_sdxl"},
        adopt_first=True, timeout=15, poll=0.01,
    )
    try:
        t.automation.run_album(
            t.mio, story, Path(t.tmp) / "long-key",
            idempotency_key="k" * 156, **common,
        )
    except t.sdk.MioError as exc:
        print("key", exc.status, exc.detail)
        print("jobs", [(j["kind"], j["state"]) for j in t.ctx.engine.list()])

    out = Path(t.tmp) / "bind-extra"
    with patch.object(t.mio, "create_storyboard", side_effect=OSError("uncertain")):
        try:
            t.automation.run_album(
                t.mio, story, out, idempotency_key="bind-extra", **common,
            )
        except t.automation.CreationPendingError:
            pass
    board = t.automation.parse_markdown(story)
    board["panels"][0]["overrides"].update(
        raw_negative="unexpected hidden negative", seed=314159,
    )
    existing = t.mio.create_storyboard(board)
    print("matches", t.automation.matches_submission(
        t.automation.parse_markdown(story), existing,
    ))
    result = t.automation.run_album(
        t.mio, story, out, idempotency_key="bind-extra",
        bind_storyboard=existing["id"], **common,
    )
    meta = t.mio.get_job(result["job_id"])["items"][0]["input"]["meta"]
    print("binding", result["status"], meta["negative"], meta["seed"])
finally:
    t.tearDown()
    t.doCleanups()
```

已观察输出（省略动态资源 ID）：

```text
key 422 ... String should have at most 160 characters ...
jobs [('comfy.render', 'completed')]
matches True
binding completed unexpected hidden negative 314159
```

### B. 真实本地短读后 stall

```python
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path("server").resolve()))
from tests.test_cloud_channel_packages import channel, MODULE

seen = []
class H(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass
    def do_POST(self):
        seen.append(time.monotonic() - started)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", "100")
        self.end_headers()
        time.sleep(1)
        try:
            self.wfile.write(b"{")
            self.wfile.flush()
            time.sleep(3)
        except OSError:
            pass

server = ThreadingHTTPServer(("127.0.0.1", 0), H)
threading.Thread(target=server.serve_forever, daemon=True).start()
config = channel(extra_options={"min_interval": 0}).model_copy(update={
    "base_url": f"http://127.0.0.1:{server.server_port}",
})
adapter = MODULE.ADAPTERS["compatible_images"][0](config)
started = time.monotonic()
try:
    adapter.generate_image("a red chair", timeout=2)
except Exception as exc:
    print(json.dumps({
        "deadline": 2, "elapsed": round(time.monotonic() - started, 3),
        "sent": getattr(exc, "sent", None), "posts": len(seen),
    }))
finally:
    server.shutdown()
    server.server_close()
```

已观察输出：`{"deadline": 2, "elapsed": 3.016, "sent": true, "posts": 1}`。不是让 MockTransport 忽略 timeout 的人工超时；此探针走真实本地 socket。具体计时会随主机有少量变化。
