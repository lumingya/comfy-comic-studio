# 第 5 席独立复审：异常混沌、安全与跨平台边界（R3）

**本席专业范围结论：VERIFIED PASS，0 Blocker、0 High、0 未决 Medium；未发现新的 Low 产品缺陷。R3 整体不能签发通过：第 2 席发现的 VIS-R3-M01 Medium 仍未关闭，第 4 席未取得排他窗口，未执行本轮动态性能采样。**

## 冻结对象与证据归属

- 日期：2026-11-26，Windows 11 `10.0.26300`，Asia/Shanghai；已安装的真实 headless Chrome `158.0.8127.37`，Python Playwright 驱动。未安装浏览器或依赖。
- HEAD 前后均为 `e7a4eac44bacb64f6d74dd5a028d0380b0aa69f8`；托管 dist index SHA-256 为 `ecd63ebe23e44f17c079d4d256765e9355e24a2fee50a7e30e5e0ece643ccbfa`。独立 HTML 隐私探针还核对全部 81 个 dist 文件，前后汇总摘要均为 `72e282cce4015a7216f19be1bd8b038cb7aac6fe878a3d7be9331b47609df382`。
- 本席先读 AGENTS、README、ROADMAP 与原始任务 Wave 5 完整要求。按用户批准的六个独立、默认停用专业面板审计，不以旧 backend-only 原则否定本轮获批范围。
- 主浏览器分段窗口为 **14:36:47–14:53:56 +08:00**。主探针最终保留 50 个去重后的实测 case；独立 HTML 隐私实际 UI 场景 1 个；API／Windows 文件系统子探针另有六包矩阵及 7 项针对性测试。由于探针断言修正，这些是有明确来源的分段证据，**不是一次从头到尾无失败运行的 50 项脚本**。
- 实际 dist、原生 AppContext、HTTP API、任务引擎、持久存储与沙箱 iframe 均参与；仅 Comfy／VLM／文本模型是中性本地 Fake。没有真实模型质量、GPU 或付费 API 效果证据。原生 QA 通过真实 HTTP 提交 `qa.check` 并等待完成，没有把 HTTP 类型拒绝或 DOM 伪造当成模型评审结果。
- 本席与子探针仅写本报告及各自唯一的自有 TEMP；未改产品、测试、生成物、dist 或其他报告，未 build／跑全量门禁／commit／push。未访问用户 8788／8188、既有 Chrome、私人运行时或用户接管的旧 R1 recovery。

## R1／R2 异常链路交叉回归

| 恶劣条件 | 本轮真实方法与观察 | 结论 |
|---|---|---|
| 六包 HTTP 503／Chrome offline | 每包通过正常加载或节奏建议按钮触发服务端 503，再以 Chrome context offline 触发断网；随后恢复服务／网络，在当前路由显式操作 | 12/12 错误组合可见，同页恢复；未依靠重载 |
| 六包自然 deadline | 先打开六个独立 context，再对真实 episode／profiles 请求挂起 70 秒；不用假时钟 | 六包均可见约 29 秒失败；实际 fetch 的 `abortAt-started` 为 **29.009–29.016 秒**，均 AbortError、pending=0；之后同文档手动恢复 |
| 四槽慢 JSON body | 用合法 MessagePort 请求与必要 path 参数发四个请求，原生路由完成后送出 HTTP 200 headers＋首字节，余下 body 延迟 36 秒；第五次请求同时到达 | 第五次 429；四个自然 29.009–29.010 秒中止，`response.json()` 均 AbortError，pending=0；服务端四个生成器均 body-cancelled、无 late-body；当前文档继续读取成功 |
| POST 已写入，回包超时 | 单格精修正常读取后选择 outpaint，真实鼠标连续点击提交 10 次；先完成实际 edit，再延迟响应 body | **29.210 秒**出现明确不自动重试、先核对结果提示。只有 1 个 edit wire、1 个 job、1 次 FakeComfy，takes 6→7；未自动重放，也没有假称后端回滚 |
| SPA 卸载时在途请求 | 两个真实读请求挂起后点击宿主 gallery 导航，保持相同 window sentinel | 两个传输均 abort／settled，pending=0；message listener adds/removes=1/1；iframe=0 |
| 五轮媒体生命周期 | 每次实际进入 retouch、读取图片、等待图像解码，再由 SPA 离开；观察实际流 reader 的完成与 URL 台账 | 每轮 pending=0、message adds/removes=1/1、宿主未释放 URL=0、iframe=0。这里只证明短程生命周期，不证明长时间 retained heap 无增长 |
| 并发取消 | 停用自建 Fake 实例后，通过真实 retouch UI 提交一个原生 queued edit job；同一实际端口并发发送两个声明内 cancel，再用 UI 刷新 | 两个目标响应均 200；原生 job queued→canceled，UI「已停止」；FakeComfy=0、takes 仍 6，无重复结果 |

六包超时的串行观察耗时为 29.555–29.859 秒，包含读取各页断言的排队时间；精确 deadline 以上述同页 performance 时钟的传输差值为准。

POST 样本里客户端中断只结束响应传输；已经创建的后端 job 和新候选仍存在。这不是外部生图服务撤销能力的证明。短程传输、监听器和 URL 计数也不替代第 4 席的 GC、全进程 RAM／CPU、合成器与功耗测量。

## 本轮原生 QA 重点

每个样本先重置中性作品，再通过浏览器 APIRequestContext 的实际 HTTP 端点提交，等待原生 `qa.check` 完成，读取 job result 与持久化 episode。下面的「拒答／bool／字符串」是 **Fake VLM 在实际 executor 内返回的原始 JSON**，不是请求 DTO 拒绝。

| 模型原始输出／作品边界 | 实际调用与持久结果 | 原生自动采纳 |
|---|---|---|
| 有效 4 分＋解释，3 票 | 3 次双图 VLM；assessed、score=4、有效票 3、综合 .896、passed=true | 采用 |
| 三次拒答 | 3 次实际调用；unknown、null、0 有效票、passed=false | 不采用 |
| score=true／score="5"／score=9 | 三类各 3 次实际调用；均 unknown、null、0 有效票、passed=false | 均不采用 |
| 1/3 有效票 | unknown、null、有效票 1；拒答没有被少数有效票掩盖 | 不采用 |
| 2/3 有效票（5、4、拒答） | assessed，median-low=4，有效票 2，passed=true | 采用 |
| 1/2 有效票 | unknown、有效票 1，严格过半未成立 | 不采用 |
| 有角色但无参考图，视觉低分 | **3 次单图 VLM**，identity=[]；台词仍 assessed=4；scene=1／quality=1，综合 .320、passed=false | 不采用 |
| 无角色、无台词、无参考，视觉低分 | **3 次单图 VLM**，identity=[]、dialogue=not_assessed；综合 .200、passed=false | 不采用 |
| 无角色、无台词、无参考，视觉正常 | **3 次单图 VLM**；scene=4／quality=4，综合 .800，未假造满分；passed=true | 采用 |
| 约 12 KB 恶意评语 | 3 次原生 VLM 评审完成，含 img/onerror/script 的解释经实际面板 `text_content` 完整读取；攻击 DOM=0、window.qaXss 未设置 | 按有效评分规则，不因恶意文本额外执行代码 |

另将缺少新字段的旧 QAResult 写入自建 fixture，实际面板显示「评审不完整」「台词契合度：未知 · 0 有效票」及缺失解释提示，没有把旧综合 95 分冒充已评台词。

未知台词样本仍可能保留 .736 综合分，但 `passed=false` 且 native auto-pick 不采用；没有把综合阈值误当成唯一通过条件。本席不以未知状态撤销用户明确手动采用的决定；第 3 席独立验证了 UI review 的 auto_adopt=false、人工批采用 user 标记与 native manual 保护，结论相容。

对应实现核查：`server/mio_server/pipeline/judge.py` 的严格 dialogue_result／_rating；`pipeline/qa.py` 的严格过半、无身份视觉归一、无条件执行 judge 与 passed 池过滤；`models.py` 的 nullable strict dialogue_score。源码只辅助解释上表，不能替代实际 job。

## 沙箱、协议、摘要与安全模式

- 六个已启用包的实际资源分别直接顶层打开：self.origin=null，localStorage 与 cookie 均 SecurityError，直接 fetch('/api/series') 均 TypeError。顶层 parent=self，其标题可读是预期，不误报成父页面越权。
- 六包实际宿主 iframe：sandbox=allow-scripts；self.origin=null，parent.document、localStorage、cookie 均 SecurityError，直接 fetch 均 TypeError。没有因正常读取／取消开放同源权限。
- 实际 MessagePort：错误 session 零目标 HTTP；未声明操作 403；重复 rid 为 200/409 且仅一个实际传输；额外外部 URL／headers 被忽略，仍只有受审的 episode 请求。错误 source 的 ready 没有 init 回复，也没有新增 HTTP。
- 当前 iframe 子文档实际导航 about:blank 后，宿主将其 src 设为 about:blank，撤除通道；没有新增桥请求。
- 六包 API 子探针均经历：ZIP 安装默认 disabled→错误摘要启用 400→显式信任启用。只改临时包真实入口后，**未先查目录、先访问资源即 404**；桥 404，目录随后 changed 并撤除入口；旧摘要启用 400；新摘要重新信任后 activation 改变，旧 activation 404。
- 持久启用六包后，在同一自建工作区以 MIO_SAFE_MODE=1 创建新 AppContext：loaded=0，panels／host-slots 为空；六包 enable=400、manager.load=False、正确入口资源=404。
- 本席主浏览器给每个 context 装了阻外联 guard，但最终聚合遗漏各 run 的 external 数组，因此**不宣称保留了主探针全量「0 外联尝试」抓包计数**。直接 CSP／fetch 拒绝、合法操作实际 wire 数和攻击不执行的证据仍成立。独立 HTML 隐私探针的 external_requests=[] 已完整保留。

## 五模板、分享隐私与原子回导

- 对 export-monograph、export-nocturne、export-folio、export-zine、export-contact-sheet 调用真实 render_album，把恶意 title／caption／prompt／signature 放入五个离线单文件，再由真实 Chrome 打开。五页均 window.albumXss 未设置、攻击 onerror DOM=0、sourceData 默认不存在。
- 独立运行现有 check_album_import_browser 的 **1440×900／light** 实际 UI 场景，通过导出按钮下载并从文件选择器回导，不用自行拼装 UI 成功结果。单本／批量导出 source flags 均为 false→显式 true；关闭重开同意项复位，localStorage 不持久化 opt-in。
- 8 次真实 preview 请求强制 include_source_data=false；3 个可见预览文档均没有 sourceData、私密提示词或隐藏台词。默认分享文件不含隐藏内容；显式附带资料的文件实际回导后读取原生记录一致。实际单本 1 书／3 格、批量 2 书／2 格，并观察素材去重。
- 含主动 script／外链 img 的上传 HTML 作为数据解析，没有执行；独立隐私探针 external_requests=[]。错误扩展名、缺 Mio metadata 的 HTML、后端 400 后重新选择有效文件，实际 UI 均可恢复。
- 子探针另跑 7 项针对性测试：坏 HTML 无写入、late-store 失败回滚、publication 资产回滚、摘要改变／停用期间上传拒绝、multipart 分块／限额／断线与 CancelledError spool 清理。结果 `Ran 7 tests in 6.533s / OK`；这部分是原生 AppContext／API 及单测，不冒充另一次 Chrome 原子故障注入。

## Windows／Linux 路径边界

- POSIX `/` 与 Windows `\` 分隔的文件夹 multipart 导入各 201。
- 10 类恶意 ZIP（含目录遍历、反斜杠、绝对／盘符／UNC、重复分隔、大小写碰撞及 ADS 等）均 400；7 类资源编码／目录／盘符逃逸均 404。
- 实际 Windows mklink /J 创建自有 junction 成功；inside 越界与 validate_tree 均拒绝，带 delete_data 的卸载为 400，包与外部 synthetic sentinel 保留；随后只移除自有 junction。
- 本席没有运行 native Linux 浏览器／文件系统。总控提供同 SHA CI `45765549054` 三作业 completed/success 的最终观察：Ubuntu 于 06:24:53Z 完成、Windows 于 06:37:04Z 完成、gate 于 06:22:10Z 完成。此为同提交跨平台 CI 证据归属，不伪装成本席本机 Linux 执行，也不以 CI 替代 Chrome 实测。

## 探针修正史与四席强制互核

以下均未修改产品，原始失败摘要已保留在紧凑证据中；每次仅重跑受影响范围：

1. 剧本助手的节奏错误写在 pacing-status，首轮误读总 status；修正后六包 503／offline 全范围通过。
2. 一边在同 context 挂起多请求、一边继续打开新页，使 Chrome 每源连接池饥饿；改为先打开独立 context 再同时发请求，六包自然 deadline 全范围通过。
3. 手发四槽协议请求遗漏 episode_id，得到真实 422；该样本不算慢 body 成功。补齐合法 path 参数后四个真实 HTTP 200 body 中止通过。
4. 媒体读取走 response.body.getReader，不是 json／blob；两次探针把已读完的图片误计 pending。补充实际 stream read(done) 观测后，五轮完整生命周期通过。旧 POST 表的原始 pending=1 是该观测缺口，不能据此声称真实桥泄漏；该 POST 的 JSON AbortError、唯一任务与服务端 body-cancelled 均独立成立。
5. 长评语 inner_text 会折叠空白，首轮精确字符串断言失败；改为实际 text_content 对照原生 job 的裁剪后 note，完整复测通过。
6. 并发取消的真实 UI 用「已停止」，探针只接受「取消」；原生 job 已 canceled。补齐该文案后并发取消、错误 source、导航撤销三项完整复测通过。
7. 子探针曾把 HTML 资源按 JSON 解读、假定所有入口叫 index.html，以及 Git 子进程继承不完整 GIT_CONFIG 环境；分别修正后重跑六包／safe-mode 与最终 SHA 核对。另有早期 rg shell 管道和一次 shell 嵌套引号错误，均未产生产品写入。

四席互核采用纯文字，不再重开浏览器：

- **第 1 席**：六包 opaque／摘要／safe-mode、声明 scope 与取消结果一致；本席的并发取消、deadline／SPA 补充其桥实现核查。已共同修正外联计数归属，不能回填不存在的主探针全量抓包。
- **第 2 席**：六包 503／恢复、五模板恶意文本与分享隐私无冲突。本席安全通过不覆盖其动态壁纸下变量补全透明背景叠字的 **VIS-R3-M01 Medium**，更不能抵消该缺陷。
- **第 3 席**：六包错误恢复、显式采用与 native QA 边界相容。本席没有验证或声称修复其既有手工 reject 后 BODY 焦点 Low；该 Low 保留。键盘／焦点覆盖归其独立证据。
- **第 4 席**：因 VIS-R3-M01，总控取消其动态采样窗口；该席未启动 Chrome／服务。本席短程资源计数不能替代本轮 QA 路径 GC／CPU／RAM／合成器实测；R2 同字节记录也不能补成本轮 PASS。双方无逻辑冲突。

## 清理、证据与签发边界

- 最后一支主探针于 **14:53:56 +08:00** 结束。全部自有 browser.close 完成，记录的 Chrome／Python PID 与 creation time 逐一复核，无存活匹配；九个自有服务进程均退出。随后对九端口各做 2 秒连接检查，均未连接成功，Windows 返回 TimeoutError；**不将其改写为明确 connection-refused**。
- 所有自有 workspace、recovery、ZIP、生成 HTML、脚本及中间日志均删除；无清理拒绝。没有截图／trace。没有 stat、删除或绕过用户接管的旧 R1 recovery。
- 目前只保留两份不含凭据或私人内容的紧凑 JSON，待总控归档后删除：
  - `C:/Users/QIU/AppData/Local/Temp/mio-chaos-r3-c5-ikxoutp7/evidence-final.json`，68,365 bytes，SHA-256 `3fc70c7d25342889ebcc6a075d009c293ea18b5bdb3bfd4a6a97d33b1017e8ba`。
  - `C:/Users/QIU/AppData/Local/Temp/mio-chaos-api-r3-uzp2zy14/evidence.json`，10,118 bytes，SHA-256 `55a4360b53c9e13a5d006fbcfbe56d4e066300f93d71407aa55ce44a38bb6c36`。
- 已按 UTF-8 无 BOM 写入并读回本报告。本席签发仅针对上述冻结快照的异常／安全专业范围；本轮全量本地门禁由总控提供并最终整合，未由本席重复执行。**VIS-R3-M01 未关闭、R3 当前动态性能未验证，整体维持 NOT VERIFIED PASS，需修复后新冻结完整复审。**

```json
{"audit":"cross-audit-5-chaos-r3","head":"e7a4eac44bacb64f6d74dd5a028d0380b0aa69f8","scope_status":"VERIFIED PASS","overall_r3_status":"NOT VERIFIED PASS","blocker":0,"high":0,"own_unresolved_medium":0,"new_low":0,"browser_cases":50,"six_package_503_offline":"12/12","six_package_natural_deadline":"6/6","native_qa_cases":12,"legacy_unknown":true,"four_slot_body_abort":true,"post_not_replayed":true,"concurrent_cancel":true,"five_template_xss":"5/5","html_privacy_ui":"1/1","targeted_atomic_tests":"7/7","native_linux_browser":false,"real_models":false,"main_external_attempt_counter_retained":false,"own_recorded_process_survivors":0,"temporary_workspaces_removed":true,"compact_json_retained":2,"external_medium":"VIS-R3-M01","r3_dynamic_performance":"NOT VERIFIED"}
```
