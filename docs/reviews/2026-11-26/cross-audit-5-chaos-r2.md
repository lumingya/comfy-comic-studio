# 第 5 席独立复审：异常混沌、安全与跨平台边界（R2）

**本轮结论：VERIFIED PASS。0 Blocker、0 High、0 未决 Medium；本席未发现新的 Low 产品缺陷。**

## 固定快照与方法

- 审计日期与环境：2026-11-26，Windows 11 `10.0.26300`，Asia/Shanghai；Python `3.13.6`；真实已安装 Chrome `158.0.8127.37`，独立 headless 浏览器上下文。
- 冻结 HEAD：`5569dc294fd16c7478abbd31317da7e9055c3be7`。报告写入前再次读取一致。
- 实际托管的 dist index SHA-256：`ecd63ebe23e44f17c079d4d256765e9355e24a2fee50a7e30e5e0ece643ccbfa`，两支浏览器探针均在启动时读取并核对；收尾再次读取一致。HTML 隐私专项对全部 81 个 dist 文件的汇总摘要前后均为 `72e282cce4015a7216f19be1bd8b038cb7aac6fe878a3d7be9331b47609df382`。
- 实测窗口：主浏览器首轮自 11:20:11 开始；修正探针断言后完整受影响流程至 11:26:20 完成；独立协议/顶层/XSS 11:27:31–11:27:52；HTML 回导/隐私 11:28:17–11:28:39。隔离 API/路径子探针 11:20:13–11:23:27，11:25:51 完成清理。
- 先读本仓库 AGENTS、README、ROADMAP 及原任务，按用户明确许可审计六个彼此独立、默认停用的可选专业工作台；未用旧 backend-only 原则否定获批交付物。
- 只写本报告与本席唯一 TEMP，未参与前期产品编码；未改产品、生成物、dist 或他席报告，未构建、未跑全量门禁、未安装浏览器或依赖、未访问用户标签/私人运行时/8788/8188。中性 FakeComfy/FakeLLM 与真实 AppContext、HTTP API、任务引擎、真实 Chrome 共同工作，外部请求尝试为 0，无真实模型/GPU/付费服务调用。
- API/路径边界交给本席一个独立子探针，明确禁止其启动 Chrome 和写仓库；本席亲自完成浏览器证据并读取其原始 JSON 整合。各探针均使用唯一 TEMP 与临时端口。

## R1 缺陷独立闭环

### C5-M01：宿主 pending 槽未回收 → 已闭环

审计当前 `web/src/components/extensionBridge.ts:18,158–169,237–270`，并用真实自然等待验证；未使用假时钟，也未把修复代理自己的试验当作本席 PASS。

复现方法：用 `tools/professional_browser_fixture.py` 创建中性隔离工作区，官方 ZIP 导入并人工摘要信任；临时 HTTP 中间件仅对面板已声明的 `episode` / `profiles` 读请求在进入实际路由前延迟 70 秒。通过正常 UI 点击单格精修「读取候选与配置」，等待自然失败，再重复一次；撤去新请求延迟后，仍在当前文档手工读取。

| 当前独立样本 | 自然可见失败耗时 | 实际传输与槽 | 后续结果 |
|---|---:|---|---|
| 第 1 轮读取 | **29.325 秒** | episode + profiles 均 AbortSignal=true、fetch settled=true；pending=0 | 显示操作可能已完成、先核对再重试 |
| 第 2 轮读取 | **29.214 秒** | 再次两请求均真实中止；pending=0 | 未积累到四槽 |
| 撤除延迟后手工读取 | 同一 window sentinel，无导航/刷新 | 新 episode/profiles 均正常完成；随后图片与任务读取成功 | 无 429；可见「已读取候选与配置」 |
| 响应头和首字节已到的慢 JSON body | **29.212 秒** | HTTP 200 headers 已到；实际 `response.json()` 以 **AbortError** 结束，signal=true，pending=0 | 服务端流生成器收到 CancelledError |
| 实际 POST edit 已写入、慢响应体 | **29.507 秒**（含随后的只读核对） | 一个 edit wire request；headers 已到，body AbortError，pending=0 | 后端由 0→1 job、6→7 takes、0→1 FakeComfy 调用；无自动重提 |

慢 POST 控制方式是先让实际领域操作完成，再通过流式响应送出首字节并延迟余下内容 36 秒。浏览器错误明确说明操作可能已完成，界面另提示「未自动重试；可先刷新任务列表确认是否已创建」。只读核对后仍是一个任务、一个写请求。**客户端中止不是后端回滚，也不是上游模型中断的证据。** GET/POST 两个慢 body 都观察到服务端 `body-cancelled`，没有 `late-body-release`；本例不存在迟到成功消息回写 UI。该证据不泛化为任意外部服务都可撤销已接收写入。

实际 SPA 点击 `a[href='/gallery']` 保持同一 window sentinel，移除 iframe；当时两个未完成读请求均收到 abort 并 settled，pending=0，宿主 message listener adds/removes 为 1/1。并发槽回收、响应体中止、SPA dispose 和不自动重试写入均实测闭环。

### A1-M01：cancel 声明 scope 不匹配 → 已交叉闭环

独立 API 探针构造无执行器运行的 queued 中性任务：原生 v2 cancel 的 read-only/render-only 均 403、任务不变；write-only 为 200→canceled。对实际有 cancel 声明的 panel-retouch / finalize-studio 两个面板桥，read 与 read+render 的**目标状态**均为 403、任务仍 queued，read+write 目标 200→canceled。桥的外层 200 只是协议封套，报告未混为目标成功。

第 1 席另用真实浏览器两包正常 UI 停止 blocked 任务得到 canceled，与本席权限证据一致。此处未声称 GPU 正在执行时上游中断已验证。

### A1-M02 与动态漫 fullscreen：顶层 opaque 隔离 → 已交叉闭环

- 六包真实资源 URL 均在独立 Chrome 新页直接顶层打开：`self.origin='null'`；实际 localStorage、cookie 访问均抛 SecurityError；实际 `fetch('/api/series')` 被拒为 TypeError。
- 实际嵌入动态漫文档 origin=null；访问 parent.document、localStorage、cookie 均 SecurityError；直接 fetch TypeError。正常读取后真实点击全屏按钮，`document.fullscreenEnabled=true` 且 `document.fullscreenElement` 非空。
- 宿主仍 `sandbox="allow-scripts"`，仅 `allow="fullscreen"`；网络/存储/父文档访问并未因全屏委派开放。验证依据是实际受阻/成功行为，不是仅看 CSP 字符串。
- 第 1 席独立六包顶层/iframe、第二 ready 与实际 fullscreen 结果一致；第 3 席已收到交叉结论。

## 全范围对抗结果

| 范围 | 实际方法与观察 | 结果 |
|---|---|---|
| 六包 503、离线、手工恢复 | 每包用正常加载/提案按钮分别触发真实 fixture HTTP 503、Chrome context 真正 offline；可见错误后恢复网络/服务，再在当前路由显式操作 | **12/12 错误组合可见且原地恢复**；没有靠重载修复 |
| 六包自然超时 | 六个真实页面各发正常加载意图；episode/profiles 在服务端挂起；全部等待原生 29 秒 deadline，全部再手工恢复 | **6/6 通过**；各自 pending=0、挂起读均 abort。串行收集观察时刻为 29.108–31.551 秒，包含采样排队；精确单页 deadline 以独立两轮为准 |
| 六包摘要篡改 | 仅改临时安装副本，重新读取列表/资源/桥；再以新摘要重新启用 | 六包均立即 changed、catalog 省略、files/bridge404；旧摘要 enable400；新 activation 产生后旧 activation404 |
| 真正安全模式重启 | 先持久启用六包，再对同一自建数据以 `MIO_SAFE_MODE=1` 重建 AppContext | loaded=0，panel/host-slot 目录空；六包 HTTP enable400、直接 manager.load()=False、资源404 |
| session / 声明 / source | 实际 iframe MessagePort：错 session、未声明 request、重复 rid；另从错误 source/origin 发送 ready | 错 session 零 HTTP；未声明403；重复 rid 为 200/409 且仅一次传输；伪 ready 零 init 回复 |
| 不受信 URL/headers | 在实际合法 request 消息中附恶意外部 URL 和额外 headers | 仍仅请求受审 episode 操作，未产生外部请求 |
| 子文档导航 | 正常面板建立通道后将其文档导航到 about:blank | 宿主撤销通道并将 iframe src 设 about:blank，没有新增桥请求 |
| 真实鼠标快速提交 | 单格精修正常读取并选 outpaint；对提交按钮进行 10 次真实 mouse click burst | 仅 1 个 edit HTTP、1 个新 job |
| 五旗舰模板 XSS | render_album 真实导出 malicious title/caption/prompt/signature；五个单文件均由 Chrome 实际 load | window.albumXss 未设置；攻击 DOM=0；每页仅正常两段 script；外部请求0；默认 sourceData 不存在 |
| HTML 回导与私密预览 | 既有实际 UI 工具 `check_album_import_browser`，1440×900/light 独立执行 | **1/1 通过**：主动标记不执行；错误文件恢复；单/批量实际回导；8 次预览请求强制 source=false；3 个可见 iframe 文档无 sourceData/私密提示词/隐藏台词 |
| HTML 分享同意 | 实际导出默认 false、显式 true，关闭重开单/批量入口；localStorage 观察 | 同意不持久化，重开复位；默认分享不含隐藏文本，回导保留明确资料范围警告 |
| 原子性、取消清理补证 | 仅运行 6 个针对性测试，真实 AppContext/API；不代替浏览器超时 | **6/6**：解码期间摘要变更/停用无资产写入；晚期 store 失败回滚全部书并保留共享资产；publication 失败回滚新资产元数据；multipart disconnect/CancelledError 清空 spool |
| 短程资源生命周期 | 五次独立进入 retouch、加载真实 blob 图，再实际 SPA 离开；逐轮读取宿主 pending/listener/URL 台账 | 每次 pending=0、message adds/removes=1/1、宿主未释放 URL=0、iframe=0；不是全程 retained heap 或总 RAM 无泄漏证明 |

针对性测试精确命令等价于在隔离 TEMP 下设置 tempfile.tempdir 后执行：

```text
python -m unittest tests.test_panel_upload.PanelUploadTests.test_changed_code_during_decode_and_disabled_activation_never_write_an_asset tests.test_album_import.HTMLAlbumImportTests.test_late_store_failure_rolls_back_all_visible_books_and_keeps_shared_asset tests.test_album_import.HTMLAlbumImportTests.test_new_asset_metadata_is_rolled_back_if_publication_fails tests.test_extension_boundary_corpus.UploadBoundaryTests
```

实际 runner 结果为 `Ran 6 tests in 3.434s / OK`；包含模块导入的探针耗时 5.082 秒。未跑任何全量测试或重建。

## Windows / Linux 路径与文件系统边界

- ZIP 正常 POSIX 嵌套路径安装201；九个恶意样本（`..`、反斜杠遍历、绝对路径、盘符、UNC、`.`、重复分隔符、大小写碰撞、ADS 冒号）均400。
- multipart 文件夹导入分别使用 POSIX `/` 与 Windows `\` 分隔符，均201；七种 URL 遍历/百分号编码/双编码/UNC/drive 路径均404。
- 本席 TEMP 下实际 `mklink /J` 创建 Windows junction 成功：`inside()` 拒绝越界、`validate_tree()` 拒绝 reparse；带 delete_data 的卸载返回400，包与外部 synthetic sentinel 均保留；该 junction 随后已移除。
- Windows 原生 `symlink_to()` 因 WinError1314 缺少权限未完成，**不是产品失败，也不计为 symlink 实测通过**。真实 junction 是另一个已执行边界案例。
- 未运行真实 Linux。对应可移植语料和现有 Linux 门禁测试位置：`server/tests/test_extensions.py:501,565`、`server/tests/test_backup_extension_data.py:319`、`server/tests/test_extension_data.py:67`。本机反斜杠/编码语料、既有测试源码不能替代 Linux 本机执行；远端 CI `45745955229` 的最终状态由总控另核，本席不将其冒称绿色。

## 探针失败史与交叉互核

- 首轮浏览器探针在六包超时收集到剧本助手时，错误地只接受英文 `Panel request timed out`；产品正确显示中文「请求超时；请检查操作结果后再决定下一步」。已保留该工具失败并修正断言，重新执行整个受影响浏览器流程通过；不将首轮截断当成六包 PASS。
- 同时在重跑前修正观测台账：二进制图片响应不走 response.json，不能以「尚未读 JSON」计为 pending。正式 body 超时证据仍由实际 JSON Promise 的 AbortError 与信号联合判定。
- 早期源码探索中 rg.cmd 对含 `|` 正则的 shell 管道误解析，以及推测文件名不存在，均已纠正；未由此修改产品。其余正式浏览器/隐私/API/原子性探针均 exit0，没有隐去产品失败。
- 第 1 席独立结果与本席顶层 opaque、full-screen 与 cancel 权限一致，无冲突。
- 第 4 席确认本席测 pending/Abort/监听器/URL 生命周期，其普通多轮 GC retained heap/DOM 与 Windows RAM/CPU 测量回答不同问题，不相互替代。本席已向其提供两轮自然超时和慢 POST 的边界；本席于 11:28:39 完成最后浏览器并明确告知全闭，之后不再启动 Chrome。
- 第 3 席已独立确认两视口实际 fullscreenElement=stage，与本席隔离结果无冲突；其六包空态/503/手工恢复与生命周期 14/14、retouch 同意图重复显式提交复用任务也一致。最终全站键盘/焦点结论归其独立实测。
- 已向第 2 席交叉提供五模板恶意文本与 HTML 预览隐私证据；本席没有据此替代其颜色、可读性、像素与视觉矩阵结论。

## 范围限制、清理与证据保管

- 未测真实 GPU/付费模型、外部网络、真实 Linux、长时间恶意包压力和所有操作系统文件句柄。前述短程资源观测不等于绝对无内存泄漏；其深入测量归第 4 席。
- 安全模式/tamper/path 子探针是实际 TestClient/AppContext/API，不是另一次本机 Chrome UI 证明；UI 菜单撤除与停止操作另与第 1 席交叉一致。API 回滚测试不证明客户端 abort 可以回滚后端写入。
- 未保存截图/trace。全部自有 Chrome 与临时 fixture 进程已关闭；自建 workspace、`.workspace.mio-recovery`、ZIP、生成 HTML、脚本和日志均精确删除，未遇清理 policy 拒绝。未访问或清理用户接管的旧 R1 recovery、未知历史临时目录及私人运行数据。
- 目前仅保留两份紧凑 JSON 待总控聚合后删除：
  - `C:/Users/QIU/AppData/Local/Temp/mio-chaos-r2-c5-snkg_v6i/evidence.json`，24,244 bytes，SHA-256 `96242a25b5762937201379b3a588f0b82206ed085bf08cf383304520c24f8b78`。
  - `C:/Users/QIU/AppData/Local/Temp/mio-safe-path-r2-6ae6d587b2414d838343d0c8b06509f5/evidence.json`，SHA-256 `daf7d35ccf2d65d549469714394d318138b3d7707b8fda856475c3b1bf1ce8dc`。
- JSON 保留精确自然等待样本、实际 Abort/body 事件、任务/写次数、失败史、脚本摘要、执行时间与清理结果；不含 token、Authorization、Cookie 或私人作品。
- 本席签发针对上述固定快照的独立专业范围；全量本地门禁与远端 CI 状态由总控最终确认，不用本席补证代替。

```json
{"audit":"cross-audit-5-chaos-r2","head":"5569dc294fd16c7478abbd31317da7e9055c3be7","status":"VERIFIED PASS","blocker":0,"high":0,"unresolved_medium":0,"r1_C5M01":"closed independently: two natural 29s rounds + body + POST + SPA","r1_A1M01":"closed with actual target write-scope evidence","r1_A1M02":"closed with six actual top-level opaque documents","six_package_503_offline":"12/12","six_package_natural_timeout":"6/6","five_template_xss":"5/5","html_privacy_ui":"1/1","targeted_atomic_tests":"6/6","native_linux_run":false,"real_models":false,"external_requests":0,"screenshots":0,"own_chrome_all_closed":true,"own_fixtures_all_exited":true,"temporary_workspaces_removed":true,"compact_json_retained":2}
```
