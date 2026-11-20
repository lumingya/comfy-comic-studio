# R1-UI-01：Canvas 草稿修订基线

状态：已修复并完成定向验证，待独立复审。本文不代替主控台账，不包含提交或推送。

## 原始红回归

新增 `web/src/pages/canvas/CanvasTab.revision.test.tsx`，通过真实 React Router Outlet context、CanvasTab、useStripHistory、useSaveStrip 与 fetch 构造请求。只隔离 Konva Stage / 图片和 HTTP 边界；没有 mock history 或保存 hook。

最先执行的一条回归：revision 3 / 白底 → 修改宽度 900 → context 收到 revision 4 / `#123456` 背景 → 保存。修复前明确失败：期望 `base_revision=3`，实际 `base_revision=4`，请求内容仍为 900 宽白底。修复后 token 保持 3，模拟 409 后输入和撤销历史保留。

## 状态机与所有权

`useStripHistory` 保存 `past / present / future / saved / baseRevision`。`baseRevision` 属于最后接收或确认的服务端 checkpoint，不从最新 episode props 借用。

| 事件 | 内容与历史 | 基线 revision |
| --- | --- | --- |
| 会话创建 | 当前 episode.strip 成为 present 和 saved | 当前 episode.revision |
| 编辑 / undo / redo | 只改变本地历史；undo 可跨保存 checkpoint | 不变 |
| dirty 时 receive | 拒绝替换草稿，也不触碰撤销/重做 | 不变，即使新 strip 内容相同 |
| clean 时收到较新 episode | 同 strip 保留历史；不同 strip 接收布局并清空旧历史 | 接收该 episode 的真实 revision |
| 收到旧 episode | 拒收，防止迟到 props 回退保存结果 | 不变 |
| 发起保存 / 排版 | 原子捕获 `{strip, baseRevision}`；HTTP mutation 以变量携带 token | 请求进行中冻结 |
| CAS 成功 | 保存 canonical strip；只将等于提交 snapshot 的历史项替换成 canonical，期间继续编辑的 present 保留 | 请求 baseRevision + 1 |
| 成功期间继续编辑 / undo | 新 saved 与当前 present 独立；当前输入或 undo 结果仍 dirty，可 redo 到 canonical checkpoint | 仅推进到该请求自己的成功版本，不接收较新远端版本 |
| 失败 / 409 | 不 acknowledge，保留输入、历史和 retry 能力 | 不变 |
| pending 结束 | 再处理一次期间到达的 props：clean 可接收较新真实版本，dirty 仍拒收 | 遵守 receive 规则 |

成功版本的 `+1` 不是对 props 的猜测：两条写接口均向 `store.update_episode(... expected_revision=...)` 执行一次原子 CAS，存储的成功写入严格 `current + 1`。新增真实 API 测试锁定保存与排版均只加一、响应 strip 与该版本持久内容相同，以及排版计算中途发生其他写入时仍返回 409。

`receive` 返回是否接受了传入基线，供自动节奏后续排版使用；相同 revision 必须内容也与当前 checkpoint 一致才算已接收。旧回执不能覆盖更高版本。

## 自动节奏与导航

为排版新增 CAS 后，补出另一条必需闭环：PacingDialog 先前忽略 apply 返回的完整 Episode，可能在 props 尚未刷新时直接用旧基线排版。另两条红回归也证实：pacing 请求期间继续编辑、较新 props 先到，再收到旧 pacing 回执，会通过迟到自动排版覆盖输入。

PacingDialog 现在仅把真实 stored Episode 传回 Canvas。Canvas 必须成功 `receive(stored.strip, stored.revision)` 后才继续自动排版。若请求期间已经有 dirty 草稿，或已接收更高版本，则不启动后续排版，不推进旧草稿基线。回归覆盖编辑先于 refetch（保留基线 3）及 refetch 先于编辑（草稿创建于真实基线 5）两种顺序。

没有新增“强制覆盖”或隐式重载。现有 `useUnsavedGuard(dirty || pending, true)` 继续保护路由、query 参数切换和浏览器 reload。取消离开保留草稿和基线；明确确认离开后，重新进入创建新会话，读取当前服务端内容和 revision。实际 ReaderView 的 Outlet 按 episode.id 设置 key，跨话不复用 history。组件回归实测取消离开仍以 3 保存，明确离开并返回后从远端 4 开始。undo/redo 历史仍只在当前画布会话保留。

## 改动文件

- `web/src/pages/canvas/useStripHistory.ts`：保存基线、请求 snapshot、单次成功确认和 receive 规则。
- `web/src/pages/canvas/CanvasTab.tsx`：history 绑定 revision；保存/布局/避让使用草稿 snapshot；pending 后回读与 pacing 回执接收。
- `web/src/pages/canvas/PacingDialog.tsx`：最小传回实际 stored Episode。
- `web/src/api/production.ts`：保存与排版 token 作为必填 mutation 变量，避免 render 闭包借用最新 revision。
- `server/mio_server/api/production.py`：布局 POST 增加可选 `base_revision` query 并执行 CAS；公开 API 不带 token 的既有调用继续可用。
- `web/src/pages/canvas/CanvasTab.revision.test.tsx`、`useStripHistory.test.ts` 与 `server/tests/test_review_canvas_revision.py`：回归。

schema / SDK / extensionProtocol 生成物由主控统一生成，本修复者未单独生成或覆盖。

## 验证记录

- 原始 Canvas 红回归：1 条按预期失败，实际发送 token 4，期望 3；随后转绿。
- pacing 闭环红回归：3 条按预期失败，分别捕获旧 token 和两种顺序的输入覆盖；随后转绿。
- `npm --prefix web test -- src/pages/canvas`：9 文件 / 86 项通过。
- `npm --prefix web run typecheck`：主控统一生成 schema 后通过。
- touched TS/TSX 的 Prettier 检查：通过。
- 在 `server/` 下执行 `python -m unittest tests.test_review_canvas_revision tests.test_canvas_assist tests.test_canvas_editing -q`：16 项通过。
- 新增 API 测试 4 项：单次成功 +1、旧 token 保存/排版拒绝、计算中途并发写拒绝、不带 token 的既有行为。
- 两个 Python 改动文件的 Ruff lint / format：通过。
- 本修复文件的 `git diff --check` 与 UTF-8/BOM 检查：通过。

## Chrome 检查与边界

使用已安装 `C:/Program Files/Google/Chrome/Application/chrome.exe` 的隔离 headless context，没有安装浏览器。临时 Vite fixture 加载真实 CanvasTab、history、HTTP hooks、Konva Stage 和项目样式；白底、中性蓝色占位图片及 fixture episode 全部来自临时模拟。fixture 服务未代理真实后端，没有读取个人运行数据、调用 ComfyUI / LoRA / 付费服务。

QA 清单：900 宽 dirty 草稿 → Remote refetch 到 revision 4 → 保存返回 409；同时观察请求 token、输入保留、未保存状态、保存按钮和错误反馈。四组 `1440×900 / 390×844 × light / dark` 全部发送 base 3 / width 900 / 白底，远端仍为 4，输入 DOM 值仍为 900；无文档级横向溢出。四张截图已直接视检：工具栏和保存入口可见，窄屏按既有样式换行，画布仍为白底；窄屏 inspector 位于既有纵向滚动内容下方，未把输入的 DOM 保留声称为首屏可见。没有修改任何 CSS 或视觉结构。

此检查只覆盖隔离 Canvas fixture 的冲突保留，不能替代完整 Reader / 真实后端 E2E。导航取消、undo/redo、连续保存、pacing 和并发回读的精确时序由上述 React / 真实 API 回归覆盖。截图没有写入仓库；临时 fixture 已清理，Chrome 和临时 Vite 进程已退出。全仓门禁、独立复审、统一生成物与最终提交由主控完成。
