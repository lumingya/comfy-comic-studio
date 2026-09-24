# UX 优化 · T8 / T11 开发日志

> 用途：防止上下文丢失。每完成一个小项就更新本文件并推送。
> 基线：`main @ dff9745`（T1–T7、T9、T10 已合入，见提交 `611bd85`）。

## 任务对照（从 UX_OPTIMIZATION.md 阶段 2 路线图推定）

已完成的提交与路线图条目一一对应：T1 术语（A3）、T2 保存按钮（C5）、T3 装配向导（C2）、
T4 命令面板（C7）、T5 帮助抽屉（C9）、T6 字号与悬停（E1/E3）、T7 设置分层（C10）、
T9 开箱检查与离线练习（C1/B3/B6）、T10 多选可发现（C6）。阶段 2 剩下两项：

| 任务 | 路线图条目 | 内容 |
|---|---|---|
| **T8** | B1/B2/B4/B5，附录 B/C | 重写 5 篇核心教程（QUICKSTART、CHANNELS_AND_KEYS、WORKFLOW、IMAGE_VARIABLES、TROUBLESHOOTING），配图，新增术语表 GLOSSARY 与 FAQ |
| **T11** | A8、D5 | 回收站界面 + 统一的删除撤销 |

## 沙盒规则（用户要求）

- 每完成一个小项立即 `git add` / `commit` / `push origin main`。
- 只跑 `node js/build.js dev`、`node js/tests.js`、`python -m unittest`（定向），不装浏览器，不跑 Playwright。
- 不在工作区保留 PNG 截图；教程配图用手绘 SVG 示意图（`docs/guide/img/*.svg`），体积小、可 diff、随界面改动手工更新。

## T8 计划

- [x] T8a 示意图：`docs/guide/img/` 下的 SVG（流程总览、首页开箱检查、工作流映射、变量解析、任务状态）
- [ ] T8b QUICKSTART：两条路线（离线练习 30 秒 / 真实图像服务 5 分钟），每步写预期结果与失败去向
- [ ] T8c CHANNELS_AND_KEYS：三种图像服务分节（地址示例、密钥、测试连接、费用、常见错误）
- [ ] T8d WORKFLOW：Dev Mode → Export (API) → 导入 → 映射提示词/种子/尺寸/模型/LoRA → 一帧试跑
- [ ] T8e IMAGE_VARIABLES：预设 → 变量关系、覆盖顺序、空值处理、未定义变量规则、图片变量
- [ ] T8f TROUBLESHOOTING：错误码对照表（MIO-CONN-001 …）+ 日志位置 + 诊断信息 + FAQ
- [ ] T8g GLOSSARY（新增）+ 教程中心 / 帮助抽屉 / README 链接；重新生成 HTML；文档测试

## T11 计划

- [ ] T11a 后端 `backend/mio_recycle.py`：列出 `.trash/<id>/receipt.json`、恢复（含画册墓碑清除、目录索引）、永久删除、按天数清理；HTTP 路由；Python 测试
- [ ] T11b 前端回收站：设置 → 数据与备份 → 回收站（列表、恢复、永久删除、清空、保留天数）
- [ ] T11c 统一撤销：画册 / 分镜 / 预设 / 画册集 / 工作流删除后 toast 给出 [撤销]（10 秒），撤销走回收站恢复；文案去掉“不可撤销”
- [ ] T11d 素材回收并入 `.trash`，引用保护（回收站里的文档仍然保住它引用的素材）；文档

## 进度记录

（每完成一项追加一行：日期 · 提交 · 内容）
- 2026-09-24 · T8a · 6 张 SVG 示意图：flow / checklist / comfy-export / workflow-mapping / variables / task-states（节点编号取自随包工作流 #3 #4 #5 #6 #7 #9）
