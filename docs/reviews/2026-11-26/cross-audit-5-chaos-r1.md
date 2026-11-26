# 第 5 席独立复审：异常恢复、输入边界与隔离配置（R1）

- 审计日期：2026-11-26（Windows 本机，Asia/Shanghai）。
- 快照：`d9cfa801`；浏览器：已安装 Chrome `158.0.8127.37`，独立 headless 上下文。
- 目标：原始 Wave 5 第 5 项，及与第 1、3 席的隔离/取消操作交叉复核。
- dist index SHA-256：`66e3085d61fc54a598243e1d3a36b95e05ea4de17cdbb8b4ff21d4013692a33d`。
- 权限边界：只写本报告和唯一自建 TEMP；未修改源码、构建或私人数据，未提交推送，未安装依赖/浏览器，未碰用户浏览器标签。所有模型路径均为本地中性假服务；未访问外部服务、GPU 或真实用户存储。
- **R1 结论：NOT VERIFIED PASS。0 Blocker、0 High；已有 1 项独立确认的 Medium，另独立确认架构席 A1-M01 / A1-M02。须修复并独立复审后再签发。**

## 发现

### C5-M01 · Medium · 面板超时未释放宿主并发槽，服务恢复后无法原地重试

- 路径：`extensions/panel-retouch/workspace.js:92,105`；`web/src/components/extensionBridge.ts:107,243-250`。
- 复现：仅在临时夹具服务给已声明的只读 `episode`、`profiles` 请求增加 180 秒服务延迟；通过正常 UI 打开单格精修，点击「读取话」并等待自然超时，再点击一次并等待超时。此时撤除后续请求的延迟条件，再次点击「读取话」。没有假时钟，没有修改应用文件或发送新攻击载荷。
- 实际：两次超时分别在 **30.29 秒 / 30.30 秒** 可见显示；此时宿主未结束 fetch 数依次为 **2 / 4**。服务恢复后第三次读取立即显示 `读取失败：Panel request limit reached.`，未结束 fetch 仍为 4。正常 SPA 点击「画册集」后，四个旧请求的 AbortSignal 均触发并结束；重新进入面板可正常读取。
- 预期：面板已宣布本次请求超时后，宿主的相应只读请求及并发槽具有有界生命周期；服务恢复后可在当前面板显式重试。可能已提交的写操作仍应先核对结果，不能自动重试。
- 影响：一次读取同时占两槽，两轮超时即可使专业面板本次会话失去恢复能力，只能离开后重进。属于真实异常恢复与资源回收缺陷，不是持续全站内存泄漏的证明。
- 证据：自建 TEMP `recovery.json` 的 `timeout` 与 `spa_unmount`；后台中性夹具 `model_stats.calls={comfy:0,vision:0,text:0}`，`jobs=0`，外部请求 0。
- 交叉结果：性能席按源码和本席自然超时实测独立互核，同意 Medium；正常三轮开关的健康采样不能覆盖该异常槽耗尽。

### A1-M01 · Medium · 两包停止任务声明 scope 与原生取消操作不匹配（第 1 席主发现，本席独立互核）

- 路径（固定审计快照）：`extensions/panel-retouch/mio-extension.json:23`、`extensions/finalize-studio/mio-extension.json:53-56` 的 `cancel` 请求声明；实际目标为 `server/mio_server/api/jobs.py:104-106` 的 `POST /jobs/{job_id}/cancel`。
- 复现：在自建临时工作区放入两个纯中性任务，任务引擎不启动、执行器不执行。正常进入两个面板，在 `#job-id` 输入各自任务 ID，点击刷新，停止按钮变为可用，再正常点击 `#job-cancel`。
- 实际：两个桥请求均为 **HTTP 403**，`detail=panel request scope does not match the target operation`。单格精修可见 `停止任务失败：…`，成品精修可见相同 scope 错误。两个任务原状态 `blocked` 保持不变；对同一任务调用原生取消接口均 **HTTP 200 / state=canceled**。
- 预期：受审面板的声明 scope 应与原生目标操作完全一致，正常停止操作应真正提交到任务引擎。
- 影响：这两包当前「停止任务」操作被契约校验固定拒绝。为了不混淆证据，本席没有声称这次测试证明运行中 GPU 任务的上游中断；本例明确是无执行器、未运行的中性任务。
- 证据：自建 TEMP `lifecycle.json.cancel_cases`；与架构席的契约复现一致。

### A1-M02 · Medium · 已启用面板正常顶层打开时取得宿主源（第 1 席主发现，本席独立互核）

- 路径：`server/mio_server/api/extension_surfaces.py:331-338`；隔离承诺见 `web/src/components/ExtensionFrame.tsx:33-37`。
- 复现：通过官方 UI ZIP 导入并审阅摘要启用六包。分别正常从话内打开面板，随后在同一隔离浏览器上下文的新页中正常 `goto` 该 iframe 的官方资源 URL；仅读取页面 origin 和响应头，未读取 storage 或任何用户内容。
- 实际：六包 iframe 均为 `sandbox="allow-scripts"`，`self.origin="null"`；六包同资源顶层打开时均为 HTTP 200、`self.origin=宿主 origin`。响应 CSP 有 `connect-src 'none'`、`frame-src 'none'`、`form-action 'none'`，但无 HTTP `sandbox`；无 `Permissions-Policy` 响应头，iframe `allow` 属性为空。
- 预期：作为沙箱面板分发的 HTML，在 iframe 和正常顶层导航下均保持 opaque origin；不能依赖承载元素单独提供隔离。
- 影响与前提：需要包已被用户信任启用且用户顶层访问该资源。本席不声称 iframe 自动逃逸、未信任包执行或外部零点击攻击；后端扩展代码本身的信任风险不等于面板浏览器源隔离承诺。
- 交叉结果：架构席已同意 Medium。单独缺少 `Permissions-Policy` 不作为新漏洞；仅给动态漫 iframe 委派 fullscreen 不需要 `allow-same-origin`，与 opaque origin/CSP 限网兼容。

## 已完成覆盖及真实结果

| 范围 | 方法与证据 | 真实结果 |
|---|---|---|
| 六专业面板核心、503 与空态恢复 | `tools/check_professional_browser.py --width 390 --theme light --locale zh-CN`；真实 Chrome | **7/7 通过**：六包显式操作、空态、一次 503、无自动重试、手动重试；第七项为默认停用/摘要信任/停用撤权/卸载 |
| 断网可见恢复 | Chrome 对动态漫声明的 episode 读取制造 `internetdisconnected` | 显示 `请求失败：Failed to fetch`，恢复网络后原地显式读取成功；一次拦截，无外部网络 |
| 超时恢复 | TEMP ASGI 延迟，原应用 Chrome，真实等待两轮 30 秒 | **失败，C5-M01**；导航卸载可终止四个宿主请求并恢复 |
| 扩展摘要变化 | 仅追加临时已安装副本 CSS 中性注释，正常 UI 再读取 | 列表立即 `changed`，HTML 资源 404，旧摘要桥 404；可见 `extension content changed; review and enable it again` |
| 真正安全模式重启 | 对前述隔离工作区以 `MIO_SAFE_MODE=1` 新进程启动，Chrome 正常访问 | 六包全部 disabled，面板列表空；六次手动 enable 均 400，六次顶层资源访问均 404，页面 iframe=0 |
| 正常 iframe/顶层 origin | 六包独立真实 Chrome 矩阵，响应 CSP 与 featurePolicy | iframe 全 opaque；顶层全宿主源，**A1-M02**；未读取任何实际存储 |
| HTML 上传/回导 UI | `tools/check_album_import_browser.py --width 390 --theme light` | **1/1 通过**：错误扩展名、无元数据 400、错误清除与重试、默认不附源资料/明确选择、单/批量回导、已有主动外观 HTML 样本保持惰性，外部请求 0 |
| 输入限额与原子回滚 | 本次运行 `test_panel_upload`、`test_extension_surface_digest`、5 个相关 `ExtensionApiTests` 与 `test_album_import` | **30/30 通过，140.562 秒**；涵盖伪造/截断/动画/像素/字节限额、声明与上下文身份、摘要变化中断上传无新增资产、HTML schema/歧义/图片引用/几何/总量、后段发布失败回滚元数据并保留共享资产、五模板全部投影字段与 RGBA 像素回导 |
| Multipart 取消与临时文件 | 现有 `UploadBoundaryTests` | **3/3 通过，0.102 秒**；小限额提前中止；disconnect/CancelledError 关闭全部已落盘 spool，临时目录为空 |
| Windows/Linux 分隔符边界 | 本机运行既有 ZIP 路径语料 `../escape.txt`、`..\\escape.txt`、`\\absolute.txt` 及别名语料 | 全部 400，未遗留 escape/.staging；Linux 原生运行未覆盖，不把跨分隔符语料等同于 Linux 系统实跑 |
| 快速连点与 SPA 卸载 | 六次物理点击同一个待读按钮，然后真实 SPA 点击画册集 | 合并为一次读取意图（episode+profiles 两 HTTP）；按钮 pending 期间 disabled；卸载后宿主未结束 fetch=0，iframe=0 |
| 两包任务停止 | 真实 Chrome 正常填写 ID、刷新、停止；同任务原生取消作对照 | **失败，A1-M01**；两个面板均 403，原生均 200/canceled，未调用模型 |
| 动态漫短程资源回收 | 同一 SPA 文档内六轮读取/播放/停止/返回，CDP GC 后采样 | 每轮 iframe=0、未结束面板 fetch=0、documents=2；最后卸载后 1.2 秒无后续面板请求，pageerror=0、外部请求=0。DOM/listener 增长未完成归因，见下方限制 |

## 交叉互核状态

- 第 1 席 A1-M02：已独立六包复现并就 Medium 分级达成一致。
- 第 1 席 A1-M01（retouch/finalize cancel scope）：已独立通过两包真实 Chrome 正常 UI 复现，任务原生取消作对照，确认 Medium；不把短任务完成冒充活跃任务停止通过。
- 第 3 席动态漫 fullscreen：本席确认现有 `allow=null` 且 opaque iframe 不自动取得 fullscreen。受审动态漫 iframe 定向委派 fullscreen 与保留 `sandbox=allow-scripts`、CSP 限网不冲突；最终修复后的全屏/退出行为由第 3 席实测。
- 第 4 席已互核 C5-M01 并同意 Medium、有界 deadline 回收建议与写操作不自动重试边界。性能席确认自身正式探针会释放 Playwright handle，不将本席未归因 DOM 增长直接解释为产品泄漏。
- 后续修复须交叉验证 CSP 不破坏 opaque 消息桥、下载、媒体与动态漫全屏；修复后的代码不在本席 R1 的固定快照签发范围。

## 范围限制与证据保管

- 未覆盖真实 GPU、付费模型、外部网络、Linux 原生进程、长时内存/文件句柄压力。已有短程资源边界证据不能推论绝对无泄漏。
- 动态漫六轮 GC 后 DOM nodes 为 498 / 545 / 590 / 635 / 680 / 725，listeners 为 399 / 415 / 423 / 431 / 439 / 447。探针复用了仓库 `center()`，它调用 `element_handle().owner_frame()` 而不主动 dispose，自动化句柄可持有已移除节点；此增长未归因，不能作为已确认产品内存泄漏，也不能签发无泄漏。独立性能席已收到该边界。
- 本席没有重新跑全量门禁或依赖历史 CI 签发；全量由总控另行核验。
- 首版额外探针用 Playwright 取消路由恢复网络时会一并解除已挂起路由，因此不能据此验证宿主槽耗尽；已废弃该推论，并以第二版真正服务端延迟探针完成上述 C5-M01 复现。
- 未创建截图。所有自建夹具服务和 Chrome 均已退出；自建 TEMP 工作区、ZIP、脚本和日志已清理，仅保留合成 JSON 证据待总控汇总，未包含令牌/秘密/私人作品。
- TEMP 位置：`C:/Users/QIU/AppData/Local/Temp/mio-cross-audit5-r1-tb8pgkqm`。核心文件：`professional.json`、`album.json`、`probe.json`（origin/offline 部分有效）、`recovery.json`、`safe.json`、`lifecycle.json`。

```json
{"audit":"cross-audit-5-chaos-r1","snapshot":"d9cfa801","status":"NOT_VERIFIED_PASS","blocker":0,"high":0,"own_medium":["C5-M01"],"cross_verified_medium":["A1-M01","A1-M02"],"chrome":"158.0.8127.37","professional_browser":"7/7","album_browser":"1/1","narrow_backend":"33/33","private_data":false,"real_models":false,"external_requests":0,"screenshots":0,"processes_cleaned":true}
```
