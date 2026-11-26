# CrossAudit-1-Arch-Isolation · R3 独立复审

状态：**NOT VERIFIED PASS。四席交叉互核已完成；本席架构范围 0 Blocker、0 High、0 未决 Medium、1 项既有 Low。跨席 VIS-R3-M01 Medium 未决且 R3 动态性能未采样，不能签发本轮完整通过。**

## 身份、冻结与证据边界

- 本席是 R3 新启动、未参与产品实现的独立审计官。先读 `AGENTS.md`、`README.md`、`docs/ROADMAP.md`、原始 `D:\Tencent Files\tx download\ai_studio_code (4).txt` 的完整蓝图与 Wave 5，再读 R2 架构报告。原任务明确授权六个独立、默认停用的官方可选面板，覆盖 AGENTS 的历史 backend-only 边界。
- 冻结 HEAD：`e7a4eac44bacb64f6d74dd5a028d0380b0aa69f8`。实测前后相同；启动前与实测后工作树 clean。只允许新增本报告与自有 TEMP 探针；未修改产品、测试、生成物、发行数据或其它报告，未 build、commit、push。
- `web/dist/index.html` 实测 SHA-256：`ecd63ebe23e44f17c079d4d256765e9355e24a2fee50a7e30e5e0ece643ccbfa`。主应用构建与 R2 相同不代表 QA 包和后端相同；本轮加载的是当前冻结的实际扩展包、实际后端和实际 dist。
- 真实浏览器阶段：2026-11-26 14:33:09–14:33:47，Asia/Shanghai，1440×900，既有 `C:\Program Files\Google\Chrome\Application\chrome.exe`，独立 headless persistent profile。没有安装浏览器或依赖，没有访问/重启用户 8788、8188、既有 Chrome 或 recovery，没有运行真实模型、GPU、付费 API 或用户 LoRA。
- 仅使用自有 loopback `127.0.0.1:59259`、自有运行数据、六包 ZIP 和中性 FakeVLM/FakeComfy/FakeLLM。主工作台页面及其子 frame 的 route 仅允许本夹具 origin、data 与 blob；该监测内外部请求为 0。六个直接顶层入口另以真实 HTTP CSP 阻止 connect，未把它们冒称为另一次完整外联抓包。没有保存截图、Cookie、令牌或私人存储。
- 静态生成物、字典与 HEAD 发行视图由本席派出的窄范围只读子协审独立执行，结果单独归属下文；本席未重复相同探索。浏览器与 QA 原生链由本席亲自执行，未用旧 R1/R2 证据替代。
- 启动前总控提供的新完整本地门禁：后端 1754/1754、1311.031 秒、skip 8、exit 0；前端 127 files/1076 tests、format/types/build；Ruff、Spike 80、21 个 Node 脚本、CTK 25、生成物与 HEAD 64 文件发行检查全部通过。本席没有重跑全量。
- 总控随后提供权威同 SHA CI：run `45765549054` 三作业 completed/success；Windows `139725568320` 于 06:37:04Z 完成，33m32s；Ubuntu `139725568771` 于 06:24:53Z 完成，21m21s；gate `139725568775` 于 06:22:10Z 完成，18m38s。这是总控提供的 CI 事实，不冒领为本席自行观察，也不替代下面的独立审计。

## R2 缺口与 R3 独立复核

| 项目 | 本轮证据 | 结论 |
| --- | --- | --- |
| QA-DIALOGUE-M01 · 台词契合度缺失 | 实际 UI 确认提交 → 审阅摘要的桥 → 原生 QAService → VLM prompt → 多票聚合 → SQLite/API → 实际 DOM；speaker/kind/text、独立 2/5 台词分、3 票、模型解释均贯通。场景/画质保持 4 时，仅台词票降到 2 就独立失败。 | 本席范围已关闭 Medium |
| 无角色/无锚点路径跳过实际评审 | 无参考图对白、无 cast 旁白、无 cast 无台词纯场景都实际调用 judge；另将整话 3 幕/6 候选全部设为空 cast/空台词/无角色参考，2 票/候选实际 12 次 judge，每次只有候选图 1 张。 | 已关闭 |
| 纯场景虚假身份加分 | identity=[]，scene=4/quality=4 得 0.8；scene=2/quality=4 得 0.6 且失败；scene=True/quality=5 视场景未知，得 0.5 且失败。不是沿用虚假满分身份再加画面分。 | 50/50 归一化正确 |
| A1-M01 · 取消 scope 错配 | 两包真实 blocked 任务：v2 read、read+render 目标 403 且原任务 blocked→blocked；read+write 目标 200 且 canceled。两个真实 iframe 正常填写 ID、刷新、点击停止也使原生任务 canceled。 | 保持关闭 |
| A1-M02 · 顶层恢复宿主源 | 六包正常 iframe 与直接顶层导航均 effective origin=null，localStorage 抛 SecurityError，直接 fetch 抛 TypeError；HTML HTTP CSP 含 sandbox allow-scripts。 | 保持关闭 |
| A1-L01 · 英文宿主入口固定中文 | `hostSlots.tsx:128` 菜单直接用 `panel.title`，`ExtensionFrame.tsx:147` 可访问 title 也直接用它；实际六包 metadata 没有英文变体。包内双语完整不等于宿主入口本地化。 | 既有 Low 保留 |

## 六包与精简基座的全范围实测

| 范围 | 实际操作与结果 |
| --- | --- |
| 默认停用 | 将六个实际 ZIP 提取为自有 builtin 视图，真实新 `AppContext(memory=True, autostart=False, seed_instance=False)` 显示六个 builtin=true/status=disabled、无 Python main、loaded=0、panel 目录为空。 |
| 初始精简工作台 | 真实 board：0 iframe、0 专业扩展菜单、0 `/files/` 或桥 `/requests` 实现请求。 |
| 官方安装与摘要信任 | 实际管理页逐一上传六个 ZIP；每次首次安装 disabled、builtin=false，信任对话框显示与原生 API 一致的实际 64 位 digest；明确点击信任并启用后才进入六面板目录。没有绕过生命周期直接用 HTML 作正常入口。 |
| 启用未打开 | 实际 board：0 iframe、0 面板实现资源/桥请求；metadata 目录有 6 项。没有将“发现 metadata”夸大成 0 总字节、CPU 或 RAM。 |
| 六包打开无副作用 | 六个实际话内菜单都能打开 ready 的 iframe；打开前后 Fake 模型计数和任务计数均无增加。每包声明的 episode 读取经真实桥和原生 target 均 200。 |
| iframe 沙箱 | 每包 `sandbox=allow-scripts`，无 allow-same-origin；self.origin 为 null，宿主 DOM/localStorage 均 SecurityError，绕桥 fetch `/api/series` 为 TypeError。 |
| 顶层沙箱 | 同 context 新页逐个直接导航六个实际入口 URL；self.origin 为 null，storage SecurityError、fetch TypeError。资源 HTTP CSP 实际带 `sandbox allow-scripts`。没有把 location.origin URL 字符串当作有效安全源。 |
| 六包负向桥 | 每包未声明 request=403、旧 activation=404、含 `../` 的路径参数=422；不能由 frame 任选目标 URL、headers 或凭据。 |
| 原生契约复用 | 六包 48 条 request 声明都与真实运行 OpenAPI 中唯一 typed operation 对应；scope 与真实 `required_scope()` 完全一致。没有为了修复取消将 render 提升为 write。 |
| 真实取消 | 两个包均分别测试 v2 权限和 iframe 停止按钮。补充独立原生探针固定检查 denied 前后的 job state，而不只检查 HTTP 403：四次 denied 都是 blocked→blocked。 |
| 内容变动 | 仅对本 TEMP 安装副本的入口 HTML 加中性注释，六包分别立即变为 changed，原 files 和 bridge 均 404；恢复原字节后再停用。 |
| 停用回到精简 | 六包逐一停用后，原 files/bridge 都 404；返回真实 board 后菜单/iframe/实现请求都为 0。 |
| 安全模式与卸载 | 正常重新启用六包并保存设置，关闭自有服务；以真实环境变量 `MIO_SAFE_MODE=1` 新建同数据 AppContext（不是伪造 JSON）：六包 disabled、目录为空、六入口 404、六手工 enable=400；再真实 DELETE 六包均 204，列表为空。 |
| 共享桥实现复核 | 本轮只读核对 `extensionBridge.ts` 首个 port/来源/session/版本检查、seen rid、pending AbortController、29 秒中止和 dispose；`ExtensionFrame.tsx` 导航后二次 load 撤销。对应错源/重复请求/超时的更深竞态由安全席独立实测后互核，不把源码检查冒称本席浏览器已穷尽。 |

## QA 原生链、字段与多票矩阵

原生源码链已核对：`pipeline/story.py` 领域投影 → `judge.py:17/26` 非空台词与 speaker/kind/text 提示 → `judge.py:95/152` 独立 score/note/status → `qa.py:25` 聚合与 `qa.py:261` 全候选 judge → `models.py:391` 严格字段 → 实际 API/SQLite → `qa-review/panel.js:337/358/374` 评分卡。没有将镜头、动作或人物分数更名冒充台词分。

真实 UI 主路径先选择 `fixture-p02-1`，打开确认后按 Esc 取消，确认原任务集合不变；再次明确确认后原生 job 成功。实际冻结输入含原稿对白 speaker=lin/kind=speech，3 次 FakeVLM 得到台词 2/5、3 有效票、匹配该票的证据解释；结果 passed=false，台词问题单独进入 issues、SQLite/API 与 DOM。说明中的 `<unsafe>` 原样作为文本出现，没有创建 unsafe 元素。原候选采用状态没有被自动改变；`auto_adopt=false`。

随后保持实际服务、原生 execute/aggregate/on_complete、持久化和真实 iframe 展示，独立更换中性 VLM 回答与领域输入：

| 情形 | 有效票/总票 | 台词状态与分数 | 总分/通过 | 本轮核验 |
| --- | --- | --- | --- | --- |
| 有人物但无任何参考图的对白 | 3/3 | assessed / 4 | 0.8 / true | identity=[]；每次仅候选图 1 张；prompt 明确不得判断无参考身份 |
| 无 cast 的旁白 | 3/3 | assessed / 4 | 0.8 / true | narration/speaker/text 仍逐字进入提示，真实 judge 未跳过 |
| 无 cast 无台词纯场景 | 0/3 | not_assessed / null | 0.8 / true | judge 仍调用 3 次，scene/quality=4/4、identity=[] |
| 同上，场景不符 | 0/3 | not_assessed / null | 0.6 / false | scene/quality=2/4，不赠送身份分 |
| 同上，场景布尔值 | 0/3 | not_assessed / null | 0.5 / false | scene=True 不作为 1 或有效分，quality=5 |
| 1 有效票 + 2 拒评 | 1/3 | unknown / null | 0.64 / false | 有效票没有严格过半；保留拒评说明 |
| 恰好半数有效 | 2/4 | unknown / null | 0.64 / false | 2/4 不是严格过半 |
| 四票 5、4、2、1 | 4/4 | assessed / 2 | 0.72 / false | 取 median_low=2，并保留对应的 two 解释；即使总分过 0.7 也因台词低于 3 失败 |
| true、"5"、5.0、null | 0/4 | unknown / null | 0.64 / false | 不把布尔/字符串/浮点强制转整数 |
| 空白说明、非字符串说明、缺说明 | 0/3 | unknown / null | 0.64 / false | 有分无有效解释不能伪装已评审 |

每组均检查实际输入台词与 prompt JSON 相等、实际 judge 调用数等于总票数、job result 与原生 GET episode 的完整 QA 对象相等、实际 DOM 的 `data-dialogue-status` 正确。除 UI 原路径外，矩阵通过真实 HTTP 提交原生 QA，不伪称每组都重复了 UI 提交手势。

额外整话验证两层：先确认正常混合话的 6 候选都执行 2 票共 12 次 judge；再用独立原生探针把整话所有幕的 characters/dialogues 清空、所有角色 references 清空，仍有 6 个 job item、12 次 judge，每次 1 张候选图，所有持久化结果为 votes=2、identity=[]、score=0.8、not_assessed。此处没有借已有 scene/shot 标志推算台词评分。

旧报告独立复核：把没有任何 dialogue 字段的真实旧形状经当前 `QAResult.model_validate()` 和 store 保存，实际 API 投影为 unknown；iframe 显示台词未知与 incomplete，而不是默认为 not_assessed 或完整通过。旧报告需要重评的事实没有被默认值掩盖。

## 生成物、i18n、发行视图与无重复实现

以下由本席窄范围只读子协审在同一冻结 HEAD 执行，均 exit 0；没有重跑全量或写回生成物：

- 用自有空 builtin 视图、内存 AppContext 获得真实 `/api/v2/openapi.json`，189 paths/233 operations，与提交的 `clients/openapi-v2.json` 规范字节一致；调用实际 `generator.render_client()`，Python 与 AstrBot 自包含客户端副本均完全一致。
- 真实主 API OpenAPI 按原 `gen-api.mjs` normalize、`defaultNonNullable:false`、`emptyObjectsUnknown:true` 内存生成，`web/src/api/schema.d.ts` 字节一致。
- 主站实际 TS 字典中英 2857/2857 叶键；1700 个静态 t() 键与 100 个动态键组零缺失。六包实际 AST 双语叶键集合相同：Retouch117、QA73、Finalize79、Variants87、Script76、Motion78。
- 全部 `web/src` 非测试 TS/TSX 的实际 import/export-from/literal dynamic-import AST 中，六包实现引用为 0。此证据与本席真实资源观察合用；不声称精确 AST 搜索能证明任何 computed-import 或任意混淆代码都不可能存在。
- 只使用 `git show HEAD:data/...` 构造 64 文件发行视图；实际 `check_distribution.verify()` 为 0 问题，`build_distribution.build(check=True)` 返回 0。没有读取私人 data 内容，64 个 skip-worktree 标记保持。
- 六包 manifest 的请求均调用已有原生领域 API；本轮新增台词评审位于共享 QA 原生链，生成物也对应这些原生字段，没有在扩展侧另算一份假台词分或独立保存另一份 QA 状态。

## 保留 Low

### A1-L01 · Low · 英文宿主的六个专业面板入口仍固定中文

`web/src/extensions/hostSlots.tsx:128` 和 `web/src/components/ExtensionFrame.tsx:147` 仍直接使用 manifest 的 `panel.title`。六包 metadata 没有本地化变体，中文标题会出现在英文宿主菜单与 iframe 可访问名称中。源码路径与本轮实际返回 metadata 一致；本席没有把这项写成新增英文截图实测。影响工具识别和语言一致性，不影响原生功能、沙箱、scope 或本轮签发门槛。包内双语消息与字典完整性不能关闭这项既有 Low。

## 跨席未决 Medium

### VIS-R3-M01 · Medium · 动态壁纸下变量补全浮层透出底层文字

- 视觉席实际 Chrome 390×844 观察 `#prompt-completion` 底部与下层变量、负向提示词、应用按钮叠字，稳定 1600ms 后仍存在；1440 宽也使用相同透明背景，浅/深静态主题没有该问题。真实截图和 alpha 测量归视觉席所有，本席没有重开浏览器复拍或冒领这部分。
- 本席独立只读源码互核：`web/src/styles/overlays.css:491–503` 的 `#prompt-completion` 使用 `background:var(--panel,var(--panel2))`；`web/src/app/themeBackdrop.css` 已为动态壁纸的 dialog/drawer 等浮层使用 `var(--wallpaper-surface)`，但其白名单确实遗漏 `#prompt-completion`。这与视觉席的实际症状吻合。
- 建议仅将该控件加入现有动态 opaque selector，不需要新 backdrop-filter；这种局部样式改动不触及菜单、MessagePort、CSP、sandbox、领域 API 或六包加载生命周期，与本席架构结论无冲突。源码审计不能代替修复后的真实两宽/三主题复验，也不能把这项真实体验 Medium 降级为 Low。
- 本席已经通知总控；没有在冻结 HEAD 上擅自修复。本席 QA/隔离/生成物通过与同 SHA CI 全绿均不能抵消该缺陷，R3 整体必须 NOT VERIFIED PASS。

## 探针自身限制与纠正

- 主浏览器探针和原生补充探针都一次 exit 0，无产品断言失败、无浏览器 pageerror。一次夹具用 model_copy 写入已定义的 narration 字符串而非枚举实例，Pydantic 给出 serializer warning；值在领域模型中合法，实际 prompt/API 使用同一 narration 值，没有由此改变产品。
- 初始取消探针的 denied state 断言没有固定比较调用前状态。因此另写独立原生补充探针，重新建立真实 blocked 任务，明确记录四次 403 前后均 blocked，并确认 write 200 后 canceled；只用补充后的实证支持“denied 不变”。没有隐瞒或用无效断言替代验证。
- 本席真实 Chrome 架构覆盖 1440×900；390px、完整主题/键盘/性能矩阵属于其它四席独立范围。安全模式的实际 AppContext 重开通过 TestClient 执行，没有声称为第二轮 Chrome 导航。没有真实 Linux 本席浏览器、真实付费模型效果、实体扬声器、瓦数或 VRAM 结论。

## 强制交叉互核

- 已向 Visual、Feel、Perf、Chaos 四席发送本轮精确冻结结果与限制，要求核对冲突。Feel 于 14:50:54+08 完成全部实测并核对 owned Chrome/Python=0、8 个补测端口全关闭，结论 VERIFIED PASS、0B/H/M，保留 FEEL-L02 Low。其双视口 26 个独立原生 QA UI job 均为 job=API=SQLite，严格过半/中位对应票说明、无参考/无台词/纯场景 50/50、旧报告重评及不自动采用的结论与本席一致；其六包核心/错误态、变体四轴、键盘、全屏/TTS 无隔离冲突。拒绝后 BODY 焦点 Low 属该席证据，本席正常读桥流程不能反证它。
- Visual 确认固定中文入口 Low 与本席一致；随后报告 VIS-R3-M01 真 Medium，本席完成上述源码与隔离影响互核并同意全轮不得通过。该席于 14:56:31+08 完成计划测量，8 运行/49 条记录核对 owned Chrome/fixture 精确 PID+creation time alive=[]、所有 owned 端口关闭，全部 exec exit 0，不再打开 Chrome；其主界面48、专业84、模板300、新 QA30 原生链与最后36 hover/focus视觉检查均闭合，唯一真 Medium 仍为 VIS-R3-M01，报告 NOT VERIFIED PASS。上述视觉检查数量和图像结论均归该席所有，不冒领为本席测试。
- Chaos 已全部结束并关闭自有 Chrome，最终纯文字互核无冲突：其六顶层与六 iframe opaque/null/storage+cookie SecurityError/fetch TypeError，与本席一致；MessagePort 错 session 无 HTTP、未声明403、重复 rid200+409 且仅一次 HTTP、wrong-source ready 零回复、导航 about:blank 撤销后无新 HTTP，支持本席源码检查。其真实 queued edit 两并发 cancel=200+200→native canceled、0 Comfy/0 新 take，与本席取消 scope 相容；六包先资源 tamper404/后 catalog changed、旧 digest400/旧 activation404，以及真实安全模式 loaded0/panels空/enable400/entry404，也均一致。其四槽 slow-body 29.01s abort/pending0、POST 已写超时不重放/不假回滚、SPA abort 与监听器/URL 清理通过；这些是安全席实测归属，不冒领为本席已执行。没有安全加固妨碍本席正常读取、取消或 QA 的冲突；该席同样保留 VIS-R3-M01 并认定整轮 NOTPASS。
- Chaos 随后主动修正网络证据边界：其主探针为全部 context 安装了外联 guard，但聚合时没有保留各 run 的 external 数组，因此不再宣称主探针“完整保留的 0 外联尝试”；另一个独立 HTML 隐私 probe 的 `external_requests=[]` 确有保留。本席接受修正，不以遗漏的计数补强本席直接顶层页的全量网络观察，保留各自真实 CSP/fetch 与已记录范围。
- Perf 确认总控因 VIS-R3-M01 取消 R3 动态采样；该席没有获得排他窗口、没有启动 Chrome/服务，也没有动态测量，签 NOT VERIFIED/未采样。其实际 dist81 文件/2,424,023 字节与 R2 相同仅证明构建身份；QA 后端和 panel.js 已改变，不能让 R2 性能 PASS 顶替 R3。该席与本席文字互核一致：三态 iframe/实现请求为 0 是资源隔离证据，不代表 CPU、RAM、合成器或整轮性能已通过。
- 四席都已提供终态或明确未执行范围，交叉互核没有新的架构/交互/安全/性能表述冲突；本席在全部 runtime 结束后才完成最终签发。即使其它领域通过，也不能消除 VIS-R3-M01 或填补未采样的 R3 性能。

## 自有证据与清理

- 自有 TEMP：`C:\Users\QIU\AppData\Local\Temp\mio-cross-arch-r3-6kp1wzly`。本席浏览器 profile、ZIP、运行数据、builtin 副本及本 TEMP 内的 `.workspace.mio-recovery` 已删除；从未触碰用户接手的其它 recovery。
- 自有服务与驱动同进程 PID=14044、creation time=1795674788.0697064，脚本 exit 0。自有 Chrome profile 进程按精确路径记录 PID 与 creation time：11000/1795674791.8279102、20488/1795674792.0182748、21332/1795674792.0729413、42076/1795674791.983131、42480/1795674791.8623674、44572/1795674791.9994562、46508/1795674792.0927594、49920/1795674792.0468762。14:33:46 context 自然 close，随后服务 graceful should_exit 并 join；精确 PID+creation time 复核全不存在，59259 connect_ex=10061（拒绝连接）。没有全局终止任何 Chrome/Python。
- 主探针 SHA-256 `9c2e2aa95525a17bc4fc69da886aa9f205af49d11dcf3bebaf6be546dc3f651c`；纯场景/builtin 补探针 `10135766c46f8ef4393c4e49aeb30865ebd29265445feb16246a66db4e9c8eab`；取消状态补探针 `91beac7ae85f2af1bbb15cfdfbbe2d7b3745f8d1fc53e31ae5db5a9126153a2f`。三支均 exit 0；共 17 项 check，无 failures。最终紧凑证据 `summary.json` 为 13,625 字节，SHA-256 `76324ede62bcdad3f5c9aeaff8733d92a5c322d5ff7969050ee2bc10cb69f544`；终盘已将该文件及本席整个 TEMP 删除并核对 exists=false，只留下本报告中的证据记录。
- 静态协审自有 TEMP `mio-r3-static-nb9lvmh4` 已完整删除（exists=false）。Python/Node 探针 SHA 分别为 `8beefa0fbd45342e88bb0724f113f117a6d473baadf5a99a9e76489f391900d4`、`bf28b9bb1d7fd8e9e03733263d5566443f2d08e861c40b0ff7e6dc182b4352fd`；结果摘要 SHA 分别 `f8f89f86be2c7c83971a4eb5abcbefaa724b0b1cf60250394db5c4050cbd66be`、`d36b0b96f107221a0109b62b8fc4deecc0e9c58f26cf5d27652180036c4f0898`。

最终签发：**NOT VERIFIED PASS。** 本席实测与静态协审的架构/精简基座/六包生命周期/原生取消/QA 台词链/生成物/i18n/HEAD 发行视图均通过，QA-DIALOGUE-M01 在本席范围关闭；保留 A1-L01 Low。跨席 VIS-R3-M01 是未决真实 Medium，R3 性能动态测量未执行；须在修复后完成新全量门禁与全新五席完整 R4，不能仅重测该 CSS 点或借用 R2/R3 局部通过证据结束终验。
