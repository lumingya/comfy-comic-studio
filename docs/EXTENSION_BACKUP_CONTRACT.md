# 扩展数据备份

扩展可以在 `mio-extension.json` 声明 `"backup": "core/backup.py"`。这个模块只导出数据规则，不启动服务、不连接网络，也不导入或执行扩展的交互入口。

宿主会从随包扩展及本工作区已审阅的包快照读取规则。外部扩展成功启用后，其确切包内容与摘要保存在工作区旁的恢复目录；关闭扩展不撤销数据规则。恢复不会执行备份 ZIP 内的任何 Python，也不会自动信任其他机器带来的扩展代码。导入外部扩展数据前，先安装并审阅对应扩展。

模块必须导出 `PARTICIPANT` 对象，实现以下契约：

| 属性或方法 | 责任 |
| --- | --- |
| `root: str` | 固定为 `extensions_data/<扩展 id>`，只能声明所属扩展的数据；其中 `settings.json`（SDK 设置）和 `preferences.json`（宿主私有偏好）由宿主管理，不由参与者重复处理或改写 |
| `allowed(name)` | 判断完整工作区相对路径是否属于该扩展允许的文件 |
| `size_limit(name)` | 单文件字节上限；ZIP 解压前检查 |
| `files(workspace, include_credentials=True)` | 逐项返回 `(相对路径, Path)`；校验目录、JSON、附件引用和文件配对；禁止链接、越界和临时文件 |
| `snapshot(source, target, include_credentials, byte_budget)` | 复制经过验证的数据，返回总字节数；遵守全局预算，默认移除配置中的凭据 |
| `lock(ctx)` | 返回快照期间需要持有的上下文锁；扩展未运行时可返回 `nullcontext()` |
| `restore_guard(ctx)` | 有未结束请求或其他不适合恢复的状态时抛出 `Conflict` |

宿主在生成工作区摘要时将文件名和文件 SHA-256 纳入；开始恢复后任何数据变化都会使原计划失效。快照锁顺序为任务操作锁、任务引擎锁、参与者锁、主数据库锁。扩展应保持一致的获取顺序。

`files(..., include_credentials=False)` 也用于验证导入包，因此必须拒绝“标注不含密钥但实际嵌入密钥”的数据。对话、文稿等用户内容应保持原文；无法安全清理的结构化凭据应拒绝导出，而不是默默改写历史。

实际恢复沿用宿主的重启前目录事务。扩展下次启用时应将旧的进行中操作标为中断或结果未知，不得直接重新提交。该逻辑属于扩展本身。

命令行检查带外部扩展数据的归档时，传入信任所属工作区：

```bash
python -m mio_server.backups inspect work.mio-workspace.zip --data /path/to/workspace
```

AI 辅助的具体渠道、对话和图片规则位于它自己的 `core/backup.py`，主程序的备份模块只使用上述通用接口。其配置使用 `extensions_data/ai-assist/config.json`，避免与 SDK 的通用 `settings.json` 重名。卸载默认保留整个所属数据目录，只有用户选择一并删除时才清除。
