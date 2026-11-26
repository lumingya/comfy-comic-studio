# 第四轮独立 Chrome 工作流 UX 终审

结论：**REQUEST CHANGES**。发现 1 项明确的 Medium 体验性能问题；Blocker / High / Low 均为 0。四组导入、映射、键盘、视觉功能检查通过，但不能据此签发全票通过。

审查对象为 `3e994bb80794dea7be9773f5cb9c47119bf34c27`，差异基准 `38838ab43cf3d056951f2fc6c52afb737d34e3c6`。审查日期 2026-11-26。审查者未参与实现，初步结论前未阅读旧 Comfy 审计报告或他人结论；已读 AGENTS、README、ROADMAP 和完整任务。未改产品、测试、Git 或用户原工作区。

## Medium — R4-WEB-01：资料库列表重算阻塞保存完成

**实际影响**：正常导入并保存一份 200 节点、32 LoRA 工作流后，预检弹窗超过 15 秒仍显示“正在保存…”。真正写入已经成功，但界面必须等待工作流列表刷新，使用者无法及时返回编辑。重新打开配置页同样等待资料库列表。

**实际证据**：

- 测试服务在开始时已有 48 条工作流（含大量此前保留的中性 200 节点合成副本）；本次通过界面导入并保存后为 49 条。
- 保存后的真实页面重新载入中，浏览器 Resource Timing 记录 `GET /api/workflows` 为 **21,473 ms**。相同页面当前所选工作流的详情请求为 **14 ms**。
- 总控授权仅做一次普通请求复核：同一 Chrome 任务页 `fetch('/api/workflows')` 返回 HTTP 200，**18,772 ms**、49 条、13,756 UTF-8 字节。没有循环、并发或压力负载。
- `web/src/api/system.ts` 的 `useImportWorkflow.onSuccess` 返回 `invalidateQueries(keys.workflows)` 的 Promise；`WorkflowsSection.tsx` 要到 mutation 完整成功回调才关闭预检。因此观察到的列表延迟会直接延长保存弹窗的 busy 状态。
- `server/mio_server/api/library.py:list_workflows` 对资料库每条工作流同步执行 `C.describe` 和槽位计划检查；列表响应仅约 13.4 KiB，不是大型下载。

**复现步骤**：保留现有隔离测试资料库，导入本目录独立中性 200 节点/32 LoRA JSON → 展开“调整参数映射” → 采纳识别结果 → 搜索 `/200/inputs/text` 并 Enter 改写正词映射 → 保存 → 观察“正在保存…”持续等待列表刷新。正常重开配置页也能观察列表等待。

**建议修复标准**：列表读取使用有界、可复用的摘要，避免每次列举全库重做完整图推断；确认单项持久化成功后，界面不应被无关全库刷新长时间阻塞。修复仍须保留保存失败反馈、映射正确性与依赖变化后的摘要失效行为。

**定级与因果边界**：这是 49 条合成大图资料库下可重复的当前版本体验问题，定为 Medium。测试服务与自动化 Python 受单 CPU、BelowNormal 限制；库内累积测试数据未清空，也未在基准提交运行同一库，所以**不宣称已证明由本轮某个提交引入、生产硬件的绝对时延、或只有 1 条大图时也会如此**。本结论不依赖这类尚未测得的归因。

## 已通过的真实 Chrome 矩阵

Chrome **158.0.8127.37**，通过已存在专属 CDP 连接创建新隔离 context、单 page 顺序执行，未安装浏览器或运行浏览器测试框架套件。首个任务页正文读取前已精确校验测试 origin。服务保持原进程，不重启、不构建、不启动 Vite。

| 视口 / 主题 | API 200 节点 + 32 LoRA | 纯 UI JSON / PNG / WebP | 采纳、搜索、手工 Enter 覆盖 | 几何与实际截图 |
|---|---|---|---|---|
| 1440×900 / 浅 | 12 绑定，32 LoRA | 三者均 3 步指引，禁止保存 | 通过；并完成保存、reload、重开核对 | 页面宽 1440；API 弹窗 970/970；已看图 |
| 1440×900 / 暗 | 12 绑定，32 LoRA | 三者均 3 步指引，禁止保存 | 通过，选择后焦点回正词触发器 | 页面宽 1440；API 弹窗 970/970；已看图 |
| 390×844 / 浅 | 12 绑定，32 LoRA | 三者均 3 步指引，禁止保存 | 通过；Tab/Shift+Tab、ArrowDown、Enter、Escape | 页面宽 390；API 弹窗 348/348，UI 弹窗 356/356；已看图 |
| 390×844 / 暗 | 12 绑定，32 LoRA | 三者均 3 步指引，禁止保存 | 通过；Tab/Shift+Tab、ArrowDown、Enter、Escape | 页面宽 390；API 弹窗 348/348，UI 弹窗 356/356；已看图 |

每组都实际选择合成文件并经过产品的 file input/change → 文件解析 → HTTP 预检 → 真实 React 预览路径，没有伪造接口响应或将纯 UI 图当作可执行成功。API 图在每组可用；唯一一次保存回读的参数映射共有 12 项，手工正词目标为 `/200/inputs/text`，输出 `/7`、宽度 `/4/inputs/width` 保留。

独立夹具仅由本审查新建，未 import Mio：200 个节点、32 个链式 LoRA，文件名主干 142 字符，末节点标题 149 字符；纯 UI 图为 2 节点/1 连线，并将相同 UI JSON 分别写入 PNG workflow 文本和 WebP EXIF workflow 元数据。8×8 纯色图无第三方原图、作者文本或私人数据。

### 可用性与视觉观察

- 所有纯 UI 文件都用人话解释“这是界面格式”，说明打开原 JSON/样图、从 ComfyUI 导出 API（旧版先启用开发者选项）、重新导入后核对映射。结构概览没有冒充已经转换或执行，保存按钮保持禁用。
- API 预检明确说明只基于文件内容，未连接 ComfyUI 检查节点/模型；“编译通过”没有被写成真实运行成功。
- 32 个 LoRA 均能列出，搜索最后一项返回 1 条。浅色桌面原生滚动容器为 384/1025 px、可到 scrollTop 641；手机为 384/1742 px，可到末尾约 1357.5 px。没有横向溢出。
- 200 节点的映射选择器搜索最后节点，结果完整展示 149 字符长标题；采纳 12 个识别绑定后仍可手工覆盖。手机触发器内的选中长标题使用省略号，但展开搜索结果可读到完整值，没有无法恢复的内容裁切。
- 每组键盘 Enter 选择后，异步重新预检结束会将焦点恢复至正向提示词触发器；手机 ArrowDown 可再次打开、Escape 关闭后回到触发器。预检整体 Escape 关闭后返回“导入工作流”；手机 Shift+Tab 从关闭按钮到保存、Tab 回关闭，焦点没有穿入背景。
- 142 字符文件名在长标题预检中自然换行；手机弹窗原生纵向滚动可到映射、依赖和底部操作，按钮可达，四组均未出现页面或弹窗水平溢出。
- 已实际查看桌面浅/暗 API、映射和 UI 提示截图，以及手机浅/暗 API、映射和稳定 UI 提示截图。首次手机浅色 UI 截图抓到入场动画中间态，已等待动画结束重拍并复看；中间态不作为缺陷或终态证据。

## 观测与隐私边界

独立新 context 的整个会话：console error **0**、page error **0**、failed request **0**；所记录请求全部为测试服务同源。只记录 method/route/同源布尔值与错误计数，不读取或输出请求/响应 header、Cookie、账号、凭据或响应正文。观察到的写请求仅为预检、inspect-file 和本次工作流保存；没有 trial、生成、ComfyUI 依赖诊断或外部服务调用。此浏览器网络观察不等同于全系统网络审计。

流程事件需如实记录：最初按总控传来的旧 MCP page ID 调用 snapshot，工具意外返回了非任务页 a11y 内容；同一顺序调用中的小范围 evaluate 也检出非任务 origin。随后立即停止该入口。没有点击、修改、截图、下载或将意外页面内容写入本报告、测量文件或其他本地文件；没有读取 Cookie、Authorization 或 profile。本报告不保留该页面 URL、账号、文本或工具原始输出，不能声称该入口从未返回非任务内容。后续一律专属 CDP 新隔离页、正文读取前先核验精确 origin。

自动化 Python 在浏览器库导入前实际设置并读回 CPU affinity **1**、priority **16384（BelowNormal）**。单页串行执行；按总控调度中途暂停后重新获得租约。新建的 context/page 已由其 own context.close() 关闭，driver 正常退出，未调用旧 MCP ID 清理其他页。上下文/target 标识仅在给总控的清理消息中传递，不写入发布测量。

未测：真实 GPU/模型执行、ComfyUI 的真实菜单操作、付费 API、触屏硬件/软键盘、屏幕阅读器、跨浏览器、系统级网络/功耗、干净资料库与基准提交时延对照、超出任务矩阵的浏览器 E2E。没有用已绿远端门禁替代本次 Chrome 观察，也没有重跑门禁或性能压力循环。

## 证据文件

安全结构化数据：`measurements.json`。关键实际查看截图（均仅含中性合成工作流与隔离测试工作室）：

- `desktop-light-api.png`、`desktop-light-mapping-search.png`、`desktop-light-ui-webp.png`
- `desktop-dark-api.png`、`desktop-dark-mapping-search.png`、`desktop-dark-ui-webp.png`
- `mobile-light-api.png`、`mobile-light-mapping-search.png`、`mobile-light-ui-webp-stable.png`
- `mobile-dark-api.png`、`mobile-dark-mapping-search.png`、`mobile-dark-ui-webp.png`

本文件是未经旧报告影响的初步独立结论。交叉互核与修复后复验另行追加，不覆盖本次实际观察。
