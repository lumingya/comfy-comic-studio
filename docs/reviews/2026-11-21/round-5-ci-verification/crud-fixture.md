# R5-TEST-EXPORT-01：CRUD 查询夹具追加独立复审

结论：**支持关闭本项的 CRUD 追加补修，未发现新问题**。这是一处已存在准备范围问题的同类补修，不另计重复追踪项。

## 固定范围与攻击思路

基线为 `5682a43`，操作目录是本次审查的隔离 worktree。先独立读取 `server/tests/test_api.py` 的实际差异和既有 `test_album.adopt_two_frames`、`ApiCase.adopt_all`，再检查动态覆盖，不以作者的通过结论代替本次证据。

该差异只新增现有 helper 的导入，并把 `CrudTests.test_listings_carry_progress_and_covers` 中的一处 `self.adopt_all(ep)` 改为 `adopt_two_frames(self, ep)`，附两行说明。既有 helper 先把真实 Episode 裁为两格、断言格数恰为 2，然后仍进入原 `adopt_all` 的异步渲染、结果持久化和 HTTP 采用路径。

独立反证聚焦三点：

1. 两格是否确实足够覆盖多图、单图、零图三种进度，以及空首话、后话封面、回收站计数等不同分支。
2. 是否偷偷用预制成功响应或直接改采用状态替代真实生成、资产保存和采用。
3. 断言看似保留但是否因样本缩小而失去辨识度，尤其是只剩一图和拒绝最后一图的状态。

## Standards

未发现规范项问题。补修复用既有两格 helper，没有复制夹具、修改生产代码、增加等待预算、重试或跳过。导入的是 helper 函数，不把别的测试类导入本模块参与重复发现。

AST 对照确认：原目标用例的 **6 个断言全部逐节点相同**；把旧函数唯一的准备调用归一为新 helper 后，整段函数 AST 完全一致。`GoldenStoryTests.test_golden_story_renders_via_api` 的 AST 也与基线完全一致，12 格生成、采用、QA 和导出的端到端测试未被删除或缩小。本复审只静态核对该 golden 用例，未重复执行其完整流程。

## Spec 与独立动态证据

使用自行编写的 TEMP 探针，以原 `CrudTests` 和真实临时 AppContext 执行原目标用例。正常探针只旁观原请求及 `drain` 的返回，不修改 SQL 结果或成功响应。LLM/Comfy 仍是项目原有离线 fake；领域执行器、SQLite、AssetStore 和 HTTP API 均为真实路径。

| 检查 | 实际结果 |
| --- | --- |
| 真实异步生成 | 1 个 `comfy.render` 作业，2 个 item 均 complete，attempts 为 `[1, 1]` |
| 真实采用与素材 | 2 次原 HTTP adopt；采用后通过原 image API 读取并解码两张 64×96 PNG |
| 真实拒绝 | 2 次原 HTTP reject；第一次拒绝后仍有 1 个 adopted，最后一次后为 0 |
| 话列表进度 | 两话的采用数依次为 `[0, 0]`、`[0, 2]`、`[0, 1]` |
| 空首话与后话封面 | 首话始终无封面；后话采用的第一格成为 series 封面，部分拒绝后保留 |
| 回收站与最后拒绝 | 新增再删除一话后 series 的 episode_count 仍为 2；拒绝最后一图后 series 封面变回 None |

两格在这里是必要的多图样本：它使“拒绝其余图但保留首图”的循环真实执行一次，随后另一次请求拒绝最后一图。独立轨迹确认这两个分支均实际执行，没有因缩为单图而跳过部分拒绝步骤。

另做四个负向护栏：在真实服务器已返回后，仅向原测试注入一种错误响应，要求原断言直接失败，外层独立探针才算通过。这些实验不改服务端状态或磁盘源码。

| 故意错误 | 被原断言捕获的位置（本次工作树） |
| --- | --- |
| 已采用两图却报告采用数 0 | `test_api.py:131` |
| 部分拒绝后仍有一图，却丢失其封面 | `test_api.py:144` |
| 回收站中的额外一话仍计入 series，返回 3 | `test_api.py:137` |
| 最后一图已拒绝，series 却保留旧封面 | `test_api.py:147` |

因此改小准备数据没有放过上述四类错误查询结果。

## 执行记录

```text
python -X utf8 "%TEMP%\mio-verify-crud-fixture.py" <isolated-worktree>

test_actual_render_store_adopt_and_all_listing_branches ... ok
test_existing_assertions_reject_wrong_server_results ... ok
test_only_preparation_call_changes_and_twelve_frame_golden_stays ... ok
Ran 3 tests in 6.496s
OK
```

第二项包含四个独立 TEMP 用例的负向实验，均在对应的原断言处捕获预期失败。没有重复整套 1,576 项或作者的集中回归。报告已按 UTF-8 无 BOM 写入并读回，探针脚本在交付前删除。

## 验证边界

- 本机为 Windows / Python 3.13.6；不能代称 Windows Python 3.11 或精确最终提交的 CI 已通过。
- 未自然复现 CI 机器的原始延迟，也没有独立证明 CI 当时恰有作者受控探针中的每项 0.55 秒保存延迟。CI 的 5 秒准备截止和作者慢保存红环保留在[修复记录](../fixes/export-test-timeout.md)；本复审的独立结论是所需分支、真实路径及错误辨识度均被保留。
- 不把两格缩减说成改进了生产调度性能，也不声称覆盖了全部数据库/线程交错。
- 只新增本报告；未改源码、测试、共享台账或并行 TLS 文件，未提交或推送。测试使用 ApiCase 自有 TEMP 和空 legacy 根，未载入默认 app、用户数据或真实外部服务。
