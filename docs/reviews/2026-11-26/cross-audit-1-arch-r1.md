# CrossAudit-1-Arch-Isolation · 首轮独立复审

状态：**首轮交叉互核完成，签发 NOT PASS**。本官发现 2 项已复现 Medium、1 项 Low，均未修复；不能据此宣称本轮全票通过。

## 审计身份与边界

- 审计日期：2026-11-26（Asia/Shanghai）。审计官未参与本轮产品编码，独立启动。
- 固定代码：`d9cfa801c42f19db29788ea044d31eaf1c50c221`；浏览器探针前后 HEAD 一致。
- 固定构建：`web/dist/index.html` SHA-256 `66e3085d61fc54a598243e1d3a36b95e05ea4de17cdbb8b4ff21d4013692a33d`。
- 真实浏览器：本机既有 Chrome `158.0.8127.37`，独立 headless 进程和隔离 context，1440×900；没有操作用户现有标签。
- 依据：本仓库 `AGENTS.md`、`README.md`、`docs/ROADMAP.md` 与用户原始完整任务。原始任务明确允许六个独立、默认停用的专业扩展；没有把 AGENTS 旧“仅后端”边界误用为禁止已授权扩展。
- 写入范围仅本报告与自有临时目录。没有改源码、测试、构建、随包或私人运行数据，没有提交/推送、安装依赖/浏览器、运行付费模型/真实 GPU 或重复全量门禁。
- 夹具：复用仓库 `professional_browser_fixture.py` 的中性 FakeComfy/FakeLLM/FakeVLM；实际只做读取、安装和生命周期请求，模型调用与任务数全程保持 0。

## 本轮结论

关闭六扩展时的默认基座、六包独立性、摘要信任、沙箱内存储隔离、首个 MessagePort 绑定、文件变动与停用资源撤销、安全模式重启，以及生成产物一致性均获得独立证据。**取消任务声明与真实 API 权限不匹配，导致两面板的停止任务路径固定 403，因此本轮不能通过。**

## 结构化发现

### A1-M01 · Medium · 单格/成品精修的取消操作声明与真实 API 权限冲突

- 路径：`extensions/panel-retouch/mio-extension.json:23`；`extensions/finalize-studio/mio-extension.json:53–56`；`server/mio_server/auth.py:104–114`；`server/mio_server/extensions/panel_bridge.py:66–75`。
- 复现：通过官方界面导入 ZIP、查看摘要并明确启用这两个包，取得本次有效 activation/digest。向真实 `/api/extension-panels/{extension}/{panel}/requests` 提交 `request_id: "cancel"`、`path_params: {"job_id": "audit-nonexistent"}`；两者都返回 HTTP 403、`detail: "panel request scope does not match the target operation"`。直接请求同一个 `/api/jobs/audit-nonexistent/cancel` 则返回 404，说明真实路由能进入任务查找，而桥在进入任务查找前就拒绝。
- 预期：合法声明应进入既有取消任务 API，再依任务状态决定成功/冲突/不存在。
- 实际：两个 manifest 均写 `scope: "render"`，而该现有路由由 `required_scope` 判定为 `write`；`_target` 要求二者相等。拒绝发生在读取 job 之前，因而并非“不存在的测试任务”导致，任何有效任务同样无法从这两个受控面板停止。
- 影响：长时间 GPU/云端任务的停止按钮无法完成其功能；用户需要离开面板从其它入口停止。没有通过放宽鉴权绕过它。
- 证据：自有 TEMP 的 `cancel-evidence.json`。47 条六包声明逐项匹配唯一真实 typed operation，仅此两条权限不匹配；其余 45 条匹配。
- 独立 UI 互核补充：第 5 席随后在自己工作区建立未启动执行器的中性 blocked 任务，正常输入 `#job-id`、刷新后点击可用的 `#job-cancel`；两面板均 403、任务仍 blocked，同任务原生取消均 200/canceled。此证据进一步证明正常 UI 失效，但不冒称实测运行中 GPU 上游中断。
- 建议：使声明和实际契约一致，并补充穿过真实桥的取消契约回归。修复后需真实复核活跃/排队任务取消，不应只测试已完成任务的禁用按钮。

### A1-M02 · Medium · 顶层打开面板文件 URL 时不再是 opaque origin

- 路径：`server/mio_server/api/extension_surfaces.py:316–338`；对照 `web/src/components/ExtensionFrame.tsx:146–151`、`server/mio_server/extensions/README.md:359–362`。
- 最小中性复现：在隔离 context 的主站写入合成标记 `audit-sentinel = synthetic-public-value`，正常启用 `panel-retouch` 后直接在该 context 新页打开 `/api/extensions/panel-retouch/files/index.html`。
- 实际：正常官方 iframe 的 `self.origin` 为 `null`、读 localStorage 抛 SecurityError；直接 URL 新页的 `self.origin` 为主站 origin，读取合成标记返回 true。没有读取任何真实用户存储值。
- 响应 CSP：`default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; frame-src 'none'; style-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'; frame-ancestors 'self'`。没有 HTTP `sandbox` 指令，隔离仅由宿主 iframe 属性提供。
- 预期：同一个受控 HTML 资源即使通过顶层 URL 打开，仍应保有面板的 opaque-origin 边界；实际可读取宿主源存储，隔离承诺只在嵌入路径成立。
- 影响与限定：已启用的纯面板资源直接打开后获得主站源权限。面板本身经过用户摘要信任；正常 iframe 没有顶层导航或弹窗许可，不能把“用户直接导航”冒称为已证明的自动逃逸，也不将其夸大为外部零点击入侵。
- 交叉互核：新任安全/可靠性官已用自己独立的服务和 Chrome context 复核六个包；正常 iframe 均 opaque，顶层 URL 均恢复宿主源，HTTP CSP 均无 sandbox，独立建议 Medium。本官同意该分级。
- 建议：为面板 HTML 响应施加 `sandbox allow-scripts` CSP，保持现有 opaque MessagePort 协议；修复后重测六包业务、顶层地址、安全模式和 motion 的 fullscreen 委派，不能通过加入 allow-same-origin 解决功能回归。
- 证据：`browser-evidence.json / checks.direct_document_boundary`，与六个正常 iframe 的 `six_isolation` 对照。

### A1-L01 · Low · 英文主站的官方面板入口仍固定中文

- 路径：`web/src/extensions/hostSlots.tsx:118–132`、`web/src/components/ExtensionFrame.tsx:148` 与六包 manifest 的 `title`。
- 复现：Chrome context `locale=en`，主站 `mio.locale=en`，开启六面板。各 iframe 内 `html.lang=en`，但话内菜单按 `panel.title` 原样呈现，iframe 可访问名称分别仍为“单格精修”“成品精修”“候选评审”“剧本助手”“变体工坊”“Motion comics · 动态漫”。
- 预期/实际：官方面板的英文入口应与英文内容相符；当前面板内部翻译存在，宿主入口元数据没有本地化。
- 影响：英文用户的工具识别和可访问名称不一致；不阻断正常操作。
- 证据：`browser-evidence.json / checks.six_isolation[*].lang, visible_title`；源代码直接使用未翻译标题。

## 实测覆盖与通过证据

| 范围 | 方法与实际结果 |
| --- | --- |
| 默认基座 | 关闭状态进入真实话内 board：0 iframe、0 专业扩展菜单、0 专业 files/bridge 请求、`/api/extension-panels=[]`。停用六包后再加载同路由结果一致。 |
| 包独立且默认停用 | 从 HEAD 逐文件构造只含六个官方包的发行视图，用真实 `AppContext/ExtensionManager` 新建空工作区：六包各有独立 manifest，`builtin=true`、`status=disabled`、贡献为空，无 Python main。 |
| 安装与信任 | 在真实扩展管理页逐包 ZIP 导入；启用前核对 `status=disabled`、可见 64 位 SHA-256 摘要与 API 一致，点击“Trust and enable”才出现面板。导入包未获得 builtin 豁免。 |
| 延迟资源 | 静态扫描没有 `web/src` 直接导入六包实现；构建 JS/CSS 未包含包实现选取的长指纹。真实关闭路径没有下载六包 HTML/JS/CSS。此项不替代性能官的计时/内存实测。 |
| 六 iframe 沙箱 | 六个均为 `sandbox=allow-scripts`，无 allow-same-origin；`self.origin=null`，parent DOM 和 localStorage 均 SecurityError；直接 fetch `/api/series` 因 CSP 失败。 |
| MessagePort | 六个已初始化面板再次提供匹配 session 的新 ready/port，不获 init；正常显式读取仍经受控桥成功。源码检查确认 window 消息仅接受 ready 握手，业务接收器绑定首个 port；未宣称这覆盖所有浏览器消息竞态。 |
| 声明/鉴权 | 未声明请求 403；过期 activation 404；路径穿越参数 422；合法读取 HTTP/target 均 200。v2 匿名 401；read token 合法读取 200，render 操作 target 403，未越权执行。 |
| 变动即拒绝 | 仅修改自有 TEMP 安装副本 `panel-retouch/app.js`：状态立即 changed，files 和 bridge 均 404，活动列表不再返回该面板；随后恢复原始副本字节。 |
| 停用 | 六包逐一停用：每包 files 和 bridge 均 404；重新进入 board 时入口和 iframe 均不存在。 |
| 安全模式 | 正常进程保留已启用的六包状态后退出，另起 `MIO_SAFE_MODE=1` 进程加载同一个自有中性工作区：六包均未加载，0 iframe/资源/面板，手工 enable 400，files 404。 |
| 共用真实后端 | 47 条 manifest 请求各映射恰好一个现有 OpenAPI typed operation；六包均无 Python main、无第二套数据持久化后端。例外为 A1-M01 两项 scope 错配。 |
| OpenAPI/Python | 当前真实 v2 OpenAPI 与 HEAD `clients/openapi-v2.json` 规范化字节一致；调用实际生成器的 render 结果与 HEAD Python、AstrBot 自包含客户端均一致。没有写回生成文件。 |
| 前端类型 | 当前本地 OpenAPI 经原生成脚本同样 normalization/openapi-typescript 选项生成到内存，与现有 `schema.d.ts` 字节一致。 |
| HEAD 发行清单 | 只使用 `git show HEAD:data/...` 构造发行视图，真实 `check_distribution.verify` 验证 64 个清单文件，0 缺失/变更；未以本机运行态数据冒充发行数据。 |
| 主站中英 | 编译实际 zh/en 字典，2857/2857 个叶键集合完全一致；1700 个静态 `t()` 键中两种语言缺失均为 0。 |
| 六包中英键 | TypeScript AST 读取包自身双语字典：retouch 114/114、finalize 79/79、QA 68/68、script 58/58、variants 69/69、motion 70/70；缺失键均 0。A1-L01 是入口元数据，不被这些键集合检查覆盖。 |

## 强制交叉互核记录

- 已把 A1-M01 发给总控和交互官；交互官确认其正向“已完成任务后按钮禁用”样本不能反证活跃取消契约，修复后应覆盖真实取消路径。
- 已把顶层 origin 的无私人数据最小复现发给新任安全/可靠性官；其独立 Chrome 六包复现与本官一致，现记为 A1-M02（Medium），没有将正常 iframe 测得的隔离结果与顶层缺口混为一谈。
- 交互官报告的变体矩阵四维缺口，经独立后端复核成立：`VariantSet` 只有 `characters/style_id/profile_id`，`story.apply_variant` 仅 patch 角色，场景沿用原 Bible；`variant-workshop/model.js:13–65` 只展开 styles×characters。复制整个 outfits 字段不能替代独立服装项选择，现有 API/其它入口不能完整弥补服装、场景维度。作为交互官主发现的支持证据，不重复另立编号。
- 交互官报告的 motion 全屏权限问题：最小建议是在不加入 allow-same-origin 的前提下只委派所需 fullscreen，HTTP CSP 隔离与 fullscreen Permissions-Policy 不应互相替代。独立浏览器功能复测由交互/安全官负责。
- 已向性能官提供关闭前后资源/iframe 计数证据；本报告没有把这些计数冒充 CPU、内存、瓦数或 VRAM 测量。
- 视觉官确认其 42 格矩阵仅覆盖中文，没有声称覆盖 A1-L01 的英文入口，因此与本官结果不矛盾；其本包 hover/primary 对比度 Medium 应以局部样式修正，不涉及基座资源加载或其它扩展，架构上没有冲突。本官没有把视觉官发现伪记为自己做过的对比度测量。
- 四官互核后的边界一致：视觉/交互正向流程通过、性能计数正常，均不能抵消独立取消契约和顶层隔离缺陷；修复 CSP 不需放宽 same-origin，修复局部对比度不需增加高成本滤镜。没有发现必须在本轮相互取舍的冲突。
- 后续完整阅读性能官草稿：九次关闭/开启/再关闭首屏同 23 个 JS/CSS、0 面板实现/iframe，18 次关闭后 DOM693、宿主 retained JS 5.901–5.959MiB；报告明确没有将有限 JS/DOM 结果解释为零总 RAM、零 CPU 或绝对无泄漏，无需更正。C4-M01 的长篇比较拖动六次每轮 60 个长帧属于真实未决 Medium；它把 SplitCompare 标为入口、没有在无 profile 时强归因具体模块，也没有将只观察 open 的 topLayer observer 误判为 transform 热点，与架构证据无冲突。
- C5-M01 超时恢复缺陷由第 5 席真实等待两轮 30 秒复现，第 4 席已互核，本官追加只读源码互核同意 Medium：retouch 的 failure 仅清子面板 pending，宿主 pending 要等待 fetch finally 或整帧卸载，故两轮读取可耗尽四槽。建议宿主每 rid 有界 deadline、AbortController 与幂等回收；中断浏览器 fetch 只代表结束等待，不能宣称后端写操作已取消/回滚，也不能自动重放。此为其它席主发现，不重复计入本官两项 Medium；本官没有重复真实超时实验。

## 未覆盖与证据清理

- 本官不重复其它四官负责的全量视觉、390px、键盘、功耗采样和模板恶意数据矩阵；也没有进行真实 GPU、付费模型或云端服务效果验证。
- 发行清单结论严格针对 HEAD 的 64 个发行文件，不表述为用户本机整个 data 目录“干净”。
- 正常 iframe 与直接 URL 的边界均已测，并获安全/可靠性官独立互核；不能用正常 iframe 安全结果消除直接路径证据。
- 本轮自有所有 Chrome/服务进程已退出。未保存截图。自有中性工作区、发行副本、ZIP、日志和大 OpenAPI 中间文件已删除；紧凑 JSON 证据和可复现窄探针暂留自有 TEMP `mio-cross-arch-r1-4p3w4z2p`，待总控汇总后删除；其中不记录令牌值、真实用户存储或网络会话。

签发：**NOT PASS（A1-M01、A1-M02 未修复；0 Blocker、0 High、2 未决 Medium、1 Low）**。本结论固定于上述代码和构建，不可沿用为后续修复提交的复审签发。
