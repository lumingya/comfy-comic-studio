# R6 职责与证据要求

**AUTHORIZED。启用身份、完整范围、独立性、资源租约与公共输出边界以正式`brief-common.md`及root-authorization.json为准。**

五路均审`38838ab43cf3d056951f2fc6c52afb737d34e3c6..fe914065c7aafb0672bfe10274361f83179ce7f1`完整任务，不缩成新helper或仅M1/M2。先读原任务/AGENTS/README/ROADMAP；每条结论指向实际源码/固定输入/实际执行，而不是共同brief中的主控判断。

## generality

独立审完整任务diff的图/端口、绑定/执行闭包、槽位/adapter分层、贡献注册/缓存代际、阶段意图、未知节点与动态边界、人工接管和已有标签/mapping合同。检查算法是否通用、是否堆样本/插件白名单、是否引入循环依赖或不合理模块体量。M1空/空白文本与配对negative语义候选、M2多跳图片用途提示作为已知接口风险核查，但不替代全scope审查。

独立区分只读人工角色血缘与自动恒等改写；未知变换不得因候选提示而获自动执行语义。核查显式标签/mapping优先、候选角色是否完整及“不确定”是否可理解。已有自动绑定与显式写正确不能直接证明人工候选完整。

核对既有138节点私有工作流的历史/当前事实：43LoRA、无标签/配置mapping、缺frontend state导致完整compile=false的既存边界，宽高/batch保守撤回及历史字面target仅绑定阶段的证据。历史29个独立tag/mapping回归与私有138是不同分母；217旧hash一致也不把旧执行变新fe执行。只读root明确给的报告/身份/必要授权结构，不复制、修补、补抓用户state、上传或输出私图。无法安全得到新完整compile证据时照实未证，不删原要求或冒称私图通过。

完成条件：完整diff的算法/接口判断与证据范围列全，预写有限探针问题（如确有未解问题）并持租约执行；无产品需要则以静态证据说明。独立首版seal后才跨审，不能预签无问题。

## blind

自行采集10–15份此前未见的真实公开静态工作流；排除视频/3D/音频。新鲜性首先按root冻结的`audits/r6/preflight/seen-ledger-v3.json`逐层核raw原容器SHA、API/UI canonical、来源身份及拓扑指纹；保留12位weak-prefix原失落25、缺失位置及无法重算层的限制。保存预选、排除理由和全部身份，不把排除项从后续seen记录中抹掉，也不宣称对不可用原件穷尽去重。

事前固定样本、API/UI格式、原JSON/PNG/WebP容器hash、公开来源版本、节点/拓扑概况、自己的预期及oracle SHA，再获产品租约。私有原图和oracle仅外部职责目录；公共报告只投影。看完产品结果不换图、不改分母、不用旧oracle或同伴结果补自己预期。

选择须实质覆盖复杂图、真实活跃LoRA、多图片/多阶段及多生态，优先足量可执行API；不是以十份小API或全UI-only凑数。采集确实不足时保留尝试/缺证，不下载权重或把合成图改称真实。报告真实节点规模/活跃项及格式，巨图、长栈、无线/原生子图等未覆盖须明确。

对每份API按实际适用性测import/inspect/loras/compile/diagnose；UI仅解码/概览/导出引导单列。覆盖prompt/negative/seed/width/height、实际存在的steps/cfg/sampler/scheduler/batch/denoise、参考/底/控制/蒙版图及output；不存在项独立分母。自动与手工逐请求记录冻结target、actual target、类型aware整图/闭包/全部delta、连接、邻项、原图/文档/file哈希及warnings/errors。真实LoRA按稳定键测覆写/负值/禁用、重复名、model-only/可选CLIP与原生类型邻项保真。

完成条件：10–15个固定新样本与预运行oracle/去重封存齐全；实际执行/拒绝/未改/未测与no-op分别记账，失败原样保留。自动exact-state和change-bearing实际写分开；显式精确不洗自动missing或指导缺陷，UI不进API成功率。

## compile

先按结构独立推导中性oracle，再集中有界串行执行。总体覆盖普通/现代采样、多阶段/歧义阶段、多输出、显式标签/mapping与优先级、多图角色、文本/字符串、原生int/float/bool/dict、30+LoRA链及flat/嵌套stack、开关/草稿/mode/count/可选CLIP、邻项与连接、输出闭包及源文档不变。覆盖原27例所代表的主要类型/LoRA/目标族，不能只复跑新helper或只看单点值出现；病例与分母自行冻结，旧oracle不作为新独立判断。

### 29个真实manual_required补充：身份不等于oracle

root提供的`preflight/current75-manual-identity.private.json`及其明确冻结的对应safe版只含29项身份，不含可复用选点oracle。正式启动前root补safe文件名/SHA和精确原件读取白名单；本准备阶段不打开这些文件。29为18prompt＋11negative，不用R1的20或R5的94替换。

每项依次完成：

1. 从原结构独立判断一个明确合法的人工写点、原生字段类型与语义。冻结原图/身份、选点理由、该次单字段请求、预期完整编译图/存活闭包/typed delta和source保持oracle；此后才调用产品。origin_candidates即使存在也不是已选mapping真值。
2. 在自己的隔离文档显式设置该mapping，实际执行该次人工写入及完整compile。记录29个case的实际请求数、有效target、binding阶段单点差异、完整typed图与全部剪枝delta、连接/无关字段/源图/源文档hash。
3. 合法剪枝在预写闭包中单列；“单点”指请求绑定仅改预定目标，不把预期闭包剪枝忽略或误作第二次源写入。精确比较原生类型，Python `==`不足以证明int/float/bool保真。
4. 疑难项保留同一身份；不能论证合法人工目标或compile拒绝时记录未证/失败和原始证据，不换样、不改旧truth、不在看到结果后补造oracle。完成指标须明确29项中实际选点/实际写/完整编译/typed精确各自数量，未完成不能写29/29。

current75 core的160automatic＋29manual_required＋41absent仍单独保留：29原来只测无mapping保守保持，explicit operations=0，230使用Python整图值相等；不能把其29/29称这次29次手选。独立核原4个truth false的实际性质、target/警告/未改与手选接管证据，不改旧分母或把合理边界自动洗成原通过。

另独立核既有138私图与独立29tag/mapping回归的范围差异，按共同保护边界保留缺frontend-state限制。新中性tag/mapping编译案例不等于私有138完整通过。必要的保存原子性、坏图隔离、内容缓存按完整任务源码/契约检查；不本机跑完整suite。

完成条件：上述主要类型/LoRA合同、29真实manual补充、4旧false、138与29tag独立范围都有实证或明确未证，原期望/失败不改。实际29手选typed结果与旧230值相等分开输出，不通过数相加造总兼容率。

## web

只有收到root的新fe CI artifact＋实际preview运行证据及产品租约才导航；直接CDP PID46124/端口59871的身份和owner须重新核实，建自己的fresh context/page。按共同文档限制精确origin与网络，不枚举旧tabs/profile，不使用旧Chrome MCP page2，不用旧fa产物替代新fe。

真实Chrome四格：1440×900浅/深、390×844浅/深。每格实际操作中性200-node、UI-only及30+LoRA图，覆盖原始文件导入JSON/API元数据PNG/WebP、UI-only人话引导、inspect/diagnose、节点搜索/过滤、手工字段与参数/图片mapping、LoRA调整、保存/取回/导出，Tab/Enter/Escape、焦点回还、滚动/页面/弹窗溢出及长标题。有限普通操作计时，不压力循环、不出图。

按**真实界面能力**冻结动作：当前UI会展示candidate全部role，但没有“一键采纳候选”按钮；在可见角色提示、通用字段下拉/自定义语义key、手选、保存读回流程验证人工接管，不发明不存在的控件。CORE没有默认image行不等于role提示不可见；空文本缺少推荐也不等于整个UI无法选空字段。若原目标与当前交互有缺口，记录其实际影响，不把不存在的动作脚本失败当源码事实。

wire JSON对整数值浮点的表示与后端typed compile是不同边界。冻结raw hash、类型aware差异及数值差异；即使仅cfg/denoise的float→int数值相等，也保留raw-hash失败，不改成全PASS、不放宽后端合同。每份导出与源独立比较，保存源文件hash。所有截图仅外部职责目录且由本人实际逐张查看，记录四格实际操作/断言/截图视图数量；不能以脚本没异常或只存图签字。

完成条件：四格完整交互与实际视觉核验、有界计时/DOM/滚动/焦点、原始断言和差异均封存；新candidate/source/UI角色发现独立判断。关闭自己的context并释放产品租约，不擅自清理root预览/用户数据；临时preview记录清理状态如实交接。

## privacy

审完整base..fe Git diff和所有新增夹具/生成契约；新增71归档须以**实际Git blob**逐文件核对内容与SHA、来源/计数/原结论保留及机械匿名化，数量也以实际diff确认，不能只查工作树文件或搜禁词即签干净。全量diff/fixture在内存中安全核对，仅输出已知类型/长度/哈希与路径分类，不回显未知嵌套dict、提示词或资产名。

对53项原要求报告/ledger逐项核声明与实证：原75缺失25及weakprefix、当前75替补身份、230 Python值相等和manual显式0、29新手选独立oracle/结果、API与UI、旧138及29tag/mapping分母、真实/合成/历史/当前、自动/实际写/手选/未测都不能互相替代。R5五份REQUEST CHANGES、相关旧CI失败及三次回显事件保留；可见未见凭据不清除未知截断内容，也不无证升级为用户私图/凭据泄露。

独立核本次fe push/PR实际checkout/ordered parents、全部远端jobs/steps/实际发出命令/条件跳过和构建产物；远端完整suite及TLS以源码＋实际完整日志/skip证据正确归属，不用fa绿灯、metadata head或成功quiet日志虚构单项耗时。只读既有CI/必要只读查询，不重跑CI、不本机全套。

原工作区保护使用root明确冻结的前后metadata/哈希，保持原有tracked/skip标记/用户untracked不变；没有更早内容基线时如实保留历史归因限制。最终清理、出版修正、中文定稿/路线图、具体文件提交推送、干净工作树和最终CI关系由root实际执行；尚未发生就列交付阶段待证，不用当前候选干净快照冒充已清理/推送完工。R6职责结论与全任务最终交付签署分开，留下精确需要root补齐的证据。

完成条件：完整diff/新增71实际blob、53要求声明、fe全部实际门禁、原工作区保护及交付阶段界限都有逐项证据；公共输出只经有限白名单，未知schema停止。独立首版seal后再按root开放的同轮原始事实交叉，不提前给source-role PASS。

## 共同首版与交叉产物

每人只写自己职责目录，首版`report.md`＋适用机器结果＋`initial-seal.json`，封存实际候选/基点、UTC、输入/代码/产物哈希、执行守卫、产品租约、分母、分级发现与未测。全部首版由root确认不可变后方可cross；新cross/final保留证据来源与独立核验边界，不改首版。两项同根因被多人确认只计一次，专项通过不消除别的接口缺陷。任何原任务相关Medium以上未关闭时整轮REQUEST CHANGES；只有新整轮五份无条件VERIFIED PASS且交叉事实闭合才满足审查轮要求，最终清理推送仍需实际完成。

Web补充：四格须实际覆盖空/上游正负文本与独立多跳图片候选role展示、通用手选role/字段、保存GET及导出核实，详见共同合同root授权补充。
