# 导出结果与恢复路径独立复审

## 范围与方法

- 初始 HEAD：`8ba6829`；最终生产修复：`4ac2ae5`。
- 阅读 `exporting.py` 的 result、execute、启动清理、失败回滚、abort、remove 和同步下载收尾，以及 `backups/database.py` 的任务 ID、启动回执与导出结果叶文件校验。复审参考作者报告 `export-path-recheck.md`。
- 生产代码只读；独立新增 `server/tests/test_export_path_independent.py` 和本报告。全部探针使用内存数据库或新临时目录中的中性哨兵文件，无网络或个人文件访问。

## 独立发现及修复

**P2：首版恢复校验误把任意 JSON 键当作 Mio 任务引用。** 新增通用递归分支曾对所有名为 `job_id`、`active_job`、`job_ids` 的字段执行任务 ID 语法校验。一个没有任务的合法工作区，只要自定义工作流输入包含 `job_id="external-request-123"`，就被 `validate_databases` 拒绝；同样影响渠道 extra_options 和扩展执行器的自有载荷。独立探针及两项新增测试首跑明确失败。

作者已移除该通用键名分支，保留真实 jobs 表及所有任务引用列、workshop_launch_receipts、类型化 Episode/Take.job_id 和 export.render 结果叶文件的校验。独立测试现证明普通外部标识仍可保存并原样恢复，而实际任务表中的绝对路径、父目录穿越、驱动器写法和尾点仍被拒绝。

## 路径边界核对

- `_job_folder` 在引擎查询或文件写入之前验证任务 ID；result、execute、清理和删除均使用同一入口。当前引擎生成的 16 位十六进制后缀及既有简短测试 ID 形态仍有效，额外接受有界的 60 位后缀，不将正常历史 ID 限死为单一长度。
- 输出叶文件只允许有界数字 attempt/epoch 与 bin/partial 后缀，拒绝分隔符、绝对路径、备用数据流和非字符串元数据。执行尝试身份限制为非负 SQLite 范围整数。
- 现有组件先经 metadata guard 检查全部已存在祖先，再比较规范化的父目录；没有靠原拼写与 resolve 的等值关系拒绝普通 Windows 短路径别名。作者新增别名和祖先 reparse 测试通过。
- 独立真实硬链接测试证明 result 和 execute 均在读取或调用 writer 前拒绝多链接叶文件，清理也保留它；工作区外中性哨兵内容不变。
- 独立模拟 Windows reparse 属性的测试覆盖 result、execute、_cleanup_job、remove、启动清理和 unlink 收尾：不调用引擎查询或 writer，不删除中性文件。abort 和 writer rollback 复用相同收尾检查。
- 既有正常导出测试继续验证可重复下载、幂等快照、失败重试、取消后无残留、重启保留已完成与待投递文件，以及同步下载收尾；没有为了路径拒绝而破坏清理引用规则。

## 实跑验证与结论

- `test_export_path_independent`：5 项通过，包含真实硬链接和模拟 reparse 场景，没有跳过。
- 最终组合 `test_export_path_independent`、`test_export_restore_paths`、`test_export_jobs`：27 项运行，23 项通过、4 项因当前主机不能创建真实符号链接而跳过（15.943 秒）。这些跳过不代表真实符号链接竞态已执行。
- 独立新增测试 Ruff check、format check 与差异空白检查通过。

当前负责范围没有剩余 P0–P2 发现。此检查不声称能防御具有相同文件权限的恶意进程在检查和打开文件之间进行竞争替换；没有重复全项目测试或真实出图。
