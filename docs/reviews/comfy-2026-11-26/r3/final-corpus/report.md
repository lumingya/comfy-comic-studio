# 最终源码固定语料只读复验

源码：`3e994bb80794dea7be9773f5cb9c47119bf34c27`。产品执行从 2026-11-26T02:25:38.899949+00:00 至 2026-11-26T02:27:37.540130+00:00；先后PID26212、46476，均在Mio加载前亲和性读回0x1，BelowNormal=16384；同一时刻仅一个Python、零子进程、顺序执行。

| 队列 | 原真值/预期 | 本轮实测 |
|---|---:|---:|
| current75定向整图 |230|226/230|
| 原R1定向整图 |70|66/70|
| R1显式mapping |20|20/20|
| 真实LoRA7项负权重/关闭 |14|14/14|
| R2严格原真值 |130（原99；50bb为102）|101/130|
| R2原请求固定重放 |138|122/138|
| R3真实LoRA操作 |26|26/26|
| R3 advanced模式派生操作 |20|20/20|
| C1–C6核心原例 |10|10/10|
| LoRA原例 |13|13/13|

原R1分母保持70，具体状态：{"correct": 46, "manual_abstained": 20, "missing": 4}。所有原truth与eb失败档保持，不以人工映射成功替代自动成功。逐样本原预期/当前指针及6f9、50bb、eb多重集合增删保存在publish.json。

## 私有138与边界

本轮自动目标计数：{"output": 1, "seed": 2}；相对历史的width、height、batch撤回按实测保留。compile=False，missing_frontend_state=True；没有补造state。原mapping和mio标签保持，两个显式尺寸mapping仅证明绑定阶段整图精确。batch不属于inspect的CORE_KINDS，因此不声称已出现专属batch提示。

## 其余固定队列与限制

R2仍有29项严格差异，JSON逐项保留原truth、初审/50bb/current实际指针；原138请求的失败数为16。R3原15的全部记录检查通过=True，原seed策略差异为2样本，完整保留；preset控制接管的有效尺寸前后值另列JSON。C4辅助口、C6安全preset与Low损坏name边界单列，不混入原23例分母。

原产物721份hash不变=True；全部源码hash不变=True；DB字节hash不变=True。模块215份SHA=1c08bb82bdfa09aac17934d44e60786a48706f0696b31d9b3c38b5df096f2a16；server内含测试的全部Python文件399份SHA=dfe376e4347481d6de1e7eeb5c4151b8778bdb9526fc060af00bcd06c42a7a1e。详细文件清单只在TEMP私有产物，公开JSON仅保留聚合hash/计数/指针。

本轮失败或保留差异标记：["original_corpus_truth_not_all_exact", "R2_original_request_differences"]。这是最终源码变更后的必要修复复验，不是新独立终审或全门禁签字。没有本机全单测、Vitest、构建、服务重启、ComfyUI/GPU/模型/付费调用、新采样或提交。

## 包装器修复与执行边界

首个进程将Popen替换为函数，破坏Windows asyncio对Popen的继承，三个入口在任何Mio调用前因标准库导入错误退出。初始日志和run-provenance.json原样保留。随后保持Popen类并拦截构造，仅顺序完成current75/R1、R2主探针、R3主探针这三个尚未启动的入口；已完成的138、R2固定请求/边界、原23例及交叉检查均未重复。effective-provenance.json保留两段guard、原始导入错误历史及实际完成入口。之后只有低优先单CPU的纯结果发布，不再调用产品。

## 八项missing与R2十六差异的证据边界

详见delta-attribution.md/json。八项missing未保存逐请求实际图delta、编译warning或应用值后的resolved targets，故不自动判为安全忽略。无编辑结构与源文档/文件保持检查通过，仅在所记范围内有效。R2三项请求实写不同阶段，另13项实际delta为空且均有对应kind警告；16项连线均保持。原truth不变，missing和固定请求不符仍计失败；没有补测。

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
