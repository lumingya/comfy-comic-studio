# Page notes 示例

把本目录内容打成 ZIP，通过设置页或 `/api/v2/extensions` 安装，再使用列表返回的摘要启用。
重启后新增路由生效；安装和启用都不出图。所有题材和创作内容由调用者决定。

- `GET /api/v2/ext/page-notes/notes/{episode_id}`：带 `read` 令牌返回该话的手工文本摘要。
- `GET /api/v2/episodes/{episode_id}/export?fmt=page-jpeg`：带 `read` 令牌导出已采用图片的合成长图。
- `POST /api/v2/series`：仍使用原来的类型与 `write` 权限。扩展设置里的 `title_prefix` 非空时，给新作品加前缀；默认不改变标题。

这些路径也有本机 `/api` 版本。停用扩展后，摘要路由拒绝调用、导出格式消失、标题恢复核心行为。
`mio.operation` 可以 `await next(...)` 组合处理，也可以直接返回与原接口一致的结果；`next` 最多调用一次。
异常不会自动重试已执行的写操作。`GET /api/v2/operations` 列出操作 ID、参数名称和包装来源；详细类型在 OpenAPI。

示例的操作包装、路由注册与导出契约是稳定扩展面；读取文档用到的 `mio.internal.store` 是不稳定内部接口。
