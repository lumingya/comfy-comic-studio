# Wave 4 · 第二轮 CrossAudit-1-Generality

- 冻结范围：`38838ab..6f9bdf2c56994397754f4ec2c782f1ab63bc75a0`。
- 交叉互核后的本轮结论：**REQUEST CHANGES**。
- 分级：Blocker 0 / High 0 / Medium 3（缺陷族）/ Low 1（可维护性建议）。
- 初始独立探针与窄分工审查曾得到限定 VERIFIED PASS；随后收到本轮 Compile 审查发现后，使用新编写的中性探针独立复现了以下三类缺陷。它们同样属于通用性契约问题，因此原限定结论不能作为本轮最终通过结论。
- 本轮从任务原文和源码独立得出结论，未把旧审查报告或既有通过结论当作证据。未修改产品源码、生成接口、数据库或用户配置。

## Standards

逐行核查新增图内核、绑定推断与显式绑定变更；另以独立窄分工审查 API 导入、检查、编译、媒体解析、LoRA 图/形态/写入和前端产品变更。读取了 AGENTS.md、README.md、ROADMAP.md 与完整任务原文。

- 未发现新增插件类名白名单。SemanticGraph 的原生身份路由只认识原生 Reroute / PrimitiveNode；其他节点的声明类型、相同端口名、工作流元数据均不能自行声明身份路由。调用方显式传入的可信契约与这些不可信数据分离（`server/mio_server/comfy/workflow_graph.py:23,178,202`）。
- 选择器通过输入结构识别；辅助输出口不会继承 payload 路由。复杂或不可静态求值的来源停留在人工映射边界。
- 语义路由不用于删除执行依赖；输出筛选保留真实依赖闭包，包括选择器未选中的实际连线（`workflow_graph.py:238` 与 `compile.py:218`）。
- LoRA 模式匹配使用完整输入字段结构，未按生态插件名称枚举。媒体元数据解析有独立模块和大小边界。新依赖 `compile → workflow_slot_graph → workflow_graph → workflow_slot_common` 未形成新的顶层循环。

### Low · 单文件长度超过软性约定

- 证据：新增 `server/mio_server/comfy/binding_inference.py` 482 行；`server/mio_server/comfy/compile.py` 从 333 行增至 411 行。
- 对照：ROADMAP §3「单文件尽量不超过 400 行」。这是软性维护建议，不是正确性或架构阻断项；当前职责仍连贯。
- 后续建议：可抽出有效绑定分析，或将采样控制与文本来源分析整理成独立内部模块。无需为本轮通过做机械拆分。
- 复核命令：`python -c "from pathlib import Path; print([(str(p), len(p.read_text(encoding='utf-8').splitlines())) for p in (Path('server/mio_server/comfy/binding_inference.py'), Path('server/mio_server/comfy/compile.py'))])"`。

## Spec

- `[mio:*]` 标签、一对多写入、手工 JSON Pointer 映射和 variant 选择保持既有契约；显式字段不被其他语义的启发式绑定占用。
- 编译先应用明确参数及 selector 覆写，再依据有效值推断；冻结 LoRA 请求若因覆写改变活动路径会明确拒绝（`server/mio_server/comfy/compile.py:257`）。
- UI-only 工作流保留 API 导出引导，不把 UI 控件次序或浏览器隐式状态猜成可执行 API。PNG/WebP 元数据和 JSON 导入共用归一化路径。
- 多来源提示词与未知 scalar 转换保留原值／人工映射；未知配对 conditioning 输出不凭输入名称猜测正负顺序。
- 初始范围未发现 Blocker / High / Medium；下述交叉核对扩展了证据，确认三类 Medium。未使用外部服务、模型执行或浏览器状态来补充虚构证据。

## 交叉互核：三类 Medium 均独立复现

以下证据不只复述 Compile 审计结果。独立新写 `cross_probe.py`，在产品仍冻结为 `6f9bdf2`、产品目录无工作区差异时，重新构造中性图并运行公共编译入口；输出保存在本目录 `cross-results.json`。所有源码修改均为零。

### Medium 1 · 尺寸语义域越界，误写参考图画布

- 位置：`server/mio_server/comfy/binding_inference.py:375`（dimensions 从 model 与画布依赖共同扩张）和 `:456`（将该集合的根尺寸生产者绑定为 width / height / batch）。
- 最小触发：KSampler 的 latent 是 640×960；model 经 IPAdapterAdvanced，adapter 的 image 接另一个 256×256 EmptyImage。传入 width=832、height=1216。
- 独立实测：latent 正确变为 832×1216，但参考 EmptyImage 也变为 832×1216；源图未变。此输入只要求生成尺寸，参考图具有独立语义，误写会改变条件图内容／比例。
- 分类理由：是从模型依赖推导可写尺寸域的通用图算法错误，不应靠 IPAdapter 或 EmptyImage 类名黑名单修补。
- 修复要求：尺寸域应沿真实生成画布／latent 路径推断；模型上的参考、控制、辅助图尺寸不应进入自动生成尺寸绑定。无法区分时给出人工映射边界。需保留跨现代采样链的正常尺寸发现。

### Medium 2 · LoRA 对象单项编辑不是无损写入

- 位置：`server/mio_server/comfy/workflow_slot_writers.py:227` 对原 entries 的姓名归一化未处理 null；`:246` 对未编辑项重写规范化后的权重／active；`:252` 用 pins 重建列表，丢弃空占位。
- 独立复现 A：列表首项 `{name: null, strength: 1, active: false, marker: 'vacancy'}`、第二项有效 LoRA；只编辑有效项强度，抛出 `AttributeError: 'NoneType' object has no attribute 'replace'`。
- 独立复现 B：将空位 name 改为空字符串后，编辑有效项使列表从 2 项变为 1 项，空位与 marker 被删。
- 独立复现 C：列表第二个未编辑项保存 `strength: '-0.6'`、`clipStrength: '0.2'`、`on: true`；只编辑首项时，第二项两个字符串变为 float，且额外写入 active=true。外部 Compile 审计还覆盖了整数开关变为 'On' 和整数值 float 变 int，本报告不将未自行执行的分支冒充独立复现。
- 分类理由：稳定槽位与任意自定义 widget 结构的通用写入契约失效；源对象未被原地修改不等于提交图无损。
- 修复要求：按位置／稳定 occurrence 保留空占位与不透明元数据；对未编辑条目保留原字段存在性与原类型；null 应有明确无崩溃处理。对无法安全解释的开关形态只读或要求显式适配器，不静默转换。

### Medium 3 · 启发式 seed 与 selector 共享来源后，冻结路由过期

- 位置：`server/mio_server/comfy/compile.py:234` 只提前应用 explicit；`:248` 据此推断 prompt；`:307` 在启发式值写入前校验 LoRA 路由；`:330` 最后写入 seed 才改变实际 selector。
- 独立复现 A：PrimitiveNode value=1 同时供 KSampler seed 与 selector select；input1 和 input2 分别接两个文本编码器。传入 seed=2、prompt='replacement' 后，最终 selector 选择 input2，但替换文本写入 input1，input2 仍为原值。
- 独立复现 B：相同共享值选择两条 LoRA model 分支；编辑旧活动分支 a 的强度为0.4并传 seed=2。编译被接受，最终选择 b，写入的却是 a，b仍0.7。
- 分类理由：编译推断与最终提交图的路由状态不一致，既影响提示词也绕过冻结 LoRA 路由校验，是通用有效值解析／编译契约缺陷。
- 修复要求：在任何值来源可能影响 selector 时，冻结前必须确保推断与活动路由针对最终有效图一致；存在互相影响的启发式共享目标时保守拒绝或要求显式映射。不要只修显式 mapping/pointer 路径。最终 LoRA 校验必须观察实际提交值，且不能接受旧分支的请求。

复现命令（仅本目录中性脚本，无数据库、网络或模型执行）：

```powershell
python "$env:LOCALAPPDATA\Temp\mio-wf-recovery-20261125\audits\r2\generality\cross_probe.py"
```

结果包含六个 `defect_confirmed: true`（尺寸1、共享路由2、LoRA3），汇总为上述三类 Medium。已有79项回归和初始四探针通过不能抵消这些反例。

## 独立验证

在 `server` 工作目录执行两批定向回归，共 **79 项通过**：

```text
python -m unittest -q tests.test_bindings tests.test_workflow_effective_bindings tests.test_workflow_wild_contracts
Ran 44 tests in 0.183s — OK

python -m unittest -q tests.test_workflow_graph_routes tests.test_workflow_semantic_bindings
Ran 35 tests in 0.298s — OK
```

另独立编写仓库外中性探针 `probe.py`，四项全部通过，结果见相邻 `probe-results.json`：

1. 公共编译入口穿过 1,800 层 Reroute、共 1,808 节点；只修改预期的两个字面值，所有连线及源图保持不变，约 91.6 ms。
2. 1,200 层 selector 控制链静态求值正确；引入回环后返回动态未决，约 19.1 ms，未递归溢出。
3. 同名同型 object_info 端口及工作流元数据不能声明身份路由；可信构造参数可以声明，非法辅助口仍只读。
4. 公共编译及检查入口遇 seed 回环时不写入；未知 selector 的辅助输出也不会被 seed 自动绑定。

复现：

```powershell
python "$env:LOCALAPPDATA\Temp\mio-wf-recovery-20261125\audits\r2\generality\probe.py"
```

结束时核对 HEAD 仍为上述冻结提交，产品目录无未提交差异。本审计未重跑完整门禁；CI 及本机 Git 子进程环境问题由总控的独立审计／诊断负责，不借用其结果扩大此结论。

## 138 节点与真实执行边界

只读取了脱敏指标 `docs/COMFY_WORKFLOW_138_RETEST_2026-11-25.json`，未读取私人数据库或原始图。该记录标明相同冻结 revision，且后端工作区差异为空：138 节点、43 个 LoRA 项、稳定键／计划刷新／参数写入源图不变均通过。

**该实际私人图有 0 个显式 mio 标签，且完整 compile_ok=false；失败在 `_frontend_plan`，缺失前端参数面板状态。** 因此该记录仅支持所列只读分析与局部写入检查，不能证明该图完整编译、真实 ComfyUI 执行或真实图上的 mio 标签兼容。标签兼容的证据来自本轮独立执行的合成／已提交回归。也没有声称本审计完成实际 Chrome 或 GPU 出图验收。

## 临时文件与目录

本审计创建的目录仅有：

- `<task-temp>\audits\r2\generality`

目录内创建：`probe.py`、`probe-results.json`、`cross_probe.py`、`cross-results.json`、`report.md`。两个窄分工辅助审查没有创建临时目录或文件。没有下载或保存任何外部工作流、图片、账号数据或凭据。
