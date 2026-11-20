# 最后增量：工作流默认 LoRA 与预览组件复审

审查者：`frontend_stress_acceptance`，未参与 `WorkflowDefaultLoras` 或本次预览拆分实现。生产文件只读，本次只提交审查记录。

## 固定范围

- `e48a51b` 新增的 `WorkflowDefaultLoras.tsx`、`WorkflowEditor.tsx` 接线、`LoraToggleList.tsx` 的 `onEdit` 与 `resetLabel`。
- 工作区内 `lora-toggle-list.css` 对移动端范围输入的换行和布局修复。
- `29c4caa` 的导出、模板编辑和预览拆分；核对 `AlbumTemplatePicker`、`ExportOptions`、`ExportPreviewDialog`、`TemplateEditorFields`、`TemplateStudioPreview` 与原调用方的状态和回调衔接。
- 只跟踪保存后默认值缓存、预览打开/关闭与选择所涉及的相邻调用，不重新审查无关全仓代码。

需求依据：任务书的工作流编辑/试生成全链路 LoRA 独立开关、关态保值、默认值恢复、导出前试读，以及既有 iframe 沙箱不降低。规范依据：仓库 `AGENTS.md` 的日常界面原则、文件职责与只修改明确目标的约定。

## 规范轴

未发现需要修复的 P0–P2 问题。默认值编辑逻辑与通用控件分离，工作流表单、导出状态机与预览请求分别由对应模块负责。此次拆分后的生产模块均在 400 行以内；没有新接口、平台耦合命名或宽松沙箱权限。

## 需求轴

未发现已证实的 P0–P2 缺陷。核对和测试覆盖的具体行为：

- 默认值修改只写 `config.slot_overrides.groups` 中选中的稳定键；保留其他分组、组元数据、全局附加 LoRA、模型选择、移除列表及其他配置，原始节点图保持不变。
- 关闭后模型与 CLIP 权重保持原值；再编辑或取消使用当前保存响应的有效默认值，不回到首次载入的旧值。
- 「恢复已保存的默认值」只撤销该控制面内未保存的组修改，同时保留未保存的工作流名称等无关编辑；试生成仍使用原来的「恢复默认」文案和逻辑。
- `useSaveWorkflow` 保存后更新详情缓存并失效同 ID 的 LoRA 查询及工作流列表；切换工作流使用 ID 键隔离表单，默认值控制面复用当前详情数据。
- 导出试读保留 `staleTime: 0`。关闭后，在参数和作品 ID 不变而采用图已变化的情况下重新打开，重新请求当前画作。草稿变更仍进入完整请求体的查询键。
- 模板卡片使用当前 `look` 与主题色；拆分后的设置组件持续挂载，预览设备选择及全屏状态仍由持续挂载的预览组件保有。所有预览 iframe 保持 `sandbox="allow-scripts allow-popups"`，没有加入 `allow-same-origin`。

## 当前实跑证据

```text
npm --prefix web test -- --run src/pages/settings/WorkflowDefaultLoras.test.tsx src/pages/settings/WorkflowTrial.test.tsx src/pages/works/ExportPreviewFreshness.test.tsx src/pages/works/ExportDrawer.test.tsx
# 4 files passed；31 tests passed。
# 默认值 3、试生成 7、预览刷新 1、导出抽屉 20。
```

这里只记录本次实际执行的定向验证，不用先前全套通过数代替此次增量证据。未运行浏览器、服务或网络请求，未接触个人数据。

## 尚待实际布局核实的边界

移动端模型强度标签已增加 `overflow-wrap: anywhere`，范围输入采用单列布局。静态检查注意到同一行的 `.lora-toggle-clip span` 尚无相同的换行或最小宽度规则；合法但很长的无空格文件名可能增大 CLIP 标签的最小内容宽度。已把 100 字符文件名加 `.safetensors` 的重现条件交给主 agent，在已有隔离浏览器中核实。该点在本审查范围内没有真实布局证据，未列为已确认的 P2；jsdom 通过不能证明此边界的视觉结果。

## 精确小数权重的独立复核

主 agent 随后确认并修复了一项 P2：工作流原有模型权重 `0.333333`、CLIP 权重 `0.271828` 不满足前端固定 `step="0.05"`；即使用户仅关闭 LoRA、权重没有变化，HTML 原生表单也会因 `stepMismatch` 阻止提交。本审查者没有修改生产代码，独立核对了最终差异并执行新测试。

最终差异仅将模型强度范围输入、模型数字输入和 CLIP 数字输入的 `step` 改为 `any`。`type`、适配器给定的 `min`/`max`、禁用能力判定均保留；两类数字输入的 `Number.isFinite` 保护也未改变。

```text
npm --prefix web test -- --run src/pages/settings/LoraPrecision.test.tsx
# 1 passed；测试执行 197 ms。
```

该测试挂载实际 `LoraToggleList` 和原生 `<form>`，先断言表单有效，再通过真实用户点击关闭开关和提交按钮，确认提交发生一次，关闭状态及两项完整精度权重原样保留。独立 jsdom 原生约束探针也得到：固定步进时两项 `stepMismatch=true`、表单无效；改为 `any` 后两项均无步进错误且表单有效。保留 `min=-5`、`max=5` 后，模型权重 `6` 仍触发 `rangeOverflow`，CLIP 权重 `-6` 仍触发 `rangeUnderflow`，两者均不能通过原生校验。

复核结论：该精度缺陷已修复，未因取消固定步进而取消范围或有限数值保护。本次没有重复全套测试，也没有以主 agent 已跑的 11 项结果冒充本审查者的独立执行记录。
