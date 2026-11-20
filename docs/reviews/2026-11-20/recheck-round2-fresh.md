# 第二轮独立复审结果

审查范围：共享上下文与前两轮报告所列修复，检查当前工作树对应实现、独立回归和数据保护边界。只读审查，未改生产代码、未触碰 `data/`。

| 项目 | 结论 | 证据 / 验证 |
|---|---|---|
| 云端裸 `auth` 与嵌套对象数组凭据 | PASS | `cloud_request.py:16-20` 与 `providers.py:39-44` 的敏感名规则一致；`_without_secrets` / `_redact_request` 递归 list+dict，`_merge_secrets` 对非敏感列表分支递归恢复当前凭据。freeze/bind 回归覆盖裸 auth 和 object→list→token 场景。相关 3 项 provider 测试通过。 |
| 公开适配器 schema 常量过滤 | PASS（有意降级） | `providers.py:115-130` 移除 `enum`、`const`、默认值、示例和敏感字段名，并遮蔽敏感字段值及凭据式说明。测试覆盖普通字段 opaque enum/const、api_key 属性和敏感说明。移除 enum 会使扩展字段在 UI 退化为文本输入；这是减少 schema 泄漏面的可见代价，应保留记录。 |
| schema 外 `extra_options` 类型与掩码保真 | PASS | `ChannelsSection.tsx:296-315` 检测未声明键并切换到 JSON 对象编辑器；提交保持 JSON 类型，设置接口递归恢复掩码秘密。Configuration 页面 31 项通过。 |
| `workflow-loras` 缓存失效 | PASS | `keys.ts:16` 提供共享 key，WorkflowTrial 使用该 key；`system.ts:125-129` 工作流保存后失效相应 key。7 项 WorkflowTrial 测试通过。 |
| image-adapters 缓存失效 / 重验证 | PASS | `system.ts:45-51` 使用 `staleTime: 0`；`open.ts:281-290` 扩展启停 / 移除后失效该 query。 |
| workflows 列表 LoRA 摘要 | PASS | `api/library.py:87-115` 返回轻量开关能力与组数；测试确认摘要包含 `loras` 字段。 |
| storyboards 分页摘要 | PASS | `api/workshop.py:77-115` 返回 offset / limit / total 和 `StoryboardSummary`，由存储分页摘要支撑，列表不含 panels；详情仍返回完整 Episode。资源测试覆盖分页、摘要和 CRUD。 |

## 复核验证

- Provider 凭据与 schema 目标测试：3 项通过。
- Workshop 资源分页 / CRUD 测试：5 项通过。
- Workflow summary 与 LoRA API 测试：2 项通过。
- 前端渠道设置和试生成：38 项通过。
- 相关 Python Ruff 检查通过。
- 未发现本轮所列 P0-P2 修复项仍可复现。

### 新发现 [P2] 嵌套的原始值数组在绑定时会被替换成空对象

- 位置：`server/mio_server/pipeline/cloud_request.py:68-80`。
- 复现：`extra_options={"modes": ["fast", "quality"]}`；freeze 后 snapshot 保留原列表，但 bind 调用 `_merge_secrets` 时对 list 的每个 scalar 调 `_merge_secrets({}, scalar)`，该函数对非 dict/list 返回 `{}`，最终适配器得到 `{"modes": [{}, {}]}`。只读本地探针已复现。
- 影响：允许的 JSON 扩展参数列表若保存字符串、数字或布尔值，会在重试 / 执行绑定时损坏。对象列表（如 `[{"token": ...}]`）当前能正确恢复，但不能据此视为所有嵌套数组安全。
- 最小修复：当 `current` 是 scalar 时返回 `copy.deepcopy(current)`；并加 freeze→bind 的 scalar list、object-list 凭据测试。

## 剩余范围

此复审仅核查第一轮问题的修复。任务编排与成品直取、通用可插拔 LoRA 槽位契约、完整离线阅读器交互以及大规模跨模块验收仍按 `agent-contracts.md` / `agent-frontend.md` 记录为未完成规格，不因这些修复而改变状态。
