# R6 Web 同轮交叉核验

候选 `38838ab43cf3d056951f2fc6c52afb737d34e3c6..fe914065c7aafb0672bfe10274361f83179ce7f1`，UTC `2026-11-26T10:45:36.150265+00:00`。本文件在五份首版全部封存、root 明确开放 cross 后创建。授权 SHA `c57861556e6e7214ca75902cea363c4c9620edbd3ae3d0c4ae830de7fc8561d6` 已核对。只读取授权列出的另外四份报告及 safe 机器事实；没有读取他人的私有原图、oracle、完整产品结果或原截图，没有新增产品、浏览器、网络、测试、build 或仓库写入。全部 40 个 peer 允许文件与 6 个 root 额外文件均逐项 SHA/字节身份吻合。

## 独立结论

**VERIFIED PASS（冻结 fe 候选的 Web 职责终签）。Blocker 0 / High 0 / Medium 0 / Low 3。** 结论基于本人四格 UI 原证据、可核对的 peer 事实和下列源码机制，不继承同伴 verdict。三个 Low 是不同根因：自动覆盖回退、detailer 的 init 候选提示遗漏、浏览器整数值浮点的表示损失。没有发现可确认的原任务范围内 Medium 以上缺陷。以下证据限制和原 false 均保留，不作为条件通过或被改写成成功。

## 1. Detailer 图片候选：漏 init 提示成立，mask 不能混算

blind 的候选机器事实是 9 个来源、17 个预期角色配对，15 个出现、2 个缺失；第一来源的 `/1/inputs/image` 实际只有 ref，而原 oracle 期待 init、mask、ref。结构投影证明该源进入 `/32/inputs/image`；后续 mask 消费的是 `/32` 的输出 3，另有输出 4 的 detailer pipe。输入图片与节点生成的辅助 mask 并非同一条已证明恒等的端口。因此保留原两项 false，但其中 mask 的原 oracle 把节点级上游可达当成端口身份，不能据此确认同等的产品漏提示。

init 缺提示则是可确认的候选发现性缺口。`inspection_candidates.py:286-304` 只从 `pixels/init_image/initial_image` 等名字种下 init 角色，通用第三方 `image` 输入没有该提示。它确实增加人工识别成本，不能因后端 76 次手选 typed exact 或 compile29 成功而称候选完整。

本人独立核 UI 的实际影响：`WorkflowInspection.tsx:225-232` 原样展示所有已返回候选，没有按 CORE 隐藏 image role；`WorkflowMappings.tsx:89-129,169-173,330-345` 的字段列表保留现存的非连接字段，自定义语义 key 可以建立 init 行，再选该图片字段；CORE 无默认 init 行，用户必须知道要输入 `init`。本人原四格确实通过这条通用 key/字段路径设置 init/control/mask 并保存、GET、导出精确，但没有把这称为在真实 blind detailer 图上重新跑过浏览器。

**WX-01 / Low。** 可见 ref 提示仍给出正确源位置，通用手动路径没有被阻断，也未发生错误自动写入或数据丢失；因此当前证据不足以升为 Medium。缺 init 提示仍是未修复的 Low，并非用手选成功消除。mask 的原配对 false 作为 oracle 限制独立保留。

## 2. 13 次自动 no-op：不能叫自动成功，警告能指向真实接管入口

blind 的自动组 32 次均返回，只有 19 次 typed/target/delta/warning 精确且实际写入；另外 13 次是原自动期望失败和 no-op。对应显式手选成功不能替换此分母。`compile.py:326-345` 对请求的未绑定普通参数逐个说明值被忽略，并要求显式标签、手动 mapping 或可信适配器；图片输入没有绑定则直接拒绝，不做同样的静默忽略。

`inspection.py:160-175` 把实际 compile warnings 放入预检 issues；`WorkflowInspection.tsx:198-207` 显示这些 issue，而不是压掉 warning。`configuration.ts:261-265` 的缺项提示说明沿用工作流原值，并直接指向“调整参数映射”，同时说明不会在多个候选中任选。prompt/negative/width/height 有默认行；batch/denoise 可通过通用语义 key 加行，字段下拉仍可选择实际字段。本人原四格已操作同一通用交互机制，但没有亲眼重放这 13 个真实样本的 warning，也不声称它们在没有请求 values 的导入预检中必然逐条出现。

**WX-02 / Low。** 这是自动覆盖受保守阶段/端口语义限制的剩余覆盖缺口，具有明确的忽略警告和可用的手动接管入口；没有证据表明 UI 把这些值显示成已应用。对新用户，batch/denoise 的自定义 key 仍有额外认知成本。保留 13 个自动 false，不把它们记成 change-bearing 或候选指导通过。

## 3. Strict typed compile29 与浏览器 wire 的不同边界

compile 的机器事实是 29/29 实际选点、29/29 绑定单字段实际写、29/29 完整编译且 strict typed 精确，18 prompt、11 negative；输出闭包、连接及源文档保持均精确。主批 69/70 与单个调用输入错误、后续 15/15 补充也分别保留，原错误未改。此证据在原生 Python 请求/图对象边界内成立，不是浏览器源导入证明。

源码 `compile.py:307` 与 `bindings.py:312-325` 使用深拷贝及绑定值原生写入；没有为了 Web 而把后端 strict 类型比较放宽。浏览器 JSON 文件由 `ConfigurationParts.tsx:145-150` 的 JSON.parse 进入 JavaScript number，图片容器解码的响应也进入 JS；导出 `:153-154` 使用 JSON.stringify。整数值浮点在此边界不能保留原 int/float 表示区别。

**W-01 / Low，原样保留。** 本人源至文档 strict 0/28、源至导出 strict 0/12 与 raw/canonical hash false 仍是 false；数值相同分别 28/28、12/12，重复差异 2024 个均为数值相等 float→int，没有 bool、连接或数值变化。保存后的 wire 图到详情/导出 strict 12/12 只证明已进入 JS 表示之后稳定，不能反推原源类型保真，也不能由后端 typed29 覆盖。两个审查结果不矛盾，不相加制造整体兼容率。

## 4. 泛化端口语义：候选可提示不等于可写路由

本人核对 `workflow_graph.py:178-211`：路由携带输出 slot；未知类型或相同名字不证明恒等，辅助输出不能继承静态 selector 的输出 0 路由，字面写点需要正式 identity。`workflow_slot_graph.py:21-46` 只有所有相关输出都被声明且排除某输入时才全局屏蔽该输入，未知辅助输出不构成排除证明；`:51-80,99-120` 的 model 可达性保留 incoming output index。

这些机制支持 generality 对“类型证据不等于路由身份”的判断，也解释为何 detailer 的生成 mask 不能直接回推到初始图片。候选可以保守提示某用途，绑定/编译则需要更强的可写证据，不能反过来把人工 candidate 当自动恒等适配器。没有发现该接口把未知辅助端口一概冒充可写目标。历史私有 138 缺 frontend state 的完整 compile 未证、旧 current75 的 230 次 Python 值相等及 manual 显式操作 0，均不由本轮 29 次手选或中性 UI 图代替。

## 5. Privacy、分母、CI 与最后交付边界

privacy 的实际 Git blob 范围是 224 文件，71 归档逐个实际 SHA/blob 身份匹配；62 是源清单行，非 62 个唯一公开文件。39 JSON 源行的保留非字符串/结论标量改动为 0，不代表删除私有字段后逐字节相同。53 条 ledger 都有证据与限制且不是最终验收。原缺失 25、弱前缀身份限制、API/UI、自动/手工、真实/合成、历史/当前分母继续分列。

两个工作区各 65 数据文件 hash 和 64 skip 标记保留，staged/unstaged diff hash 保留；原工作区 HEAD 前进 3 个提交、untracked 状态记录有变化，归因没有充分旧内容基线。因此不能写“整个用户工作区完全未变”，也不能无证把变化归于本审计。本人 cross 只读源码并再次核 647 个冻结源码及首版 112 项 hash 全 exact、HEAD 仍 fe、当前审计 worktree 状态 0 项。

远端证据是 push/PR 两次、6 jobs、70 steps、0 step skip、14 必需命令组、32 实际出现、76 实际发出命令行。privacy 的源码/日志/checkout 归属与本人实际使用的 fe artifact ZIP 81 文件身份相互支持，但 privacy 未重验 ZIP 字节，不能替它补造执行。TLS 是 6 个成功 suite 观察加 exact-ref 源码和 Linux 必须跳过的 3 个 decorator 的推断；没有单方法日志或单方法耗时证明。

root 四份过程事件链的新增事件数分别 1/2/2/1，原事件不改；v3 明确 unknown truncated output cleared=false。加上各角色自己披露的过程事件，不签“全程零回显”或“所有未知截断已清白”，也不无证升级为用户私图/凭据泄露。过程证据与产品缺陷分列。

## 原 Web 记录保留与终签边界

原 16 次预览加单列第 17 次候选恢复；主体 234 动作/28 图、同页粗 Tab 3 动作原 false、独立 exact-focus 9 动作/1 图、候选恢复 6 动作/1 图，总 252 动作/30 图亲见。初始 desktop-light 手选前候选缺证仍保留，另行预冻结的十行截图补齐实际可见性；孤立节点 60 的原 12 行 oracle false 未改。原 coarse Tab 未因补充通过而重写。所有 own contexts/连接均在各租约结束后关闭并释放，不再调用产品。

原网络 instrumentation 只数 API responses；主流程 166 API response，145 处停止后后段新增 21 all-own-origin/API21，历史 all-network 总量仍未证。补充 focus 和候选各 47 all-own-origin/API13 分列，不能合并成虚构的全程上限证明。source strict/hash 原 false、最初 selector/异步编排问题和基础设施断流均保留。

本终签只完成冻结 fe 的独立 Web 职责及同轮 cross，不声称另外四人的 final 已签。root 的安全出版、隔离数据/预览清理、中文最终文档/路线图、具体文件提交推送、最后 clean 状态及最终 CI 仍待实际发生后补证；本文件不是全任务完工证明。

## 来源身份

| 角色首版 report | SHA256 |
|---|---|
| generality | `d49bc1a837c3ce75b480038b8b3065ca6fce795519abdd835e16ab75df936dcc` |
| compile | `b5ea489e8e0aff3e3939fffb220b7ab1274e56fddaaeb422cae95ff74de74ca6` |
| blind | `5e1c575aa22fc3d6dcd19d5efffc4f33810ddc64e3447a2b1ca8ccc31ecc21c6` |
| privacy | `628d71af896e5dcebb3988b57c64b2170e13802d8d201ea890753697c80102cb` |

各角色全部允许 safe 文件的逐项 SHA 见 `cross-review-provenance.json`，机器事实的已知 schema 投影见 `cross-review-facts.json`，独立源码定位/647 项身份读回见 `cross-review-source-integrity.json`。原首版 report SHA `cc4c156e13710d56214965dfba46842ec8bd883a947374c8bfdbe15ad36d161e`、results SHA `3b5ff36f4a69d761ad7c0c2f3a7d83a7fac0717b25d14427794394cf36852841`、initial seal SHA `b7b9b3524ea8ed8d8e7d69138a6ea285e1ff8888857cbbeca7e4a12d3b0fc5e4` 全部原样保留。
