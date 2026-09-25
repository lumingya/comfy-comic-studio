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

## storyboards

分镜的分幕（frames）细粒度增删改与排序。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/v1/library/storyboards/{id}/frames` | 分镜的全部分幕（带序号） |
| `POST` | `/api/v1/library/storyboards/{id}/frames` | 新增分幕：单个对象、frames 数组，或 count 批量生成空白分幕 |
| `GET` | `/api/v1/library/storyboards/{id}/frames/{frame}` | 读取一幕 |
| `PATCH` | `/api/v1/library/storyboards/{id}/frames/{frame}` | 合并补丁修改一幕（提示词、台词、镜头、尺寸…） |
| `DELETE` | `/api/v1/library/storyboards/{id}/frames/{frame}` | 删除一幕 |
| `POST` | `/api/v1/library/storyboards/{id}/frames/reorder` | 调整分幕顺序（列出的分幕排在最前） |

## presets

角色 / 场景预设的变量条目（entries）细粒度读写。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/v1/library/{kind}/{id}/entries` | 预设的全部变量条目 |
| `PUT` | `/api/v1/library/{kind}/{id}/entries/{key}` | 写入一个变量（按变量名新增或覆盖） |
| `DELETE` | `/api/v1/library/{kind}/{id}/entries/{key}` | 删除一个变量 |

## albums

画册：列表、详情、修改、删除、逐页图片编辑、导入导出。

| 方法 | 路径 | 说明 |
|---|---|---|
| `PATCH` | `/api/v1/albums/{albumId}` | 合并补丁修改画册（标题、简介、标签、喜欢、封面…；同 /library/albums/{id}） |
| `DELETE` | `/api/v1/albums/{albumId}` | 删除画册（同时删除相关任务，进入回收站） |
| `POST` | `/api/v1/albums` | 新建画册（同 POST /library/albums；steps 的 image 可用 data URL） |
| `GET` | `/api/v1/albums/{albumId}/steps/{index}` | 读取画册的一页 |
| `PATCH` | `/api/v1/albums/{albumId}/steps/{index}` | 合并补丁修改一页（台词、提示词、名称、图片 URL/data URL）；页不存在时创建 |
| `DELETE` | `/api/v1/albums/{albumId}/steps/{index}` | 删除一页的内容（图片、台词、提示词） |
| `POST` | `/api/v1/albums/{albumId}/steps/{index}/critique` | 审查画册某一页并把审图结果保存到这一页 |
| `GET` | `/api/v1/albums` | 画册列表（状态、进度、封面） |
| `GET` | `/api/v1/albums/{albumId}` | 画册详情：每一页的台词、提示词、图片与 assetEndpoint |
| `POST` | `/api/v1/albums/export` | 导出画册为自包含 HTML（套用版式）、ZIP 或 PDF 文件 |
| `GET` | `/api/v1/exporters` | 可用的画册导出器（内置 pages-zip 与扩展注册的导出器） |
| `GET` | `/api/v1/importers` | 可用的画册导入器（内置 pages-zip 与扩展注册的导入器） |
| `POST` | `/api/v1/albums/{albumId}/export` | 用指定导出器导出一本画册（默认 pages-zip：页面图片 + album.json） |
| `POST` | `/api/v1/albums/import` | 用指定导入器导入画册（二进制上传或 {importer, payload, options}） |
| `POST` | `/api/v1/albums/page` | 保存 / 移除 / 恢复画册某一页的图片（非破坏式编辑记录） |
| `GET` | `/api/v1/albums/page-edits` | 页面编辑记录（after 之后，按序号） |
| `POST` | `/api/v1/albums/delete` | 批量删除画册，同时停止并删除相关任务（进入回收站） |

## settings

设置文档（comfy / llm / xml / workspace）读写；密钥只写不读。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/v1/settings` | 设置文档列表：名称、ETag、已保存密钥的位置 |
| `GET` | `/api/v1/settings/{name}` | 读取设置文档（不含密钥值；?view=true 返回界面使用的展开视图） |
| `PUT` | `/api/v1/settings/{name}` | 替换设置文档（密钥字段填明文即保存到本地密钥库；留空则保持原密钥） |
| `PATCH` | `/api/v1/settings/{name}` | 合并补丁修改设置（例：切换当前画册集、修改 LLM 模型） |
| `GET` | `/api/v1/settings/{name}/secrets` | 哪些位置保存了密钥、哪些位置可以保存密钥（不返回值） |
| `PUT` | `/api/v1/settings/{name}/secrets` | 保存一个密钥（例：{pointer: "/key", value: "sk-…"}） |
| `DELETE` | `/api/v1/settings/{name}/secrets` | 删除一个已保存的密钥（?pointer=/key） |

## channels

图像渠道：增删改、设为当前、测试连接、模型列表、密钥池；以及图像服务类型注册表。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/v1/providers` | 图像服务类型注册表（内置 + 扩展注册），含字段定义与能力 |
| `GET` | `/api/v1/providers/{providerId}` | 一个图像服务类型的字段、默认值与能力 |
| `GET` | `/api/v1/channels` | 已保存的图像渠道与当前渠道（不含密钥） |
| `POST` | `/api/v1/channels` | 新建渠道（可同时保存 API Key，并设为当前渠道） |
| `GET` | `/api/v1/channels/{channelId}` | 读取一个渠道 |
| `PATCH` | `/api/v1/channels/{channelId}` | 修改渠道（合并补丁）；更换地址或服务类型且未给新 Key 时会解除旧 Key |
| `DELETE` | `/api/v1/channels/{channelId}` | 删除渠道及其保存的 Key（内置 ComfyUI 渠道不可删除） |
| `POST` | `/api/v1/channels/{channelId}/activate` | 设为当前渠道 |
| `POST` | `/api/v1/channels/{channelId}/check` | 测试连接（ComfyUI：系统状态；云端渠道：读取模型列表） |
| `GET` | `/api/v1/channels/{channelId}/models` | 渠道可用的模型列表（ComfyUI：节点信息与模型目录） |
| `GET` | `/api/v1/channels/{channelId}/keys` | 渠道的 Key 池（只返回 ID、标签、创建时间） |
| `POST` | `/api/v1/channels/{channelId}/keys` | 向 Key 池添加一个 Key（多个 Key 轮流使用） |
| `DELETE` | `/api/v1/channels/{channelId}/keys/{keyId}` | 从 Key 池删除一个 Key |

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
| `POST` | `/api/v1/comfy/check` | 检查 ComfyUI 是否可用（默认使用已保存的地址） |
| `GET` | `/api/v1/comfy/object-info` | ComfyUI 节点信息（/object_info）与已安装模型目录 |
| `POST` | `/api/v1/production/analyze-slots` | 分析 ComfyUI 工作流的可调槽位（模型、LoRA、尺寸…） |
| `POST` | `/api/v1/production/apply-slots` | 把槽位覆盖应用到 ComfyUI 工作流，返回新工作流 |

## llm

文本模型与视觉审图：使用已保存的连接与密钥，在服务端代发请求。

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/v1/llm/chat` | 用已保存的文本模型连接发送对话（OpenAI 兼容 chat/completions） |
| `POST` | `/api/v1/vision/audit` | 视觉审图：用已保存的审图模型评估一张图（分数、一致性、解剖、建议） |
| `POST` | `/api/v1/albums/{albumId}/steps/{index}/critique` | 审查画册某一页并把审图结果保存到这一页 |

## assets

本地图片素材：读取、原始字节、上传、抓取远程图片、索引与清理、维护。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/v1/maintenance/assets` | 素材池体检：未被引用的文件、缺失引用、可回收预览（含 token） |
| `POST` | `/api/v1/maintenance/assets/gc` | 回收未引用素材：apply=false 预览，apply=true 按预览 token 移入回收站 |
| `POST` | `/api/v1/maintenance/assets/restore` | 恢复一批回收的素材 |
| `POST` | `/api/v1/maintenance/trash/purge` | 永久删除超过指定天数的回收素材 |
| `GET` | `/api/v1/assets` | 读取本地图片为 data URL |
| `POST` | `/api/v1/assets/upload` | 上传图片素材（data URL），返回可在文档中引用的 /images/ 地址 |
| `GET` | `/api/v1/assets/catalog` | 素材索引：来源、引用、缺失文件与可清理预览 |
| `POST` | `/api/v1/assets/cleanup` | 把预览过的、24 小时以上未引用的素材移入回收站 |

## recycle

回收站：列出、恢复、永久删除、清空、自动清理。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/v1/recycle` | 回收站：可恢复的资源、素材批次和文件批次（新的在前） |
| `POST` | `/api/v1/recycle/restore` | 恢复：trashId（资源、assets:批次、files:批次）或 {kind, id} 的最新一次删除 |
| `POST` | `/api/v1/recycle/purge` | 永久删除回收站中的一项 |
| `POST` | `/api/v1/recycle/empty` | 清空回收站（不可撤销） |
| `POST` | `/api/v1/recycle/auto-clean` | 按保留天数清理（0 / 7 / 30 / 90；0 表示不清理） |
| `POST` | `/api/v1/maintenance/trash/purge` | 永久删除超过指定天数的回收素材 |

## ecosystem

扩展、主题、样式、用户脚本、预处理、事件与导入导出器；以及扩展自身的后端路由。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/v1/ecosystem/status` | 生态总览：扩展、主题、样式、脚本、平台清单、安全模式、Node/Git 可用性 |
| `GET` | `/api/v1/ecosystem/platform` | 平台清单：图像服务、导出器、导入器、钩子与事件 |
| `GET` | `/api/v1/ecosystem/activity` | 最近的事件、失败与通知（?since=时间戳） |
| `GET` | `/api/v1/ecosystem/watch` | 链接目录（开发模式）的变更与修订号 |
| `GET` | `/api/v1/ecosystem/themes/compiled` | 当前主题栈与用户样式编译后的 CSS |
| `GET` | `/api/v1/ecosystem/styles` | 样式工坊状态：片段、设计令牌、资源 |
| `GET` | `/api/v1/ecosystem/styles/css` | 用户自定义 CSS |
| `GET` | `/api/v1/ecosystem/scripts` | 用户脚本列表（含源码） |
| `GET` | `/api/v1/ecosystem/preparations` | 预处理（计算变量宏）列表 |
| `POST` | `/api/v1/ecosystem/events/emit` | 广播一个自定义事件（app.* 除外） |
| `POST` | `/api/v1/ecosystem/extensions/install` | 安装扩展（git url / 本地 path / zip base64；需要 trusted: true 才能启用代码） |
| `POST` | `/api/v1/ecosystem/extensions/enable` | 启用或停用扩展（启用需 trusted: true） |
| `POST` | `/api/v1/ecosystem/extensions/update` | 更新扩展（git 安装） |
| `POST` | `/api/v1/ecosystem/extensions/uninstall` | 卸载扩展（purge: none / cache / all） |
| `POST` | `/api/v1/ecosystem/extensions/purge` | 清除扩展数据（level: cache / all） |
| `POST` | `/api/v1/ecosystem/extensions/link` | 链接本地扩展目录（热重载开发） |
| `POST` | `/api/v1/ecosystem/extensions/reload` | 重新加载扩展 |
| `POST` | `/api/v1/ecosystem/extensions/deps` | 安装扩展的 Python 依赖（requirements） |
| `POST` | `/api/v1/ecosystem/themes/install` | 安装主题包（zip base64） |
| `POST` | `/api/v1/ecosystem/themes/link` | 链接本地主题目录 |
| `POST` | `/api/v1/ecosystem/themes/reload` | 重新加载主题 |
| `POST` | `/api/v1/ecosystem/themes/select` | 选择唯一主题（空 id 恢复默认） |
| `POST` | `/api/v1/ecosystem/themes/enable` | 在主题栈中启用或停用一个主题 |
| `POST` | `/api/v1/ecosystem/themes/order` | 调整主题叠加顺序 |
| `POST` | `/api/v1/ecosystem/themes/settings` | 修改主题的可调设置项 |
| `POST` | `/api/v1/ecosystem/themes/uninstall` | 卸载主题 |
| `POST` | `/api/v1/ecosystem/styles/snippet` | 保存一个样式片段 |
| `POST` | `/api/v1/ecosystem/styles/snippets` | 替换全部样式片段 |
| `POST` | `/api/v1/ecosystem/styles/snippet/delete` | 删除样式片段 |
| `POST` | `/api/v1/ecosystem/styles/tokens` | 设置设计令牌（CSS 变量覆盖） |
| `POST` | `/api/v1/ecosystem/styles/assets/upload` | 上传样式资源（字体、图片；base64） |
| `POST` | `/api/v1/ecosystem/styles/assets/delete` | 删除样式资源 |
| `POST` | `/api/v1/ecosystem/styles/export` | 把当前样式导出为主题包（返回 zip 文件） |
| `POST` | `/api/v1/ecosystem/scripts/save` | 保存用户脚本 |
| `POST` | `/api/v1/ecosystem/scripts/delete` | 删除用户脚本 |
| `POST` | `/api/v1/ecosystem/scripts/order` | 调整用户脚本顺序 |
| `POST` | `/api/v1/ecosystem/scripts/toggle` | 启用或停用用户脚本 |
| `POST` | `/api/v1/ecosystem/preparations` | 运行一个预处理（计算变量宏） |
| `POST` | `/api/v1/ecosystem/preparations/cancel` | 取消正在运行的预处理 |
| `POST` | `/api/v1/ecosystem/cache/clear` | 清除预处理缓存（需 trusted: true） |
| `POST` | `/api/v1/ecosystem/reset` | 一键恢复：停用全部扩展、主题与脚本（styles: true 同时停用样式片段） |
| `GET` | `/api/v1/ecosystem/scripts/{scriptId}` | 读取一个用户脚本（含源码） |
| `GET` | `/api/v1/ecosystem/preparations/{preparationId}` | 读取一个预处理的状态与结果 |
| `GET` | `/api/v1/ecosystem/themes/css/{themeId}` | 编译一个主题的 CSS |
| `GET` | `/api/v1/ecosystem/extensions/{extensionId}/files/{path}` | 读取扩展目录中的文件（目录则列出） |
| `PUT` | `/api/v1/ecosystem/extensions/{extensionId}/files/{path}` | 写入扩展目录中的文件（二进制或 {b64}/{text}） |
| `POST` | `/api/v1/ecosystem/extensions/{extensionId}/files/{path}` | 写入扩展目录中的文件（同 PUT） |
| `DELETE` | `/api/v1/ecosystem/extensions/{extensionId}/files/{path}` | 删除扩展目录中的文件 |
| `GET` | `/api/v1/ecosystem/extensions/{extensionId}/files` | 列出扩展目录的文件 |
| `GET` | `/api/v1/ecosystem/{route}` | 其余生态路由的通用桥接（与界面 /api/ecosystem/* 相同） |
| `POST` | `/api/v1/ecosystem/{route}` | 其余生态路由的通用桥接（与界面 /api/ecosystem/* 相同） |
| `PUT` | `/api/v1/ecosystem/{route}` | 其余生态路由的通用桥接（与界面 /api/ecosystem/* 相同） |
| `DELETE` | `/api/v1/ecosystem/{route}` | 其余生态路由的通用桥接（与界面 /api/ecosystem/* 相同） |
| `GET` | `/api/v1/extensions` | 已安装的扩展（ID、版本、是否启用、后端能力） |
| `GET` | `/api/v1/extensions/{extensionId}/{tail}` | 调用扩展后端（扩展自定义路由，以及 storage / settings / capabilities / tasks） |
| `POST` | `/api/v1/extensions/{extensionId}/{tail}` | 调用扩展后端（扩展自定义路由，以及 storage / settings / capabilities / tasks） |
| `PUT` | `/api/v1/extensions/{extensionId}/{tail}` | 调用扩展后端（扩展自定义路由，以及 storage / settings / capabilities / tasks） |
| `PATCH` | `/api/v1/extensions/{extensionId}/{tail}` | 调用扩展后端（扩展自定义路由，以及 storage / settings / capabilities / tasks） |
| `DELETE` | `/api/v1/extensions/{extensionId}/{tail}` | 调用扩展后端（扩展自定义路由，以及 storage / settings / capabilities / tasks） |

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

共 194 个操作。
