# Cross-audit 4 · Performance R4

状态：**NOT VERIFIED PASS**

冻结绑定：

- HEAD：`b78de840044750fd29a214fcdba51ad130f4c925`
- dist index SHA-256：`4b55b6a14bc0a9732e444f64828889401218d95a9b9dba5c18c9e0990e195ba1`
- dist tree SHA-256：`0afbb092f4a3860234630cd7e94239a0c1efcf6e2f27bc6665bc7314d9482930`
- 证据目录：`C:\Users\QIU\AppData\Local\Temp\mio-crossperf-r4-uujuo13g`

## 已完成

动态壁纸自然时间矩阵完成 8/8：

- 视口：1440、390
- idle：0、30、60、180 秒
- 每项含真实自然等待、3 秒静止采样、视频解码帧差、currentTime、dropped frames、focus/visibility、恢复首帧、Chrome 进程 CPU/RSS/PrivateUsage、JS Heap、TaskDuration 与 trace 摘要。
- 0 秒项确认持续播放；30/60/180 秒项确认自然暂停、静止期间无解码帧增长，并确认鼠标恢复后重新播放。
- trace 仅报告实际出现的 Paint、Raster、Composite、Swap、图片/视频解码事件；嵌套 X duration 可能重叠。

动态壁纸证据保留在临时进度 JSON 中，未将其转换为硬件功耗或 GPU 结论。

## 扩展阶段

六扩展三态矩阵未完成，不能判通过。

- 已完成 23/36 个开关循环：
  - 1440 宽度完成 18 个循环；
  - 390 宽度完成 5 个循环。
- 采样包含 disabled、enabled-unopened、opened 生命周期中的 host/iframe heap、iframe 数、资源路径、固定 3 秒 CPU/trace、关闭后 iframe 数与 GC。
- 在 390 宽度第 6 个包打开前，真实 `[data-episode-extension-menu]` 容器等待 30 秒仍未出现，runner 终止并清理自有浏览器/服务。
- 该阶段不通过；剩余 13 个循环、QA、模板与 native blur 均不能由此次运行推定。

离线定位确认：

- 前端真实实现位于 `web/src/extensions/hostSlots.tsx`；
- 菜单由异步 `/api/extension-panels` 数据挂载；
- 触发器为 `[data-episode-extension-menu]` 内的按钮，英文 aria-label 为 `Extensions`，中文为 `扩展`；
- 性能夹具实际 episode 为 `power-fixture-episode`。此前探针曾误用通用浏览器夹具 episode，已修正后重跑；
- 菜单仍在 390 宽度第 6 包前缺失，故不能把问题归因于 selector 已修复，也不能把失败算作产品缺陷。

## 未覆盖

以下项目没有可靠完成证据：

- QA 当前真实 iframe → bridge → API → JobEngine → DOM 四分支；
- 120 幕 1440 候选的完整交互矩阵与 60/120 拆幕导入；
- pan/divider 三轮尾分位；
- 五模板 60/120、两宽度、三次打开、滚动/分页及 120 轮开关回归；
- native raw CDP + Win32 HWND A/B/A blur。

## 测量边界

本轮允许报告的指标限于自有 Chrome/iframe：

- 共同存活 PID 的 CPU 时间差；PID 集合变化时仅是下界；
- RSS 与 Windows PrivateUsage 瞬时快照；
- GC 后 JS Heap 与 DOM 节点；
- TaskDuration、LongTask、requestAnimationFrame 间隔尾分位；
- trace 中实际出现的 Paint、Raster、Composite、Swap、图片/视频解码事件；
- HTMLVideoElement 解码帧、播放时间、暂停状态、focus/visibility 与恢复首帧。

本轮不支持推断：

- 总系统内存峰值；
- GPU 利用率、GPU VRAM 或硬件解码占用；
- 瓦数、耗电量、省电百分比；
- 物理显示器 present/FPS；
- 打印 DPI、纸面色彩或实体打印效果；
- 真实云模型延迟、精度、费用或质量。

所有性能结果均受本机 Chrome 版本、窗口管理和当前运行环境限制。

## R4 纯文字交叉互核

- **架构席：互补，不补性能缺口。** 六面板的安装、桥接、API/JobEngine 与持久化证据证明所测功能路径可用；架构席明确没有做性能采样，不能补齐扩展启停的剩余 13/36 循环、QA 浏览器路径或空载 CPU/内存测量。
- **视觉席：互补，不补性能矩阵。** 五模板 40/40 仅覆盖 sample 与长标题、两种尺寸和浅/深主题；没有覆盖 60/120 幕滚动与分页性能，也没有完成六面板双尺寸、三主题视觉矩阵。
- **手感席：交互通过不等于性能通过。** 88/88 覆盖所列日常、面板核心流程和模板交互，但报告未提供对应性能测量，且保留面板深层操作与模板旅程缺口；不能替代长篇交互、pan/divider 尾分位或扩展生命周期性能测试。
- **混沌席：异常与释放证据不替代性能采样。** 请求取消、iframe 卸载、媒体清理和 QA API/SQLite 用例与本席范围没有冲突，但不能证明 CPU、内存、绘制或解码表现。XSS 的 20 个 case 虽逐项输出通过，wrapper 仍以 exit 15 结束，继续按未正常完成的命令记录。
- 未发现跨席证据冲突，也没有足以新增性能 B/H/M 的证据。性能席仍为 **NOT VERIFIED PASS**：扩展开关仅 23/36，390px 菜单等待失败未能判定为产品缺陷或探针问题；QA 浏览器链、长篇矩阵、pan/divider 三轮尾分位、模板完整性能矩阵及原生失焦采样仍未覆盖。其它席的功能或视觉结果不抵消这些缺口。

## 当前 HEAD 后续性能复验（补充原冻结报告）

在 `b78de84` 上运行 `python tools/check_roadmap_power.py --only extensions --report <TEMP>`：Chrome 158、1440/390 × light/dark/dynamic 共 6 contexts，每个 context 安装、逐一打开、停用并删除六个扩展，合计 36/36 循环通过。没有页面错误、外联或新 Job；关闭后没有残留 iframe。单轮观察记录为：未安装时同屏 retained JS heap 5.79–5.84 MB，六包启用后 6.57–6.62 MB，全部关闭后 6.02–6.09 MB；单面板 iframe heap 1.735–1.859 MB，面板 ready 约 0.49–2.79 秒。该数据是 Chrome renderer JS heap 和本地时间观察，不代表总 RAM、GPU、硬件解码或瓦数。

此前报告中的 390px 菜单未出现，在这次固定 power fixture 中没有复现：六种 390px 视口/主题面板循环都能找到扩展菜单并打开对应面板。由于旧失败没有留存该时刻路由、API 响应和 React Query 状态，历史观察仍列为未分类，不认定产品缺陷，也不计为当前复现失败。

该追加关闭扩展循环的 23/36 覆盖缺口；报告原轮仍为 **NOT VERIFIED PASS**。QA bridge 性能、60/120 幕长篇拆幕与交互、pan/divider 尾分位、模板滚动/分页、native raw CDP/Win32 blur 与完整功耗矩阵仍未由本阶段覆盖。

随后当前 HEAD 的全量 `python tools/check_roadmap_power.py --report <TEMP>` 以 6/6、exit 0 完成。动态壁纸 1440/390 两宽真实等待 30.004s 后暂停；后续 5.003s 观测 decoded frame delta=0，currentTime 不变且 CDP trace 无 Paint/Raster/Composite/Swap；活动时 5s 解码 151 帧，指针唤醒首帧 6.8ms / 2.3ms。长篇 fixture 为 120 panels、1,440 candidate records，但仅复用 12 个独立生成素材；滚动 rAF p95 25.1/25.0ms、max 41.9/46.0ms；split compare pan p95 20.9/12.6ms、max 25.1ms，所有这些样本中 >50ms 间隔为 0。JS heap 仅为 renderer GC 后瞬时快照：滚动 52.086→52.358MB / 49.440→49.688MB，对比平移 71.772→74.383MB / 69.106→71.734MB。60/180 秒阈值没有实际等待；此补测不覆盖模板性能、pan/divider 多轮尾分位、native blur 或 OS 原生失焦，也不推断瓦数/总系统 RAM/GPU 利用率。原 R4 轮性能报告状态仍为 NOT VERIFIED PASS。
