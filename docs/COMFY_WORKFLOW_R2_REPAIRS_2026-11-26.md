# 第二轮静态工作流审查修复台账（2026-11-26）

第二轮独立审查针对 `6f9bdf2` 签发 **REQUEST CHANGES**。本页记录修复与定向复测，不能代替下一轮五位全新审查者签发的终审结论。原失败报告和测量仍保留，没有将历史失败改写为通过。

## 缺陷与通用修复

| 来源与等级 | 问题与修复 | 永久中性回归 |
|---|---|---|
| 盲测 H1；编译、通用性 Medium 交叉复现 | 模型参考/控制/蒙版祖先被当作生成画布；分离画布、模型校准和受保护参考域，沿真实端口追踪，支持结构化 `empty_latent_width/height`。共享标量或图像数据源保守要求映射。 | [semantic bindings](../server/tests/test_workflow_semantic_bindings.py)：`test_model_reference_and_control_canvases_keep_their_own_dimensions`、`test_prefixed_canvas_dimensions_do_not_bind_model_attention_masks`、`test_canvas_shared_with_a_reference_data_branch_requires_explicit_mapping` |
| 盲测 M1 | `cond1/cond2` 的共享正向文本被自动负词覆写；保护全部编号条件入口的正向来源，无法证明输出角色时保留人工接管。 | 同上：`test_multiple_conditioning_ports_protect_shared_positive_atoms`、`test_multiple_conditioning_selector_protects_possible_positive_branches` |
| 编译、通用性 Medium | 启发式 seed 同时控制 selector 时晚改分支，文本和 LoRA 留在旧路径；从同一原图迭代到最终绑定稳定，再验证 LoRA 活动路径。循环状态返回可行动错误。 | [effective bindings](../server/tests/test_workflow_effective_bindings.py)：最终启发式 selector、循环与最终 LoRA 路径回归 |
| 编译、通用性 Medium；编译 Low | 编辑 LoRA 邻项时空位丢失/异常，整数开关变字符串，未编辑字段类型或可选字段变化；只修改实际变化的原生字段，按原始出现顺序定位，保留空位、包装、元数据与未归属标签。 | [lossless LoRA](../server/tests/test_workflow_lora_lossless.py)：七项类型敏感回归；旧合约仅更新八处已有损输出快照 |
| 集成窄检，同族补漏 | 原生整数/浮点 `0` 被当作启用；读取与写入共用开关状态判据，覆盖零状态发现、同型重启、重复关闭保留负权重、邻项与重复名稳定键。 | 同上：`test_closed_flat_gates_discover_toggle_and_preserve_saved_weights` |
| Chrome Medium | 隐藏文件 input 的 label 无法键盘触发、关闭预检焦点落 BODY；改为原生 button，Enter/Space 与真实 chooser 一致，关闭/取消/保存后恢复触发位置并尊重后续显式焦点。 | [FilePick](../web/src/components/FilePick.test.tsx)、[import focus](../web/src/pages/settings/WorkflowImportFocus.test.tsx) |
| Chrome Low ×2 | 图片元数据格式误标为 Mio 包、LoRA 默认长名无完整提示；按导入来源显示图片格式并提供完整名称 title。 | [inspection](../web/src/pages/settings/WorkflowInspection.test.tsx)，真实 Chrome 四组合复测 |

## 真实样本与语义口径

固定 R2 盲测 15 份，不按修复结果换样。High 的宽高现在只改原预期的生成 latent 字段，两个支持蒙版保持原值。Medium 的共享文本不再自动绑定为 negative，原负词请求明确告警且整图不变。

| 原预写真值口径 | 原 R2 | 修复后 |
|---|---:|---:|
| 自动预期完全一致 | 83/100 | 85/100 |
| 人工预期完全一致 | 11/25 | 12/25 |
| 不存在预期完全一致 | 5/5 | 5/5 |
| 严格一致合计 | 99/130 | 102/130 |
| 固定请求符合预期且连线保留 | 原目标下 138/138，含两类语义错误 | 137 次精确写入＋1 次安全忽略 |
| 两项真实 LoRA 负值/关闭整图精确 | 4/4 | 4/4 |

剩余 28 项严格差异全部保留：9 项文本、6 项参考图角色是可见的保守人工边界；12 项属于“所有采样阶段同步 seed，steps/cfg/sampler 只改首级”的产品策略与原审查者人工阶段选择预期之差；1 项是保留两个真实 Save 分支的输出策略。它们不是自动识别成功，也没有静默误写。手工映射后的完整图比较通过。

这些数值不能与当前 75 份、首轮额外 15 份简单相加为总兼容率。实际样本的可自动确定程度不同，且严格真值、定向写入和静态可编译是不同指标。没有运行模型、GPU 或付费服务，空 `object_info` 诊断不证明实例可运行。

## 证据与当前状态

第二轮原报告、公开来源/哈希与脱敏结构记录保存在 [r2](reviews/comfy-2026-11-25/r2/blind-results.json)。修复后的[盲测报告](reviews/comfy-2026-11-25/r2/blind-after.md)、[逐项脱敏结果](reviews/comfy-2026-11-25/r2/blind-after.json)、[编译反例复测](reviews/comfy-2026-11-25/r2/compile-after.md)和[真实 Chrome 定向复测](reviews/comfy-2026-11-25/r2/web-after.md)单独保存。原审计和修复复测分开保管；原盲审目录 536 个文件在复测期间哈希不变。编译审查初次没有采集创建时哈希，不能声称曾恢复的一个 LoRA 结果文件与创建时字节完全一致；原八个失败案例的语义仍保留，本次复测前后字节一致。

最终源码还[重跑了当前 75 份、首轮盲测 15 份和私有 138 节点只读检查](COMFY_WORKFLOW_R2_RETEST_2026-11-26.md)，包含新增模块的源码差异摘要和[逐样本对照](COMFY_WORKFLOW_R2_RETEST_2026-11-26.json)。当前 75 份为 230/230，首轮盲测为 70/70，另有 20/20 显式映射、14/14 LoRA 操作；实际绑定多重集合变化为零。138 节点仍明确缺少 frontend state，不能冒称完整编译成功。

[本机完整门禁](COMFY_WORKFLOW_GATES_2026-11-26.md)已通过：后端运行 1,724 项、8 项跳过，前端 964 项通过，Spike 80 项通过，其余格式、生成物、构建与随包校验均退出 0。最终代码快照、下一轮五路独立审查、最新跨平台 CI、缓存删除和干净推送状态仍需收口。[总报告](COMFY_WORKFLOW_COMPATIBILITY_2026-11-21.md)记录整体进度与边界。
