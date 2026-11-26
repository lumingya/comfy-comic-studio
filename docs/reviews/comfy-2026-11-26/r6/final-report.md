# ComfyUI 静态工作流兼容性升级：中文对比报告

冻结源码`fe914065c7aafb0672bfe10274361f83179ce7f1`已取得R6连续整轮五名全新职责审查员的交叉终审 **5/5 VERIFIED PASS**，没有确认的Blocker、High或Medium。总控已重新核对196件首版证据及57件终版payload，218个运行时模块和407个server Python文件聚合身份精确不变，轮次结束时任务工作树干净。这个结论验收的是下文明确的静态解析、保守自动推断、合法人工接管、编译保真及前端合同，不能翻译成“所有野生工作流均能自动运行”。

本文记录已完成的技术验收及其证据边界。实际证据出版检查、缓存清理、提交推送、工作树状态和最终交付提交的远程门禁，以[收尾回执](delivery-receipt.md)及 [PR #1 正文中的提交后回执](https://github.com/lumingya/comfy-comic-studio/pull/1)为准；这些事件不能由冻结源码的五票代替。原 Civitai 缓存丢失、部分历史身份／高赞策展缺证和完整私有 138 执行 state 缺失仍独立保留。

本文、[53 项证据账本](requirement-evidence-ledger.json)和[分类计算](classification-calculations.json)的出版操作仅汇编已有安全证据，未额外运行产品、测试、浏览器、网络或构建。[整轮回执](protocol/root-round-acceptance.json)的**封存原件** SHA256 为 `3ccc62958d27a854b83c38403e0a55baa0047ae9ce59d55e1417248dee46382f`；原件与规范化发布副本的字节关系见[155 项证据发布映射](publication-source-map.json)，本报告等七件文档的关系见[交付文档来源映射](delivery-source-provenance.json)。账本中的 `external-temp-evidence/` 字符串是历史封存源身份；只有另列的 `published_pointer` 表示现存发布副本，未解析的历史源不冒充现存文件。

## 样本与比较分母

| 集合 | 构成 | 可以证明什么 | 不能替代什么 |
|---|---|---|---|
| 原Wave0历史75 | 35行Civitai、40社区；历史21API/54UI，65JSON/9PNG/1WebP | 原狩猎和基线记录存在 | 原25缺失图的现存字节、完整原始SHA及采集时高赞排序 |
| 当前固定75 | 50恢复位置+25预选公开API补充；46API/29UI，40JSON/34PNG/1WebP | 同一当前队列before/after、文件及230请求身份可比 | 原Wave0全部75原件再回放 |
| R6新盲测13 | 6API/7UI；8PNG/5JSON；独立新来源/身份/真值冻结 | 新真实图的导入、探测、有限LoRA操作、typed编译、诊断和UI引导 | 全部生态、120+巨图、真实长LoRA栈或WebP新盲测 |
| 本次补充的大UI结构 | 固定current75既存1份；262节点、512有效边、4个LATENT采样payload阶段；另有7个switch名称候选、5scale、5detail/repair、2saved outputs+1preview | 真实大型多采样、放大细化及多输出结构；switch名称与静态路由分开 | UI可compile、switch payload恒等语义、活动selector值或所有路径的完整功能意图 |

大UI原raw SHA256为`18c785f8f9c8844644ecf782c5b28a8b10d449b304821380248005faf80d9724`。有20个mode4与242个mode0节点；4个采样payload节点均有LATENT输出及LATENT/CONDITIONING输入，存在6个采样阶段间有向可达对。另7个switch名称候选有28条相邻边，但其payload/活动selector语义没有据此证明。初版按sampler名称得到7个成员，端口复核将其精确拆为4个采样payload阶段与3个控制/非payload节点，初版保留而不覆盖。纯stdlib解析未访问widget字段值，没有输出作者提示词、资产名或原图，没有提交Mio。修正[安全结构摘要 v2](giant-structure-safe-v2.json)，SHA256 `2dd10a6ceaa2908cd855d2361194803c70f4d759159dc077a4af8f48f4862295`；[初版结构摘要](giant-structure-safe.json) SHA 仍为 `5fd95919127dc595886f0a99b87d277f720f28bd7bba48558b6a45bcf8d75d12`。这使T10的真实大图/多阶段结构覆盖可落到原件，仍不把结构-only提升为执行证明。

### 当前75的同批改前→改后

改前`aa06d0a`与实际`ed45509`、候选`fe91406`保持同75顺序/完整源SHA及230个source/kind/mode/expected-target身份。230=46API×正词、负词、seed、width、height五项；比较器是Python整图值相等，**不是完整严格类型delta**。

| 原固定真值类别 | 改前 | 改后ed及fe同批重放 | 解释 |
|---|---:|---:|---|
| automatic | 138/160 | 156/160 | 4个原false仍保留 |
| manual_required | 27/29 | 29/29 | 没配置mapping时保守保持原值的正确性；原显式手选操作数0 |
| absent | 41/41 | 41/41 | 原图没有合法目标时不误绑 |
| 全部原请求 | 206/230 | 226/230 | 不改原oracle；不能写230/230或自动160/160 |

29项manual_required为18prompt/11negative，expected_targets为空，不能说已执行29次人工映射。**R6另外独立执行29/29真实单字段手选**，均实际写入、完整严格typed图/输出闭包精确、原图/文档/文件不变；该补充不加入或改写原230。

46API走已有import/get、inspect、loras、compile、diagnose五段core；29UI进行decode、inspection及清晰导出API指导。纯UI没有API执行分母，不把进程内调用包装成HTTP/ComfyUI实例运行。原任务明确允许UI-only结构概览与导出API步骤，也允许静态无法确定时说明原因并人工接管。

当前同队列重放的完整身份及结果见[75 份样本重放报告](evidence/core-and-ci/current75/report.md)和[机器结果](evidence/core-and-ci/current75/summary.json)；独立 29 次真实手选见[编译终审](audits/compile/final.md)。

### 按公开架构和生态分类

下表是已存**aa06→ed**分类，绝不移植为fe逐组重新执行。家族名是结构提示；`SD3`提示不自动证明SD3.5全部变体，`modern_other`不自动对应每一个其他列名家族。分组可重叠、不可求和；没有API分母记“未测”，不写0%或100%。完整定义和各kind/mode见分类JSON。

| 架构结构提示 | 样本API/UI | automatic改前→改后 | 五字段整图值比较改前→改后 |
|---|---:|---:|---:|
| flux | 9/6 | 17/26 -> 22/26 | 36/45 -> 41/45 |
| sd3 | 8/3 | 18/25 -> 21/25 | 33/40 -> 36/40 |
| sdxl | 4/2 | 5/8 -> 8/8 | 17/20 -> 20/20 |
| modern_other | 0/3 | 未测（无 API 分母） | 未测（无 API 分母） |

| 插件/结构生态 | 样本API/UI | automatic改前→改后 | 五字段整图值比较改前→改后 |
|---|---:|---:|---:|
| comfyroll | 0/5 | 未测（无 API 分母） | 未测（无 API 分母） |
| control | 8/9 | 23/27 -> 27/27 | 34/40 -> 40/40 |
| easy_use | 0/1 | 未测（无 API 分母） | 未测（无 API 分母） |
| efficiency | 0/3 | 未测（无 API 分母） | 未测（无 API 分母） |
| impact | 6/5 | 20/22 -> 22/22 | 28/30 -> 30/30 |
| inpaint | 8/1 | 20/20 -> 20/20 | 40/40 -> 40/40 |
| inspire | 1/2 | 4/4 -> 4/4 | 5/5 -> 5/5 |
| lora | 2/6 | 6/6 -> 6/6 | 10/10 -> 10/10 |
| regional | 0/3 | 未测（无 API 分母） | 未测（无 API 分母） |
| rgthree | 0/5 | 未测（无 API 分母） | 未测（无 API 分母） |
| routing | 0/11 | 未测（无 API 分母） | 未测（无 API 分母） |
| tinyterra | 0/1 | 未测（无 API 分母） | 未测（无 API 分母） |
| wireless | 0/2 | 未测（无 API 分母） | 未测（无 API 分母） |

这些分类不替代Steps、CFG、Sampler、Reference、LoRA、Output的独立证据；230五字段不包括它们。十类真实结构／保存请求与具体中性回归的索引另见[具体回归方法索引](acceptance-gap-analysis.json#test_index)及[缺口拆分与最终跟进](acceptance-gap-analysis.md)，40个具体方法引用、8个Python模块及1个Web文件均与fe Git字节精确一致。来源中旧“typed”字段名不覆盖当前230比较器的实际限制。

## 已完成的通用能力

- **按端口的图语义与安全路由。** Reroute、多级Primitive、可信Pipe/Context契约、静态selector与实际失活消费者路径有界穿透；无效端口、环、动态selector、未知辅助输出和未知变换不被猜成恒等来源。无法静态证明的无线/嵌套子图说明原因并引导导出API或接入state/adapter，不伪造浏览器状态。
- **阶段、条件与文本归属。** 现代guider/noise/custom sampler链、多段文本、区域/拼接、主阶段与后续refiner/参考分支分别推断。多源歧义不强行统一覆写；可用合法term/阶段人工绑定。空串/空白、同类正负字段别名和上游文本payload可成为候选。
- **结构化LoRA读写。** chain、flat、nested、model-only、可选CLIP、负权重、重复名稳定键、禁用条目原生权重及未改字段数值字符串分别保持。修改按实际字段delta写入，不把未知节点名做成大型白名单；新增/开关不捕获旧分支或挪动邻项。
- **统一文件入口和人话指导。** JSON/PNG/WebP归一化、有界metadata解析、畸形和非有限数值拒绝。内嵌API prompt可导入；纯UI给结构概览、子图/隐式连线/失活提醒及API导出步骤，而不是含混“JSON无效”。
- **图片用途与输出范围。** 候选沿多跳image/mask payload传播，保留独立源并排除scalar/control依赖；候选不会悄悄变成自动绑定。最终保存、多分支输出及同支预览按来源和闭包处理。未知custom sink协议明确接管。
- **可编辑界面与目录。** 大图搜索/手动映射、30+LoRA长列表、长标题布局、四格亮暗主题和键盘焦点均有真实Chrome检查。界面可展示候选用途并手动覆盖；没有单独的“一键采纳候选”动作，不能把core候选列表冒称该动作已实现。原文“或手动覆盖”的可用路径已验证。

十类永久中性回归包括现代采样链、阶段保护、同型总线端口、动态selector与mode、复杂LoRA、区域/字符串、图片用途、PNG/WebP/UI/畸形输入、多终图/预览及200节点大图。新增candidate模块8方法覆盖空白/配对别名、多跳用途、显式手选、scalar排除、无效端口、selector辅助输出和环。具体方法存在及全suite门禁的source关联可证明回归覆盖，quiet CI日志不伪装逐方法运行日志。

目录性能是旧实测`ed45509`快照，单核BelowNormal、临时导入移除及原49摘要恢复；没有同库改前性能基线，不能声称普遍提速，也不是fe重新计时：

| 测量 | HTTP | 毫秒 | 行数 |
|---|---:|---:|---:|
| cold_catalog | 200 | 2516.515 | 49 |
| warm_catalog | 200 | 126.084 | 49 |
| import_one_distinct_200_node_graph | 201 | 445.527 | - |
| refresh_after_one_distinct_import | 200 | 639.258 | 50 |

## 新一轮真实盲测与编译保真

R6 blind共184次实际调用，含13decode、13inspect、13import、6loras、133compile、6diagnose。6API import完整保真；7UI import预期拒绝且inspect给ui_format/ui_overview导出指导，不把UI计为compile成功。133compile中125成功返回、8预期拒绝；成功中typed整图精确111/125、连warning完整合同109/125，125/125输出集合与独立祖先闭包精确。98次实际有写入、27次保持原图；133/133原图/原文档、13/13源raw不变。

不能把125成功返回说成125个完整合同均过：14项typed原false、2项warning-only原false、2/17候选角色对原缺失都保留。自动32请求中19精确、13保守no-op带明确未绑定/忽略/配置指引；76显式manual请求均typed精确且实际写入；其余3项歧义请求中2精确、1个全局base写点存在oracle范围限制。唯一active真实model-only LoRA的负值/禁用两次图精确，额外写入通知是原warning期待遗漏，不回写原结果。

R6 compile主冻结运行**69/70**原样保留：一项审计caller传五个裸字符串却期待asset字典，是冻结输入/oracle不匹配。另行冻结的合法asset请求与其他补充共**15/15**，不改写成70/70。新29手选由23首轮+6经固定公开wildcard协议证明所有权后实际补齐，29/29完整typed编译。11个中性LoRA场景最大33项，和真实样本操作分母分开。旧四false的fresh4自动保守+4显式typed精确只解释当前合同，不改变原230。

盲测的原始冻结判定、保守 no-op、候选角色限制与独立交叉解释见[盲测终审](audits/blind/final.md)；69/70 及补充 15/15 的分母见[编译终审](audits/compile/final.md)。

## 五路终审、关闭项与保留Low

| R6角色 | 最终结论 | 首版证据数 | 终版payload数 |
|---|---|---:|---:|
| [generality](audits/generality/final.md) | VERIFIED PASS | 8 | 11 |
| [compile](audits/compile/final.md) | VERIFIED PASS | 35 | 13 |
| [blind](audits/blind/final.md) | VERIFIED PASS | 29 | 14 |
| [web](audits/web/final.md) | VERIFIED PASS | 112 | 12 |
| [privacy](audits/privacy/final.md) | VERIFIED PASS | 12 | 7 |
| 合计 | 连续完整一轮5票 | 196 | 57 |

[R5 首轮及 cross 的 REQUEST CHANGES](../r5/index.md)没有删除；历史问题及中性回归的归属见[根因关闭清单](issues-closed.md)。两个Medium在fe候选上的关闭机制是：**M1**将空串/空白、配对正负别名、可追溯文本源加入人工候选；**M2**将resize/preprocess多跳image/mask用途传播到原始独立图源，并排除scalar/control依赖。对应中性方法、既有carry-forward实际检查、新独立首版与cross终审共同支持关闭，不靠显式mapping精确来掩盖原候选缺陷。

历史通用问题的修复仍保留在原台账：端口误穿透与条件归属、共享负词/后续阶段保护、Switch旧分支捕获、LoRA新增与禁用邻项、空object metadata、stale计划、稳定键、畸形metadata/nonfinite保真，以及缓存与长标题布局。初始失败、修复和中性回归按原实际HEAD留档，不重写成从未失败。

最终去重后只有3个保留Low，而非把各角色重复观察相加：

| ID | 保留事实 | 可用路径与边界 |
|---|---|---|
| BL-L1 | 13个原automatic请求保守no-op，仍是冻结false | 明确提示未绑定/忽略值/显式配置；manual精确不等于自动识别成功 |
| BL-L2 | 直接detailer普通image口的init用途候选提示不足；原init/mask两对缺失保留 | ref候选和显式init mapping可用；mask原oracle忽略输出槽的限制独立披露，未证明全UI无法恢复 |
| W-01 | browser存取/导出中整数值float→int表示归一 | 原raw112/136、24 strict-hash失败保留；后端typed与wire JSON表示区分，不抹原失败 |

Web四格实际完成252动作、30张本人查看截图：原237/28，焦点小补9/1，候选展示小补6/1。原16预检查、12save-GET-export、4UI取消分母不变；补拍只读inspect-file增加一次，不回写原candidate缺失/粗Tab断言。历史total-network没有全程证据，不能宣布全程零出站。

完整 Chrome 合同与保留的表示差异见[Web 终审](audits/web/final.md)，进程与输出事件见[协议及过程回执索引](protocol/index.md)。

## 门禁、历史失败与隐私边界

冻结fe的push `45779838148`和PR `45779847204`六job、70step全部成功；14项必需命令覆盖、44全部脚本组与76实际命令不能混为一个分母。push实际checkout为fe；PR实际为`c59eaf873ce98d0940a08ee70c0a1991475e5139`，父顺序为`6ed78255bca6487ce874946118f26a26ec22c3dc`、fe。后端push/PR分别1831/1977测试，前端965/1100；这是main合并内容不同造成的执行范围差异，不取较大数冒称候选单独覆盖。成功quiet日志没有TLS单项耗时，TLS证据限源断言、suite发现与skip核对推论。

冻结候选的命令、checkout 与跨平台证据见[候选 CI 报告](evidence/core-and-ci/ci/report.md)及[机器回执](evidence/core-and-ci/ci/ci-verified.json)。最终交付提交的 CI 另按收尾回执核验，不把 fe 的绿灯当作未来提交已通过。

历史失败没有被这次绿灯替换：ed后实际PR merge曾因Modal同名类型重复失败，8d修复；8d PR Windows出现deadline边界误分类；6e过宽TimeoutException修复造成两条既有预算重试/sent合同回归，局部3方法50mock通过不足以证明正确；fa按原ownership收窄后六job绿。它们的原执行HEAD与后端217模块语料/性能证据不被改记成fe的218模块实测。

隐私终审实际检查224个候选Git blob的6类模式，71历史出版文件/62源行与Git字节/投影关系匹配，69相对链接可解；这不是“任何文本永不识别个人”的证明。过程不是零回显：R5三事件及未知截断范围、R6职责和root过程事件都保留，`process_clean_pass=false`。已知中性UUID/操作路径输出不等于原图/凭据泄露，未知范围也不能据此被清白签字或反向断言已泄露。没有为补证读取Cookie/Profile/用户state。

[隐私终审](audits/privacy/final.md)保留上述扫描范围及过程披露。出版收尾新增的有限输出事件另见[交付过程记录](protocol/root-delivery-process-events.json)；其已知文件名／路径投影不被重复发布，也不据此签零回显。两个工作区已记录的65份data原hash、64个skip-worktree标记及staged/unstaged digest均匹配。但原工作区HEAD前进3个descendant commits、untracked数5→1，因此不能称原工作区整体未变，也不能无证归因本任务；不读未知untracked内容、不重置用户工作。

最新[工作区保护回执](protocol/protected-workspaces-delivery.json)继续支持这两组 data／标记及原工作区 staged／unstaged 摘要的有限事实；[任务进程清理回执](protocol/owned-process-cleanup.json)记录仅关闭已验证所有权的隔离预览和 headless Chrome、两个任务端口已无 listener。[缓存清理回执](protocol/cache-cleanup.json)已核实任务缓存目录删除后不存在；进程关闭与缓存清理分别保留独立证据。

## 适配与历史证据限制

1. **动态/未知插件。** 无可信route/执行state协议时不猜恒等变换或浏览器连线；给原因、人工写点/导出API或adapter入口。这是原任务允许的合同，不称自动全兼容。真实生态覆盖不足仍明示，不能仅凭通用算法宣称所有列名变体已测。
2. **原Civitai35与缺失25。** 历史35行只有10行fullcanonical支撑其12prefix语义，另外25逐行算法/完整原始身份未证。今日32/34唯一来源、33/35历史行元数据及一份新UI结构，不恢复旧字节/采集时高赞排序，不替换current75。若以后补当前可复核策展集合，另立来源/当日排序/完整SHA与分母，不追认旧25。
3. **私有138。** 旧6f9与实测ed均因_frontend_plan缺state compile=false，不是新增完整compile回归。43LoRA/tag0/map0不能验证已有标签；width/height/batch自动撤回是实际保守变化，不能被同失败掩盖。历史width/height手选仅绑定阶段精确，不证明有效最终尺寸或batch完整compile。历史29标签测试、新29真实文本手选均与私图分开；未抓取或伪造私人frontend state。
4. **原请求失败保留。** R1 66/70、R2原真值104/130与固定编译122/138、R4blind36/47、R4compile C01–C14为14/14各自独立。14例不是14项numeric专用；其中两例涉及numeric-string，15个numeric方法与受影响72方法有重叠不相加。R2四个manual-mode false目标集合实际一致，属于原策略差异，不改通过，也不统称危险误绑。R4合法单键asset的init/ref三例自动失败无Compiled，warnings/delta为NULL；已有combined手选不替代隔离复测。
5. **未做真实运行。** 没有模型下载、GPU画质、用户LoRA、未知插件执行、ComfyUI提交或真实依赖安装正确性认证。空object_info只支持结构/诊断健壮性，不能证明已安装节点/模型正确。全阶段静态compile仍不等于全部作者意图、每张参考图角色或所有自定义输出协议被认证。

## 实际交付回执与验收条件

[收尾回执](delivery-receipt.md)记录实际安全出版检查、精确所有权清理和保护事实；[PR #1 正文](https://github.com/lumingya/comfy-comic-studio/pull/1)记录提交后才可取得的最终提交 SHA、push、远端 HEAD、任务工作树状态及最终远程 CI。**交付提交**指包含本回执和本文的提交；不用再为记录该提交自身的 CI 额外制造一次提交。

53 项账本将已证技术合同、历史不可重建限制与实际交付条件分列。以下事件只按实际回执验收：

- 安全证据的实际 Git blob、源／发布 SHA 关系、相对链接及中文文字均核对。
- 只按精确所有权删除本任务野生 JSON／PNG／WebP 与临时脚本缓存，并实查任务缓存不存在、任务专用预览／浏览器已关闭；保护两处工作区既有数据与标记。
- 具体文件提交并推送，远端 HEAD 匹配、任务工作树干净；原工作区的并发前进和 untracked 数变化按前述有限事实披露。
- 最终交付提交与 fe 已审产品源码身份一致，最终 push 和 PR 的必要远程门禁实际成功，PR 实际 checkout 及父提交顺序可核对。

本文内容形成时尚未把这些提交后事件当作既成事实，`whole_objective_complete=false` 是文档快照状态。最终整体验收须联合上述后置回执逐项判断；历史缺失、允许的 UI 概览／人工接管及原始 false 不因交付完成而消失。
