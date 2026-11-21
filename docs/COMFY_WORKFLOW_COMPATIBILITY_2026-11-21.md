# 静态 ComfyUI 工作流兼容性验收（2026-11-21）

本轮以真实公开静态工作流检验导入、识别、LoRA 控制、冻结编译和诊断。改前代码固定为 `aa06d0a`；所有下载原件、临时脚本与样图都在仓库外，永久回归只保留自行构造的最小中性拓扑。

## 样本与测量口径

首轮 75 份去重工作流来自 Civitai 35 份、GitHub 维护者仓库 40 份：65 JSON、9 PNG、1 WebP。21 份含 API 图，54 份仅含界面图；4 份界面图超过 120 节点，最大 2295 节点。模型与生态覆盖 Flux、SD3.5、SDXL、Illustrious、NoobAI、HiDream、Lumina2、AuraFlow、Chroma、Kolors，以及 rgthree、Impact、Easy-Use、Efficiency、Comfyroll、IPAdapter、ControlNet、Use Everywhere 和原生子图。类别存在交集，不能相加当作样本数。

Civitai 原件通过已有浏览器页面正常下载；没有读取或保存 Cookie、认证头、Profile 或账号资料。递归筛除了视频、3D 和音频拓扑，没有下载模型或执行 GPU 生成。

原件解码、可执行 API 导入、槽位覆盖、静态编译和实例可运行性是不同指标。纯界面图返回结构概览与 API 导出指引，不能计作自动导入成功。绑定计数表示找到候选的样本数，未进行逐样本人工真值标注，因此不能称为语义正确率。

## 改前与改后

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
| 3. 插件打包节点与Pipe/Context | rgthree 21、Easy-Use 10、Efficiency 4份均为UI；其他生态数量见测量矩阵 | [test_workflow_graph_routes.py](../server/tests/test_workflow_graph_routes.py)：`test_repeated_bus_types_require_named_output_ports`、`test_distinct_bus_types_follow_requested_output_slot` | 有端口类型/名称契约的总线可穿透；重复类型缺名称时明确歧义。UI控件顺序与浏览器状态不靠插件名猜测。 |
| 4. 路由、无线、子图与失活节点 | routing 23份、wireless 5份均为UI；Native-subgraphs家族3份均为UI | [test_workflow_graph_routes.py](../server/tests/test_workflow_graph_routes.py)：`test_literal_selector_through_deep_primitive_chain`、`test_modes_never_expose_inactive_widgets_as_writable_origins`；[test_workflow_import_media.py](../server/tests/test_workflow_import_media.py)：`test_ui_only_is_reviewable_with_counts_dynamic_warning_and_steps` | 确定的显式连线/选择器可追踪；无线、原生嵌套子图和无法确定的动态路由显示结构与接管指引。仅识别子图存在不等于执行或展开子图。 |
| 5. LoRA字典、堆叠、重复与model-only | 含LoRA结构的25份中1 API＋24 UI；真实可写LoRA样本只有1份 | [test_workflow_lora_structures.py](../server/tests/test_workflow_lora_structures.py)：`test_power_dictionary_sparse_pins_keep_native_metadata_and_negative_weights`；[test_workflow_wild_contracts.py](../server/tests/test_workflow_wild_contracts.py)：`test_thirty_repeated_model_only_loras_keep_stable_keys_and_individual_precision` | 结构识别、稳定键、负权重、model-only与逐项关闭由合成回归验证；未知编码由独立适配器接管，不能声称全部真实堆叠器已验。 |
| 6. 字符串拼装、条件合成与分区 | regional结构类别4份均为UI；真实API中的多编码器与成对条件边界见下文 | [test_workflow_semantic_bindings.py](../server/tests/test_workflow_semantic_bindings.py)：`test_string_helper_controls_are_not_prompt_targets_and_concat_is_ambiguous`、`test_distinct_encoder_fields_and_regional_assembly_require_mapping` | 唯一文本来源可自动绑定；多个片段、分区与不同文本不能统一覆写，保留候选与手工映射。 |
| 7. 多参考图、控制图与蒙版 | control结构类别1 API＋15 UI；IPAdapter家族3份均为UI | [test_workflow_import_media.py](../server/tests/test_workflow_import_media.py)：`test_image_candidates_keep_reference_control_init_and_mask_manual` | 提供ref/control/init/mask候选，角色由用户明确选择；该回归不构成真实多参考图自动分类或控制效果证据。 |
| 8. UI、图片元数据与损坏输入 | 65 JSON、9 PNG、1 WebP；21份含API，54份UI-only | [test_workflow_import_media.py](../server/tests/test_workflow_import_media.py)：`test_png_text_compressed_and_international_metadata`、`test_webp_uses_prompt_exif_before_frontend_workflow`、`test_malformed_metadata_is_rejected_before_node_inspection` | 提取API prompt后可导入；UI-only保留结构概览与逐步导出指引，损坏/超限输入返回明确错误。 |
| 9. 自定义输出与多保存分支 | 21 API图均绑定输出；具体自定义保存/预览拓扑由合成回归补验 | [test_workflow_semantic_bindings.py](../server/tests/test_workflow_semantic_bindings.py)：`test_final_save_suppresses_only_previews_of_its_own_image_path`；[test_workflow_wild_contracts.py](../server/tests/test_workflow_wild_contracts.py)：`test_multiple_final_saves_survive_and_shared_intermediate_preview_is_not_final` | 保留独立保存分支，仅抑制同一路径中间预览；特殊结果收集协议仍需输出适配器。 |
| 10. 120～300+节点巨型工作流 | 4份≥120节点真实图均为UI（123、262、2083、2295节点）；21 API原件规模为7～58节点 | [test_workflow_wild_contracts.py](../server/tests/test_workflow_wild_contracts.py)：`test_two_hundred_node_graph_freezes_values_without_mutating_edges_or_document`；[WorkflowMappings.test.tsx](../web/src/pages/settings/WorkflowMappings.test.tsx)：`searches a 200-node graph with a bounded option list and keyboard selection` | 合成200节点转发链证明有界搜索与无损冻结，不等同真实多路巨图已通过API压测；Chrome四组合验收另列。 |

## 门禁、盲测与独立终审

进行中。最终验收将记录完整仓库门禁、额外真实样本盲测、Chrome 四种视口/主题组合，以及五位全新审查者的分级发现和修复复验；尚未完成的项目不会标为通过。

### 终审前发现与修复台账

以下为已补修并纳入永久回归的预检问题，供独立终审逐项核对；不代替五位全新审查者的分级结论或 `VERIFIED PASS`。

另用只读 SQLite 查询核对了本机既有 138 节点工作流：动态图片选择器曾令本轮推断范围丢失种子和批量控制，修复后恢复这两类绑定并识别出宽高，源图保持不变。它在改前和改后均因参数面板状态编译失败，不能宣称完整可运行；未抓取或修改用户前端状态，私人原图没有复制入库。

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
| P12 | 通过参考潜空间连接的后续阶段未被识别；现在按完整因果依赖选择首阶段，只改其文本与尺寸，保留全部采样种子 | [test_workflow_semantic_bindings.py](../server/tests/test_workflow_semantic_bindings.py)：参考条件连接与模型尺寸校准回归；真实漫画样本只读参数覆写复验 |

## 适配边界

4 份 SD3 API 样本保留不同编码器文本，另外 3 份 Flux API 样本包含无输出端口契约的成对条件节点。自动统一或猜测输出顺序会改变原意，因此要求手工映射。图生图或参考图驱动的分辨率也不保证存在独立宽高槽位。没有完整执行协议时，子图、Use Everywhere、浏览器状态和动态路由需要先由 ComfyUI 导出 API，或使用独立适配器。

静态编译与空 `object_info` 检查不能证明已安装插件、模型或自定义校验器可运行。本轮未将静态通过率宣称为 GPU 出图成功率。

同一次请求同时改变活动分支并覆写受影响的 LoRA 组时，会明确拒绝冻结；需先固定分支并重新检查槽位，再提交 LoRA 设置。稳定键不会被静默改投另一分支。

格式依据：[ComfyUI API 格式](https://github.com/Comfy-Org/docs/blob/main/development/api-development/workflow-api-format.mdx)、[图片工作流元数据](https://github.com/Comfy-Org/docs/blob/main/development/api-development/workflow-metadata.mdx)、[上游保存节点实现](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_api/latest/_ui.py)。
