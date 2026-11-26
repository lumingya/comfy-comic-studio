# R2 Web 修复定向复测

**结论：定向修复复测 PASS。** 原 Web 审查的 1 个 Medium 与 2 个 Low 均已验证修复。**本报告不是新一轮独立终审，不替代下一轮五位全新审查者的交叉复审。**

日期：2026-11-26。执行对象为主控已完成构建并重启的 R2 修复工作树；当时 Git HEAD 仍为 `6f9bdf2c56994397754f4ec2c782f1ab63bc75a0`，因此不能将本报告表述为仅对该旧提交的通过结论。未修改产品、构建或提交。

## 环境与方法

- 真实已安装 Google Chrome **158.0.8127.37**，连接本任务专用隔离配置。仅创建、操作并最终关闭本复测自己的页面；没有读取或操作用户其他页面、配置、Cookie 或数据库。
- 实际 CSS 视口为桌面 **1440×900**、移动 **390×844**，各亮、暗主题；使用应用的系统主题模式配合浏览器媒体设置，并检查最终 `data-theme`。
- 复用原审查在仓库外创建的中性 200 节点 / 32 LoRA JSON、UI-only JSON / PNG、PNG / WebP API 元数据素材。素材只读复用，没有覆盖原文件。
- 每次从工作流页签开始按 Tab，直到实际焦点到原生“导入工作流”按钮，再用 Enter 或 Space 触发 Chrome 原生 `filechooser` 事件并选择文件。没有通过点击隐藏 input 或直接注入文件绕过键盘入口。
- 分别验证预检中 Escape、取消按钮、关闭按钮和成功保存后的 `document.activeElement`。成功保存覆盖 API JSON、PNG、WebP 三类，每种组合各一次，共 **12 次完整无损保存**。
- 没有启动生成任务、访问模型、使用 GPU 或调用云端服务；没有重新运行无关性能基准。

## 四组合结果

| 检查 | 桌面亮 | 桌面暗 | 移动亮 | 移动暗 |
|---|---|---|---|---|
| 实测视口与最终主题一致 | PASS | PASS | PASS | PASS |
| 原生 BUTTON，Tab 可达 | PASS | PASS | PASS | PASS |
| Enter 触发真实 filechooser | PASS | PASS | PASS | PASS |
| Space 触发真实 filechooser | PASS | PASS | PASS | PASS |
| Escape 关闭预检后焦点恢复 | PASS | PASS | PASS | PASS |
| 取消按钮关闭后焦点恢复 | PASS | PASS | PASS | PASS |
| 关闭按钮关闭后焦点恢复 | PASS | PASS | PASS | PASS |
| 成功保存后焦点恢复 | PASS | PASS | PASS | PASS |
| API JSON 保存：HTTP 201、200 节点图全等 | PASS | PASS | PASS | PASS |
| PNG 保存：HTTP 201、200 节点图全等 | PASS | PASS | PASS | PASS |
| WebP 保存：HTTP 201、200 节点图全等 | PASS | PASS | PASS | PASS |
| 三类保存均保留 32 LoRA 节点与 32 控制 | PASS | PASS | PASS | PASS |
| PNG / WebP 格式标签正确 | PASS | PASS | PASS | PASS |
| 默认 LoRA 全部 32 个完整 title 正确 | PASS | PASS | PASS | PASS |
| 页面无横向溢出 | PASS | PASS | PASS | PASS |
| console warning/error、pageerror | 0 | 0 | 0 | 0 |

“取消”指预检弹窗的取消操作，不是操作系统文件对话框中尚未选择文件的取消；本次验证范围没有混淆这两者。

## 原发现关闭证据

### WUX-R2-01 · Medium：键盘导入与焦点恢复 — 已修复

实际 DOM 已改为原生 `BUTTON[type=button].file-pick`，`tabIndex=0`。Tab 顺序真实经过“了解高级出图方案”、教程链接，再到“导入工作流”按钮。

四组合共 **24 次**主矩阵 chooser 触发均有真实 `filechooser` 事件，Enter / Space 各 12 次。Escape、取消、关闭、保存三种来源的每次退出后，焦点都是该 `BUTTON.file-pick`，`isImport=true`，按钮未禁用，具有可见焦点边框。没有再次落到 BODY。

结构化证据：`validated-run/evidence.json` 中每个组合的 `buttonDOM`、`checks[].tabSequence`、`nativeChooserEvent`、`restoredFocus`。截图：`validated-run/*-escape-focus.png`、`*-cancel-focus.png`、`*-close-focus.png`、`*-saved-focus.png`。动画稳定后的代表截图在 `steady-screenshots/*-restored-focus.png`。

### WUX-R2-02 · Low：图片元数据格式标签误显示为 Mio 包 — 已修复

PNG、WebP 现在都显示 **“图片（ComfyUI API 元数据）”**，不再显示“Mio 工作流包”。API JSON 仍显示“ComfyUI API”。全部图片和 JSON 保存结果都与原 200 节点图完全相等；每个保存结果均为 HTTP 201、32 个 LoRA 节点和 32 个控制。

结构化证据：`validated-run/evidence.json` 的 `formatLabel`、`expectedFormat`、`saved`。截图：`validated-run/*-neutral-prompt-png-format.png`、`*-neutral-prompt-webp-format.png`；优先查看已等待弹窗动画稳定的 `steady-screenshots/*-png-format.png`。

### WUX-R2-03 · Low：省略的默认 LoRA 名称没有完整名称提示 — 已修复

默认 LoRA 名称 span 现在有完整 `title`。四组合各检查全部 32 个名称，`textContent == title`，末项均为 `<neutral-lora-asset>`。搜索末项后进行实际悬停，DOM 中 title 保持完整。行内仍采用省略显示，完整名称通过原生 title 和已有完整无障碍标签提供。

结构化证据：`validated-run/evidence.json` 中 `loraTitles`、`loraLastTitle`，以及 `steady-screenshots/evidence.json`。截图：`steady-screenshots/*-lora-title.png`。浏览器内容区截图不包含操作系统绘制的原生 title 气泡，因此**这里的完整名称结论依据真实 DOM title 与全部 32 项逐一比对，不把截图称为已捕获原生提示气泡**。

## 初次脚本与复测证据说明

初次脚本未显式将复测页置于前台，在桌面两次等待 chooser 事件超时；它也错误地用 `innerText` 检查被 `content-visibility` 优化的屏外 LoRA 行，读到空字符串。这些初次结果保留为 `first-attempt-evidence.json`，未删除或改写成通过。

随后把自有页面置于前台、在 Tab 聚焦后等待 250 ms，并用保留原文的 `textContent` 检查屏外名称，完成一次四组合完整主矩阵：24 次 chooser 全部成功，无 console / pageerror，12 次无损保存、全部 128 个名称 title 对比通过。没有为获得通过修改产品。初次 chooser 超时没有足够证据归为产品问题，也没有据此宣称不存在任何其他浏览器问题。

部分最早截图捕捉到弹窗进入动画中间帧，故补充 `steady-screenshots/` 中四组合的稳定截图用于视觉核对；此补充没有扩展为新的长性能测试。

## 保留与清理

- 原 `audits/r2/web/` 的 **86 个文件**在复测前后逐个 SHA-256 全部相同，`oldEvidenceUnchanged=true`。原失败报告、素材、DOM、截图全部保留。
- 本次新增输出仅在 `repairs/r2-web-retest/`，包含主目录、`validated-run/`、`steady-screenshots/`；这些都是任务专用临时目录。
- `validated-run/evidence.json` 是本轮成功主矩阵的权威结构化结果；`first-attempt-evidence.json` 保留初次脚本问题；`steady-screenshots/` 提供视觉稳定截图。
- 所有报告与截图继续由主控核验，最终统一清理。本报告不声称临时目录已删除。
- 本次只确认 R2 Web 三项已报告问题的修复效果；**下一轮仍须由全新五位审查者执行独立终审**。
