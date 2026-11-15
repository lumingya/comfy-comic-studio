# 工作区备份与恢复

「设置 → 数据与备份」可创建工作区备份、检查备份包并安排恢复。创作存档适合撤回一次作品编辑；工作区备份包含两个数据库和已登记的素材文件，用于恢复整个工作区。备份文件扩展名为 `.mio-workspace.zip`，与可分享的作品包 `.mio.zip` 不同。

## 日常操作

1. 等待生成、待核对任务和待交付结果处理完成，再创建备份。下载后的文件应另存到需要保留的位置。
2. 恢复时选择备份，先检查作品、话、素材和任务数量及提示。检查本身不会替换当前内容。
3. 暂存恢复计划，再明确安排恢复。此时自动创建当前工作区的保护备份，但正在运行的应用仍使用当前工作区。
4. 保存编辑并停止 Mio 服务，再正常启动。启动时复核备份校验值和当前内容版本后安装；安排恢复后若继续编辑，版本变化会使恢复被拒绝，需要重新暂存。

安排后、重启前可以取消。关闭浏览器不等于停止服务。应用不会调用系统命令远程重启自己。恢复成功后重新核对服务与扩展设置；ComfyUI 实例和 Webhook 保持停用，队列暂停，扩展需重新安装或审阅启用。

默认备份去掉已配置的 API 密钥、访问令牌、Webhook 密钥和 URL 凭据。高级选项可明确包含凭据，此时备份应作为秘密文件保存。工作流插件或历史请求中识别到嵌入凭据时，默认导出会拒绝，避免改写不可变的任务记录。检测不能识别任意文本或图片中的秘密，分享前仍应检查自己的内容。

恢复前的自动保护备份包含凭据，仅保存在本机恢复目录中；下载它同样需要管理权限。

## 开放 API

下表路径相对 `/api/v2`，全部要求 `admin`。本机界面使用同路径的 `/api`，遵循同一规则。请求和响应完整类型见 OpenAPI 与生成的 Python 客户端。

| 操作 | 方法与路径 | 请求 |
| --- | --- | --- |
| 检查当前版本与活动任务 | `GET /backups/head` | — |
| 创建备份 | `POST /backups` | `{"include_credentials": false}` |
| 读取 / 下载 / 删除备份 | `GET /backups/{id}`、`GET /backups/{id}/download`、`DELETE /backups/{id}` | — |
| 只读检查上传包 | `POST /backups/inspect` | ZIP 原始字节 |
| 暂存恢复计划 | `POST /backups/restore-plans` | ZIP 原始字节 |
| 读取计划 | `GET /backups/restore-plans/{id}` | — |
| 安排下次启动恢复 | `POST /backups/restore-plans/{id}/apply` | `expected_head` 与 `expected_archive_sha256` |
| 取消未安装计划 | `POST /backups/restore-plans/{id}/cancel` | — |

`expected_head` 取自暂存计划，`expected_archive_sha256` 取自该计划的 `inspection.sha256`，不能以最新查询值覆盖旧预览后直接确认。返回 `requires_restart: true` 表示已安排，不能当作已经恢复成功。计划状态可为 `staged`、`pending`、`installed`、`rejected`、`rolled_back`。备份被保护计划引用期间禁止删除。

## 停机恢复命令

服务无法正常打开时，可从 `server/` 使用相同的 Python 环境运行命令。除只读 `inspect` 外，先停止占用该工作区的 Mio；命令不加载扩展或访问生图服务。

```sh
python -m mio_server.backups inspect /path/to/archive.mio-workspace.zip
python -m mio_server.backups export --data /path/to/workspace --output /path/to/new-backup.zip
python -m mio_server.backups stage --data /path/to/workspace /path/to/archive.mio-workspace.zip
python -m mio_server.backups apply --data /path/to/workspace RESTORE_ID --expected-head HEAD --expected-archive-sha256 SHA256
python -m mio_server.backups install --data /path/to/workspace
```

`RESTORE_ID`、`HEAD` 和 `SHA256` 使用 `stage` 返回值。安装后再正常启动 Mio。`export` 可明确添加 `--include-credentials`，且拒绝覆盖已有输出文件。

## 范围与恢复目录

- 包含作品库、任务库、创作存档、创作套装、回收站及所有已登记素材；不包含扩展程序包、模型、ComfyUI 插件、外部服务文件、更新包、缓存与临时文件。
- 当前只接受同数据库结构版本的核心表；扩展自行创建的数据库表会使验证拒绝，避免默默丢失扩展数据。扩展应通过核心文档或自有明确的导入导出协议保存数据。
- ZIP 上限 2 GiB、展开后总量 4 GiB、单个数据库 256 MiB。更大的工作区可停服后完整复制实际数据目录；不要只复制数据库而漏掉素材。
- 恢复记录位于工作区旁的 `.<工作区目录名>.mio-recovery/`，含暂存包、保护备份、安装日志和替换前的目录。移动或手工备份工作区时应同时保留它。当前没有自动清理保留记录，磁盘占用会随恢复次数增加。
- 安装使用独占工作区租约、校验清单和可恢复日志；覆盖进程中断与重启恢复。Windows 上不能据此声称突然断电也一定无损。需要独立的外部备份来应对磁盘损坏。
