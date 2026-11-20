# 120 幕分镜与扩展渠道参数复审

负责人：`frontend_stress_acceptance`。测试基于共享主工作区整合中的代码；只新增本文件和两份测试，生产修复由主 agent 完成。未读取或修改本机个人数据，未运行浏览器或外部出图服务。

## 验收范围与证据

`web/src/pages/workshop/StoryboardStress.test.tsx`：5 项通过，使用真实 React 编辑器、TanStack Query、自动保存控制器与 dnd-kit 键盘传感器，隔离 HTTP 路由为内存数据。

- 120 幕完整列表按空白、变量与大小写混合关键词过滤；当前未保存草稿不丢失，不向服务器写入过滤后的局部顺序。
- 第一份保存请求悬而未决时继续编辑，再切往第 120 幕；第二份保存等待第一份完成，发送最新草稿，完整保留 LoRA 覆写，并在排队保存全部完成后才切幕。
- 有待保存输入时键盘拖放排序；先保存再发送全部 120 个唯一 ID，活动幕不变，每幕不同的 LoRA 开关保持原值。
- 批量删除连续 40 幕并撤销；恢复最新保存输入、原有位置，以及全部 120 幕的独立 LoRA 覆写。
- 修改第一幕的 LoRA 开关时，其余 119 幕逐对象保持不变。

`web/src/pages/settings/ChannelsExtension.test.tsx`：4 项通过。

- 从适配器发现接口获得扩展参数元数据；未知嵌套对象使用 JSON 编辑，修改普通渠道名称时完整保留数组、数字、布尔、null、嵌套凭据占位符和其他渠道配置。
- 修改一个普通扩展选项仍保存原始 JSON 类型，不把对象降为字符串。
- 取消 JSON 编辑后重新显示服务器值。
- JSON 无效时显示错误并阻止保存其他修改，修复 JSON 后恢复可保存状态。

执行命令：

```text
npm --prefix web test -- --run src/pages/workshop/StoryboardStress.test.tsx
# 5 passed，测试执行 4.65 秒；包含 120 行实际组件渲染，不作为跨设备性能承诺。
npm --prefix web test -- --run src/pages/settings/ChannelsExtension.test.tsx
# 4 passed，测试执行 1.32 秒。
```

## 找到并复验的生产问题

1. JSON 编辑器只用初始 props 设置本地文本；取消父级草稿后仍显示旧 JSON。主 agent 在取消或成功保存时更新编辑器修订标识，使本地草稿重置。恢复服务器值的测试现已通过。
2. 无效 JSON 只显示本地提示，没有传递到父表单；先改名称再输入残缺 JSON 时保存按钮仍可用。主 agent 将无效状态传给表单，保存按钮和提交函数共同阻断。错误阻断及修复恢复测试现已通过。

首跑同时发现了测试环境事项：需从 `web` 的 npm test 入口载入 jsdom；表单控件的可访问名称包含帮助文本，查询改为匹配标签前缀；拖拽测试清理 mock 后须重新设置确认函数的允许结果。这些调整没有放宽生产行为断言。

## 验证边界与交接

该批只证明 jsdom 中的数据一致性和交互行为，不证明真实鼠标拖动、移动设备帧率或视觉效果。主 agent 另行负责完整 CI 门禁与浏览器验收。

本批最后一次 TypeScript strict 检查发生在主 agent 更新 `cloud_recipe` 类型与拆分渠道组件期间，观察到新组件 `Select` 缺失导入以及三处 RenderProfile 夹具缺少 `cloud_recipe`。已把确切位置交给主 agent；全仓 typecheck 的最终结果以主 agent 整合后门禁为准。

## 全套门禁后的测试开销修正

主 agent 的全套前端门禁运行 834 项时，833 项通过；本文件的键盘拖拽用例在并行负载下执行 5.19 秒，触发默认 5 秒限制。该用例原本已使用单次 `fireEvent.change`，没有逐字输入产生的重复渲染。

检查定位到两处测试桩开销：每次读取行的矩形都重新查找并扫描 120 行；寻找第一个拖动按钮时，则对整页 240 多个按钮计算可访问名称。现在预先建立每行矩形的 `WeakMap`，几何查询直接取值，并把可访问性按钮查询限制在第一行内。真实 dnd-kit 键盘传感器、拖放操作、保存前置顺序、完整 120 个 ID 和 LoRA 保值断言全部保留；未修改生产代码、全局超时或单用例超时。

```text
# 修改前的单项基线：1381 ms，通过。
npm --prefix web test -- --run src/pages/workshop/StoryboardStress.test.tsx -t 'flushes a pending edit'
# 修改后：5 passed；拖拽项 1113 ms，全文件测试执行 4.61 秒。
npm --prefix web test -- --run src/pages/workshop/StoryboardStress.test.tsx
```

以上耗时只用于观察测试额外开销；全套并行门禁是否通过仍由主 agent 重新运行的结果证明。
