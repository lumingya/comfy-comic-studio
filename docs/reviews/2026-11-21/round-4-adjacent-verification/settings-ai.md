# 第四轮独立复审：设置与 AI 辅助

检查对象为 `ddf8d81` 上的当前 working tree，包含未提交与未跟踪修复；没有把 HEAD 当作待审代码。仅写本报告，未改生产、测试、生成物或共享表，未提交／推送。

已读 `AGENTS.md`、README、路线图、当日审查索引／FINDINGS、第三轮 `settings-ai.md` 和 `fixes/settings-drafts.md`、`ai-backup.md`、`ai-drafts.md`。先列独立攻击组合，再读对应实现和既有测试。

## 结论与闭项矩阵

| 原项 | 独立结论 | 实际证据 |
| --- | --- | --- |
| SET-AI-01 附件阻断备份 | 通过，可关闭 | 真实 TEMP upload → head／backup → download／inspect → stage／apply → 重启；恢复后原 URL 读取原 PNG，后上传附件不存在；精确旧别名及篡改检查 |
| SET-AI-02 设置旧草稿回退 | 通过，可关闭 | 字段意图、同事务比较和原子拒绝；后台刷新、保存中再编辑、创建／删除迟到回执、MASK opaque 版本；另做 3 组 hook 和 4 组真实 HTTP 组合 |
| SET-AI-03 已删会话 pending 污染 new | 通过，可关闭 | 原 key／冻结 payload 保留，404 恢复独立 new；旧回执 accepted／not_found／404 与旧发送迟到均隔离，不自动重发；真实 Chrome 另验证旧发送成功迟到 |
| SET-AI-04 保存期间后输入丢失 | 补修后通过，可关闭 | 独立组件保护起初仍漏宿主模式切换卸载；已独立复现、交作者补修，再用真实宿主 iframe 窄复验通过，详见下节 |
| SET-AI-05 前端 2 GiB 限制 | 通过，可关闭 | DOM 边界 2 GiB+1、12 GiB、12 GiB+1；Chrome 12 GiB metadata 显示检查入口，12 GiB+1 显示 12 GiB 错误且无检查按钮 |

另发现一个可独立触发的既有视觉缺陷 **R4-SET-UI-01**：入场动画使主设置保存条定位到视口外；不是本轮字段意图改动引入，主控已纳入修复，**最终独立复验通过，可关闭**。当前范围没有未关闭的已确认缺陷。

## SET-AI-04 补充：宿主先卸载 iframe

最初的 31 项 AI 页面测试及独立页面 Chrome 检查均通过，随后专门组合真实宿主刷新行为，得到反例：

1. 宿主显示 AI 浮窗，打开设置，将模式从 floating 改成 page。
2. 点击保存并保持 mock PUT 未完成；切换到模型标签，输入 `unsaved-after-mode-submit`。
3. 完成 PUT。其提交模型仍为 `offline-only`，只有一次 PUT。
4. `page/api.ts` 的成功处理先 `notifyHost('changed')`；`hostFrame.tsx` 刷新查询；动态 surface.mode 变成 page，`host.tsx` 过滤 floating overlay 并卸载当前 iframe。实测 `iframeCount=0`，后输入没有提交，设置草稿随 iframe 消失。组件自己的快照判断不能阻止宿主卸载。

这属于 SET-AI-04 的未闭组合，未另算同类缺陷。已立即同步主控／作者。作者保持普通保存可继续编辑，仅当**提交的模式不同于打开弹窗时的模式**时，在 pending 期间禁用三个标签页和整个原生 fieldset。

对最终 AI 产物 `index-CfHqejZ7.js`／`index-Dxzc9sIq.css` 的窄复验：

- `AssistSettings.test.tsx`：12 passed，覆盖三类标签页的模式保存禁用、失败解禁与既有保存草稿用例。
- 真实宿主 Chrome：模式提交 pending 时所有 tab 和模式 select 均原生 disabled；成功后 floating iframe 为 0、page iframe 为 1，导航到 `/extensions/ai-assist`，不存在可接受后续输入后再丢弃的窗口。
- 真实宿主 Chrome 的普通保存仍能输入新模型；第一次响应后 iframe／弹窗仍在，新模型保留；第二次显式保存才持久化并关闭。
- 最终 fieldset CSS 已重做 1440／390、浅深截图并实际查看；标签、字段、提示与保存按钮可读，弹窗未横向溢出。

## 设置与 opaque 版本核验

阅读 `settingsDraft.ts`、General／Channels、`api/system.py` 和 `settings.py`，并执行对应测试，确认：

- General 按 LLM 子字段提交；渠道用稳定 ID 的 before／after，未编辑字段依最新查询显示。刷新不会把旧草稿的其他字段变成自己的保存意图。
- 服务端在同一 `store.tx()` 里读取、比较、应用、校验和保存；同字段并发一胜一冲突，重复 ID／已删渠道／完整行删除／多字段失败均不留下部分写入。
- MASK 不是比较版本。含 MASK 的基线必须携带捕获时的 opaque `expected_revision`，进程内随机 HMAC 派生、不持久化；旧版本、非 ASCII 版本或缺版本不能借 MASK 绕过。后台未编辑密钥保留最新真实值，公开结果继续遮蔽，MASK 不落私有配置。
- `write_revision` 在 protected 集合内，直接回写不能将公开 token 存成配置字段；重启更换 HMAC 密钥使旧隐秘草稿保守冲突。这个全设置 token 会因无关更改保守冲突，不宣称提供跨进程精细凭据版本。

额外的 3 组 hook 组合使用当前源码经临时转换后加载真实 React hook，全部通过：

1. General 提交 90，pending 时改回 30；回执后仍 dirty，下一次请求 expected=90、after=30。
2. 新渠道 create → pending 中删除 → 同 ID 重新新增并改名称／合成凭据；旧 create 回执不覆盖重建意图，后续变成正确字段修改。
3. 保存渠道名称时，首次修改另一字段；成功响应中即使该字段已变化，也不偷偷把新的服务端值当成用户观察基线，后续比较仍保留原始观察值。

额外的 4 组真实 HTTP 组合使用独立 TEMP AppContext 与空 legacy，全部通过：默认渠道+名称字段与其他渠道远端模型合并；过期 MASK 删除连同普通字段整体 409；公开 write_revision 不能持久化；创建新渠道+删除旧渠道+切默认在同一请求里原子完成。

主控全量门禁后来发现的 `ConfigurationModels.test.tsx` 局部浅合并 mock 也纳入只读复核：夹具现模拟真实 LLM 一层合并、公开遮蔽和 opaque 版本，并等待保存后的稳定界面；独立重跑 5 passed、无 unhandled error。另独立执行新增 image_models 部分 PATCH 的真实 API 单项，通过并确认完整 LLM 响应与私有密钥保留。生产页未添加兜底空串掩盖缺字段。

## 附件备份与严格边界

独立运行新增 7 项真实 API／磁盘用例，均通过、无 skip。不是手工写旧 URL 代替实际上传。用例实测规范 URL、精确同 ID 历史别名恢复后返回当前可读 URL；历史元数据字节和归档摘要保留。origin／query／fragment／其他 ID／路径变体／尾斜杠被拒绝。

篡改并重算归档 entry hash 后，错误 ID、大小、非受支持 MIME、带 token 的新旧别名仍被 inspect／restore-plan 拒绝；单文件和总预算、成对文件及引用检查保留。复制路径有禁止 `Path.read_bytes` 的哨兵。凭据剥离和显式包含凭据两种模式均实际执行。

## R4-SET-UI-01：入场 transform 使保存条离开视口

在真实当前主前端 dist、1440×1000／390×844 的浅深 Chrome 中，仅改 General URL，保持 dirty 后停在表单开头：保存条存在，但没有出现在视口中。1440 的 bbox 为 `{x:472,y:1268.96,width:880,height:60}`；390 的 y 为 1621.65，均超出屏幕底边。

源码关系：`legacy.css` 的 `arrive` 终态 `translateY(0px)` 与 `.view` 的 `animation-fill-mode:both` 保留 containing block；`main.tsx` 将 legacy 加载在 classic 后；`configuration.css` 保存条的 fixed 因而相对整个 `.view` 定位，长设置页需额外滚动才能找到保存入口。

实际检查祖先样式，只有 `DIV.view` 的 transform 为 `matrix(1,0,0,1,0,0)`，其余 form／settings-panel／settings-layout／main／app 均为 none。只在临时页面取消该 transform 后，同一保存条立即变为 `{x:236,y:900,width:1156,height:60}`，回到 1000 高视口的底部。这个反证只改临时页面，未改仓库 CSS。

主控先尝试只把 arrive 的最终 transform 改成 none；独立复验没有提前关闭：最终 CSS 和 `getAnimations().effect.getKeyframes()` 都确认终态是 none，但 Chrome 在 fill=both 下仍将计算值保留为 identity matrix，原 bbox 不变。仅在临时页改为 `animation-fill-mode:backwards` 后，原 bbox 才回到屏幕底部；已将这条进一步反证交回主控。

最终生产修复在非生成 `legacy-fit.css` 给 `.view` 设置 `animation-fill-mode:backwards`，不改生成 legacy.css，不关闭原始 9px／opacity 入场动画。主控重新完整构建后，独立使用 **main `index-B8Evt9kQ.js`／CSS `index-C6lQdxsS.css`**，全新 Chrome context、没有临时 CSS，再执行 General／Channels × 宽窄 × 浅深：

| 页面与模式 | 最终保存条 bbox | 实际视觉／点击 |
| --- | --- | --- |
| General，1440×1000，浅／深 | x=236，y=900，1156×60 | 均在视口内，提示和按钮完整可读 |
| General，390×844，浅／深 | x=16，y=691，350×56 | 在底部导航和状态栏上方，无遮挡 |
| Channels，1440×1000，浅／深 | x=236，y=900，1156×60 | 均在视口内，提示和按钮完整可读 |
| Channels，390×844，浅／深 | x=16，y=691，350×56 | 在底部导航和状态栏上方，无遮挡 |

八张最终截图均实际打开查看；每个状态都检查保存按钮中心的 `elementFromPoint` 命中按钮本身。两页最后分别按按钮的屏幕坐标执行鼠标点击，**没有使用 locator 自动滚动**；General URL 和 Channels 名称实际写入 mock，dirty 保存条消失。R4-SET-UI-01 独立关闭。

## 执行记录与浏览器覆盖

独立实际执行，而非照抄作者结果：

| 命令／组 | 本复审结果 |
| --- | --- |
| web：SettingsDraft、Configuration、ChannelsExtension、BackupsSection、ModelCatalog | 5 files／60 passed |
| AI 页面全套（首次） | 2 files／31 passed |
| 后端 settings intent、SettingsRegistry、config integrity、image channel discovery | 28 passed |
| `tests.test_bundled_extensions -k AttachmentBackupReviewTests` | 7 passed，无 skip |
| 最终 AI `AssistSettings.test.tsx` | 12 passed |
| 补修后 `ConfigurationModels.test.tsx` | 5 passed，无 unhandled |
| 新增 image_models 部分意图真实 API 回归 | 1 passed |

浏览器为实际已安装 Google Chrome **157.0.8103.50**，使用预装 Playwright 驱动；未安装浏览器。静态服务器绑定随机 127.0.0.1 端口，仅读主控统一构建的当前 dist，全部应用 API 为合成 mock；未启用用户工作区服务。

视觉矩阵是 1440×1000／390×844 × 浅色／深色，分别实际截图、打开图片查看：General dirty、Channels dirty、备份 12 GiB metadata 选择、AI 设置后输入保留、AI 404 后独立新草稿、最终宿主模式切换 pending。AI 独立页用与宿主相同的 context 消息和主题 tokens；宿主页使用真实 frame bridge。保存条补修后，最终抽样未看到受影响弹窗／输入／提示横向溢出或保存按钮被裁掉；没有用 scrollWidth=clientWidth 代替图片检查。

实际控件交互包含 General 和 Channels 保存中二次输入、下一轮 expected 基线、AI 第一次提交后新输入与二次显式保存、旧发送成功迟到后的新正文／可编辑性、模式切换禁止后输入和正常导航。备份浏览器仅分配十余字节 File 并替换 size 元数据，不创建 GB 文件，也未向后端提交伪 ZIP；实际内容往返由 7 项 TEMP API 用例覆盖。

## 安全、清理与未验证范围

- 所有 Python ApiCase 使用 TEMP／空 legacy；独立 HTTP 探针也显式设置空 legacy，没有通过真实本地 `data/` 引入用户配置。没有需要复制公开样例的额外探针。
- 使用合成名称、example.invalid 地址和中性 1×1 PNG；未调用模型、ComfyUI、付费 API、真实云端或修改用户服务。
- 临时脚本、编译副本、mock 响应和截图全部放系统 TEMP，未入仓库。最终留存的 26 张独立截图均已实际查看，然后连同脚本、编译副本与 mock 结果逐文件精确删除；已核对临时目录不存在。脚本在 finally 关闭自有 HTTP 服务和 Chrome，最早的临时静态端口也确认没有监听。仓库里仅留下本报告。
- 未重复全仓测试或全量构建；主控负责全量门禁和生成物。没有验证多进程配置写入、真实多 GB 归档、供应商网络、跨浏览器隐私存储或附件 GC 策略。原会话未知结果保留在原 session key，不代表服务端操作已撤回，也未新增已删会话的恢复入口。
