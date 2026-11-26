# CrossAudit-1-Arch-Isolation · R2 独立复审

状态：**NOT VERIFIED PASS：0 Blocker、0 High、1 未决 Medium、1 既有 Low。** 定向独立源码补核确认 `QA-DIALOGUE-M01`，原任务要求的台词契合度没有进入 QA 输入、结果和评分卡；不能签发完整 R2 通过。其它已获得的隔离、生命周期、scope、生成物与变体通过证据保留，不把它们冲抵能力缺口。

## 身份、冻结与执行环境

- 本席为 R2 新启动的独立审计官，没有参与本轮产品编码；先读 `AGENTS.md`、`README.md`、`docs/ROADMAP.md`、用户完整原任务及本席 R1 报告。原任务明确授权六个独立、默认停用的可选专业工作台，覆盖 AGENTS 历史后端-only 限制。
- 原任务：`D:\Tencent Files\tx download\ai_studio_code (4).txt`。审计只写本报告；未改产品、测试、生成物、随包数据或其它席报告，未 commit/push 改变冻结 HEAD。
- 固定代码：`5569dc294fd16c7478abbd31317da7e9055c3be7`。本席浏览器/契约探针与 12:09:38 定向补核均绑定该值；总控 12:12 起放行下一轮 QA 修复，本报告不将此后工作树当作仍冻结，也不替后续实现签发。
- 固定构建：`web/dist/index.html` SHA-256 `ecd63ebe23e44f17c079d4d256765e9355e24a2fee50a7e30e5e0ece643ccbfa`；未重建。
- 本机 Windows，Python `3.13.6`、Node `22.18.0`、既有 Chrome `158.0.8127.37`、已安装 Python Playwright。未安装浏览器、依赖或 `@playwright/test`；已读 Playwright 与 UTF-8 guard 技能，中文探针通过 `apply_patch` 创建 UTF-8 文件。
- 独立 loopback 临时端口、独立 Chrome headless 进程/context、1440×900、自有临时运行数据。没有操作用户浏览器、8788/8188 服务、私人 runtime、发布数据的三个受保护本机差异，未执行真实模型、付费 API 或 GPU 作业。
- 执行证据时间：2026-11-26 11:18:23–11:31:03，Asia/Shanghai。最终完整浏览器流程 11:26:22–11:26:55；安全模式/卸载至 11:27:06；后端矩阵编译于 11:28:18 通过；清理于 11:31:03 完成。
- 终盘定向只读补核：2026-11-26 12:09:38，仍为相同冻结 HEAD。补核确认新 Medium 后更新本报告，未重开 Chrome 或运行测试。
- 启动前全量门禁由总控提供已完成证据：原样后端 1738/1738，1273.729 秒，`OK (skipped=8)`、exit 0，11:09:53 结束；frontend 127 files/1076 tests、type/format/build、Ruff 435、Spike 80、Node 21、CTK 25、生成物检查及 HEAD 64 文件发行检查通过。本席未重复这些全量门禁，也未把它们替代下述独立验证。最新 CI `45745955229` 在派发时仍运行，本席不报告成功。

## R1 缺陷与本轮独立结论

| 项目 | R2 独立证据 | 结论 |
| --- | --- | --- |
| A1-M01 · 取消 scope 错配 | 两包均实际创建中性 blocked 任务；v2 read、read+render 经真实桥返回目标 403，任务不变；read+write 返回目标 200，任务 canceled。再次创建任务，正常填写 job id、刷新、点击可用停止按钮，两个真实 iframe UI 均使任务 canceled。未 mock `engine.cancel()`。 | 已关闭 |
| A1-M02 · 直接顶层恢复宿主源 | 六个正常 iframe、同 context 直接打开六个入口 HTML 均 `self.origin="null"`；localStorage 为 SecurityError，直接 fetch `/api/series` 为 TypeError。每个 HTML 响应 HTTP CSP 含 `sandbox allow-scripts`。未读取私人存储，仅使用合成公开 sentinel。 | 已关闭 |
| R1 motion 全屏问题的相邻回归 | 正常受控面板读取计划后真实点击 fullscreen，等待浏览器实际 settled，child `document.fullscreenElement.id="stage"`；`document.fullscreenEnabled=true`，iframe 保持 `sandbox="allow-scripts"`，仅 `allow="fullscreen"`。 | 通过，无需 allow-same-origin |
| R1 变体四维缺口的相邻契约 | 实际 `variant-workshop/model.js` 产生 2×2×2×2 共 16 个原生 VariantSet，经真实 API 追加和存储后，实际 `compile_panel()` 产生 16 个不同提示词。 | 已关闭；详见矩阵证据 |
| A1-L01 · 固定中文入口 | 宿主菜单与 iframe title 仍直接使用 manifest `panel.title`，六包入口 metadata 没有英文变体。包内语言消息与字典完整性通过不能消除该问题。 | 保留 Low，不阻断本轮门槛 |
| QA-DIALOGUE-M01 · 本轮新增能力契约缺口 | 用户明确要求 QA 台词契合度；独立核对领域投影→VLM prompt→返回 shape→聚合→DTO→UI，全链缺少台词评审，且无带参考图角色时直接 votes=0 跳过。 | 未关闭 Medium；完整 R2 不能通过 |

## 全范围实际覆盖

| 范围 | 方法、结果与限定 |
| --- | --- |
| 独立、默认关闭的六包 | 每包独立 manifest、无 Python main。将实际六包放入自有 builtin 视图，真实 `AppContext/ExtensionManager` 新建空工作区：六个 `builtin=true/status=disabled`，loaded=0，无注册 panel。 |
| 官方 ZIP 与摘要信任 | 通过真实扩展管理页逐个上传六个官方 ZIP；每次初装 disabled、非 builtin，信任弹窗显示真实 64 位摘要并与 API 一致；明确点击“信任并启用”后才获得 activation 和面板。未绕过生命周期直接加载 HTML。 |
| 关闭时核心 | 实际 board：0 iframe、0 扩展面板菜单、0 files/bridge 请求、`/api/extension-panels=[]`。六包停用后重新加载仍一致。 |
| 启用但未打开 | 同实际 board：0 iframe、0 面板实现资源/bridge 请求；只有 1 个通用扩展菜单，目录返回六个 metadata。metadata 发现请求不等于专业实现被加载；不将其夸大为零总字节/CPU/RAM。 |
| implementation bundle 隔离 | `web/src` 没有直接 import 六包实现。将每包 JS 中 100–500 字符的实现源行与实际 dist JS/CSS 对照，87/16/10/63/70/2 行全部 0 匹配；这是支持性静态证据，联合上述真实资源观察使用，不把精确文本查找当作普遍反混淆证明。 |
| 六包正常访问 | 六个面板均由真实话内菜单打开，正确 iframe ready；五包点击读取作品，剧本助手 pacing 入口 enabled；六包合法 episode 读取均经实际桥 HTTP/target 200。仅打开与读取后 FakeComfy/FakeVLM/FakeLLM 调用数全部 0。 |
| 正常 iframe 隔离 | 六包 `sandbox=allow-scripts`，无 same-origin；origin=null；读宿主 DOM 与 localStorage 均 SecurityError；直接 fetch 被 connect-src 阻断为 TypeError。 |
| 顶层文档隔离 | 六个入口 HTML 在已写入合成 sentinel 的同 context 新页直接导航，仍 origin=null/storage SecurityError/direct fetch TypeError；HTTP sandbox 与正常嵌入一致。没有将 `location.origin` 的 URL 字符串误当作 effective origin。 |
| 外观与语言消息 | 六包已经建立的受控 port 上，宿主 `zh→en→zh` 与 `light→dark→light` 双向更新全部到达。面板用 `data-theme` 或 `style.colorScheme` 表达主题，两种合法实现均按实际契约读取。 |
| MessagePort | 六个已初始化 iframe 用正确 session 再次递交 ready 和新 port，200ms 观察均未收到 init；同一面板此前的正常既有读取成功。源码核对首个 port 绑定与来源/session 校验；本席没有声称测试了二次握手后的所有业务序列或所有消息竞态。 |
| scope 与实际目标 | 48 条六包声明均匹配唯一真实 OpenAPI typed operation，scope 与真实 `required_scope()` 完全一致；v2 桥转发调用者权限。两取消包的真实正反向见上。 |
| 负向契约 | 未声明 request 403，过期 activation 404，路径穿越 segment 422，v2 匿名 401。没有因修复取消而提升 render 成为 write。 |
| 摘要变动 | 仅改自有 TEMP 安装副本 retouch `app.js` 的中性注释：立即 changed，files/bridge 404；之后恢复原字节。其它五包 tamper 与更深路径边界由安全席独立验证，不伪记为本席浏览器执行。 |
| 停用 | 六包逐一停用，原 files 和 bridge 均 404；实际 board 清除菜单/iframe/实现请求。 |
| 安全模式 | 先在正常模式重新启用六包并持久保存，再关闭自己的正常服务，以真实 `MIO_SAFE_MODE=1` 同数据重启：六包 disabled、目录为空，六个 files 404，六个手工 enable 400。未通过改 API 响应模拟安全模式。 |
| 卸载 | 同一自有安全模式进程中真实 DELETE 六包均 204，之后扩展列表为空。未删除用户包或私人扩展数据。 |
| 外网与模型边界 | context 只放行本夹具 origin、data 与 blob，其它请求全部阻断；最终外部请求记录为空。模型计数保持 0；取消测试使用无执行器的中性 blocked 任务，不冒称 GPU 上游中断。 |

## 变体与生成契约

- `VariantSet` 的 `characters/outfits/locations/variables/style_id/profile_id` 均进入真实模型和 OpenAPI。实际 API 接受独立服装槽、场景 patch、变量，不是复制整份 outfits 来冒充新轴。
- 第一支独立编译探针逐项只改 character、outfit、location、style、variables：各自的唯一标记进入真实 `compile_panel()` 正向提示词，组合后五个标记同时存在、五个基线标记消失；原 Series 没有被 mutate。raw-prompt 四变量也展开为四项独立值。
- 第二支探针执行实际 `extensions/variant-workshop/model.js`，结构化 Bible 两个角色外观×两个服装槽选项×两个场景×两个画风，共 16 组合。将结果提交原生 `POST /series/{id}/variants`，存储中的 16 项都带独立 characters、outfits、locations、style_id，真实 compiler 产生 16 个不同 prompt。
- 同批相同 ID/内容重试仍 16 项；同 ID 冲突返回 409，存量不变；不存在场景目标返回 400；坏变量名返回 422；单独 variables variant 正常持久化。没有运行模型或重复实现后端编译器。
- 真实运行 v2 OpenAPI 与 HEAD `clients/openapi-v2.json` 归一化后完全一致；执行实际 Python generator 的 render，比对生成 Python 与 AstrBot 自包含客户端均一致，未写回生成物。
- 真实运行本地 OpenAPI，仅排除夹具自身 reset/stats 两条路由，使用原 `openapi-typescript` 参数及归一化规则在内存生成，结果与实际 `schema.d.ts` 字节完全一致。
- 主站实际 TS 字典经本地 TypeScript transpile 后读取：中英 2857/2857 个叶键，1700 个静态 t() 键零缺失。六包 JS AST 双语键分别 117/117、79/79、68/68、76/76、87/87、78/78，均零缺失。
- 发行清单只用 `git show HEAD:data/...` 构造自有视图，再运行实际 `check_distribution.verify()`：64 文件、0 缺失/变动。未读或取消保护三个本机 data 差异。

## 保留发现

### QA-DIALOGUE-M01 · Medium · 台词契合度未进入 QA 端到端契约

- 需求依据：原任务 `ai_studio_code (4).txt:63` 明确要求评分卡展示“人物一致性、构图、台词契合度与缺陷标红”。此维度不能由动作、场景或镜头匹配替代。
- 独立补核方法：收到总控候选后，只读核对冻结 `5569dc2` 的以下源码链；没有重开 Chrome、运行测试、调用模型或改变产品。本席此前的浏览器探针仅读取 episode 与桥接契约，没有获得实际 QA 评分响应，因此不把不存在的响应写成端到端验证证据。
- 复现/检查步骤：创建带实际对白的分幕并发起既有 QA，沿真实 `QAService.submit/execute` 检查传给 VLM 的 panel；对比仅对白改变、画面描述不变的另一稿。`story.panel_view()` 已保留每条 `speaker/kind/text`，但 `judge.consistency_prompt()` 不读取它们；依当前源码，单独改变台词不能改变该评审输入。再检查生成和展示的 QA 结果，也没有承载该维度的字段。
- 精确链路：`server/mio_server/pipeline/story.py:91–106` 生成 `dialogue`；`pipeline/judge.py:17–59` 的 intended panel 只有 shot/setting/moment，要求的 JSON 仅 characters/extra_people/scene/quality；`judge_panel():103–115` 返回 verdicts/extra_people/scene/quality，没有 dialogue 合规值或解释。
- 聚合与界面：`pipeline/qa.py:24–80` 只聚合 identity/extra_people/scene/quality，`models.py:391–402` 的 `QAResult` 无台词字段，`extensions/qa-review/panel.js:324–359` 的评分卡仅 identity/shot_ok/characters_ok/action_ok/issues。未评审的台词问题既不能进入分数，也不能作为专门缺陷展示和筛选。
- 无锚点分支加重缺口：`pipeline/qa.py:145–169` 先把 panel.characters 过滤为有 reference anchor 的角色；`execute():204–218` 仅在该数组非空时调用 `judge_panel` 和 `aggregate`，否则直接生成 `passed=true/score=1.0/votes=0` 与“无角色格：跳过一致性检查”。因此纯场景、旁白或没有参考图的对白格，不只是身份一致性不可评，还跳过其它可评的画面/台词维度；可选 faces 检测仍可单独运行，但它不构成这些 QA 评分。现有 UI 对 votes=0 显示未评审，不把该路径夸大成已经向用户展示全项通过；但这仍不能满足需求。
- 影响与分级：缺少用户明确要求的专业能力维度，正常安装/操作、API scopes 和字节一致性均无法弥补，属实质 Medium；不是安全逃逸、不是外部攻击，也不把 VLM 的固有判断不确定性误作本缺陷。本问题发生在发给模型和保存结果之前。
- 修复与再验收边界：应由对应实现领地扩展现有共享 QA 链路，让带 speaker/kind/text 的台词进入 prompt，并让明确的台词结果/理由进入模型、聚合、原生 API/生成物和面板评分；无角色/无锚点也应保留可执行的非身份评估。随后跑完整门禁并由新一轮独立审计复核，不能只加一个空 UI 标签，不能把 action_ok 改名冒充，也不由本席修改产品。

### A1-L01 · Low · 英文宿主的官方面板入口仍固定中文

- 路径：`web/src/extensions/hostSlots.tsx:128`、`web/src/components/ExtensionFrame.tsx:147`，六包 manifest `title`。
- 复现：英文宿主获得相同面板目录，菜单 label 与 iframe 可访问 title 直接呈现固定 metadata，仍为“单格精修”等中文；本轮实际语言桥切换只改变 iframe 内部语言，不能改宿主入口 metadata。
- 影响：英文用户的工具识别与可访问名称语言不一致，不阻断读取、操作或隔离。属于 R1 既有 Low；本席没有重新打开英文浏览器来补造视觉证据，保留当前明确源码与本轮固定 title 路径证据。
- 建议：后续为官方面板 metadata 引入受控本地化映射，并保持第三方原始 title 的既有回退；不需改变 sandbox 或默认加载方式。

## 探针失败史

以下全部保留在紧凑证据中；均为探针修正，没有改变产品来让断言通过。

1. 11:18 首次错误要求“启用未打开时通用扩展菜单也为 0”；实际应为 1，且 iframe/实现请求为 0。
2. 11:19 使用 `frame.wait_for_function` 字符串轮询触发 CSP unsafe-eval 拒绝；改为 DOM assertion/直接 evaluate 观察，未启用 bypassCSP 或放宽 CSP。
3. 11:20 要求所有包必须写 data-theme；retouch 合法使用 style.colorScheme，探针纠正。
4. 11:22 反过来要求所有包 CSS color-scheme 必须单值，实际另一些包通过 data-theme 表达；统一按 SDK 的 data-theme-or-style 契约观察。
5. 11:24 取消已成功但文案实际是“已停止”，探针只匹配“取消”；增加合法文案并仍以真实 job state=canceled 作最终判断。
6. 静态/契约探针另修正：合成 Episode 补必填 order=0；本机 CJS `openapi-typescript.default` 导出互操作；生成类型前移除仅有的夹具 reset/stats schema；TestClient 使用真实允许的 loopback Host 而非被守卫拒绝的 testserver。
7. 最终完整浏览器流程 exit 0、无 failures；Python 契约、Node 字典/类型、实际矩阵 API+compiler 各自 exit 0。初期只读 rg 管道转义与推测文件名错误已改用多 `-e` 与实际文件清单，不视为产品缺陷。

## 交叉互核记录

- 安全席独立六包顶层 origin/storage/cookie/fetch、motion opaque 全屏、取消 target scope、tamper/安全模式结果与本席一致；其 wrong-source/session、重复 rid 单运输及 Windows junction 深边界为其自有证据，本席不重复冒领。没有策略与交互冲突。
- 交互席 motion 300ms 时序疑似经 1200ms settled 排除，两视口实际 Enter 进入 stage 全屏、Esc 退出通过；本席独立真实点击与 fullscreenElement=stage 支持其排除结论。该席还独立通过四轴两来源 UI 保存/入队、16 组合上限与 10 条实际 ItemSpec prompt/ID、逐幕局部变量保护及固定其它轴的四候选比较；与本席原生模型/API/compiler 证据无冲突。其 QA 人工拒绝后 BODY 焦点 Low 不影响本席隔离或 API 契约，未被本席正向流程消除。
- 动态漫 TTS 不在本席自行浏览器实测范围；声音列表中有六个 voice 不等于真实试听。性能独占结束后，交互席在相同 5569/ECD 冻结上补齐两宽受信 mouse click：各真实调用原生 speak 一次，Microsoft Huihui zh-CN，收到原生 start→boundary→end，无 error/外联，结束 UI 恢复。其自有实例 12:11:37 关闭，12:11:52 CIM 计数 0。本席据该独立事件证据作文字互核，无 opaque origin/消息桥冲突；不冒领本席实测，也不将原生事件夸作对用户扬声器音量或物理可听性的测量。
- 视觉席专业36+生命周期6、焦点与正文对比度矩阵通过，并确认固定中文入口 Low 没有被中文视觉矩阵消除。其局部 retouch/Folio/动态浮层 CSS 修复不改变本席资源隔离与 sandbox 契约；没有架构冲突。
- 与接续性能席 `cross_audit_perf_r2_finish` 已完成文字互核：其冻结 5569 的 18 组三态首屏均 iframe=0/六包实现请求=0，与本席三态一致；36 次两宽×三主题×六包关闭后 iframe 均 0。host GC 堆 5.829–6.001 MiB 的有限区间和顺序 browser 缓存 RAM 不被误判为必然泄漏，也不能推成“永不泄漏”或“零 RAM”。
- 该性能席当前 C4 的 6 组 pan、6 组 board、6 组 wheel 均无 >50ms 帧；自然 30/60/180 秒两宽的稳定 3 秒窗口媒体帧增量与五类 trace 均 0。真实 OS 失焦的 hasFocus 真→假→真、hidden=false、paused 假→真→假与帧增量+0单独记录，且承认整 browser 仍有 composite/swap，未将该状态冒称整进程零绘制。这些表述与本席资源/契约边界无冲突；性能测量证据归该席，不能用本席静态证据替代。其 20 格/60 次模板矩阵已完成、汇总收尾中。
- 本席 Chrome 11:26:55 已关闭且不会为互核重启；性能接续席确认其自有 Chrome 12:09:12 全闭。性能范围通过不能抵消 QA-DIALOGUE-M01 的独立能力缺口，本席 R2 维持 NOT VERIFIED PASS。
- 总控终盘覆盖审计提出 QA-DIALOGUE-M01 后，本席独立只读确认上述全链缺口，并立即同意 Medium 与 R2 打回。正常 QA 操作能完成、评分卡已有其它维度、生成物完全匹配当前模型，都不能反证“台词契合度缺席”。本席没有将来源于其它审计的候选直接当结论，已核实每个关键实现点。

## 证据、清理与签发边界

- 唯一自有 TEMP：`C:\Users\QIU\AppData\Local\Temp\mio-cross-arch-r2-4oqmxnl0`。现仅留 `summary.json`，16,273 字节，SHA-256 `a6bf7bcbfd069693319371803c6fb107d4b040508296c5496e8083caf94f605b`；包含每项紧凑结果、时间、探针脚本 SHA 和全部失败分类，不含令牌、私人存储或抓包。
- 自有 Chrome/context 与正常/安全模式服务均已关闭；进程只读核验未见持有本 TEMP 的 Python/Chrome。没有保存截图；自有运行数据、恢复 sibling、ZIP、OpenAPI 中间文件和探针脚本均已删除。未碰旧 bridge recovery 或任何其它席 TEMP。
- 真实浏览器覆盖限本席架构所需 1440×900；不把它替代其它席 390px、全量视觉/键盘、timeout、恶意模板与性能采样。未运行真实 Linux、真实付费模型或瓦数/VRAM 测量。
- 本席探针收尾与 12:09:38 只读补核的 HEAD/dist 与固定值一致；12:12 后总控已授权下一轮实现，不再读取其变化来改写本轮冻结记录。其它席报告及后续授权源码写入不属本席更改，本席不宣称当前整棵工作树干净、当前源码仍未变或最新 CI 已完成。

最终签发：**NOT VERIFIED PASS（0 Blocker、0 High、1 未决 Medium：QA-DIALOGUE-M01；1 既有 Low：A1-L01）。** 四席相关互核与 TTS 补证无新的冲突，不能抵消已确认的 QA 能力缺口或恢复本轮完整通过；须修复、全量门禁与新的完整五席 R3 复审。
