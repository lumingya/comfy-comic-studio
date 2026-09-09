# Mio 通用图像生产基座

## 使用

左侧「图像引擎」管理渠道。内置 ComfyUI、NovelAI 和 OpenAI 兼容配置；旧项目继续使用 ComfyUI，不自动改变已有任务。创作页的队列上方可直接切换生产渠道并进入配置。

- **ComfyUI**：原有 API 工作流、工作流库、节点映射与分镜工作流覆盖不变。
- **NovelAI**：默认 `https://image.novelai.net`，模型 `nai-diffusion-4-5-full`；无需工作流。使用分镜正负提示词、宽高、steps、cfg、seed；宽高须为 64 的倍数，当前适配限制为 64–2048，steps 1–50，cfg 0–10。API 自身的模型、订阅、面积与费用限制仍适用。收到 ZIP 后解析图片并存入本地素材库。
- **OpenAI 兼容**：默认 `https://api.openai.com/v1`，模型 `gpt-image-1`。可修改 URL、模型。size 和 quality 分别有可选开关，关闭或留空均不发送，图生图也一样。支持获取 `/models` 列表以及新增/复制/删除渠道。点击「复制为新渠道」保存不同供应商配置。默认 Images API，支持 `data[].b64_json` 或 `data[].url`。
- **Nano Banana 等渠道模型**：使用服务商给出的真实模型 ID；根据服务商文档选择 Images API 或 Chat Completions。后者支持 `message.images[].image_url.url`、内容数组中的 image_url，或文本内的 base64 image data URL。**不支持原生 Gemini generateContent / OpenAI Responses / 异步任务轮询协议**；不是声称所有所谓 OpenAI 兼容渠道完全互通。仅返回文字会明确失败。

API 渠道参考图优先使用精修源图，其次角色正面参考图：OpenAI Images 使用 multipart `/images/edits`；Chat 使用多模态 image_url；NovelAI 使用 img2img。接口是否支持参考图以服务商与模型为准；不支持会报错，不会偷偷改成无参考图生成。当前不传局部蒙版、NovelAI 多角色坐标或 Vibe Transfer 专有参数。OpenAI 不发送 ComfyUI 的采样器、steps、cfg、seed，负向提示词合并为提示中的 Avoid 段；size 使用渠道配置而非强制套用任意分镜宽高。

## 统一契约与存储

分镜 → 有效变量/提示词 → 冻结执行快照 → 按 provider 分发 → 本地素材 URL → 原有画册、精修、导出。

- 配置：`settings.imageGeneration = {active, profiles}`，通过现有 native config 元数据保存到 `uiConfig.comfyStudio.settings`，无需迁移或清空画册。
- 任务与画册溯源：保留 `_execution`，API 快照包含 `provider/profileId/config/globalNegative`。配置修改不会影响已经排队的任务。没有 provider 的历史快照按 ComfyUI 执行。
- API 任务不依赖工作流预检，不能使用队列里的工作流下拉框改写成另一渠道；如需更换渠道，请删掉待执行任务后重新入队。删除任务保留画册。
- 所有渠道共用 FIFO、暂停、拖动排序、错误状态、原图保存、画册操作和导出。失败没有示范图兜底；原有美少女示范封面保留。

## 密钥与运行

API 请求通过 Python 同源端点 `POST /api/image/generate` 转发，避免浏览器跨域。需要启动 `server.py`，不能只双击独立 HTML 使用云图像渠道。

密钥可按渠道保存多条到本地，刷新/重启后仍可使用；只展示名称与保存时间，可明确选择和删除。鉴权可选“无密钥”“已保存”“服务端环境变量”。无密钥时不发送 Authorization，也不会使用环境后备。存储为权限受限但未加密的 `data/secrets/provider-keys.json`，按渠道和基础 URL 绑定。普通工程导出仅包含 keyId 引用，物理目录备份需保护密钥文件。[完整管理教程](guide/CHANNELS_AND_KEYS.md)

远端 API 地址要求 HTTPS；允许 localhost/127.0.0.1/::1 HTTP 用于本地兼容服务。不跟随带 Authorization 的生成请求重定向。返回的图像 URL 下载不携带 API Key。沿用后端 Origin 限制，**这是本地工作台，不是多租户公共代理，不应无鉴权暴露到互联网**。

每个分镜一次上游请求，无自动付费重试。停止/取消会终止浏览器等待并放弃迟到结果，但不能承诺取消第三方已经接收的生成或费用；服务端可能完成并留下未引用素材。超时后先检查渠道账单再重试。

## 验证

本阶段渠道适配验证：54 JS、37 Python、60 浏览器检查。最新 Mio 功能/API 回归结果见 [变更记录](CHANGELOG.md) 和 [测试日志](TEST_RESULTS.txt)。

新增覆盖：NovelAI ZIP/V4 请求、OpenAI base64/URL/multipart 编辑、Chat 图片与参考图、缺图/缺密钥/非法尺寸失败；无需工作流预检、冻结渠道隔离、独立渠道复制、配置落盘、密钥不落盘、移动端布局。

所有付费图像接口采用协议拦截测试，**未使用真实 NovelAI/OpenAI 账户扣费出图，未验证每个第三方渠道，也未编译 Windows exe**。

NovelAI 协议参考：https://github.com/LlmKira/novelai-python 与 https://comfy.icu/node/NovelAIGenerator 。版本和支持能力以供应商接口为准。
