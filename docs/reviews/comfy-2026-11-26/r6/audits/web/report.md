# R6 Web 独立首版审查

候选：`38838ab43cf3d056951f2fc6c52afb737d34e3c6..fe914065c7aafb0672bfe10274361f83179ce7f1`。审查者是未参与实现及旧轮的新 Web 角色。首版封存前未读取其他 R6 角色的产物、发现或结论。结论以本人的源码阅读、中性输入、真实已安装 Chrome 与本人逐张查看截图建立，不继承共同 brief 的审查结论。

## 当前结论

**VERIFIED PASS（本 Web 独立职责首版）。Blocker 0 / High 0 / Medium 0 / Low 1。** 四格要求的实际交互与视觉核验完成，两个局部审计缺口通过另行预冻结、独占租约的最小追加补齐；原始缺证和原 false 均未修改。此结论不把原 strict/hash 失败改成通过，也不替代后端 typed compile、其他审查职责或全任务最终交付结论。首版尚未交叉核验。

桌面亮色原流程在手选 prompt 后才成功展开候选，故原截图能证明 negative 20/21 与六行图片用途提示，不能证明手选前的两行 prompt 候选在该格实际展开。另三格在手选前实际展开并查看四行文本角色和六行图片角色。此原始缺口单列保留，随后通过 `r6-web-candidate-003` 对同一冻结 PNG 的一次只读预览补齐，截图十行本人实际看见；没有用源码推断冒作原始视图。

## 身份、资源与边界

- 正式合同、职责、授权 SHA 分别为 `c095091d0fffc89e9a689b7ecb32760a74f2710d66835d25ed730b4dc47714da`、`e58528285495a5008a18a9bb8d51ab4b3e931e1b672bfa01d2fc54facd04c563`、`00b9e61b4cb50cee222cfaf0beeaecf3dc19e3351ed3552e583747f9b8ea14d9`；预冻结 `freeze.json` SHA `59c8e82d29670b417884431b1163563ea9829684de90a08e1fe7f56975a6ed28`，勘误 SHA `48b99140de49ce25dc7d91533f87e678ec9fa521e85e89695bef3b3e6eb7e8da`，原 harness SHA `a2539d9f4dc1f6b022df7e61f5a8c368e01d7ca43e76f45db0c8ef424242002b`，原件未改。
- 实际 Chrome 是已安装的无头 Chrome 158，PID 46124 / CDP 59871；实际 preview PID 48744，唯一 origin `http://127.0.0.1:8797`。每次 DOM/截图先查根 frame 的精确 origin，网络仅准 own origin / data / blob。没有读取既有 tabs、contexts、profile、cookies；每次只建/关自己的 context，未关闭全局 Chrome。
- 执行前独立核监听 owner、命令身份及实际 affinity 1 / priority 16384。主体 Node PID 41436，计数补丁 PID 48508，焦点追加 Node PID 4888。焦点与候选追加进程 guard 实际读回 CPU 与优先级；候选追加 Node PID 36348。所有产品动作在 root 独占租约内。
- 开始与完成均核 218 runtime + 429 web source 文件；最终 647 项原字节 hash 全一致，runtime 聚合仍为 `a00155daa5515501eb3ee117f284c2ae1f8152ac038d7efa7f6208c46b8ad487`。6 个夹具 hash 全一致，Git 状态条目 0。没有仓库编辑、提交或推送。
- 使用 push 45779838148 的 artifact 15098114848：ZIP SHA `d6a13e6d7c10125e2c96e62253bf90309bede137e41847fbb68e630bcee7d1dd`。初始实际根 GET200，index SHA `76e359396b1a4a06ff72e21bef3d48c81c82d75ea1115a09755d546aa8373a3a`；结束离线重核 ZIP、index 和 81 个产物全部一致。没有用旧 fa 页面或 PR merge artifact 替换 fe。
- 远端完整 CI 依正式 root 证据身份，不在本机重跑 suite / Vitest / build / TLS / E2E，不安装浏览器。没有实例连接、模型目录查询、GPU 出图、用户 LoRA 或在线依赖诊断。

## 独立输入及实际分母

所有输入是本人在产品执行前自建并冻结的中性合成夹具，留在外部职责目录。没有将其称为公开真实工作流。

| 输入 | 实际结构与用途 | 四格次数 |
|---|---|---:|
| API JSON | 200 总节点，32 个连入输出闭包的 LoRA；主体闭包 39 节点，其余中性填充/长标题字段用于全图选择器负载；不是 200 个活跃执行节点 | 4 |
| UI-only JSON | 200 节点、199 links、11 inactive；只验证解码概览、人话 API 导出引导与禁止保存，不算 API 可编译成功 | 4 |
| PNG API metadata | 22 节点；空/空白上游文本 20/21，独立两跳图片变换后分流到 init/control/mask；60 是输出闭包外孤立文本节点 | 4 |
| WebP API EXIF | 39 节点，32 个活跃链式 LoRA，合法 TIFF EXIF；编辑第 17 个中性槽位的默认值 | 4 |

主体 16 次真实文件预览（另有单列第17次只读候选恢复预览），12 个导入保存的 API 文档，4 次 UI-only 关闭；LoRA 默认设置另有 4 次 PATCH 保存。12 个文档均经 UI 客户端详情取回并真实下载导出，28 份带图文档响应和 12 个导出分别独立比较，不相加制造兼容率。原始 wire 记录没有请求 method，12 个详情 200 文档与客户端 GET 实现一并支持取回结论；不虚构 method 抓包字段。

## 四格交互与视觉核验

| 格 | 主体动作增量 | 本人查看截图 | 实际覆盖 |
|---|---:|---:|---|
| 1440×900 light | 60 | 8 | JSON/UI/PNG/WebP、推荐采纳、prompt 手选、参数/图像自定义 mapping、LoRA、保存详情导出、Enter/Escape；Tab 原缺证另补；prompt 候选原缺证保留并在 candidate-003 单独补齐 |
| 1440×900 dark | 58 | 6 | 全套同类流程；手选前展开完整存活候选，Tab/Enter/Escape 与焦点回还 |
| 390×844 light | 58 | 7 | 全套同类流程；候选分段滚动、长标题/下拉/弹窗边界、Tab/Enter/Escape |
| 390×844 dark | 58 | 7 | 全套同类流程；真实 dark、候选分段与 LoRA 控件、Tab/Enter/Escape |

28 张主体截图及 2 张独立追加截图共 30 张均由本人实际打开查看，逐张 SHA 与判断见 `visual-review.json`。其中 `dl-long-selector.png` 是异步 inspect 期间脚本过早输入造成的页面选中文本和未开 popover，保留原状；实际长标题覆盖是 `dl-long-selector-actual.png`。`dl-candidates.png` 是未展开状态，不能当角色展示证据。截图存在不等于通过，未将这两张转作不存在的成功证据。

API 格式/识别摘要、依赖未验证提示和 UI-only 三步导出指南可读，UI-only save disabled。大图选择器只挂载最多 60 项，真实搜索能缩到指定节点/字段，Enter 选中后等待 inspect 完成，手选覆盖保持。长标题选项在移动端换行，弹窗在 390×844 下约 x16/y24/w358/h796；已测页面、弹窗与 popover 没有横向溢出，候选和 LoRA 可用纵向滚动。LoRA 筛选及关/负权/clip 数值在浅深移动布局均可读、可操作。没有发现文字遮住保存按钮或无法滚动到控件的产品缺陷。

实际普通操作单次观察：mobile-dark API200 文件预览约 559ms；大字段列表打开并搜索到单项约 374ms。两者含协议/渲染等待，不是后端纯耗时或压力基准，没有循环测量。

## 保存、映射与候选语义

四格 API200 的预写手选三目标均保持：prompt `/3/inputs/text`、steps `/5/inputs/steps`、ref `/200/inputs/image`。推荐采纳保留已有 heuristic 绑定；手选 prompt 可以覆盖采纳值。ref 节点本来不在输出闭包，本项证明 UI 指针选择和保存，不冒称该参考图在生成时起效。

四格 PNG 手选五目标全部精确保存和导出：prompt `/20/inputs/value`，negative `/21/inputs/value`，init `/30/inputs/image`，control `/40/inputs/image`，mask `/50/inputs/image`。没有使用或发明“一键采纳 candidate”按钮；候选是人工用途提示，手选使用通用字段下拉和自定义语义 key。CORE 没有初始 image 行不等于图片角色不可见。原字段为空/空白没有使通用字段选择器不可选，也没有被自动当作可安全执行的未知变换。

原冻结候选预期包含孤立 `/60/inputs/text` 的 prompt/negative 两行，实际未出现。该原 false 保留：每格原期望 12 行，完整存活候选只有 10 行。源码 `inspection.py` 先取编译选定图、再在该图上生成 candidates，60 已被输出闭包剪除；它不是存活图里漏掉空字符串。故不据此报产品缺陷，也不把原 oracle 改成 10 来重算“12/12通过”。20/21 的上下游空/空白正负候选与三条独立图片用途链则属于存活图，后 3 格实际展开了相应 10 行；首格原正向展示缺证通过单独 candidate-003 补齐，原12行预期及孤立60两项 false 仍在。

LoRA 四格保存后都只有一个稳定 group 和一个 keyed item 覆写，对应 `/26/inputs/lora_name`（第 17 个中性项），enabled=false、strength=-0.75、clip=0.125。group/LoRA key 用源码定义和冻结结构独立核对，4/4 精确；其他 config 精确不变。保存后图到详情/导出严格一致 12/12，未将 LoRA 默认设置写回原 graph。

## 保留的原始 false 与证据问题

1. **Low，W-01，浏览器 JSON 数字表示边界。** 源至文档：数值相同 28/28，strict typed 0/28，规范化原图 hash 相同 0/28；源至导出：数值相同 12/12，strict typed 0/12，规范化原图 hash 相同 0/12。2024 个逐响应/导出重复计入的差异全是数值相等 float→int（例如 cfg/denoise 与中性填充整数值浮点），没有 bool→int、连接、字段存在性或数值变化。此为 JS parse/stringify 的 wire 表示损失，不是后端 typed compile 的通过证据；保留原检查 false，不要求或实施后端类型容忍放宽。原始输入字节 hash 6/6 不变。
2. **A-01，历史网络总数未证。** 原 harness 的 requests 实际只计 `/api/` response，不能当全网络 ≤180。在 145 API 响应、197 动作、25 图时停止并披露。root 允许仅后段新增只计数 instrumentation；后段从 checkpoint 起 own-origin 21 / API21 / foreign0（cap60/25），原 API response 总计166。原始日志 152 可读 JSON bodies +14 个 body-unavailable（状态200）；未知原因保留，没有补造这些 body。后段不能追补初段静态资源计数。
3. **A-02，异步 inspect 竞态由审计编排造成。** 首格 prompt 选择后未先等待 aria-busy=false/fieldset enabled，立即填 ref 导致 Ctrl+A 选页面和两次 selector 缺失。停在原状态，root 只授权恢复未完成 ref，不重做已过步骤；之后每次 inspect 引发的 UI 变更显式等待稳定和 enabled。此原失败保留，不归于产品。
4. **A-03，候选 summary 选择器错误。** 精确 text 忽略了 summary 的次提示行，首次展开 helper 计数0。按实际 summary 结构局部修正编排，未发明控件。首格原正向候选缺证保留；后续只追加同一冻结 PNG 的读取预览：1440×900/light，精确四文本+六图十行，`candidate-result.json.pass=true`，本人同一截图看见十行；只读 inspect-file POST 恰1次，不保存、不PATCH、不改mapping。此为单列第17次预览，未修改原16次分母。
5. **A-04，Tab 补充原 false 以及独立追加。** 原首格漏单独 Tab，后3格有原实测。root 允许同 page 无导航切桌面亮色再一次 Tab；记录只比较 tag/role/aria，两个普通按钮无法区分，`tab-supplement.json.pass=false` 原样保留。随后另行冻结并持 `r6-web-focus-002`：新 own fresh context，仅进入本人已保存的 200-node 文档，点击唯一 prompt 组合框、Escape 回到同元素，再 Tab 到唯一 remove-target sibling。before backendNodeId24=预定trigger，after28=预定remove，元素不同/可见/启用、截图焦点环一致，pass=true。9动作、1张本人查看截图、47总请求/API13/foreign0/mutation0，2.318秒；不回写原首格历史或 false。
6. 准备期 concurrency-limit 导致 stream disconnected，发生在产品导航前，作为基础设施中断保留，不列产品失败。离线脚本一度把 slots.groups 列表当字典，立即停止该投影并按既有类型 schema 修正；未触及产品或输入。

## 源码范围与独立判断

审查的是完整 base..fe 的 Web 接口与体验范围，不缩成 fe 新 helper 或两个已知风险。重点核对 `WorkflowsSection` 文件判别/原始 API 优先级/导入原按钮回焦、`WorkflowInspection` 预检/静态与在线诊断边界/UI-only引导/全部 role 展示/映射 pending 保护、`WorkflowMappings` 只允许非连接字段/JSON pointer/显式值优先/仅 heuristic 采纳/键盘回焦、`SearchableSelect` 有限挂载/搜索/Enter/Escape/Tab、LoRA summary/defaults 的可过滤列表与 keyed 配置写入、移动弹窗和长标题 CSS、API 类型及 i18n。对应完整任务的多输出/阶段意图、自动绑定、未知节点和 adapter 语义在 Web 中正确呈现为预检、候选与手选边界；没有发现浏览器自行猜图执行或把 candidate 当自动恒等变换。

关键源码定位：`web/src/pages/settings/WorkflowsSection.tsx:78-129, 259-279, 330-403`；`WorkflowInspection.tsx:105-140, 190-243, 283-370`；`WorkflowMappings.tsx:89-171, 289-348`；`components/SearchableSelect.tsx:8-51, 98-133`；`WorkflowDefaultLoras.tsx:34-95`；`WorkflowLoraSummary.tsx:12-91`；`server/mio_server/comfy/inspection.py:152-195, 230-244`；`inspection_candidates.py:105-196`；`workflow_slot_plan_groups.py:39-49` 与 `workflow_slot_values.py:130-149`。源码推断和真实 UI 实测分列，CI 测试源码不当作本机跑过。

## 租约与清理

主体 `r6-web-001`：主流程234动作/28图；同 page补充3动作后237。后段从197动作 checkpoint 计40动作，原28图不加。实际关闭 own context UTC `2026-11-26T09:58:07.991Z`，counter 已 detach，补充连接已关，没有关闭 Chrome/preview。

焦点 `r6-web-focus-002`：UTC `10:06:12.878Z`–`10:06:15.196Z`，9动作/1图；own context 与连接实际关闭，已向root释放。候选 `r6-web-candidate-003`：UTC `10:17:25.006Z`–`10:17:26.822Z`，1.816秒，6动作/1张本人查看截图，47总 own-origin请求/API13/foreign0/持久化mutation0，readonly inspect-file POST恰1。own context与连接已关，已释放；未保存或重跑矩阵。

主体及两个独立追加合计252动作、30张本人截图视图；请求/响应分别按各自口径保留，不把不同 lease 的分母合并成虚假的全程网络限额证明。

没有清除保存的中性审计文档、preview 隔离数据库、root artifact 或其他角色输出；后续清理由 root 承担。用户工作区、模型/用户 LoRA 和已有浏览器上下文未作为审计目标。历史私有138、真实公开盲样、本轮29后端手选编译、TLS/全门禁不是本 Web 执行分母，本报告不替代相应角色或最终清理出版证据。

未测：在线 Comfy dependency diagnose（要求 object_info/实例，按租约禁止）、出图、真实模型/LoRA、大于200节点的UI量级、多输出选择的真实多阶段图交互、后端完整typed compile、未提供的私有图/浏览器状态。首版结论不将这些未测或其他角色待审项写成通过。


## 首版证据文件与公开边界

机器结果见 `results.json`，完整类型/指针 delta 见职责内 `comparisons.json`；可公开的 `comparisons-safe.json` 去除文档 ID，仅保留计数、类型、指针与 hash 投影。保存/取回/导出见 `roundtrip-summary.json`，逐图本人视觉判断见 `visual-review.json`，最终源码/夹具与产物完整性见 `final-integrity.json`、`artifact-final-guard.json`。`initial-seal.json` 冻结首版文件 SHA。详细 safe 公开白名单另见 `publication-safe-allowlist.json`；原容器、私有事件/完整产品 bodies、私有 ID、浏览器 session/context 标识及下载 JSON 不进入公开材料。未经 root 开放，首版封存后不读取同轮其他角色产物，不开始 cross。
