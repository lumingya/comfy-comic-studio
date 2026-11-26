# R6 五路独立终审共同合同

**状态：AUTHORIZED。root已完成本候选全门禁、源身份及预览实证核对，授权本轮五名全新审查者按下列合同独立开展工作；这不是审查结论或PASS。**

## 启动顺序与完成条件

1. root核实当前候选的push及PR两个完整CI均已终态成功，保存每个job的实际checkout、PR merge父提交、实际发出的全部必需命令、步骤/条件跳过、跨平台结果和完成UTC。只看metadata head、workflow计划或fa旧绿灯不满足此条件。
2. root核对候选源码/辅助脚本/输入冻结，并补齐下表及新fe CI前端artifact、实际运行preview的身份与资源证据。此时才可将材料改为正式授权版。
3. root明确授权后才以`fork_turns="none"`启动五名全新上下文、未参与本轮及此前实现的审查者：generality、compile、blind、web、privacy。准备稿作者不启动审计、不分配产品租约、不读取R6审查结果。
4. 五人各自独立完成首版并封存后，root再开放同轮交叉互核。交叉与终签另存，首版不可改。相关问题需修源码时，执行新门禁与新一轮全新五人审查，不回写旧轮PASS。

准备时状态表保留于不可变`brief-common.prepared.md`；正式启动证据见下方root冻结授权及root-authorization.json。

## 身份与完整审查范围

- 仓库：`<task-worktree>`。
- 原任务：`<original-task-text>`。正式启用后先读原任务、AGENTS.md、README.md和docs/ROADMAP.md；源码、真实结果和原要求优先于主控或历史摘要的判断。
- 冻结候选：`fe914065c7aafb0672bfe10274361f83179ce7f1`；全任务基点：`38838ab43cf3d056951f2fc6c52afb737d34e3c6`。五路都覆盖这一**完整base..candidate任务范围**，不是只查最新helper、M1/M2补丁或自己的一小段diff。不要整体合入或改写main。
- 已知runtime：218个Python模块，原始字节聚合SHA256 `a00155daa5515501eb3ee117f284c2ae1f8152ac038d7efa7f6208c46b8ad487`。
- 已知all-server：407个Python文件，聚合SHA256 `018c572cec3c9a629b13e4ea3bf6f6b5fd1323b0581c5f696c294007c61f7b32`。
- 已知新helper SHA256：`e9a50786e9beeb38810feb096e4d6a28bda2c1639eca567dd755c580aedbd4ae`。正式冻结时root指定其实际文件与输入，不根据本行推定运行通过。
- 聚合定义沿用相对仓库POSIX路径→原始文件SHA256映射的排序紧凑JSON再SHA256；启用后各审查者须核自己实际读取/运行的源码身份。旧ed/fa的217模块相同不能证明新fe的218模块相同。
- R6外部职责根：`<owned-audit-temp>\audits\r6`。只写本人职责子目录；新公共样本/私有oracle/原始结果均留仓库外。源码、既存证据、用户数据库与工作区不改，不提交、不推送、不装依赖。
- `repairs/final-current75-replay/{report.md,summary.json,provenance-safe.json}`只说明既有同批core复跑范围与身份；不是新五路结论，也不是完整typed/手选覆盖。正式审查的历史身份与契约指针由root明确提供，不开放TEMP递归发现。

## 资源和产品租约

任何Mio import之前，先把实际执行进程设为CPU affinity `0x1`、BelowNormal `16384`，读回PID/UTC/affinity/priority及源码SHA；核验失败即停止，不先import再补记录。包括将来启动获准preview的产品进程。root负责预览实际启动证据；审查者须再核自己用到的进程身份。

同一时刻只允许一名审查者持root明确授予的产品租约。未获租约时仅做源码/契约阅读、必要公开采集和纯数据准备；探针问题、输入、oracle先冻结，再集中一次有界串行执行。失败只恢复受影响部分，保留原始失败。不得以子进程、后台probe或同伴代跑绕过租约，不让前轮实施者替自己下判断。

完整unittest/Vitest、build、生成契约门禁与真实TLS完整suite看本候选远端实证，本机不跑全套、不本地build、不跑E2E框架、不安装浏览器、不压力循环。正式Web角色按本交接进行有限真实Chrome手工流程审计，不扩成E2E测试套件。所有角色均不执行GPU/模型/用户LoRA/付费服务，不重启或改动用户服务。只使用任务隔离数据与中性合成输入；必要公共真实样本按职责有限静态调用。

## 独立性、证据与判断

- 先独立读原契约/源码/原始结构，固定可检查的期望，再调用产品。首版seal前不读其他R6审查者的产物或交换发现。历史失败/修复事实不是本轮oracle或结论；不复用旧oracle来冒充独立推导。
- 每个请求分别记录预期与实际target、原生类型aware完整图、输出闭包、存活连接、无关字段、原图/源文档/文件哈希与警告/错误。合法编译剪枝属于预写闭包的一部分，与修改源文档不同；完整delta不能漏掉剪枝，也不能把合法剪枝误计为额外源写入。
- 固定所有样本和分母。自动目标/实际写、显式映射、人工候选指导、UI-only、缺项、拒绝、保守未改、策略差异与未测分列。no-op的最终状态相等不是实际写证明。不能看结果后换样、改oracle、改类型容忍或删失败。
- current75的230＝46API×5，truth为160 automatic＋29 manual_required＋41 absent。原harness的230比较是Python整图值相等，**不是230条完整strict typed delta**；29项为无mapping保守保持判定，**显式手选操作0**。它不能提供29次手选证据，R1的20次或R5的94次也不能填这个分母。
- 首版须有`report.md`、适用的机器结果、`initial-seal.json`，保存实际基点/HEAD/UTC/输入与产物SHA、范围、Blocker/High/Medium/Low、未测及失败；仅写自己目录。seal后通知root，不抢先跨审。
- 全员首版封存后，root才允许逐事实交叉核验：检查源码机制、实际结果、对本职责接口的影响及证据强度，不只复述同伴verdict。新建cross与final文件，首版原样保留。
- 任意Blocker/High，或明确属于原任务泛化/编译/人工接管/体验范围的Medium，均使整轮REQUEST CHANGES。自动写或显式compile正确不能消除候选指导缺陷；无条件事实闭合才可签VERIFIED PASS。不得先给source-role PASS或条件通过；全五PASS也不等于root最终清理/推送/CI已完成。

## 公共输出与用户保护

公共文件及工具/终端输出只投影已知schema中的计数、有限数值、布尔、类型/长度、指针、哈希、通用错误码、公共来源URL和中性说明；Flux/SDXL等公开架构家族可用。未知dict/schema先停止输出，确认后才列白名单；禁止整体序列化未知嵌套请求或完整diff。

真实图对象键`class_type`、`inputs`、`links`、`widgets_values`、`extra_pnginfo`不得作为公共原图结构返回；`/node/inputs/field`这类证据指针字符串可保留。原作者提示词、图像、checkpoint/LoRA资产文件名、用户路径/账号/认证信息不进入公共报告、Git或工具输出。原图/完整产品返回/私有oracle仅在root明确批准的外部路径使用，先白名单投影再显示。读全任务fixture/Git blob也执行同一输出边界。

按明确路径读取，不递归枚举TEMP/浏览器profile或查找用户文件。三次R5审查回显过程事件分别保留；不喊“全过程零回显”，也不把未知截断内容当已清白或无证断言私图/凭据泄露。发现意外输出/不确定写入立即停止相应方向、披露范围和未知，读回受影响状态后再由root决定最小恢复；不盲重试、不删其他任务文件或进程。

## Web启用入口

准备时已知专属Chrome PID `46124`、direct CDP `http://127.0.0.1:59871`；这是定位信息，不是本次重验。正式Web租约前核loopback监听owner、同PID身份、CPU/优先级和root交接的新fe preview/artifact。仅从direct CDP建立自己的fresh context/page，不列举或读取已有context/tab/profile/cookie；**禁止旧Chrome MCP page2或其他旧page ID**。只关自己创建的context，不关闭全局browser。

root将另给新fe CI artifact ZIP/逐文件哈希、实际preview PID、精确origin和backend/frontend HEAD；未收到前不可沿用R5的fa artifact、PID或旧8797页面当新fe证据。每次正文/DOM/截图前核精确授权origin；网络仅放行该任务origin及本地data/blob，拒绝其他导航/远端资源，不登录或处理挑战。全部截图由审查者实际逐张查看；工具无异常不等于视觉通过。无头Chrome须照实写无头，不称桌面可见窗口。

准备参考：R5共同材料SHA256 `47a62e7466f6b97f4305f5dc26169e32cafb4a6023c0acc00db2c0361111626a`；职责材料SHA256 `f4a95845505ab4f5185efa465131b32346825d66edb1b433ac5eaa7754919870`。只沿用流程契约与已知限制，不继承其运行身份或签字。

## root 正式冻结及授权（2026-11-26T09:01:19.923847+00:00）

上述准备条件已由root实证核对，本正式版授权五名全新审查者开始独立工作；准备稿原件保持不变。共同合同中未来式启动条件在此时已经成立，实际身份以本节及`root-authorization.json`为准，不继承旧轮签字。当前无任何R6结论。

- push45779838148与PR45779847204均终态成功，6 jobs /70 steps，14必需命令组/76实际命令。push实际checkout fe914065c7aafb0672bfe10274361f83179ce7f1；PR实际checkout c59eaf873ce98d0940a08ee70c0a1991475e5139，ordered parents为6ed78255bca6487ce874946118f26a26ec22c3dc、fe914065c7aafb0672bfe10274361f83179ce7f1。证据`repairs/r6-candidate-ci/ci-verified.json` SHA 6ad3b99652352e7819fa4d513de03e0f6c16f98c41a478baee2bdaa5a9150d11。真实TLS/skip结论依实际quiet suite＋exact-ref源码推断，不虚构verbose单项日志。
- root本次重新计算218 runtime及407 server原始字节聚合均吻合上文，HEAD/origin均fe，工作树干净；冻结后审计期间不改仓库。三个新旧源码与helper身份不得混淆。
- 最终seen文件为`preflight/seen-ledger-v3.json` SHA a6b4c101ba737e458a87e95222abadad68916cb06d3826b5211d9f0e8bab0d53，263 entries、11 typed layers。替代职责段中的未定`seen-ledger.json`定位。各层distinct依序245/204/214/148/116/118/194/75/102/39/35；顺序见文件indexes。35个Civitai历史canonical弱前缀只在10个已有full canonical记录上支持其语义，其余25缺全hash；原75弱prefix仍unknown。新样本须同时考虑canonical弱prefix，不能仅对raw前缀；旧缺失位置/算法不确定性保留。追加2539304只是独立UI内容身份，不替换旧missing或core75。
- 29手选补充身份：`preflight/current75-manual-identity.private.json` SHA 1c0d5e2dc4cd25596783f61dd8b832285ab196c41b51169d5255b8581e8a0b03；safe文件`preflight/current75-manual-identity.json` SHA 64c33ed45d4939733fcbb3941b7cc4c1525db4707c77aef3d3e965cade0c5d06。compile仅可读取该private身份明确引用的29个原件，不搜索其他私图；从结构自行选点/冻结oracle，不复用旧真值。
- 新fe预览已实际启动PID48744，origin精确`http://127.0.0.1:8797`，启动前CPU1/BelowNormal16384，backend/frontend均fe，218/407身份已核。根路径实际GET200且返回index SHA76e359396b1a4a06ff72e21bef3d48c81c82d75ea1115a09755d546aa8373a3a。运行证据`repairs/r6-preview/running-server-r6.json` SHA 97094302113c67116daaaa1fdf9f22270ef020407e007684d3c0d4b25f69f7ec。
- 前端artifact15098114848来自push45779838148，ZIP SHA d6a13e6d7c10125e2c96e62253bf90309bede137e41847fbb68e630bcee7d1dd，81文件已逐项核；`repairs/r6-preview/artifact-fe91406-provenance.json`及`preview-source-freeze.json`是允许读取的身份记录。不得用PR merge artifact或旧fa文件代替。
- Chrome仅专属PID46124/CDP59871；最后公开采集已关闭自己的contexts/streams并释放浏览器。Web租约前须独立重新核listener/PID/实际CPUguard及精确preview身份。不列举旧context/tab/profile。仅静态workflow inspect/diagnose，不点Comfy在线连接/模型枚举/出图。
- Web在四格中额外覆盖一个中性API：空/空白或上游字符串的正负候选＋独立多跳图片分支；实际展开候选role、手动自定义role/字段并保存GET/导出核实。此为真实UI人工接管审查，不发明一键采纳候选按钮。
- 产品执行必须先向root交付预写问题/冻结输入及oracle，请求明确租约；root序列分配compile、blind、web及确需的generality有限探针。无租约仅静态阅读、纯数据准备或blind必要公共采集；不得将导入产品偷算纯文件。所有本地完整suite/build/压力循环禁止。

明确允许的外部读取白名单（相对owned TEMP根；禁止递归TEMP发现）：

1. 本R6共同合同、职责、root授权、preflight safe身份/seen及本人子目录。
2. `repairs/final-current75-replay/`的report.md、summary.json、provenance-safe.json；compile可在内存只读reprobe-current.private.json、started.private.json、finished.private.json和29身份引用的原件，用于独立核4个旧false与源身份，不公共输出未知结构。
3. `repairs/r6-candidate-ci/`的report.md、ci-verified.json及其明确source_evidence引用的raw文件，仅privacy必要白名单读取；不另抓同一日志。
4. `repairs/r6-preview/`的running-server-r6.json、artifact-fe91406-provenance.json、preview-source-freeze.json、root-ci-authorization.json、preview_server_r6.py；Web只用现有preview，不启动新服务。
5. `repairs/r6-r5-finding-replay/`五safe文件report.md、results.json、provenance-safe.json、assessment-safe.json、completion-seal-safe.json只作历史修复追踪，不能当新独立oracle。
6. `repairs/r5-final-draft/`的final-report-draft.md、requirement-evidence-ledger.json、classification-calculations.json供privacy审查声明，未标最终。历史138和tag/mapping合同先用仓库docs/reviews已发布证据；确需其他私有结构先报root准确缺口，不搜索用户文件。
7. privacy可读`audits/r5/privacy/protected-workspaces-before-delivery.json`，严格私有，只输出前后计数/状态/hash比较。后续root实际清理、出版、推送完成证据未发生时保留待证，职责签字不能冒充目标已完成。

首版封存前不得读取同轮其他职责的任何产物、发现或结论。所有历史结果只能当输入身份和合同线索，审计结论独立建立。全五首版seal后root另行开放cross。
