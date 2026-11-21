# 第三轮：访问控制与上传边界

基线：`ddf8d81f5a8d3b624da9618718599374de2f61f6`。优先范围为不在 `git diff --name-only 6aa0f8f...ddf8d81` 中的访问、鉴权、上传与路径模块。本报告只记录本审查者的发现；未修改生产代码、测试或共享台账，未提交。

结论：确认 **2 项 P2**：一项令牌生命周期缺陷，一项共享测试夹具隔离缺口。正常 HTTP 鉴权及本次有限上传矩阵未发现另一项可实证的生产缺陷。此结论不代表全部 API、文件系统或依赖实现已全覆盖。

## R3-ACCESS-01 · P2 · 撤销或到期的令牌仍能通过既有 WebSocket 接收新事件

状态：已实证，已通知主控；待修复及新的审查者复验。它不是前两轮 14 项的重复。

### 调用链和位置

- `server/mio_server/api/v2.py:100-123`：`token_of()` 在 WebSocket 握手依赖中调用 `TokenStore.verify()`，把当时的令牌放入连接状态。
- `server/mio_server/auth.py:73-74,116-147`：验证会读取当前令牌记录、检查摘要与到期时间；HTTP 新请求因此能立即拒绝已撤销或已到期令牌。
- `server/mio_server/api/access.py:53-56`：撤销操作删除令牌记录。
- **`server/mio_server/api/jobs.py:129-162`**：`job_socket()` 接受握手并订阅引擎，循环只等待队列事件或客户端消息；发送后续事件前、连接闲置期间均不再检查凭据。

### 触发、预期和实际

1. 在独立 TEMP 工作区发行 `read` 令牌，并建立 `/api/v2/ws/jobs` 连接，收到 `hello`。
2. 情形 A：通过 `/api/tokens/{id}` 删除该令牌。情形 B：把此 TEMP 令牌的 `expires_at` 设为过去，确定性模拟连接存续时跨过有效期。
3. 同一凭据再次请求 `/api/v2/jobs`，两种情形都返回 **401**。
4. 在 TEMP 引擎内发布一个不持久化的中性事件；此前的 WebSocket 两种情形都继续收到该新事件。

预期：失效凭据不能继续获得新的受保护任务数据，连接应关闭或至少停止向其转发事件。

实际：只要连接保持打开，它仍订阅未来事件。`previews` 默认是 `True`，事件通道还包括任务进度和预览载荷；已泄露但随后被吊销的令牌可以继续观察后续创作活动。无需再次通过 HTTP 鉴权，也不需要 `write`、`render` 或 `admin` scope。

证据输出（不含令牌）：

```text
{"mode":"revoke","handshake":"hello","http_status_after":401,"ws_event_after":"review-event","ws_marker":"neutral-after-revoke"}
{"mode":"expire","handshake":"hello","http_status_after":401,"ws_event_after":"review-event","ws_marker":"neutral-after-expire"}
```

### 最短离线复现

在 `server/` 下运行下列 Python。只用 `TemporaryDirectory`、内存数据库、TestClient 与非持久事件；不启动任务或模型服务，不输出令牌。到期分支直接改动实验令牌的到期字段，未借用真实运行数据，也没有用墙钟等待冒充计时器测试。

```python
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi.testclient import TestClient
from mio_server.api import create_app
from mio_server.context import AppContext

with tempfile.TemporaryDirectory(prefix="mio-access-review-") as temporary:
    ctx = AppContext.create(
        temporary, autostart=False, seed_instance=False, memory=True
    )
    ctx.legacy_root = Path(temporary) / "empty-legacy"
    try:
        client = TestClient(create_app(ctx, serve_web=False), base_url="http://127.0.0.1")
        for mode in ("revoke", "expire"):
            issued = client.post(
                "/api/tokens", json={"name": "offline fixture", "scopes": ["read"]}
            ).json()
            headers = {"Authorization": "Bearer " + issued["token"]}
            with client.websocket_connect(
                "ws://127.0.0.1/api/v2/ws/jobs", headers=headers
            ) as ws:
                assert ws.receive_json()["type"] == "hello"
                if mode == "revoke":
                    assert client.delete("/api/tokens/" + issued["id"]).status_code == 204
                else:
                    token = ctx.store.get_doc("api_token", issued["id"])
                    token.expires_at = (
                        datetime.now(timezone.utc) - timedelta(minutes=1)
                    ).isoformat()
                    ctx.store.put_doc(token)
                assert client.get("/api/v2/jobs", headers=headers).status_code == 401
                ctx.engine._emit(
                    "offline-sentinel", None, "review-event",
                    {"marker": "neutral-after-" + mode}, persist=False,
                )
                assert ws.receive_json()["data"]["marker"] == "neutral-after-" + mode
                print(mode, "HTTP=401; existing WS still received a new event")
    finally:
        ctx.close()
```

### 最小修法和复验边界

给带凭据的长连接增加当前凭据复核：至少在发送事件前检查令牌仍存在、摘要身份未改变、未到期且仍具所需 scope；用定时检查或撤销通知结束闲置连接。失效时用策略关闭码终止连接，并释放订阅、待完成的接收/队列任务。保留本机无令牌 WebSocket 的既有正常行为。

回归应包含：有效连接正常收取事件；握手前撤销/到期拒绝；握手后撤销/自然到期关闭且不转发下一条事件；闲置到期；本机连接不受影响；无残留订阅或异步任务。本次复现没有测试修复方案，也未证明扩展自定义 WebSocket 的生命周期已被正确处理。

## R3-ACCESS-02 · P2 · 共享 API 夹具默认读取本机 legacy data

状态：源码与隔离探针确认，已通知主控；待修复。它是项目测试隔离缺陷，同时也是下文初次测试执行偏差暴露的根因，不能仅归为审查操作错误。

### 调用链、预期和实际

- `server/tests/api_harness.py` 的 `ApiCase.setUp()` 为数据库创建 TEMP 工作区，却没有设置 `self.ctx.legacy_root`。
- `server/mio_server/api/workshop.py` 的 `_workshop()` 以 `getattr(ctx, "legacy_root", None)` 调用 `W.ensure_workshop()`。
- `server/mio_server/workshop.py:156-181` 的 `_ensure_workshop()` 在没有传 root 时回退到 `importer.LEGACY_ROOT`；`server/mio_server/importer.py:59` 把该常量指到仓库 `data/`。后续读取 `presets/characters`、`storyboards` 并导入临时数据库。
- `server/tests/test_api_v2.py` 的 `ApiV2Tests.test_storyboard_and_preset_resources_enforce_read_and_write_scopes` 沿这条实际调用链触发缺省回退，尽管它只需要一个空工坊验证权限。

预期：依据 AGENTS.md 的数据隐私/夹具规则，普通 API 测试默认只读实验范围；需要随包示例时，显式使用 `copy_shipped_data()` 提取清单内的固定素材。

实际：使用共享夹具、没有额外覆盖 root 的工坊测试会自动读取本机仓库 data。仓库说明明确这些文件可能被本机运行时改写，故测试会把私人分镜/预设带入夹具，且结果依赖本机状态。这里没有证据表明该调用链写回源 data 或将内容外发；已确认问题是越过测试读取边界及测试不确定性。

### 最短安全复现

在 `server/` 下执行。先把 importer 的默认根改成 TEMP 哨兵，并截获 `_load_dir`，因此不会访问真实 data；原始 ApiCase 本身保持未修改。

```python
import tempfile
from pathlib import Path
from unittest.mock import patch
from tests.api_harness import ApiCase

with tempfile.TemporaryDirectory(prefix="mio-fixture-boundary-") as temporary:
    sentinel = Path(temporary) / "sentinel-legacy"
    sentinel.mkdir()
    case = ApiCase(methodName="runTest")
    try:
        with patch("mio_server.importer.LEGACY_ROOT", sentinel), patch(
            "mio_server.importer._load_dir", return_value=[]
        ) as loader:
            case.setUp()
            assert not hasattr(case.ctx, "legacy_root")
            assert case.client.get("/api/workshop").status_code == 200
            calls = [call.args for call in loader.call_args_list]
            assert calls and all(call[0] == sentinel for call in calls)
            print([call[1] for call in calls])
    finally:
        case.doCleanups()
```

实际输出：`['presets/characters', 'storyboards']`。证明共享夹具触发了 importer 的默认数据读取入口，而不是假设 TEMP 数据库已经隔离所有输入。

### 最小修法与已知样例依赖

在 `ApiCase.setUp()` 建立 ctx 后、创建 client 前，统一将 `ctx.legacy_root` 设为该实验 TEMP 下不存在或空的目录。普通鉴权/工坊测试不应自行回退到仓库数据。

只读源码已确认以下 `tests.test_workshop.WorkshopTest` 用例显式断言随包预设/分镜，需要将 `copy_shipped_data(Path(self.tmp) / "legacy-fixture")` 的结果显式传给 `ctx.legacy_root`，或在这些样例测试的专用夹具中统一设置：

- `test_seeded_from_legacy_data_and_hidden_from_the_shelf`
- `test_assemble_snapshots_story_and_presets_then_one_click_fills_the_album`
- `test_clone_task_copies_frames_presets_and_profile_but_no_images`
- `test_preview_makes_a_one_frame_album_for_the_preset`

上述四项硬编码“七海 · 标准角色设定”、`nanami` 或“远行与归来 · 十二幕”；这不是应继续信任任意本机 data 的理由。`test_api_v2` 的 scope 用例无需示例数据。`tests/test_workshop_v2.py` 已在自己的 setUp 指定 TEMP 空根，`test_api_system.py` 及 `test_assistant_trash_import.py` 的 legacy 专项已有 `copy_shipped_data` 用法可沿用。

本次没有为寻找更多依赖而全量运行测试，以上是已知清单，不声称穷尽全部间接默认读取。修复后应做相关工坊/权限回归，确认空默认根及显式示例两条路径都成立。

## 已完成的有限验证

### 19 项现有专项测试

以下 suite 集中执行，`Ran 19 tests in 17.801s / OK`：

- `tests.test_guard`
- `tests.test_api_v2.ScopeTests`
- `tests.test_api_v2.ApiV2Tests`
- `tests.test_extension_boundary_corpus.UploadBoundaryTests`

这次有效验收通过包装 `ApiCase.setUp()`，在原 setUp 后统一设置 `self.ctx.legacy_root = Path(self.tmp) / "empty-legacy"`；没有修改磁盘中的测试文件。覆盖同源/异源写入、Host、允许主机、外来 WebSocket、基础 scope、撤销/到期后的新 HTTP 请求、multipart 任意分块/伪分隔符、超量中止、断开及取消时的 spool 清理。未运行全套测试或真实模型调用。

### 20 条补充断言

另一次独立 TEMP + `memory=True` 的真实 TestClient 探针通过 20 条断言：

- 原始素材上传空体返回 400；把 `library.MAX_UPLOAD` 临时缩为 16 字节，16 字节可接受、17 字节拒绝，验证实际接收字节限制而非构造大文件。
- v2 无令牌上传返回 401；`read` 上传返回 403；`read+write` 上传 16×16 中性 PNG 返回 201；reader 下载得到相同 PNG 字节与 `image/png`。
- 只有 write 的令牌不能导入扩展文件夹，返回 403。
- 壁纸上传拒绝伪装成 `.png` 的非图像内容，以及超过单文件数量的 multipart；正常中性 PNG 可上传、原样读取，响应有 `nosniff` 与 sandbox CSP。
- 实验扩展文件夹上传的 `../escape.txt`、`/absolute.txt`、`C:/outside.txt`、`folder/../../escape.txt` 均返回 400。没有在拒绝后尝试打开这些目标；没有根外实际写入实验。
- 成功和失败请求创建的 7 个 `SpooledTemporaryFile` 句柄在响应后均已关闭；TEMP 中没有 `escape.txt`。
- 无效 scope 的 422 响应不回显输入标记；无效 bearer 的 401 响应不回显原始凭据标记。

## 实际覆盖文件

“核心阅读”表示检查了相关逻辑全文；“依赖/局部阅读”只支持所列链路，不能称为该文件逐行审计。

| 类别 | 文件 | 实际范围 |
| --- | --- | --- |
| 核心访问控制 | `api/guard.py`、`auth.py`、`api/access.py`、`api/deps.py`、`api/v2.py`、`api/validation.py` | 本机保护、scope 分派、令牌模型/验证/管理、依赖与错误响应；webhook 业务仅阅读其管理接口，不审外发实现 |
| 核心上传 | `api/uploads.py`、`api/library.py`、`api/extension_transport.py` | multipart 解析与清理、raw-body 限制、素材上传/读取、扩展 folder 上传与路径拒绝 |
| 原生路径工具 | `fs_paths.py` | 全文静态阅读；没有重复前两轮链接/根外攻击实验，没有竞态证明 |
| 局部 HTTP 链路 | `api/__init__.py`、`api/jobs.py`、`api/theme_preferences.py`、`api/theme_packages.py`、`api/extension_private.py`、`api/extension_routes.py`、`api/operations.py`、`api/workshop_tasks.py` | 路由装配、job socket、壁纸/主题上传、私有偏好入口、扩展鉴权及 auto_start 条件权限；未逐个执行业务功能 |
| 依赖/局部阅读 | `extensions/manager.py`、`extensions/manifest.py`、`extensions/panel_bridge.py`、`private_store.py`、`theme_media.py`、`imaging.py`、`bundle.py`、`asset_refs.py`、`context.py`、`storage.py` | 安装/格式/清理、scope 转发与实验上下文的必要依赖阅读；不构成备份、扩展生态、图像解码或持久化全覆盖 |
| 路由枚举 | `api/*.py` 的装饰器 AST | 辅助核对已注册操作与 scope 正则；没有把所有路由枚举算成运行覆盖 |

测试依据还阅读了 `tests/api_harness.py`、`test_guard.py`、`test_api_v2.py`、`test_extension_boundary_corpus.py`、`test_workshop.py`、`test_workshop_v2.py`、`shipped_data_fixture.py` 及相关已有安全/素材测试；这些历史测试仅作定位，不替代本轮实证。针对 R3-ACCESS-02 另读 `workshop.py` 的默认根分支、`importer.py` 的常量，并运行了上述 TEMP 哨兵探针。

## 限制与执行偏差

- 实验没有访问真实 ComfyUI、付费服务或外部网站；没有浏览器/E2E，没有十 GiB 量级压力测试、原生网络断连、跨进程/恶意同用户文件竞态、物理断电或 Windows 设备名写入实验。媒体格式探针只证明列出的签名/小 PNG 情形，不能等同于完整媒体解码验证。
- **初次测试命令未先隔离 legacy_root**：最初直接启动 `test_guard` 与 v2 类的命令未注入空的 legacy 根，且未保留其执行句柄。源码回溯确认 storyboard 测试调用 `ensure_workshop(None)` 时可读取仓库 `data/`；因此不把该次运行算作纯 TEMP 验收，也不引用其测试结果。未回显读入内容；之后才执行上述隔离后的 19 项验证。未再读取实际数据来确认具体内容。
- **一次误触默认惰性入口**：检查安装的 Uvicorn 日志实现时误调用 `uvicorn.Config("mio_server.app:app").load()`。它触发默认 `create_app()`，在 `server/data/runtime/.v3.mio-recovery/workspace.lease` 因既有锁被占用抛出 `LeaseHeld`。已停止该方向，没有重试、清理或写入未知既有目录。
- 对该偏差仅回读源码确认：`prepare_workspace()` 在失败前会解析恢复目录、检查 symlink、`mkdir(exist_ok=True)`，再由 `FileLease` 以 `a+b` 打开 lease、检查长度并尝试加锁；异常时关闭句柄。没有进入后续 journal lease / `install_pending()`，没有执行 `_create()` 打开数据库或启动服务。没有读取用户数据库内容，也不能据此把整个过程描述为“完全没有尝试访问 runtime”。
- 上述两次偏差均已即时向主控说明。最后的上传矩阵与 WebSocket 缺陷复现均显式使用 TEMP、`memory=True` 与空 legacy 根。报告完成后停止扩展新审查路径。
