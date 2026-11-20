# 第二轮复审：凭据处理与 UI 缓存

复审 `agent-backend.md` 与 `agent-frontend.md` 中相关发现，并只读检查当前工作树修复；未修改生产代码或 `data/`。

## 已验证修复

- **裸 `auth` 与列表嵌套密钥**：`cloud_request.SECRET_OPTION_NAME` 已覆盖裸 `auth`；`_merge_secrets` 会递归对象和列表。`test_extension_secret_redaction_covers_bare_auth_and_nested_lists` 与既有冻结 / 重绑定测试均通过（2 项）。快照不含测试凭据，绑定后的适配器能取得当前配置凭据。
- **schema 外 extra_options 类型保持**：未知字段会使云端选项使用 JSON 对象编辑器，保留数字、对象和数组类型。`Configuration.test.tsx` 31 项通过，包括扩展 schema 参数保存。
- **工作流槽位缓存**：试生成使用共享 `workflowLoras` query key，保存工作流后使该 key 失效。
- **适配器发现缓存**：扩展操作完成会使 image adapter query 失效。该查询仍设置 `staleTime: Infinity`，但对应启停写操作显式失效，审查的 UI 启停路径可刷新。

## 仍需修复

### [P2] 非敏感 schema 字段的 `enum` 仍可能公开凭据字面值

- 位置：`server/mio_server/pipeline/providers.py` 的 `_public_schema`。
- 触发：扩展将一个 opaque credential 放在普通字段（如 `quality`）的 `enum` 中，而不是敏感属性名或 `token=value` 描述中。
- 证据：公开 schema 过滤了 `const`、默认值、示例和敏感属性名，并识别带凭据字段名的描述；普通字段的 `enum: ["opaque-secret"]` 仍保留，字符串形态无法通过现有正则可靠地区分枚举值与密钥。
- 最小修复：对发现 API 的 schema 移除 `enum`（或只允许可信的安全枚举格式），并补普通字段枚举中 opaque secret 不会返回的测试。若 UI 仍需枚举体验，可由受审查的 schema 子集提供安全选项。

## 验证

- 后端定向凭据回归：2 项通过。
- 前端渠道设置：31 项通过。
- 复核了工作流保存和扩展启停的 query invalidation 路径。
- 无代码或随包数据修改。
