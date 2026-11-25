# 静态 ComfyUI 工作流兼容性验收（2026-11-21—26）

本轮以真实公开静态工作流检验导入、识别、LoRA 控制、冻结编译和诊断。改前代码固定为 `aa06d0a`；所有下载原件、临时脚本与样图都在仓库外，永久回归只保留自行构造的最小中性拓扑。

当前固定的 75 份复测语料在第二轮集成时，46 份 API 图全部可静态编译，230 个独立标注参数组合的定向覆写全部符合整图预期；另 29 份 UI-only 提供 API 导出指引。该语料由原件精确恢复 50 份和补采 25 份组成，与下文历史 75 份分别计量。第三轮终审再次要求修改，参考画布、输出端口、模式 LoRA、预设尺寸与长标题修复已落地；终态复测、完整门禁与下一轮五路独立终审仍待收口，当前不是最终通过声明。

## 样本与测量口径

首轮 75 份去重工作流来自 Civitai 35 份、GitHub 维护者仓库 40 份：65 JSON、9 PNG、1 WebP。21 份含 API 图，54 份仅含界面图；4 份界面图超过 120 节点，最大 2295 节点。模型与生态覆盖 Flux、SD3.5、SDXL、Illustrious、NoobAI、HiDream、Lumina2、AuraFlow、Chroma、Kolors，以及 rgthree、Impact、Easy-Use、Efficiency、Comfyroll、IPAdapter、ControlNet、Use Everywhere 和原生子图。类别存在交集，不能相加当作样本数。

Civitai 原件通过已有浏览器页面正常下载；没有读取或保存 Cookie、认证头、Profile 或账号资料。递归筛除了视频、3D 和音频拓扑，没有下载模型或执行 GPU 生成。

原件解码、可执行 API 导入、槽位覆盖、静态编译和实例可运行性是不同指标。纯界面图返回结构概览与 API 导出指引，不能计作自动导入成功。绑定计数表示找到候选的样本数，未进行逐样本人工真值标注，因此不能称为语义正确率。

## 改前与改后

下表及独立真值标注记录首轮实现 `71457f6`，不是后续修复版本的替代验收。首轮终审发现的问题、修复与再次测量在下文单列。

| 指标 | 改前 | 改后 |
|---|---:|---:|
| 原文件可执行导入 / 75 | 12 | 21 |
| API 图静态编译 / 21 | 21 | 21 |
| UI-only 提供明确导出指引 / 54 | 54 | 54 |
| 正向提示词绑定 / 21 | 9 | 14 |
| 负向提示词绑定 / 21 | 11 | 13 |
| 种子绑定 / 21 | 18 | 21 |
| 步数绑定 / 21 | 0 | 21 |
| CFG 绑定 / 21 | 0 | 20 |
| 采样器绑定 / 21 | 0 | 21 |
| 宽、高绑定 / 21 | 9 | 9 |
| 输出节点绑定 / 21 | 21 | 21 |
| 已绑定值写入不符 / 输入修改 / 分析崩溃 | 0 / 0 / 0 | 0 / 0 / 0 |

分组统计与公开来源保存在[脱敏测量矩阵](COMFY_WORKFLOW_MATRIX_2026-11-21.json)。真实 API 组仅有一份可写 LoRA 样本，其负权重覆写及禁用均通过；其余 LoRA 形态由合成回归验证，不能据此声称真实世界所有堆叠器均已验证。

独立按原图连线和上游节点契约标注 21 份 API 图的正词、负词、种子、宽高，共 105 个样本参数组合。在明确的首阶段、种子同步和 Flux 尺寸校准策略下，66 项可自动确定：改前 52 项正确、10 项漏绑、2 项尺寸过度绑定、2 项校准映射不完整，改后 66 项正确。另有 14 项需人工映射、25 项参数不存在，均不计作自动正确。改前/改后 42 次针对性编译的原图、非绑定字段和连线保护均通过。方法、逐项指针和范围见[独立语义标注](COMFY_WORKFLOW_TRUTH_2026-11-21.md)与[完整标注数据](COMFY_WORKFLOW_TRUTH_2026-11-21.json)；这组结果不外推为所有工作流的正确率。

## 通用能力与永久回归

- 只读图路由统一处理端口、长 Reroute/Primitive 链、静态选择器、类型与明确的歧义原因。语义推断不删改实际执行连线；失活分支不能借声明类型绕过检查。
- 参数推断按数据端口和采样上下文识别现代 guider、noise、sigma 和潜空间尺寸，保护后续精修阶段。显式标签、手工映射优先，并保护它们已经占用的目标字段。
- 多段拼接、分区词和不同编码器文本保留人工接管；同文多端口可安全同步。保存分支保留，重复的中间预览不作为最终输出。
- LoRA 稀疏槽位按原始名称及出现顺序定位，避免空槽导致后续权重移动、重复项串位或元数据丢失；保留负权重、model-only 和原始图不可变性。
- 新增有界 JSON/PNG/WebP 预检，支持 `prompt` 封装、PNG 压缩文本与 `comf`、WebP EXIF。纯 UI 图显示节点、连线、失活和隐式路由概览及 API 导出步骤。图片角色仅推荐人工候选。
- 导入前可以调整映射并采纳自动识别结果；大图候选索引、键盘搜索和长 LoRA 列表保持有界呈现。
- 永久合成测试覆盖现代条件链、20 层路由、循环与动态歧义、200 节点、30 同名 LoRA、稀疏槽位、静态选择器覆写、多保存分支及原图无损冻结。

### 原任务十类拓扑的证据与边界

下表仅统计首轮 75 份；结构类别有交集，家族声明与结构类别也不等价。测试名定位永久合成回归，不代表真实插件执行通过。54 份 UI-only 的结构识别与导出指引不能折算为 API 引擎兼容率；额外盲测结果另行记录。

| 原任务类别 | 真实样本格式与覆盖 | 永久合成回归（文件／测试名） | 自动处理与人工接管边界 |
|---|---|---|---|
| 1. 现代静态模型 | Flux：9 API＋16 UI；SD3：8 API＋8 UI；其他现代模型结构类别4份均为UI | [test_workflow_semantic_bindings.py](../server/tests/test_workflow_semantic_bindings.py)：`test_modern_sampler_guider_noise_schedule_and_multitext` | 按采样、guider、noise和调度端口追踪；不同编码器文本、未声明成对输出顺序保留映射。未逐个证明每种模型或插件可运行。 |
| 2. 二次元多阶段精修 | Illustrious家族5份、NoobAI家族7份均为UI；Impact结构类别15份均为UI；API-sdxl家族4份为API，不能当作复杂精修链证据 | [test_workflow_semantic_bindings.py](../server/tests/test_workflow_semantic_bindings.py)：`test_primary_stage_prompts_and_size_do_not_overwrite_refiner_inputs` | 保护后续精修阶段参数；真实FaceDetailer等复杂API链的测量不足，UI图需先导出API，不能以简单SDXL样本替代。 |
| 3. 插件打包节点与Pipe/Context | rgthree 21、Easy-Use 10、Efficiency 4份均为UI；其他生态数量见测量矩阵 | [test_workflow_graph_routes.py](../server/tests/test_workflow_graph_routes.py)：`test_repeated_bus_types_require_named_output_ports`、`test_distinct_bus_types_follow_requested_output_slot` | 总线身份转发需要可信适配契约；仅有端口类型/名称不足以证明输入等于输出。UI控件顺序与浏览器状态不靠插件名猜测。 |
| 4. 路由、无线、子图与失活节点 | routing 23份、wireless 5份均为UI；Native-subgraphs家族3份均为UI | [test_workflow_graph_routes.py](../server/tests/test_workflow_graph_routes.py)：`test_literal_selector_through_deep_primitive_chain`、`test_modes_never_expose_inactive_widgets_as_writable_origins`；[test_workflow_import_media.py](../server/tests/test_workflow_import_media.py)：`test_ui_only_is_reviewable_with_counts_dynamic_warning_and_steps` | 确定的显式连线/选择器可追踪；无线、原生嵌套子图和无法确定的动态路由显示结构与接管指引。仅识别子图存在不等于执行或展开子图。 |
| 5. LoRA字典、堆叠、重复与model-only | 含LoRA结构的25份中1 API＋24 UI；真实可写LoRA样本只有1份 | [test_workflow_lora_structures.py](../server/tests/test_workflow_lora_structures.py)：`test_power_dictionary_sparse_pins_keep_native_metadata_and_negative_weights`；[test_workflow_wild_contracts.py](../server/tests/test_workflow_wild_contracts.py)：`test_thirty_repeated_model_only_loras_keep_stable_keys_and_individual_precision` | 结构识别、稳定键、负权重、model-only与逐项关闭由合成回归验证；未知编码由独立适配器接管，不能声称全部真实堆叠器已验。 |
| 6. 字符串拼装、条件合成与分区 | regional结构类别4份均为UI；真实API中的多编码器与成对条件边界见下文 | [test_workflow_semantic_bindings.py](../server/tests/test_workflow_semantic_bindings.py)：`test_string_helper_controls_are_not_prompt_targets_and_concat_is_ambiguous`、`test_distinct_encoder_fields_and_regional_assembly_require_mapping` | 唯一文本来源可自动绑定；多个片段、分区与不同文本不能统一覆写，保留候选与手工映射。 |
| 7. 多参考图、控制图与蒙版 | control结构类别1 API＋15 UI；IPAdapter家族3份均为UI | [test_workflow_import_media.py](../server/tests/test_workflow_import_media.py)：`test_image_candidates_keep_reference_control_init_and_mask_manual` | 提供ref/control/init/mask候选，角色由用户明确选择；该回归不构成真实多参考图自动分类或控制效果证据。 |
| 8. UI、图片元数据与损坏输入 | 65 JSON、9 PNG、1 WebP；21份含API，54份UI-only | [test_workflow_import_media.py](../server/tests/test_workflow_import_media.py)：`test_png_text_compressed_and_international_metadata`、`test_webp_uses_prompt_exif_before_frontend_workflow`、`test_malformed_metadata_is_rejected_before_node_inspection` | 提取API prompt后可导入；UI-only保留结构概览与逐步导出指引，损坏/超限输入返回明确错误。 |
| 9. 自定义输出与多保存分支 | 21 API图均绑定输出；具体自定义保存/预览拓扑由合成回归补验 | [test_workflow_semantic_bindings.py](../server/tests/test_workflow_semantic_bindings.py)：`test_final_save_suppresses_only_previews_of_its_own_image_path`；[test_workflow_wild_contracts.py](../server/tests/test_workflow_wild_contracts.py)：`test_multiple_final_saves_survive_and_shared_intermediate_preview_is_not_final` | 保留独立保存分支，仅抑制同一路径中间预览；特殊结果收集协议仍需输出适配器。 |
| 10. 120～300+节点巨型工作流 | 4份≥120节点真实图均为UI（123、262、2083、2295节点）；21 API原件规模为7～58节点 | [test_workflow_wild_contracts.py](../server/tests/test_workflow_wild_contracts.py)：`test_two_hundred_node_graph_freezes_values_without_mutating_edges_or_document`；[WorkflowMappings.test.tsx](../web/src/pages/settings/WorkflowMappings.test.tsx)：`searches a 200-node graph with a bounded option list and keyboard selection` | 合成200节点转发链证明有界搜索与无损冻结，不等同真实多路巨图已通过API压测；Chrome四组合验收另列。 |

## 门禁、盲测与独立终审

进行中。最终验收将记录完整仓库门禁、额外真实样本盲测、Chrome 四种视口/主题组合，以及五位全新审查者的分级发现和修复复验；尚未完成的项目不会标为通过。

### 首轮五路终审与修复

首轮审查固定在 `71457f6`，三路要求修改、两路通过；没有将它记作全票验收。原始脱敏结论分别保留在[通用性](reviews/comfy-2026-11-22/r1/generality.md)、[额外盲测](reviews/comfy-2026-11-22/r1/blind.md)、[编译语义](reviews/comfy-2026-11-22/r1/compile.md)、[真实 Chrome](reviews/comfy-2026-11-22/r1/web.md)、[隐私与 CI](reviews/comfy-2026-11-22/r1/privacy.md)。盲测的机器可读记录为同目录 [blind.json](reviews/comfy-2026-11-22/r1/blind.json)。

额外 15 份未见样本为 14 API、1 UI-only（11 PNG、4 JSON）；首轮自动可确定语义 50/50 正确，需人工决定的 20 项中 18 项安全留空，70 次定向编译中 68 次符合人工目标。5 个实际活跃 LoRA 中检出 3 个，漏检 2 个 Efficiency 堆叠槽位。上述结果保留失败，不以合成测试通过覆盖。

| 问题 | 等级与交叉证据 | 通用修复与永久回归 |
|---|---|---|
| 嵌套选择器控制递归溢出 | Medium，通用性与编译审查各自复现 | 有界迭代求值和循环检测；`test_nested_selector_controls_are_iterative_and_cycle_safe` 覆盖 600 层 |
| 失活编码器自己的文本仍被自动写入 | Medium，两路独立复现 | 先检查活动状态再识别编码器；`test_bypassed_encoder_widgets_are_not_automatic_targets` |
| 未知变换节点被误当恒等转发，开关辅助输出被当载荷 | Medium，编译审查及上游方法核验 | 类型/名称不作恒等证明，辅助输出保持未解析，可信路由契约单独声明；`test_public_compile_rejects_guessed_auxiliary_and_transformed_controls` |
| 不同尺寸的并行合成画布被统一改写 | Medium，真实盲测与编译审查交叉复现 | 尺寸域不一致时要求人工映射；`test_unequal_composition_canvas_domains_require_explicit_size_mapping` |
| 上游有效 LoRA 堆叠漏检 | Medium，真实盲测 | 分离本地与上游槽位，按模式和数量识别实际有效权重，保留空槽、隐藏权重与数量；[模式回归](../server/tests/test_workflow_stack_modes.py) |
| 对象 LoRA 写入删除提示词正文 | Medium，编译审查；问题早于本任务 | 只更新有归属证据的 LoRA 标签，保留正文、空白和无关标签；`test_object_pin_edits_preserve_prose_and_unowned_tags_in_each_string` |
| 修改邻项时清空未修改的关闭项权重 | Low，编译审查；问题早于本任务 | 保留原始关闭项及包装元数据；`test_unchanged_disabled_object_pins_preserve_native_weights_and_flags` |
| 键盘选择映射后焦点丢到正文 | Low，真实 Chrome | 在检查完成后恢复所选控件，尊重后续用户焦点，重试有上限；[焦点回归](../web/src/pages/settings/WorkflowMappingFocus.test.tsx) |

2026-11-25 恢复执行时，原仓库外临时目录已不存在；保留的公开来源、哈希和历史测量未丢失。原 75 份精确恢复 50 份，其中包含全部 21 份 API 图；原盲测 15 份全部恢复且原始文件 SHA-256 匹配。其余 25 份旧 UI-only 原件中，20 份匿名下载要求登录，3 份当前下载失败，2 份公开文件不匹配历史图哈希，[可用性记录](COMFY_WORKFLOW_RECOVERY_2026-11-25.json)保留逐项来源与原因。

当前复测另固定 75 份语料：恢复的 50 份加上 25 份新的公开 API 工作流，共 46 API、29 UI-only。新增样本在探测前按静态类型、来源和拓扑去重，不按引擎结果筛选。当前最大 API 为 58 节点、UI 为 262 节点；没有把历史 2295 节点 UI 样本称作此次重新下载成功，也没有新增 120+ 节点真实 API 图。该当前语料与历史 75 份分别计量；不把替补样本伪装成原件完整恢复。

这批当前 75 份已在改前 `aa06d0a` 和修复版本完成同批复测：原文件可执行导入 12/75→46/75，46 份 API 静态编译均通过；230 个独立标注参数组合中，自动可确定且正确 138/160→160/160，人工必选且安全留空 27/29→29/29，定向编译符合整图预期 206/230→230/230。源文件和源图均保持不变；保留节点的无关值与连线检查通过。方法、分类统计、全部来源和逐项检查见[当前语料复测](COMFY_WORKFLOW_RETEST_2026-11-25.md)与[脱敏数据](COMFY_WORKFLOW_RETEST_2026-11-25.json)。首轮额外盲测的修复复验达到 70/70 定向编译，5 项真实 LoRA 的 10 次负权重／禁用操作精确通过，仍不代替下一轮全新盲测。

当前语料中，以下分组的自动可确定目标正确数如下。分母只含正词、负词、种子、宽和高的独立可确定组合；类别可以重叠，不能相加。只有 UI 图的生态没有可测 API 正确率，不能填成 100%。

| 模型／结构分组 | API 图数 | 改前正确／可确定 | 改后正确／可确定 |
|---|---:|---:|---:|
| Flux | 9 | 17/26 | 26/26 |
| SD3 | 8 | 18/25 | 25/25 |
| SDXL | 4 | 5/8 | 8/8 |
| Control | 8 | 23/27 | 27/27 |
| Impact | 6 | 20/22 | 22/22 |
| Inpaint | 8 | 20/20 | 20/20 |
| LoRA 结构 | 2 | 6/6 | 6/6 |

补采的真实 GLIGEN 区域文本追加链还暴露出一项新的推断缺陷：局部 `text` 和 `clip` 被当作完整编码器，导致全局提示词请求写进区域描述。通用修复同时追踪局部文本和传入条件，不同文本保留人工映射；显式全局指针仍可写入且保留全部区域。永久中性回归覆盖了这条追加链。此处尚不宣称第二轮终审通过或最终清理完成。

### 第二轮独立终审与修复

第二轮冻结 `6f9bdf2`，结论为 **REQUEST CHANGES**。五份原始结论完整保留：[通用性](reviews/comfy-2026-11-25/r2/generality.md)、[新增真实盲测](reviews/comfy-2026-11-25/r2/blind.md)、[编译](reviews/comfy-2026-11-25/r2/compile.md)、[真实 Chrome](reviews/comfy-2026-11-25/r2/web.md)、[隐私与跨平台 CI](reviews/comfy-2026-11-25/r2/privacy.md)。各审查重叠发现不相加为独立缺陷数。

新增固定 15 份真实盲测为 13 API、2 UI-only，含 9 PNG、6 JSON。它暴露了生成尺寸误写支持蒙版的 High，以及共享正向文本被负词覆写的 Medium；编译审查另查出最终选择器状态、LoRA 空位和整数开关问题，Chrome 审查查出导入入口不可键盘触发及关闭焦点丢失。修复按画布/参考域、最终有效绑定、原生字段保真与原生按钮完成，没有按样本或插件名加入特判。

原 130 项盲测预写真值没有修改：严格一致由 99/130 提升至 102/130。剩余 28 项为文本/图片人工边界、阶段参数策略和保留双保存分支的策略差异，全部保留而非改成成功。原 138 次请求重放为 137 次精确写入和 1 次明确警告的安全忽略；不能把它写成 138 次自动覆写成功。原始失败、修复证据和永久回归见[第二轮修复台账](COMFY_WORKFLOW_R2_REPAIRS_2026-11-26.md)。这轮修复复测不替代下一轮全新五审。

### 第三轮独立终审与修复

第三轮固定 `50bb3fa`，整体仍为 **REQUEST CHANGES**。新增 15 份真实盲测含 11 API、4 UI-only，最大 API 为 153 节点，最大 UI 为 683 节点；前述当前 75 份的规模限制没有因此改写。真实 simple/count 堆栈暴露了 10 项有效 LoRA 被报告为 12 项、7 项 CLIP 显示错误，20 次负值/关闭操作额外重写未激活字段的问题。预设尺寸的两项字面写入虽准确，实际有效输出不变。两类问题均保留原失败，正在进行修复后复测。

通用性和编译审查另确认参考生成支路误作主阶段、未知辅助输出作用域、局部文本镜像跨项注入和 numeric-string 权重失真；真实 Chrome 发现长文件名标题横向溢出。修复、永久回归、完整原报告与尚未完成的门禁记录见[第三轮修复台账](COMFY_WORKFLOW_R3_REPAIRS_2026-11-26.md)。私有 138 节点实际撤回宽、高、batch 三项自动绑定：尺寸 helper 与输出画布的未知 bundle 契约分别限制归属证明。不能再将“字段写入成功”当作“有效尺寸控制”，也不能遗漏 batch 撤回或冒称已返回它的专属提示。

`eb876cf` 的原 R3 反例复验已关闭已测缺陷；固定旧队列却再次检出复合潜空间端口遗漏的真实回归，R1 原真值为 67/70，另含未知变换角色导致的两项安全撤回。失败报告没有改写，正在通过共享载荷角色和不完整画布证明进行跟进。它进一步说明单测绿灯、旧反例复验和整体泛化验收必须分别记账。

### 终审前发现与修复台账

以下为已补修并纳入永久回归的预检问题，供独立终审逐项核对；不代替五位全新审查者的分级结论或 `VERIFIED PASS`。

另用只读 SQLite 查询核对了本机既有 138 节点工作流：动态图片选择器曾令本轮推断范围丢失种子和批量控制，修复后恢复这两类绑定并识别出宽高，源图保持不变。它在改前和改后均因参数面板状态编译失败，不能宣称完整可运行；未抓取或修改用户前端状态，私人原图没有复制入库。

在 `6f9bdf2` 再次只读复验，以上五类绑定保留，43 项 LoRA 的稳定键和刷新后的分析计划一致，定向绑定阶段只改目标值、数据库中的源文档字节不变。完整编译仍明确报告缺少前端状态。该私人图没有 `[mio:*]` 标签，不能据此宣称验证了标签兼容；另运行 `tests.test_bindings` 与已提交 Alice 槽位回归，共 29 项通过，单独覆盖标签优先与手工映射。仅导出统计与判定的[脱敏复验记录](COMFY_WORKFLOW_138_RETEST_2026-11-25.json)不含图、文档 ID、提示词、模型名或槽位键。

| 编号 | 预检问题与修复边界 | 回归证据（文件／测试名） |
|---|---|---|
| P01 | 成对条件节点没有输出端口契约时猜错正负来源；现在保留歧义，要求映射 | [test_workflow_semantic_bindings.py](../server/tests/test_workflow_semantic_bindings.py)：`test_crosswired_paired_outputs_require_mapping_instead_of_guessing_roles` |
| P02 | 共享固定正词被负词启发式覆盖；保护共享正词目标 | [test_workflow_semantic_bindings.py](../server/tests/test_workflow_semantic_bindings.py)：`test_zeroed_negative_does_not_overwrite_the_shared_positive_encoder`、`test_negative_heuristic_preserves_a_shared_later_stage_positive` |
| P03 | 选择器覆写后仍绑定旧分支；按合并后的有效状态冻结并报告绑定 | [test_workflow_effective_bindings.py](../server/tests/test_workflow_effective_bindings.py)：`test_config_pointer_selector_is_applied_before_inference`、`test_inspection_reports_the_compiled_effective_binding` |
| P04 | 改变选择器并追加LoRA会写入旧分支；不允许稳定键静默转移，需重新检查槽位 | [test_workflow_effective_bindings.py](../server/tests/test_workflow_effective_bindings.py)：`test_lora_append_cannot_silently_target_the_old_selected_branch` |
| P05 | 修改LoRA邻项时尾部空字典槽位及元数据丢失；保留原始空槽结构 | [test_workflow_lora_structures.py](../server/tests/test_workflow_lora_structures.py)：`test_trailing_empty_dictionary_keeps_metadata_when_another_pin_changes` |
| P06 | 修改LoRA邻项时已关闭项的保存权重被改写；未修改项保持原值 | [test_workflow_lora_structures.py](../server/tests/test_workflow_lora_structures.py)：`test_unchanged_disabled_pins_keep_native_weights_when_another_pin_changes` |
| P07 | 切换变体报告尚未返回时可采纳旧映射；等待当前报告后才允许编辑、采纳与保存 | [WorkflowImportPreflight.test.tsx](../web/src/pages/settings/WorkflowImportPreflight.test.tsx)：`blocks manual and detected mapping edits until the selected variant report arrives` |
| P08 | API节点ID与graph/prompt/workflow封装键重名时有误判风险；先识别有效节点图，保留这些合法ID | [test_workflow_import_media.py](../server/tests/test_workflow_import_media.py)：`test_json_graph_envelopes_and_api_names_remain_intact` |
| P09 | 损坏的节点元数据可能触发500；预检、保存和修改统一返回可行动格式错误 | [test_workflow_import_media.py](../server/tests/test_workflow_import_media.py)：`test_malformed_metadata_is_an_actionable_review_and_import_error` |
| P10 | 非有限数与溢出JSON存在失真风险；文件、图与覆写统一拒绝，避免静默丢值 | [test_workflow_import_media.py](../server/tests/test_workflow_import_media.py)：`test_overflowing_json_and_direct_nonfinite_values_are_rejected`、`test_nonfinite_json_is_rejected_in_file_review_graph_and_overrides` |
| P11 | 动态输出路由使可能分支的标量控制漏检；保留真实依赖范围，异文提示词保持人工接管 | [test_workflow_semantic_bindings.py](../server/tests/test_workflow_semantic_bindings.py)：动态图片选择器合成回归 |
| P12 | 历史修复曾按完整因果依赖选择首阶段；R3 证明参考支路不等于生成画布串联，现改为沿实际图像/潜空间血缘确定。旧真实/合成测量保留为历史，错误依据明确撤回 | [test_workflow_canvas_scope.py](../server/tests/test_workflow_canvas_scope.py)；[R3 语义纠正](COMFY_WORKFLOW_R3_REPAIRS_2026-11-26.md) |

## 适配边界

4 份 SD3 API 样本保留不同编码器文本，另外 3 份 Flux API 样本包含无输出端口契约的成对条件节点。自动统一或猜测输出顺序会改变原意，因此要求手工映射。图生图或参考图驱动的分辨率也不保证存在独立宽高槽位。没有完整执行协议时，子图、Use Everywhere、浏览器状态和动态路由需要先由 ComfyUI 导出 API，或使用独立适配器。

静态编译与空 `object_info` 检查不能证明已安装插件、模型或自定义校验器可运行。本轮未将静态通过率宣称为 GPU 出图成功率。

同一次请求同时改变活动分支并覆写受影响的 LoRA 组时，会明确拒绝冻结；需先固定分支并重新检查槽位，再提交 LoRA 设置。稳定键不会被静默改投另一分支。

格式依据：[ComfyUI API 格式](https://github.com/Comfy-Org/docs/blob/main/development/api-development/workflow-api-format.mdx)、[图片工作流元数据](https://github.com/Comfy-Org/docs/blob/main/development/api-development/workflow-metadata.mdx)、[上游保存节点实现](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_api/latest/_ui.py)。
