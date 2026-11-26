# CrossAudit-2-Visual-Editorial · R3 独立视觉审计

日期：2026-11-26，UTC+08:00。冻结 HEAD `e7a4eac44bacb64f6d74dd5a028d0380b0aa69f8`；实际 `web/dist/index.html` SHA-256 `ecd63ebe23e44f17c079d4d256765e9355e24a2fee50a7e30e5e0ece643ccbfa`。真实本机 Chrome `158.0.8127.37`，既有 Python Playwright，独立 headless 实例。未重建 dist、安装浏览器/依赖、重跑总控基础门禁、修改产品或测试。

**签发：NOT VERIFIED PASS。0 Blocker、0 High、1 未决 Medium：`VIS-R3-M01`。** 本轮新增动态壁纸变量补全浮层叠字，是独立实测的新遗漏表面；不能用 R2 视觉 PASS、旧构建同字节、六包隔离或键盘测试通过抵消。既有宿主英文标题及 QA 人工拒绝后的 BODY 焦点两个 Low 按原归属保留，没有将它们关闭或升降级。

## 未决发现

### VIS-R3-M01 · Medium · 动态壁纸下变量补全浮层透出底层文字

复现：使用真实本地两帧中性 GIF 动态主题，390×844，进入分镜工坊，新建分镜、选择含角色变量的设定，聚焦正向提示词并输入 `{`。`#prompt-completion` 出现在 `x=8, y=437.78125, width=374, height=340`。下半部约 `y=660–748` 的 `{character}`、`{creative-navigator}` 等条目及其说明，与底层变量提示、负向提示词标题和「应用到所有分幕」动作发生叠字，读者难以区分同一位置的两层文字。

| 实测项 | 浅色 | 深色 | 动态壁纸 |
| --- | --- | --- | --- |
| `#prompt-completion` 背景 | `rgb(255,255,255)` | `rgb(28,31,33)` | `color(srgb 0.109804 0.121569 0.129412 / 0.68)` |
| 整体 opacity / backdrop-filter | 1 / none | 1 / none | 1 / none |
| 等待 1600ms 后仍存在 | 无穿透 | 无穿透 | 是，`getAnimations().length=0` |

1440×900 同样量得 68% 背景 alpha，不能将问题解释为手机的入场动画截帧。初始与静定后原图均保留到总控完成核看；其后按要求删除，图像 SHA 仍在 compact JSON。原证据为本席 TEMP 的 `popupcheck/shots/popup-390-dynamic-completion-popup-settled.png`，测量键 `V-POPUP-390-dynamic`；桌面键为 `V-POPUP-1440-dynamic`。补全键盘、IME、焦点及几何检查通过只说明功能可用，不代表叠字可接受。

总控已通过 `view_image` 实际查看上述 390 dynamic settled 原图，确认补全说明与底层负向提示词、应用所有分幕动作发生文字竞争，认可真实 Medium。R3 终态之后独立实现者的 CSS 修补及其 targeted 20 通过属于后续构建事实，不关闭冻结 HEAD 的本轮发现，也不改变 R3 未通过结论。

源码支持：[overlays.css](../../../web/src/styles/overlays.css) 的 `#prompt-completion`（491–503 行）仍以 `var(--panel, var(--panel2))` 为背景；动态主题把 `--panel` 设为 68% 透明。[themeBackdrop.css](../../../web/src/app/themeBackdrop.css) 的动态不透明覆盖只列 dialog/drawer/command 等表面，遗漏了此浮层。建议由实现领地在动态模式使用已有不透明 `--wallpaper-surface`，不需要增加 blur、改补全 JS、CSP 或沙箱。本席不实施修复，也不声称该建议已关闭缺陷。

这不是回写 R1/R2：R1 `VIS-M03` 与 R2 已验证的 dialog/drawer 等原表面结果保留；本轮发现的是此前未识别的补全浮层遗漏。全轮应打回修复，再经新门禁与独立完整复审。

## 环境和范围

已读 AGENTS、README、ROADMAP、原任务 `D:\Tencent Files\tx download\ai_studio_code (4).txt` 全部 Wave 5 范围及相关 Playwright / UTF-8 规范。六个独立、默认停用的官方专业扩展已获本轮明确授权，不把旧 backend-only 描述作为拒绝验收这些面板的理由。

所有服务、端口、Chrome profile 和数据均为本席自建，六专业包只从当前 `extensions/` 打包；生成与评审只有中性 FakeComfy/LLM/VLM。未接触 8788/8188、用户已有 Chrome、私人运行数据、LoRA 或恢复目录，没有调用 GPU 或付费模型。离线样张只通过本席 HEAD 清单读取器执行 `git show HEAD:data/...` 并核对 manifest 哈希，不读取或复制工作树私人随包差异。页面外联阻断，离线 HTML 只允许 file/data/blob。

六个上下文均为真实 viewport：1440×900 / 390×844，各自 light、dark、dynamic。主应用动态路径确实验证 `data-theme-dynamic-background=true` 及已解码 `naturalWidth=48` 的 GIF。手机上下文启用 touch/mobile。离线 HTML 自有纸色/暗房设计，不继承宿主 DOM、CSS 变量或壁纸；第三组离线场景是 dark + no-preference 的动态偏好环境，实际运行动画，不宣称模板拥有动态壁纸功能。

## 实际执行账本

| 组 | 实测与最终结果 | 覆盖边界 |
| --- | --- | --- |
| 主应用 8 组 × 6 上下文 | 48 个功能 case 完成 | 合集移动/撤销、变量补全/IME、本地 120 幕拆分、滑杆同步对比/采纳、四步引导、模板微调/全屏试读、设置/命令/导入弹窗/长标题/空搜索、原生 HTML 导出回导；其中补全动态视觉另报上述 Medium |
| 六专业包，中英 × 6 上下文 | 72 包流程 + 12 生命周期 = 84/84 | 实际导入 ZIP、显示摘要、默认停用、信任启用、入口/结果/空态/503/手动恢复、停用后拒绝请求与卸载；打开面板本身不调用模型、不提交工作 |
| 六专业包 hover / 键盘 focus × 6 | 36 个稳定键最终闭合 | 34 键末轮直接通过，finalize 两个动态键由实际 PNG 底色补证关闭探针假警；见探针历史 |
| 新 QA 原生分支 5 × 6 | 30/30 最终原生任务与 DOM 通过 | long、unknown、no-dialogue、no-anchor、pure-scene；没有仅注入 HTML 冒充原生评分链 |
| 五旗舰 × 10 场景 × 6 上下文 | 300/300 | 目录、灯箱、键鼠/触屏、单双页/翻页、首末幕、真实图片尺寸与 contain、payload 恢复内容、XSS 惰性文本、页面宽度/错误/外联 |
| 真实 loading→503→恢复 | 首轮 0/6 探针预期错误；同键补验 6/6 | 挂起真实初始 API、保留加载图、让全部重试实际返回 503，显示错误，再明确 reload 恢复 |
| 手机对比疑点补验 | 同键三主题最终 3/3 | 真实 wheel、CDP touch、实际 Tab 到最后动作与 hit-test；没有用程序 scrollIntoView 的成功代替普通用户可达性 |
| 补全持续态与目标长标题 | 12 个功能/几何 case 完成 | 两尺寸三主题等待 1600ms、背景/动画测量；长标题另真实滚到目标卡，不能用手机首屏前两张短标题图冒充长标题证据 |

主应用稳定键为 `M-{collections,completion,story-import,candidate-compare,onboarding,template,extra,import}-{1440,390}-{light,dark,dynamic}`。专业为 `P-{package/lifecycle}-{width}-{theme}-{zh-CN,en}`；附加焦点为 `F-{package}-{width}-{theme}`；原生 QA 为 `Q-{long,unknown,no-dialogue,no-anchor,pure-scene}-{width}-{theme}`。五模板 `A-{export-monograph,export-nocturne,export-folio,export-zine,export-contact-sheet}-{scenario}-{width}-{theme}` 全部逐键保存在 compact 证据中。

模板十场景为 HEAD 随包 sample、single（1 幕）、twelve、sixty、one-twenty、collection-long-titles（长中文及无空格英文）、image-only、captions-off、xss、ultra-ratios（1280×64 与 64×2560）。不存在用同一成功案例的总数顶替原失败键。

## QA 新分支与原问题回归

原生 QA 每次都通过真实选择候选、评审确认、`qa.check` 完成、刷新及评分卡读取。long 分支使用 120 次中英混排的模型说明并带 `<unsafe>` 惰性文本；实际解释和有效票显示来自任务结果，DOM 未产生 `unsafe` 元素。assessed 为 2/5、3 有效票并待复核；unknown 为 0 有效台词票，显示「评审不完整」，后端 `passed=false`；无台词明确 `not_assessed`；无锚点及纯场景仍有真实 scene/quality 综合评审票、identity 为空。30 键最终均走原生链，说明文字可纵向延展且没有横向叠加/截断。功能链通过不等于真实 VLM 效果好，也不代表付费模型验证。

R1 retouch hover 已回归：14px 主操作文字，浅色对比 **6.871:1**，深色/动态 **11.296:1**，两尺寸一致。键盘 focus-visible 有可见 outline。finalize 的真实 PNG 按钮底色浅/深/动态分别 `[243,245,240]`、`[19,21,23]`、`[24,26,28]`，文字对比 **11.947 / 15.225 / 14.516:1**；六上下文实际键盘焦点均为 2px solid。

Folio 的 9–11px topline、signature、colophon 名义纸色对比为 **6.216:1**，运行页眉样本 **7.541:1**；纸面有渐变/纹理，这些数值明确是浏览器计算色与祖先背景的取样，不冒充全页逐像素 WCAG 认证。实际目视的桌面/手机图仍能区分标题、铭牌、画框与页脚，未复现 R1 小字失读。

Contact Sheet 动态偏好两尺寸 × 十场景，实际 End/Home 共 **40 段** rAF 几何采样，每段约 850ms，最大 scrollWidth 始终为 **1440 / 390**，未复现动画中途横向扩宽。采样只回答几何问题，不作 FPS、GPU 或瓦数宣传。sample 六上下文实际 `emulate_media('print')`，小元数据对白底取样 **8.992:1**；真实桌面/手机打印媒体图也已查看，没有用屏幕暗房配色冒充白纸打印。未验证物理打印机、PDF 分页或色彩管理。

对比弹窗首屏末行被截出曾作为候选 Medium 提交核对。最终确认其是正常纵向滚动内容：390 三主题都用真实 wheel 滚动后全部 footer 按钮底边约 `800.97 < dialog bottom 820`，每个中心 hit-test 命中；实际 touch 滑动使 scrollTop 增加，Tab 逐项到最后采用按钮时底边约 `818.97 < 820` 且命中。正常输入可达，因此未把静态首屏裁切定为缺陷。

## 探针失败历史，均保留

全部八次运行原始记录共 **600 条，570 passed / 30 probe failed**。这些是脚本记录的执行结果，不是产品 PASS 总数；真正视觉发现另以上述 `VIS-R3-M01` 明确签发失败。

| 原探针错误 | 原失败键 | 同键证据与解释 |
| --- | --- | --- |
| 首轮 loading 恢复误期待 3 张书架卡，夹具实际基线有 5 张 | `S-loading-error-{1440,390}-{light,dark,dynamic}` 共 6 | 全部真实 loading/503 已到达，只在恢复卡数断言失败；改为实际基线 5，同 6 键全链补验通过 |
| 对比补验第一组采用后漏 reset，后续按钮已采用而 disabled | `V-COMPARE-390-{dark,dynamic}` 共 2 | 按上下文 reset 后，三主题真实 wheel/touch/Tab/采用/返回全通过；不把 disabled 的预期行为报成 UI 故障 |
| 自建 QA setup 误用 `Dialogue(speaker=...)`，原生字段应为 `speaker_id` | 初轮 `Q-{long,unknown,no-anchor}-{width}-{theme}` 共 18 | 错误发生在本席夹具 setup，未提交评审；修正仅本席 TEMP fixture 后，完整 30 个原生 QA 键通过 |
| hover 底色探针把 CSS Color 4 的 0–1 通道当 byte，且把透明 iframe 底层假定为白色 | 两轮 `F-finalize-studio-{1440,390}-dynamic` 共 4 | 校正 Color 4 后仍不能用白底假定代替实际合成；最终直接取真实按钮 PNG 非文字区底色，原两动态键和四个浅深邻接键全部通过。原 4 个错误记录没有抹去 |

只读路径检索曾有一次 Windows `rg.cmd` 含管道模式的 shell 转义错误及若干不存在路径读取；随后用精确文件定位，不改产品或安全策略。没有放宽 CSP 让探针通过。

## 图像检查与四席互核

本席保留过 689 张 PNG/JPG 图像，含页面捕获、联系表及夹具图像，不是 689 张逐张审美签审。辅助目视员实际查看六张 `aux-main-* / aux-pro / aux-album` 联系表，共 75 张明确选取的代表页面；另看 27 张原尺寸图。主审复看专业与画册两张联系表、手机对比原图及动态补全静定原图，确认新 Medium。图像清单及 SHA 留在 compact JSON。范围涵盖六包、五模板、两尺寸与三主题；不能把未选取的截图写成逐张人工通过。

四席强制文字互核已完成：

- 架构席独立源码核对上述 `--panel` 与动态覆盖遗漏，确认仅补宿主背景不涉及 bridge/CSP/sandbox/API，也不以架构通过抵消视觉 Medium。
- 手感席明确其浅/深补全逻辑与 IME 检查不反证本席动态叠字；仅改不透明背景不应改变定位、aria-selected、焦点或组合输入。原 QA 手工拒绝后 BODY 焦点 Low 继续保留。
- 安全席确认其 XSS/503/offline/deadline/HTML 隐私与本席可读性问题无冲突，安全通过不覆盖该 Medium。
- 性能席因总控已知失败构建未取得排他采样窗口、未开 Chrome/服务，签 NOT VERIFIED；本席不引用旧 R2 同字节样本冒充 R3 性能。建议修补不新增 backdrop-filter，与其边界一致。

## 关闭与清理

2026-11-26 **14:56:31+08:00 后不再启动 Chrome**。八次自有运行合计记录 49 个 Chrome/fixture 的 PID 与创建时间，终态逐一复核 `identity_alive_now=false`；所有自有服务端口 `connect_ex` 均关闭，八个执行会话全部 exit 0。之后只做离线看图、写报告和自身 TEMP 清理。没有连接、关闭或重启任何用户服务或既有浏览器。

TEMP：`C:\Users\QIU\AppData\Local\Temp\mio-visual-r3-5b067e0e5f`。15:02:46+08:00 首轮清理本席明确创建的 1054 个文件、168,827,011 bytes 和 235 个目录，fixture 工作区、其余截图、HTML、ZIP、日志和脚本均已删除。总控完成目视确认后，15:40:37+08:00 按其指令删除最后四张 `popupcheck/shots/popup-{1440,390}-dynamic-completion-popup-{initial,settled}.png`，共 222,047 bytes，并删除两个空目录。累计删除 **1058 个文件、169,049,058 bytes、237 个目录**；689 张图像（含夹具、联系表）全部删除。终态精确枚举仅剩 `visual-summary.json`，无 PNG 或其他文件，没有再启动 Chrome。

唯一保留摘要 `visual-summary.json` 为 **315,416 bytes**，SHA-256 **`2c2c8bfe99aed3af97b411387ee78517dc8408fa00b4ec5229bfeb9e8ca7de50`**。JSON 含稳定 caseID、原失败/补验映射、原生 QA 摘要、色值、几何、PID/端口终态、已删除图像 SHA、总控目视确认及两阶段清理计数，不含用户数据或凭据。

本席不覆盖真实模型效果、私人作品、真实 GPU/VRAM/瓦数、物理打印机、未改动全站页面、所有屏幕阅读器或未来构建。总控提供的全量门禁结果不是本席重复执行的测试。**唯一未决 `VIS-R3-M01` 足以令本席与 R3 整体保持 NOT VERIFIED PASS。**
