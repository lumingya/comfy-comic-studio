# CrossAudit-2-Visual-Editorial · R2 独立视觉复核

日期：2026-11-26，UTC+08:00。冻结 HEAD `5569dc294fd16c7478abbd31317da7e9055c3be7`；实际 `web/dist/index.html` SHA-256 `ecd63ebe23e44f17c079d4d256765e9355e24a2fee50a7e30e5e0ece643ccbfa`。真实本机 Chrome `158.0.8127.37`，既有 Python Playwright，独立 headless 实例。未重建 dist，未安装浏览器/依赖，未重跑总控基础门禁。

**签发：VERIFIED PASS；本席 0 Blocker、0 High、0 未决 Medium、0 新 Low。** R1 的 VIS-M01/M02/M03 和 VIS-L01 已在此冻结构建实际复核关闭；另完成 CS-M01 Contact Sheet 白底打印文字复核。这一结论不改变 R1 报告的 NOT VERIFIED PASS、291/300 和 9 条动画失败历史，也不抹去下列 R2 探针失败轮次。其它席保留的英文入口和 QA 焦点 Low 继续成立。

## 环境、边界与真实矩阵

先读 AGENTS、README、ROADMAP、原任务 `D:\Tencent Files\tx download\ai_studio_code (4).txt`、R1 视觉报告和 playwright/utf8-text-guard 技能。六个独立、默认停用的可选专业工作台是用户本轮明确授权，覆盖旧文档 backend-only 限制。本席不修产品代码，唯一仓库写入是本报告；其余四席并行，未回滚他人修改。

夹具是本席 TEMP 内独立端口与独立 data 的实际 API，专业能力仅用中性 FakeComfy/LLM/VLM。未触碰用户 tab、8788/8188、私人 runtime 或受保护随包文件，未调用付费模型/真实 GPU。页面外联阻断；离线 HTML 仅允许 file/data/blob。基础门禁使用总控已确认的 Wave4 结果，本席没有重复全量测试；进行中的 CI `45745955229` 不算绿色证据。

上下文缩写同时构成下文 caseID 的最后一段，尺寸均为真实 Chrome viewport：

| 键 | 尺寸 | 宿主主题与动态偏好 |
| --- | --- | --- |
| DL | 1440×900 | light，reduce |
| DD | 1440×900 | dark，reduce |
| DM | 1440×900 | dark，真实本地两帧 GIF 壁纸，no-preference |
| ML | 390×844 | light，reduce，mobile/touch |
| MD | 390×844 | dark，reduce，mobile/touch |
| MM | 390×844 | dark，真实本地两帧 GIF 壁纸，no-preference，mobile/touch |

动态主应用实测 `data-theme-dynamic-background=true`，解码 GIF `naturalWidth=48`。动态宿主与模板页确实在同一 browser context 打开。独立 `file://` HTML 有各自的纸色/暗房主题，不继承宿主 DOM/CSS 变量/GIF；其 no-preference 分支实际跑了翻页动画，但**没有把它称作离线模板拥有动态视频或壁纸**。读者路由自身隐藏壁纸图，仍保留不透明阅读表面；不以该页没有 img 误称动态未启用。

| 检查组 | 真实执行 | 本轮解释 |
| --- | --- | --- |
| 主应用及 HTML 原生回导，8 组×6 上下文 | 首轮 29/48，19 个探针失败；二轮 40/48，8 个探针失败；引导补验 6/6，额外边界最终补验 6/6 | 48 个稳定 caseID 与 8 个逐项关闭映射见下表。不是“48 首轮全绿”。 |
| 六专业包×6 上下文及生命周期 | 36 个正向包流程＋6 个禁用/卸载生命周期，42/42 | 每包含入口、结果、空文档、503、手动重试恢复、宿主/iframe 宽度检查；不以正向完成流替代其他席的取消/安全检查。 |
| 专业包额外视觉/焦点 | 36/36 | 全六包标题文字取样；retouch/finalize 额外 hint 取样；retouch 六上下文真实 canvas 键盘焦点。 |
| 五旗舰模板×10 场景×6 上下文 | 原始 280/300；20 条为本席新增动画等待表达式受 CSP 拒绝；Contact Sheet 定向重复 60/60 | 原 20 个失败有完全相同模板/场景/尺寸/主题键的补验，不用额外成功数量顶替。 |
| Contact Sheet 动画时间序列 | 动态两尺寸×10 场景×End/Home，40 段、7141 个 rAF 样本 | 每段覆盖起始至至少 750ms；最大 scrollWidth 始终等于 viewport。 |
| Contact Sheet print media | sample×6 上下文，全部实际取 PNG 像素与 DOM 几何 | 真实 `emulate_media(media='print')`；未声称物理打印机、纸张分页或 PDF 已验证。 |

COL 是书架合集/排序/读者返回；CMP 是脚本变量补全及 IME；STORY 是 120 幕本地文本预览/拆幕导入；COMPARE 是候选比较/同步与采纳；GUIDE 是四步引导真实路由；TPL 是模板设置/实时预览/全屏试读；EXTRA 是外观设置、命令面板、HTML 导入弹窗、reader、超长中英文/无空格标题、空搜索、延迟加载、503 与恢复；IMPORT 是原生 HTML 导出/回导完整流，包含默认隐私关闭、显式同意、同意复位、旧文件警告、错误和重试。

## 主矩阵逐项账本

`M2-*` 保留第二轮原结果；`G-*` 是实际完整四步引导补验；`E-*` 是完整 EXTRA 链补验。同组 G/E 的其它上下文也执行通过，但只把相同键用于关闭失败。JSON 另保留首轮 19 个失败的独立 caseID、原因和对应关闭键。

| 主 caseID | 二轮结果 | 对应补验 caseID | 最终 |
| --- | --- | --- | --- |
| `M2-COL-DL` | passed | — | passed |
| `M2-CMP-DL` | passed | — | passed |
| `M2-STORY-DL` | passed | — | passed |
| `M2-COMPARE-DL` | passed | — | passed |
| `M2-GUIDE-DL` | passed | — | passed |
| `M2-TPL-DL` | passed | — | passed |
| `M2-EXTRA-DL` | failed | `E-EXTRA-DL` | passed |
| `M2-IMPORT-DL` | passed | — | passed |
| `M2-COL-DD` | passed | — | passed |
| `M2-CMP-DD` | passed | — | passed |
| `M2-STORY-DD` | passed | — | passed |
| `M2-COMPARE-DD` | passed | — | passed |
| `M2-GUIDE-DD` | passed | — | passed |
| `M2-TPL-DD` | passed | — | passed |
| `M2-EXTRA-DD` | failed | `E-EXTRA-DD` | passed |
| `M2-IMPORT-DD` | passed | — | passed |
| `M2-COL-DM` | passed | — | passed |
| `M2-CMP-DM` | passed | — | passed |
| `M2-STORY-DM` | passed | — | passed |
| `M2-COMPARE-DM` | passed | — | passed |
| `M2-GUIDE-DM` | failed | `G-GUIDE-DM` | passed |
| `M2-TPL-DM` | passed | — | passed |
| `M2-EXTRA-DM` | failed | `E-EXTRA-DM` | passed |
| `M2-IMPORT-DM` | passed | — | passed |
| `M2-COL-ML` | passed | — | passed |
| `M2-CMP-ML` | passed | — | passed |
| `M2-STORY-ML` | passed | — | passed |
| `M2-COMPARE-ML` | passed | — | passed |
| `M2-GUIDE-ML` | passed | — | passed |
| `M2-TPL-ML` | passed | — | passed |
| `M2-EXTRA-ML` | failed | `E-EXTRA-ML` | passed |
| `M2-IMPORT-ML` | passed | — | passed |
| `M2-COL-MD` | passed | — | passed |
| `M2-CMP-MD` | passed | — | passed |
| `M2-STORY-MD` | passed | — | passed |
| `M2-COMPARE-MD` | passed | — | passed |
| `M2-GUIDE-MD` | passed | — | passed |
| `M2-TPL-MD` | passed | — | passed |
| `M2-EXTRA-MD` | failed | `E-EXTRA-MD` | passed |
| `M2-IMPORT-MD` | passed | — | passed |
| `M2-COL-MM` | passed | — | passed |
| `M2-CMP-MM` | passed | — | passed |
| `M2-STORY-MM` | passed | — | passed |
| `M2-COMPARE-MM` | passed | — | passed |
| `M2-GUIDE-MM` | failed | `G-GUIDE-MM` | passed |
| `M2-TPL-MM` | passed | — | passed |
| `M2-EXTRA-MM` | failed | `E-EXTRA-MM` | passed |
| `M2-IMPORT-MM` | passed | — | passed |

### 探针失败历史及修正

| 轮次/错误 | 具体原键 | 修正与相同场景证据 |
| --- | --- | --- |
| 主首轮 6 条 `Navigator.serviceWorker` sandbox 错误 | `M1-TPL-{DL,DD,DM,ML,MD,MM}` | 是本席 `service_workers='block'` 令 Playwright 注入 accessor，在无 allow-same-origin 的 sandbox 预览内触发异常。去掉该上下文选项，仍保留网络阻断；六个 `M2-TPL-*` 真正通过，没有改产品 sandbox。 |
| 主首轮 11 条夹具污染：书架只剩 2 而预期 3、或找不到原甲册 | `M1-COL-{DD,DM,ML,MD,MM}`、`M1-IMPORT-{DL,DD,DM,ML,MD,MM}` | 本席超长书名探针改了 `roadmap-shelf-0`，reset 不恢复标题，后续按原名找书失败。显式恢复中性原题后，11 个同键 `M2-*` 通过。首个 DL collections 早于污染，本来通过。 |
| 主首轮及二轮各 2 条引导点击超时 | `M1/M2-GUIDE-DM`、`M1/M2-GUIDE-MM` | 快速重开 help 时 assembly 异步 dialog 仍在后挂载，捕获点击。补验等 networkidle/600ms、实际 `.designer-footer-hint` 可见、Esc 后确认卸载，再逐步走完 service→workflow→reader→create；`G-GUIDE-DM/MM` 通过。保留超时，不把它泛化成未复现的产品竞态；交互席独立 12 条路径也通过。 |
| 主二轮 EXTRA 6 条 `Expected held API request` | `M2-EXTRA-{DL,DD,DM,ML,MD,MM}` | 探针路由漏掉实际 `/api/series?deleted=false` 查询串；改为匹配查询后继续补验。 |
| EXTRA 首次补验 0/6，503 文案 5s 内未出现 | `E1-EXTRA-{DL,DD,DM,ML,MD,MM}` | 本席只释放初始请求，TanStack retry 仍被 held；关闭时出现本席回调取消。改为先 hold 初次请求拍真实加载态，再令所有重试立即真实响应 503，等待 `.query-error`（18s 上限），解除拦截并 reload 恢复。六个对应 `E-EXTRA-*` 全链通过。 |
| 模板启动前一次拒绝非空 data | 未进入 300 矩阵 | 复用已有 `main-fixture` 被安全夹具拒绝启动；随后每阶段用全新 mkdtemp。不是 API/产品启动失败，没有将拒绝计入产品 finding。 |
| 模板首轮 20 条 CSP `unsafe-eval` | 下节逐项列出 | 新增 `wait_for_function('window.__animDone')` 的裸表达式被 nonce CSP 正确拒绝。改函数形式 `() => window.__animDone` 后同键重测；未放宽 CSP、未移除动画测试。 |

上述均是可定位、随后同键实测关闭的探针问题，与产品缺陷分开记账。只读辅助检索另发生 PowerShell 经 rg.cmd 处理含 `|` 搜索式的命令转义错误及一次猜测路径不存在；改用 UTF-8 Python 精确读取，无文档/代码副作用。终端代码页曾显示中文错码，原 JSON 严格 UTF-8 解码且 U+FFFD 为 0，补全事实中的实际值仍是 `{角色}`、`{林夏}`，未据终端显示判产品乱码。

## 五模板边界与原 20 条关闭映射

模板键：MON=`export-monograph`，NOCT=`export-nocturne`，FOL=`export-folio`，ZINE=`export-zine`，CONTACT=`export-contact-sheet`。每模板真实遍历 `sample`（随包样张）、`single`（1 幕）、`twelve`（12 幕）、`sixty`（60 幕）、`one-twenty`（120 幕）、`collection-long-titles`（合集中英长标题）、`image-only`（纯图）、`captions-off`、`xss`、`ultra-ratios`（极宽/极高）。每场景都检查真实图片尺寸/可见性、整页宽度、payload/恢复内容，并按适用性操作目录、键盘、单双页/大图和最后一幕；不是只查看首页缩略图。

原 300 明细（`A-{模板}-{场景}-{上下文}`）完整保存在极小 JSON；280 项原始 passed，以下 20 项原始 failed。定向补验是 **CONTACT×10 场景×6 上下文＝60/60**，含原 20 个 DM/MM 同键；其余 40 个是额外浅/深回归。不能写成“单轮 300/300”。

| 原模板 caseID（首轮 CSP 探针失败） | 同键定向补验 caseID | 结果 |
| --- | --- | --- |
| `A-CONTACT-sample-DM` | `CS-CONTACT-sample-DM` | passed |
| `A-CONTACT-single-DM` | `CS-CONTACT-single-DM` | passed |
| `A-CONTACT-twelve-DM` | `CS-CONTACT-twelve-DM` | passed |
| `A-CONTACT-sixty-DM` | `CS-CONTACT-sixty-DM` | passed |
| `A-CONTACT-one-twenty-DM` | `CS-CONTACT-one-twenty-DM` | passed |
| `A-CONTACT-collection-long-titles-DM` | `CS-CONTACT-collection-long-titles-DM` | passed |
| `A-CONTACT-image-only-DM` | `CS-CONTACT-image-only-DM` | passed |
| `A-CONTACT-captions-off-DM` | `CS-CONTACT-captions-off-DM` | passed |
| `A-CONTACT-xss-DM` | `CS-CONTACT-xss-DM` | passed |
| `A-CONTACT-ultra-ratios-DM` | `CS-CONTACT-ultra-ratios-DM` | passed |
| `A-CONTACT-sample-MM` | `CS-CONTACT-sample-MM` | passed |
| `A-CONTACT-single-MM` | `CS-CONTACT-single-MM` | passed |
| `A-CONTACT-twelve-MM` | `CS-CONTACT-twelve-MM` | passed |
| `A-CONTACT-sixty-MM` | `CS-CONTACT-sixty-MM` | passed |
| `A-CONTACT-one-twenty-MM` | `CS-CONTACT-one-twenty-MM` | passed |
| `A-CONTACT-collection-long-titles-MM` | `CS-CONTACT-collection-long-titles-MM` | passed |
| `A-CONTACT-image-only-MM` | `CS-CONTACT-image-only-MM` | passed |
| `A-CONTACT-captions-off-MM` | `CS-CONTACT-captions-off-MM` | passed |
| `A-CONTACT-xss-MM` | `CS-CONTACT-xss-MM` | passed |
| `A-CONTACT-ultra-ratios-MM` | `CS-CONTACT-ultra-ratios-MM` | passed |

六专业面板实际为 `panel-retouch`、`finalize-studio`、`qa-review`、`script-assistant`、`variant-workshop`、`motion-studio`。每包都经 UI 明确信任/启用后进入，42 项 `P-{包名或lifecycle}-{上下文}` 全部 passed，36 项 `F-{包名}-{上下文}` 额外视觉检查也 passed；逐键明细在 JSON。安装≠打开，默认禁用/明确采纳的边界没有由视觉便利改动。

## 旧问题关闭与代表性视觉判断

### VIS-M01：retouch 主按钮 hover 已关闭

六上下文在真实 iframe 对“读取候选与配置”启用态 hover、取图并解码浏览器色值。14px、650 字重：浅色前景 `[244,247,241]` / PNG 背景 `[53,94,64]`，**6.871:1**；深色及真实动态前景 `[21,41,28]` / 背景 `[184,233,189]`，**11.296:1**。两尺寸一致，原 R1 1.16/1.03 的失读未复现。该取样是主按钮真实 hover，未误量 disabled，也未借其他按钮颜色替代。

### VIS-M02：Folio 小元数据已关闭

用默认模板、默认配色导出，四个原失读位置都取 PNG 背景和实际前景，仍保留原 9–11px 字号。DL/DD/DM 结果一致，ML/MD/MM 结果一致：

| 位置 | 桌面 | 手机 |
| --- | --- | --- |
| `.topline`，9px | 6.057:1 | 6.001:1 |
| `.running-head span:first-child`，9px | 7.407:1 | 7.541:1 |
| `.signature`，11px | 6.216:1 | 6.216:1 |
| `.colophon.imprint`，9px | 6.041:1 | 6.155:1 |

均高于本席普通小字 4.5:1 检查线。手机 Folio 原图可见纸面层次、作者/章节信息和图片边缘；没有为数值通过把模板改造成纯黑白。

### VIS-M03：真实动态壁纸下关键内容表面已关闭穿透

两尺寸的拆幕 `.dialog.lg`、比较 dialog、guide、命令面板、HTML 导入/结果/错误弹窗、导出 drawer、模板设置和全屏试读都实际打开。测得内容背景为 **opaque `rgb(23,25,27)`**、`backdrop-filter:none`；reader 为 opaque `rgb(16,23,25)`。样本包括同时存在 reader＋export drawer＋template dialog＋album preview 的叠层，不只检查空白 dialog。`themeBackdrop.css` 使用动态专属稳定表面，命令 backdrop 没有新增 blur。

放大对照手机 `main-template-390-dynamic-live-preview`、`main-story-import-390-dynamic-storyimport-preview` 与 `import-390-dynamic-03/04/08`：前景说明区不再透出底层封面竖线、巨标题/排序栏，文字稳定可读；暗色层级仍区分内容、输入和操作。动态 GIF 的底层保留不影响前景信息；这不是把全站壁纸禁用来取得通过。

### VIS-L01：Contact Sheet 起段动画横溢出已关闭

在上述原 20 个动态键逐个进入单页，用 End 和 Home 各启动一次动画，真实 rAF 从约 0ms 采至 750–757ms（包括 0–400ms 中间帧，负的个位毫秒仅为 rAF 时间戳相对同步开始时间的取整差）。40 段合计 **7141 个样本**，桌面最大 `scrollWidth=1440`，手机最大 `390`；未出现 R1 `1482` 的瞬时扩宽。起始与终止键都被实际发送，单幕场景也保留无移动边界。`runtime.css` 的动画叶片边界已限制横向溢出；未删除动画或仅等结束再检查。该样本密度是几何检查，不作 FPS/交互性能宣传。

### CS-M01：Contact Sheet print media 白底文字已关闭

六上下文 sample 均实际切换 print media，取 DOM 和截图。白纸区域的 topline/film-stamp/小标题/footer 是 `[98,67,24]`，**8.992:1**；正文 **10.424:1**；简介桌面 **6.119:1**、手机 **6.498:1**；最淡 `.shot-size` 为 `[116,117,118]` 对白底，**4.617:1**。桌面四列/手机两列的图、章号、caption、尺寸与尾注均可见，几何宽度为 1440/390，无横向卷出。黑色画框/胶片轨是图像容器，未误判成打印背景文字。

代表性两张真正 print media 原图是 `album-print-contact-1440-dynamic.png` 和 `album-print-contact-390-dynamic.png`（SHA 前缀 `22b933e7d947`、`860c37154f18`）。这证明本轮 Chromium 的 print CSS 渲染及视口几何；**不代表真实打印机、PDF 分页/出血或色彩管理验收**。

### 相邻区域与美感回归

全部六包入口/结果/空态/503 与两种尺寸代表图均读过。各包标题取样约 **11.947–15.225:1**；retouch/finalize hint 最小 **5.25:1**。其它包没有匹配该 hint selector，未虚报其所有说明文字都被量色。信息层级、行距、按钮标签、长中英文换行和手机纵向滚动没有发现阻碍使用的截断/重叠。XSS 文本按字面显示，未执行/未外联；安全范围另与破坏席互核。

retouch 在实际载入来源、切入 inpaint 后，Tab/Shift+Tab 使 canvas 获得真实 `activeElement`，六上下文都可见 canvas **2px** outline 和 stage **2px** 外圈＋4px 表面隔离。浅色 accent `[53,94,64]`，深色/动态 `[184,233,189]`；手机放大原图 `panel-focus-390-dynamic.png`（SHA 前缀 `241f51d3f67e`）焦点环连续，未与图片边缘混淆。不是仅 programmatic focus 后读 CSS，额外键盘导航也实际执行。交互席另完成真实绘制/撤销/触屏行为，本席不重复其行为签发。

候选比较中移除 badge blur 后，分割/单图/采纳标识仍有清楚的底色与文字层次，图片边缘没有产生错位；手机窄屏与动态表面对比仍可辨。此为视觉回归判断，实际 compositor、idle 和长帧是否改善以性能席为准，不以截图证明性能。书架超长中英/无空格标题没有撑破页面；极端模板长题可正常纵向延展，不把正常长篇高度算作横溢出。加载、空态与 503 都有可读状态和恢复后内容，不以加载中的空白卡片冒充成品结果。

## 人工图像证据与互核

本席最终共有 **552 张唯一命名 PNG**，生成 **43 张联系表**（main 10、panel 12、album 16、import 5），43 张全部人工目视；另放大关键 hover、动态拆幕/模板/回导、Folio、canvas 和 print media 原图。覆盖全部功能组、六包、五模板、两尺寸、三上下文，**不声称 552 张逐张独立审美签审**。截图是本机实际页面，未以人工合成 mock 代替；联系表仅缩图排列，像素量色使用原始 PNG。代表图名和 SHA-256 留在 JSON，图片按要求看后删除而不提交。

架构席互核：六包 appearance 同步和实际 fullscreen 通过，与本席 opaque 表面/动态定义一致；保留 A1-L01（英文 host menu/iframe title 固定中文）Low，本席中文矩阵不反证它。交互席互核：无新 B/H/M，独立真实 canvas 像素/焦点、四步引导与拆幕焦点恢复通过；其 QA 人工推翻后 BODY 焦点既有 Low 保留。破坏席互核：独立 XSS/隐私及六包离线/503 原地恢复无冲突；本席不把正常像素检查替代它的安全边界。性能席已文字确认跨域无冲突：其 current HTTP 六轮交互样本与本席徽章清晰度/无新增 blur 判断相容；7141 个 rAF 只作几何观察，其帧间隔/CPU/内存不会反向替代视觉判断。该席仍在独占真钟 180s 采样，本报告不提前声称其最终门禁通过。

未评价真实模型生成质量、私人作品、声卡输出、完整英文视觉矩阵、所有屏幕阅读器、所有未改动页面或后续构建。对比度是明确取样和已知 opaque/paper 区域，不是对所有壁纸每帧/所有像素的全站 WCAG 认证。矩阵内没有实际未覆盖而靠总数替代的原失败键。

## 时间与清理

| 阶段 | 本机 UTC+08:00 时间 | 原始结果 |
| --- | --- | --- |
| 主首轮 | 11:15:36–11:20:51 | 29 passed / 19 probe failed |
| 六包 | 11:18:22–11:23:02 | 42 passed |
| 模板首轮 | 11:20:45–11:24:50 | 280 passed / 20 probe failed |
| 主二轮 | 11:22:15–11:27:37 | 40 passed / 8 probe failed |
| 额外包视觉/焦点 | 11:25:01–11:27:19 | 36 passed |
| Contact Sheet 定向 | 11:27:12–11:28:48 | 60 passed |
| EXTRA 首次补验 | 11:27:22–11:28:39 | 6 probe failed |
| 引导稳定补验 | 11:28:11–11:28:53 | 6 passed |
| EXTRA 最终补验 | 11:29:42–11:30:53 | 6 passed |

这些视觉阶段部分并发，无性能基准含义。**自有 Chrome 全闭**，各 fixture 均 finally 终止，最后关闭时间 **11:30:53**；随后只读截图和写本报告，不再启动 Chrome，给性能席独占窗口。

自有 TEMP 完整路径：`C:\Users\QIU\AppData\Local\Temp\mio-cross-visual-r2-4wzeq4u1`。仅本目录由本席创建的截图、HTML、夹具 data、ZIP、日志与脚本在目视后清理；不触碰任何旧证据/未知 recovery。11:41:19 完成清理：删除 1015 个文件、187,010,100 bytes、215 个子目录，其中图像 684 个、134,687,019 bytes（含 552 张捕获 PNG、43 张联系表及中性夹具图像）。剩余截图 0，自有目录只保留 `visual-summary.json` 供总控逐键汇总。该 JSON 含 48/300/60 逐键原结果、所有探针失败映射、时间、原数据摘要 SHA、像素测量、代表截图 SHA 与清理统计；四席文字互核完成后大小为 **60,624 bytes**，SHA-256 **`9540b2c53e7bbd231ca6c7e3e368bcf97bbca05d47e610b581b48fb53a712445`**。
