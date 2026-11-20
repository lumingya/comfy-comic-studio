# 第二轮独立复审：画布基线与媒体响应

日期：2026-11-21。复审者为未参加这两项实施或第一轮审查的新代理。

复审对象是实际工作区补丁，而非只读 HEAD。核验时 HEAD 为 `125e07f1600464b93736392c04f7d0ae8412c63d`，通过 `git diff --` 阅读画布 history、CanvasTab、PacingDialog、HTTP hooks、布局 API 与 panel_media 的未提交改动；同时阅读相关存储及路由生命周期。已读 AGENTS.md、README、路线图、共享审查 README/FINDINGS 及两份修复说明。原报告只用于定位，以下结论另经当前代码和独立探针确认。

## 结论

| 项目 | 结论 | 依据 |
| --- | --- | --- |
| R1-UI-01 | **关闭** | dirty 草稿及其保存 token 共同保留；refetch、成功/失败回执、继续编辑、undo/redo、导航和 pacing 交错未再触发静默覆盖。布局的真实提交执行 CAS，成功严格加一。 |
| R1-MED-01 | **关闭：ASGI 2.4 清理加固已成立** | 文件/槽归外层 response 调用所有；头、数据块、最终空 body 的异常与取消均在调用终结时同步清理且只一次，不依赖生成器析构或 GC。 |

规范轴：无新增可复现问题。需求/行为轴：无新增可复现问题。此处“关闭”只针对这两项及下述验证范围，不代表全仓并发或全部 ASGI 服务器零缺陷。

**默认部署限定必须保留：第一轮并未证实默认 Uvicorn ASGI 2.3 路径存在原泄漏。** 本次 ASGI 2.3 窄探针通过，证明修后响应可正常终结，不把原 ASGI 2.4 分支证据反写成默认部署漏洞。

## R1-UI-01：状态所有权与真实 CAS

当前实现的关键边界：

- `useStripHistory.ts:20–88` 同时持有 saved、present、历史和 baseRevision。dirty 时 receive 返回 false；旧 revision 或同 revision 的不同内容不会成为新 checkpoint。clean 同内容更新只推进真实 revision，clean 不同布局接收后清空旧历史。
- `CanvasTab.tsx:46–77,135–153` 发起写请求时捕获 `{strip, baseRevision}`，成功只确认自身 snapshot；回执期间的修改或 undo 结果不会被 canonical strip 全量覆盖。失败不 acknowledge。pending 结束后 effect 再处理被暂缓的 props。
- `api/production.ts` 两个 mutation 以变量携带 token，避免 render 闭包借用新 episode revision；`production.py:130–168` 的 layout 和 save 均把该 token 交给真正的 `update_episode`。`storage.py` 在事务内比对当前 revision，成功写入严格 `current + 1`，不是 UI 假定 props 就是回执版本。
- `PacingDialog` 传回实际存储的 Episode，`CanvasTab.tsx:380` 只有成功 receive 后才继续布局；较旧 pacing 回执不会覆盖更高版本或 dirty 草稿。
- 路由/query 与 beforeunload 继续由现有 unsaved guard 保护。`ReaderView.tsx:145` 以 episode.id 为 Outlet key，跨话/离开后重入形成新的画布会话；没有把旧草稿基线带到另一话。保存点、接收新布局或重建会话的不同重置语义均保持分离。

重跑当前修复自带的窄回归：

```powershell
npm --prefix web test -- src/pages/canvas/CanvasTab.revision.test.tsx src/pages/canvas/useStripHistory.test.ts
.venv/Scripts/python.exe -m unittest discover -s server/tests -t server -p test_review_canvas_revision.py -v
```

结果：React **13/13**，真实 API **4/4**。覆盖原始 dirty rev3 + 新 props rev4 请求仍为 base3、409 保留输入/undo、clean 非 strip 修改更新基线、pacing 新回执、两种 edit/refetch 顺序、pending 保存或布局继续编辑、较旧 props、clean 成功后接收最新快照，以及取消导航/离开再进入。

另外在系统 TEMP 创建独立 React/Vitest 探针，仅复用真实 CanvasTab、HTTP hooks 和 history；只替换 Stage/图像与 fetch 边界，未 mock history 或保存 hook。新增 **4/4**：

| 新组合 | 当前观察 |
| --- | --- |
| 保存900(base3) → undo800 → props rev5/1100 → redo900 → 409 → 更旧 props rev4/1200 → 再保存 | 草稿仍900，两次请求均 base3，未借用5或4。 |
| 保存900(base3) → undo800 → props rev5/1100 → 409 | 明确撤销后为 clean，pending 结束接收1100；下一次编辑1000请求使用 base5。 |
| pacing rev3 请求未回 → clean props rev5/1100 → pacing 成功回执rev4 | 保留1100，没有发起后续布局请求。 |
| 保存900 pending → undo到clean → beforeunload + query导航取消 → redo900 → props rev5/1100 → 成功确认900 | pending 即使 undo 后仍阻止 reload/导航；取消导航保留会话。成功后900成为 clean checkpoint，再接收真实较新的1100，无第二次隐式写入。 |

额外真实 API 并发探针 **1/1**：在隔离临时 AppContext 注册一个计算完成后通过双线程 barrier 同步返回的布局器；两个 HTTP layout 请求使用同一个 base_revision。结果为 **一个200、一个409**，最终 episode 只加一，持久 strip 等于唯一成功响应。这是在实际存储 CAS 上竞争，未替换 store 或只检查请求参数。旧调用不带 token 仍可保存/布局，由上述现有真实 API 回归验证。

## R1-MED-01：整个 response 调用的清理边界

`panel_media.py:39–51` 的 `_MediaResponse.__call__` 使用外层 finally；`123–132` 的幂等 close 在文件 close 异常时也通过 finally 释放槽。`223–229` 的 chunks 只读数据及检查激活状态，不再在迭代器耗尽时提前释放。因此 final 空 body 发送期间仍持槽，final send 返回或失败后才归还。

重跑修复自带的窄回归：

```powershell
.venv/Scripts/python.exe -m unittest discover -s server/tests -t server -p test_review_media_disconnect.py -v
```

结果 **7/7**。真实 dispatch_media 产生 response 后执行其 ASGI `__call__`，覆盖 ASGI 2.4 头/首块 OSError、普通 send 异常、头/首块 task cancel、ASGI 2.3 disconnect、两版本正常完成、停用及 producer 取消。立即断言临时文件已关闭、release 仅一次；没有以 release 本身的幂等包装掩盖重复调用。

独立 TEMP ASGI 新组合 **3/3 方法、10 个子场景**，使用真实 dispatch_media、真实临时文件、128 KiB 中性 payload。关闭自动 GC，保留 response 和 iterator 引用；每次 send 内均断言文件未关闭、release 未调用，异常返回后立即断言各一次，再显式 aclose 断言不重复：

1. ASGI `2.3/2.4` × 最终空 body send 抛 `OSError/RuntimeError/asyncio.CancelledError`（6 场景）。2.4 OSError 仍为 Starlette ClientDisconnect，其余保留各自响应语义；2.3 task group 对内部 CancelledError 的既有处理未被改写。全部完成后同步释放一次。
2. ASGI `2.3/2.4` 最终空 body send 阻塞，确认此时仍占文件/槽，再外部 cancel 整个 response task（2 场景）。取消完成前后边界正确，各释放一次。
3. ASGI `2.3/2.4` 第一数据块成功，第二数据块 send 抛 RuntimeError（2 场景）。异常返回时即已释放，随后 aclose 不再释放。

这些探针不调用 gc.collect、不等待析构、不依赖 response 被丢弃，也不在最终 send 之前通过耗尽 iterator 释放槽；覆盖了原首块失败之外的中段和最终发送组合。

## 验证总量与边界

本次共执行 **32 个测试方法/用例通过**：已有窄回归24项（UI13、API4、媒体7）及独立临时组合8项（React4、API1、媒体3）。未重复全后端883项或全前端门禁；未把修复作者已有浏览器矩阵当作本次新跑结果。

没有改生产代码、仓库测试、schema/SDK生成物、共享台账或其他报告；唯一新增交付物为本文件。未提交或推送。无个人 data 读取、网络/付费服务、GPU/LoRA调用。没有启动浏览器或保存截图：本轮目标为状态和 ASGI 生命周期，未修改视觉结构。临时 React 配置首次遇到 TEMP root 之外的模块加载限制，调整测试 root 后执行成功；该加载失败不是产品失败。TEMP 脚本、配置及依赖 junction 已清理，未留下运行进程。

已将绿灯结果通知主控与画布作者。若后续修改这几个状态边界，应只重跑受影响窄组合；统一生成、全仓门禁、提交及远端 CI 仍由主控负责。
