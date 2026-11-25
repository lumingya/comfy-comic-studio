# Wave 4 R3 — CrossAudit-1-Generality

**最终签发：REQUEST CHANGES。**

审查基点为 `38838ab43cf3d056951f2fc6c52afb737d34e3c6`，冻结产品为 `50bb3fad2189b54f45f4cc0e0c6d2071d2e73090`，均经 Git 实际解析。审查者未参与产品实现；先完成独立判断，再接收并交叉验证同轮 Compile 审查者的新发现。未读取前两轮审查结论作为初判依据。

## Standards

### Blocker / High / Medium

无已证实的此类代码组织约定违规。新增核心模块形成单向依赖，未发现循环导入：绑定推断依赖尺寸域和语义图，语义图依赖既有槽位公共基础。原生 Reroute / PrimitiveNode 的受限 identity 契约不等于插件白名单；其余识别主要基于输入端口与结构。未知插件可通过人工映射及既有绑定适配器接管。没有把仅供可信调用方使用、当前未接入生产入口的 `route_contracts` 当成已交付公共配置能力。

### Low — 重复的严格图基础操作（判断性维护建议）

`binding_inference.py:44–65` 与 `binding_dimensions.py:19–40` 重复 `_link` 和 `_ancestors`。这不是当前行为缺陷，但以后修改合法端口或节点存在性规则时有漏改风险。建议在中立图基础层共用严格定义，不要把两套略有差异的链接定义继续扩散。

## Spec

### Blocker

无。

### Medium G1 — 辅助输出端口被上层范围推断错误套用主输出分支（独立发现）

位置：`server/mio_server/comfy/binding_inference.py:106–111`、`:325–330`。相关活动分支逻辑也见 `workflow_slot_graph.py:20–38`。

最小反例：两条独立静态采样分支分别接到结构为 `input1 / input2 / select=1` 的双输出选择器，保存节点消费其 **输出 1**。底层 `SemanticGraph.route([choice, 1])` 明确返回 `undeclared-output-port`，因此不能证明这个辅助输出服从输出 0 的 payload 选择。生产范围推断却只保留第一输入分支作为语义范围。

实际结果：传入 prompt、seed、width 后，编译自动改写第一分支的文本、种子与画布宽度，第二分支保留；预检 `missing=[]`，把不确定输出错误呈现为已完整识别。原图不被原地修改，但提交副本中的参数目标错误。

最小根因：范围与因果遍历把工作项降为节点 ID，再按 `selection(nid)` 裁剪，丢掉了消费的输出索引。底层逐端口拒绝不能约束绕过它的上层节点级遍历。同型槽位探针中，第二 LoRA 被放入全局 dead 集；两组当前均保持只读，因此该槽位观察不另算一个独立产品缺陷。

修复应让语义遍历保留 `(node, output-slot)`；仅在该消费端口已证明是 payload 路由时排除另一分支。未知辅助输出应保留不确定性并引导映射，不能继承 output 0 的选择。保持完整执行依赖闭包。

证据：`probes.py` 中 auxiliary selector 两个用例，`probe-results.json` 中 `auxiliary_selector` / `auxiliary_lora_selector`。对照例消费输出 0 时自动识别正常且两条执行依赖均保留。

### High X1 — 参考图因果依赖被等同于画布接力，静默覆写辅助生成器（同轮交叉确认）

位置：`binding_inference.py` 的 `primary_sites()` 及其 `dependencies()`。初始发现来自同轮 Compile 审查者；本审查重新自造图验证，而非复述其结果。

两个独立反例：辅助采样器经解码器生成控制图，再进入主采样器正向 conditioning 的图像依赖；或相同辅助图经模型适配器进入主采样器 model 依赖。主采样器有独立文本与画布，未从辅助采样器接收 latent / samples。

实际结果：请求 prompt、width、steps 后，两种图均只改辅助文本、辅助画布、辅助 steps，主画面对应值全部保留。`warnings=[]`，预检 `compilable=true`，只有未提供实例定义的一般信息提示。

根因是“依赖其他采样器”直接排除主阶段，而未区分参考／控制资料依赖和真正生成画布接力。当前新增的因果阶段测试也断言了类似上游优先行为，不能当作这一区分已正确的证据。修复不能简单改为最终采样器优先；若结构不足以唯一确定主生成域，应明确要求人工绑定。

对照：自造 `later.latent_image = [first, 0]` 的真实 latent 精修链仍正确只覆写首阶段 prompt、size、steps，后续精修原值保留。这一行为必须保留。

证据：`probe-results.json` 中 `cross_generated_control_reference`、`cross_generated_style_reference` 与 `real_latent_refinement`。

### Medium X2 — 单项 LoRA 调整会扩展其他局部文本镜像（同轮交叉确认）

位置：`workflow_slot_writers.py` 的 `_mirror_object_tags()`，尤其 additions 构造中对 `assigned` 未镜像条目的无条件补写。

独立反例：同一对象槽位含 A、B 两项；`text_a` 只镜像 A，`text_b` 只镜像 B。仅按稳定键调整 A 的权重。

实际结果：A 的原有对象权重正确改变，但 `text_a` 新增了 B 标签，`text_b` 新增了 A 标签，扩大了未请求的文本语义变更。根因是把每个字符串局部拥有的镜像集合当成整个对象列表的镜像集合；所有未在该字符串出现的 assigned 项均被追加。

应只维护每个字段已经证实拥有的出现位置，并分别定义显式新增条目的安全写入契约；既有未改变条目不能因另一个条目被调整而补入其他字符串。

证据：`probe-results.json` 中 `cross_partial_lora_mirror`。此例完全由中性合成数据构造。

### Low / 非缺陷观察

数字型对象 on 开关没有既定插件契约，探针观察到 0 被视为 enabled，但没有把此观察升级为已证实的支持缺陷；布尔对象开关与既定平铺数字开关需按已声明契约判断。

## 138 节点与标签兼容的实际证据边界

在冻结提交上复核既有 138 节点文档，数据库连接采用只读模式与 query-only；只读取 workflow 文档，不序列化私有图、文本、模型名、文档标识或槽位键。结果见 `138_retest.json`：

- 匹配 1 个文档、138 节点、1 组 LoRA、43 项；重复槽位键稳定，旧计划按 analysisRevision=2 刷新后稳定。
- 绑定写入与预期目标精确一致；源对象、文档对象和数据库 payload 均未改变。
- **实际文档没有 mio 标签**，因此标签计数为零时的 preserved=true 不能证明它的标签回归。
- **完整编译未通过**，在 `_frontend_plan` 抛出 BindingError；源文档没有必要的前端状态。预检可导入但不可编译。未伪造状态，未调用真实执行，不能宣称这份图已端到端兼容。
- 显式 mio 标签、人工映射及草稿／成品输出选择另用既有测试与自造中性对照验证。

## 覆盖与执行记录

逐项检查了完整产品差异涉及的图路由、尺寸域、绑定与冻结编译、LoRA 形态／读写／计划更新、JSON 与 PNG/WebP 导入、预检契约、导入前映射与界面调用、生成类型及客户端契约。只对静态代码作前端审查，未把该审查冒充 Chrome 真实视觉验收。

既有相关测试实际执行：`tests.test_bindings`、既有 Alice 槽位验收、图路由、语义绑定、有效绑定及合成野生契约，共 **98 项通过**。没有重复宣称执行主控已完成的全套仓库门禁。

本审查自造探针共 **11 项**，6 通过、5 个断言失败；按根因归并为 G1、X1、X2 三项，不能把两个参考图变体或同型槽位观察重复计数。测试仅为纯内存静态解析／编译，未使用 GPU、模型下载、在线推理或外部工作流；未改产品、未提交。

可提交脱敏材料为本报告、`probe-results.json` 和 `138_retest.json`；读取私有源的本地复核脚本仅留临时审计区，不应提交。创建的临时目录仅为本审计所在的 `audits/r3/generality/`。

Standards：0 个阻断发现、1 个 Low 判断性建议。Spec：独立发现 1 Medium，同轮交叉确认 1 High 与 1 Medium。存在实证的泛化与冻结覆写缺陷，故最终为 **REQUEST CHANGES**。
