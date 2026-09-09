# 文档编码与首页视觉更新

- 确认 Markdown 源文件为正常 UTF-8，修复服务器文本响应未显式声明 charset 导致的浏览器中文误解码。
- `.md` 老链接现在直接展示排版阅读页；`?raw=1` 保留明确 UTF-8 的源码读取。GET/HEAD 类型和长度一致。
- 所有教程生成自包含 HTML 副本，支持从首页逐篇浏览，也支持 file:// 离线打开；包含目录、代码复制、表格横向滚动和打印样式。
- 重绘教程首页：纸张色、海岸绘本、章节路线、教程搜索、中英文切换和手机布局；首页插画为设计示意，不代表真实模型生成测试。
- 中英文 README 改用几何 SVG 艺术字横幅，不再依赖方块字符与终端字体对齐。
- Markdown 使用随包分发的 Marked 15.0.12 解析、DOMPurify 3.2.6 净化，运行时不访问 CDN；许可随 vendor 保存。
- `npm run build` 同时更新应用与文档，Windows 发布构建包含阅读器模块、模板与离线页面。
- 验证：lint、54 JS、88 Python、90 浏览器检查通过。覆盖中文渲染、源码字节、链接、离线页面、移动端和恶意 HTML 净化。

[教程首页](index.html) · [测试日志](TEST_RESULTS.txt)

---

# 渠道与本地凭证管理更新

- 新增/复制/删除 API 渠道；删除前检查未完成任务，清理该渠道密钥，保留画册。
- size/quality 独立可选开关：关闭或留空不发送，修复 size 留空仍被补默认值的问题。
- 获取 OpenAI 兼容 `/models`；安全下拉、手工输入、失败提示、按渠道隔离缓存。
- 多条本地密钥、手动选择、保存后隐藏原文、刷新保留、删除；支持完全无鉴权。
- 凭证文件单独落盘，0600 权限/原子写入，按渠道和 URL 绑定。任务冻结引用，复制不带密钥，删除不自动切换其他凭证。
- 不再要求每次刷新填写密钥；输入框去掉 new-password 自动填充提示。普通工程导出不含密钥文件，物理 data 备份仍属于敏感资料。
- 本次验证：lint、54 JS、79 Python、78 浏览器检查通过。上游用协议替身，无真实付费生成。

[操作教程](guide/CHANNELS_AND_KEYS.md) · [测试日志](TEST_RESULTS.txt)

---

# Mio 1.0.0 · 通用创作与开放接口

## 品牌与文档

- 项目由 ComfyComic Studio 更名为 Mio（绘页）；界面、标题、导出文案、启动脚本、包元数据和 Windows 发布名称同步更新。
- 新增折页 Logo、内嵌离线图标、中英文 README、艺术字标题、离线教程导航和完整创作/接入/迁移/排障文档。
- 保留旧数据 schema、存储标识与迁移路径；Mio 是新的产品版本，内部数据版本独立。

## 外部 API v1

- 默认关闭；至少 32 字符 MIO_API_TOKEN 启用 Bearer 鉴权。
- 健康检查、能力发现、渠道查询、分页分镜/画册元数据读取、同步 NovelAI/OpenAI 单图生成、本地素材读取。
- 独立 DTO、统一错误码/requestId、请求大小限制、单外部生成并发槽、错误脱敏。
- OpenAPI 3.1 请求与响应 schema，Python 标准库示例，明确版本兼容规则。
- 不开放全量配置覆盖，不伪称支持外部队列、异步整册、Webhook 或外部 ComfyUI 执行。

## 检查中修复的问题

1. 旧 GET 配置读取缺少 Origin 校验，现与写入路径一样拒绝明确不可信 Origin。
2. CORS 预检未允许 Authorization，新外部接口无法被可信浏览器正常调用，已补齐。
3. 供应商图片解析可接受 SVG；现真实生成仅接受 PNG/JPEG/WebP，并验证参考图真实字节，避免 MIME 伪装。
4. Windows spec 固定在开发者 C 盘绝对路径，改为相对路径；新增 API 模块纳入源码与发行资源。
5. Windows 打包器会覆盖新版 README 为旧 ComfyUI-only 简介，改为复制维护中的完整 README，并携带双语教程与示例。
6. 外部接口防止泄露旧快照/供应商密钥，拒绝不支持的调用与未知参数；上游错误释放并发锁。
7. 新文档链接、OpenAPI 文件与运行时 schema 一致性加入回归测试，避免教程入口和规范漂移。

## 验证

`npm run build`、`npm test` 通过：54 JS 契约、61 Python 测试、62 浏览器检查及 lint。详见 [完整记录](TEST_RESULTS.txt)。新增公共接口测试使用真实本地 HTTP 服务；付费供应商使用协议替身。

未执行真实 NovelAI/OpenAI 付费出图、真实用户 GPU 运行或 Windows exe 编译。公网多用户部署、后台作业调度与幂等计费不在本版承诺范围。

## English summary

Mio replaces the ComfyComic Studio brand while keeping legacy data compatibility. This release adds bilingual documentation, an offline handbook, a new logo and a versioned opt-in external API with Bearer auth, DTOs, OpenAPI and a Python example. Fixes include Origin checks on private reads, Authorization preflight, raster-only provider output, portable Windows packaging and preventing release documentation from being overwritten by a stale synopsis. Tests use local HTTP servers and provider fixtures; paid providers and Windows compilation remain unverified.
