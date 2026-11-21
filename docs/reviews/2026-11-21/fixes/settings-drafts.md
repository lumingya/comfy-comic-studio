# 设置字段草稿与工作区备份大小修复

对应第三轮 `settings-ai.md` 的 SET-AI-02、SET-AI-05，以及 `lifecycle.md` 中重复记录的备份 UI 大小限制。AI 扩展页面的另两项由其他修复者负责。

## 变更与契约

- General 只保存实际编辑的字段；`llm` 按子字段保存。显示以最新 settings 查询为底，叠加这些本地字段意图。因此编辑 URL 时，后台查询带回的新超时、拦截词及回收天数不会被旧草稿重发。
- Channels 按稳定 ID 保存字段级 `before` / `after`。其他渠道、同渠道未编辑字段以及新增加的渠道都保留最新服务端值；主界面不再提交 `image_channels` 整表。
- `PATCH /settings` 在现有 `store.tx()` 内完成读取、比较、应用、校验与写入。可选 `expected` 比较编辑字段；`image_channel_edits` 中 `before=null` 表示创建、`after=null` 表示删除，普通编辑的 before/after 必须具有相同字段键。删除比较完整公开渠道行。缺失渠道不会被局部更新复活，创建 ID 碰撞返回 409，多字段请求失败不留下部分写入。
- 旧的无 expected 直接 PATCH 保持原有语义，包括明确整表替换、遮蔽密钥原样回传时保留当前真实值。新的前端表单使用上述意图契约。
- 公开设置新增派生 `write_revision`：用进程内随机 HMAC 密钥对私有设置序列化生成，不持久化，不接受回写，不暴露裸密钥或可离线猜测的稳定密钥哈希。比较基线中含 MASK 时，必须附带首轮编辑时捕获的 `expected_revision`；MASK 本身不是凭据版本。后台换密钥后即使两次公开值都是 MASK，也会拒绝旧版本且不写入。未编辑的密钥不参与普通名称／URL PATCH，由服务端保留最新值。
- 该 opaque 版本覆盖整份设置，且服务重启会更换 HMAC 密钥。因此编辑隐秘字段时，无关设置更新也可能保守冲突；重启后的旧隐秘草稿必须取消并重新审阅。不会把刷新后的新版本偷偷附到旧凭据意图上，不宣称仅凭 MASK 能检测真实凭据变化。
- 保存期间字段仍可编辑。成功回调只移除本次提交且未再变化的字段意图；新输入保留，下一次提交比较上一次真实保存值。新渠道在创建期间继续编辑会转为后续字段修改；创建期间删除也保持删除草稿，不会被迟到的创建响应复活。删除既有渠道仍须满足完整行基线与隐秘字段版本，不会用保存响应默默授权删除未观察到的更新。
- 备份前端上限从 2 GiB 改为 12 GiB，中英文 `sizeLimit` 文案一致。新增 2 GiB + 1 与 12 GiB 的 metadata-only File 用例可进入 mock 检验；12 GiB + 1 在选择时拒绝。没有创建或上传 GB 文件。

## 先红后绿的证据

首次定向运行 `SettingsDraft.test.tsx` 与 `BackupsSection.test.tsx`：5 failed / 7 passed，分别命中整块旧草稿、未展示远端新增渠道以及旧备份大小／文案边界。新增后端意图回归首次 4 failed（旧接口不支持意图与比较）。

完成本轮编辑后的集中验证：

- `npm --prefix web run typecheck`：通过。
- `npm --prefix web test -- --run src/pages/settings/SettingsDraft.test.tsx src/pages/settings/Configuration.test.tsx src/pages/settings/ChannelsExtension.test.tsx --reporter=dot`：41 passed。含常规字段刷新、渠道 B 最新模型、新渠道显示、保存中二次编辑与下一轮基线、新渠道保存中编辑／删除、原始 opaque 凭据版本及 409 保留草稿。
- `BackupsSection.test.tsx`：10 passed；`ModelCatalog.test.tsx`：9 passed（首轮修复后的同批运行；之后未修改这两条行为路径）。
- `python -m unittest server.tests.test_review_settings_intent server.tests.test_api_system.SettingsRegistryTests server.tests.test_config_integrity server.tests.test_image_channel_discovery -q`（`PYTHONPATH=server`）：28 passed。含同字段并发一胜一冲突、局部合并、删除／创建碰撞、atomic reject、extra_options 新增远端键、密钥变更、MASK 保留、旧 PATCH 往返及重启 token 失效。
- 受影响 Python 文件的 `ruff check` / `ruff format --check` 通过；10 个受影响前端文件的定向 Prettier 检查通过。

## 范围与复审入口

生产代码：`server/mio_server/api/system.py`、`settings.py`；`web/src/pages/settings/GeneralSection.tsx`、`ChannelsSection.tsx`、新增 `settingsDraft.ts`；`web/src/api/backups.ts`、`types.ts`；`web/src/i18n/workspaceBackups.ts` 两条大小提示。已有测试相应从整表断言改为字段意图断言，新增 `SettingsDraft.test.tsx` 与 `server/tests/test_review_settings_intent.py`。

所有回归使用 TEMP AppContext / mock fetch / metadata-only File；没有访问真实模型或付费 API，没有安装浏览器、没有启动真实用户工作区服务，没有提交或推送。1440 / 390 px、深浅主题的浏览器检查与独立新代理复审交由主控统一执行。本报告不声称跨进程多写者或真实多 GB 归档内容检验已通过。

## 全量前端门禁发现的局部 mock 回归补修

主控全量运行的 901 项中出现 1 failed / 900 passed，以及 2 个 unhandled error。单独复现 `ConfigurationModels.test.tsx` 得到同样的 1 failed / 4 passed / 2 unhandled：密码替换用例失败，图像模型用例虽被计为 passed，保存后的异步渲染也抛出 `base_url.trim()` 的 undefined 错误。

根因是该文件的两处 `PATCH /api/settings` mock 使用 `{...configSettings, ...patch}` 浅合并。字段意图请求现在只包含 `llm.api_key` 或 `llm.image_models`，该 mock 因而把完整 LLM 响应替换成单字段对象，QueryClient 缓存与页面后续渲染也随之缺字段。旧的整块请求曾偶然掩盖此夹具错误。

先补并执行真实 HTTP API 的 `test_image_models_intent_preserves_llm_connection_and_assistant_models`，确认部分 image_models PATCH 的响应和后续 GET 均保留 URL、密钥、text_models、vision_models、timeout 与 pace，私有密钥没有被 MASK 覆盖，1 passed。生产服务和 General 页面均未为此改语义，也未加入默认空串隐藏字段丢失。

仅在 `ConfigurationModels.test.tsx` 建立局部、有状态的 GET/PATCH 夹具，模拟真实的一层 LLM 深合并、公开密钥遮蔽与 opaque 版本递增；密码替换／清除和图像模型用例现在等待保存完成，并确认 URL／密钥输入仍正常显示。保存请求仍断言只含用户编辑字段。

补修验证：`ConfigurationModels.test.tsx` 与 `SettingsDraft.test.tsx` 集中 11 passed，无 unhandled error；新增的实际 API 单项通过；测试文件定向 Prettier、ruff 与格式检查通过。没有重跑全部 901 项或全量后端，没有修改生产代码，没有提交或推送。
