# AI 辅助

在「扩展」开启 **AI 辅助**，即可开始聊天。扩展默认关闭；关闭后不影响 ComfyUI 或云端生图。

本目录是完整的独立扩展包：`main.py` 注册入口，`core/` 包含后端，`page/dist/` 包含独立页面，`tests/` 包含测试。可以直接导入本文件夹，或把目录打包为 ZIP 后导入其它 Mio 工作室。无需将文件复制到主程序源码。开发页面时，在 `page/` 中运行 `npm ci` 和 `npm run build`。

聊天右上角的设置集中管理渠道、权限与显示方式。可选择悬浮窗，或将入口放到左侧菜单。两种显示方式使用同一份对话记录。

## 模型与对话

- 支持多个 OpenAI 兼容、DeepSeek、Gemini 渠道；填写地址与密钥后可以获取模型，也可以直接填写模型 ID。
- 选择渠道后发送消息。支持新建、重命名、删除和导出对话，以及粘贴、拖放或选择图片。
- 配置、对话和图片保存在运行数据目录的 `extensions_data/ai-assist/` 下，与扩展代码分开；具体路径可以在 AI 辅助的显示设置中查看。卸载时默认保留数据，也可选择一并删除。
- 「停止」阻止后续回答和工具操作。已经提交到上游的模型请求或生成任务不能假装撤回；其结果可能仍需在任务记录中确认。
- 网络中断后先读取原对话状态，发送请求使用稳定的请求标识去重，不自动重复生成。

## 操作工作室

AI 通过项目 OpenAPI 目录查找操作、读取参数，并调用同一个 HTTP 接口。原有的数据校验、任务处理和扩展包装器仍然生效。

权限可按读取、编辑、生成、管理分类开关，也可搜索具体操作设置例外。默认允许读取；修改操作可以先在对话里确认。更新、扩展市场、扩展清单、备份目录等只读操作可按权限开放；普通管理与内容写入仍受管理权限和操作开关控制。外部 API 令牌的权限始终是上限，聊天不能借用本机权限绕过令牌限制。

AI 不能更改自身设置或权限，读取或修改 API 令牌，改写主配置或任意扩展设置，也不能安装、启用可执行扩展、修改市场源、下载或切换版本、恢复备份，或创建和修改会产生签名密钥的 webhook。普通扩展停用/卸载、扩展市场与更新目录、发布说明、备份列表和已遮蔽的主配置可按操作开关开放。工具结果中的服务密钥会被遮蔽，网页文字、作品内容和工具结果都不作为新的权限指令。

以下敏感操作由用户直接执行，具体实现见 `core/operations.py` 的 `HUMAN_OPERATIONS` 和 `restriction()`；其它操作按授权判断，不按整个功能分类封禁：

| 操作 | 保留人工操作的原因 |
|---|---|
| `/tokens` 及其子路径；`/extensions/{id}/settings` | 令牌与没有固定密钥字段规范的扩展配置 |
| `PATCH /settings`、`POST /settings/models` | 主配置和服务凭据入口 |
| `POST /extensions`、`POST /extensions/folder`、`POST /extensions/{id}/enable` | 安装与执行新代码 |
| `PUT /extension-market/source`、`POST /extension-market/{id}/install` | 更改代码来源与安装扩展 |
| `POST /update/download`、`POST /update/install` | 暂存可执行程序和切换版本 |
| `POST /backups/restore-plans`、`POST /backups/restore-plans/{id}/apply` | 恢复包含权限、凭据或扩展的工作区 |
| `POST /webhooks`、`PATCH /webhooks/{id}` | 创建或轮换签名密钥 |
| 本扩展的 `/settings`、`/models`、对话 `/approval`，以及停用/卸载自己 | 防止自改权限、自行批准或中断权限校验 |

## 开放接口

本机入口为 `/api/ext/ai-assist`，开放入口为 `/api/v2/ext/ai-assist`。二者使用同一实现，启用后立即挂载，关闭后立即移除。对话数据仍保留，重新启用即可读取。

| 路径 | 用途 |
|---|---|
| `GET /status` | 扩展开关状态、显示方式 |
| `GET /settings`、`PUT /settings` | 渠道、默认模型、权限、显示方式；读取时遮蔽密钥 |
| `POST /models` | 使用渠道草稿获取模型目录 |
| `GET /tools` | 可发现的操作、权限与不可授权原因 |
| `GET /conversations`、`POST /conversations` | 对话目录、新建对话 |
| `GET/PATCH/DELETE /conversations/{id}` | 读取、重命名、删除 |
| `POST /conversations/{id}/messages` | 发送消息，必须提供 `idempotency_key` |
| `GET /conversations/{id}/requests/{key}` | 查询幂等请求回执；未找到时可用原 key 安全重试 |
| `POST /conversations/{id}/stop` | 停止后续处理 |
| `POST /conversations/{id}/approval` | 允许或拒绝待确认的工具调用 |
| `POST /attachments`、`GET /attachments/{id}` | 图片上传与读取 |

工具调用采用「查找 → 查看参数 → 调用」三个函数，不将全部接口一次性塞入模型上下文。新增项目接口和已启用扩展的接口由目录发现；扩展代码的调用需要明确授权具体操作。
