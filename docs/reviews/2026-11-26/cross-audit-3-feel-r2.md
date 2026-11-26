# CrossAudit-3-Feel-Keyboard · R2 交互、键盘与无障碍复审

签发更新：**NOT VERIFIED PASS（R2 整体）**。0 Blocker、0 High、1 未决 Medium（晚发现的 QA-DIALOGUE-M01）；保留 1 项已存在的 Low（FEEL-L02）。下列已有交互成功证据全部保留，新增两宽度原生语音动作补证也通过，但不能冲抵 QA 能力缺口。本结论不替代其他四席的专项结论，也不将尚在进行的 CI 记为成功。

## 固定对象、前置证据与隔离

- 日期：2026-11-26，Asia/Shanghai；本席是未参与产品实现的全新独立 R2 审计代理。
- 冻结 HEAD：`5569dc294fd16c7478abbd31317da7e9055c3be7`。
- 实际 `web/dist/index.html` SHA-256：`ecd63ebe23e44f17c079d4d256765e9355e24a2fee50a7e30e5e0ece643ccbfa`。浏览器结束后的 HEAD 与该指纹均未变化。
- 已读 AGENTS、README、ROADMAP、原任务 `D:\Tencent Files\tx download\ai_studio_code (4).txt`，以及 Playwright、UTF-8 文本保护技能。按用户明确授权复审六个独立、默认停用的专业扩展，不以旧后端-only约定排除验收。
- 总控提供的 R2 启动前置记录：本机 backend 1738/1738（skipped 8），11:09:53 结束、exit 0；前端 127 files / 1076 tests、type/format/build、Ruff、Spike、Node、CTK、生成物与发行数据检查通过。本席未重复全量测试、未重建 dist。CI `45745955229` 的最终状态由总控另行记录。
- 本机已安装 Chrome `158.0.8127.37`；1440×900 与 390×844，全新无头上下文、独立端口和临时数据。沿用仓库 Python Playwright 路径；未安装浏览器、依赖或运行下载式 npx。
- 所有服务为本席 disposable fixture；FakeComfy/FakeLLM/FakeVLM 只生成中性本地结果。浏览器外部请求一律拦截；未访问用户标签页、8788/8188、私人 runtime、受保护随包文件或付费模型。
- 产品文件只读。本席唯一仓库写入为本报告；所有探针、工作区、包副本和 Chrome 临时内容均在自己的唯一 TEMP 中。

## 实际执行与通过证据

先阅读现有 browser fixture / steps 的断言边界，执行基线，再用独立 TEMP 探针添加对抗观察。鼠标、键盘和触屏均为真实 Chrome 输入；DOM evaluate 只用于读取像素、活动元素、边界、语义、变换和全屏状态，未用脚本 click/keydown 代替真实输入。基线通过不直接等同于验收通过。

| 区域 | 双视口实际观察 | 结论 |
|---|---|---|
| 日常六链路基线 | 合集、变量补全、本地拆幕、候选比较、四步引导、模板微调，共 12/12；无非预期错误或外部请求 | 通过 |
| 六专业面板基线 | 核心链路、空态、503、显式人工恢复及安装/摘要信任/停用/卸载，12 个面板案例 + 2 个生命周期案例，14/14 | 通过 |
| 合集与组排序 | 单/多本拖合集、数量 ghost 与目标高亮、稳定顺序、撤销/CAS；独立精确检查 5px 不抬起、6px 抬起；Ctrl 逆序点击与空白框选两条路径均将甲乙整体拖至丙后得到丙甲乙，再 Undo 得甲乙丙 | 通过 |
| 触屏和键盘合集 | 390 CDP 原生 touch swipe 实际滚动，未出现 ghost、未提交归类；Enter 打开移至合集菜单、方向键移动、Enter 确认；Esc 先取消拖动再退出多选 | 通过 |
| `{变量}` 补全与 IME | 提示词和台词均实操上下/Enter/Tab/Esc，菜单有来源和值预览；原生 CDP `Input.imeSetComposition` 期间菜单关闭，真实 Enter 不误选 `{林夏}`，提交后提示词与台词领域数据正确 | 通过 |
| 本地拆幕 | Markdown 120 幕实时预览、24 行与剩余 96 提示；确认仅一次导入，原分幕和候选保留；空输入不可导入；空行/第2幕/Markdown 混合三幕实时更新；503 留在弹窗并保存输入，人工重试成功 | 通过 |
| 拆幕关闭与焦点 | 从真实触发按钮 Enter 打开；12 次 Tab 留在弹窗；分别实操 Esc、取消、X、成功导入四种退出，全部回到原“从文本拆幕”按钮，父 script 视图保留 | 通过 |
| 任意两候选比较 | 固定第三张 `creative-take-0-2`、浏览另一侧；鼠标滑杆约 35%，方向键/Shift/Home/End 微调；2× 同步 zoom/pan 两边 transform 一致；比较不写采纳，显式采纳只写一次，左右两侧均可操作；Esc 返回原卡片焦点 | 通过 |
| 四步新手引导 | 四项分别进入真实服务、工作流装配、示例阅读、开始创作路由；示例阅读完成状态出现；没有因此提交出图 | 通过 |
| 三模板微调 | Monograph / Nocturne / Folio × 两视口：副标题、1%/100% 封面焦点、页眉隐藏实时同步；全屏试读的内层 Esc 回到试读按钮；未保存确认取消后编辑保留 | 通过 |
| 修图键盘绘制 | 方向键位置 121,161 → 122,161，Shift+下 → 122,171；Space/Enter 画笔、橡皮和矩形实际改变像素；Undo 归零、Redo 还原；绘制中 Esc 后像素精确等于绘制前；Tab/blur 将笔画提交为一次撤销；resize 保留蒙版，鼠标与真实 touch 仍可绘制 | 通过 |
| 修图领域结果 | 矩形蒙版提交后 FakeComfy 任务完成，旧采纳保留为原图直至显式确认采纳；取消采纳不改变原图，重复相同请求不另起任务 | 通过 |
| QA | 单幕与整话评审、严重度筛选、问题定位、明确批量最高分采纳与人工拒绝推翻；任务与候选状态正确，已锁幕保护 | 通过；焦点 Low 另列 |
| 成品工坊 | 鼠标基线及独立纯键盘 Space 选择/同意、Enter 提交；真实两阶段 Fake 队列 completed，滑杆 End=90，一键回退后原草稿重新 adopted | 通过 |
| 剧本助手 | 逐条 Diff、锁定项不可选、显式创建检查点、仅选一项应用、原候选保留、过期版本冲突拦截、节奏建议选择/应用；两条节奏 checkbox 各有唯一实际可访问名称，中文/英文切换保留选择 | 通过 |
| 动态漫 | 草稿重读确认 Esc 保留 4.5 秒输入并回 load；保存后领域 motion 正确；播放 Esc 回 play；真实 Enter 激活全屏按钮，等待原生转换完成后 `fullscreenEnabled=true`、`fullscreenElement===stage`，Esc 正常退出；主动宿主下载离线 HTML；后补两宽度真实试听点击触发原生 utterance、speak 与 start/boundary/end | 已覆盖动作通过；不声称音质 |
| 六面板 Tab | 逐一用真实 Tab 遍历当时全部可见、启用控件；两视口分别 21/15/30/10/26/17 个控件，12/12 全部可达；关闭 details 内字段不伪算为当前可见控件 | 通过 |

修图像素例证（不含键盘游标）：1440 画笔 7792 非透明像素、Undo 0、橡皮后 1111、矩形 926；390 分别为 2001、0、285、239。Esc 取消前后整组画布统计完全一致；resize 后仍有绘制像素。已查看两张实际截图，焦点游标和可见轮廓正常，截图随后删除。

## FEEL-M05 四轴专项复核

不是只读卡片名称或调用 model 自测。两个视口分别从真实面板操作“结构化设定集”与“分镜预设变量”两种来源：

1. 独立选择角色、服装、场景、画风，各 2 个，UI 实时显示 2×2×2×2=16；24 个组合仍允许，36 个组合在保存前被拦截。
2. 在 16 行矩阵中只保留 5 个组合；只选 p02，候选数为 2。预览明确显示“5 个版本 × 1 幕 = 5 个分幕任务 · 10 张候选图”。保存仅持久化原生 VariantSet，未出图。
3. 明确生成后，实际 completed FakeComfy Job 有 10 个 ItemSpec。逐项核对 `panel_id=p02`、`variant_id` 属于所选 5 个、候选索引和最终 prompt；对应角色、服装、场景、画风标记都与各自 VariantSet 一致，没有只更名而不改变实际输入。
4. 以一个基准版本分别选择 character/outfit/scene/style 比较，每次都只显示保持另三轴不变的两个版本、共 4 张候选。
5. 清空其他轴只选画风时，结构化 VariantSet 的 characters/outfits/locations 均为空；变量来源只写 style，未复制预设中的其他变量。另起 p01 的实际任务，最终 prompt 为 `BASECHAR, LOCALOUTFIT, BASESCENE, FEELSTYLE1, PRESERVEKEEP`，证明未选轴继承、逐幕服装局部值和无关变量保留。
6. 将场景绑定切换到本话未引用的 `unused`，相应选择真实 disabled，不能保存无效组合。双来源与双视口均完成上述实际操作。

## R1 发现处置与保留项

| R1 项 | R2 结果 |
|---|---|
| FEEL-M01 全屏权限 | 已实操闭环。真实 trusted Enter + settled 状态进入/退出；无需修改 iframe 权限或放宽 origin，架构和可靠性席独立实测一致 |
| FEEL-M02 拆幕焦点 | Esc、取消、X、成功、503 后人工重试全部返回原 trigger，父视图保留 |
| FEEL-M03 pacing 无名称 | 原生 aria snapshot 与真实名称确认两条可区分，中英文名称切换且选中项保留 |
| FEEL-M04 无键盘蒙版 | 三工具均可真实键盘绘制，像素、撤销、取消、blur、resize 和指针回归通过 |
| FEEL-M05 两维能力缺口 | 两来源四轴真实 UI、持久化、ItemSpec、比较与继承保护通过 |
| FEEL-L01 草稿确认 Esc | 已闭环，草稿保留且返回读取按钮 |
| FEEL-L02 QA 拒绝后焦点 | **仍存在，Low**：整话评审 → 批量采纳 → 对 p02 已采纳图用 Enter 激活“拒绝”；领域状态正确为 rejected，但移除原动作后 iframe `activeElement=BODY`。1440/390 均复现。没有使拒绝失败，建议后续将焦点归还同幕标题或相邻操作 |

专用“批量管理”模式保留旧 `sortable: !bulk` 行为。已用 `git show d9cfa801...:web/src/pages/works/WorksPage.tsx` 核对 R1 基线相同；该入口提示承诺批量星标、导出、删除，未承诺排序。正常 Ctrl/框选排序、批量归类与键盘菜单替代均真实通过。本报告不笼统宣称所有多选模式都可排序。

## 原始失败与探针错误（不混作产品缺陷）

- 初次在真实 Enter 后 300ms 读取 fullscreenElement，两个视口尚未完成全屏转换；改为等待原生转换 settled（1200ms）后，同一构建两视口均 stage=true、enabled=true、hasBeenActive=true，Esc 退出通过。未修改 DOM allow 或产品源码，也没有策略拒绝错误。因此撤销“疑似权限回归”的初步判断。
- 第一版通用流量收集器把 ZIP 上传当 JSON 解码，产生 UnicodeDecodeError；改用独立的仅同源拦截收集方式后完成。该错误来自探针，不是安装流程失败。
- 初版键盘助手在异步 busy 时过早发键、Show/Derive 未完成就读取计数，另有 `input:checked` 的 nth 在取消选择后移动；改为等待 enabled/完成条件及稳定选择器后，四轴、成品键盘等实际结果通过。
- 英文名称断言误写 Panel，而真实可访问名称为 Scene 1 / Scene 2；更正后中英切换与选中状态实际通过。
- Tab 探针初版错误传递 Locator.evaluate 参数，并把关闭 details 内的三个字段算成当前可见可 Tab；修正方法后，六面板两个视口实际完整遍历通过。
- 一次独立 fixture 在 readiness 阶段退出且日志为空；使用新的唯一目录/端口后实际场景完成，没有把启动探针失败归到产品。原始阶段和归类保留在 JSON 的 `probe_errors`。

## 原生语音最小补证与晚发现能力缺口

- 总控在性能独占窗口完全释放后明确放行。2026-11-26 12:11:21–12:11:37 +08:00，只对原冻结 HEAD `5569dc294fd16c7478abbd31317da7e9055c3be7`、原 dist 指纹补测 1440×900 和 390×844；没有重跑其它矩阵。独立 fixture 为 `127.0.0.1:52046`，只安装 motion-studio，全部页面外部请求被阻止。
- 对原生 `speechSynthesis.speak` 安装只记录并以 `Reflect.apply(original, this, [utterance])` 原样调用的透传包装，原方法字符串为 `function speak() { [native code] }`。只给真实 utterance 附加被动事件监听；没有 stub、结果替换、参数修改、合成成功事件或录音。
- 两宽度各一次真实鼠标点击 `#voice-preview`：点击 `isTrusted=true`，用户激活为 true；各实际传入一个 `SpeechSynthesisUtterance`，文本“凌晨两点。”，`lang=zh-CN`、本机 `Microsoft Huihui - Chinese (Simplified, PRC)`（`localService=true`）、rate≈0.95、pitch=1、volume=1，原生调用正常返回。
- 两宽度均实际收到可信的 `start → boundary → end`，没有 `error`；start 时 `speaking=true`，end 后 `speaking=false/pending=false/paused=false`，状态文字为“台词试听完成。”，字幕清空，试听按钮仍启用。console/pageerror/外部请求均为空。因此该原生 API 动作验收已补齐；声音响度、音色质量与声学内容不在本证据声明内。
- **QA-DIALOGUE-M01 · Medium · 未关闭**：总控终盘覆盖审计发现，架构 R2 席随后独立只读核实。原任务要求 QA 台词契合度，但既有 panel.dialogue 没有进入 VLM intended-panel 输入；返回 shape、解析/aggregate、QAResult 与 UI 均无该维度，无带参考图角色时还直接 `votes=0` 跳过。对应原冻结版本的正常 QA 操作、其它评分维度和手工推翻通过，均不能覆盖这个缺失能力。本席未为此重开浏览器，也不将互核来源伪称为本席新交互观察。须修复后经全量门禁与新完整五席复审；本轮整体维持 NOT VERIFIED PASS。

## 互核、边界与清理

- 已与架构席互核四轴原生契约、prompt、取消 scope 与 opaque 全屏；与视觉席互核画布焦点和三模板嵌套退出；与可靠性席互核全屏隔离、六包 503/人工恢复及重复显式提交。现有结果无冲突，未以其他席的结果代替本席实际操作。
- IME 证据为 Chrome 原生 CDP composition 传输，不声称验证了所有操作系统中文候选窗或实际读屏器音频。最初语音证据只有 6 个 voices，曾明确记录缺少实际调用；其后已按上节补齐两宽度真实原生调用与事件，仍不声称做过声学录音或音质验证。
- 真 GPU、付费模型效果、功耗与性能数据不属于本席证据，不由 Fake 服务推导。
- 首批自有实例在 2026-11-26 **11:34:22 +08:00** 已完成关闭及唯一 TEMP 进程零匹配，随后性能独占期间未重开。总控放行后的最小 TTS 补证自有 context/browser.close 与 fixture terminate/wait 在 **12:11:37 +08:00** 完成；12:11:52 唯一 TTS TEMP 对应 Chrome/Python 为 0，12:12:43 本席启动时间窗创建且仍存活的 Chrome 亦为 0：**自有Chrome全闭**。此后不再重开，已通知总控可放行 QA 修复写入。
- 首批已清理自己 62 个临时直接项、901 个文件、43,826,026 bytes，截图已查看后删除。TTS 新 TEMP 精确路径为 `C:\Users\QIU\AppData\Local\Temp\mio-cross-feel-r2-tts-2b713e`，其 38 个文件、621,966 bytes 已全部删除，目录不存在；原生调用与事件已合并进原紧凑 JSON。最终只留 `C:\Users\QIU\AppData\Local\Temp\mio-cross-feel-r2-c8b741\feel-r2-summary.json`，57,284 bytes，SHA-256 `3338343a2f43eeb0f84c73861daba6614822cc910009331e518120e11fd199ca`。未碰其他席 TEMP、未知 recovery 或用户接管的旧 bridge recovery。
- 与性能接续席文字互核无冲突：原生拖动/比较/采用/返回焦点与保留原作的 120 幕导入证据一致；性能结果只作互核来源，不替代本席证据，也不能抵消 QA-DIALOGUE-M01。

最终本席签发：**NOT VERIFIED PASS，0 Blocker / 0 High / 1 未决 Medium（QA-DIALOGUE-M01）/ 1 既有 Low**。已有交互与后补原生 TTS 动作通过证据保留，完整 R2 因能力缺口未通过。
