# R5 后续补测与修复核验

日期：2026-11-27

基线：R5 主记录绑定 `b78de840044750fd29a214fcdba51ad130f4c925`；以下源代码修复尚未提交。

浏览器：Windows 隔离 headless Chrome 158.0.8127.37，未访问用户当前浏览器页。

## 五模板打开与滚动性能

使用 `tools/check_album_browser.py` 的 `export_examples()` 生成临时 SVG 素材与 1、60、120 幕 HTML，通过临时 Python / Playwright 探针以 `file:` URL 打开五模板。覆盖 1440×900、390×844，共 30 个组合，浅色、减少动态效果。DOM ready 是导航至 `DOMContentLoaded` 的墙钟时间；稳定打开则量至 load、字体就绪、强制全部 `.cc-image` eager 加载并解码、再过两帧。它代表全图解码完成，不等于正常懒加载下的首次可读时间。

滚动探针选择最大可滚动元素，在 1.6 秒内将 `scrollTop` 从顶端推进到底端，以相邻 rAF 时间戳计算分位数。Nocturne / Folio 的单页模式另以 `ArrowRight` 翻页并等待 `.mio-progress` 更新。溢出比较 `documentElement.scrollWidth` 与 `innerWidth`；错误统计 pageerror 与 console error；外联统计非 `file:`、`data:`、`blob:` 请求。

稳定打开与 rAF 结果（数值依次为 1 / 60 / 120 幕；时间 ms）：

| 模板 | 视口 | 稳定打开 | 滚动高度 px | rAF p95 | rAF 最大 |
| --- | --- | ---: | ---: | ---: | ---: |
| Monograph | 1440×900 | 589.7 / 90.6 / 80.3 | 1,351 / 64,747 / 129,017 | 4.3 / 4.3 / 4.3 | 4.6 / 5.8 / 12.5 |
| Monograph | 390×844 | 46.8 / 79.7 / 101.3 | 844 / 30,277 / 60,159 | 4.3 / 4.3 / 4.3 | 4.4 / 4.4 / 4.8 |
| Nocturne | 1440×900 | 55.4 / 53.1 / 66.0 | 1,403 / 1,403 / 1,403 | 4.3 / 4.3 / 4.3 | 4.5 / 4.6 / 4.4 |
| Nocturne | 390×844 | 50.3 / 57.1 / 52.1 | 844 / 844 / 844 | 4.3 / 4.3 / 4.3 | 4.4 / 4.4 / 4.6 |
| Folio | 1440×900 | 183.3 / 60.9 / 127.0 | 1,014 / 1,329 / 1,329 | 4.3 / 4.3 / 4.3 | 66.9 / 33.4 / 8.3 |
| Folio | 390×844 | 61.7 / 56.5 / 55.8 | 844 / 844 / 844 | 4.3 / 4.3 / 4.3 | 4.4 / 4.4 / 4.4 |
| Zine | 1440×900 | 62.1 / 80.5 / 92.2 | 1,239 / 24,293 / 48,092 | 4.3 / 4.3 / 4.3 | 29.2 / 4.5 / 4.7 |
| Zine | 390×844 | 118.4 / 72.0 / 77.5 | 861 / 29,010 / 57,830 | 4.3 / 4.3 / 4.3 | 4.4 / 4.6 / 4.6 |
| Contact Sheet | 1440×900 | 78.0 / 95.7 / 126.4 | 900 / 3,936 / 7,511 | 4.3 / 4.3 / 4.3 | 4.6 / 4.5 / 4.5 |
| Contact Sheet | 390×844 | 69.9 / 94.8 / 108.3 | 844 / 8,745 / 17,390 | 4.3 / 4.3 / 4.3 | 4.6 / 4.5 / 4.5 |

Nocturne / Folio 翻页时延（p95 / 最大，ms）：

| 模板 | 视口 | 60 幕 | 120 幕 |
| --- | --- | ---: | ---: |
| Nocturne | 1440×900 | 7.44 / 9.16 | 8.30 / 12.33 |
| Folio | 1440×900 | 10.29 / 13.14 | 12.13 / 17.11 |
| Nocturne | 390×844 | 8.65 / 9.40 | 7.21 / 8.16 |
| Folio | 390×844 | 7.58 / 7.90 | 7.39 / 9.68 |

所有 30 个组合均为 0px 横向溢出、0 页面错误、0 外联请求。Monograph 桌面 1 幕 589.7ms 是首个冷加载样本；Folio 桌面单轮最大 rAF 间隔出现 66.9ms 与 33.4ms。Nocturne / Folio 手机上及部分单页布局没有真实滚动距离，不能把这些 rAF 数字当成长页滚动成绩。原始逐帧样本、JSON 与截图均未保留；临时夹具由 `TemporaryDirectory` 自动清理。该单轮 headless 结果只补足模板性能观察，不构成跨设备性能签发。

## 导出取消缺陷复核

R5 混沌复核发现，导出抽屉的 source GET 和 creation-kit POST 未传入其 AbortController。修复现在贯通 `ExportDrawer` → `download` / `exportCreationKit` → `downloadPost` → `raw`，并在缓冲响应读取后、创建 object URL 前及触发下载前检查取消。卸载后不更新组件状态。定向测试 31/31 通过，Web Prettier 通过；独立复核者确认未发现仍成立的 Medium。浏览器下载 click 已同步提交后无法撤回，但关闭抽屉至 click 之间的异步取消窗口都有检查。

改动文件：`web/src/api/client.ts`、`web/src/api/creationKits.ts`、`web/src/pages/works/ExportDrawer.tsx` 与两个对应测试文件。尚未提交。

视觉席另发现模板卡标题在桌面两列卡片中被省略。`export-drawer.css` 已改为允许标题换行，布局副标签仍按紧凑宽度截断；选择及 ARIA 行为未变。组件测试 21/21、Prettier 通过；隔离 Chrome 复核覆盖 light/dark、1440×900 与 390×844 的 Monograph / Nocturne / Contact Sheet 共 12 项，标题 `white-space=normal`、`overflow-wrap=anywhere`，标题节点 `scrollWidth=clientWidth`，卡片与页面均无横溢，错误和外联为 0，修复确认关闭该视觉观察。

## 当前本机门禁与后端失败

Wave 4 的二进制契约缺口也已修复：12 个图片、ZIP、HTML、PDF 与素材下载端点现在明确列出实际媒体类型和 `string/binary` schema；`clients/openapi-v2.json` 与 `web/src/api/schema.d.ts` 已重新生成，Python 客户端生成检查无漂移。新增的 OpenAPI 契约测试 1/1、Ruff、格式检查和 API 模块 `compileall` 通过。资产端点保留 `application/json` 原始资产类型，因此它仍按原始二进制声明，而不是误当作结构化 JSON。

- `ruff check server clients tools && ruff format --check server clients tools`：通过，436 文件。
- `python clients/python/generate.py --check`：通过。
- `python -m unittest discover -s next/tests -t next -q`：80 项通过。
- 前端定向测试：31/31 通过；TypeScript 检查被生产 build 中的 `tsc --noEmit` 覆盖并通过；Prettier 检查通过；生产 build 通过。
- 前端全套 Vitest 随后在无竞争条件下通过：127 files / 1084 tests，全部通过，约 50.87 秒。此前与 build / typecheck / Spike 并发造成的 `WorkflowMappings` 超时保留为历史噪声，不计作当前失败。
- 后端全量 `python -m unittest discover -s server/tests -t server -q`：1754 项、5396.293 秒，1 failure / 1 error / 8 skipped。`test_review_cloud_deadline.py` 随后单独 10/10 通过。
- AI 备份并发用例最初失败于 `entered.wait(2)`。静态检查确认 `snapshot.quiescent()` 取得的 participant lock 与 `ConversationStore.put` 使用同一把锁。测试现在只把 catalog 限定为真实 AI backup participant，仍经过真实 `quiescent()` / `acquire_locks()` / `snapshot.capture()` 和同一把写锁；早期 logical-head barrier 精确测试 1/1 通过（85.960 秒）。仅测试夹具改变，没有生产锁逻辑改动。全后端套件旧的 1 failure / 1 error 终态仍保留，窄测不冒充全量通过。

完整发行数据检查仍受保护的本机 seed 差异影响；旧 recovery 目录由用户自行处理，本记录与后续操作均不触碰。
