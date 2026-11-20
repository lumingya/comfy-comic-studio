# 第一轮审查：OpenAPI、SDK、文档与规格覆盖

审查范围：`git diff 0c948c5...HEAD`，重点检查 OpenAPI/生成客户端、路由测试与用户任务书。没有修改生产代码，也未触碰 `data/`。

## 发现

### [P1] 任务编排与成品直取闭环仍缺接口

- 证据：任务书 `ai_studio_code.txt:89-94` 要求可一次提交装配、启动、自动采用，并提供成品状态 / 直取接口；当前 `server/mio_server/api/workshop.py:186-201` 的 `/workshop/assemble` 只创建并排队作品，`clients/openapi-v2.json` 与 `server/mio_server/api` 中没有 `POST /workshop/tasks` 或 episode deliverables 路由。
- 触发条件：外部消费者要按任务书完成“创建并启动 → 查询完成 → 下载作品成品”。
- 影响：调用方必须自行串联多个请求；没有一个稳定的成品就绪状态/成品下载领域接口，主任务书的开放 API 闭环未完成。
- 最小修复：添加有幂等语义、`write`/`render` scope 分开的任务编排操作，以及 `read` 查询与导出任务直取操作；为匿名、scope 越权、幂等重放和冲突补 v2 集成测试并重新生成客户端。

### [P1] 通用 ComfyUI LoRA/槽位扩展契约仍未接入注册表

- 证据：任务书 `ai_studio_code.txt:24-27` 要求陌生 LoRA 节点可通过注册适配器扩展；`server/mio_server/registry.py:20-24` 仍只有输出和状态两个 ComfyUI 适配点，没有通用槽位/LoRA 适配点；`server/mio_server/extensions/sdk.py:90-97` 只校验输出、状态适配器方法，槽位识别与写入仍由 `workflow_slots.py` 内部形态分支完成。
- 触发条件：扩展要支持内置五种 LoRA 形态之外的第三方节点，而无需改核心源码。
- 影响：当前独立开关能力只适用于核心识别到的槽位；任务书声明的可插拔 LoRA 适配扩展示范与启停后回退行为未实现。
- 最小修复：增加版本化、可校验的 `workflow_slot_adapter` 契约，挂入识别、控制描述和编译写入路径，并加入自定义扩展注册/停用回归测试。

### [P2] LoRA 列表摘要未出现在 `/workflows`

- 证据：任务书 `ai_studio_code.txt:87` 要求增强 `GET /workflows`；`server/mio_server/api/library.py:87-104` 返回摘要仍只有节点、变体、图片输入、checkpoint 等字段，调用方需要逐个请求新建的 `/workflows/{id}/loras`。
- 触发条件：客户端首先列出多个工作流并决定可用服务 / 可控 LoRA。
- 影响：违反所述发现清单契约，并增加每工作流一次的往返；列表不能直接筛选独立开关能力。
- 最小修复：在工作流摘要加入轻量 LoRA 能力摘要，并测试列表响应及零工作流 / 未识别 LoRA 的行为。

### [P2] 公开适配器 schema 仍可携带 secret-like 常量

- 证据：`server/mio_server/pipeline/providers.py:111-121` 的 `_public_schema` 仅删除 `default`、`example`、`examples`；JSON Schema 的 `const`、`enum` 及含敏感内容的 description 会原样公开。复现时将 `schema.properties.api_key.const` 设为哨兵字符串，`public_cloud_adapter()` 会在返回 schema 中保留该字符串。
- 触发条件：扩展误把令牌写入 schema 的枚举/常量/说明字段，任何拥有 v2 `read` 权限的消费者请求 `/image-adapters`。
- 影响：发现接口可泄漏适配器凭据，与任务书“绝不泄露密钥”约束冲突；当前文档只告诫开发者勿将凭据放进默认值，覆盖不足。
- 最小修复：拒绝敏感属性名及 `const`/`enum` 下的敏感属性，或对公开 schema 做严格 allow-list；补 `const`、`enum` 和嵌套凭据测试。

### [P2] 新分镜列表返回完整话体且无分页

- 证据：`server/mio_server/api/workshop.py:89-92` 用 `list_episodes()` 一次返回所有完整 `Episode`，包括每幕、台词与 take 元数据；同一仓库已有分页摘要查询 `SQLiteStore.episode_summaries()`。
- 触发条件：外部应用读取大量分镜，或逐步把长篇分镜接入该新端点。
- 影响：响应随全部画面内容增长；任务书还要求 120 幕及更大工作流，列表端点可能产生明显内存与网络负担。
- 最小修复：列表改为带 `offset/limit` 的轻量摘要，详情端点继续返回完整 Episode；测试分页边界与 scope。

## 复审建议

先解决公开 schema secret 检查和列表分页，再由全新审查 Agent 复核对应修复。任务编排闭环及 LoRA 注册表扩展属于尚未实现的主规格，应在最终交付中保持为未完成项，除非继续实施并测试。
