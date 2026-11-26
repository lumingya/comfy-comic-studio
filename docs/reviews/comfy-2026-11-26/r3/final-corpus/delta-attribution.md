# 最终源码差异：仅按既有输出归因

未追加任何Mio调用，未改源码或真值。八项missing不能由现有探针自动升级为安全边界；本报告明确区分已有证据与未捕获内容。

## 八项原真值missing

| 公开样本 | kind | 原真值指针 | frozen实际目标 | 请求级delta/warning |
|---|---|---|---|---|
|2df6c0ad8d1a|prompt|/6/inputs/text|[]|未捕获；不能判安全忽略|
|2df6c0ad8d1a|negative|/33/inputs/text|[]|未捕获；不能判安全忽略|
|2df6c0ad8d1a|width|/27/inputs/width|[]|未捕获；不能判安全忽略|
|2df6c0ad8d1a|height|/27/inputs/height|[]|未捕获；不能判安全忽略|
|helper/hf-lora-stack.json|width|/134/inputs/width|[]|未捕获；不能判安全忽略|
|helper/hf-lora-stack.json|height|/134/inputs/height|[]|未捕获；不能判安全忽略|
|helper/cog-consistent-character.json|width|/29/inputs/width|[]|未捕获；不能判安全忽略|
|helper/cog-consistent-character.json|height|/29/inputs/height|[]|未捕获；不能判安全忽略|

这八项的源文件字节、源图、完整WorkflowDoc快照相等检查均通过；无编辑编译的保留节点与连线也通过。完整文档检查使用Python equality，未捕获逐请求类型敏感文档hash。这些记录不能替代逐请求实际写图/结构差分。聚合inspect issue codes来自请求前，不能证明每一kind均已给出明确忽略提示。对应kind的额外显式mapping没有记录时一律为未测。

## R2原138请求中的16项不符

| 样本 | kind | 原固定目标 | 实际目标 | 已保存的实际差分 | kind警告已观察 |
|---|---|---|---|---|---|
|1|steps|/3/inputs/steps|/33/inputs/steps|/33/inputs/steps|False|
|1|cfg|/3/inputs/cfg|/33/inputs/cfg|/33/inputs/cfg|False|
|1|sampler|/3/inputs/sampler_name|/33/inputs/sampler_name|/33/inputs/sampler_name|False|
|2|width|/34/inputs/width|[]|[]|True|
|2|height|/34/inputs/height|[]|[]|True|
|2|steps|/3/inputs/steps|[]|[]|True|
|2|cfg|/3/inputs/cfg|[]|[]|True|
|2|sampler|/3/inputs/sampler_name|[]|[]|True|
|14|width|/4/inputs/empty_latent_width|[]|[]|True|
|14|height|/4/inputs/empty_latent_height|[]|[]|True|
|14|steps|/8/inputs/steps|[]|[]|True|
|14|cfg|/8/inputs/cfg|[]|[]|True|
|14|sampler|/8/inputs/sampler_name|[]|[]|True|
|15|steps|/10/inputs/steps|[]|[]|True|
|15|cfg|/10/inputs/cfg|[]|[]|True|
|15|sampler|/10/inputs/sampler_name|[]|[]|True|

三项sample1 steps/cfg/sampler实际写向不同采样阶段，与原固定oracle不符；不能直接归类安全。其余13项的类型敏感实际差分为空，其中13项保存了提到请求kind的警告；这只证明本次操作未写入并有提示，不能消除原本应写目标丢失的契约差异。16/16连线保持。JSON列出主probe另做的显式mapping操作结果，不能将另一个请求的成功挪作本次自动成功。

R2严格真值相对50bb的逐项变化也在JSON保留：不能仅用净分101/130掩盖新增missing与其他manual一致项。

完整机器证据见delta-attribution.json；主publish.json同样嵌入这份归因。原eb失败档、本次原始结果、所有原truth均保持原样。

## R2 sample1：真实跨阶段自动重定向

只读原图、既存 actual diffs 与源码所得；未补测。公开样本为 stable_cascade__image_remixing_multiple.png。保存端实际消费链是 `/9.images ← /8:0`、`/8.samples ← /33:0`。两个采样器的 latent 初值分别来自 `/34:0 → /3.latent_image` 和 `/34:1 → /33.latent_image`；前级输出经 `/3:0 → /36.stage_c`，再由 `/36:0 → /33.positive` 影响后级。因此 `/3` 与 `/33` 是两个有执行关联的独立采样阶段。

50bb 的 primary 规则在排除标量控制端口后继续沿其余执行依赖追溯，所以从 `/33.positive` 经 `/36.stage_c` 可见 `/3`，前级 `/3` 被选中。当前规则仅沿 canvas 角色追溯，将 `positive` 明确排除为非画布角色；保存端画布集合静态推导为 `{9,8,33,34}`，只剩 `/33` 一个采样站点。`binding_inference.py:378` 随后只向该 primary 提供 steps/cfg/sampler 自动目标。这里的 primary 集合是按源码静态推导；写入指针和差分则是已保存的真实运行证据。

原 pre-engine 人工真值在原产品调用前已经固定，对这三项都要求 manual，候选同时包含 `/3` 和 `/33`；该文件本轮也包含在 721 份原证据的前后 hash 不变集合中。原始及 50bb 的自动 handler 曾实写 `/3`；固定 replay 的 `/3` 预期来自该历史自动观察，而不是用户批准的永久自动目标。当前 source 为 `3e994bb80794dea7be9773f5cb9c47119bf34c27`，三项均实际只改 `/33` 对应字段，warnings 均为空、连线均保持，因此是实际自动阶段迁移的实质阻断证据，不能称仅 oracle 策略文案差异或安全边界；但历史自动 `/3` 同样未满足原 manual 真值。前后都保留严格失败，当前另保留固定请求迁移失败，不通过改真值消除。

本样本无编辑编译保留全部 16 节点，未裁剪节点，原节点值保持。当前主 probe 的源图、完整文档 deep snapshot、源文件字节检查通过；三项固定请求的 type-sensitive delta 各仅为 `/33` 对应字段，连接不变。两阶段显式 mapping 的六次独立操作均整图精确。上述保持证据不能批准当前自动阶段选择。详见 sample1-stage-attribution.json，公开 JSON 仅包含中性角色、端口、指针与哈希。

## 另13项空差分的逐项已观察警告

这些请求的 type-sensitive delta 均为 `[]`，连线均保持，但原固定请求的预期写入未发生，继续保留失败。以下是已保存的产品通用提示原文，不含用户文本。

|样本|kind|已观察警告|
|---|---|---|
|2|width|工作流没有 width 的绑定，值被忽略；请配置显式标签、手动 mapping 或可信适配器。|
|2|height|工作流没有 height 的绑定，值被忽略；请配置显式标签、手动 mapping 或可信适配器。|
|2|steps|工作流没有 steps 的绑定，值被忽略；请配置显式标签、手动 mapping 或可信适配器。|
|2|cfg|工作流没有 cfg 的绑定，值被忽略；请配置显式标签、手动 mapping 或可信适配器。|
|2|sampler|工作流没有 sampler 的绑定，值被忽略；请配置显式标签、手动 mapping 或可信适配器。|
|14|width|工作流没有 width 的绑定，值被忽略；请配置显式标签、手动 mapping 或可信适配器。|
|14|height|工作流没有 height 的绑定，值被忽略；请配置显式标签、手动 mapping 或可信适配器。|
|14|steps|工作流没有 steps 的绑定，值被忽略；请配置显式标签、手动 mapping 或可信适配器。|
|14|cfg|工作流没有 cfg 的绑定，值被忽略；请配置显式标签、手动 mapping 或可信适配器。|
|14|sampler|工作流没有 sampler 的绑定，值被忽略；请配置显式标签、手动 mapping 或可信适配器。|
|15|steps|工作流没有 steps 的绑定，值被忽略；请配置显式标签、手动 mapping 或可信适配器。|
|15|cfg|工作流没有 cfg 的绑定，值被忽略；请配置显式标签、手动 mapping 或可信适配器。|
|15|sampler|工作流没有 sampler 的绑定，值被忽略；请配置显式标签、手动 mapping 或可信适配器。|

八项 current75/R1 missing 的逐请求 actual delta、warning 和写值后的 resolved target 均未被原探针捕获，不能从这13项的提示推及另8项，也不能归类为安全撤回；仍按 delta-attribution.json 保留未证边界。
