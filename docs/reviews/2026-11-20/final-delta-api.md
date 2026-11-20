# 最终增量复审：渠道目录、SDK 发现与预检

## 固定范围

- 开始 HEAD：`29c4caa`；结束 HEAD：`2b67cba`，包含当时的暂存区和工作区修复。
- 只审查最终增量：`GET /image-channels`、SDK `discover_studio` 的渠道与 LoRA 目录、独立于编译的 `inspection.lora_controls` 发现。
- 生产代码只读。本轮只写本报告；验证使用隔离 AppContext、模拟 HTTP 传输或直接内存探针，没有访问个人数据、浏览器、ComfyUI 或付费接口。

## 发现及修复验证

1. **P2：默认渠道别名报告错误的适配器类型。** 初始 `api/system.py:list_image_channels` 将 `id=""` 固定描述为 `chat_image`，而实际 `settings.image_backend(..., "")` 会解析当前选中的渠道。设置默认为 `openai_images` 后，直接探针得到目录的 `chat_image` 与实际后端的 `openai_images`，外部调用者可能按错误能力或参数 schema 选择渠道。主 agent 在 `api/system.py:73` 解析当前默认，别名现在同步实际 `kind` 和 `model`。相同探针和回归测试通过。

2. **P2：预检新增槽位分析对非法强度抛未处理异常，或返回矛盾状态。** 对合法 API 外形的对象 LoRA 输入 `loras=[{"name":"ink.safetensors","strength":null}]`，新增 `SA.describe` 会进入 `_pinned`→`_num(None)` 并抛 `TypeError`，绕过预检的结构化错误处理。`strength="not-a-number"` 虽返回 `slot_error`（error），却同时返回 `compilable=true`。主 agent 将 `workflow_slots.py:334` 的数值解析统一为有限数校验并抛领域错误，且 `inspection.py:144` 在已有 error issue 时保持 `compilable=false`。空值、非法字符串、无穷值和布尔值四种独立探针现在均返回 `slot_error` 且不抛异常、不报告可编译。

## 已核对边界

- 渠道目录只组装 `id`、`label`、`kind`、`model`、`default`。测试中的地址、API 密钥、Cookie 与 extra_options 没有进入响应。匿名 401，只有 read 令牌 200，单独 write/render/admin 令牌均为 403；该路由经过既有统一 v2 鉴权和操作包装。
- 仅含 read 权限的真实生成 SDK，经现有 TestClient 传输桥接调用 `discover_studio`，成功返回 storyboards、presets、workflows、workflow_loras、templates、image_adapters、channels 七类目录。LoRA 映射按各工作流 ID 查询，渠道使用新标准端点，没有提升到管理权限或泄露设置。
- 缺少 ParameterControlPanel 状态时仍可取得独立 LoRA 控制清单，但 `compilable=false` 且保留 `compile_error`，没有因控制面可见而掩盖执行条件缺失。

## 验证与结论

- `test_image_channel_discovery` 与 `test_inspection_slot_controls` 共 3 项通过，非法强度测试覆盖 4 个子场景。
- 直接探针验证默认别名与实际后端一致，以及四种非法强度均形成结构化预检错误。
- SDK read 权限目录探针通过；`python clients/python/generate.py --check` 返回 `clients up to date`；负责差异的空白检查通过。

本次最终增量范围没有剩余 P0–P2 发现。没有重跑全项目套件；整体门禁与真实环境验收记录由主 agent 另行整合。
