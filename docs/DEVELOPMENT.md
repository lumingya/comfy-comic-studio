# 开发与扩展 / Development

[教程中心](README.md)

## 环境与命令

Python 3.10+ 运行标准库后端；Node.js 18+ 用于前端构建、lint 和测试。

```bash
npm ci
npx playwright install chromium
npm run build
npm test
```

Linux 若缺浏览器系统库，可在合适权限环境执行 `npx playwright install --with-deps chromium`。不要手改生成的 index.html 再运行 bundle：它会由模块与 shell 重新生成。

## 模块图

```text
js/state.js                    state normalization, legacy migration
js/sync.js                     native configuration and file synchronization
js/engine.js                   ComfyUI mapping + provider snapshot/dispatch
js/creation.js                 storyboards, plans, FIFO execution, refinement
js/ui.js                       views, reader, dialogs
js/workspace.js                 workflow library, scene overrides, queue composer
js/organize.js                  task order, album order and batch actions
js/app.js                      initialization and compatibility installers
server.py                      local storage, private API, provider transports
mio_api.py                     opt-in /api/v1 contract, auth, DTOs, OpenAPI
mio_credentials.py             local endpoint-bound credential store (not encrypted)
mio_docs.py                    UTF-8 Markdown reader and offline HTML generation
docs/reader-template.html      self-contained reader template
tools/build_docs.py            builds HTML siblings from maintained Markdown
examples/mio_client.py          stdlib integration example
```

运行时 JS 顺序见 `js/build.js`。部分安装器通过包装现有函数兼容旧架构，因此要检查调用顺序与重复包装，不应只添加一个同名声明。`js/shell.js` 提供 HTML 外壳，`styles.css` 是样式源。

`ComfyComic` 内部命名空间与序列化标识保留；`Mio` 是兼容别名。内部对象不是公共 API。不要为了品牌替换存储键或重写用户原始内容。

## 添加一种图像协议

1. 定义渠道配置及能力：是否需要工作流、支持什么尺寸/参考图、哪些参数有意义。
2. 在 `ensureImageProviders` 中提供真实默认地址/模型配置，不提供伪造凭证。
3. 保持统一生成输入：已解析提示词、负向提示词、帧参数、参考图与冻结配置。
4. 在 `generate_provider_image` 或独立适配模块中实现协议转换；禁止返回模拟成功；明确拒绝不支持的能力。
5. 处理响应大小、图片格式、超时、凭证、重定向和上游错误，不自动重试付费请求。
6. 若向公共 API 开放，更新 generation_payload、capabilities、OpenAPI schema、教程和契约测试。私有适配器实现不等于公共 API 已支持。
7. 添加无真实付费的请求拦截测试、失败测试、参考图测试与浏览器配置持久化检查。

当前供应商适配在 Python 函数中集中分派，不是动态安装/任意执行第三方插件的平台。未来拆分模块时保持 DTO 和 v1 语义稳定；破坏性改变使用 v2。

## 公共接口演进

- 浏览器状态保存与外部只读 DTO 分离，避免 schema 泄露和全量覆写。
- 外部单图生成同步执行，不加入浏览器队列。若未来新增队列写入，需要先实现服务端持久化任务、并发控制、恢复、幂等性与所有权，不能让两个执行器共享未经协调的数组。
- 更新 schema 后运行：

```bash
python -c "import json,mio_api; from pathlib import Path; Path('docs/api/openapi.json').write_text(json.dumps(mio_api.openapi(),ensure_ascii=False,indent=2)+'\n')"
```

## 测试与发布

- `js/tests.js`：前端契约；`tests/test_storage.py`：数据布局与迁移。
- `tests/test_providers.py`：上游 wire format、ZIP、base64、multipart 与错误。
- `tests/test_external_api.py`：真实本地 HTTP 服务器、鉴权、DTO、错误、并发锁与 OpenAPI 一致性。
- `tests/smoke.mjs`：独立数据目录、Playwright 操作与外部网络拦截。

付费服务只使用替身；不要把协议通过宣称为真实供应商连通。未测试的系统环境和编译步骤必须在发行说明中注明。

Windows 便携包由 `python tools/build_release.py` 构建；需要工具提示的 PyInstaller 环境。`mio.spec` 使用相对入口。必须包含 `mio_api.py`、`mio_credentials.py`、`mio_docs.py`、所有运行模块、vendor、docs 和示例。打包不得携带用户 `data/`、密钥或调试素材。

## English summary

Build from JS modules, not from generated index.html. Runtime is Python stdlib + vanilla browser JS. Public integrations use `mio_api.py`, not the private browser state. Keep legacy storage names for migration; Mio is the user-facing brand. Add adapters with explicit capabilities, immutable execution snapshots, bounded image decoding, sanitized errors and no paid retries. Update the API schema, documentation and transport/browser tests together. Future queue integrations require a durable coordinated worker, not direct writes into browser state. Windows and paid-provider verification must be reported separately from automated fixture tests.


## 文档构建与编码

`npm run build` 包含 `python tools/build_docs.py`；仅改教程时也可运行 `npm run build:docs`。编辑 Markdown 源文件或 `docs/reader-template.html` 后必须重建，不要手改生成的 HTML 副本。教程首页 `docs/index.html` 单独维护，不会被此步骤覆盖。

HTTP 下 `.md` 默认返回 UTF-8 HTML 阅读器，添加 `?raw=1` 返回 UTF-8 原文；`.html` 为预构建离线页。阅读器将文档内部的相对 `.md` 链接转换为 `.html`，以支持离线文件跳转。README 源文件仍保留 Markdown 链接供 GitHub 等平台使用。

前端文档渲染依赖随包提供的 `vendor/marked.min.js`（15.0.12）和 `vendor/purify.min.js`（DOMPurify 3.2.6），不需要 pip 或运行时 CDN。对应许可证同目录分发。原始文档只作为转义 JSON 嵌入，HTML 经过净化后才放入页面；禁止取消这一步。新增覆盖见 `tests/test_docs_server.py` 和 `tests/smoke.mjs` 的文档浏览器检查。
