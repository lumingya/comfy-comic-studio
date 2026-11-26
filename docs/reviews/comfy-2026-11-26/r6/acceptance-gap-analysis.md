# 17 项验收边界拆分与最终跟进

这17项不是17个已证技术失败，也不能用一句“静态解析有边界”统一关闭。原任务确实允许不能静态确定时给出原因与人工接管点；这个允许条件要求实际处理输入、给出可用下一步并避免误写，不代替真实采集、历史保管、具体回归或整链意图证据。

下表保留在最终交付稿形成前所作的有限缺口分析，其“最小真实待办”是当时的建议，不能读成当前仍有 17 个技术失败。该分析只核既有安全资料、原任务和具体测试源码，未执行 Mio、测试、网络、浏览器或构建；候选为 `fe914065c7aafb0672bfe10274361f83179ce7f1`。**后续已完成 R6 整轮 cross 5/5 VERIFIED PASS、零确认 Medium 以上，以及真实大 UI 的端口结构核对**，见[整轮回执](protocol/root-round-acceptance.json)、[结构摘要 v2](giant-structure-safe-v2.json)和[最终中文报告](final-report.md)。历史缺证未被补造；实际清理、提交推送和最终 CI 以[收尾回执](delivery-receipt.md)及 PR 正文为准。原句行号、源身份与具体方法见[机器分析及出版跟进](acceptance-gap-analysis.json)。

| 要求 | 原句与现有可验事实 | 应怎样解释 | 最小真实待办 |
|---|---|---|---|
| S03 隐私浏览器铁律 | 原任务L12禁止复制/打印/记录Cookie、认证头、Profile或账号。R6 privacy已扫224个实际Git blob、6类模式零匹配，核71归档文件；但R5三次及R6若干过程输出事件、未知截断范围都保留。 | Git未见敏感值不证明浏览器从未读取；名称枚举/操作元数据也不等于实际访问Profile内容。已知中性隔离标识输出不能升级为凭据泄露，也不能签零输出。 | 用已存safe过程receipt列出实际访问、仅元数据、未知三类及停止边界。不要为补证重读Profile/Cookie或解封原私输出。 |
| S04 CDP不可用时提示与公开源并进 | 原任务L13是条件句。后续连接和公开源推进有证：剩余33源31HTTP200/2HTTP403；加前一source为32/34唯一来源、33/35历史行有元数据。 | 不能用后来的CDP连接追认早期已发送授权教程；条件没触发也不需要补造教程。当前403/早期TLS失败不是产品解析失败。 | 只查已有启动/连接receipt是否曾触发条件。无历史记录如实未证，不重复授权或下载。 |
| T01 现代架构 | L17/66/67。旧安全覆盖索引current75有15API/8UI结构成员；现代guider/noise/多文本有具体中性回归。 | 架构提示不是加载模型验证；Flux/SD3/SDXL或modern_other不能替代所有例举家族/变体。静态不唯一时合法手选可验收，不必下载权重。 | 以现有manifest补架构提示→实际格式→已存请求→自动/接管表，未采集家族标空白；不要为每个例举词造新功能。 |
| T02 多阶段二次元 | L18。结构成员19API/10UI；R6 compile新29/29真实手选，原四false图另有4自动保守不写+4显式typed补充。 | 多阶段无法唯一归属时手选阶段是合同内能力。不能把节点共现或一个局部写点说成全流水线意图均验证。旧seed/output mode策略false与错阶段参数不混同。 | 从已有代表图连“阶段→冻结请求→完整delta/闭包→自动或手选”，哪段没有就列未测。 |
| T03 Pipe/Context与插件生态 | L19/28/64。current75为1API/10UI结构成员；端口明确、未知变换不猜identity有三项永久方法。 | 原任务反对白名单；未知总线不等于透明identity。给出原因/协议入口/可用手选是允许边界，但不能豁免实际可写来源候选漏检。 | 联接已有真实端口请求和回归；名称/结构-only生态不冒称写入通过。 |
| T04 无线/路由/子图 | L64明确“能穿透则自动解析，无法静态确定的明确标出原因与人工接管点”。current75有16UI、没有该规则的API成员；R3有2API/4UI。 | 不要求猜测浏览器生成连线。不能宣称UE/原生嵌套子图已自动展开，也不应把无自动转换本身判违约。静态selector、失活模式、UI导出引导是不同合同。 | 逐已有该类输入连接实际reason/接管步骤及四项路由回归；仅对缺具体原因/下一步的案例补证或修复。 |
| T05 LoRA结构 | L21/69。R3真实26次负值/禁用检查26/26；R6 compile独立11个中性场景最大33项；新blind真实model-only两次typed精确，warning原false保留。 | 中性长栈与真实长链、发现与写入必须分开。私有43项枚举不是43次完整编译，不需要按插件名另建白名单。 | 按chain/flat/nested/重复/model-only/开关连现有请求与五项具体方法。真实10+链若无请求就标未测，不能借中性30项替代。 |
| T06 拼接/区域文本 | L22/66/67。新29手选均真实单字段typed完整编译；6个wildcard按固定公开源码判合法写点。 | 对多源/区域不应强行全改同一词。明确合法term手选是允许接管；不自动证明全部动态区域意图。旧29manual_required仍是零次显式手选。 | 引用已有29/29、三项拼接/区域方法与新增空白/配对别名candidate方法；保留自动no-op和oracle限制原false。 |
| T07 多图/控制/蒙版 | L23/72。R6合法asset补充证明五目标typed图/闭包/uploads；blind候选15/17，两对直接detailer缺失原false保留。 | 显式写入正确不消除候选发现问题；mask oracle忽略输出slot的限制也不抹原false。R4三例无Compiled/warnings/delta为NULL，不能洗为通过。 | 正式cross对Low与可用手选路径给处置；真实请求、中性五图asset补充、R4原失败分开。 |
| T08 格式 | L71明确允许纯UI结构概览/导出API引导。current75的46API/29UI route可查；R6新6API import保真、7UI实际拒绝并inspect引导。 | 纯UI不能compile本身是允许路径，不需要猜widget或伪造API。已有PNG/WebP和损坏元数据具体回归，但R6 blind不含WebP。 | 最终矩阵分别标处理、清晰引导、预期拒绝/不适用；无新具体问题不必实现UI→API猜测转换。 |
| T09 保存/预览 | L25/72。R6成功compile125/125输出集合与独立闭包精确；多保存/预览有两项中性方法。 | 保存节点共现不证明最终分支；未知custom sink执行协议可以明确接管。双最终输出不必被强删为单个。230五字段不含output。 | 把已有真实output请求、具体中性方法、未知收集协议列清，不能每个Save名称补一条硬编码。 |
| T10 真实巨图 | L26要求120～300+节点多路径Switch图。旧索引有R3 153节点API及大UI；R3该图20次LoRA操作精确，另有中性200图及Web规模证据。 | 节点数不等于瑞士军刀意图，UI-only也不需要强制compile。范围并不要求一定另找300+API。新blind未含120+要如实列明。 | 先核已有冻结大图的SHA、node/edge/mode、多输出/多sampling/静态Switch或阶段结构；可用即补索引，不足才考虑有限补证。 |
| W01 Civitai狩猎 | L42要求25～35高赞、高复杂度、多模型/插件静态样本。历史35行/34源已记；25原始图丢失，仅12prefix。今日32/34源元数据、独立1UI26节点44边，不是原25恢复。 | 复杂度可用已有节点数/结构证明；今日model thumbsUpCount不证明采集时image likes/排序。缺失历史保管不能用人工接管洗白，也不是引擎失败。 | 明确保留历史高赞策展缺证+原25原件/完整身份缺口。若必须交一组当前可复核25～35靶场，应另立当日策展/完整SHA集合，不能改名旧集合。 |
| W03 50～80全矩阵 | L47与L71必须一起理解。固定current75中46API五段core、29UI decode/inspect/引导；R6独立13样本184calls含13次实际import，7UI预期拒绝。 | UI导入被尝试并明确引导，不等于没测；UI不进入compile/loras/diagnose是格式边界，不能算API成功，也不必硬跑非法输入。 | 发布75×阶段/格式的紧凑矩阵，实际执行/预期拒绝/不适用/未执行分开；历史原75与当前75分栏。 |
| I06 永久中性回归 | L10/76要求把发现的典型根因提炼为最小脱敏夹具。十类都能连具体方法，本次复核9个实际fe Git文件字节；新candidate模块8方法。 | 不是十类都没回归。方法存在仍不等于每条真实链通过；全suite绿灯是source-anchored覆盖，quiet日志不是每方法单项运行日志。 | 把“发现→通用合同→具体方法/SHA→门禁覆盖方式”索引纳入最终文档；只有具体根因确缺assertion才补夹具。 |
| M01 同批before/after | L82。current75同顺序/fullSHA/230身份；Python值比较206→226/230，auto138→156/160，manual弃权27→29/29，absent41/41。模型/生态分类是aa06→ed，不移植为fe分类。 | 当前同批对比有效，不能因历史丢失否定它；它也不能补签原Wave0全75。旧29manual并非29次手选，230不是完整typed。 | 修正最终文档旧数值并清楚列两个75、分类快照、fe总队列连续性及独立R6typed补充。原25历史缺口不能追造。 |
| C07 私有138/标签 | L98。6f9与ed同因_frontend_plan缺frontend state compile=false；tag0/map0/43LoRA。width/height/batch自动撤回是真变化，seed/output保留。 | 同一既存失败不是新增编译回归；撤回仍须解释安全依据及接管，不能被同失败掩盖。历史29标签测试、新29文本手选与私图均是不同分母。 | 三栏列既存失败/实际撤回/独立标签回归。完整私图compile只有合法可比state才能证；无输入保持未证，不造状态、不读凭据。 |

## 十类对应的具体中性回归

以下名称均来自实际候选测试源码，完整模块SHA在JSON的`test_index.files`。本次逐字节确认与`git show fe:<path>`相同，没有执行这些测试。八个Python文件的所列类/方法没有skip decorator或skip调用；没有额外展开ApiCase继承链。全suite由独立CI证据提供，不能写成逐方法单独执行日志。

| 类别 | 具体方法（模块缩写保留完整含义） |
|---|---|
| T01 | `test_workflow_semantic_bindings::test_modern_sampler_guider_noise_schedule_and_multitext`；`test_workflow_wild_contracts::test_modern_guider_with_deep_text_and_noise_routes_writes_only_literal_origins` |
| T02 | `test_primary_stage_prompts_and_size_do_not_overwrite_refiner_inputs`；`test_reference_conditioning_dependency_preserves_later_canvas_and_prompt`；`test_explicit_mapping_can_choose_either_stage` |
| T03 | `test_repeated_bus_types_require_named_output_ports`；`test_distinct_bus_types_follow_requested_output_slot`；`test_unknown_unary_transform_does_not_declare_identity` |
| T04 | `test_literal_selector_through_deep_primitive_chain`；`test_modes_never_expose_inactive_widgets_as_writable_origins`；`test_dynamic_selector_is_explicitly_unresolved`；`test_switch_override_keeps_both_real_branches_and_does_not_capture_old_selection` |
| T05 | `test_flat_sparse_stack_keeps_position_links_counts_and_duplicate_identity`；`test_power_dictionary_sparse_pins_keep_native_metadata_and_negative_weights`；`test_unchanged_disabled_pins_keep_native_weights_when_another_pin_changes`；`test_thirty_repeated_model_only_loras_keep_stable_keys_and_individual_precision`；`test_partial_model_and_clip_edits_preserve_unedited_numeric_strings` |
| T06 | `test_string_helper_controls_are_not_prompt_targets_and_concat_is_ambiguous`；`test_distinct_encoder_fields_and_regional_assembly_require_mapping`；`test_regional_text_append_chain_requires_mapping_and_preserves_all_origins` |
| T07 | `test_image_candidates_keep_reference_control_init_and_mask_manual`；`test_generation_image_domain_excludes_reference_mask_and_control_inputs`；`test_model_reference_and_control_canvases_keep_their_own_dimensions` |
| T08 | `test_png_text_compressed_and_international_metadata`；`test_webp_uses_prompt_exif_before_frontend_workflow`；`test_ui_only_is_reviewable_with_counts_dynamic_warning_and_steps`；`test_malformed_metadata_is_rejected_before_node_inspection`；`test_api_prompt_wrapper_can_be_imported_and_patched_consistently` |
| T09 | `test_final_save_suppresses_only_previews_of_its_own_image_path`；`test_multiple_final_saves_survive_and_shared_intermediate_preview_is_not_final` |
| T10 | `test_two_hundred_node_graph_freezes_values_without_mutating_edges_or_document`；Web的`searches a 200-node graph with a bounded option list and keyboard selection` |

M1/M2还分别有`test_empty_paired_and_typed_text_fields_are_manual_candidates`、`test_empty_literal_text_chains_need_payload_context_not_just_string_values`、`test_image_roles_cross_payload_steps_without_merging_independent_sources`等8方法，覆盖空串/空白、配对文本、多跳payload、显式mapping、标量排除、无效端口/失活模式、selector辅助输出与环。完整八名见JSON，不把R5原失败改成通过；该分析形成时 R6 cross 尚未终签；当前五票已终签，原建议与原失败仍保留。

## 分析形成时的最小建议（历史记录）

1. **纠正最终文字和分母。** 当前仓库文档快照SHA`1544b718…`第90行仍写auto160/160、总230/230、R1 70/70，须按冻结证据改为156/160、226/230、66/70或明确旧快照纠错；第112等历史阶段注明实际HEAD/范围，不把旧阶段数移植为当前数。
2. **补证据索引，不重复做已完成产品请求。** 十类都已有具体中性方法。将真实结构、保存请求、自动/手选/拒绝合同与方法/SHA连接，原子能力和整链意图分母分开。未覆盖家族/变体、真实长LoRA链、特殊输出协议明确未测。
3. **T10先查现有，不立即扩采。** 对已冻结可用大UI/大API做有限中性结构核对；节点数、多输出/采样/阶段/Switch分别有证才写。结构-only可满足真实狩猎的一部分，不是UI compile成功。
4. **不追造历史。** 原35Civitai的高赞采集排序、缺失25原件与完整身份当前不可重建；保留为历史缺口。当前75的同批before/after另有有效交付事实。若必须补一组当前可审查的25～35策展靶场，另立身份/分母，不能称恢复旧25。
5. **安全与兼容各核实具体事实。** S03按已有safe操作记录核实际敏感访问而非零输出口号；S04核条件是否触发；C07区分既存缺state失败与真实保守撤回，不擅自抓私人state。
6. **保留正式收敛闸门。** 本文件不裁定Low是否必须修复，不覆盖五路cross/final。原false、审计输入/oracle限制、过程事件和历史failed CI都保持；实际缓存清理、最终Git洁净/保护说明、文档提交推送及最终CI另取真实证据。

现有证据不支持“17项都失败”，也不支持“都被边界关闭”。这份分析将技术行为、可验收接管、未测覆盖和丢失历史分开，供root和正式cross按原任务逐项决定。

## 当前跟进与证据入口

- 旧报告的 `160/160`、`230/230`、`70/70` 已在最终报告按实际分母纠正；原始失败、变更轨迹与分类快照未改写。
- 40 个具体中性回归方法与 fe Git 字节的关联保留在机器分析，现代链、路由、LoRA、文本、图片、格式、输出和规模分别列证，不把方法存在当作所有真实图通过。
- T10 补充核对固定 current75 的一份真实 UI：262 节点、512 有效边、4 个端口证明的采样 payload 阶段、6 个阶段间可达对。初版 7 个 sampler 名称匹配含 3 个控制节点；[初版](giant-structure-safe.json)与[修正摘要](giant-structure-safe-v2.json)并列保留。Switch 名称不等于活动 selector 语义证明。
- R6 五位全新职责审查员已经封存首版并完成交叉终审；[五票回执](protocol/root-round-acceptance.json)与[问题关闭清单](issues-closed.md)保留三个 Low 及过程披露。
- 原 Civitai 25 份丢失原件、历史高赞策展、部分真实生态与完整私有 state 仍是证据限制。当前 75 同批重放和原历史 75 分开，UI 概览／导出 API 指引与显式手选按原任务允许合同解释。
- 实际交付事件另由[53 项账本](requirement-evidence-ledger.json)、[收尾回执](delivery-receipt.md)及 [PR #1 提交后回执](https://github.com/lumingya/comfy-comic-studio/pull/1)联合判断，不把本分析的建议冒充清理或 CI 已发生的证明。
