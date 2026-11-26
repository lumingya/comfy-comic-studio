# R6 generality 同轮实质交叉复核

结论：**VERIFIED PASS（仅 generality 产品职责）**。完整任务范围为 `38838ab43cf3d056951f2fc6c52afb737d34e3c6..fe914065c7aafb0672bfe10274361f83179ce7f1`，不是只审最后两个 helper。本角色首版独立静态审查的 Blocker / High / Medium 均为 0；获准交叉后未发现新增或仍未闭合的 Medium 以上产品问题。保留两项 Low，以及自动覆盖、历史证据和未测事项。此结论不是五职责最终一致签字，也不是 root 出版、清理或最终 CI 完工证明。

身份为 fresh `/root/r6_generality_fresh`。独立首版 `report.md` SHA256 `d49bc1a837c3ce75b480038b8b3065ca6fce795519abdd835e16ab75df936dcc`，首版 seal SHA256 `9d671ba5a30e5c0bed79e43fd56648812970c207de55f922ef74e2f074212ee1`，保持不变。交叉授权 SHA256 `c57861556e6e7214ca75902cea363c4c9620edbd3ae3d0c4ae830de7fc8561d6` 已实际核验；本报告只读其白名单中的四份 peer report 和安全机器事实，没有读 peer 私有输入、原图、私有 oracle 或未授权 results。

## 已核验的 peer 身份

下列 SHA 为实际读取的原始字节身份，相关机器文件逐个 SHA／长度核对记录在 `cross-review-inputs.json`，不能用报告 verdict 替代机器事实：

| 职责 | report.md SHA256 |
|---|---|
| blind | `5e1c575aa22fc3d6dcd19d5efffc4f33810ddc64e3447a2b1ca8ccc31ecc21c6` |
| compile | `b5ea489e8e0aff3e3939fffb220b7ab1274e56fddaaeb422cae95ff74de74ca6` |
| Web | `cc4c156e13710d56214965dfba46842ec8bd883a947374c8bfdbe15ad36d161e` |
| privacy | `628d71af896e5dcebb3988b57c64b2170e13802d8d201ea890753697c80102cb` |

`blind/structural-review.json` SHA256 `ce41f4b82c583da615fa6e8f08c6fcbe0fa7dbf8efc557a04c93f9243a54deb0` 另按 peer 给出的已授权 schema 投影。预写的 16 条端口边断言全部为真，产物为 `cross-review-structure.json`。未输出完整图、文本、资产、作者或其他不定结构。

## blind：自动 no-op、图片候选及全局写点

133 次 compile 请求中，125 成功、8 次预期拒绝；成功图的闭包与输出各 125/125 正确。111/125 类型敏感全图相等，109/125 全合同相等；98 次有实际变化、27 次 no-op。不能将成功率、Python 数值相等或手动结果替换这些分母。

13 次自动 no-op 分布为 own-04 的 prompt／negative 2 次、own-06 的 prompt／negative／width／height／batch 5 次、own-17 的 width／height／batch／denoise 4 次、final-01 的 width／height 2 次。原 frozen 自动 oracle 仍为 false。源码依据不是“找不到字面值便遗漏”：`binding_scope.py:81-142` 按进入的输出槽和完整 canvas 血缘限定 generation stage；`binding_dimensions.py:103-147` 拒绝受 preset／mode 控制的尺寸，保护共用尺寸域；`binding_inference.py:138-249` 对多项不同文本及未声明的 paired output 不冒充恒等路由；`binding_stage_scope.py:18` 与 `binding_inference.py:392-401` 对 conditioning 耦合的阶段控制保守退出。unknown pipe／detailer 和未证明的输出槽不能仅凭唯一字面字段推成语义 owner。`compile.py:326-350` 对未绑定普通值保留原值并给出配置警告；缺失图片绑定则拒绝；`inspection.py:179-205` 提供 unbound／ambiguous 提示。13 个 false 因此保留为自动覆盖边界，没有证据表明这 13 次在已证明的目标上错误写入或静默丢弃。这不是用后来的 manual 通过来消除失败。

图片候选的独立端口复核：`/32/inputs/image <- /1` 使用 slot 0；图片预览 `/7` 也使用 `/32` slot 0；mask 转换 `/17/inputs/mask` 使用的是 `/32` slot 3。下一 detailer `/34` 的 image 输入来自 `/32` slot 0、detailer_pipe 来自 slot 4，后续 mask 又来自 `/34` slot 3。节点级可达性不能证明原 loader 是生成 mask 的输入文件。`inspection_candidates.py:254-284` 保留 slot 与 payload kind，非零未知辅助输出没有类型／路由证据时停止。因此 frozen oracle 缺少 mask pair 仍记录为 false，但缺少该候选本身没有被证明是产品错误。

**G-R6-L01 / Low：普通 detailer image 输入的 init 提示覆盖不足。** 同一 loader 的 init pair 也缺失，actual 只有 ref。`inspection_candidates.py:286-319` 只从 `pixels`、`init_image`、`initial_image` 播种 init，没有把普通 `image` 端口提示为 init。该输入确实供给后续 detailer 图片路径，提示覆盖不足可使用户更难发现可接管的文件字段；应保留为有来源的 Low，不能以显式写入成功直接删去。现有证据没有可信 detailer contract 证明这个端口总等同用户要求的初始生成图；放宽到任意 image 也可能把 reference／后处理图混入 init。`WorkflowMappings.tsx:90-128` 仍枚举该 loader 的非连线字面字段，并支持手选及自定义 key；backend `bindings.py:179-214` 验证真实 JSON Pointer／字面字段。因此没有证据表明用户失去可用人工接管路径。后续改善应添加可信角色合同或有明确不确定性标记的提示，不能直接升级成自动绑定。

own-17 的 global-base 写点也作了独立结构核对，而非沿用 peer 的“不是问题”：base pipe `/64:63` 的 positive 接 `/64:61`，negative 接 `/64:62`，`/4` 与 `/40` 使用该 base pipe；四个局部 edit 的 positive 各接 `/10`、`/18`、`/27`、`/31`。源码 `binding_inference.py:285-313` 在没有可识别 sampling site 时，以 model + positive／conditioning 的 owner 为保守 fallback；`333-368` 从此 owner 的对应正负端口寻源，并保护所有 positive 依赖不被 negative 改写。实际只改 `/64:61/inputs/text`，四局部源保持不变。这里“存在多个不同区域文本”不足以证明全局 base 与局部文本应竞争同一个通用 prompt。未证错误写点；保留 frozen conservative oracle 的 false，不将其改成 true。该判断只覆盖本图及当前源码合同，不担保任意未知插件的 model／positive 命名都具有相同语义。

blind 的两条 LoRA warning 差异也未抹去：类型敏感图正确，差异归属通知期望；不能纳入完整合同全通过。新 13 张公开图的规模有限，不声称覆盖巨图、长链栈或所有动态节点。

## compile：新增 29、旧四个及私有 138

当前新增 manual29 分母为 29：prompt 18、negative 11；29/29 实际选择、编译、单字段 delta、实际写入、类型敏感绑定及全图比较通过，source／links／outputs／closure 均保持。23 个初始 case 加 6 个正式补测不是 58 个，也不改变 230 旧比较。6 个补测按固定官方源身份的 wildcard 模式区分：5 个 populate 的有效字面 owner 是 wildcard_text，1 个 fixed 的有效字面 owner 是 populated_text；不能凭界面中同时存在两个字段就要求自动重写整个编码器。`binding_inference.py:138-181` 对多个独立字符串源保守，`bindings.py:179-214` 使人工指针选择一个真实字面字段，`compile.py:218-271` 从同一 base 反复计算有效绑定，不残留旧分支写入。这与机器事实中的 single-field typed delta 相互支持。

初始 70 个 compile 的 1 个五图片失败仍保留；安全归因文件说明调用输入用了 bare string、期望却是 asset 字典。`compile.py:81-82` 的公开 helper 明确定义 asset wrapper。更正调用包装的正式 case 可证明正确 wrapper 路径，不将初始失败删除或宣传 70/70。15 个 supplement 的独立分母由 6 manual29 补测、1 个 wrapper 更正、4 个旧失败 auto、4 个旧失败 manual 组成。

旧四个来自同一 58 节点多阶段图，7 samplers、7 reference-latent、7 canvases、3 outputs，闭包 57。conditionings 耦合且多个 canvas 同值，不能由相等尺寸推定唯一 generation stage。新四个自动请求证明原值保留及 typed 图正确，新四个人工请求分别实际写入所选 prompt／negative／尺寸并保留其余字段。旧 current75 的 230 比较中 4 个 false 仍是 false；没有把新 abstain oracle 倒写旧结果。

私有 138 仍是历史合同边界：没有本轮获授权原件完整 compile，也没有为填补该证据重新获取 frontend state。早期 width／height／batch 的自动推断已在后续历史版本趋于保守；138 的手工尺寸 pointer 和旧 29 个 tag 测试（28 个绑定方法加 1 个 slot case）不是“138 的 29 次执行”。本职责原首版的图／tag／mapping 静态判断继续成立，但不声称私有 138 本轮完整运行已通过。

## Web：候选展示、人工接管及数字边界

源码和安全浏览器事实一致：`WorkflowInspection.tsx:105-134,190-233` 独立呈现 missing、绑定和所有 candidate 行；`WorkflowMappings.tsx:132-147` 只将 source=heuristic 的建议纳入可采纳集合，candidate 不自动写回 mapping。用户仍可从真实非连线字段手选；backend 再验证 pointer。PNG 的 2 prompt + 2 negative + 6 image candidate 行在补充只读检查中均可见；实际手选的五条 mapping 有独立写点。原 12 行 oracle 包括两条被 compile 闭包裁剪的孤立 loader，原 false 保留，不能称为原先 12/12。候选缺失的 own-04 init 提示不因另一张 PNG 的五类手选成功而被掩盖。

**G-R6-L02 / Low：浏览器 JSON 往返不保留 Python int／float 表示区别。** Web 的 source→28 wire 和 source→12 export 类型／hash 精确比较分别为 0/28、0/12；数值比较为 28/28、12/12，重复的 2024 个差异都是整数值 float 变成 integer 表示，未见 boolean／link／数值变化。`ConfigurationParts.tsx:145-159` 使用原生 JSON.parse／JSON.stringify，`WorkflowsSection.tsx:78-82` 的 JSON 导入也经过该通路，API 序列化同样使用 JS number。此为界面表示边界，不能称浏览器 source typed/hash round-trip 已过；保存后的对象到 export 12/12 精确一致，也不能抵消 source 边界。backend 的 Python 类型敏感检查与之分开。现有运行没有证明数值变更或运行损坏，故维持 Low；大于 JS 安全整数范围、非常规浮点值及任意原始 JSON 字节保真未获本轮实测，不外推通过。

Web 的 647 个运行源码身份、6 个原始 fixture 和 clean 状态在其最终检查一致；32 LoRA 独立 key／第 17 项和 enabled／strength 配置保留证明 slot UI 接口，不能代替所有 codec／adapter 的执行验证。四种 viewport／theme、30 张实际查看截图及补充 focus／candidate 检查可支持该 UI 范围，但不推广至 UI 格式直接 compile。UI-only 文件仍导向 API export 引导；人工 mapping 不是缺失 frontend runtime 协议的替代品。

## 隐私、过程和交付边界

privacy 的 source 范围扫描为 224 blobs，71 份归档身份核对，62 个源指针解决，69 个链接有效；旧 verdict 和非字符串事实没有被清洗改写。CI 日志事实支持 2 runs／6 jobs／70 steps／0 skipped steps，但没有方法名级或时长级日志证据，也不是本角色重跑 CI。53 个 ledger 项为非最终清理账本；两个 workspace 的数据／skip 标志保持，不等于 original HEAD／status 未变化；其额外 3 个提交仍为归属未明，不能擅自还原。

本角色自身全部阶段的产品 import／calls／tests／build／browser／network 均为 0，只做标准库文件／AST／Git 只读与职责目录写入。**整轮不能声称零过程回显**：blind 的 6 类事件、privacy 的 1 个 process deviation 以及 root 正式授权的 process-events、post-initial、v2、v3 文件均保留，四份 root 文件 SHA 已核而未输出原内容；事件分母不混加。本角色不授予 process-clean PASS。过程元数据暴露不因此改写产品源码问题的分级，但必须留在 root 总账。

cross 源码核对 UTC 为 `2026-11-26T10:37:34.044276+00:00`；HEAD 仍为冻结候选，工作树干净，218 个 runtime 的原始字节全部与独立首版一致，聚合 SHA256 `a00155daa5515501eb3ee117f284c2ae1f8152ac038d7efa7f6208c46b8ad487`。源码文件身份和函数范围保存于 `cross-review-sources.json`。首版及其 8 个封存证据不改；最终 seal 另核其身份。

最终分级：Blocker 0 / High 0 / Medium 0 / Low 2（G-R6-L01、G-R6-L02）。没有通过“显式 mapping 成功”删除候选差异，没有把 expected no-op 当实际写入，没有将旧 4 个 false 或 138 未运行改写为成功。无新增产品探针或重跑。root 出版、最终 cleanup、最终全 CI 与五职责最终汇总仍由 root 完成；本角色没有清理 owned TEMP、关闭浏览器、改源码或提交／推送。
