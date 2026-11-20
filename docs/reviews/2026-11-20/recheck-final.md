# 最终定向复审：安全、CSP 与缓存修复

审查范围：复核第二轮已报告的 scalar-list 凭据合并问题，以及前序报告中的裸 `auth` 脱敏、schema 枚举过滤、缺 head/body 的模板 CSP 路径、分镜分页摘要、workflow LoRA 摘要与前端缓存修复。只读审查；未修改生产代码或 `data/`。

## 复审结论

本报告覆盖的修复中 **未发现仍可复现的 P0–P2 缺陷**。

## 逐项结果

| 项目 | 结论 | 证据与验证 |
|---|---|---|
| 标量列表与对象列表中的云端凭据 | PASS | `cloud_request._merge_secrets` 在递归后保留非容器 scalar；`test_extension_secret_merge_preserves_scalar_list_options` 同时验证字符串列表原样保留及对象列表 token 从当前配置恢复。 |
| 裸 `auth` 的快照脱敏 | PASS | provider 与 cloud-request 规则均把边界完整的 `auth` 当作敏感字段；`test_extension_secret_redaction_covers_bare_auth_and_nested_lists` 验证快照无明文、重绑定读取当前凭据。 |
| 公开 schema 中的常量 / 枚举 / 秘密 | PASS | `_public_schema` 去除 `enum`、`const`、默认值、示例与敏感属性名，并掩码敏感字段或凭据形式的描述；测试覆盖普通字段 opaque enum / const、敏感 property 及描述。 |
| 自定义模板 CSP 插入 | PASS | `AlbumTemplate.check_html` 要求完整 html/head/body；`render._finish` 再次拒绝缺少可注入 head/body 的文档。模板验证测试拒绝两种缺失结构，13 个内置模板离线安全渲染测试通过。 |
| 分镜分页摘要 | PASS | `/workshop/storyboards` 使用有界 offset/limit 和 `episode_summaries`，响应不带 `panels`；测试覆盖分页元数据及详情端点分离。 |
| 工作流 LoRA 摘要 | PASS | `/workflows` 返回轻量 `loras` 摘要；HTTP 测试断言字段存在。 |
| LoRA / 适配器查询缓存 | PASS | 工作流保存会失效其 `workflowLoras` query；扩展 action 会失效 image-adapters；adapter query 使用 `staleTime: 0`。 |
| schema 外 extra_options UI 保存 | PASS | 已有 schema 未声明的选项触发 JSON 对象编辑器；配置 UI 测试覆盖扩展字段编辑保存及 WorkflowTrial；typecheck 通过。 |

定向验证通过：cloud credential/schema 3 项、album CSP/模板 2 项、分镜分页与工作流摘要 6 项、前端配置与试生成 38 项、Ruff 检查与格式检查。未改生产文件或随包数据。

## 已登记的未完成范围

这些是任务书中仍未实现的功能，不属于本轮定向修复的回归：一站式任务编排与成品直取闭环、可插拔 ComfyUI workflow-slot/LoRA adapter 契约、阅读器完整滑动/目录/进度/全屏/环境光交互、分镜拖拽排序及完整长篇/跨模块压力矩阵。它们继续登记于 `agent-contracts.md` 与 `agent-frontend.md`，不应在终局报告中宣称完成。
