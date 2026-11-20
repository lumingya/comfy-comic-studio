# 工作流默认 LoRA 控件补齐

负责人：`workshop_lora_ui`。该补丁仅补齐工作流编辑器默认值入口，不调用 ComfyUI 或云端生图，不写运行数据或生成文件。

## 行为与审查入口

- `WorkflowEditor.tsx` 接入 `WorkflowDefaultLoras.tsx`，复用通用 `LoraToggleList`。控件按稳定组键与 LoRA 键编辑 `config.slot_overrides.groups`，不改节点图。
- 表单保留其他配置、模型覆盖、全局额外 LoRA、其他组、未修改条目及组元数据。关闭时保留模型强度与 CLIP 强度。
- 「恢复已保存的默认值」仅恢复已保存的分组 LoRA 覆盖，保留名称和其他配置草稿。取消仍使用编辑器原有取消逻辑；成功保存后以服务端新文档作为下次编辑与取消的基线。
- 编辑器不额外发起检查请求。节点图草稿与已保存图不同或配置 JSON 无效时，默认 LoRA 控件禁用，避免把旧识别结果写到新节点图。
- `LoraToggleList` 只增加可选 `resetLabel`，其他场景的按钮文案与行为不变。新增中英文文案位于 `i18n/configuration.ts`。

## 验证

新增 `WorkflowDefaultLoras.test.tsx` 覆盖直接编辑器操作与 PATCH 请求、强度/CLIP 保值、原始节点图及来源控制数据不变、模型和额外 LoRA 保留、保存后取消使用新基线、恢复默认不回退名称草稿、开关返回原值时恢复干净表单。

验证结果：

- 6 个文件共 57 项 Vitest 测试通过，含新增 3 项默认值编辑器用例，以及工作流导入/试生成、装配、逐幕编辑和中英文词条回归。
- 全仓 `npm --prefix web run typecheck` 通过。
- 5 份改动的前端文件通过 Prettier 检查；全部负责文件通过 UTF-8 与差异空白检查。

未执行真实 ComfyUI / 云端出图；浏览器视觉验收由主 agent 接续。
