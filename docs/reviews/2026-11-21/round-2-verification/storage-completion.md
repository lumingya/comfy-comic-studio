# 存储组合补修独立验收

验收日期：2026-11-21。审查者未参与原始修复或前一份独立复审；本次仅检查当前存储补修的正常业务组合和已有受控回归。唯一新增文件为本文，未修改生产代码、测试、共享台账或此前报告，未提交、推送或派生子代理。

## 结论矩阵

在下述限定范围内，未发现尚未关闭的正常业务问题。R1-PUB-01 的取消后重试组合、R1-PUB-03 的多阶段缺图组合均可关闭；R1-PUB-02 / 04 / 05 的已有修复在本次范围内复核通过。

| ID | 本次独立结论 | 当前代码与实际验收证据 |
| --- | --- | --- |
| R1-PUB-01 | **关闭** | 真实 engine 的取消 → retry → attempt 2 在提交前失败，保留 attempt 1 的 discarded result；导出与 inspect 都成功且 asset_count=0。相同缺图 ID 出现在 input 时仍拒绝；不同 result 摘要仍拒绝。 |
| R1-PUB-02 | **关闭** | stage0 已保存、stage1 超时后历史完成，恢复实际读取 p2，使用不同 PNG 完成一次采用，run 数始终为 2。当前本地复用同时要求 stage 和最后 stage report 的 prompt 匹配。 |
| R1-PUB-03 | **关闭** | 两阶段历史都存在时，只缺 stage0、只缺 stage1、两阶段都缺均完成；实际 collect 仅访问缺失阶段，原 envelope / result 不变，生成提交数始终为 2。带 lease 的两阶段缺图也补齐并释放 lease。错误早期历史被拒绝，缺图路径仍不存在，未再次调用完成回调。 |
| R1-PUB-04 | **关闭** | 同批 item0 已完成、item1 终态写盘失败后，显式 discard 只变更 item1 的当前 attempt delivery 和当前 token lease；注入 journal 写入错误时两次状态写入一起回滚。成功后只 item1 可显式 retry；item0 result / delivery、已保存字节与原 envelope 保留。 |
| R1-PUB-05 | **本次正常 GC 范围通过，可维持关闭** | 最后 journal owner 删除前 staging 保留，删除后显式 GC 回收；跨任务共享 hash、registered / 显式引用、活动 publish 与 GC 互斥、非受管名称与错误分片回归通过。链接与根外路径反证按约定未重复，既有证据仍见前一份报告。 |

本文件更新的是当前补修后的判断；[此前 storage.md](storage.md) 中 R1-PUB-03 的开放结论保留为历史反证，不能作为本次补修仍失败的证据。

## 阅读范围与代码基线

已阅读根目录 AGENTS.md、README.md、ROADMAP.md，本轮 README / FINDINGS、fixes/publication-recovery.md、fixes/backup-gc.md 及 round-2-verification/storage.md；再核对当前五个生产文件的差异与实际函数、两份新增测试及其自动临时夹具。另窄读既有 delivery replay / callback 门禁，未扩大到其他并行补丁。

HEAD 为 `125e07f1600464b93736392c04f7d0ae8412c63d`，被验修复位于 working tree，未把 HEAD 当作修后代码。测试完成后读取的 Git blob hash 如下：

| 当前文件 | Git blob hash |
| --- | --- |
| server/mio_server/assets.py | `0036f668480894c7f18dd79d3216daab7f912f0d` |
| server/mio_server/backups/database.py | `04af690dab12c71bdefa5d4b70eb48a02d9eda96` |
| server/mio_server/comfy/executor.py | `0ba78d4fb7463b94db9e114fce856985e8273513` |
| server/mio_server/jobs/engine.py | `0c563166f2ac39c218d240ea0699b0682c0d590d` |
| server/mio_server/jobs/publication.py | `e861ea1147fce51cd79a28f475ee0630b6ac533b` |

当前实现的独立核对点：

- `backups/database.py:260–324`：discarded 来源索引使用 `(job_id, idx, result_sha)`，来源 attempt 不晚于当前 attempts；在将其用于 item 诊断前已检查 publication 摘要、owner 和 artifact manifest。只有精确匹配的 result_json 跳过强引用扫描，error_json 仅豁免该 manifest 列出的 ID；input_json 和不匹配结果仍照常扫描。
- `comfy/executor.py:317–347`：`_repair_publication()` 先校验 union 清单的本地字节，再只处理含缺失 ID 的 checkpoint；使用 checkpoint 原 stage / prompt 与冻结的该阶段 outputs，并沿用配置适配器。无 run / 生成提交调用。
- `jobs/publication.py:245–282`：`restore_checkpoint()` 在 job guard 内核对当前 attempt / epoch / executor、publication_sha 及该 stage 的完整 artifact 清单，随后按原 union manifest 补写；不构造新 envelope 或替换 result。`assets.publish()` 另校验真实字节摘要、媒体类型、大小与尺寸。
- `comfy/executor.py:349–437` 与 `439–477`：带 lease 的恢复和无 lease 的显式 reconcile 都使用共享修补路径。`local_result()` 的 stage 与当前 lease stage、结果末条 prompt 同时匹配才清除 result_pending。启动 replay 仍只检查本地文件。
- `jobs/engine.py:506–535`：无 lease 的终态缺图路径保留 replay-safe 门禁；现有回归连续两次显式 reconcile 均阻止非幂等 callback 再次进入。
- `jobs/publication.py:288–310`：`discard_state_result()` 在同一 job guard、engine lock 和 SQLite 事务中核对当前 item attempt / epoch / lease token，delivery UPDATE 精确限制 job / idx / attempt，随后按该 token 更新 lease 并记录事件；未改动其他 item。
- `assets.py:239–278`：GC 在与 publish / restore 共用的 asset lock 中读取 registered / referenced / journal-retained 集合；只有不在这些集合的受管 staging 才进入回收。

## 实际执行与正常组合

从仓库根目录设置 `PYTHONPATH=server` 后，用 `python -B -` 的内存 unittest runner 加载：

- `tests.test_review_result_recovery.ReviewPublicationRecoveryTests` 全部 4 项；
- `tests.test_review_result_recovery.ReviewStateRecoveryTests` 全部 3 项；
- `tests.test_review_cancel_backup_gc.CanceledPublicationBackupGCTests` 的 16 项中选 13 项，排除下文列出的 3 项。

这 20 项均复用原自动 TEMP 夹具和 cleanup，未改测试文件。另外在同一内存 runner 中增加 1 个正常组合，复用 `ReviewPublicationRecoveryTests.checkpoint_job()`：

1. 真实 executor / engine 完成 stage0 节点 7 与 stage1 节点 9 两个不同 PNG 的 publication；fake 完成回调首次失败，delivery 为 pending，原 envelope 保留。
2. 保留 stage0 的本地文件与字节，只移除该夹具内 stage1 的文件；两阶段历史仍存在。解除 fake callback 故障，显式 `resolve(..., "reconcile")`，期间将 `FakeClient.run` 设为一旦调用即失败。
3. 断言 item 完成，`CheckpointClient.reads == [("p2", ["9"])]`，stage0 没有 collect；`len(FakeClient.graphs) == 2`，最终字节为原 p2 PNG。
4. 断言 stage0 原字节不变、item result 与数据库中的整个 publication envelope 逐字典等于修复前，callback 累计 2 次（原失败一次、显式完成一次）。

本次唯一一批实际运行结果：

```text
Selected existing cases: 20; extra normal combination: 1; excluded link/external-path cases: 3
test_final_stage_only_missing_uses_only_final_history ... ok
Ran 21 tests in 8.624s
OK
```

没有把排除项记作 skip 或通过；未重复已经通过的全仓或九模块大批检查。

主要组合与实际检查结果：

| 正常业务组合 / 保护条件 | 实际断言结果 |
| --- | --- |
| 缺图后取消，保存 0 / 1 张素材 | 导出和 inspect 成功；已保存字节及备份内原 publication JSON 保留；asset_count 分别为 0 / 1。 |
| 取消后 retry，下一 attempt 在发请求前失败 | item 为 failed / attempts=2，唯一 delivery 为 attempt1 discarded，旧 result 保留，仍可 export / inspect。 |
| 同一旧缺图 ID 进入 input；或 item 改成不匹配 result | 分别拒绝 missing asset metadata；另有非匹配 result、未列举 error asset 独立回归通过。 |
| 未决 publication；损坏 owner；已保存素材字节损坏 | 均继续拒绝备份，未借 discarded 诊断规则放行。 |
| 两阶段仅 stage0 缺失 | 只 collect p1 / 节点 7；不重新取回 p2，提交总数仍 2，原 envelope 保留。 |
| 两阶段仅 stage1 缺失（本次补充） | 只 collect p2 / 节点 9；不重新取回 p1，提交总数仍 2，原 envelope 保留。 |
| 两阶段都缺失 | 按顺序 collect p1 / 节点 7、p2 / 节点 9；补齐原字节并完成，提交总数仍 2。 |
| 带 lease 的两阶段都缺失 | 实际 view p1.png、p2.png，run 数仍 2，仅采用一次，lease 释放。 |
| stage0 本地完整、stage1 超时后历史完成 | 读取并采用 p2 的不同 PNG，未误用 stage0 清 pending；总生成仍 2。 |
| 缺失 stage0 的历史返回错误字节 | JobConflict，缺失文件仍不存在，原 intent 保留，完成回调仍只有原失败的一次。 |
| 非 replay-safe callback 失败后再缺图 | 连续两次 reconcile 拒绝进入 executor.reconcile，callback 累计仍 1 次。 |
| 显式 discard 与 journal 写入故障 | 故障时 lease 与 publishing delivery 都回滚；成功时仅目标 item discarded / failed，可显式 retry；其他 item 与已保存素材保留。 |
| 最后 owner 删除前后与共享 staging | owner 存在时保留，最后 owner 删除后显式 GC 回收；registered / 显式引用和活动 publish 保留。 |

## 未重复范围与限制

按主控限定，本次明确排除以下 3 个已有测试；没有另做链接、根外路径或外部文件实验：

- `test_gc_rejects_hardlinked_staging_without_touching_external_bytes`
- `test_gc_rejects_linked_managed_directories_without_traversing_them`
- `test_gc_rejects_out_of_root_registered_asset_without_deleting_files`

原作者与前位复审者的既有链接 / reparse 证据仍分别保留在 fixes/backup-gc.md 与 storage.md，本次不冒称重新验证了这些平台分支。未触碰或尝试清理此前被拒绝的 TEMP 目录；仅由本次自动夹具自身上下文清理其临时数据。

没有真实 ComfyUI、云端、付费 API、其他网络服务访问，没有浏览器 / E2E、个人工作区数据读取或随包数据改写。所有结果来源、传输、PNG 和故障均为既有假服务与自动临时夹具。本次不证明真实掉电目录持久化、跨文件系统、绕过租约的多进程写库或上游历史已消失后的恢复能力，也不代替主控最终整合门禁与 CI。
