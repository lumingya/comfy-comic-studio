# R6 blind 同轮交叉核验

交叉授权 SHA：`c57861556e6e7214ca75902cea363c4c9620edbd3ae3d0c4ae830de7fc8561d6`。先核授权，再核验其中开放的 65 个文件身份；实际字节长度/哈希全部匹配。只读四份 peer 报告及允许的 safe 机器事实，没有读取 peer private 原图、oracle、完整产品 bodies 或私有结果。没有 Mio import、产品/测试/build/浏览器/网络调用，也没有新增 agent。首版 29 件封存不变。

交叉后的 blind 最终判断仍为 **VERIFIED PASS**，0 Medium+、2 Low；原 16 项完整合同 false、14 typed false、2 个候选角色对 false 均保留。没有用 peer 的 verdict 替代具体接口检查，也没有替全轮或最终交付签字。

## 所读 peer 的精确身份

| 角色 | 首版报告 SHA256 | 本次相关 safe 事实 |
|---|---|---|
| generality | `d49bc1a837c3ce75b480038b8b3065ca6fce795519abdd835e16ab75df936dcc` | bounded-questions `4c9ae2b89b656947c46cc083ec8703631dbc4ab6fe375022969a8aa3702adbeb` |
| compile | `b5ea489e8e0aff3e3939fffb220b7ab1274e56fddaaeb422cae95ff74de74ca6` | consolidated `2a2fc0573086eb9ecb633c3f9af3e4322f723368db96347a3c59d85554b145c9`；main results `636c8e6d7ad50ffcca48217336927f3d578e45ab3474ab63fb2fa46b0ec8d075`；supplement results `51f037774c6ece0b93e165a4e7ad15e7bb348e4d876f1be55309401e61a1cd99`；historical-four-safe `ddf3d76d84412541227d81317650008d697384509b7d03dcc4d36fdca92470eb` |
| web | `cc4c156e13710d56214965dfba46842ec8bd883a947374c8bfdbe15ad36d161e` | roundtrip `618e02b6a790d1029ebe05b3255afca8fc76aa9d2884b807e19bbd7fae59e48a`；comparisons-safe `9d493fcdab0719b5fdc89b32bd2a2e14c2d707c1c3b57f7cf763a21f22b093d8`；candidate-result `9d64d21744c718c723f70b7b18fdbb01b9c6f682f9b5a3a3772992f40bff49a9` |
| privacy | `628d71af896e5dcebb3988b57c64b2170e13802d8d201ea890753697c80102cb` | machinechecks `ddcd74dc06bb8198b6a96f2727b96a4bcb43cd16c58bdb463a99417f4e7fe133`；ledger `197ceedd4d521d095892432903d32a1e476c587fa8312728925a80adae00584e` |

全部 65 项身份明细在 `cross-verified-inputs.json`。没有把这个数说成 root 已核的全部 196 件；65 只是本次开放白名单。

## 真实接管界面与自己的自动/提示缺口

自己的 13 个 automatic no-op 仍是 13 个不符合冻结 automatic 预期的请求。产品各自明确警告值未绑定/不会生效；它不等于自动满足请求，也不替用户选好了正确阶段。76 个 backend 显式精确请求只证明选定写点可写，不证明 UI 可见性或提示完整。

我独立复查 `WorkflowMappings.tsx:90-138`：通用字段列表由全部非 link 输入构建，不依赖 candidate 是否带某个 role；`:153-178` 支持自定义 key，`:224-230` 以通用字段作为非 output/inspect 角色的可选目标。`WorkflowInspection.tsx:224-235` 展示实际 candidate.kind；`:122-145` 仅格式化目标。`WorkflowMappings.tsx:145-151,204-218` 的采纳仅消费 heuristic，不把 candidate 偷换成自动 binding。后端 `inspection.py:180-204` 明确给未绑定/多候选提示。

Web 的实际 safe 记录独立支持这条交互：四格 PNG 分别把 prompt、negative、init、control、mask 的自定义 key/通用字段保存并导出，candidate_manual_exact=4/4；API 大图对应通用手选 4/4；保存至详情的 graph strict 12/12，导出与已保存 graph/config 12/12。`cross-facts.json` 留下 28 个安全 mapping 记录的真实 role→pointer 投影，不只引用报告 PASS。Web 没有对自己的真实盲样操作，因此这里只对通用界面接缝作交叉支持，不将合成 fixture 的角色提示移植成 own-04 已显示 init。

于是 BL-L1 保留为真实自动覆盖不足，BL-L2 也保留：own-04 的普通 detailer image 口没有 init 提示，用户仍需自行理解用途并添加 key；有通用接管路径不等于提示完整。当前证据没有显示不可手选、保存丢 mapping、错误自动改写或别的足以升级 Medium 的实际阻塞。

## 端口感知与 node-only mask oracle

我重新对照自己的 safe 结构记录和 `inspection_candidates.py:205-335`，没有改候选 oracle：own-04 `/1/inputs/image` 进入 `/32/inputs/image`；图像输出消费 `/32` slot0，mask 操作消费同节点 slot3；下一 detailer 的 image 消费 slot0、detailer_pipe 消费 slot4，后续 mask 又消费 slot3。自己的 oracle 只按 node 级到达，把进入同节点与来自不同输出槽的 payload 混在一起，故不能独立证明原始图片应该获得 mask role。

产品 `_ImageRoles.dependencies` 以 `(node, slot, kind)` 作为 marker，`:261-283` 对未知辅助输出没有 payload 证明就停止；`:286-318` 传播的是只读用途 bit，没有因此获得可改写恒等语义。`workflow_graph.py:23-259` 与 `binding_scope.py:68-142` 的端口边界也与 generality 所列实际源码机制一致。这解释了 mask 的原 false 有 oracle 局限，不是把缺失结果删掉。init 的提示缺口则是另一个事实，不被 mask 归因抵消。

已依 root 指示把 safe schema、精确字段/槽位指针发送 generality，未传原图、作者值或私 oracle；该协作发生在正式 cross 授权之后。

## global-base 选择与区域文本

own-17 的 base pipe `/64:63` 通过 model/positive/negative 接 checkpoint 与 `/64:61`、`/64:62`；四个 local pipe edit 通过 basic_pipe/positive 引入各自区域文本，再进入 regional providers。`binding_inference.py:285-316` 在没有识别到 sampling sites 时以 model+positive/conditioning 找 owner，故全局 base owner 与仅含 basic_pipe 的 local edit 不等价。实际 conservative 请求只改 `/64:61/inputs/text`，四条局部文本源均未改；完整 delta/闭包/源保持仍在首版结果。

自己的冻结 oracle 是“所有不同文本均竞争”的更强保守预期，仍记 typed false。源码及具体接口未证明产品误改区域 prompt；也没有由此推断任意 regional 插件都可自动安全执行。这个判断与 peer 的 stage/canvas 与执行闭包分离机制相容，不依赖其 verdict。

## compile29、旧 4 false、138 各自保持

本次对 compile safe 事实重新按 case_id 连接 main 与 supplement 的实际 case，而非只读汇总：29 个新手选条目均有相等的 expected/actual target，29 个 binding delta 恰好单字段；实际 compile、typed binding、typed full graph、expected/actual typed graph hash、输出/闭包、源图/文档/文件、存活连接各重新计数为 29。main 原 69/70 和初始 23 selected/6 unproved 保留；独立 supplement 15/15，其中新补合法模式选点是 6，另外 1 corrected caller input 与 4+4 old-four 请求不计成新增 manual29 样本。

旧 230 仍是 46 API×5，160 automatic +29 unmapped manual-required +41 absent，旧显式手选为 0。old-four-safe 中四条实际 target 均空，原 expected target 非空、compile 成功；它们来自同一个源身份，旧四 false 未改成 pass。新 exact-source 的四次保守保持和四次 explicit 写入是新分母，能够解释/接管，不清除旧 truth false。

私有 138 的 missing frontend state、历史完整 compile=false、43 LoRA、无显式标签，以及独立历史 29 tag/mapping 回归保持不同边界。compile 的机器结果明确 new_private_full_compile_tested=false；本人没有读该私图或取 state，也不给它新的完整 compile 通过。关于 6 个 wildcard 模式点，接管合法性采用 compile 已冻结的官方源合同推导及其来源 SHA；本次没有重新联网取得插件、执行插件或认证本机安装版本。

## privacy、freshness 与请求账本

privacy 的 safe 事实支持历史缺失 25、当前补充 25、原 75/current75/230 的边界和原 29 manual-required 显式 0，且 53 需求行都保留非最终验收标记。它首版前未见本人的新样本，所以不能冒称 privacy 已独立重算本 13 份 freshness。

本人的 11 层计算、raw/canonical 对弱 prefix 的处理及全部候选身份保留仍以首版输入为准；缺 25 原件无法重算、35 Civitai 仅 10 fullcanonical 语义支持、旧 75 prefix 算法未知均不消除。新增 `selected-provenance-safe.json` 固定 13 来源的完整 raw/API/UI canonical/WL/source family hash；`candidate-provenance-safe.json` 保留 62 个候选的 disposition、可用层 hash/hit 身份及 54 个只发现位置记录；两者不含本地路径、作者值或 graph。原件不动。

本体 93 HTTP 与助手 23 HTTP+1 search=24 是分别保留的实际调用账本；本体公共搜索为 7 calls/22 queries。旧 API403 相关 9 请求与后续 raw 取样分开；来源交叠不洗成唯一来源数。Web 的早段仅计 API response、后段才有全 own-origin 请求 instrumentation，也不能替本采集账本补“全网络总数”；不同请求/响应分母不相加制造通过率。`acquisition-accounting-safe.json` 明确保存口径和未知交叠边界。

## 过程与最终交付边界

本人首版 6 类回显事件原样保留。另已核 root process/v1/v2/v3 允许记录的精确 hash 与事件结构；这些记录承认过程错误，v3 明确 unknown_truncated_output_cleared=false。本次不能作 clean-process 或“未见即无泄漏”背书。privacy 的 process_clean_pass=false 与此不冲突。

交叉期间有三项纯文件投影/封存假设错误：一次把只有 supplemental 记录才有的 uploads_exact 也作为全部 text manual case 必有键，一次把 disposition 枚举拼成非原记录用词，另一次本地 drive 检查正则过宽而命中公开 HTTPS URL。外层 bootstrap 只返回有限 KeyError/AssertionError；检查实际 schema 和匹配计数后局部修正。正则失败时白名单/seal 尚未写入，实际 drive/UNC/私有 Unix 根路径匹配均为 0。未触发产品、网络或原件写，未重写任何原数据/判据。这些不是产品失败，也不隐藏为初次投影通过。

原工作区 HEAD/untracked 变化的归属仍未证，privacy 对 65 data hash/64 skip 标记的保持不能升级成“原工作区完全未变”。root 最终中文出版、清理、提交推送、最终源码身份与最后 CI 对应关系尚 pending，本人不预签。所有原 false、Low 与未测继续带入 `final.md`，本职责没有新增 in-scope Medium+。
