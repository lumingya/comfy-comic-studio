# 数据目录与备份

所有路径均相对于 `server.py`（打包后为可执行程序）所在目录。用户数据不提交到 Git。

```text
data/
├── workflows/library.json          工作流库、节点与映射
├── storyboards/templates.json      共享分镜模板
├── storyboards/plans.json          画册计划、全册默认、单幕预设/工作流覆盖
├── presets/scene-presets.json       角色与画面预设
├── presets/characters.json          角色矩阵
├── albums/index.json                已生成画册、图片链接、源快照
├── queue/tasks.json                 待执行及历史生成任务
├── workspace/collections.json       画册集
├── workspace/state.json             界面、当前工作区及其他元数据
├── settings/comfy.json              ComfyUI 连接和当前工作流
├── settings/llm.json                文本模型设置
├── settings/xml_template.json       XML 模板设置
├── conversations/sessions.json      对话记录
├── assets/images/
│   ├── albums/<画册ID>/<SHA256>.png  新生成的原始光栅图片（也支持 jpg/webp/gif）
│   └── YYYY/MM/DD/comfy_*.png        按日期归档的图片
├── cache/marketplace.json            可重新获取的资源缓存
└── .config-transaction.json          保存过程的恢复日志，正常完成后自动移除
```

## 按画册找图片

进入 **设置 → 服务与保存 → 数据目录与备份 → 按画册名称查找图片目录**，可以查看名称与实际目录的对应关系。也可在 `albums/index.json` 查找标题和 `id`。

目录使用稳定画册 ID，而不是可随时修改的标题；文件名使用图片内容 SHA256，重复保存同一图片不会生成多份文件。重命名画册不影响图片引用。

- 新生成的 PNG/JPEG/WebP/GIF 经 `/api/store-image` 写入原图目录，画册里只记录 `/images/...` 同源相对链接。
- 不自动清理孤立图片，避免误删仍被历史快照或外部备份引用的文件。

## 多文件保存与恢复

同一次配置保存的检查、写入受同一进程锁保护。先写恢复日志，再分文件更新；中途失败时，下次读取会按恢复日志补齐整次写入。正常保存后自动删除日志。

- **不要在服务运行时用文本编辑器同时修改这些文件。** 通过 UI 编辑更安全。
- 不要手动删除尚未恢复的 `.config-transaction.json`。
- 此机制不代替离机备份，不是多台服务器共享存储方案，也不解决多个浏览器同时修改同一工程的所有编辑冲突。

## 备份与恢复

### 推荐：界面中的完整目录 ZIP

**设置 → 服务与保存 → 导出完整图片目录 ZIP**。这会调用已有的便携目录导出器，打包图片、分镜、预设、工作流与计划，使用与服务端 data 目录不同的便携结构。

换电脑后可解压，再使用 **载入已解压目录** 导入。不要把便携 ZIP 直接解压进服务端 `data/`。

### 直接复制程序数据

退出程序后复制完整 `data/`；在新电脑同一程序目录下恢复它们。配置与图片应一同备份，单独复制 `albums/index.json` 不包含外部图片。

### 工程 JSON

工程 JSON 包含配置与图片引用；本地 `/images/...` 引用不是内嵌图片。跨电脑时优先使用完整 ZIP，或同时复制图片目录。

### 工作流库

**工作流配置 → 导出全部**生成 `{version: 1, workflows: [...]}` JSON，可使用批量导入重新载入。支持原生 API JSON、多文件、数组和 `workflows` 包。导入会分配独立 ID，同名工作流不覆盖。

## 安全提示

直接复制的 `settings/`、对话及备份可能含私密信息或 API 密钥，不要上传公共仓库。数据目录不会通过静态文件服务公开；只允许应用资源及受限的图片路径。

服务默认只监听 `127.0.0.1`。若确需局域网部署，可以配置 `MIO_HOST` 与逗号分隔的 `MIO_ORIGINS` 明确允许来源；此应用没有增加用户认证，不建议直接暴露到公网。

## 本地凭证

`data/secrets/provider-keys.json` 单独存储图像渠道密钥，不属于 native config 或普通工程导出。文件未加密，完整物理目录备份需妥善保管；详情见 [渠道与密钥](guide/CHANNELS_AND_KEYS.md)。

## 生产基座新增目录

- `data/execution/jobs.sqlite3`：WAL 持久任务、幂等键、每幕结果、事件；`worker.lock` 防止重复工作进程。
- `data/assets/catalog.json`：可重建的文件摘要和尺寸索引。
- `data/assets/origins.json`：已记录的上传文件名与生成来源，不存密钥。
- `data/trash/`：用户确认回收的未引用素材，默认不永久删除。

任务中断不自动重试。请在服务停止后备份整个 data/，而非单独拷贝在线 SQLite 主文件。
