# R6 blind 独立首版

结论：**VERIFIED PASS（blind 职责）**。冻结候选上未证实 Medium 或更高等级产品缺陷；有 2 项 Low 兼容性/提示覆盖观察。这个判断没有把原断言失败改成通过：133 次冻结 compile 请求仍保留 16 项完整合同差异，其中 14 项 typed 图差异、2 项仅通知文本差异；图片候选仍有 2/17 个冻结角色对缺失。这里不签署全任务最终交付、隐私审计或浏览器验证，也不声称自动绑定全覆盖。

## 独立性与固定身份

- 本人是未参加实现或旧审查轮的独立采集角色。先读原任务、AGENTS、README、ROADMAP 与正式 R6 brief/acceptance/authorization。首版完成前未读同轮角色产物；未使用旧 oracle，也未执行旧 builder 的 main。允许的 builder 仅提取纯函数。
- 审查范围为 `38838ab43cf3d056951f2fc6c52afb737d34e3c6..fe914065c7aafb0672bfe10274361f83179ce7f1`。运行前后 HEAD 均为 fe；218 个 runtime Python 文件的聚合 SHA 为 `a00155daa5515501eb3ee117f284c2ae1f8152ac038d7efa7f6208c46b8ad487`，407 个 server Python 文件聚合 SHA 为 `018c572cec3c9a629b13e4ea3bf6f6b5fd1323b0581c5f696c294007c61f7b32`，前后相同。未改仓库、未提交或推送。
- 主冻结件：selected manifest `02f5f3463945d8cd5d43fa2ba226a423164f26e1c941f92dc6adbc85dce8c7f3`；全部候选与 disposition `e47ec79e4bd2ff9af84c3ffc5afb61f0e7c18ac73dbb99602c68ff102c8ac218`；typed oracle `4822e9f60b4ce71511902a74f7150a97000fd79986c76a230ba7d0860cf54318`；角色候选 oracle `1e2272d0362d62e11f67c3083ac065fb2deacb9bae574dfb1bfce02220523b51`；pre-run freeze `8a845f25d8ca58db244cb834c9d522d45e4b0790c61ee00f6cfef794239d684e`。原件、请求与完整 typed 预期仅留外部职责目录，报告不输出作者提示词/资产名。

## 新采集与去重

固定 13 份真实公开静态工作流，6 API、7 UI；没有换样。API 节点数为 14、15、32、36、14、20；UI 为 16、31、15、68、21、49、29。容器共 8 PNG、5 JSON，其中 API 为 5 PNG、1 JSON。API 有三阶段放大、四路图片区域处理、双图组合及带真实 active model-only LoRA 的图；UI 提供 rgthree、IPAdapter、ControlNet、Efficiency、Impact 等额外生态结构覆盖。UI 不记入 API compile 成功。

采集过程保留 62 个下载/失败候选：13 selected、15 命中已见身份、19 覆盖优先级未选、8 无图、2 取得失败、5 模态关键字排除；另保留 54 个仅发现来源位置的候选身份。54 是位置记录数，不宣称 54 个独立图。最终全候选、排除项、失败项均保留，未为只展示成功而删除。

本体有界 HTTP 请求实际 93 次，含早先 tree/API rate-limit 相关 9 次；后续公开 raw 采样另记，未再探该 rate-limit 接口。公共搜索为 7 次工具调用/22 查询。此前有界助手另记 23 HTTP +1 搜索，共 24 调用。93 与 24 是两个实际请求账本；来源交叠保留，不把请求次数按 URL 去重后相加成“唯一来源数”。没有后续扩采。

以最终 seen-ledger-v3（SHA `a6b4c101ba737e458a87e95222abadad68916cb06d3826b5211d9f0e8bab0d53`，263 条）逐项做 11 层身份检查，包括来源 URL/族、原容器/保存 raw、API/UI canonical、WL32 拓扑及各历史弱 prefix 层。raw 和 canonical 均与弱 prefix 比较。13 份在可计算层均 fresh，raw 各异、样本间无 WL32 碰撞；PNG 同时含 API/UI 元数据不拆成两份计数。

历史缺失 25 原件，无法穷尽重算；原 35 Civitai 弱 canonical-prefix 语义只有 10 份 fullcanonical 支持，旧 75 的弱 prefix 算法仍未知。这些限制未被“fresh”结论消除。部分 main 引用可变，身份按本次 exact raw/canonical SHA 固定，未伪称 commit 固定。公开来源 URL 与版本/容器身份在 manifest，未下载模型或权重。

## 租约与实际执行边界

先冻结请求/typed oracle/闭包/全部 delta/警告，再获得独占租约 `r6-blind-001`。只运行冻结 executor 一次；root lease 与固定 argv token 的 1:1 alias 另存，未改脚本、未双计数。

2026-11-26 10:01:53 UTC，PID 29296 在任何 Mio import 前，真实设置并读回 affinity=1、priority=16384；失败即停止。单进程串行，合计 **184 显式调用 = 13 decode +13 inspect +13 import +6 loras +133 compile +6 diagnose**。7 次 UI import 是预期拒绝。整次工具进程 wall 3.9883233 秒；内部静态操作循环 0.878 秒；两者不是逐项产品响应时间或浏览器性能。低于 180 秒硬上限。

执行的是实际库/路由 handler 与编译器，隔离内存 store、空 Registry；没有启动 HTTP server、写物理工作库或连接 ComfyUI。diagnose 使用空 object_info，各 API 图均按原结构报告缺节点类，invalid-link 为 0；这只验证缺依赖诊断边界，不等于模型依赖齐全、真实节点 VALIDATE_INPUTS 或 GPU 可执行。没有网络、模型、用户数据、GPU、全套 suite/build/E2E。结束即核源身份并释放租约；释放后仅纯文件分析。

## 原分母与结果

| 冻结类型 | 请求 | 成功返回 | typed 精确 | 警告精确 | 实际有写入 |
|---|---:|---:|---:|---:|---:|
| 显式手选 mapping | 76 | 76 | 76 | 76 | 76 |
| 自动期望 | 32 | 32 | 19 | 19 | 19 |
| 预期歧义保守保持 | 3 | 3 | 2 | 2 | 1 |
| baseline | 6 | 6 | 6 | 6 | 0 |
| 不存在的普通参数 | 6 | 6 | 6 | 6 | 0 |
| active LoRA 负值 | 1 | 1 | 1 | 0 | 1 |
| active LoRA 禁用归零 | 1 | 1 | 1 | 0 | 1 |
| 不存在的图片角色 | 2 | 0 | 不适用 | 不适用 | 0 |
| 坏 mapping | 6 | 0 | 不适用 | 不适用 | 0 |

总计 125 成功、8/8 预期拒绝；成功中的整图 typed 精确 111/125、包含 warning 的完整合同精确 109/125；125/125 输出集合与独立祖先闭包精确。98 次有实际写入，27 次成功保持原图。133/133 原图与原文档保持，125/125 请求文档保持；13/13 原 raw 不变。整图类型树区分 bool/int/float，全部修改与剪枝 delta 均比对，不靠 Python 数值 `==`、单点值出现或关键字段抽查。

76 次手选覆盖 prompt 5、negative 5、seed/steps/cfg/sampler/scheduler/denoise 各 6、width/height 各 5、batch 4、init/control/mask/ref 各 4。图片手选请求是明确给某个源字段赋某种 role 的合法 mapping；这证明写点/类型/闭包保真，不独立证明每个 role 的自动语义推断正确。

13/13 decode typed 一致；6 API import 图完整保真、7 UI import 拒绝且 inspect 返回 ui_format/ui_overview 导出引导。UI 没有 compile、LoRA 写入或依赖诊断成功分母。6/6 API LoRA 组数符合结构预期；唯一 active 真 LoRA 的稳定键负值及禁用操作，均只改 `/2/inputs/strength_model`，负值保持 float、禁用保持 int，model-only 未添加 CLIP 字段，邻项与连接未改。没有把这 2 次说成重复名、长栈或多种 stack 的覆盖。

图片提示预写 9 个源字段、17 个角色对；实际 15/17 角色对存在，8/9 源具备全部预期角色。空 negative 文本所在 `/10/inputs/prompt` 的正/负候选均实际出现；这里只是该真实源的 inspect 证据，不等于全套 M1/M2 浏览器操作。

## 差异归因与等级

**BL-L1 / Low：自动覆盖的保守边界。** 13 次冻结 automatic 期待实际保持原图，并各返回 1 条“未绑定、忽略值、请显式配置”的指引。own-04 的正/负文本 2 次；own-06 的正/负文本及宽高/batch 5 次；own-17 的宽高/batch/denoise 4 次；final-01 的宽高 2 次。它们仍是 frozen false，不能报 32/32 自动成功。

静态归因：`binding_scope.py:101-141` 要求完整、端口感知的 canvas 路径；未知 detailer/pipe 辅助端口会使自动 stage 证明撤回。`binding_inference.py:247-329` 还要求可识别的采样/主阶段，区域 sampler/provider 结构不因唯一同名字面量自动获主阶段语义。`binding_dimensions.py:103-134` 对带 image 输入或 crop/mode 几何控制的节点拒绝猜尺寸。冻结 oracle 用“角色字面量唯一”作较强自动预期，没有证明这些额外语义条件。产品的实际结果是清晰警告后的保守 no-op；对应显式 mapping 全部实际写入精确。因此记录兼容覆盖不足，未把它升成已证实错误改写或 Medium 缺陷。

**BL-L2 / Low：直接 detailer 图片用途提示不足。** own-04 的 `/1/inputs/image` 实际仅有 ref 候选，冻结 init、mask 对均缺失。`inspection_candidates.py:286-309` 只从 pixels/init_image/initial_image 等确定字段名建立 init 提示，第三方 detailer 的普通 image 口没有 init 提示。通用 ref 候选仍存在，显式 init mapping 可准确写入，未证明整个界面无法手选。

其中 mask 的冻结期待另有 oracle 限制：自己的候选 oracle 按 node 走路径，原图在 detailer 的 output0 图像和 output3 生成 mask 之间分槽；原始图片流入 image 口不自动证明它是生成 mask 的来源。产品 slot-aware 遍历拒绝把未知辅助输出当恒等 payload（`inspection_candidates.py:261-283`）具有合理性。这个限制如实归于本 oracle，原缺失结果不删除。

**BL-O1 / oracle 限制：1 次 conservative false。** own-17 原 oracle 将多个区域文本和全局文本视为都互相竞争，期待不改；实际只修改 `/64:61/inputs/text` 的全局 base conditioning 源，区域局部字符串保持。`binding_inference.py:285-316` 的无采样识别 fallback 会选择含 model+positive 的 base owner。现有结构未证明该全局写点错误，不能仅因全图有多个文本就报错改局部 prompt；这次 typed/警告 false 仍保留。

**BL-O2 / oracle 通知遗漏：2 次 warning-only false。** LoRA 负值与禁用的整图、类型、全 delta、闭包、源保持均精确；实际多出 `workflow_slot_apply.py:167` 的写入通知，冻结 oracle 误预期空 warning。报告只用通知类别/长度/hash，不输出资产名。这是 2 次原警告断言失败，未改成原 PASS。

本次没有证实 Medium/High/Critical 产品问题。Low 观察保留为真实能力范围；unknown-transform 的人工提示不等于自动可恒等改写，显式精确也不消除自动 no-op 和提示缺口。`attribution.json`、`assessment.json`、`results.json` 保留逐请求原目标、实际目标、全部 typed delta、warnings hash 和冻结 false。

## 未测与不得外推

没有覆盖 120+ 巨图、10+ 长 LoRA 栈、重复名、嵌套/flat stack 的完整组合、可选 CLIP 的活跃写入、无线/原生子图、WebP 原容器、真实依赖校验、出图或性能压力。6 API 的节点规模和生态有上述偏斜，不称其代表全部公开生态。7 UI 提供格式/引导和结构证据，不补足 API 执行数量。未读取用户私有图、补取 frontend state 或用户 LoRA；没有私有 138 图完整 compile 新证据，也不以本次 76 手选替换其他历史/当前分母。

缓存代际、持久化原子性、插件注册、浏览器四格、远端实际 CI 和原工作区保护不在本次 184 调用中；本角色没有用 API handler 成功替代这些验收。本次结合原任务对真实静态输入、通用人工接管和保守边界作判断，不把独立采集角色的结论包装为全部交付完工。

## 过程不合规披露

本准备过程不是“零回显”。以下已及时通知 root，原过程事件保留在 `process-events.json`，不在这里重复原文、资产名、栈或私路径：

1. 首次未捕获公开 GitHub 403，使授权脚本位置、Python 安装栈位置、公开 URL 和通用错误回显；后续停止同接口重探，异常改有限类型/HTTP 状态。
2. 早先直接公共搜索结果包含原作者公开文本片段和 LoRA 文件名；后续嵌套工具内存投影 URL/hash/count。不能把公开原作者内容无证升级成用户私图或凭据。
3. collector schema 不符产生未捕获 ValueError，回显准备脚本位置。
4. freeze 脚本 SyntaxError 在脚本内 catch 前发生，回显脚本位置及中性 typed-delta 源码片段。
5. 复杂内联 PowerShell 引号失配的 SyntaxError 回显授权审计目录字符串，后改外部 UTF-8 bootstrap，在 parse 阶段外捕获。
6. 准备时一次读取现有 repo 测试源码，显示合成夹具图与中性合成 LoRA 文件名；未再以测试源码全文获取输入。

此外过宽的文档/安全结构读取曾被工具截断；看不到的截断部分不能一概洗成安全。已知事件未显示用户私图或凭据，但这不是对未知内容的无泄漏证明。产品执行输出则通过固定白名单，raw/private result 不直接回显。后续少量命令的引号/通配符错误仅输出通用字段/命令诊断，没有扩大网络或产品执行；未把这些失败隐藏为成功检查。

首版报告、机器结果、过程事件与输入/代码身份由 `initial-seal.json` 封存；首版不再修改。等待 root 开放同轮事实后，交叉核验另写文件，保留此版结论和全部原分母。
