# 第一轮后端对抗审查

范围：`0c948c5...HEAD` 的后端 API、扩展适配器、云端请求冻结、工作流 LoRA 与相关测试；同时核对了 HEAD 后本地 LoRA 部分覆写归一化修订。未改生产代码，未触碰 `data/`。

## 发现

### P1 — `auth` 字段可进入持久化云端请求快照

- 位置：`server/mio_server/pipeline/providers.py:39-44`、`server/mio_server/pipeline/cloud_request.py:16-20,36-45`
- 触发：扩展把 token 直接放在 `ImageChannel.extra_options` 的裸字段 `{ "auth": "…" }`，而非 `auth` 下的 `token` 子字段。
- 影响：设置响应的 provider 脱敏规则会遮蔽该值，但请求冻结使用的 cloud_request 规则不把裸 `auth` 视为敏感键；已复现 `snapshot(...)["effective"]["options"] == {"auth": "snapshot-leak"}`。该快照随任务/结果供读取接口返回，可让有 `read` 权限的 API 消费方得到渠道凭据。
- 最小修复：共用同一敏感键判定器，确保 `auth` 在设置、冻结快照和适配器回报快照中一致处理；增加裸 `auth` 字符串的快照脱敏回归。

### P2 — 列表中嵌套的扩展凭据不会在执行时恢复

- 位置：`server/mio_server/pipeline/cloud_request.py:68-81`
- 触发：扩展使用合法 JSON 结构保存非敏感列表字段中的凭据，例如 `extra_options = {"accounts": [{"token": "…"}]}`。
- 影响：`_without_secrets` 会在冻结时移除列表条目的 `token`；`_merge_secrets` 仅递归字典子项，不递归普通字段中的列表，因此执行时适配器收不到当前 token，渠道配置无法正常工作。32 KiB JSON 契约允许这种结构。
- 最小修复：合并遍历每个非敏感子值时递归字典和列表；添加 freeze → bind 测试覆盖“对象里的列表里的凭据”，并确认公开快照仍不含明文。

## 已检查且未发现阻断问题的边界

- 新工作流查询、分镜/预设资源 CRUD 的 `read` / `write` scope；新 CRUD 的隔离性、旧分镜改写 revision 冲突和保留已有 take 的检查。
- LoRA 按工作流组及稳定 LoRA key 的 default → stage → panel 合并；原 workflow 深拷贝保护、旧 shared slot fixture 兼容、无效 group/key 拒绝。
- 工作流试生成的冻结参数与 render scope 测试；云端能力发现 API 的 read scope 和扩展注册元数据校验。

审查过程中确认后端完整套件最终通过 1131 项、跳过 1 项；此轮两项安全 / 凭据场景未被现有测试覆盖。
