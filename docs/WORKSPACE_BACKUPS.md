# 工作区备份与恢复

「设置 → 数据与备份」可创建工作区备份、检查备份包并安排恢复。创作存档适合撤回一次作品编辑；工作区备份包含两个数据库、已登记的素材文件和扩展的 JSON 设置，用于恢复整个工作区。备份文件扩展名为 `.mio-workspace.zip`，与可分享的作品包 `.mio.zip` 不同。

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
| 分页发现本机保留记录 | `GET /backups`、`GET /backups/restore-plans` | `offset`、`limit`（1–100，默认 20） |
| 读取 / 下载 / 删除备份 | `GET /backups/{id}`、`GET /backups/{id}/download`、`DELETE /backups/{id}` | — |
| 只读检查上传包 | `POST /backups/inspect` | ZIP 原始字节 |
| 暂存恢复计划 | `POST /backups/restore-plans` | ZIP 原始字节 |
| 读取计划 | `GET /backups/restore-plans/{id}` | — |
| 安排下次启动恢复 | `POST /backups/restore-plans/{id}/apply` | `expected_head` 与 `expected_archive_sha256` |
| 取消未安装计划 | `POST /backups/restore-plans/{id}/cancel` | — |
| 删除已结束或未安排的计划 | `DELETE /backups/restore-plans/{id}` | — |

`expected_head` 取自暂存计划，`expected_archive_sha256` 取自该计划的 `inspection.sha256`，不能以最新查询值覆盖旧预览后直接确认。返回 `requires_restart: true` 表示已安排，不能当作已经恢复成功。计划状态可为 `staged`、`pending`、`installed`、`rejected`、`rolled_back`。备份被保护计划引用期间禁止删除。

设置页默认折叠的「本机保留记录」可查询计划、下载或明确删除记录，浏览器丢失计划 ID 后也能找回。列表返回 `items`、`total`、`offset`、`limit`、`next_offset`，并列出可删除状态及保留体积。列表不是恢复确认：安排恢复仍须重新读取具体计划及当前版本。正在安排或安装、以及安装后尚未成功启动的计划不能清理；先取消未启动的安排。删除计划会清理其暂存包和替换前的目录，但保留保护备份，之后可再明确删除该备份。

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

- 包含作品库、任务库、创作存档、创作套装、回收站、所有已登记素材、独立主题包，以及 SDK 保存的 `extensions_data/<id>/settings.json` 设置；不包含扩展程序包、模型、ComfyUI 插件、外部服务文件、更新包、缓存与临时文件。扩展设置只允许合法名称、顶层 JSON 对象和每文件不超过 1 MiB；默认检测到嵌入凭据则拒绝导出，需要明确选择包含凭据。扩展代码重新安装后可读取保留的设置，备份恢复不会自动启用代码。
- 主题私有设置 `theme_data/<id>/preferences.json`、浮窗偏好 `extensions_data/<id>/preferences.json` 和用户壁纸 `theme_data/<id>/wallpapers/` 同样参与内容版本、快照、恢复预检和重启恢复，包括内置主题、用户令牌主题、独立包、扩展贡献及卸载后保留的数据。偏好每文件上限 1 MiB，壁纸每文件上限 1 GiB，媒体与元数据必须匹配；偏好中的嵌入凭据遵循同一明确授权规则。私人壁纸进入工作区备份，但不进入可分享的主题 ZIP。
- 已有 `extension_data/<id>/preferences.json` 与 `themes/<id>/user_wallpapers/` 不自动迁移或删除：新位置优先、旧位置回退；备份和 head 同时携带新旧物理来源，包括被新值遮蔽的旧值。显式删除媒体或所属私有数据时才清理相应副本，避免旧数据在删除后复活。SDK 的 `settings.json` 和宿主的 `preferences.json` 均为宿主保留文件，扩展备份参与者不得抢占或改写。
- 当前只接受同数据库结构版本的核心表，另以必填的 `jobs_schema_version: 2` 标记执行器身份表。缺失或不支持该标识的旧包会明确拒绝，不为旧任务推断执行器身份。扩展自行创建的数据库表会使验证拒绝，避免默默丢失扩展数据；扩展应使用 SDK 设置、核心文档或自有明确的导入导出协议保存数据。
- ZIP 上限 12 GiB、展开后总量 16 GiB、单个数据库 256 MiB。主题媒体通过分块磁盘 I/O 纳入备份，不会整文件载入内存。更大的工作区可停服后完整复制实际数据目录；不要只复制数据库而漏掉素材。
- 恢复记录位于工作区旁的 `.<工作区目录名>.mio-recovery/`，含暂存包、保护备份、安装日志和替换前的目录。移动或手工备份工作区时应同时保留它。不自动清理记录；确认不再需要后可在设置或 API 中明确删除，磁盘占用会随保留数量增加。
- 安装使用独占工作区租约、校验清单和可恢复日志；覆盖进程中断与重启恢复。Windows 上不能据此声称突然断电也一定无损。需要独立的外部备份来应对磁盘损坏。
