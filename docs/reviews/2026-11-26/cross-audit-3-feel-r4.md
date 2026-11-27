# CrossAudit-3-Feel · R4 交互与手感复审

签发状态：**NOT VERIFIED PASS**。在已实际覆盖的交互中，本席没有确认新增 Blocker / High / Medium 产品问题；这不是整轮完整通过结论。纯文字互核已完成，但下文列出的未覆盖路径不能由已通过矩阵代替。

## 对象与隔离

- 日期：2026-11-26（Asia/Shanghai）。审计对象冻结 HEAD：`b78de840044750fd29a214fcdba51ad130f4c925`。
- 冻结 `web/dist/index.html` SHA-256：`4b55b6a14bc0a9732e444f64828889401218d95a9b9dba5c18c9e0990e195ba1`；结束复核仍为 81 个文件、2,424,442 bytes。未执行 build，未修改产品、测试、构建产物、其他席报告或提交。
- 已阅读 AGENTS、README、ROADMAP、原任务 `D:\Tencent Files\tx download\ai_studio_code (4).txt` 与 R4 审计交接/冻结资料。六项默认关闭的专业能力按原任务授权检查；没有因其默认关闭而跳过。
- 冻结资料记录本地完整门禁已完成；本席没有重跑测试门禁或 build，不把转述结果记作本席实测。
- 真实 Google Chrome `158.0.8127.37` headless + Python 3.13 Playwright；中性本地 roadmap / professional fixtures、FakeComfy/FakeVLM 与独立临时工作区。真实浏览器、API、任务执行器及 SQLite 持久化链路用于交互和 QA focused cases；未调用真实 GPU、付费模型或用户数据。
- 使用随机 loopback 端口和本席唯一 TEMP `C:\Users\QIU\AppData\Local\Temp\mio-feel-r4-bq5hbr86`。没有访问用户 8788 / 8188、已有 Chrome、私人 runtime 或他席恢复目录。没有浏览器截图或大图作为结论依据。

## 实际运行结果

### 宽矩阵：88 / 88 通过

宽矩阵在 1440×900 与 390×844、light / dark / dynamic 条件下运行真实 UI（Album 项目为独立 HTML）。结果为 ROAD 36、六个专业面板核心流程 36、面板启停生命周期 6、五种画册导出 HTML × 两视口 10；总计 88。

| 范围 | 实际操作 | 结果与边界 |
|---|---|---|
| 合集与候选 | 单本/多本真实拖动归档、ghost/落点、6px 抬起阈值、触屏滚动、撤销与 CAS、Esc、键盘移动；候选比较、缩放/同步平移、滑杆和显式采用 | 对所跑用例通过；未穷尽合集内组排序、陈旧归属冲突及所有失败拖放组合 |
| 补全与拆幕 | 提示词/台词补全、来源和值、方向键/Enter/Tab/Esc，真实 CDP IME composition；120 幕 Markdown 预览不写入，单次确认后导入 | 所跑用例通过；未证明所有插入 caret/selection 与操作系统输入法组合 |
| 引导与日常模板 | 新旧工作区引导、完成状态、模板参数编辑与实时预览 | 宽矩阵通过；fresh guide 的帮助内手动重开在 focused run 另行通过 |
| 六个默认关闭面板 | 修图、成品工坊、QA、剧本助手、四轴变体、动态漫的核心真实操作/API/job/store 流程 | 36 个核心矩阵通过；另 6 个 lifecycle case 覆盖安装信任、禁用与卸载。不是全部专业工具动作的全尺寸/全主题穷举 |
| 画册 HTML | monograph、nocturne、folio、zine、contact-sheet，各 60 个合成画格、双视口；实际读图、目录/灯箱/键盘与模板专属控制 | 10/10；本轮用例不是完整通用读者旅程矩阵，也没有证明全部隐私投影边界 |

宽矩阵未覆盖原任务全部边界。特别是，动态漫没有运行原生 `fullscreenchange` 与真实 TTS 调用链；画册检查不构成所有内容/方向/触屏组合或隐私投影的穷举；专业面板核心流程通过不能替代每项 mask、QA 批采纳、剧本陈旧态、变体编译及播放器细节的完整操作验收。

### CMP / 引导 / QA focused 修正链

原始 focused 轮次 8 cases：1 passed、7 failed。失败原因均先按探针错误调查，没有据此报产品缺陷：候选图复用了 asset URL，无法代表真实 take identity；比较控件与帮助按钮采用了猜测的精确名称；QA 断言读取不存在的 `scene` 字段。旧版 `ONBOARD-returning-no-interruption` 通过。此轮原始失败 JSON 已保留在本席 TEMP。

修正后第一次 focused 轮次 7 cases：2 passed、5 failed。QA 的 no-dialogue 与 unknown 两个真实 job/store case 已通过。剩余 CMP / 引导失败继续确认是 matcher 假设：列表实际按 `created_at` 倒序，pin 的下一项不是 take 编号正序；比较按钮名称包含快捷键提示，精确名称 locator 不匹配；帮助 drawer 中有三个动作，未限定帮助按钮导致 strict-mode 歧义。

第二次 focused 轮次 7 cases：6 passed、1 failed。唯一失败 `CMP-repinned-4-7` 是探针误把 take4 后的下一项预期为 take5；实际前端按创建时间降序排序，下一项是 take3。重新根据实际资产 ID 与排序实现确认后，只重跑这个 caseID，未重跑宽矩阵：**1 / 1 通过**。

最终 `CMP-repinned-4-7` 记录如下：

- 390×844 英文浏览器真实初始状态：selected=`creative-take-0-4`、已采用=`creative-take-0-0`，默认比较 pair 为 `[take0, take4]`。
- 用原生 Tab 从比较结束按钮移至“固定当前浏览候选”按钮，再以 Enter 固定；真实 pair 先变为 `[take4, take3]`。四次真实 ArrowRight 后固定侧仍是 take4，浏览侧为 take7，实际 pair=`[take4, take7]`。
- 打开比较、Tab/Enter 固定与四次候选导航均无 adopt POST。随后先后采用固定侧和浏览侧，实际只向 `/takes/creative-take-0-4/adopt` 与 `/takes/creative-take-0-7/adopt` 写入；回读状态均为 adopted。Esc 关闭后焦点回到原 take4 触发卡片。
- `focused-repin-final.json` 对应 case 为 passed；文件 SHA-256：`9a9abd8ebcc983a317959702e7ffe3b15a87d0115a4cde8f2cc693c9fbff7ef2`。

相同身份修正轮次还实际覆盖：默认 adopted 与 selected 同幕比较；selected 本身已 adopted 时的 fallback；没有 adopted take 时的 fallback。三个 case 的左右实际 asset ID 均映射回真实 take ID，比较/导航本身不隐式写入。帮助内 “Quick-start guide” 的新用户手动重开、Escape 退出及四步内容也通过。

QA focused 两个 case 均走 native API → 新 job → 结果读取 → SQLite episode payload 回读，`job.items[0].result.qa` 与持久化 `take.qa` 相同，且原 candidate 未被隐式采用：

- `QA-native-no-dialogue`：输入确实无台词，结果 `not_assessed`、dialogue_score=null、0 dialogue votes；整体视觉评审仍完成，score=0.8、passed=true、identity 为空。
- `QA-native-unknown`：含 narrator narration 输入，FakeVLM 返回未知评审；结果 `unknown`、0 dialogue votes、3 条总票目标，score=0.64、passed=false，带说明且 identity 为空。

这只证明隔离 FakeVLM 与真实 job/store 路径的边界行为，不代表真实模型评分质量。原始探针失败、后续修正轮次与最终同 caseID 证据都保留在摘要所列 JSON 中，失败没有被覆盖或改名为产品故障。

## 结论边界与互核

本席在已执行的交互内没有确认新增 B/H/M；全部原始失败经修正 matcher 后由同 caseID 复跑或对应 QA case 通过，未发现复现为产品缺陷的证据。此结论仅限本席所跑路径，不构成对遗漏操作或整体冻结版本的零缺陷背书。

以下交互仍不能据本席宽矩阵宣称通过：合集内排序及所有 stale / failure / cancel 分支；补全插入后的所有 caret/selection 组合；全套 mask 笔画/反选/羽化/键盘撤销重做；QA 多数票、unknown/no-dialogue 各种组合及显式批采纳；finalize 恢复 draft；四轴各子集编译；剧本逐条应用/全拒/锁定/陈旧/checkpoint；motion 原生 fullscreen/TTS/播放器拖动；五模板完整读者、方向、键盘、触屏及 HTML 隐私投影边界。

纯文字互核已阅读其余四份 R4 报告：

- **架构席：无冲突。** 候选图与本席的默认采纳图比较、显式固定浏览候选和无隐式采用结果一致。六面板安装、沙箱与 API 流程补充功能契约证据，但不替代本席未完成的蒙版、QA 批量采纳、陈旧态和动态漫操作路径。
- **视觉席：互补但不补齐。** 主应用对比/引导及五模板子集检查支持已测路径的布局观察；六面板双尺寸、三主题矩阵仍未覆盖。本席的 88/88 功能结果不能替代视觉检查，视觉结果也不扩大本席的交互覆盖。
- **性能席：互补但扩展矩阵未闭合。** 壁纸自然等待 8/8 的暂停与恢复证据不等同于交互验收。扩展启停只完成 23/36；菜单等待失败及其余未测场景尚不能证实为产品缺陷，也不能据部分样本认定六扩展性能通过。
- **混沌席：无直接冲突。** 503 恢复、取消、卸载和桥隔离证据补充失败路径，但不替代键盘、IME、拖拽和焦点操作。XSS 的 20 个 case 虽逐项输出通过，包装进程仍以 exit 15 结束，不能记录为完整命令通过。
- 本席 focused 轮次中经同 caseID 修正探针复跑的比较结果与架构席候选身份检查一致；原探针失败继续保留。各席没有提供足以推翻本席已测范围结论的新 B/H/M，但未覆盖路径仍有效；本席与 R4 综合状态继续为 **NOT VERIFIED PASS**。

## 进程、端口与 TEMP 清理

下表记录本席真实 Chrome / 服务进程及创建时间（epoch seconds）；服务端口与 CDP 端口为随机 loopback。所有运行均在各自 finally 清理。终态检查时所有本席 PID 均缺席，相关端口均无 LISTEN。PID 4500 后被系统分配给较新的 `node.exe`，创建时间与本席服务不同；没有触碰该新进程。

| 轮次 / 进程 | PID · creation time | 端口 | 终态 |
|---|---|---|---|
| broad road / pro / Chrome | 38072 · 1795682220.2211695 / 25784 · 1795682223.5979445 / 38292 · 1795682226.9432802 | 59179 / 59180 / CDP 59181 | 均关闭 |
| 初始 focused road / pro / Chrome | 7188 · 1795683895.3347833 / 40956 · 1795683898.099553 / 42944 · 1795683900.857597 | 52015 / 52016 / CDP 52017 | 均关闭 |
| fixture 启动失败的 road server | 46588 · 1795688141.6687064 | 64524 | ImportError 前置失败后退出；未启动 Chrome、未执行 case |
| focused repair 1 road / QA / Chrome | 37588 · 1795688376.3208792 / 43800 · 1795688379.1119823 / 48352 · 1795688381.8502643 | 54498 / 54499 / CDP 54600 | 均关闭 |
| focused repair 2 road / QA / Chrome | 50200 · 1795688774.1872296 / 4500 · 1795688777.5446837 / 33156 · 1795688780.291731 | 63098 / 63099 / CDP 63100 | 均关闭；PID 4500 后续是不同创建时间的新进程 |
| 最终同 caseID road / Chrome | 36600 · 1795689165.649596 / 4152 · 1795689171.2810867 | 56396 / CDP 56397 | 均关闭；最终直接核验无进程/无 LISTEN |

本席已告知总控不会再开浏览器。紧凑证据 JSON：`C:\Users\QIU\AppData\Local\Temp\mio-feel-r4-bq5hbr86\feel-r4-summary.json`，8,846 bytes，SHA-256 `9ee88265c9948535ff403c8c2ec68be8af71f60cb533cd760f060cb61759dff0`。该 JSON 保留 88-case 结果、focused 各轮计数和错探针修正、最终 pair/adopt 事实、所有进程创建时间/端口、未覆盖边界和 TEMP 清理终态。清理前的本席 TEMP 核对为 72 个直接项、2,347 files / 209,683,944 bytes。对该唯一目录中除摘要 JSON 外的直接子项所做精确路径递归删除在执行前被工具以 blocked by policy 拒绝；没有文件被删除，也没有尝试替代删除方式。浏览器 profile、夹具工作区及其 recovery 副本、原始 JSON、脚本、日志和 HTML/ZIP 均仍留在此自有 TEMP；其他 TEMP、用户数据与恢复目录未触碰。
