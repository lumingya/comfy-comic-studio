# 第二阶段其他文件审查：任务引擎、导入与队列

## 范围与方法

- 启动 HEAD：`4709022`，包含主任务尚未提交的整合代码。
- 先读共享上下文、`backend-fresh-recheck.md`、`final-backend-adversarial.md`、`security-fresh-recheck.md` 和本人的 `adjacent-generation-data.md`。本轮避开已经复核的 LoRA / 云端 recipe 实现。
- 实查 `jobs/runtime.py`、`jobs/delivery.py`、`jobs/state_leases.py`、`jobs/lease.py`、`jobs/pool.py`、`jobs/operations.py`、现有 engine 命令、`queue.py`、`importer.py` 和相邻 API 管理边界。
- 生产代码只读。新增测试仅使用内存数据库、合成旧版 JSON、临时目录和本地假执行器；不启动服务、不联网、不读个人运行数据、不跑完整套件。

## 发现及修复复核

### P1：旧版覆盖导入的后续验证失败会丢失原作品

- 原位置：`server/mio_server/importer.py` 的 `_import_album` 与 `_import_project`。旧实现先删除已有 series，再转换分镜并重建文档。
- 触发：先正常导入一个合成画册或分镜项目；将源 frame 的宽高改为 `1 × 100`，再明确 `overwrite=True`。`Panel` 画幅校验抛出 `ValueError`，但删除已经提交，原 episode 消失。
- 首跑证据：新增 `LegacyOverwriteReviewTests` 两项分别报 `series not found: series_album_review-album` 与 `episode not found: episode_review-board`。原数据和失败源都仅在隔离临时目录中。
- 主 Agent 修复：先完整构建、验证替代 Series / Episodes，再在同一 `store.tx()` 中删除并重建；项目导入在全部 Episodes 提交后才追加报告。当前事务位置为 `importer.py:389` 与 `:490`。`api/system.py:122` 的旧版导入入口还加入 `engine.operation_guard()`，避免覆盖仍有活跃或未确认任务的工作区。
- 复核：两项数据保留回归均通过；保存前的原 series / episode JSON 与失败导入后的记录一致。

### P2：调度计划生成后的暂停状态未在 claim 时重查

- 原位置：`server/mio_server/jobs/runtime.py` 的 `_claim`。`tick` 只在生成计划时过滤 job flags，旧 `_claim` 随后仅检查 item 为 pending、执行器、依赖与资源。
- 触发：本地容量为 2，计划含任务 A 与 B；A 的同步 `started` 监听器调用 `engine.pause(B)`。监听器在 RLock 下合法重入，但旧计划仍会 claim B。
- 首跑证据：新增 `PendingDispatchReviewTests` 实际得到 `paused=True`、item `running` / attempts=1，而暂停已发生在 B 被 claim 之前。
- 主 Agent 修复：`runtime.py:134` 在 engine / pool 锁内重新读取 jobs 的 paused、blocked、canceled；任一 flag 生效即拒绝 claim。
- 复核：新增用例通过，B 保持 pending、attempts=0。既有取消、核对和结果提交竞态用例也通过。

## 验证

本轮实际运行 20 项定向测试，全部通过：

- 新增 `test_other_engine_review.py`：3 项（两种覆盖导入失败、计划后暂停）。
- Engine 既有回归：6 项（幂等冻结、立即停止、提交与取消竞争、双重核对、核对中取消、重启恢复）。
- State lease 回归：3 项（重启前置租约、取消后恢复不采用、确认恢复只应用一次）。
- Durable result delivery：3 项（提交前崩溃、提交后崩溃保留手工采用、取消丢弃待交付结果）。
- Operation guard：3 项（owner 隔离、等待后续提交时取消优先、管理期间 retry 不得复活任务）。
- Queue：2 项（顺序交接与已完成跳过、暂停后保持后续任务并可恢复）。

新增测试通过 Ruff check、Ruff format check 与差异空白检查。没有重跑已通过的完整引擎 / 全仓套件。

## 结论与边界

本轮复现的 1 项 P1（含两个导入入口）与 1 项 P2 已由主 Agent 修复，20 项定向验证未发现仍可复现的问题。这里只确认所列边界；未做进程被 OS 强制终止的真实断电测试、跨进程端点竞争、真实 ComfyUI 或收费云端请求，不据此宣称任务引擎在所有故障组合下均无缺陷。
