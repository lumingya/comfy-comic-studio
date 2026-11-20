# 标准图像渠道扩展

一个可单独安装、停用和卸载的 `cloud_adapter` v1 扩展包。四种渠道共用有界传输、当前凭据绑定与明确的失败分类，不向核心添加厂商分支，也不使用 `mio.internal`。

| 渠道 kind                | 请求与输出                                                                             | 能力                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `compatible_images`      | `POST /images/generations`；有参考图时 `/images/edits`；`data[0].b64_json` 或同源 URL  | 负向词附到提示词，原生尺寸，最多 4 张参考图                          |
| `compatible_chat_images` | `POST /chat/completions`；`message.images[].image_url`、结构化图像内容或 Markdown 图片 | 参考图、提示词中的负向词与尺寸；不虚构原生 seed 支持                 |
| `novel_style_images`     | `POST /ai/generate-image`；直接图片或有界 ZIP                                          | V3/V4 风格参数、原生负向词、64 对齐尺寸与 seed；本包不提供 vibe 编码 |
| `async_images`           | 一次 `POST /jobs`，随后有界 `GET /jobs/{id}`                                           | 原生尺寸、负向词、可选 seed；提交与查询路径可配置                    |

这是针对上述明确线协议的参考实现，**全部验收均为离线 MockTransport，不是官方服务认证或真实付费出图结果**。服务商的额外参数、CDN 或其他协议需要在独立扩展中适配。

## 安装与配置

在「扩展市场 / 已安装」导入本目录，或将本目录打包为 ZIP 后导入；安装后默认停用，审阅内容摘要再启用。四个渠道随启用一起出现，停用后从能力发现中移除。不要把扩展复制进核心 Python 目录。

在图像服务设置中添加相应 kind，明确填写 `base_url`、`model` 和服务 API 密钥。基础地址保留服务前缀，例如兼容协议的 `https://provider.example/v1`；扩展会在后面追加 `/images/generations`。不推测默认域名或默认模型。

```json
{
  "id": "studio-images",
  "kind": "compatible_images",
  "base_url": "https://provider.invalid/v1",
  "model": "your-image-model",
  "extra_options": {
    "min_interval": 0.5,
    "max_result_bytes": 16777216,
    "response_format": "b64_json"
  }
}
```

示例 `.invalid` 地址不会产生真实请求。密钥只填写到标准 `api_key` 字段，不放进提示词、URL 或 `extra_options`。当前 v1 元数据没有 `credential_fields`，本包不创造宿主不会处理的凭据约定。普通参数由宿主冻结，执行时使用当前连接的密钥；成功诊断仅返回已知生成参数，不返回 Authorization、下载 URL 或原始上游错误。

## 普通扩展参数

所有渠道支持 `min_interval`（默认 0.5 秒，0–60）和 `max_result_bytes`（默认 16 MiB，1 KiB–32 MiB）。同一次扩展激活内，按配置源和密钥摘要共享发起速率；账本最多 256 项，不记录原始密钥。

- Images：可选 `response_format: "b64_json" | "url"`、短字符串 `style`。`quality`、`size` 使用标准渠道字段。
- Chat：可选 `modalities: ["text", "image"]`，只在服务明确要求时填写。
- NovelAI 风格：可选整数 `seed`，默认固定为 0；本次请求显式 seed 优先。宽高必须为 64 的倍数，不静默改变构图。
- 异步：`submit_path` 默认 `/jobs`，`poll_path` 默认 `/jobs/{id}`；路径不得携带域名、查询串或目录回退。`max_polls` 默认 60、最多 200；`poll_interval` 默认 1 秒、0.01–30 秒。

异步协议约定：提交返回 `{"id":"task_123","status":"queued"}`；查询状态为 `pending`、`queued`、`running`、`processing`、`completed`、`succeeded`、`failed` 或 `cancelled`。成功示例：

```json
{ "status": "completed", "image": { "b64_json": "BASE64_IMAGE_BYTES" } }
```

也可将 `image` 换成 `result`，图像对象可使用 `url`。任务 ID 只接受短字母数字、下划线和连字符，不允许服务端借 ID 改写查询路径。

## 重试、取消与下载边界

**无论调用方传多少次 retries，每次调用最多一次收费生成 POST。** POST 读超时、断流、408、409、425、5xx、不可解析的成功响应或重定向都保留 `sent=True`；宿主据此等待核对，不自动重新出图。明确连接失败或非模糊 4xx 拒绝标为未发送成功；429 单独保留状态并登记有界 Retry-After 冷却，也不在适配器内重复 POST。错误文本从不复制上游响应体、请求 URL 或异常字符串。

已提交任务只重试安全 GET：轮询受次数与总截止时间共同限制，下载最多 3 次；429 / 5xx / GET 传输失败不触发新提交。Retry-After 支持秒数与 HTTP 日期，最多等待 30 秒，并继续受总截止时间限制。HTTP 单次读写也使用剩余时间。

适配器的 `cancel()` 与扩展服务的 `close()` 可打断本地等待、后续轮询及分块读取检查。**cloud_adapter v1 没有逐任务取消回调**：核心任务取消不能主动关闭已在进行的 HTTP 请求，本包也不假定远端存在删除任务接口。取消、超时或退出后，已提交的远端任务可能继续运行，需要在服务端核对；本包不承诺跨进程恢复远端轮询。停用 / 关闭扩展会通知本激活创建的全部适配器停止后续请求。

下载只允许配置 API 的同一 scheme / host / port，拒绝内嵌用户名密码、其他源、文件协议与跳转；即使同源也移除 Authorization 和 Cookie。需要跨域 CDN 的服务请改用内联 base64 或单独适配，不能自动信任上游提供的任意 URL。所有响应有字节上限，图片限制为 PNG/JPEG/WebP、最多 16,777,216 像素，完整解码通过后仍保留原始字节。ZIP 不落盘，创建目录对象前逐条预检真实中央目录，最多 16 成员并限制元数据及总展开体积；不支持 ZIP64、分卷或自解压前缀。拒绝额外 HTTP 压缩编码，避免绕过传输体积限制。

## 开发与离线验证

从仓库根目录运行：

```sh
python tools/check_extension_package.py examples/extensions/standard-image-channels
python -m mio_server.extensions.ctk extension examples/extensions/standard-image-channels
python -m unittest discover -s server/tests -t server -p test_cloud_channel_packages.py -v
```

第二条命令需将 `server/` 加入 `PYTHONPATH`，或从 `server/` 使用 `../examples/extensions/standard-image-channels`。CTK 只做静态包校验；单测另外验证四类线协议、生命周期、快照绑定、故障分类、轮询限额、取消、恶意 URL、体积限制及脱敏。不安装浏览器，不访问外网，不调用收费服务。

契约背景见[扩展 SDK](../../../server/mio_server/extensions/README.md)。
