# 安全与部署 / Security and deployment

## 中文

Mio 是单用户、本地优先的创作工具，不是多租户 SaaS。

### 两个不同的信任边界

- **浏览器私有服务**：`/api/config` 等接口和 `/images/` 用于本地工作台，不能因为启用了公共 Token 就假设它们也受鉴权保护。
- **外部 API**：`/api/v1/*` 使用 `MIO_API_TOKEN` Bearer 鉴权。Token 至少 32 字符；使用密码学随机值，不要重复使用供应商 API Key。

默认回环监听。即使外部接口有 Token，直接将 `MIO_HOST=0.0.0.0` 并公开端口仍然不安全。远程使用推荐 SSH 隧道，或在可信反向代理上为整个应用启用 HTTPS、身份验证、IP 限制和请求大小限制；只开放公共 API 时代理应拒绝私有路由。

### 环境变量

| 变量 | 用途 | 默认 |
| --- | --- | --- |
| MIO_HOST | 监听地址 | 127.0.0.1 |
| MIO_PORT | 服务端口 | 8777 |
| MIO_ORIGINS | 额外可信浏览器 Origin，逗号分隔 | 无 |
| MIO_API_TOKEN | 公共 API 鉴权，至少 32 字符 | 禁用外部 API |
| NOVELAI_API_KEY | NovelAI 服务端后备密钥 | 无 |
| OPENAI_API_KEY | OpenAI 兼容服务端后备密钥 | 无 |

MIO_HOST/PORT/ORIGINS 优先于同用途的旧 COMFY_COMIC_* 变量。不要在公开部署允许不可信 Origin。旧文件打开兼容路径允许 `Origin: null`；这进一步说明私有服务只能放在可信本地边界内。

### 密钥与数据

图像渠道密钥保存到 `data/secrets/provider-keys.json`，按渠道和基础 URL 绑定；管理接口只返回名称/时间/ID，不返回原文。文件原子写入，POSIX 文件权限 0600。它不是加密保险库，Windows 需妥善设置用户目录 ACL。普通工程导出不包含此文件，但物理 data 目录完整备份会包含它，需作为敏感资料保护。新任务快照只包含凭证引用。服务端环境变量不会出现在公共资源 DTO 中；请求体不写入普通访问日志。但其他模型设置、旧导出、旧工作流或用户自定义内容可能包含密钥，不能承诺全工程自动脱敏。

公共 API Token 的持有者可读取私人分镜、调用付费服务，属于完全可信客户端。允许自定义供应商地址，是有意提供的本地集成功能，不是安全的任意用户网络代理。若使用服务端供应商密钥，客户端指定的目的地必须可信。

生成请求不跟随 Authorization 重定向；返回图片下载不发送供应商密钥。外部 API 错误脱敏，限制请求体/图像大小和外部生成并发。没有完善的多用户审计、每用户配额或幂等账单保护。

### 报告问题

请通过项目维护者实际提供的私密渠道联系，或先提交不含漏洞利用细节的安全联络请求。项目未配置专用安全邮箱，不要向虚构地址发送报告。不要公开真实 Token、私人画册或未经脱敏的配置。

## English

Mio is a single-user local workspace, not a multi-tenant service. The external Bearer token protects **only `/api/v1`**, not private config endpoints, pages or legacy image URLs. Keep loopback binding; use an SSH tunnel or an authenticated HTTPS reverse proxy protecting all routes for remote access. A public-API-only proxy must block private routes.

Use a random token of at least 32 characters. `MIO_HOST`, `MIO_PORT` and `MIO_ORIGINS` override legacy `COMFY_COMIC_*` equivalents. Cloud provider keys are separate. Image keys persist in the local, endpoint-bound `data/secrets/provider-keys.json` store. This is permissions-restricted, not encrypted. Plaintext is not returned by management APIs; normal exports contain references only. Full physical data-directory backups include the secret file and must be protected; old exports and other model settings may still contain secrets. Never publish an unreviewed data directory.

API clients are trusted: they can read creative content and spend provider credits. Custom endpoints are an integration feature, not a safe untrusted-user proxy. Only send server-side provider credentials to trusted destinations. Generation does not follow credential-bearing redirects, enforces size/concurrency limits and does not automatically retry paid calls. Cancellation does not guarantee upstream cancellation.

Report vulnerabilities privately through an actual maintainer contact if available; no dedicated security mailbox is currently configured. Do not disclose real credentials or private artwork in public reports.
