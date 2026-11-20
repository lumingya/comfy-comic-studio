# 后端独立复审：稳定键、任务冻结与云端 recipe

## 范围与方法

- 复审开始 HEAD：`a5d180a`；结束时 HEAD：`89e54ae`。包含当前暂存区和工作区中的整合修复。
- 先读 `final-backend-adversarial.md` 和对应源码，再独立检查三项修复：角色/风格 LoRA 的稳定身份、全部冻结配置的任务覆盖、同目标渠道下每配置独立的云端 recipe。
- 生产文件只读。新增测试仅使用内存工作流、临时 AppContext 和模拟客户端，不访问网络或个人数据。

## Standards

在本次负责范围未发现新的证据化规范违例。LoRA 扩展仍经通用槽位契约分发，云端参数与服务绑定分开保存；没有新增外部平台专属命名。未重复报告格式工具直接检查的问题。

## Spec

独立复查发现两种遗漏路径，均已由主 agent 修复：

1. **P2：混合任务的本地修图遗漏任务覆盖。** `_freeze_task_slots` 原先在 `profile.cloud_shape` 分支把本地候选替换为精修链，丢弃已经捕获的 `profile.edits`。同一混合配置中，任务关闭 `ink.safetensors` 会写入 `final`，但 `edits.inpaint.slot_overrides` 仍为 `{}`，以后执行本地修图会恢复工作流默认 LoRA。新增测试首跑明确失败于该差异。`workshop.py:268` 现把已捕获、已启用的修图阶段加入冻结候选，复测通过。
2. **P2：纯云端任务之后的手动本地成品档未纳入冻结。** `cloud_refine=False` 时，即便配置含已捕获的 `final`，旧分支仍将其排除；但 `pipeline/render.py:_finalize` 允许显式运行该阶段。主 agent 确认任务默认值也应覆盖此专业 API 路径，并让存在的 `profile.final` 优先成为冻结候选；仅没有 final 的自动混合任务才回退到 draft tail。新增独立回归验证纯云端配置可以冻结该阶段的关闭状态，不再拒绝或丢失任务覆盖。

原三项修复在当前源码与测试中仍成立：

- `pipeline/render.py:181` 将角色/风格 LoRA 身份映射到 `reference:` SHA 命名空间；与固定项同名的两个不同追加项分别保留，独立关闭时不影响其他项，CLIP 原值和原工作流保持不变。
- `_freeze_task_slots` 遍历全部冻结配置，并把结果同步回默认配置；较具体的逐幕覆盖仍在编译时最后合并。
- `generation.py:104` 保存每配置自身的 recipe。`render_edits.py:326`、`assembly.py:136` 和 `creation_kits/service.py:95` 优先读取该 recipe；两份配置共用目标渠道时仍分别得到自己的 model 与 extra_options。

## 验证与结论

- 新增 `server/tests/test_backend_fresh_recheck.py`：同名不同 key 的角色/风格 LoRA、混合任务本地修图、纯云端手动成品档、同渠道两份 recipe，共 4 项通过。
- 合并运行新 4 项及原 `test_review_backend_regressions.py` 4 项：8 项通过（6.301 秒）。
- 新测试 Ruff check、format check 和差异空白检查通过。

本次负责范围目前没有剩余 P0–P2 发现。未执行真实 ComfyUI 或付费云端出图；本结论不替代全套门禁或对其他项目文件的后续审查。
