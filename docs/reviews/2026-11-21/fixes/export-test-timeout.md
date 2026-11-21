# R5-TEST-EXPORT-01：导出作业夹具的无关生成截止

状态：仅导出测试夹具已补修，相关回归通过；新的独立复审与精确最终提交 CI 由主控完成。

## CI 的实际证据

固定提交 `0bf22c2`，独立验证分支 CI `44876704108`：主门禁全部通过（含 Python 3.13、前端、扩展、契约、发行包），Ubuntu Python 3.11 全部通过。Windows Python 3.11 的 1,576 项测试只有一项 error：

```text
test_export_jobs.ExportJobTests.test_write_cancellation_cleans_output
setUp -> adopt_two_frames -> ApiCase.adopt_all -> test_jobs.drain
TimeoutError
```

失败发生在 PDF 取消测试正文之前，用于准备素材的两格异步生成没有在共享测试助手的 5 秒总预算内返回。CI 日志未记录当时的 job/item 状态、单条磁盘操作耗时或时钟信息，所以不能据此声称已经唯一定位 CI 机器的原始慢因，也不能把它称为已确认的生产死锁。

## 比较并行的事件等待改动

原工作区后续有并行提交 `4a582b0`，主要让空闲 scheduler/queue 等待通知。它不在本轮固定审查提交内，没有覆盖或回滚该提交及其后续改动。

`ApiCase` 使用 `AppContext.create(..., autostart=False)`。准备素材依靠 `drain()` 手工 `tick()`；实际探针中的 `engine.thread.is_alive()` 始终为 `False`。对 `0bf22c2` 的原 runtime 方法和含 `4a582b0` 的当前 runtime 分别运行原失败用例各 10 次，20 次均通过；两格 drain 实测约 0.134–0.176 秒。自然未重现 Windows CI 的瞬时延迟，未继续无辨识度的大量随机重复。

因此不能把另一个任务的后台等待改动当作本次准备超时已经解决的证据。

## 受控红环：正常推进也能超过预算

使用真实临时 `ApiCase`、真实 `ComfyRenderExecutor` 结果交付和真实 SQLite/AssetStore，只在该执行器原 `on_complete()` 前加入每项 2.7 秒等待，以模拟领域保存阶段变慢。不更换结果、不重试、不再次提交，也不更改现有 `drain()`：

```python
complete = executor.on_complete

def slow_complete(*args, **kwargs):
    time.sleep(2.7)
    return complete(*args, **kwargs)

# 在 ApiCase.setUp 创建临时上下文后，patch 该实例的方法；清理时恢复。
```

探针在 `TimeoutError` 时记录精简的 job/item 状态，再仅继续调度观察原任务，不重发：

| runtime | 首次超时 | 超时状态 | 原任务随后完成 | attempts |
| --- | --- | --- | --- | --- |
| `0bf22c2` 原方法 | 5.002 秒 | running；一项 complete、一项 running | 5.551 秒 | `[1, 1]` |
| 含 `4a582b0` 的当前方法 | 5.008 秒 | running；一项 complete、一项 running | 5.548 秒 | `[1, 1]` |

这构造了与 CI 相同的准备阶段 `TimeoutError`，同时直接证明该信号不等于任务停止推进。它证明夹具把与导出无关的生成总耗时作为了导出测试前提；**不证明 CI 当时恰好有 2.7 秒保存延迟**。

本机诊断脚本为 `%TEMP%/mio-ci-export-timeout.py`，命令如下；自然、受控旧夹具和新夹具结果分别保存在同前缀的 `normal.jsonl`、`delayed.jsonl`、`fixed.jsonl`。脚本只读取指定 checkout 的 Python 模块及 `git show`，所有测试运行数据由临时 ApiCase 创建：

```powershell
python -X utf8 "$env:TEMP\mio-ci-export-timeout.py" <checkout> --repeat 10
python -X utf8 "$env:TEMP\mio-ci-export-timeout.py" <checkout> --repeat 1 --delay 2.7
```

## 最小补修

在准确基线 `0bf22c2` 的隔离 worktree 中只修改 `server/tests/test_export_jobs.py` 的 `ExportJobTests.setUp()`：

1. 保留原真实创建 series/episode 的 API 路径，只取前两格，不缩成单页。
2. 将与原 fake 输出相同的 64×96 中性 PNG 写入真实 `AssetStore`；保存两条真实 candidate `Take` 及两格 Episode。
3. 逐条调用原 `/api/episodes/{id}/takes/{id}/adopt`，继续执行生产采用和布局逻辑。

导出作业测试现在从已存在的候选素材开始，不必在每条导出用例前穿过无关的异步生成和 5 秒总截止。通用 `drain()`、生产调度、实际导出、重试、取消、两页/快照/下载断言均未更改；没有增加任何超时、重试、skip 或异常吞噬。原 `test_album.AlbumApiTests` 继续覆盖真实 render/store/adopt 集成。

## 补修后验证

```text
# 隔离 worktree 的 server/，使用已安装依赖
python -X utf8 -m unittest tests.test_export_jobs tests.test_album.AlbumApiTests tests.test_result_delivery -q
Ran 30 tests in 45.173s
OK
```

同一受控保存延迟探针应用于新夹具后，通过 `git show` 分别装载 `0bf22c2` 与 `4a582b0` 的 runtime 方法，两者均通过（完整用例分别 1.161、1.116 秒），准备阶段没有调用渲染 `drain()`。这不是等待更久，而是夹具不再运行被注入慢保存的无关生成任务；实际 PDF 取消正文仍然执行。显式装载两个提交的方法，避免因隔离 worktree 本身仍是 `0bf22c2` 而误把同一版本标成两个版本。

测试文件 Ruff lint、format、`py_compile`、定向 `git diff --check` 通过。首次 format 检查仅提示采用调用应合为一行，已按工具格式局部修正，未重复已经通过的 30 项业务测试。最终源文件和本记录另经 UTF-8/BOM 检查。

## 边界与交接

- 没有自然复现 CI 的原始机器延迟，没有声称观察到 CI 超时任务最终状态。上述 continuing 状态只来自受控探针。
- 没有扩大测试通用等待预算，也没有更改并行的 `test_jobs.py`、runtime 或 queue。
- 只编辑隔离 worktree 中的导出测试及本报告；随包 64 文件已保护，未访问默认 legacy 根、用户工作区或真实 ComfyUI/云端。
- 主控将安排新代理检查两页、真实采用/布局、冻结作业及取消清理没有因夹具调整而弱化，并验证准确最终提交的跨平台 CI。本报告不提前宣称最终 CI 通过。
