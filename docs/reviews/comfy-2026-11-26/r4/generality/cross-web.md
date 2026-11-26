# R4-WEB-01 独立证据交叉核对

日期：2026-11-26。原审计源码固定为 `3e994bb80794dea7be9773f5cb9c47119bf34c27`，原范围为 `38838ab43cf3d056951f2fc6c52afb737d34e3c6..3e994bb80794dea7be9773f5cb9c47119bf34c27`。本文件按主审单独授权创建，只核对既有 R4-WEB-01 的证据与源码因果，不复核本轮新修复。

**结论：认可 R4-WEB-01 在已说明测试条件下构成一项实质 Medium。** 这是旧冻结版本的当前行为缺陷证据，不是已证明的基准回归，也不是对修复后版本的验收。独立首版与既有 `cross-evidence.md` 均未改动。

## 证据范围与同一性

本次只读了 `audits/r4/web/report.md`、`audits/r4/web/measurements.json`，通过 `git show 3e994bb80794dea7be9773f5cb9c47119bf34c27:<path>` 读取下列产品源码与依赖锁定版本，再静态核对本机同版本的 TanStack Query 源码。没有读取当前待修复产品文件来代替原审计源，没有 import Mio，没有运行测试、lint、构建、profile、HTTP 请求、浏览器或产品调用，也没有取得或使用产品执行租约。

读回证据的 SHA-256：

- Web 首版报告：`2341e901a843a7e393516b20766bd3416ce4e61c640ae23fa121218d670a0d15`。
- Web 测量 JSON：`902266e338ee48c51d6db19c7cd2620f2721d3bf7661bd4612b665a53fb286e4`。

## 两次普通 GET 的准确口径

| 保存的观测 | 时间与结果 | 本次核对的含义 |
| --- | --- | --- |
| 保存后的页面重新载入所记录的 Resource Timing | `GET /api/workflows` 为 **21,473 ms**；同一页面所选工作流详情为 **14 ms** | 是一次正常页面载入中的请求，不是本次审查新发的请求；不是保存 POST 自身的耗时 |
| 主审授权的一次普通 fetch 复核 | 同一路由 **18,772 ms**，HTTP **200**，**49 条**，**13,756 UTF-8 字节** | 第二次普通 GET；没有循环、并发或压力负载 |
| 保存弹窗的独立 UI 观察 | 保存后超过 **15 秒**仍显示正在保存 | 与下面静态确认的保存等待链相符；不能把上述任一 GET 时间改写成保存 POST 的精确计时 |

资料库开始有 48 条，包含大量此前保留的中性 200 节点合成副本；本轮保存一条 200 节点、32 LoRA 合成图后为 **49 条**。这不是只有一条工作流的干净资料库。报告说明测试服务与自动化 Python 受单 CPU、BelowNormal 限制；JSON 明确记录自动化 Python 在浏览器库导入前设置并读回 affinity mask `1`、priority class `16384`，并标注 CPU 环境受限。本次没有另行检查进程，也不把此限制推广成 Chrome 所有进程均被绑定单核。

## 冻结后端源码支持的因果

`server/mio_server/api/library.py:106-132` 的 `list_workflows()` 对 `list_docs("workflow")` 返回的每一条记录顺序调用：

1. `C.describe(doc, rules=_rules(ctx))`（第 110 行）；
2. `slots.ensure_plan(doc.graph, doc.slots, adapters=SA.installed(ctx.registry))`（第 111 行）；
3. 从描述和计划提取紧凑摘要再加入列表。

`comfy/compile.py:393-404` 的 `describe()` 不是单纯返回已存摘要，而是每次进入 `_effective_bindings(..., prune=False)`。后者在 `:228-267` 读取显式绑定、应用值和覆盖、推断缺失 kind，并迭代至绑定稳定。因而每次列表 GET 都与全库各图的绑定推断成本相关，而非只与响应中的 49 条短摘要相关。

对槽位部分必须保留限定：`comfy/workflow_slot_plan.py:166-185` 的 `ensure_plan()` 每条都会检查已有计划、对象信息／图哈希；必要时 `analyze()`，否则复制有效计划并刷新条目值。源码不支持“每条计划在每次列表请求中必定完整重新 analyze”的绝对表述。它支持的是：列表每次都逐条执行绑定描述与槽位计划检查，缺少在该列表路径直接读取可复用摘要的边界。

上述源路径与大图资料库列表变慢相符，但没有 profile 就不能量化绑定推断、槽位检查、数据库读取、调度或其他部分各占多少时间。13,756 字节表明响应并非大图全量下载；它本身不等于 CPU 热点证明。

## 冻结前端确实等待列表刷新才完成保存 UI

`web/src/api/system.ts:91-95` 的活跃 `useWorkflows()` 查询读取 `/api/workflows`。同文件 `:109-121` 的导入 mutation 在保存 POST 成功后，其 hook 级 `onSuccess` **返回** `qc.invalidateQueries({ queryKey: keys.workflows })` 的 Promise。

`web/src/pages/settings/WorkflowsSection.tsx:28-30` 同时订阅此列表并使用导入 mutation。`:318` 把 `importWf.isPending` 传为预检弹窗的 `saving`；`:330-335` 要到本次 `mutate()` 的成功回调才 `setPendingImport(null)`、选择新记录并提示导入成功。`WorkflowInspection.tsx:311-327` 在 `saving` 时拦截关闭、禁用取消／保存并显示保存中。所以界面等待不只是列表区域显示加载状态，而是阻塞当前导入弹窗的完成及退出。

为避免把返回 Promise 的效果仅当作约定推测，本次还静态核对了冻结 `web/package-lock.json` 所锁的 `@tanstack/query-core` **5.104.0**，并确认本机所读依赖源码 package 版本相同：`src/queryClient.ts:469-488` 的 `invalidateQueries()` 默认重取 active query，`:507-529` 返回这些 fetch 的 `Promise.all`；`src/mutation.ts:346-382` 等待 hook 的 `options.onSuccess` 后才 dispatch success；`src/mutationObserver.ts:253-260` 再调用 `mutate()` 级成功回调。本节没有执行这些依赖代码。

因此保存 POST 已返回成功后，只要当前活跃的工作流列表刷新仍未完成，mutation 仍会处于 pending，弹窗也就继续保持 saving。这个等待链由原冻结源码直接支持，与已保存的超过 15 秒忙状态观测一致。

## 分级与不能推出的结论

这两次非压力 GET 在已说明的 49 条合成大图库、受限 CPU 环境下均约 19–21 秒；正式保存路径又把弹窗完成／退出绑定到该全库刷新。保存成功后用户仍长时间被困在保存状态，是可见的核心交互阻塞，不只是内部计时偏慢，足以支持 **Medium**。该判断无需把有限的两次观测当成性能统计，也无需推断只有一条图时会发生相同延迟。

证据不足以声称：相对基准提交的性能回归、由本轮某一提交引入、正常硬件必定达到相同绝对耗时、干净小资料库也同样慢、所有列表请求都这样慢、具体热点占比，或修复后已达标。没有在基准提交上用相同资料库对照，也没有清库对照；单核与低优先级限制会影响绝对时延。这些限制应随结论保留，但不会消除已观察条件下且有源码等待链支持的体验缺陷。

本次只对 **R4-WEB-01 同一项 Medium** 作证据互核，不新建重复缺陷，不重复编译／阶段互核，不更改旧审查签名，也不为尚未验证的新修复签发 PASS。
