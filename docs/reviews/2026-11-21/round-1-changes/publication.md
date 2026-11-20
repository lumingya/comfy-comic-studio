# 第一轮：持久结果发布与跨库边界

固定审查范围：`git diff 6aa0f8f...125e07f`。本报告只记录发布、投递、素材、ComfyUI 恢复及其备份 / GC 边界；生产代码、测试和共享台账由主控维护。

## 已确认发现

### PUB-1 · P2 · 已取消的不完整发布仍永久阻塞工作区备份

- **位置**：`server/mio_server/backups/database.py:258–267` 与 `269–302`，尤其 JSON `walk()` 和 `references.add(asset.id)`；相关状态转换 `server/mio_server/jobs/engine.py:398–402`。
- **触发**：任务已提交 publication intent，尚未写入 / 注册全部素材时进程退出或发生 I/O 错误；重启后用户取消任务。
- **最短离线复现**：以现有 `DeliveryCase` 创建临时 AppContext，`render_job()` / `claim()`；对 `assets.publish` 注入 `ProcessLost`，调用 `ctx.publish_result({"images": [{"asset_id": asset.id}]}, [(asset, png_bytes)])`；重开工作区后 `engine.cancel(job_id)`，调用 `Backups(ctx).export(BackupOptions())`。所有素材和服务均为中性离线夹具，无真实上游调用。
- **预期**：取消后没有活动或待投递结果；备份应能保留现有工作区，允许 discarded 日志记录从未成功保存的素材，而非要求补造缺失素材。
- **实际**：`active_operation_jobs()` 返回空，delivery 已为 `discarded`，但导出抛出 `ValueError('backup references missing asset metadata')`。备份校验对所有 delivery 的 publication manifest 均执行 `references.add(asset.id)`，并遍历 job_items / job_deliveries 的 result JSON，把仅存在于意向中的未保存素材当成必须存在的资产。用户只有额外删除该历史任务才可解除阻塞。
- **影响**：一次可恢复的出图存储失败，在用户明确取消后仍阻止整个工作区备份；使用同一保护性备份路径的恢复操作也受影响。既有作品和其他完成任务本来仍可备份。
- **建议**：区分未解决 publication 的强引用与 discarded publication 的诊断性 manifest；对取消后从未保存的素材允许缺失，同时保留已落盘素材和日志归属。备份导出和导入验证应采用一致规则，并加上“intent 后中断 → 取消 → 导出 / 预检成功，已保存部分仍保留”的回归。不能只跳过新增 manifest 循环；原有 `walk()` 也会从提前写入 job_items 的 `images[].asset_id` 收集同一缺失 ID。
- **证据**：独立子审查者在 TEMP 工作区实跑上述路径，异常与状态均已读取。公开 `api/backups.py:49–51` → `Backups.export()` → `backups/snapshot.py:99` 的工作区校验抛出；`backups/service.py:150` 的恢复前保护快照也走同一路径。已立即通知主控。

### PUB-2 · P2 · 多阶段状态恢复把上一阶段本地结果当作当前阶段结果

- **位置**：`server/mio_server/comfy/executor.py:333–341`，调用 `local_result()` 后仅检查 `result_pending`，不比对 publication stage / prompt 与状态租约当前 stage / prompt。随后跳过 `343–374` 的当前阶段结果收集。
- **触发**：包含 frontend-state 租约的多阶段 ComfyUI 任务。阶段 0 已完整发布，阶段 1 已接单后传输超时；上游阶段 1 随后成功完成，用户明确调用恢复状态。
- **最短离线复现**：复用 `StateExecutorTests` 的临时数据库和可控 FakeClient，令 `client.modes=['ok','timeout']`；`job=submit(count=2)`，`run_job(job)`；`client.finish('p2')` 标记上游第二阶段成功；将 `client.view` 包装为计数器并返回与阶段 0 不同的有效 PNG；调用 `engine.restore_state(job,0)`。脚本保存在 TEMP，仅使用中性 PNG 和假服务。
- **预期**：`settle()` 既已确认阶段 1 的 `terminal_success`，应从该 prompt 获取阶段 1 输出，完成对应 terminal publication，保存后再恢复并释放端点状态；无需再次生成。
- **实际读回**：恢复前 item `upstream='1:p2'`，租约 `stage=1`，本地 publication `stage=0`；恢复返回 `restored=True,result=None,error.kind='pipeline_interrupted'`，`stage_result.prompt_id='p1'`；`client.view` 调用 **0** 次，最后阶段不同 PNG 的 asset 未注册，完成回调 **0** 次，任务仍为 `uncertain`，租约却已释放。错误文字称“后续阶段未自动执行”，与已确认 `p2` 成功的事实相反。
- **影响**：一次应恢复完整结果的操作遗漏已完成阶段的输出，用户需要再触发一次独立 reconcile 才有机会取回。如果随后上游历史或临时文件清理，已完成图片不再能恢复。现有单阶段与“第一阶段超时”的测试无法覆盖该组合。
- **建议**：让 `local_result()` 返回经校验的 publication stage / owner / 对应 prompt，只有与当前 lease stage 匹配时才清除该 stage 的 `result_pending`。前一阶段的本地检查点仅作为历史保留，不能替代当前阶段收集；增加“stage0 已发布 → stage1 timeout 后成功 → 一次 restore_state 即发布最终不同图片”的回归。
- **证据**：TEMP `mio_pub_review_probe.py` 实跑读回上述全部状态，`client.view` 使用 mock 包装计数；探针已清理。已立即通知主控。

### PUB-3 · P2 · 终态发布的瞬时写盘失败拦住显式只读历史对账

- **位置**：`server/mio_server/jobs/engine.py:511–519`，`not staged` 无条件 `return self.replay_result(...)`；`server/mio_server/jobs/delivery.py:97–98` 本地缺失时直接返回，不提供 executor 的只读补取路径。
- **触发**：普通单阶段 ComfyUI 工作流，不需要 frontend-state 租约。上游已成功生成，`publish_result()` 已提交 intent，但 `assets.publish()` 因临时磁盘写错误失败。磁盘恢复、已知 prompt 的历史和图像仍然可读时，用户明确点击 reconcile。
- **最短离线复现**：用 `DeliveryCase` 建 TEMP 工作区，`job=render_job()` / `ctx=claim(job)`；在 `patch.object(assets,'publish',side_effect=OSError('transient disk full'))` 下运行 `engine._run(ctx,'comfy','local')`。解除故障注入后，将原 `executor.reconcile` 包成调用计数器，调用 `engine.resolve(job_id,0,'reconcile')`。
- **预期**：优先复核本地文件；本地尚不完整时，这次明确的 reconcile 可以从同一已知 prompt 历史只读下载，严格比对已有 publication manifest 后补写，不再次提交生成请求。启动恢复仍应保持纯本地。
- **实际读回**：item 为 `uncertain`，delivery 为 `publishing`，manifest `terminal=True`、`stage=0`；没有 state lease；显式 resolve 之后仍为 `result_publication_incomplete`、素材 location `missing`；`executor.reconcile` 调用数 **0**。无论重试几次，分支均在 executor 之前返回。需要完整文件在本地重新出现才能 replay，或用户取消并再次付费生成。
- **影响**：过去可通过已知 prompt 恢复的一次磁盘瞬时故障，在新发布协议下变成无法通过公开对账操作修复的阻塞状态；这是显式只读补取的退化，不是要求启动自动访问服务。
- **建议**：显式 reconcile 区分“本地完整待投递”与“终态 publication 本地不完整”；后一种可在保持原 attempt / owner / manifest 不变时允许原 executor 补取，复用 `_publish_prepared()` 已有的 ID / 结果一致性校验。回归需要覆盖零文件和部分文件，以及禁止二次提交上游的断言。
- **证据**：TEMP 脚本实跑：`reconcile_hook_calls=0,delivery_state='publishing',lease=None`，错误 detail 内 `missing_assets` 有唯一结果 ID。已立即通知主控。

### PUB-4 · P2 · 明确放弃有发布意向的结果仍保留待投递阻塞

- **位置**：`server/mio_server/comfy/executor.py:325–331` 仅清理 StateSession 中的 pending / result；`server/mio_server/jobs/engine.py:592–607` 将恢复失败结果标成 failed；新增 `server/mio_server/jobs/runtime.py:404–412` 又因仍存在 publishing delivery 改为 uncertain。
- **触发**：带状态租约的 ComfyUI 任务已生成、已记录 intent，但保存素材发生 I/O 错误。用户使用已有的 `restore_state(...,discard_result=True)` 明确放弃该结果并恢复端点。
- **最短离线复现**：用 `StateExecutorTests` 的 TEMP 夹具建单阶段任务；在 `patch.object(assets,'publish',side_effect=OSError('transient disk full'))` 下 `run_job(job)`；解除注入后调用 `engine.restore_state(job,0,discard_result=True)`，再 `engine.retry(job,confirm_uncertain=True)`。
- **预期**：上游终止已确认且用户明确放弃，应把该 item 的未解决 delivery 一并标为 discarded，恢复 / 释放状态；item 可以明确重试。已存素材和审计记录可继续保留。
- **实际读回**：恢复回包 `restored=True,result=None,error.kind='result_discarded'`；租约确实释放，但 item 仍为 `uncertain`，error 外层是 `publication_interrupted`、内层才是 `result_discarded`；delivery 仍是 `publishing`。明确重试报 `JobConflict: a received result is awaiting delivery; replay it before retrying`。用户仍只能取消整个 job，而不能用该 item 的明确放弃流程结束阻塞。
- **影响**：公开 discard 流程对新协议已产生意向的失败结果无效；批量任务中被迫扩大为整批取消。现有 discard 测试在下载失败、尚无 publication 时执行，不能发现该问题。
- **建议**：在当前 item / attempt 的 job guard 下联动更新 delivery 与状态租约；明确放弃时原子记录 discarded，保证 `_finish_guarded()` 不再把它解释为未解决发布。不得将同批其他 item 的结果一起丢弃。加“intent 后保存失败 → 明确 discard → 该 item 可重试，其余 item 保留”的回归。
- **证据**：TEMP 脚本实跑以上状态与异常。已立即通知主控。

### PUB-5 · P3 · 删除发布日志后未注册的部分暂存文件无法被 GC 回收

- **位置**：`server/mio_server/assets.py:244` 的 GC 仅枚举 `store.asset_ids()`；`server/mio_server/jobs/engine.py:646` 删除 journal 时不处理其未注册暂存文件。
- **触发 / 最短离线复现**：用 TEMP `DeliveryCase`，包装 `_write()` 为写入一半有效 PNG 到预定 `.publishing` 后抛 `ProcessLost`；重开，`engine.cancel(job_id)`、`engine.delete(job_id)`，显式运行 `assets.collect_garbage(set())`。
- **预期**：用户已经明确删除最后一个归属日志，GC 能回收无其他 owner 的受管暂存文件。
- **实际**：`retained_result_assets()==set()`、`store.asset_ids()==set()`、`gc_removed==[]`，半成品 staging 文件仍存在（探针中为 115 bytes）。它既没有元数据，也不再有 journal manifest；不同 hash 的重复中断可持续累积磁盘文件。
- **建议**：受锁保护地清理无 journal 所有权、无资产元数据的 staging，或在删除最后一个 owner 时清理其未注册文件；必须保留其他任务共享同 hash 的文件。
- **边界**：全仓查找只看到测试直接调用 `collect_garbage()`，未找到当前生产入口。因此这里只报告底层已复现的资源回收缺口，不宣称已有 UI 回收功能失效；它低于上述恢复与备份问题。

## 覆盖与尚未完成的窗口

已覆盖：publication / delivery 状态转换、per-job guard 与取消 epoch、素材同 hash 发布的进程内锁、部分 / 完整暂存文件、manifest / 实际字节 / 元数据校验、ComfyUI 多阶段与状态租约恢复、普通终态显式 reconcile、明确 discard、旧 executor arbitrary JSON 的摘要旁路、ack 前后回执、GC 引用保留、取消后备份捕获和恢复保护快照。未重复已关闭的 hardlink / pending tamper 探针，也未重跑全量门禁。

实跑五类 TEMP 定向路径（其中多阶段、终态 reconcile、discard 由本审查者运行，备份与 orphan staging 由独立子审查者运行）；其余为代码路径审查。所有上游均为内存 FakeClient，无真实 ComfyUI / 云端 / 私人 LoRA 调用，无整目录 data 复制。TEMP 探针与工作区均已清理。

未验证：真实掉电后的 Windows 目录刷盘语义、跨文件系统 / 网络盘、不同进程同时绕过工作区独占租约操作同一素材目录，以及长时间资源耗尽压力。不能将抽样和故障注入覆盖称作上述窗口已安全。以上行号定位固定原始改动版本；主控修复后行号可能移动。
