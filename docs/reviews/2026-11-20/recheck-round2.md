# 第二轮复审：后端与前端修复确认

范围：复核 `agent-backend.md`、`agent-frontend.md` 和 `recheck-security-cache.md` 所列可修复项，检查当前工作树对应实现及针对测试。未修改生产代码，未触碰 `data/`。

## 已修复并验证

### 凭据冻结 / 恢复

- `server/mio_server/pipeline/cloud_request.py:16-20,68-80` 与 `providers.py:39-45` 使用一致的敏感键语义；`auth` 被识别，嵌套对象和列表均会在冻结时排除秘密，并在 bind 时从当前配置恢复。
- 验证：`test_extension_options_freeze_and_rebind_without_secrets_in_snapshot`、`test_extension_secret_redaction_covers_bare_auth_and_nested_lists` 通过。

### 适配器 schema 发现脱敏

- `server/mio_server/pipeline/providers.py:115-130` 对公开 schema 丢弃 `default`、`example(s)`、`const`、`enum` 及敏感字段名；敏感字段说明中的凭据文本也会隐藏。普通无敏感标记的 schema 元数据仍可发现。
- 验证：`test_adapter_metadata_validation_and_public_schema_redaction` 增补普通字段 opaque enum、const、敏感 property 与说明文本检查并通过。安全选项是移除所有 enum 值，可能令扩展渠道 UI 从下拉降级为普通文本输入；这属于兼容性取舍，不再泄露枚举常量。

### schema 外扩展选项的 UI 类型保持

- `web/src/pages/settings/ChannelsSection.tsx:296-315` 在已有设置包含 schema 外字段时改用 JSON 对象编辑器，保留数字 / 对象 / 列表等类型，并继续遵循设置 API 的凭据掩码恢复路径。
- 验证：配置页 31 项测试及扩展渠道元数据保存测试通过；typecheck 与 Prettier 通过。

### 缓存失效

- `web/src/api/system.ts:45-51` 的适配器发现采用可重新校验的 stale time；`web/src/api/open.ts:281-290` 的扩展启停 / 移除使 image adapter query 失效。
- `web/src/api/keys.ts:16` 集中定义 workflow LoRA key；`WorkflowTrial.tsx` 使用该 key，`useSaveWorkflow` 在保存后使对应槽位查询失效。
- 验证：工作流试生成 7 项、配置页 31 项通过。安装扩展后是否触发全部市场 / enabled 路径的刷新按 `useMarketAction` 既有逻辑另行管理；当前报告覆盖已审的启停 / 移除接口。

### 列表响应大小

- `server/mio_server/api/workshop.py:77-115` 将分镜列表改为 `{items,total,offset,limit}` 分页轻量摘要，详情仍通过单独路由返回完整 Episode；`api/library.py:87-115` 在 workflow list 增加轻量 LoRA 能力摘要。
- 验证：分镜查询 / 创建 / 编辑测试检查分页、摘要不含 `panels`；工作流列表测试检查 `loras` 字段。

## 剩余未实现规格（不作为本次修复缺陷）

- 任务书要求的一站式任务编排及成品 deliverables / 直取闭环仍未实现。
- 通用可插拔 ComfyUI workflow-slot / LoRA adapter 注册契约及第三方扩展示例仍未实现。
- 新 Reader 的滑动翻页、目录抽屉、进度条、全屏、无字模式、palette 环境光和完整 reduced-motion 交互仍未实现；当前交付为灯箱增强。
- 分镜拖拽排序、长篇筛选矩阵、完整 SDK 高阶闭环及完整跨功能压力矩阵未实现。

## 复审结论

上述前两轮可修复的凭据处理、前端参数类型保持、查询缓存、workflow list LoRA 摘要和 storyboard 分页项均通过对应定向回归。当前定向范围未发现新的 P0/P1/P2 缺陷。P1 规格缺口继续登记在第一轮报告，不宣称已完成。
