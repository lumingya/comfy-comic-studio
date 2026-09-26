# 工作流语义槽位 v3 — 实施与验收说明

## 版本依据

- 基础仓库：`https://github.com/lumingya/comfy-comic-studio`
- 基础提交：`722e1d288fa045849c99dee5d5d9cce269490229`
- 实施依据：用户提供的 `workflow-slots-v3.md`，原文存于 `docs/design/workflow-slots-v3.md`。
- v2 仅作背景参考；没有引入 v2 的四策略、双端分析引擎或提示词回退。

## 已完成

### 后端

- `workflow_slots.analyze()` 生成版本 3 的模型目标、LoRA 组、来源、钉住条目、串联关系和 issues。
- `apply()` 深拷贝工作流后执行计划，返回 `workflow / notices / writes / plan / overrides`。保留项目现有字典返回形式，便于接入生产队列。
- 同文件模型按统一大小写和路径分隔符随动；其他模型默认不写。成对模型使用按目标 key 的覆盖值。
- 连线模型字段有界回溯；可写的单一权重字面量来源成为目标，否则明确报告。
- LoRA 中继优先写对象或文本来源；不可写中继的 syntax 站点断链写字面量。元数据消费者不冒充应用点。
- 蓝图 LoRA 保持钉住，用户 LoRA 追加；`unpin` 显式移除。同名用户条目覆盖强度，文件扩展名规范化后去重，不把不同子目录的同名文件混为一谈。
- chain / stack / object / syntax / embedded 写入；固定堆栈和 embedded 容量超出时失败。
- 字面量布尔选择、整数选择分支过滤；未消费输出提示；自有对象/内嵌站点单入口；不可写堆栈来源只读。
- MODEL 串联只在末尾追加，并行通路各自追加；串联前段已有同名条目在原位置更新，不在末尾重复加载。
- 无活跃站点时，仅在核心语义及声明类型满足条件时合成核心 LoRA 节点；否则禁用并解释。不会往普通正向提示词塞标签。
- 模型枚举、连线字段和强度范围检查，在装配 dry-run 时执行。强度优先使用 `object_info`，否则为 `[-5, 5]`。
- 旧槽位首次使用迁移；重新分析时保留可匹配目标的勾选状态，失效目标进入 issues。

### 前端与持久化

- 删除 JS 的 `detect / normalize` 图检测；浏览器只请求 Python 计划并运行纯 `applyPlan` 预览。
- 工坊：成对模型两个选择器、锁定蓝图芯片、用户强度输入、解锁移除、计划摘要和禁用原因。不再使用上次 LoRA 覆盖替换蓝图条目。
- 工作台：目标/组/来源/钉住/串联/活跃状态/issues 视图；勾选、手动指定节点和字段、重新分析三个动作。
- 任务分幕记录可展开查看本次写入和跳过原因；支持成对模型及 unpin 摘要。
- 计划以 `slots.plan` 保存到工作流包，并冻结进生产任务；分析缓存会丢弃过期响应。
- 修复文件库凭据保护对计划 `key` 的误判：仅放行结构及位置均符合 v3 计划的标识，真实 API Key 仍按原规则保护。堆栈编号字段改用 `slotToken`，避免与凭据 token 混淆。
- 新资源哈希已更新至 `index.html`，避免浏览器继续使用旧 JS。

## API

### 分析

`POST /api/production/analyze-slots`

```json
{
  "workflow": {"...": "ComfyUI API graph"},
  "objectInfo": {},
  "slots": {},
  "manual": [{"nodeId": "123", "path": "lora_1"}]
}
```

响应沿用项目封装：`{"data":{"plan":{...}}}`。`slots` 用于保留旧配置或已有计划中的选择状态。`manual` 可省略。

### dry-run / 调试

`POST /api/production/apply-slots`

```json
{
  "workflow": {"...": "ComfyUI API graph"},
  "objectInfo": {},
  "slots": {"plan": {}},
  "overrides": {
    "model": "new.safetensors",
    "loras": [{"name": "style.safetensors", "strength": -0.5}],
    "unpin": [],
    "disabled": []
  }
}
```

响应包含新图、逐项通知和实际写入列表。此接口不会向 ComfyUI 提交任务。

## 验收结果

以下均在本次修改后的源码上执行：

| 检查 | 结果 |
|---|---|
| Python 全量单元测试 | 545 项完成，OK；其中 4 项按原测试条件跳过 |
| 槽位共享契约 | 63 组 plan + apply 夹具通过；含迁移的原 27 例与新增 v3 样例 |
| v3 独立验收断言 | 覆盖文档 §8 的 21 类场景，并增加扩展名去重、凭据保护、环路与迁移检查 |
| v3 Playwright 浏览器验收 | 成对选择器、钉住芯片、unpin、负强度、后端 dry-run、组勾选、手动指定、移动端布局、保存/重载均通过；无未捕获页面异常 |
| 普通映射共享契约 | 48 组通过 |
| 项目核心 JS 契约 | 86/86 通过 |
| ESLint / HTML 校验 | 通过 |
| 构建 | JS 模块与合并脚本语法检查通过；离线文档构建通过 |
| `git diff --check` | 通过 |

仓库内 `docs/workflows/alice_copy_workflow.json` 的 138 节点图也纳入验收：两个同文件底模均写入；LoRA 来源形成一个对象中继组，包含三个应用点、保留两个钉住条目；元数据节点和用户原始图不被覆盖。

### 既有浏览器测试的限制

没有宣称整个 `npm test` 浏览器集合全部通过。另行运行的两份旧大范围 UI 脚本在修改前的原始提交副本上也失败，已作对照：

- `tests/architecture.mjs`：在视觉预设 checkbox 操作处失败，报 “Clicking the checkbox did not change its state”。
- `tests/workflow_workbench.mjs`：旧断言要求 `.wm-row` 总数为 8，但此选择器也包含语义槽位行，失败于 “all eight mappings visible in compact list”。该脚本后部已更新为 v3 控件断言，但仍被前面的既有断言阻断。

本次专用的 `tests/workflow_slots_v3_ui.mjs` 独立验证了实际 v3 UI 和后端持久化，不依赖上述旧断言。

## 复验

```bash
npm ci
npx playwright install --with-deps chromium
npm run test:slots-v3
python -m unittest discover -s tests -q
npm run test:contracts
npm run lint
npm run build
```

`tools/update_slots_contract.py` 是显式更新快照工具，须传 `--approve`；常规测试不会动态重写期望结果。独立的 v3 验收断言与快照测试同时保留。

## 使用与边界

1. 解压完整源码，按项目原有启动方式运行，或在项目目录执行 `python server.py`。
2. 打开工作流与 API 配置，旧槽位会请求后端迁移。建议先同步 ComfyUI 节点定义，再点“重新分析”。
3. 核对工作台计划；无法自动证明的字段可手动指定，仍受活跃过滤与写入校验约束。
4. 工坊里选择底模、追加 LoRA；入队前进行 dry-run。执行载荷在内存中生成，用户蓝图文件不变。
5. **未连接真实 ComfyUI/GPU，也未实际加载第三方插件权重生图。** 当前验证范围是分析、写入载荷、后端集成和浏览器交互；真实插件版本、模型文件是否安装、以及出图效果需在用户环境复核。
6. UI 编辑器格式导入仍是独立功能，本次未加入；请使用 ComfyUI API 格式。
7. 没有远程推送或修改 GitHub 仓库；交付为本地修改后的源码与可应用补丁。
