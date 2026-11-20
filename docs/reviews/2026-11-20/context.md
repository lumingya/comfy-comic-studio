# 2026-11-20 对抗性审查共享上下文

## 审查目标

审查本次任务说明驱动的全部代码改动，修复可复现问题，并在修复后安排新的复审。第一轮聚焦本次提交，第二轮检查本次未改动但与新契约相邻的项目文件。

## 固定范围

- 基线：`0c948c5`
- 当前提交：`HEAD`（启动审查时应先运行 `git log -1 --oneline` 确认）
- 差异：`git diff 0c948c5...HEAD`
- 任务说明：`D:\Tencent Files\tx download\ai_studio_code.txt`
- 仓库约定：`AGENTS.md`、`README.md`、`docs/ROADMAP.md`

## 本次已实现主题

- 分镜列表搜索与空白幕 / 含变量筛选
- 离线画册灯箱、焦点恢复和 reduced motion
- 6 套新内置画册模板
- 工作流 LoRA 稳定键、按组覆写、试生成独立开关和权重编辑
- 云端适配器元数据发现、`extra_options` 保存与脱敏
- 工作流 LoRA 查询接口
- 分镜 / 预设独立 CRUD 接口
- 云端适配器配置 UI
- OpenAPI、TypeScript、Python 客户端生成物

## 已知验证结果

- 后端完整套件：1131 项，跳过 1 项，最终通过
- Spike：80 项通过
- Web Vitest：85 文件 / 787 项通过
- Web typecheck、Prettier、生产构建通过
- Ruff check / format、客户端生成一致性、扩展契约一致性通过
- 扩展与主题静态检查通过
- 真实 Chromium：桌面与 390×844 窄屏检查；分镜筛选、阅读室打开、设置页渠道元数据请求无 console error
- 未执行真实 ComfyUI 出图或付费云端出图
- `tools/check_distribution.py` 与 release smoke 因 3 个受保护随包数据文件相对 HEAD 有差异而未通过；严禁用 `--approve-changes` 绕过

## 第一轮审查修复增量

- 请求快照统一识别裸 `auth` 并递归处理列表嵌套凭据；新增冻结 / 重绑定回归测试。
- 公共扩展 schema 不再暴露 `enum`、`const`、默认值、示例和敏感属性；敏感说明中的凭据文本会掩码。
- 云端设置 UI 对 schema 外现存参数改用 JSON 对象编辑，保留 JSON 类型。
- 工作流保存后失效对应 LoRA 查询缓存；扩展启停 / 移除失效图像适配器目录缓存。
- 工作流列表增加轻量 LoRA 摘要；分镜列表改为 offset/limit 轻量摘要分页。
- 相关新复审报告：`recheck-security-cache.md`、`recheck-round2.md`。
- 修复后定向回归：API system 19 项、provider 14 项、API v2 9 项、workflow_slots v3 24 项、legacy slot 4 项、配置 / WorkflowTrial 前端 38 项通过。

## 审查要求

每份报告只写证据化发现：严重度（P0/P1/P2/P3）、文件与行号、触发条件、实际影响、最小修复建议。没有发现时写明检查过的边界。不要修改 `data/`，不要重置他人的改动。修复后更新对应报告并让新的 Agent 复审。

## 复审记录

| 轮次 | 报告 | 状态 |
|---|---|---|
| 1 | `agent-*.md` | 进行中 |
| 2 | `recheck-*.md` | 待第一轮修复后创建 |
| 3 | `adjacent-*.md` | 待第二轮完成后创建 |
