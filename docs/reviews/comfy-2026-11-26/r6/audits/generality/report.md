# R6 通用性独立首版

首版状态：**INITIAL_REVIEW_COMPLETE_NO_CONFIRMED_FINDINGS**。本职责完成下列完整任务范围的独立静态审阅，未确认需要登记的新增 Blocker / High / Medium / Low。此状态不是 `VERIFIED PASS`、整轮通过或全任务完工签字；必须等待同轮首版全部封存并获准逐事实交叉互核。

- 固定基点：`38838ab43cf3d056951f2fc6c52afb737d34e3c6`。
- 冻结及实际 HEAD：`fe914065c7aafb0672bfe10274361f83179ce7f1`。
- 身份：独立 fresh generality 审查者 `/root/r6_generality_fresh`；未参与实现或此前轮次。
- 首个身份记录／封存 UTC 及产物 SHA：见 `initial-seal.json`；源码快照核对 UTC 见 `static-inventory.json`。
- 分级发现：Blocker 0 / High 0 / Medium 0 / Low 0；运行时尚未独立验证的事项单列，未当成通过。

## 范围、独立性及执行边界

已先读原任务、AGENTS、README、ROADMAP 的产品与架构约定，并核对三份正式合同 SHA。完整任务差异共 224 个路径，审阅覆盖全部 20 个后端运行模块改动，以及直接相关的前端导入／候选／映射／LoRA 界面、API 与生成客户端接缝；也检查了同范围传输超时改动、CI artifact 变更及历史公开证据的归属。没有只审最新候选 helper 或只查 M1/M2。图与绑定、阶段与尺寸、slots 形状／读取／写入、注册适配器、保存顺序、目录缓存均按当前源代码逐段核对；新增测试仅作为静态合同线索与 AST 计数，不将存在测试称作实际执行通过。

本轮未启动任何产品，没有 Mio import、HTTP 请求、模型／GPU、测试套件、build、E2E、浏览器或服务重启；无需且未取得产品租约。运行的两个外部 Python 脚本只用标准库做文件 SHA、Git 路径和 AST 解析。没有读取私有原图、用户数据库、补抓 frontend state 或复制用户工作区；没有改源码、仓库文件、Git 状态或用户数据，没有提交或推送。只写本人职责目录。

首版前未读取任何其他 R6 角色的产物、发现或结论，未与其交换发现。已读的旧 R4/R5 公开文档仅用于核对历史合同及失败／边界的实际归属；没有把旧 verdict 或 oracle 作为本轮正确性证明。外部白名单中的 current75 report 与 provenance 也仅按其实际分母和身份使用。

独立重算的运行源码为 218 个 Python 模块，原始字节聚合 SHA256 `a00155daa5515501eb3ee117f284c2ae1f8152ac038d7efa7f6208c46b8ad487`；全部 server 为 407 个 Python 文件，聚合 SHA256 `018c572cec3c9a629b13e4ea3bf6f6b5fd1323b0581c5f696c294007c61f7b32`。两者均与正式授权吻合，核对时工作树干净。聚合定义和每个后端变更文件的行数／SHA 已保存。AST 的模块顶层 import 图未发现多模块强连通分量；此静态检查不覆盖函数内、动态 import 或运行时代码执行。

## 独立源码判断

### 通用图、端口与绑定闭包

`workflow_graph.py:23-259` 将语义路由显式限制为 native identity、可静态确定的 selector payload 和可信调用方 route contract。对象定义提供类型，不直接提供恒等语义；无声明的辅助输出、无效端口、环、不明旁路和动态 selector 不获得可写字面源。`workflow_slot_graph.py:21-125` 保留进入端口并按实际消费者证明未选分支；未知消费者输出不作为全局屏蔽另一输入的证据。

`binding_scope.py:68-142` 分开计算输出范围、画布血缘和首阶段；`binding_dimensions.py:53-193` 保护参考／控制分支、模式控制、共享尺寸和多画布歧义。`binding_stage_scope.py:18-81` 进一步检查条件血缘中不能解释的生成阶段，`binding_inference.py:393-411` 撤回有歧义的 steps / cfg / sampler / denoise / scheduler，不借此改变显式绑定或画布尺寸。只读血缘推断没有取代执行闭包：`bindings.py:328-359` 的输出祖先裁剪保留所有真实连线，包括 selector 未选输入。

`compile.py:218-271` 先合并显式值及 Pointer，再迭代稳定自动绑定；每次从同一基图重新写，防止旧分支残留。重复状态或不收敛时明确拒绝。`compile.py:274-290` 对最终有效图复核已请求 LoRA 的活动路径。此机制支持静态冻结，不证明任意插件实际运行时的输出或隐式依赖。

### 槽位、适配器与数值保真

`builtin_slot_adapters.py:17-151` 分发有限的结构 codec；`workflow_slot_shapes.py:26-241` 识别完整的模式／计数和嵌套／平铺形态；`workflow_slot_values.py:18-147` 负责有限数字、禁用条目和稳定出现次序键；`workflow_slot_writers.py:67-353` 按实际变化字段编辑、先匹配旧位置再放新增项，并限制对象文本镜像拥有的同名出现次数。未见新增成百插件名称白名单。单独 native identity 集合、公开语义角色词和结构模板不构成按采集文件硬编码的分派。

数值字符串的发现与写入现在共享 `_stack_value` 和有限数字解析，未改字段仍可保留原生表示。`workflow_slot_plan.py:166-189` 在分析修订／图／object-info／adapter 变化时重算，随后刷新 pinned；已保存计划不再当然是当前权重真值。扩展仍通过 `workflow_binding` 与 `workflow_slot_adapter` 接入，贡献身份在 codec 写入时匹配；没有把对象类型声明升级为可信未知节点执行协议。

`binding_inference.py` 为 411 行、`compile.py` 为 422 行、既有 facade `bindings.py` 为 507 行；超过“尽量 400 行”的目标，但职责仍可追踪，新增 helper 已分离，未因此形成足以登记产品缺陷的不合理模块体量。没有以纯行数代替架构判断。

### 缓存代际、保存与导入

`workflow_catalog.py:24-171` 以图、配置、有效 slot 输入、修订和 object-info 建内容键，再固定绑定／槽位贡献与代际。Registry 与缓存锁顺序一致；发布前再次取得贡献快照，变更则丢弃旧分析，返回值深拷贝且容量有界。槽位库错误返回不可用中性状态而非成功零组，也不缓存该失败。缓存仅存摘要，不取代编译与可编辑 controls 的校验。`api/library.py:169-222` 在持久化之前完成 describe 和 controls 验证。

`workflow_import.py:16-292` 给 JSON／PNG／WebP 同一规范化入口，限制文件、元数据、像素、节点和非有限数值。UI-only 明确要求回 ComfyUI 导出 API，并给出结构概览、子图／隐式连线／失活节点提醒；不猜自定义 widget 顺序或浏览器生成连线。动态外部状态仍由 `compile.py:150-201` 的 state adapter 边界管理，手工 mapping 不替代缺失的执行协议。

### 人工接管、标签与候选角色

`inspection_candidates.py:105-203` 将空白／空文本、配对正负文本和可追溯上游字符串列入候选。`inspection_candidates.py:205-335` 按图片／蒙版 payload 血缘传播可能用途，保留独立来源，排除 scalar/control 依赖，并区别静态 selector、辅助输出和动态分支。此模块只返回 `source=candidate`；它不参与 `infer_bindings` 的自动写入。

`inspection.py:190-244` 按缺失核心角色和图片用途组合候选；前端 `WorkflowInspection.tsx:122-145,224-235` 展示 candidate 的实际 kind。`WorkflowMappings.tsx:134-151,204-230` 的采纳识别结果仅取 `source=heuristic`，不会一键采纳不确定候选；通用字段列表与自定义 key 支持人工选择，`config.mapping` 被传回保存。这里确认源码接缝，不冒称已操作 Chrome 或已验证四格视觉与焦点。

显式标签／mapping、qualifier、fan-out、草稿／成品输出和 inspect 选择的解析仍在 `bindings.py:136-277,312-359`。自动推断仅补缺 kind，且不占用不同语义的显式目标。标签与 mapping 都保留为明确用户选择；候选提示本身没有被隐式当成选定 mapping。所有未知插件都 90% 自动识别、任意 image 输出协议可直接取图、任意复杂动态节点能自动编译，均不是本次静态判断的结论。

## 历史 138 图和独立标签合同

历史 `docs/COMFY_WORKFLOW_138_RETEST_2026-11-25.json` 实际属于 `6f9bdf2...`：唯一 138 节点记录、1 组／43 LoRA、零显式标签、完整 compile=false，失败位于 `_frontend_plan` 且缺 frontend state。它的早期自动 width / height / batch 各 1 是那个版本的事实。后续公开 R5 generality 记录报告了自动宽、高、batch 撤回到零、仅 output 1／seed 2，配置 mapping 0，历史宽高字面目标只有绑定阶段显式写入精确证明；其完整编译仍缺状态而失败。

上述两个历史阶段不能互相替换，更不能重标为本 fe 候选的新私有图运行。当前源码仍支持显式宽高／batch 等字面 mapping，但本职责没有新的私有 138 图完整编译、typed delta 或私有 batch 映射执行证据；没有补造 state、删掉原要求或宣称它已能直接运行。43 LoRA 槽位、源不变、绑定阶段写入与完整 compile 分属不同合同。零标签也不能给出任何真实标签保留分母。

早期单独 29 方法标签／mapping 回归是独立的合成／随包合同证据，覆盖标签、输出变体、覆盖与 guard；不是私有 138 图的 29 次操作，也不是本角色在 fe 新跑的 29 项。current75 的另 29 manual-required 又是第三个分母：该 core replay 的显式手选操作仍是 0。

## 已有结果、未测与待交叉

授权外部 current75 report/provenance 的执行身份为 fe、218／407 文件，230 请求为 46 API × 5；分类仍为 160 automatic + 29 manual-required + 41 absent，Python 整图值相等 226／230，有 4 个原严格不符。29 canvas 只测 decode／检查／导出指导。它不是 230 次完整 strict typed delta，不是 29 次显式手选，也不是 75 份全部五阶段成功。当前首版不重判这 4 项；由 compile 角色的独立原结构／实际逐请求证据与本职责交叉闭合。

`bounded-questions.json` 固定了本职责独立关注的七个问题、事前不变量及源码落点。静态阅读已能解释这些机制，本职责没有增加产品运行；因此没有伪造运行前 oracle、租约或进程 CPU guard 记录，也没有把未运行标作运行通过。

待交叉事项：独立 compile 的完整 typed 图／闭包／全部 delta 与真实手选、blind 新鲜真实图、web 四格实际 role 提示／手选／保存／导出，以及 privacy 对全量归档和真实 CI 的检查。产品机制的静态可解释性不能消除这些角色可能发现的具体 Medium 以上问题。未知动态插件计算、GPU、付费服务、真实画质、完整私有 138 状态协议均未测。

本次数次文档／源码工具输出受长度截断；没有请求输出未知工作流对象，未用任何截断结果证明隐私全清白。原图、提示词和资产名没有被序列化到本职责产物。报告只含计数、布尔、类型／长度、源码指针、哈希与中性说明。

最终清理、中文定稿出版、具体文件提交推送和最终 CI 关系尚须由 root 实际完成；本角色没有这些写权限，也未代为宣布完成。首版报告和 seal 不可回写，开放交叉后另建 cross/final。
