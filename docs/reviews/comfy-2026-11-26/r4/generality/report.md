# R4 通用性与架构独立终审（首版）

- 审查日期：2026-11-26。
- 审查 HEAD：`3e994bb80794dea7be9773f5cb9c47119bf34c27`。
- 审查范围：`git diff 38838ab43cf3d056951f2fc6c52afb737d34e3c6..HEAD` 中图遍历、绑定、槽位、导入与有关手工接管调用链。
- 结论：**VERIFIED PASS（本职能的静态源码审计范围）**。
- 分级发现：Blocker 0 / High 0 / Medium 0 / Low 0。未发现有源码或实际证据支撑、需要本轮打回的通用性或架构缺陷。

## 独立性与方法

先读 `AGENTS.md`、`README.md`、`docs/ROADMAP.md` 和原始完整任务；随后逐项审查后端全部有关产品改动、新增中性回归契约及前端映射接管链。形成首版前未读历史 `docs/reviews/comfy-*`、`COMFY_WORKFLOW_*` 修复／验收文档或其他审查者结论。仅在总控授权后，读取终态机器证据的 `private138` 数据节，未读取其余结论。

未修改产品、Git、用户原工作区；未运行本机测试、构建、服务、Mio 函数或工作流 probe，未访问本机 ComfyUI、浏览器或模型。唯一执行的数据脚本仅使用 Python 标准库读取原数据库的结构计数，并写入本审计领地的安全汇总。审查前后工作树均无改动。本报告不是全量 CI、盲测、真实出图或 UI 实操的替代。

## 源码证据与判断

### 通用抽象与依赖

`bindings.py` 的原采样器、Latent、输出类名集合被移除，入口转向 `binding_inference.py`，没有新增成百上千插件类型枚举。新推断主要使用输入角色、字面值、受控结构模式和真实依赖。有限的 native identity 集合与语义类名提示只服务明确的内建转发及候选意图，不形成插件白名单分发器。证据：`bindings.py:217-223,259-277`；`binding_inference.py:15-43,68-93,250-279`；`workflow_graph.py:12-16,78-97`。

职责划分可追踪：`workflow_graph` 负责只读语义路由；`binding_scope` 区分输出画布归属；`binding_dimensions` 保护尺寸域；`binding_inference` 组装建议；`workflow_slot_shapes/values/writers` 分别识形、读取与写入；`workflow_import` 处理格式。新模块多数小于 400 行，推断模块为 405 行，未形成跨域巨型模块。导入链由共享纯工具向上，`bindings` 使用局部导入接入推断，槽位 codec 的 legacy facade 也使用局部导入；本轮未发现新增的急切循环依赖。第三方仍可经既有 `workflow_binding` 和槽位适配器契约接入，而不是继续堆主引擎分支。证据：各模块 import 与 `context.py:189`、`api/library.py:102`、`builtin_slot_adapters.py:1-18`。

### 执行因果、路由端口与画布

语义选择不替代执行依赖闭包：`all_reachable` 以及输出裁剪保留所有真实连线依赖，包括静态未选中的 switch 输入。真正的绑定定位另走输出槽号敏感的路由，未知单输入变换不会仅凭同型同名被宣布为 identity。选择器的辅助输出不会继承输出 0 的 payload 路由；遇到动态选择、未知输出、环或不明旁路时停止自动源证明。证据：`workflow_graph.py:178-236,238-251`；`bindings.py:328-359`。中性契约明确覆盖多输出、共享分支、失活下游、深层转发、环以及同型 metadata 不等于 identity；本审计只读其断言，未执行：`test_workflow_graph_routes.py:70-107,150-240`；`test_workflow_scope_ports.py:40-198`。

主生成阶段从最终输出的画布角色向上定位，模型、条件、参考图、蒙版和控制支路不自行建立“前一生成阶段”。未知画布角色使自动主阶段归属撤回，尺寸源又额外保护参考／控制共享数值与模式控制；后阶段精修参数不会因为纯执行因果就自动成为首阶段目标。证据：`binding_scope.py:9-61,83-141`；`binding_dimensions.py:53-146,149-193`；中性契约 `test_workflow_canvas_scope.py:56-157,198-272` 与 `test_workflow_dimension_controls.py:40-96`。

编译在已合并值和 Pointer 覆盖的有效状态上迭代绑定，每轮从同一基图开始，避免旧分支残留写入；不稳定时明确拒绝。LoRA 请求随后对最终图重新核对活动路径。证据：`compile.py:218-290,307-324`；`test_workflow_effective_bindings.py:60-209,248-339`。这支持“冻结所选分支的静态控制”，不证明未知插件运行时代码的行为。

### LoRA 结构与无损控制

新增的 simple/advanced 模式栈按完整字段形态、有效计数和字面模式识别；未知、连线或不完整模式保持只读。匹配既有条目先于使用空位，局部权重修改按实际变化字段写入，原位置、空位、额外字段和未改数值表达可保留；简单模式的共享权重拒绝矛盾的 model/CLIP 请求。对象文本镜像仅拥有有证据的同名出现项，不重建无关正文。证据：`workflow_slot_shapes.py:26-128`；`workflow_slot_writers.py:67-145,186-281,284-382`；`workflow_slot_values.py:18-40`。对应中性契约包含稀疏位置、35 项重复 LoRA、单项稳定键、数值字符串与部分文本镜像：`test_workflow_lora_structures.py`、`test_workflow_lora_lossless.py`、`test_workflow_lora_r3_lossless.py`、`test_workflow_stack_modes.py`。这里审查了实现与断言，不把测试存在写成测试通过。

缓存计划增加分析修订号，版本或结构变化会重算，同时延续既有显式偏好；没有把旧分析结果当成新算法的真值。证据：`workflow_slot_plan.py:14,166-185` 和中性 stale-plan 契约。

### 导入、静态边界和人工接管

JSON、PNG、WebP 都进入共同规范化链；媒体内优先采用 API prompt。UI-only 图不会猜测自定义控件或脚本连线，而是给出结构概览、子图／隐式连线提醒，以及打开 ComfyUI 后导出 API 的具体路径。大小／元数据／节点计数、压缩与有限数值均有边界；没有新运行依赖。证据：`workflow_import.py:14-24,35-101,104-170,178-292`；`api/library.py:141-165`。

这符合原任务“能静态确定则处理，否则明确人工接管”的选择：UI-only、依赖浏览器状态的子图／无线协议、未知 scalar 变换、异义多文本及复杂几何模式，不应被计为自动识别成功。对 API 图，缺失核心绑定会显示具体中文参数名；编译时只要实际请求了未绑定参数，也会给出被忽略与标签／mapping／适配器的处理方向，图片请求保持显式失败。映射 UI 可搜索任意字面字段和自定义参数，一键采纳仅用已推断建议，不直接采纳全部不确定候选。证据：`inspection.py:180-204,229-281`；`compile.py:325-345`；`web/src/pages/settings/WorkflowMappings.tsx:90-174,193-229`；`WorkflowInspection.tsx:180-233`。

## 原 138 图与显式标签：证据分开记录

本审计直接以 SQLite URI `mode=ro` 开原库，设置并读取确认 `PRAGMA query_only=ON`，按保管者提供的 schema 查询全部 workflow 记录，再筛选图节点数恰为 138 的记录。没有改用或替换为随包／合成图。得到唯一匹配，138 节点、249 个顶层连线、`[mio:*]` 标签 0；同一记录再次查询的原 payload 文本严格相等。只保存摘要 `private_structure.json`，未导出图、作者文本、模型名或私有位置。

因此，**该原图不能提供任何真实显式标签保留证明，也不能被表述为完整编译成功**。经授权读取的终态机器数据节记录：自动绑定为 output 1、seed 2；LoRA 1 组／43 项稳定；自动 width／height／batch 撤回；width／height 的显式 mapping 只有绑定阶段精确写入证明；完整编译因缺必要 frontend state 失败，inspection 也如实给出不可编译。以上机器结果是分层证据，不是本审计重新运行得出的性能或兼容性结论。

源码保留了可实际使用的两类接管：任意字面字段的标签／Pointer 绑定（`bindings.py:136-214`），以及已有真实前端状态捕获接口与显式保存 `config.state` 的流程（`api/library.py:301-338`；`compile.py:150-201`）。手工映射可接管参数归属；它不能替代浏览器插件的执行协议或缺失的状态快照。就当前源码与原始证据，没有发现原图被改写、被删除参数或被冒充全自动成功的产品机制；不能据此宣称该原图现在无需接管即可运行。

显式 `[mio:*]` 兼容性单独由当前源码和中性契约支持：标签解析、qualifier、fan-out、草稿／成品输出选择仍在；启发式只补缺失类型，并避免抢占显式目标。证据：`bindings.py:116-170,259-277,312-359`；`compile.py:228-249`；`test_bindings.py:167-263,402-440`；`test_workflow_wild_contracts.py:80-101`；`test_workflow_semantic_bindings.py:509-523`。未将原图的零标签等同于“真实标签测试通过”。

## 结论边界

本轮可签发源码层面的 **VERIFIED PASS**：实现遵循通用图／结构契约方向，职责边界和接管路径可追踪；在已审查范围内没有可确认的新增分级缺陷。该结论不承诺任意未知插件 90% 自动识别、不承诺原 138 图完整编译或出图，也不从 CI 绿灯推导执行语义正确。最终全任务验收仍须由总控分别整合本轮五个独立角色、真实队列及远程门禁证据。

此首版已封存独立结论；等待总控授权后才进行跨角色互核。
