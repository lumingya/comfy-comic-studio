# Mio API v2.0.0 · 路由总表

> 由 `python tools/build_api_docs.py` 从路由表生成，请勿手工编辑。完整请求/响应结构见 [openapi.json](openapi.json)，使用说明见 [README](README.md)。

## system

健康检查、能力发现、OpenAPI 文档与路由索引。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/v1/health` | 服务健康与版本 |
| `GET` | `/api/v1/capabilities` | 能力发现：功能区、操作数、支持的图像服务 |
| `GET` | `/api/v1/openapi.json` | 本 API 的 OpenAPI 3.1 文档（不套信封） |
| `GET` | `/api/v1/routes` | 全部路由的精简索引（方法、路径、说明、标签） |

## workspace

工作区状态、完整快照、索引重建与文件问题。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/v1/library/problems` | 文件问题：无法解析的文件、重复 ID |
| `POST` | `/api/v1/library/rescan` | 重新扫描文件夹（手工复制文件后），返回问题列表 |

## library

文件库通用读写：分镜、角色/场景预设、画册集、创作计划、画册、版式、工作流、角色行、会话。支持 ETag 并发控制、合并补丁、复制、导入导出与排序。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/v1/library` | 文件库概览：各类资源数量、是否可写、目录修订号与索引状态 |
| `GET` | `/api/v1/library/problems` | 文件问题：无法解析的文件、重复 ID |
| `POST` | `/api/v1/library/rescan` | 重新扫描文件夹（手工复制文件后），返回问题列表 |
| `GET` | `/api/v1/library/{kind}` | 列出一类资源（分页、搜索、按画册集过滤、排序） |
| `POST` | `/api/v1/library/{kind}` | 新建资源（请求体即文档；缺省 id 自动分配、projectId 默认当前画册集） |
| `POST` | `/api/v1/library/{kind}/reorder` | 调整界面中的显示顺序（列出的 ID 排在最前，其余保持原顺序） |
| `GET` | `/api/v1/library/{kind}/{id}` | 读取完整文档（响应头带 ETag） |
| `PUT` | `/api/v1/library/{kind}/{id}` | 替换整个文档；不存在时创建（If-Match 做并发保护，If-None-Match: * 只创建） |
| `PATCH` | `/api/v1/library/{kind}/{id}` | 合并补丁（RFC 7396：null 删除字段，对象递归合并，数组整体替换） |
| `DELETE` | `/api/v1/library/{kind}/{id}` | 删除（移入回收站，可用 /recycle 恢复）；画册集默认拒绝删除非空集合 |
| `POST` | `/api/v1/library/{kind}/{id}/duplicate` | 复制资源（新 ID，标题加「副本」，图片一并复制） |
| `GET` | `/api/v1/library/{kind}/{id}/bundle` | 导出为 .mio.zip 分享包（含图片，可再导入） |
| `POST` | `/api/v1/library/inspect` | 预览待导入的分享包 / JSON / HTML 画册（只读） |
| `POST` | `/api/v1/library/import` | 导入分享包 / JSON / HTML 画册为新资源（总是分配新 ID） |
| `POST` | `/api/v1/library/export` | 把一份（未保存的）文档打包成 .mio.zip |

## albums

画册：列表、详情、修改、删除、逐页图片编辑、导入导出。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/v1/albums` | 画册列表（状态、进度、封面） |
| `GET` | `/api/v1/albums/{albumId}` | 画册详情：每一页的台词、提示词、图片与 assetEndpoint |
| `POST` | `/api/v1/albums/export` | 导出画册为自包含 HTML（套用版式）、ZIP 或 PDF 文件 |
| `POST` | `/api/v1/albums/page` | 保存 / 移除 / 恢复画册某一页的图片（非破坏式编辑记录） |
| `GET` | `/api/v1/albums/page-edits` | 页面编辑记录（after 之后，按序号） |
| `POST` | `/api/v1/albums/delete` | 批量删除画册，同时停止并删除相关任务（进入回收站） |

## generation

同步单张出图（云端渠道）。整册、可恢复的执行请用 jobs 或 production。

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/v1/images/generations` | 同步生成一张图（NovelAI / OpenAI 兼容渠道），不自动重试 |

## jobs

持久生成任务：幂等提交、暂停/继续/取消/重试、失败策略、事件回放。与浏览器队列共用同一执行器。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/v1/jobs` | 活动任务与最近历史（最多 2000 条，列表不含结果明细） |
| `POST` | `/api/v1/jobs` | 幂等提交一个持久任务（idempotencyKey 相同则返回同一任务） |
| `GET` | `/api/v1/jobs/activity` | 最近 200 条持久执行记录（after 之后） |
| `GET` | `/api/v1/jobs/events` | SSE 事件回放；用 Last-Event-ID 或 after 续读 |
| `POST` | `/api/v1/jobs/reorder` | 调整尚未开始的等待任务顺序 |
| `GET` | `/api/v1/jobs/{jobId}` | 任务详情：状态、上游 ID、产物、逐帧状态 |
| `POST` | `/api/v1/jobs/{jobId}` | 控制任务或调度器（action：pause/resume/cancel/retry/policy/runtime/amend …） |

## production

生产队列：分镜 + 预设 + 渠道/工作流 → 画册；装配、开始、暂停、克隆、逐幕修改。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/v1/production/tasks` | 生产队列：全部任务、控制状态（支持 If-None-Match → 304） |
| `POST` | `/api/v1/production/tasks` | 装配一个生产任务（同 POST /production/assemble） |
| `GET` | `/api/v1/production/tasks/{taskId}` | 任务详情：状态、逐页状态、画册 ID |
| `DELETE` | `/api/v1/production/tasks/{taskId}` | 删除任务（?deleteAlbums=true 连同画册） |
| `GET` | `/api/v1/production/tasks/{taskId}/clone-source` | 克隆任务时可调整的来源参数 |
| `GET` | `/api/v1/production/tasks/{taskId}/frames/{index}` | 任务内某一幕的来源与当前状态 |
| `PATCH` | `/api/v1/production/tasks/{taskId}/frames/{index}` | 修改任务内某一幕（name / prompt / negative / caption） |
| `POST` | `/api/v1/production/tasks/{taskId}/start` | 开始任务（付费渠道需 trusted: true）（单任务） |
| `POST` | `/api/v1/production/tasks/{taskId}/pause` | 暂停任务（id 或 ids）（单任务） |
| `POST` | `/api/v1/production/tasks/{taskId}/resume` | 继续任务（id 或 ids）（单任务） |
| `POST` | `/api/v1/production/tasks/{taskId}/cancel` | 停止任务（id 或 ids）；在途请求的结果仍会保留（单任务） |
| `POST` | `/api/v1/production/tasks/{taskId}/clone` | 克隆任务（可调整模型 / LoRA / 种子等）（单任务） |
| `POST` | `/api/v1/production/tasks/{taskId}/rename` | 重命名任务（单任务） |
| `POST` | `/api/v1/production/assemble` | 装配一个生产任务（分镜 + 预设 + 渠道/工作流 → 画册） |
| `POST` | `/api/v1/production/assemble-batch` | 批量装配多个任务 |
| `POST` | `/api/v1/production/start` | 开始任务（付费渠道需 trusted: true） |
| `POST` | `/api/v1/production/start-many` | 并行开始多个任务 |
| `POST` | `/api/v1/production/start-sequence` | 按顺序依次执行多个任务 |
| `POST` | `/api/v1/production/pause` | 暂停任务（id 或 ids） |
| `POST` | `/api/v1/production/resume` | 继续任务（id 或 ids） |
| `POST` | `/api/v1/production/cancel` | 停止任务（id 或 ids）；在途请求的结果仍会保留 |
| `POST` | `/api/v1/production/remove` | 删除任务；deleteAlbums: true 时连同生成的画册一起删除 |
| `POST` | `/api/v1/production/clone` | 克隆任务（可调整模型 / LoRA / 种子等） |
| `POST` | `/api/v1/production/reorder` | 调整队列顺序 |
| `POST` | `/api/v1/production/clear-finished` | 清除已完成的任务 |
| `POST` | `/api/v1/production/concurrency` | 设置全局或单任务并发 |
| `POST` | `/api/v1/production/live-sync` | 设置实时同步（任务运行中跟随分镜 / 预设 / 工作流修改） |
| `POST` | `/api/v1/production/rename` | 重命名任务 |
| `POST` | `/api/v1/production/update-frame` | 修改任务内某一幕的名称 / 提示词 / 负向 / 台词 |
| `POST` | `/api/v1/production/recover-publication` | 重新发布已生成但未写入画册的一页 |
| `POST` | `/api/v1/production/analyze-slots` | 分析 ComfyUI 工作流的可调槽位（模型、LoRA、尺寸…） |
| `POST` | `/api/v1/production/apply-slots` | 把槽位覆盖应用到 ComfyUI 工作流，返回新工作流 |

## workflows

ComfyUI 工作流：连接检查、节点信息、槽位分析与应用、设为当前工作流。

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/v1/production/analyze-slots` | 分析 ComfyUI 工作流的可调槽位（模型、LoRA、尺寸…） |
| `POST` | `/api/v1/production/apply-slots` | 把槽位覆盖应用到 ComfyUI 工作流，返回新工作流 |

## assets

本地图片素材：读取、原始字节、上传、抓取远程图片、索引与清理、维护。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/v1/assets` | 读取本地图片为 data URL |
| `POST` | `/api/v1/assets/upload` | 上传图片素材（data URL），返回可在文档中引用的 /images/ 地址 |
| `GET` | `/api/v1/assets/catalog` | 素材索引：来源、引用、缺失文件与可清理预览 |
| `POST` | `/api/v1/assets/cleanup` | 把预览过的、24 小时以上未引用的素材移入回收站 |

## catalog

给聊天机器人的精简只读视图：一次拿到可选的工作流、分镜、预设、版式、渠道和画册集。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/v1/storyboards` | 分镜列表（含分幕的公开字段，不含执行快照） |
| `GET` | `/api/v1/albums` | 画册列表（状态、进度、封面） |
| `GET` | `/api/v1/catalog` | 一次返回工作流、分镜、预设、版式、渠道和画册集的精简目录 |
| `GET` | `/api/v1/resources/workflows` | 已保存的 ComfyUI 工作流（不含节点图） |
| `GET` | `/api/v1/resources/characters` | 角色预设（精简） |
| `GET` | `/api/v1/resources/scenes` | 场景预设（精简） |
| `GET` | `/api/v1/resources/presets` | 角色与场景预设（带 category） |
| `GET` | `/api/v1/resources/layouts` | 画册导出版式（不含 HTML） |
| `GET` | `/api/v1/resources/channels` | 图像渠道（不含密钥与地址） |
| `GET` | `/api/v1/resources/collections` | 画册集（项目） |
| `GET` | `/api/v1/resources/storyboards` | 分镜可编辑 DTO 与工作区修订号（旧接口，请改用 /library/storyboards） *(deprecated)* |
| `POST` | `/api/v1/resources/storyboards` | 按工作区修订号 upsert 分镜（旧接口，请改用 /library/storyboards） *(deprecated)* |
| `GET` | `/api/v1/resources/plans` | 创作计划 DTO 与工作区修订号（旧接口，请改用 /library/plans） *(deprecated)* |
| `POST` | `/api/v1/resources/plans` | 按工作区修订号 upsert 创作计划（旧接口，请改用 /library/plans） *(deprecated)* |

共 82 个操作。
