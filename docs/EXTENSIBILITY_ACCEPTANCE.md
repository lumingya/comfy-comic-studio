# 创作与扩展能力验收索引

本索引将工作流接入、可复用创作套装、长篇整理、恢复备份和扩展操作连接到实际入口与可重放的回归测试。主界面以手工编辑和明确开始生成为默认；专业工具通过可选扩展和 API 提供。各版本的实跑结果与未覆盖范围须查阅对应验收记录，不能将测试入口清单当作真实服务认证。

## 用户操作与可重放证据

| 目标 | 实际入口与行为 | 关键验证 |
| --- | --- | --- |
| ComfyUI 工作流接入 | 导入先预检，再明确保存；报告候选映射、歧义、缺节点 / 模型与参数问题。手动映射和所选输出分支参与实际编译，扩展可以增加识别规则 | `test_workflow_inspection.py`、`test_workflow_slots_v3.py`；`WorkflowInspection.test.tsx` |
| 套装可携带与复用 | 分镜、角色 / 画风、预设、出图配置、工作流和素材组成独立套装；导入重映射引用，服务绑定明确选择或保持待配置 | `test_creation_kits.py`；`CreationKits.test.tsx` |
| 套装可继续编辑 | 原分镜 / 预设工坊选择来源并复用编辑器；保存失败留在原来源，切换不混写；单独试绘只创建待生成画册 | `test_kit_editing.py`；`WorkshopSource.test.tsx`、`App.smoke.test.tsx` |
| 长篇作品整理 | 跨话复制 / 移动分镜、整话复制 / 重排、精确变量查找 / 预览 / 应用；保留相对位置、留白与引用，冲突不部分写入 | `test_longform_panels.py`、`test_longform_variables.py`、`test_longform_api.py`；`longform.test.tsx` |
| 撤回作品编辑 | 命名创作存档、差异预览、恢复前自动保护、明确删除；版本单调递增，相关活动或待交付任务阻止破坏性恢复 | `test_checkpoints.py`、`test_operation_guard.py`；`CheckpointDialog.test.tsx` |
| 已收到结果不会重复应用 | 先持久化结果交付，作品修改与回执同事务；重启幂等补写，未知执行器不冒充可重放 | `test_result_delivery.py` |
| 整个工作区恢复 | 两数据库、素材、用户安装的独立主题包、主题私有偏好与壁纸、扩展设置/偏好及已审阅参与者的数据；统一内容头、归档校验、暂存、明确安排和重启恢复；开放 API 与停机 CLI 共用规则 | `test_backup.py`、`test_constructor_cleanup.py`、`test_backup_extension_data.py`、`test_backup_themes.py`、`test_backup_ui_data.py`；`BackupsSection.test.tsx` |
| 备份记录可管理 | 本机保留记录按需展开、分页、下载、明确清理；安装中与启动保护记录不可删除，删除计划不顺带删除保护备份 | `test_backup_catalog.py`；`BackupHistory.test.tsx` |
| 主题与扩展窗口偏好一致写入 | 强 ETag/CAS 与对象子树更新保留兄弟字段；旧响应不能覆盖新意图；私有偏好参与备份与重启恢复 | `test_preference_concurrency.py`、`test_backup_ui_data.py`；`preferenceWrites.test.tsx`、`host.test.tsx` |

上表测试源码位于 `server/tests/` 与 `web/src/` 对应模块；历史执行数量和阶段结果见[路线图](ROADMAP.md)，扩展/主题平台加固的实跑结果见[架构详解](../架构详解.md#83-实际执行记录与边界)。单测中模拟服务请求，不能据此声称所有 ComfyUI 插件已通过真实服务认证。依赖浏览器前端状态的插件需要具体适配；已实现的状态快照与恢复边界见[客户端说明](../clients/README.md)。

## 扩展如何真正改变行为

- **核心 HTTP 操作**：本机界面与 `/api/v2` 使用同一业务路由和操作 ID。`GET /api/v2/operations` 发现请求模板、权限、参数名与包装来源；`mio.operation` 可组合或替换操作实现，保留认证及输入 / 输出类型校验。包装失败不会自动重试副作用。
- **任务执行器**：`mio.job_executor` 与 `mio.contribute('job_executor', …)` 接入任务引擎。任务保存 `kind/source/digest`；执行、结果回调、核对与恢复使用原身份。缺失身份时保留待处理状态，不自动换成另一实现。管理员只能为从未尝试、无结果和端点租约的任务明确重绑。
- **扩展自身设置**：SDK 和 `GET/PUT /api/v2/extensions/{id}/settings` 共用有大小限制的 JSON 原子保存；无需启用代码即可配置。设置与数据库一起参与备份版本检查，明确包含凭据的选项适用于这些数据。
- **独立包与运行数据**：扩展在 `extensions/<id>/`、主题在 `themes/<id>/`；扩展私有数据在 `extensions_data/<id>/`，主题私有偏好与壁纸在 `theme_data/<id>/`。主题导入不启用扩展；卸载默认保留私有数据，选择清理才删除所属目录，扩展停用钩子之后再次校验删除路径。已知旧路径作为受验来源保留、回退并纳入完整工作区备份；公开主题 ZIP 排除私有偏好和上传壁纸。回归见 `test_extension_data.py`、`test_private_data_lifecycle.py`、`test_theme_packages.py`、`test_backup_ui_data.py` 和 `ExtensionsSection.test.tsx`。
- **扩展路由**：同一扩展可提供有类型的本机与 v2 接口，明确声明 read / write / render / admin；启用绑定所审阅摘要，停用或重新加载后旧路由失效。
- **可选面板**：清单声明允许请求的路由和权限，沙箱面板通过有来源及会话校验的 JSON 桥调用原 API；主界面不出现默认专业工具。桥不向面板交出令牌或任意联网能力。
- **具体处理阶段**：工作流绑定规则、云端适配器、提示词与节点图钩子、导出器、排版、主题、阅读模板、拟声字与切片预设都有实际调用点。其余注册表名称在 SDK 中明确标为能力目录，不声称登记即可改变执行。

实例包括 [`page-notes`](../examples/extensions/page-notes/README.md) 的操作包装与 JPEG 导出、[`qa-review`](../examples/extensions/qa-review/README.md) 的可选评审面板、[`text-metrics`](../examples/extensions/text-metrics/README.md) 的本地自定义任务。详见[扩展 SDK](../server/mio_server/extensions/README.md)。第三方 Python 扩展与核心同进程运行，信任审核不是代码沙箱。

扩展契约的回归包括 `test_operation_extensions.py`、`test_extension_publication.py`、`test_panel_bridge.py` 与 `test_job_executors.py`；覆盖鉴权、参数校验、禁用与失败回退、摘要变化、结果补写及并发恢复锁序。启用或卸载尚未完成时，新 HTTP 请求立即返回 409；完成发布或回滚后才选择包装链，避免执行尚未启用成功的实现。已经开始的请求使用原包装链完成。

## API 与边界

OpenAPI、前端类型、Python 客户端与 Bridge 运行常量随接口及协议声明生成并校验，具体流程见[平台 CTK](EXTENSION_PLATFORM_CTK.md)。核心操作目录以运行时 `GET /api/v2/operations` 和 OpenAPI 为准；`test_open_management.py` 和 `test_operation_extensions.py` 核对所有有文档的核心本机 HTTP 操作都存在同业务 ID、受令牌保护的 v2 对应操作。管理操作仍要求 admin，消耗模型或恢复任务结果的操作要求 render，read / write 不自动包含其他作用域。

静态网页、扩展文件和 WebSocket 不属于 HTTP 操作包装器；任务内部回调也不绕行 HTTP。它们使用各自的文件、事件或执行器契约。UI 的临时选择和一次拖拽过程仍是界面暂态；扩展浮窗的位置、尺寸等持久偏好通过 `GET/PUT/PATCH /api/v2/ext/{id}/preferences` 管理，主题偏好使用 `/api/v2/themes/{id}/preferences`，均与作品数据分开并随完整工作区备份恢复。浮窗只更新 `floating_surfaces.<surface_id>` 子树，不能覆盖扩展其他字段或兄弟 surface。扩展新增的业务能力应提供自己的有类型路由，原核心请求类型不会被无限扩展为无校验 JSON。

工作区备份的体积、版本、凭据和断电边界见[备份与恢复](WORKSPACE_BACKUPS.md)。作品存档不代替图片字节备份。生图服务已执行但结果尚未到达本机的窗口仍需要核对上游，不能保证任意服务请求恰好执行一次。
