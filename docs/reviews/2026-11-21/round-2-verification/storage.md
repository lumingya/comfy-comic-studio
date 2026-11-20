# 持久化修复第二轮独立复审

复审日期：2026-11-21。审查者为未参与第一轮发现或修复的新代理。本文件仅记录 R1-PUB-01～05 的独立核对与反证；没有修改生产代码、测试或共享台账，没有提交、推送或派生子代理。

## 实际读取范围与基线

- 按顺序阅读 `AGENTS.md`、`README.md`、`docs/ROADMAP.md`、本轮 `README.md` / `FINDINGS.md`，再阅读 `fixes/publication-recovery.md` 与 `fixes/backup-gc.md`。
- 实际 HEAD：`125e07f1600464b93736392c04f7d0ae8412c63d`。修复尚在 working tree；未把 HEAD 当作修后代码。
- 直接核对这五个工作区文件的差异及其调用链：`assets.py`、`backups/database.py`、`comfy/executor.py`、`jobs/engine.py`、`jobs/publication.py`；窄读依赖 `jobs/{delivery,runtime,state_leases,operations,types}.py`、`comfy/state_run.py`、`fs_paths.py` 与相关测试夹具。
- 阅读两份新增测试 `test_review_cancel_backup_gc.py`、`test_review_result_recovery.py`，但以调用链、独立组合探针及实际状态读回判断结果，没有用作者绿测试替代反证。
- 第一遍读取的五文件 Git blob hash 依上述顺序分别为：`0036f668480894c7f18dd79d3216daab7f912f0d`、`5e9bcc3ad887e618dabc5ec197586bacaa36e70e`、`43349bc40a20b0b672db523f71eb8a16112f4ba8`、`0c563166f2ac39c218d240ea0699b0682c0d590d`、`aed89977bc6b422ccfe2cc995e9c1fbd5ef714fd`。
- 同时存在其他作者的前端、SDK、导出等改动；本报告不审查或修改那些补丁。最初使用 AppContext 夹具的探针遇到并行导出改动期间的 `composition.character_x` 导入失败，随后改为更小的真实 store/engine 探针；集中回归执行时该导入已恢复。

## 当前结论

| 原 ID | 独立结论 | 证据与范围 |
| --- | --- | --- |
| R1-PUB-01 | **已通过补修后的独立窄复验** | 原 cancel 缺图备份及本轮新增 cancel → retry → 新 attempt 提前失败组合均通过；强输入与不同 result 仍拒绝。 |
| R1-PUB-02 | 本轮读取与定向回归通过 | 本地结果现在同时核对 stage 与最后一条 stage report 的 prompt；owner / attempt 仍经 publication 校验。stage0 本地检查点不能清除 stage1 待取回标记。 |
| R1-PUB-03 | **仍有已确认 P2 多阶段问题，待修后复验** | 单阶段 terminal 零/部分文件可显式只读补取；两阶段 terminal 缺早期 checkpoint 文件时仍只查最终 prompt，见下文。 |
| R1-PUB-04 | 本轮读取与定向回归通过 | job guard、engine lock 与 SQLite 事务内精确更新当前 job/item/attempt delivery 与当前 token lease；日志故障回滚两次写入；其他 item 的 delivery/result 不变。 |
| R1-PUB-05 | 本轮读取与定向回归通过，含平台边界 | orphan staging 扫描受 asset lock 保护；registered / 显式引用 / 任意保留 journal 的共享 hash 均排除；最后 owner 删除后才回收。链接限制见末尾。 |

## 反证 A：取消后重试提前失败，再次阻塞备份（R1-PUB-01，P2）

触发使用普通任务 API 与真实 SQLite，不手改任何数据库行：

1. TEMP 中建立真实 `SQLiteStore`、`AssetStore` 和 `JobEngine(autostart=False)`；注册一个 `replay_safe=True` 的本地 executor，其 execute 调用 `ctx.publish_result({"images":[{"asset_id":id}]}, [(asset,data)])`。
2. 仅令首次 `assets.publish` 抛 `OSError`，所以 intent 与 item result 已登记，但 metadata/素材未写入；真实 `_run` 收尾。
3. `engine.cancel(job)`，此时 `validate_databases(store_connection, engine.db)` 成功，asset_count 为 0，证明原修复确已生效。
4. `engine.retry(job, indexes=[0], confirm_uncertain=True)`，claim 第二次 attempt；这次 execute 在新 publication 前抛 `ExecError("pre-submit rejected", sent=False)`，由真实 `_run` 收尾为 failed。
5. 再调用同一 validator，实际抛 `ValueError: backup references missing asset metadata`。

实际输出：

```text
retry_state failed attempts 2
old_result_retained True
delivery_states [(1, 'discarded')]
retry_backup_failed backup references missing asset metadata
```

原因证据：retry / claim 不清除旧 `job_items.result_json`；新 validator 只用 `(job_id, idx, 当前 attempts)` 寻找 discarded delivery。新 attempt 尚未产生 delivery，故保留的旧结果与其真实 discarded owner 无法关联，即使 job 已终止且没有待决 publication，也会重新要求不存在的素材。预期是合法保留的旧 discarded 诊断仍可备份，同时不同 result 的强引用不能被豁免。已发送主控与 `fix_backup_gc` 作者。

### 作者补修与独立复验

补修后的 validator 按 `(job_id, idx, result_sha)` 寻找不晚于当前 attempt 的真实 discarded 来源，仍先验证该来源的摘要、owner 与 manifest。没有清空旧 result 或改动执行状态。实际读取的 `backups/database.py` blob 更新为 `04af690dab12c71bdefa5d4b70eb48a02d9eda96`。

原独立探针相同四条状态输出中，末行已变为 `retry_backup_ok 0`；当前 failed attempt2 仍完整保留 attempt1 的 discarded 记录。再窄跑作者新增的失败重试导出/inspect与强引用反证：

```powershell
python -m unittest tests.test_review_cancel_backup_gc.CanceledPublicationBackupGCTests.test_failed_retry_keeps_discarded_result_auditable_without_blocking_backup tests.test_review_cancel_backup_gc.CanceledPublicationBackupGCTests.test_failed_retry_does_not_excuse_strong_inputs_or_unmatched_results -q
```

结果 **2 tests / 1.104s，OK**。第二条分别证明同一旧缺图 ID 出现在 input 时仍拒绝、不同 result 仍拒绝。R1-PUB-01 在上述边界内关闭。

## 反证 B：终态多阶段 publication 缺早期素材无法显式补取（R1-PUB-03，P2）

触发使用真实 `ComfyRenderExecutor`、engine、store，只模拟传输与 completion 故障：

1. TEMP 中运行两个不同图片的阶段，prompt 分别为 p1、p2；executor 显式声明 `replay_safe=True`，completion 故障令 terminal delivery 停在 pending。两个 checkpoint 及各自 manifest 均在原 envelope 中。
2. 删除 p1 对应的本地文件，保留 p2 文件和两项 metadata，模拟需修补的部分本地结果；所有上游 history 都可用，fake collect 按 prompt 返回对应原 PNG。
3. 调用 `engine.resolve(job,0,"reconcile")`，记录 history 及生成请求数。

实际输出：

```text
earlier_checkpoint_reconcile_failed JobConflict the local result publication is incomplete or only a stage
earlier_checkpoint_missing True history ['p2'] posts_delta 0
earlier_checkpoint_delivery publishing item uncertain
```

原因证据：`_restore_publication` 对 envelope 的累计 artifacts 判定完整性；新终态补取分支仍调用旧 `executor.reconcile`，后者只读取最终阶段的 upstream prompt。最终图片再保存一次后，较早的 checkpoint 图片仍缺失，`_record_delivery` 再次拒绝不完整 publication。预期是在显式动作中按缺失 checkpoint 的原 stage/prompt 只读补取，并保持原 owner、result、manifest 与摘要；此路径不能重新生成。已发送主控与 publication 修复作者。

同一问题的带 lease 组合也已实际确认：使用真实 state executor 夹具运行两阶段不同 PNG，第二次 `assets.publish` 抛出磁盘故障保留 lease；删早期 p1 文件，再 `resolve(...,"reconcile")`。该入口先进入 `restore_state` 而非 `executor.reconcile`，只补当前 p2 后仍抛同样的 JobConflict，实际输出 `lease_earlier_checkpoint_missing True lease_retained True posts 2 results 0`。已把函数交作者要求同样覆盖此入口；不另重复编号。

## 实际执行与其他覆盖

```powershell
git rev-parse HEAD
git status --short
git diff -- server/mio_server/assets.py server/mio_server/backups/database.py server/mio_server/comfy/executor.py server/mio_server/jobs/engine.py server/mio_server/jobs/publication.py
$env:PYTHONPATH='server'
python C:/Users/QIU/AppData/Local/Temp/review_storage_probe.py
python -m unittest tests.test_review_result_recovery tests.test_review_cancel_backup_gc -q
```

两组作者新增回归集中执行：**18 tests / 6.261s，OK (skipped=1)**。这证明以下已覆盖行为在当前组合补丁下仍成立，但不包含上述两条新反证：

- cancel 保存 0/1 张图的完整备份导出和 inspect；未决 publication、强输入、未匹配 result、未列举错误素材、owner 与已保存字节损坏仍拒绝。
- `error_json` 只对匹配 discarded manifest 的已列举 ID 免强引用，不对所有错误资产无条件放行。
- stage0/stage1 恢复、零/部分终态文件、启动不访问 history、显式 reconcile 不增加 POST、完整原 envelope 保留。
- 非 replay-safe callback 失败后 pending → 本地缺图 → publishing，不会因状态变换绕过回调门禁；连续两次显式 reconcile 仍拒绝 history 与二次 callback。
- discard 的 current item/attempt/token 范围、同事务异常回滚、其他 item 保留及显式 retry 解锁。
- 同 hash 多任务 journal 保留、最后 owner 删除后的 orphan staging 回收、registered / explicit refs 排除、活动 publish 与 GC 互斥、硬链接与错误路径/名称保护。

## 未验边界

- 唯一 skip 为 Windows 无目录 symlink 创建权限；hardlink 反证实际运行通过。另用 TEMP 中 `cmd /c mklink /J` 创建 Windows junction，实际确认 GC 抛 `path must not contain links or reparse points`，并且外部受害文件内容完整；随后显式移除 junction 后清理 TEMP。该证据覆盖本机 reparse 分支，但未把 POSIX symlink 的 skip 计作通过。
- 全部探针只使用 TEMP 中性素材和模拟上游；没有真实 ComfyUI、云端/付费调用、个人 data 或整目录数据复制，没有浏览器/E2E。
- 最初一个探针因错误连接属性退出时，自己的 TEMP 目录 `C:/Users/QIU/AppData/Local/Temp/tmp9bkvdgza` 未能自动清理；显式核对路径后的 PowerShell 清理又被自动审批审核以 `blocked by policy` 拒绝，未绕过。该目录只含本轮隔离探针数据，不含私人运行数据。
- 没有重复全仓测试或作者已通过的九模块大批测试；全仓整合与 CI 由主控执行。
- 未证明真实掉电目录刷盘、跨文件系统、外部同用户进程换路径、绕开 lease 的多进程写入或上游历史已删除时的可恢复性。
- 本文件当前仍含 R1-PUB-03 一项已确认开放问题，不能作为该项已关闭的依据。待作者修后将只复验受影响探针与新增回归并更新此文件。
