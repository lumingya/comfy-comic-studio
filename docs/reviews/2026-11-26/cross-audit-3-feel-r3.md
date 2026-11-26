# CrossAudit-3-Feel-Keyboard · R3 交互、键盘与无障碍复审

签发：**NOT VERIFIED PASS（R3 整体）**。本席实际交互未发现新增 Blocker / High / Medium，保留既有 **FEEL-L02 Low**；互核确认视觉席的 **VIS-R3-M01 Medium** 未决，且性能席本轮未获独占窗口、未执行新采样，故不能签发整体通过。以下成功证据保留，不用键盘逻辑通过抵消动态壁纸下的可读性缺陷。

## 对象与隔离

- 日期：2026-11-26，Asia/Shanghai。本席为未参与前期产品编码的全新独立 R3 审计代理。
- 冻结 HEAD：`e7a4eac44bacb64f6d74dd5a028d0380b0aa69f8`，开始时工作区 clean，浏览器结束后 HEAD 未变。
- 实际 `web/dist/index.html` SHA-256：`ecd63ebe23e44f17c079d4d256765e9355e24a2fee50a7e30e5e0ece643ccbfa`，结束读回未变；未重新 build。
- 已读 AGENTS、README、ROADMAP、原任务 `D:\Tencent Files\tx download\ai_studio_code (4).txt` 与历史 R2 报告。六项专业能力按用户原任务作为独立、默认停用面板验收，不以旧的后端-only表述排除。
- 总控提供的启动前全量门禁：后端 1754/1754、1311.031s、skipped 8、exit 0；前端 127 files / 1076 tests、59.40s，format / type / build 及 Ruff、Spike、Node、CTK、生成物、文档链接、HEAD 随包发行数据均通过。本席未重跑这些门禁，未把转述记录伪称为本席实测。
- 已安装 Chrome `158.0.8127.37`，真实无头 Chrome，1440×900 与 390×844；基线 light，补测 dark。390 上使用真实 CDP touch 与 IME 输入传输；鼠标、按键、焦点和 fullscreen / speech synthesis 均由真实浏览器处理。
- 使用仓库 `roadmap_browser_fixture`、`professional_browser_fixture` 的中性 FakeComfy / FakeLLM / FakeVLM，加本席独立夹具适配器。自建随机 loopback 端口、新上下文、临时数据；安装 ZIP 源于冻结 `extensions/`，实际审阅摘要并信任启用。浏览器资源请求限自有同源、blob / data，未调用付费模型或真实 GPU。
- 未访问用户 8788、8188、已有 Chrome、私人 runtime 或任何未知恢复目录；未碰用户接管的 `mio-bridge-deadline-r1-95gw1ljr\.workspace.mio-recovery`。只写本报告和本席唯一 TEMP，产品、测试、生成物、其它报告未改。
- 本席浏览器与服务在 **14:50:54 +08:00** 已全部关闭并验证；之后只做文字互核、报告和 TEMP 清理，没有重开 Chrome。

## 双视口真实输入结果

| 范围 | 实际结果 | 边界 |
|---|---|---|
| 日常六链路基线 | 合集、补全、120 幕本地拆幕、候选比较、四步引导、模板微调，共 12/12 通过 | light；不是 dynamic 可读性证据 |
| 六专业面板基线 | 双视口六包核心、空态、503、人工恢复及停用/卸载，12 核心 + 2 生命周期 = 14/14 | 真实 UI → 领域服务，图像和模型由本地 Fake 提供 |
| 合集归档 | 单本/多本直拖、数量 ghost、高亮、撤销/CAS、合集内阅读返回保持归属通过 | 非默认新增工具栏替代品 |
| 精确阈值与稳定排序 | 5px 不抬起，6px 抬起；逆序 Ctrl 点选乙、甲，拖甲到丙后实际丙甲乙；Undo 回甲乙丙 | 双视口；普通 Ctrl 多选，未将专用“批量管理”旧模式冒称为可排序 |
| 触屏与键盘合集 | 手机原生 touch swipe 实际滚动，不误出 ghost 或归类；Enter/方向键/Enter 移至合集；Esc 先取消拖动、再退出多选 | 真实 CDP touch，不声称所有物理触屏设备均验证 |
| 补全与 IME | 提示词/台词上下、Enter、Tab、Esc；实际 option 包含来源角色和 `calm navigator` 值预览；CDP composition 时菜单关闭，Enter 不误吞成 `{林夏}`；保存后领域 prompt/dialogue 正确 | light/dark；未覆盖视觉席所报 dynamic 叠字 |
| 本地拆幕 | 120 幕 Markdown 即时预览、24 行 + 剩余 96 提示，确认才一次导入，原幕与候选保留 | 零 LLM，本地规则；未用后端直写代替 UI 导入 |
| 拆幕退出 | 真实 Enter 打开，8 次 Tab 留在弹窗；Esc、取消、X、成功导入、503 后人工重试成功，均回原“从文本拆幕”触发按钮 | 错误呈现于宿主 Toast，弹窗保留原输入 |
| 任意候选比较 | 独立增加到 7 张，明确固定第 4 张、用真实方向键浏览到第 7 张；两个 asset id 与 API 一致；52% 键盘滑杆、2× 同步 zoom/pan、左右两侧独立显式采用、Esc 回原第 4 张卡片焦点 | 不是只测前两张；比较本身不采用 |
| 引导 | 四步都进入真实路由；新 context 仅显示可关闭的行内检查单、不强弹对话框，关闭后刷新仍隐藏；已有 `mio.ui` 的 context 不提示，可从帮助主动重开 | “fresh”按实际本地标记语义验证，未声称检测了所有跨机器工作区来源 |
| 三既有模板 | Monograph / Nocturne / Folio × 双视口，副标题、封面焦点 1%/100%、关闭章节页眉实时进入原生预览；内层全屏试读 Esc 回试读按钮 | 本席验证交互与值传递；全模板极端视觉矩阵归视觉席 |
| 修图 | 画笔、橡皮、矩形均用 Space/Enter 和方向键真实绘制；Esc 精确取消、Tab 完成笔画、Undo/Redo；反选 + 羽化 1px 实际上传 mask asset 并提交 inpaint，outpaint 左扩 64px、instruction edit 各完成新 Fake 任务 | 原采纳始终保留，直到人工确认采用；未推导真实模型修图质量 |
| 成品工坊 | 基线双阶段任务、对比、回退；补充纯键盘 Space 勾选/同意、Enter 提交/刷新/回退，真实 Job 两阶段 completed | 生成精修结果原生采用与回退是此专用领域流程 |
| 剧本与 pacing | 基线逐项 Diff、锁定不可选、显式子集应用、原候选保留、过期版本冲突与刷新、节奏建议选择/应用通过 | 未把建议自动应用到全部原稿 |
| 四轴变体 | 结构化角色/服装/场景/画风各两项，原生 16 行；实际保留索引 0/3/6/9/15 共 5 个组合，保存无出图；只选 p02、每幕 2 图，UI 估算 10 图，completed 原生 Job 10 ItemSpec | 逐项从 `input.meta` 读取 variant/panel/candidate/prompt，对四轴实际 tag 和 style marker 校验，不是仅重命名版本 |
| 动态漫 | 领域 motion 保存、scrub End=100、宿主主动下载；草稿重读 Esc 保留 4.5 秒并回 load；play/Esc 回 play；真实 Enter 激活原生 fullscreen，settled 后 stage=true，Esc 退出 | 不改 iframe allow/origin，不以 DOM 伪造全屏 |
| 原生 TTS | 双视口本机 Huihui 原生 voice，真实点击 trusted=true、activation=true；真实 utterance `凌晨两点。`，收到可信 start → boundary → end，无 error | 只被动透传记录原生调用/事件，无 stub、无合成成功事件、无录音/音质声明 |
| 六面板 Tab | 当时可见且启用控件逐一真实 Tab 可达：retouch 21、finalize 15、QA 30、script 5、variants 26、motion 17，双视口全部通过 | script 此次是尚未生成建议的可见状态；闭合 details 内字段不错误算作当前 Tab 控件 |

修图使用透传 `render` 观察包装只保存原生 editor 实例引用，再从其 mask canvas 读取像素，避免把显示游标算成蒙版。原方法原样调用、实际绘制全部仍来自真实按键。双视口原生 240×320 蒙版统计一致：画笔 1444 个非零 alpha 像素，橡皮后 612，矩形后 733；取消绘制前后原生 mask 统计完全相等。没有用测试代码直接调用绘图/撤销方法。

## QA-DIALOGUE-M01 的新链路独立复核

两视口分别 **13 个新 UI QA Job，共 26 个**。每次由实际“读取候选 → 勾选 fixture-p02-1 → 评审所选 → 确认 → 刷新”发起新任务；读取实际新 Job 的 ItemSpec/result、`/api/episodes/{id}` 和本席隔离 `mio.sqlite3` 中 episode `payload_json`，三者 `qa` 完全相等，再检查实际评分卡。每项确有 3 次新视觉评审调用，不把 HTTP 422、旧 Job 或既有报告当新评审。

| 原始模型响应/作品边界 | 原生结果（两视口相同） | UI/领域结果 |
|---|---|---|
| 正常台词 4/5 | assessed，3 有效票，score .896，passed=true | 评分与原模型解释显示 |
| 台词 2/5 不匹配 | assessed，3 票，score .816，passed=false | 高综合分也不能跨过台词最低门槛 |
| 拒答 null、字符串 `"5"`、布尔 true、越界 6 | unknown，0 有效票，score .736，passed=false | 不把类型强转或未知显示成通过 |
| 1/3 有效票 | unknown，dialogue_votes=1，passed=false | 少数有效票不能隐藏另外两票拒答 |
| 2/3 有效票 5、4、null | assessed，dialogue_votes=2，median_low=4 | 解释取实际 4 分的第二票注释，不取不对应的第一票 |
| 无参考图、有台词 | anchors={}、identity=[]，仍 3 次单图评审，score .8 | 无身份参考不免费补满分 |
| 无参考、无台词 | dialogue not_assessed、0 台词票，但视觉 votes=3、score .8 | 继续评构图与画质，不整项跳过 |
| 无角色、无台词纯场景 | 单图视觉评审 3 次，scene=4、quality=4，score .8 | 不是 votes=0 的满分豁免 |
| 纯场景 scene 为字符串、quality 为布尔 | shot_ok=null、score 0、passed=false | 无视觉有效评分不能通过 |
| 旧报告 votes=0、score .99 后明确重评 | 新模型字段与新 3 票替换旧报告，台词 2 分、不通过 | 不沿用 .99 掩盖缺失维度 |

台词 ItemSpec 保留 `speaker=lin`、`kind=speech`、真实文本 `又是你啊。`；模型注释回到 native QAResult 和实际 DOM。动作描述 `looking at her phone` 没有被当作台词替身。基线还核对包含 `<unsafe>` 的原注释是文字、没有生成该标签。

**采纳边界单独验证**：上述 UI 评审新 Job 的 `snapshot.auto_adopt=false`，评审前后每张 take.status 不变。随后真实“评审整话 → 采纳每幕最高分 → 确认”的显式手工操作把 `adopted_by` 标为 `user`；它是人工覆盖，不能称后台自动挑选。另经本地原生 `/qa` 起 `auto_adopt=true` 的新 Job，每视口三组：人工已采用保护、自由候选实际标 `auto` 采用、纯场景有效视觉证据实际标 `auto` 采用。UI 与 native auto 两条链路不混算。

本席确认旧 QA-DIALOGUE-M01 的指定缺口在本冻结对象上有新的端到端成功证据；这不等于真实 VLM 模型质量或整轮所有要求已通过。

## 未决项、探针纠正与互核

### FEEL-L02 · Low · 既有，仍存在

双视口实际“评审整话 → 明确批量采纳 → 用 Enter 激活 p02 拒绝”，状态正确变更，原按钮随重绘移除，iframe `activeElement={tag:BODY,id:""}`。这是本轮真实复现，不因别处焦点修复而宣称关闭。建议以后将焦点转回同幕标题或相邻操作。

### VIS-R3-M01 · Medium · 视觉席发现，本席文字互核

视觉席报告 dynamic 下 `#prompt-completion` 背景约 68% 透明，390 选项下部与下层提示/负向/按钮叠字；等待 1600ms、动画为 0 仍复现，light/dark 不透明正常。该项已报总控。本席补全的 light/dark 键盘、IME、边界检查不反证该缺陷，且在收到消息前已关闭浏览器，未重开伪造“独立 dynamic 复测”。仅调整该 dynamic surface 为不透明与本席的 listbox/aria/focus/IME 逻辑无契约冲突，仍需修后真实页面复验。

探针错误全部保留于紧凑 JSON，不归成产品缺陷：

- 起初把 `subprocess.Popen` 换成函数导致 asyncio 继承失败；改为继承原类，启动成功。一次错误用专业工具 `run` 的旧签名；按当前 args schema 改正，只补该阶段。
- 最初假设候选按升序导航，误落第 1 张；改为读当前真实 asset 并用真实方向键导航到第 7 张，再完成完整 split/adopt/focus。
- 初次把拆幕 503 错误断言在弹窗内，实际错误在宿主 Toast；修改观察位置后，相同产品构建人工重试与回焦点通过。
- 早期从显示 canvas 读像素，游标导致取消前后统计不同；改为透传观察 native mask canvas，所有绘图仍来自真实输入，精确取消通过。
- 初次四轴选到未在该话使用的 `coat` 目标槽，被正确阻止；改选真实 `default` 槽。另一次读 Job 把 `input.meta.panel_id` 误写 `input.panel_id`，改正后原生 10 项与四轴 prompt 全通过。
- Tab 预期初版误含闭合 details 子字段；剧本空意图时 propose 按钮本来应 disabled。只把实际可见控件算入、输入意图后，双视口六包 Tab 全可达。

已完成四席纯文字互核：

- 架构席：其原生 QA/opaque iframe/取消与本席 26 个 UI Job、SQLite、严格多数及手工/auto 分界一致；其正常加载成功不反证本席拒绝后的 Low。
- 视觉席：键盘可达、内层 Esc、模板和值传递无冲突；明确接受 dynamic popup 的 Medium 可读性缺陷，不混成焦点通过即可关闭。
- 性能席：因该 Medium 总控取消本轮采样；其未启动 Chrome/服务、未获窗口，结论 NOT VERIFIED。本席没有 CPU/GPU/瓦数/VRAM 证据，不用 R2 或 Fake 交互抵充新性能验收。
- 可靠性席：六包 503/offline/deadline 后人工恢复、不重放 POST、原生 QA 类型/多数与无参考边界无冲突；其长恶意注释与 legacy UI 补充按该席来源保留，本席不伪称亲自重跑其全部矩阵。

## 清理与最终边界

- 每个自建服务记录 PID、creation time、端口和本席数据路径；Chrome 进程创建信息在本席证据中保留。context/browser 正常 close，服务 terminate/wait；**14:50:54 +08:00** 精确 TEMP 匹配的 Chrome/Python 为 0，自有补测 8 个端口全部连接拒绝：52282、65521、64296、52530、60185、53048、63341、62700。另基线服务 59865 已由原工具 finally terminate/wait 完成。
- 已通知总控与性能席释放窗口，此后不再开浏览器。没有杀用户既有进程、访问别人的工作区或全局扫描 `mio*`。
- 本席 TEMP 精确根：`C:\Users\QIU\AppData\Local\Temp\mio-cross-feel-r3-53e814`。已清理自己 40 个直接项、553 个文件、17,792,187 bytes；自有 fixture 工作区及它们由 helper 产生的 recovery 副本也仅在这个根内清理，未碰其它 TEMP/recovery。
- 最终只保留 `feel-r3-summary.json`，208,116 bytes，SHA-256 `48fdfbeb12d3ae8c3eddd955e2270fbc58e0d0899f94f012a26860dd383481c5`。包含新 Job/原生结果、PID/creation、焦点、TTS 事件、成功矩阵与探针错误；过长探针文字保留摘要和原始 hash。未生成或遗留截图、大图、用户数据。
- IME 仅声称 Chrome CDP composition 传输与按键边界；没有实际操作系统中文候选窗、读屏器音频或所有输入法证明。TTS 只声称原生动作与事件，不声称音质。真实 GPU、付费 VLM、真实生成质量、瓦数及 VRAM 不在本席 Fake/浏览器证据内。

最终：本席交互结果无新增 B/H/M；既有 FEEL-L02 Low 仍在。**R3 整体 NOT VERIFIED PASS**，VIS-R3-M01 未决，性能新采样未完成；修复后应在新冻结对象下重新进行要求的验证，不能回填本报告为通过。
