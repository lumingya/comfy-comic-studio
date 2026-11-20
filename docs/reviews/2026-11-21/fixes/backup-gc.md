# R1-PUB-01 / R1-PUB-05 修复记录

范围仅为 `server/mio_server/backups/database.py`、`server/mio_server/assets.py` 与新增 `server/tests/test_review_cancel_backup_gc.py`。未改动 jobs / ComfyUI 逻辑；提交与推送由主控统一执行。

## 原始红回归

先使用现有 `DeliveryCase` 的 TEMP 工作区、中性 PNG 和 `ProcessLost` 故障注入建立两条回归，再修改生产代码：

```powershell
$env:PYTHONPATH='server'
python -m unittest tests.test_review_cancel_backup_gc -v
```

初始结果：2 tests / 0.871s，`FAILED (failures=1, errors=2)`。

- intent 后分别保存 0 张 / 1 张图，重开并取消，`active_operation_jobs()==[]`、delivery 为 `discarded`，两支导出均抛出 `backup references missing asset metadata`。
- 半张图写入受管 `.publishing`，重开、取消、删除最后一个任务日志后，metadata 与 retained-result 集合均为空；GC 返回 `[]`，预期回收该 hash 的 staging，断言失败。

假设依次为：所有 JSON / manifest 被无条件当作强引用；item 提前写入的 result 需要与同 attempt 的 discarded 日志关联；GC 只枚举 metadata，漏掉未登记 staging。首轮修复后的定向测试进一步证实第三条引用通路：重开产生的 `error_json.detail.artifacts[].asset_id` 也记录了未保存图片。对 TEMP 行的定向读回确认这一点后，一并限定为对应 publication 的诊断引用。

## 修复规则

### 备份

- 先验证 delivery 内容的摘要、publication owner 与 manifest。`discarded` 不跳过这些校验。
- discarded delivery 的 result / artifact 是诊断记录；其从未保存的素材不要求凭空补出 metadata。
- 只有同 job / item、且 result 摘要与不晚于当前 attempt 的有效 discarded delivery 完全一致的 `job_items.result_json` 才采用诊断规则；重试在发布新结果前失败时，旧结果仍能关联到真实来源 attempt。
- 同一 item 的错误诊断仅豁免有效 discarded manifest 已列举的 artifact ID；未列出的错误素材仍是强引用。输入、快照、作品、历史、checkpoint、未匹配 item result 保持原强引用规则。
- 已登记素材仍按原备份路径复制并校验真实字节和媒体 metadata。导出 zip 内保留完整 publication JSON，未删除日志或创建假素材。
- capture 与 inspect 共用同一验证函数，导出与导入预检采用一致规则。

### GC

- 保持原已登记资产的 GC 语义；无外部引用 / journal 时仍可回收主文件及 metadata。
- 在已有 asset lock 内额外枚举两位小写 hex 分片目录下的 `.<64位hash>.<受支持扩展名>.publishing`，hash 必须与目录前缀匹配。
- 只有扫描开始时既无 registered metadata、也无显式引用及任何 journal owner 的 hash 才进入 orphan staging 清理；另一个已取消任务的 discarded journal 同样保留共享 hash。
- publish / restore 与 GC 共用该锁，合法活动写入不会被中途抢删；已有 intent 也继续提供 journal 所有权保护。
- 目录与目标逐级检查普通文件 / 目录及 Windows reparse 标记；链接与多硬链接 fail closed。已登记资产也先验证 manifest / 安全路径，避免损坏 ID 越过根目录。未知名称、错误 hash 分片和不支持扩展名不触碰。

## 集中验证

完成主体修改和所有当时计划的测试后集中运行：

```powershell
$env:PYTHONPATH='server'
python -m unittest tests.test_review_cancel_backup_gc tests.test_result_publication_backup tests.test_result_publication tests.test_result_publication_crash tests.test_result_delivery tests.test_backup tests.test_backup_catalog tests.test_backup_participants tests.test_backup_path_aliases -q
ruff check server/mio_server/backups/database.py server/mio_server/assets.py server/tests/test_review_cancel_backup_gc.py
ruff format --check server/mio_server/backups/database.py server/mio_server/assets.py server/tests/test_review_cancel_backup_gc.py
```

结果：91 tests / 40.263s，`OK (skipped=2)`；ruff 检查通过，3 files already formatted。两个跳过分别为新增与原有测试的 Windows symlink 创建权限不足；hardlink 反证已实际执行通过。

随后仅补充 registered asset ID 越界防护与对应回归，重跑受影响的新增测试文件及三文件 lint / format / UTF-8 检查：

```powershell
$env:PYTHONPATH='server'
python -m unittest tests.test_review_cancel_backup_gc -q
ruff check server/mio_server/backups/database.py server/mio_server/assets.py server/tests/test_review_cancel_backup_gc.py
ruff format --check server/mio_server/backups/database.py server/mio_server/assets.py server/tests/test_review_cancel_backup_gc.py
python C:/Users/QIU/.codex/skills/utf8-text-guard/scripts/text_guard.py check server/mio_server/backups/database.py server/mio_server/assets.py server/tests/test_review_cancel_backup_gc.py
git diff --check -- server/mio_server/backups/database.py server/mio_server/assets.py
```

最终新增文件：14 tests / 5.190s，`OK (skipped=1)`；其余检查均通过。未因最后的 manifest 校验重复全量或已经通过的备份模块。

新增反证覆盖：未决 publication 仍阻止备份、无关输入引用缺失、无匹配 item result、未列出错误 asset、损坏 owner / 已保存字节、最后 owner 删除前后、多任务共享 staging、已登记 / 显式引用保留、活动写入与 GC 互斥、hardlink、symlink、错误分片 / 非受管名称、损坏登记 ID 越界。

## 独立复审后的组合补修

独立复审者发现原修复的 attempt 关联过严：attempt 1 缺图后取消，第一次备份已通过；显式 retry 后，attempt 2 在发请求前确定失败 (`sent=False`)，item 仍保留 attempt 1 的结果作为审计内容，但当前 attempt 已为 2。原修复只按当前 attempt 找 discarded delivery，导致备份再次报 `missing asset metadata`。

先增加真实 engine 的 retry / claim / `_run` 回归，再改实现：

```powershell
$env:PYTHONPATH='server'
python -m unittest tests.test_review_cancel_backup_gc.CanceledPublicationBackupGCTests.test_failed_retry_keeps_discarded_result_auditable_without_blocking_backup -v
```

补修前：1 test / 0.446s，`FAILED (errors=1)`，栈内仍为 `backup references missing asset metadata`。测试同时断言重试后 item 为 `failed`、attempt 为 2、旧 result 未删除，且唯一 delivery 为 attempt 1 的 discarded。

修复仅调整备份中的来源索引：使用同 job / item / result 摘要定位真实 discarded 来源，并限制来源 attempt 不得晚于当前 attempt。未改动 retry 状态机，旧 result 与旧日志均保留；输入仍为强引用，未知结果摘要不获得豁免。另加重试后的缺失输入 / 不匹配结果反证。

```powershell
$env:PYTHONPATH='server'
python -m unittest tests.test_review_cancel_backup_gc tests.test_result_publication_backup -q
ruff check server/mio_server/backups/database.py server/tests/test_review_cancel_backup_gc.py
ruff format --check server/mio_server/backups/database.py server/tests/test_review_cancel_backup_gc.py
python C:/Users/QIU/.codex/skills/utf8-text-guard/scripts/text_guard.py check server/mio_server/backups/database.py server/tests/test_review_cancel_backup_gc.py
```

补修后：19 tests / 6.864s，`OK (skipped=1)`；ruff 与 UTF-8 检查通过。跳过仍为目录 symlink 权限不足。独立复审者已用原独立 probe 读回 `retry_backup_ok 0`，并报告本机 junction 反证拒绝 reparse 路径且外部字节保留；其完整证据由复审者记录。

## 边界

全程仅 TEMP 夹具和假服务，无真实 ComfyUI / 云端 / 付费调用，无个人运行数据读取，无整目录 data 复制。未安装浏览器或运行 E2E。Windows 当前账户不能创建目录 symlink，相关断言留给支持该能力的 CI / 独立复审环境，不能把本机 skip 记作通过。未验证真实掉电目录刷盘、跨文件系统、同用户外部进程制造的路径替换竞态，或绕过工作区租约的多进程并发；仍沿用 `regular_path_metadata` 明示的边界。
