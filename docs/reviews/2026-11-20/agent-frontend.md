# 第一轮前端 / 阅读器 / 安全对抗审查

审查基线为 `0c948c5`，范围覆盖 `git diff 0c948c5...HEAD`，并包含当前未提交的 `ChannelsSection.tsx` 保留旧 `extra_options` 小修正。已检查运行时脚本、模板渲染器、6 个模板、分镜筛选、LoRA 试生成控件、云端渠道配置、生成类型与已有 Vitest/CSP 测试。

## 发现

### P2 — 云端扩展 schema 外参数会被 UI 转成字符串并破坏类型 / 掩码凭据恢复

- 文件：`web/src/pages/settings/ChannelsSection.tsx:363-371`
- 触发：已保存扩展渠道的 `extra_options` 含未出现在当前 adapter schema 的数值、对象或敏感字段，例如 `auth: {access_token: "••••••"}`；用户在渠道详情编辑并保存。
- 证据：`JSON.stringify(value)` 的结果写入普通 `TextInput`，保存时类型由数字 / 对象变成字符串。嵌套 `auth` 会成为 `'{"access_token":"••••••"}'`；服务端 `settings._restore_masked_options` 只对字典递归恢复，字符串不会匹配 `MASK`，原 token 被掩码文本替换，适配器配置类型也损坏。
- 最小修复：对未声明字段用 JSON 对象编辑器；或显示为只读、但继续在保存 payload 中保留原始结构。增加 UI/API 回归验证数值、对象和嵌套密钥经“编辑其他字段并保存”后类型与原值保持。

### P2 — LoRA 查询使用永久 stale cache，保存工作流后试生成可显示旧槽位

- 文件：`web/src/pages/settings/WorkflowTrial.tsx:72-90`，`web/src/api/system.ts:104-129`
- 触发：工作流编辑器保存节点图或槽位计划后，在同一页面重新打开试生成。
- 证据：试生成通过独立 `raw('/api/workflows/{id}/loras')` 查询并设置 `staleTime: Infinity`；`useSaveWorkflow` 成功时只更新 `keys.workflow` / `keys.workflows`，没有使 `['workflow-loras', id]` 失效。用户会继续看到旧 LoRA 键、默认开关和范围，提交后可能因稳定键不匹配而失败或覆写错误槽位。
- 最小修复：为 LoRA 查询定义共享 key，并在保存 / 导入 / 删除工作流成功时失效；或把查询接入 typed API hook 并使用有限 stale time。

### P2 — 扩展适配器发现结果同样永久缓存，扩展启停后配置页可能显示旧渠道

- 文件：`web/src/api/system.ts:45-50`、`web/src/pages/settings/ChannelsSection.tsx`
- 触发：先打开云端渠道设置，再在扩展页启用或停用注册 `cloud_adapter` 的扩展，回到设置页。
- 证据：`useImageAdapters` 设置 `staleTime: Infinity`，扩展操作只失效通用 `['extensions']`（现有扩展 API），没有失效 `keys.imageAdapters`。配置 UI 的类型列表和 schema 参数因此保持旧内容，直到整页/进程重新挂载。
- 最小修复：扩展启停成功时同时失效 image-adapters，或去掉永久 stale 并在回到设置页时刷新。

### P2 — 离线阅读器只实现了灯箱，任务书要求的移动手势、全屏、缩略目录、进度栏和环境光仍缺失

- 文件：`server/mio_server/album/runtime.js:140-280`
- 触发：在新增的 6 套高定模板或旧 `flip` 模板中使用阅读器。
- 证据：当前新增逻辑提供灯箱、键盘左右切换、Escape、焦点恢复和 reduced-motion；没有 `touchstart/touchend` 或 pointer swipe，没有 fullscreen API，没有缩略图抽屉、进度条、单/双页切换按钮、无字模式或基于 `palette1/2/3` 的环境光。任务说明明确把这些列为新一代离线阅读器能力，因此当前交付是部分实现。
- 最小修复：按能力分批补齐，并为每项增加 DOM 行为测试；在未实现前不要把阅读器描述为完整升级。

## 已验证边界

- 6 个新增模板均保持 `formatVersion: 1`、模板循环和无 `<script>`；已有导出器 CSP / JSON metadata 测试通过。
- 灯箱的键盘打开、前后切换、焦点圈定、Escape 恢复焦点和 reduced-motion 测试通过；真实 Chromium 桌面 / 390×844 页面打开无 console error。
- 分镜搜索与筛选的前端测试、LoRA 试生成控件测试、云端渠道配置测试通过。
- 未发现新增模板直接插入未经转义的用户 caption / title；模板中仍没有发现可执行 `<script>`。
