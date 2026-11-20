# 第三阶段相邻文件审查：生成快照与执行路径

范围：排除 `git diff 0c948c5 --name-only` 已改文件后，检查 `generation.py`、云端 / Comfy 执行规划、任务快照、重跑 / 精修和相关测试。只读审查，未修改生产代码或 `data/`。

## 发现

### [P1] 云端任务快照丢失扩展 `extra_options`

- 位置：`server/mio_server/generation.py:88-103` 的 `capture_channels`；`server/mio_server/pipeline/render_edits.py:27-53` 的 `_cloud_request`。
- 触发：创建使用 `cloud_channel_id` 的任务，渠道属于扩展 `cloud_adapter`，并配置了 `ImageChannel.extra_options`。装配快照时 `capture_channels` 只保存 `OPTION_KEYS`，没有保存 `extra_options`；渲染时 `_cloud_request` 又用 `snapshot.channels[channel_id]["options"]` 覆盖冻结请求的 options。
- 影响：扩展渠道在正常任务、重跑或混合精修中收不到已经配置的专属参数；调用方可能看到设置中参数已保存，但真正发送请求时被静默丢弃。新增加的 `extra_options` 能力因此只对直接试生成 / 未经过任务快照的路径有效，违反“任务冻结普通配置选项并保持重试一致”的契约。
- 最小修复：在 `capture_channels` 中保存经 `cloud_request._without_secrets` 处理的 `extra_options`，并在 `_cloud_request` 合并快照选项时保留它；秘密仍从当前配置按 `bind_request` 规则恢复。增加“装配 cloud channel → plan/render request → 扩展 extra_options 保留且无秘密快照”的离线测试。

## 已检查未发现问题

- `RenderService._chain` 的默认参数兼容了云端混合精修调用；本地草稿、成品档和云端精修的 `slot_overrides` 调用点均有默认 / 逐幕参数传递。
- `generation.freeze` 深拷贝 profile/workflow 与标准云端选项；队列任务的幂等键、任务快照和 render job 的 uncertain/retry 路径由已有测试覆盖。
- `assembly.build_snapshot` 深拷贝分镜、预设和画布；克隆与重装配不会回写源分镜。
- `workflow_slots` 的新增稳定键与按组覆盖在旧 shared fixture / v3 fixture 中保持兼容；完整后端套件最终通过 1131 项、跳过 1 项。

## 边界

任务书要求的一站式任务编排、deliverables 直取和通用 `workflow_slot_adapter` 注册契约仍记录为规格未完成项；本报告只记录相邻未改代码中可具体触发的数据丢失问题。
