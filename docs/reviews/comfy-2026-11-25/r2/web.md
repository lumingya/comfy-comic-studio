# Wave 4 第二轮 · CrossAudit-4-WebUX

结论：**REQUEST CHANGES**。

审查产品提交：`6f9bdf2c56994397754f4ec2c782f1ab63bc75a0`。审查者未参与实现，本轮未修改产品源码。真实已安装 Google Chrome **158.0.8127.37**，通过任务专用隔离配置的 CDP 连接；没有安装浏览器、启动替代 Chromium、读取用户配置或调用 GPU。预览来自任务隔离服务。日期：2026-11-25。

## 分级发现

### Medium · WUX-R2-01：导入入口不可由键盘触发，关闭导入预检后焦点丢失

- 位置：`web/src/components/ui.tsx:313`，`FilePick`；入口使用方为 `web/src/pages/settings/WorkflowsSection.tsx`。
- 实际 DOM：`<label class="btn" aria-disabled="false">导入工作流<input hidden accept=".json,.png,.webp" type="file"></label>`。
- 真实 Chrome 计算值：文件输入 `display: none`；外层 label `tabIndex = -1`。没有可聚焦的按钮或键盘激活处理器。
- 四种组合均重现：聚焦“工作流”页签，按 Tab，依次到“了解高级出图方案”、教程链接、“搜索工作流或模型”，直接越过导入入口。完整 16 步 Tab 序列也未出现导入控件。
- 用真实鼠标点击该 label、通过原生文件选择器导入后，按 Escape 关闭预检，四种组合的 `document.activeElement.tagName` 均为 `BODY`，没有回到导入入口。此处不是只用隐藏 input 注入造成的假阳性。
- 影响：只用键盘的创作者无法开始 JSON / PNG / WebP 导入；退出预检后也丢失操作位置。不满足本轮“键盘操作与焦点正常”的验收条件。
- 修复方向：由可聚焦的原生按钮触发文件输入；保留真实触发元素，并在关闭、取消或完成预检后恢复到合理位置；支持 Enter / Space，禁用时行为一致。
- 证据：`keyboard-import.json`（DOM、计算样式、Tab 序列）、`image-import-saves.json`（四组合 Tab 序列）、`extra-evidence.json`（真实 chooser 导入后的 Escape 焦点）。

### Low · WUX-R2-02：PNG / WebP 元数据导入的格式名称显示为“Mio 工作流包”

- 四组合从中性 PNG `prompt` chunk、WebP EXIF `prompt:` 读取 API 节点图时，预检“文件格式”均显示“Mio 工作流包”。原文件实际是带 ComfyUI API 元数据的图片。
- 提取与保存本身正确：八次图片保存均为 HTTP 201，保存图与原始 200 节点 API 图完全相等，32 个 LoRA 节点及 32 个控制全部保留。
- 影响较低：格式标签容易让用户误以为来源是 Mio 导出的工作流包；不影响当前导入结果。
- 证据：`metrics.json` 中 `pngPrompt.text` / `webpPrompt.text`，`image-import-saves.json`。

### Low · WUX-R2-03：默认 LoRA 控件将完整文件名省略，当前行没有悬停完整名称

- `web/src/pages/settings/lora-toggle-list.css` 的 `.lora-toggle-switch span` 使用单行省略；`LoraToggleList.tsx` 的对应 span 没有 `title`。
- 四组合的默认值行均把 `NeutralStudy_032_LandscapeStyle.safetensors` 截为省略文本。搜索与无障碍标签保留完整名称，“识别到的 LoRA”展开列表也能完整换行，因此本次不是操作阻断。
- 建议：默认值行也提供完整名称的可视核对方式，避免文件名相同前缀、不同后缀时难以确认。
- 证据：四张 `*-default-lora-scrolled.png`，`default-scroll.json`；这组截图已实际滚动到控件，排除了固定保存栏短暂遮挡造成的误判。

Blocker：0；High：0；Medium：1；Low：2。

## 测试材料与操作范围

所有素材都是本审查者在仓库外创建的中性合成内容，不含作者工作流、私人提示词、账号或用户素材：

- `neutral-200-32loras.json`：准确 200 个 API 节点，含标准采样、正负提示词、尺寸、种子、最终 SaveImage、32 个串联 LoRA，以及用于搜索末尾节点的中性文本字段；不运行模型。
- `neutral-ui-only.json` / `neutral-ui-only.png`：200 个节点的纯 UI 格式；检验结构概览、API 导出指引与保存禁用。
- `neutral-prompt.png`：PNG 中包含 API `prompt` 和 UI `workflow`；检验优先提取 API prompt。
- `neutral-prompt.webp`：WebP EXIF 中包含 API prompt。
- `neutral-reference.json` / `neutral-uncertain.json`：补充候选绑定呈现的中性静态图；相关原始 DOM 记录在 `extra-evidence.json`，不将其当作动态插件执行验证。

主矩阵的 API JSON 每个组合都实际保存。每次采用 12 个推荐映射，再将正向提示词从节点 2 人工改为节点 200，验证提交与焦点，最后改回节点 2 后保存。PNG 与 WebP 每个组合也分别实际保存并比较完整节点图。LoRA 默认开关只做未保存的可逆编辑，之后恢复已保存默认值。

## 四组合逐项结果

| 验收项 | 桌面亮 1440×900 | 桌面暗 1440×900 | 移动亮 390×844 | 移动暗 390×844 |
|---|---|---|---|---|
| Chrome 实际 CSS 视口 / 主题 | 实测一致 | 实测一致 | 实测一致 | 实测一致 |
| 200 节点 API JSON 预检及保存 | PASS | PASS | PASS | PASS |
| 识别正负提示词、尺寸、种子、步数、CFG、输出等 12 项 | PASS | PASS | PASS | PASS |
| 一键采纳 12 项推荐映射 | PASS | PASS | PASS | PASS |
| 200 节点映射搜索，初始最多挂载 60 项 | PASS | PASS | PASS | PASS |
| 搜索节点 200 并 Enter 人工覆盖，再改回节点 2 | PASS | PASS | PASS | PASS |
| Enter 后焦点恢复到新映射 combobox | PASS | PASS | PASS | PASS |
| 随后 Tab 到该行移除按钮 | PASS | PASS | PASS | PASS |
| 32 项 LoRA 全部列出；搜索 032 命中末项 | PASS | PASS | PASS | PASS |
| 默认 LoRA 搜索 / Space 切换 / 恢复默认 | PASS | PASS | PASS | PASS |
| UI-only JSON 人话导出指引，保存禁用 | PASS | PASS | PASS | PASS |
| UI-only PNG 人话导出指引，保存禁用 | PASS | PASS | PASS | PASS |
| PNG 元数据提取、实际保存、完整图相等 | PASS | PASS | PASS | PASS |
| WebP 元数据提取、实际保存、完整图相等 | PASS | PASS | PASS | PASS |
| 诊断说明明确区分静态编译与实际可运行性 | PASS | PASS | PASS | PASS |
| 预检弹窗内部 Tab 循环、Escape 关闭 | PASS | PASS | PASS | PASS |
| 通过键盘进入文件导入 | **FAIL Medium** | **FAIL Medium** | **FAIL Medium** | **FAIL Medium** |
| 鼠标导入后 Escape 恢复触发器焦点 | **FAIL Medium** | **FAIL Medium** | **FAIL Medium** | **FAIL Medium** |
| 页面 / 预检 / 映射搜索横向溢出 | 未见 | 未见 | 未见 | 未见 |
| LoRA 默认值长名称完整显示 | Low 省略 | Low 省略 | Low 省略 | Low 省略 |
| console warning / error、pageerror | 0 | 0 | 0 | 0 |

## 诊断、布局与焦点证据

- 纯 UI 格式显示“这是 ComfyUI 界面格式，请在 ComfyUI 中使用「导出 (API)」后重新导入”，接着列出打开文件、菜单导出（旧版先开开发者选项）、重新导入并核对映射三步。结构概览显示 200 节点；没有笼统的无效 JSON 错误。
- API 预检显示“尚未连接 ComfyUI 检查节点与模型；当前结果仅来自文件内容”，并明确“编译通过表示节点图可组装，实际可运行性请在保存后诊断”。未配置实例时不冒充真实依赖诊断成功。
- 预检主题、标题、指引、映射弹层、LoRA 搜索在实际截图中可读；窄屏长预检通过纵向滚动访问，按钮通过正常滚动可达。
- 页面 `scrollWidth` 不超过 `clientWidth`，弹窗 `scrollWidth == clientWidth`。移动端工作流列表是自身横向滚动轨道，轨道中的非当前卡片超出屏幕属于滚动内容，不计为页面溢出。
- 手工覆盖提交后焦点为 `BUTTON[role=combobox][aria-label=正向提示词]`，所属行 `data-mapping-target=/200/inputs/text`；Tab 后为“移除正向提示词目标 1”。四组合一致。
- 弹窗取消按钮上按 Tab 会循环到关闭按钮，焦点仍在弹窗内。Escape 关闭有效，但导入入口的焦点恢复存在上述 Medium。
- 默认 LoRA 行实际滚动到可见位置后，checkbox、模型滑杆、模型数值与 CLIP 数值的中心命中元素均为自身，四组合一致，证明固定保存栏没有阻断正常滚动后的控件访问。

## 性能数据

以下为一次完整成功矩阵的端到端耗时，包含浏览器自动化调用与静态后端预检，不是纯前端 CPU 时间或 GPU 占用率。搜索测到过滤结果稳定，一键采纳测到重新预检完成。无 CPU / 网络节流。

| 操作 / ms | 桌面亮 | 桌面暗 | 移动亮 | 移动暗 |
|---|---:|---:|---:|---:|
| 200 节点 API 预检 | 478.4 | 809.6 | 933.2 | 656.5 |
| UI-only JSON 预检 | 85.1 | 122.0 | 470.1 | 117.2 |
| UI-only PNG 预检 | 40.3 | 144.0 | 68.6 | 360.6 |
| PNG API 元数据预检 | 342.9 | 1109.0 | 923.9 | 900.5 |
| WebP API 元数据预检 | 850.0 | 1001.1 | 898.7 | 901.0 |
| 32 LoRA 搜索末项 | 34.0 | 65.9 | 36.3 | 50.3 |
| 映射搜索节点 200 | 58.2 | 83.0 | 22.6 | 55.6 |
| 一键采纳 12 项（含重新预检） | 668.1 | 795.9 | 709.6 | 635.6 |

主矩阵页面 PerformanceObserver 没有记录到大于等于 50 ms 的 Long Task。rAF 间隔 p95 分别约 4.4 / 4.3 / 4.3 / 4.3 ms，最大分别 66.8 / 37.7 / 112.3 / 33.5 ms；采集范围包括等待与截图，不据此声称持续帧率、滚动基准或 GPU 功耗。没有观察到搜索或选择卡死。

## 证据清单与清理

- 原始结构化结果：`metrics.json`、`extra-evidence.json`、`image-import-saves.json`、`keyboard-import.json`、`default-scroll.json`。
- 每种组合的代表截图：`*-api-top.png`、`*-neutral-ui-only-json.png`、`*-lora-search.png`、`*-mapping-search.png`、`*-mapping-adopted.png`、`*-default-lora-scrolled.png`。
- 每种组合的 DOM 文本：`*-final-dom.txt`、`*-uncertain-dom.txt`。完整 console / pageerror 数组在 `metrics.json`，均为空。
- 主矩阵写请求只有本机工作流 inspect、inspect-file 和工作流保存端点；未请求生成任务端点。没有使用真实 ComfyUI / 云端 / 模型。
- 临时材料、脚本与截图全部位于本审查专用的仓库外 `audits/r2/web/`，附带 Python `__pycache__/`。报告不含私人绝对路径或原作者内容；本报告可保留，素材与截图在主控核验后统一删除。不能在未清理前声称临时目录已清空。
- 测试浏览器只操作任务专用配置中的本审查页面，没有读取用户其他 Chrome 页面、用户数据库或凭据。
- CI 不是本子任务的独立执行范围；主控提供 run `45630099226` 三项 job SUCCESS，本报告不将其冒充自行复跑。

**签发：REQUEST CHANGES，待 WUX-R2-01 修复并经过新一轮独立复审。**
