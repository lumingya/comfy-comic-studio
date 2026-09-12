# Mio 通用图像生产基座

## 使用

左侧「图像引擎」管理渠道。内置 ComfyUI、NovelAI 和 OpenAI 兼容配置，不会自动改变已有任务。创作页的队列上方可直接切换生产渠道并进入配置。

- **ComfyUI**：原有 API 工作流、工作流库、节点映射与分镜工作流覆盖不变。
- **NovelAI**：默认 `https://image.novelai.net`，模型 `nai-diffusion-4-5-full`；无需工作流。使用分镜正负提示词、宽高、steps、cfg、seed；宽高须为 64 的倍数，当前适配限制为 64–2048，steps 1–50，cfg 0–10。API 自身的模型、订阅、面积与费用限制仍适用。收到 ZIP 后解析图片并存入本地素材库。
- **OpenAI 兼容**：默认 `https://api.openai.com/v1`，模型 `gpt-image-1`。可修改 URL、模型。size 和 quality 分别有可选开关，关闭或留空均不发送，图生图也一样。支持获取 `/models` 列表以及新增/复制/删除渠道。获取后直接在「模型 ID」输入框输入关键词，下方即时浮现匹配结果（不区分大小写，支持空格分隔的多个关键词）。点击结果会用完整模型 ID 覆盖同一个输入框并保存，收起候选列表；也可用 ↑↓ / Enter 选择，Esc 或点击外部收起。清空输入显示全部缓存模型；没有匹配时仍可手动填写，不会强行替换。点击「复制为新渠道」保存不同供应商配置。默认 Images API，支持 `data[].b64_json` 或 `data[].url`。
- **Nano Banana 等渠道模型**：使用服务商给出的真实模型 ID；根据服务商文档选择 Images API 或 Chat Completions。后者支持 `message.images[].image_url.url`、内容数组中的 image_url，或文本内的 base64 image data URL、标准 Markdown 图片 `![说明](https://...)`、普通 HTTP(S) 图片链接。文本内容块也会提取；显式的结构化图片、Markdown 图片和 Base64 优先，没有显式图片时才扫描普通链接，避免把说明中的网站地址当成图片。多个图片地址按顺序保留并去重。带查询参数、无图片扩展名的下载地址也支持，以下载到的真实图片内容校验，不以文件名或 Content-Type 拒绝。返回的链接需能由 Python 服务直接访问，图片下载不会携带渠道密钥；网页/HTML 或不可用链接会明确报错，仍不接受 SVG 等活动内容。**不支持原生 Gemini generateContent / OpenAI Responses / 异步任务轮询协议**；不是声称所有所谓 OpenAI 兼容渠道完全互通。仅返回文字会明确失败。

图片通过普通的**图片变量**上传、持久保存并在提示词内引用；按首次出现顺序替换成 `@image_N`，对应图片按相同顺序发送。未引用的图片不提交。OpenAI Images 使用 multipart `/images/edits`，Chat 使用有序 `image_url`，NovelAI 使用 `reference_image_multiple`；ComfyUI 使用原有节点的变量映射。模型不兼容会返回错误，不会自动改成无图生成。NovelAI 不自动调用 V4+ Vibe 编码接口，也不保证默认 V4.5 接受原始参考图数组。详见 [图片变量教程](guide/IMAGE_VARIABLES.md)。

OpenAI 不发送 ComfyUI 的采样器、steps、cfg、seed，负向提示词合并为 Avoid 段；size 使用渠道配置。既有精修的显式源图操作仍保留，但不再从角色正面参考图隐式选择生成输入。

## 统一契约与存储

分镜 → 有效变量/提示词 → 冻结执行快照 → 按 provider 分发 → 本地素材 URL → 原有画册、精修、导出。

- 配置：`settings.imageGeneration = {active, profiles}`，通过现有 native config 元数据保存到 `uiConfig.comfyStudio.settings`，无需迁移或清空画册。
- 任务与画册溯源：保留 `_execution`，API 快照包含 `provider/profileId/config/globalNegative`。配置修改不会影响已经排队的任务。没有 provider 的历史快照按 ComfyUI 执行。
- API 任务不依赖工作流预检，不能使用队列里的工作流下拉框改写成另一渠道；如需更换渠道，请删掉待执行任务后重新入队。确认删除会同时移除对应画册及关联队列记录，原始磁盘素材不立即永久删除。
- 所有渠道共用 FIFO、暂停、拖动排序、错误状态、原图保存、画册操作和导出。失败没有示范图兜底；原有美少女示范封面保留。

## 密钥与运行

真实画册通过同源持久任务服务提交，Python 执行供应商协议；原 `POST /api/image/generate` 保留独立同步操作兼容。需要启动 `server.py`，不能只双击独立 HTML 使用云图像渠道。

密钥可按渠道保存多条到本地，刷新/重启后仍可使用；只展示名称与保存时间，可明确选择和删除。鉴权可选“无密钥”“已保存”“服务端环境变量”。无密钥时不发送 Authorization，也不会使用环境后备。存储为权限受限但未加密的 `data/secrets/provider-keys.json`，按渠道和基础 URL 绑定。普通工程导出仅包含 keyId 引用，物理目录备份需保护密钥文件。[完整管理教程](guide/CHANNELS_AND_KEYS.md)

远端 API 地址要求 HTTPS；允许 localhost/127.0.0.1/::1 HTTP 用于本地兼容服务。不跟随带 Authorization 的生成请求重定向。返回的图像 URL 下载不携带 API Key。沿用后端 Origin 限制，**这是本地工作台，不是多租户公共代理，不应无鉴权暴露到互联网**。

每个分镜一次上游请求，无自动付费重试。停止/取消会终止浏览器等待并放弃迟到结果，但不能承诺取消第三方已经接收的生成或费用；服务端可能完成并留下未引用素材。超时后先检查渠道账单再重试。

## 验证

渠道验证包含图片变量专项、HTTP 错误保留及有序多图协议。最新功能/API 回归结果见 [变更记录](CHANGELOG.md) 和 [测试日志](TEST_RESULTS.txt)。

新增覆盖：NovelAI ZIP/V4 请求、OpenAI base64/URL/multipart 编辑、Chat 图片与参考图、缺图/缺密钥/非法尺寸失败；无需工作流预检、冻结渠道隔离、独立渠道复制、配置落盘、密钥正文不写入普通工程配置、移动端布局。

所有付费图像接口采用协议拦截测试，**未使用真实 NovelAI/OpenAI 账户扣费出图，未验证每个第三方渠道，也未编译 Windows exe**。

NovelAI 协议参考：https://github.com/LlmKira/novelai-python 与 https://comfy.icu/node/NovelAIGenerator 。版本和支持能力以供应商接口为准。

## 模块化与高级参数

请求构建已拆分为 providers/ 中的独立协议模块。真实画册走持久任务，支持关页继续、幂等和结果核对；云渠道可在折叠 JSON 区域扩展非保护字段，生成结果保留完整 artifacts。详见 [生产基座](guide/FOUNDATION.md)。
