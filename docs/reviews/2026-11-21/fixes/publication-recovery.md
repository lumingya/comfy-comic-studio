# R1-PUB-02 / 03 / 04 修复交接

状态：三项均已修复并通过定向回归，等待全新代理独立复审。未修改共享台账，未提交或推送。

## 范围与复现方法

只修改：

- `server/mio_server/comfy/executor.py`
- `server/mio_server/jobs/engine.py`
- `server/mio_server/jobs/publication.py`
- 新增 `server/tests/test_review_result_recovery.py`
- 本文

回归复用 `StateExecutorTests` / `DeliveryCase` 的 TEMP 工作区、真实 JobEngine、SQLiteStore、AssetStore 与真实 ComfyRenderExecutor。只模拟上游传输、PNG 内容和磁盘故障；未用测试实现替代恢复、发布或投递逻辑。未读私人运行数据、未调用真实 ComfyUI 或付费接口。

已阅读根目录 AGENTS、README、ROADMAP、CI、审查入口与台账及 publication 报告对应三节。使用 diagnosing-bugs 的先失败回归流程与 utf8-text-guard 的补丁编辑方式。原报告已经提供精确路径，故未另建重复探针或扩大架构诊断。

## 原始失败

在修改生产代码前，从 `server/` 运行：

```text
python -m unittest tests.test_review_result_recovery -q
Ran 3 tests in 1.636s
FAILED (failures=4)
```

四个失败都命中原症状：

1. `test_stage_one_recovery_does_not_reuse_stage_zero_publication`：stage0 已发布、stage1 超时后上游完成，`restore_state` 的 `view.call_count` 为 0，预期为 1。
2. `test_explicit_terminal_reconcile_repairs_zero_and_partial_local_files`：零文件与部分文件两种子场景均 `reconcile.call_count == 0`，预期为 1。
3. `test_discard_only_current_item_delivery_and_allow_explicit_retry`：明确 discard 后，目标 delivery 仍为 `publishing`，预期为 `discarded`。

## R1-PUB-02：只复用当前阶段与 prompt 的本地结果

`local_result()` 在完成 publication 校验后返回 stage 与 owner；旧 executor 的任意 JSON 结果仍沿用原有兼容分支，不伪造 stage。`recover_state()` 只有在本地 stage 与租约当前 stage 相同，且该结果的最后一条 stage report 的 prompt 与租约 prompt 相同，才允许清除 `result_pending`。owner / attempt 仍由 `_restore_publication()` 与 `_publication()` 的既有身份校验约束。

若 stage0 本地检查点与 stage1 租约不匹配，就通过已知 stage1 prompt 的只读 history/collect 路径取图，发布 stage1；不会再提交生成请求。回归令 stage1 返回不同 PNG，验证一次恢复就完成、采用一次、最终 prompt 为 p2、素材字节正确、生成 run 总数仍为 2、delivery 为 applied 且端点租约释放。stage0 清单继续留在 publication checkpoints 中。

## R1-PUB-03：显式终态对账可补回缺图

`resolve(..., "reconcile")` 先执行本地 `_restore_publication()`；本地已经完整时仍走纯本地 replay。若本地不足以完成，包括 terminal publication 缺文件，则允许原 job binding 的 executor 进行只读 history reconcile。已有 intent 的补写经 `restore_checkpoint()` 校验原 checkpoint 的完整 manifest 并使用原 union manifest 与 result；当前 attempt / epoch / executor 和 publication 摘要都必须仍匹配。正常发布与新增阶段仍走 `_publish_prepared()` 的原清单校验。

终态补取另保留原 binding 的 `replay_safe` 门禁。收尾反证曾在初修上发现：一个 pending delivery 的非幂等回调已失败、随后本地文件丢失，直接进入 reconcile 会绕开原 replay 检查并再调用回调。新增 `test_missing_pending_files_do_not_bypass_replay_safe_callback_gate` 在补门禁前实跑为 `FAILED (failures=1)`，精确失败为 `JobConflict not raised`。修复后连续两次显式 reconcile 均拒绝进入历史补取，回调累计仍仅一次。该要求只作用于新增终态补取路径，不改变原中间阶段对账行为。

启动 `recover_deliveries()` 及 `replay_result()` 未改，启动仍只检查本地文件。回归在 reopen 时令 history 与 run 都抛错，证明启动未访问上游；仅在显式 reconcile 时读取历史。零文件与已保存第一张图两种情况都完成投递，逐字典比较原 publication envelope（含 owner、manifest、result、摘要），结果不变；生成 run 总数不增加。

### 独立复审追加：累积清单中的早期阶段缺图

`verify_storage_fixes` 用真实引擎独立反证了初修的遗漏：两阶段都已 publication、回调失败而保留 pending 后，删除 stage0 文件，stage1 仍完整；初修只取回 p2，累积 manifest 仍缺 p1，最终 `_record_delivery()` 抛 `JobConflict`。带租约、终态发布写盘失败后再丢失 stage0 的入口也有相同问题。

已将独立 probe 固化为三个额外 test method，补修前运行：

```text
python -m unittest tests.test_review_result_recovery.ReviewPublicationRecoveryTests.test_terminal_reconcile_repairs_missing_earlier_checkpoints tests.test_review_result_recovery.ReviewPublicationRecoveryTests.test_wrong_earlier_history_cannot_replace_checkpoint_manifest tests.test_review_result_recovery.ReviewStateRecoveryTests.test_state_restore_repairs_missing_earlier_and_current_checkpoint -q
Ran 3 tests in 1.351s
FAILED (failures=1, errors=3)
```

只缺早期、早期与终态都缺、带 lease 三个场景均实证触发未完整 publication 的 `JobConflict`；错早期 history 的测试则发现错误地只读取了 p2，没有读取缺失的 p1。

共享 `_repair_publication()` 现在同时用于显式 `reconcile()` 与 `recover_state()`：先本地检查 union 清单，按缺失素材归属定位 checkpoint，再以 checkpoint 原 stage、原 prompt 与冻结的该阶段 outputs / output_adapters 只读收集。完整阶段无需 GET。`restore_checkpoint()` 在 job guard 内重新确认当前 item / attempt / epoch / executor、原 publication_sha 和该 stage 的完整 artifact 清单；只向原 union manifest 描述的位置补写通过验证的字节，不回退 stage、不修改 owner / result / checkpoints / 摘要，也不删除中间清单。若历史不存在或字节不符，不调用完成回调，租约入口继续保持隔离。

新回归使用两个不同的冻结 outputs（stage0 节点 7、stage1 节点 9），断言只读取实际缺失的阶段、所有原素材字节与整个 publication envelope 均保留、已发生的回调失败只作明确重放、生成总数始终为 2。错早期 history 必须在补写前拒绝，缺失路径仍不存在。带 lease 用真实 ComfyClient.collect + FakeClient.view，验证 p1 / p2 一次补齐后完成并释放租约。

## R1-PUB-04：明确丢弃与租约 pending 标记同事务

新增 `discard_state_result()`，在同一 job guard、engine lock 与 SQLite 事务下验证当前 attempt / epoch / lease token，仅将该 item 当前 attempt 的 pending 或 publishing delivery 标为 discarded，并更新该租约的 `result_pending=False`、`result=None` 与 `result_discarded` 原因。事务保留原 result_json、manifest 和已存素材。随后沿原恢复端点流程执行；恢复成功后 `_finish_guarded()` 不再被未解决 publication 改回 uncertain。

回归先完成同批 item0，再让 item1 的中间阶段落盘、终态发布时磁盘失败，验证：

- 丢弃事务中，在两次状态写入之后注入 journal 写入故障，两次状态写入全部回滚，lease 数据与之前相同、delivery 仍为 publishing。
- 正常 discard 后 item1 为 failed / result_discarded，delivery 为 discarded，端点租约释放，job 未取消。
- item0 的 result 与 applied delivery 完全未变；item1 已保存的中间图片字节和原 publication envelope 保留，仍被审计引用保留。
- `retry(job, indexes=[1], confirm_uncertain=True)` 成功，仅 item1 回到 pending，生成请求数不增加。

## 修复后验证

从 `server/` 集中运行新回归与旧恢复、发布、投递测试：

```text
python -m unittest tests.test_review_result_recovery tests.test_comfy_state_executor tests.test_result_publication tests.test_result_publication_crash tests.test_result_delivery -q
Ran 56 tests in 35.054s
OK
```

随后只补充了事务回滚与 envelope 保留断言，按受影响范围重跑新回归：

```text
python -m unittest tests.test_review_result_recovery -q
Ran 3 tests in 2.685s
OK
```

补充上述 replay-safe 反证并收紧门禁后，集中重跑全部受影响测试的中间结果：

```text
python -m unittest tests.test_review_result_recovery tests.test_comfy_state_executor tests.test_result_publication tests.test_result_publication_crash tests.test_result_delivery -q
Ran 57 tests in 21.188s
OK
```

独立复审追加早期 checkpoint / lease 组合后，再次集中重跑，最终结果：

```text
python -m unittest tests.test_review_result_recovery tests.test_comfy_state_executor tests.test_result_publication tests.test_result_publication_crash tests.test_result_delivery -q
Ran 60 tests in 23.455s
OK
```

新回归文件最终为 7 个 test method；零文件 / 部分文件、仅早期缺 / 所有阶段均缺分别使用 subtest。

从根目录运行以下检查均通过：

```text
ruff check server/mio_server/comfy/executor.py server/mio_server/jobs/engine.py server/mio_server/jobs/publication.py server/tests/test_review_result_recovery.py
All checks passed!

ruff format --check server/mio_server/comfy/executor.py server/mio_server/jobs/engine.py server/mio_server/jobs/publication.py server/tests/test_review_result_recovery.py
4 files already formatted

python -m py_compile server/mio_server/comfy/executor.py server/mio_server/jobs/engine.py server/mio_server/jobs/publication.py server/tests/test_review_result_recovery.py
exit 0
```

完整门禁及提交由主控在整合其他修复后统一执行；这里不声称已经完成全仓验收。

## 独立复审建议与边界

新的复审代理应先独立核对三条真实调用链，再运行上述命令，尝试反证：不同 stage / prompt 的本地结果不能消除当前 pending；显式只读补取不能换 owner / manifest 或增加上游生成；discard 必须仅命中当前 item / attempt，异常时同事务回滚，已保存素材可审计。

本回归覆盖本机 TEMP SQLite 与故障注入，不证明真实掉电的目录刷盘、远程磁盘、跨进程非法写库或上游历史已被清理后的可恢复性；上述边界未扩展为本次修复目标。
