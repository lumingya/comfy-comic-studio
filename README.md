<div align="center">
  <img src="docs/assets/mio-banner.svg" alt="Mio — Stories in frames" width="900">
  <h1>Mio · 绘页</h1>
  <p><strong>从一个故事，到一本画册。</strong><br>本地优先的分镜编排、多渠道图像生产与画册工作台。</p>
  <p><b>简体中文</b> · <a href="README.en.md">English</a></p>
  <p><a href="#快速开始">快速开始</a> · <a href="docs/README.md">教程中心</a> · <a href="docs/api/README.md">外部 API</a> · <a href="docs/api/openapi.json">OpenAPI</a> · <a href="docs/DEVELOPMENT.md">开发指南</a></p>
</div>



## 定位

Mio 将 **故事分镜 → 角色与画面设定 → 图像渠道 → 执行队列 → 画册** 串成一条创作流程。它不训练模型、不捆绑推理引擎，也不保证跨页角色一致性；它负责把已有图像服务变成可编排、可追溯的创作工具。


## 能力一览

| 职能 | 实际提供的能力 |
| --- | --- |
| 分镜编排 | 多幕提示词、字幕、变量替换、整册设定与单幕覆盖 |
| 角色与预设 | 可复用设定、快速创建空白预设、参考图 |
| 图像生产 | ComfyUI 工作流；NovelAI；OpenAI 兼容 Images / Chat 图像接口 |
| 生产队列 | FIFO、暂停、待执行任务拖动与删除、配置快照、缺页补齐 |
| 画册管理 | 阅读、单页精修、手动排序、右键批量管理与 HTML 导出 |
| 本地存储 | Python 文件落盘、分目录数据、原图保存与备份恢复 |
| 外部接入 | Bearer 鉴权的 `/api/v1`、能力发现、只读资源、单图生成、OpenAPI |
| 可选辅助 | LLM 写作与视觉审校；需要分别配置兼容服务 |

未生成或失败的页面显示问号，不用示范图片伪装成功。美少女示范图片只保留为内置示范画册封面。

## 支持哪些图像服务

| 渠道 | 工作流 | 图像输入 | 范围与限制 |
| --- | --- | --- | --- |
| ComfyUI | 必需，API 格式 | 取决于工作流与映射 | 工作流库、批量导入、分镜工作流覆盖 |
| NovelAI | 不需要 | img2img | V4/V4.5 提示结构与 ZIP 图片；模型 ID 可修改 |
| OpenAI 兼容 Images | 不需要 | `/images/edits` | `b64_json` / URL 响应，尺寸和质量按渠道配置 |
| OpenAI 兼容 Chat | 不需要 | image_url | 必须返回支持格式的图片，而非纯文字 |

**GPT Image、Nano Banana 等是模型或服务名称，不等于一种统一协议。** 请使用供应商实际支持的模型 ID 和协议。当前不包含原生 Gemini、Responses、异步轮询、NovelAI Vibe Transfer 或多角色坐标控制。[详细配置说明](docs/IMAGE_PROVIDERS.md)

## 快速开始

### 1. 启动

需要 **Python 3.10+** 和现代浏览器。日常运行仅依赖 Python 标准库，不需要 Node.js 或 `pip install`。

下载并解压项目，在项目根目录运行：

```bash
python server.py
```

Windows 也可双击 `start.bat`。打开 **http://127.0.0.1:8777**。

### 2. 配置一个真实图像渠道

进入左侧 **图像引擎**，选择 ComfyUI、NovelAI 或 OpenAI 兼容。

- ComfyUI：填写服务地址，导入 API 工作流，确认模型文件与节点映射。
- NovelAI / OpenAI：填写地址、真实模型 ID 和密钥，无需配置工作流。
- API 密钥可按渠道保存多条到本地，刷新后保留；保存后原文不回显，可切换、删除，也可选择无密钥或服务端环境变量。

默认配置不会自动切成模拟生成。云服务需要联网，并可能产生费用。

### 3. 制作第一本画册

在 **创作画册** 选择分镜与角色设定 → 编辑提示词 → 在队列区域选择渠道 → 先加入一幕验证 → 再生成整册 → 回到 **画册集** 阅读或导出。

[完整首次创作教程 →](docs/guide/QUICKSTART.md)

## 教程入口

| 你想做什么 | 从这里开始 |
| --- | --- |
| 从零做出第一本画册 | [安装、首帧、整册与导出](docs/guide/QUICKSTART.md) |
| 管理渠道、获取模型和保存密钥 | [渠道与本地密钥](docs/guide/CHANNELS_AND_KEYS.md) |
| 理解分镜、变量和队列 | [创作工作流](docs/guide/WORKFLOW.md) |
| 接入 NovelAI / GPT Image / 兼容渠道 | [图像渠道详细配置](docs/IMAGE_PROVIDERS.md) |
| 使用 ComfyUI 工作流库与批量操作 | [工作流库](docs/WORKFLOW_UPDATE.md) · [队列与画册](docs/QUEUE_AND_COLLECTION_UPDATE.md) |
| 用外部程序接入 | [API 教程](docs/api/README.md) · [OpenAPI](docs/api/openapi.json) · [Python 客户端](examples/mio_client.py) |
| 备份、恢复、移动作品 | [备份与恢复](docs/guide/BACKUP.md) · [数据布局](docs/DATA_LAYOUT.md) |
| 排查问题、安全部署 | [常见问题](docs/guide/TROUBLESHOOTING.md) · [安全边界](SECURITY.md) |
| 修改源码、增加适配器 | [开发与扩展指南](docs/DEVELOPMENT.md) |
| English tutorials | [English handbook](docs/en/GUIDE.md) · [Integration API](docs/en/API.md) |

也可打开全新 [教程首页](docs/index.html)：支持搜索、中英文切换与逐篇离线阅读。`.md` 网址会自动展示阅读页；需要源码时添加 `?raw=1`。

## 外部程序接入

首版公共 API 与浏览器私有接口分离；默认禁用。使用至少 32 字符的随机 Token 启用：

```bash
# macOS / Linux；Windows PowerShell 用 $env:MIO_API_TOKEN = "..."
export MIO_API_TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
python server.py
```

另一个终端使用同一 Token 调用：

```bash
curl -H "Authorization: Bearer $MIO_API_TOKEN" http://127.0.0.1:8777/api/v1/capabilities
```

已提供只读分镜/画册元数据、渠道查询、NovelAI/OpenAI 单图生成与本地素材读取。**没有外部队列写入、整册后台任务、Webhook 或外部 ComfyUI 调度**；能力接口会明确返回这些限制。不要直接写内部 `/api/config` 来模拟公共接口。[接口边界与示例 →](docs/api/README.md)

## 数据、安全与费用

- 配置和生成素材默认存于本地 `data/`；调用云模型时，提示词、参考图会发往所选供应商，并非“全部离线”。
- 图像渠道密钥不进入新任务快照；其他服务配置或导出可能含敏感值，分享前务必检查。
- 默认只监听回环地址。`MIO_API_TOKEN` **只保护 `/api/v1`**，不把整个本地应用变成安全的公网服务。
- 已提交的云任务可能无法取消；停止本地等待不等于退款。没有自动付费重试。
- 备份整个工程数据和素材，不要只复制含 `/images/` 引用的 JSON。

环境变量及可信部署方式见 [安全说明](SECURITY.md)。

## 开发与验证

```bash
npm ci
npm run build
npm test
```

Node.js 18+ 仅用于构建和测试。浏览器测试需要 Playwright Chromium：`npx playwright install chromium`；Linux 可能还需安装系统依赖。构建后的 `index.html` 与教程 HTML 副本随包提供；`npm run build` 会同时更新应用与文档。

测试覆盖前端契约、文件存储、渠道协议、真实 HTTP API 鉴权与错误响应、浏览器操作。记录见 [测试结果](docs/TEST_RESULTS.txt) 与 [变更说明](docs/CHANGELOG.md)。真实付费供应商出图及 Windows exe 编译未在本环境验证。

## 许可

[MIT License](LICENSE)
