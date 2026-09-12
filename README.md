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
| 角色与预设 | 可复用设定、空白预设、落盘图片变量与有序多图输入 |
| 图像生产 | ComfyUI 工作流；NovelAI；OpenAI 兼容 Images / Chat 图像接口 |
| 生产队列 | 服务端持久任务、关页继续、自定义并发/超时、原任务续生成、幂等提交与未知结果核对 |
| 画册管理 | 阅读、单页精修、手动排序、右键批量管理与 HTML 导出 |
| 本地存储 | 不可变图片、素材索引/引用/完整性检查、安全回收、SQLite 任务与备份 |
| 外部接入 | Bearer 鉴权、素材上传、异步任务/SSE、受控资源写入、OpenAPI |
| 可选辅助 | LLM 写作与视觉审校；需要分别配置兼容服务 |

未生成或失败的页面显示问号，不用示范图片伪装成功。美少女示范图片只保留为内置示范画册封面。

图片直接作为普通变量使用：`参考{人物图片}，{人物名}，背景参考{图片}` 会展开为 `参考@image_1，王明，背景参考@image_2` 并附上对应图片。上传文件落盘，替换不改变已入队快照。[使用教程](docs/guide/IMAGE_VARIABLES.md)

## 支持哪些图像服务

| 渠道 | 工作流 | 图像输入 | 范围与限制 |
| --- | --- | --- | --- |
| ComfyUI | 必需，API 格式 | 取决于工作流与映射 | 工作流库、批量导入、分镜工作流覆盖 |
| NovelAI | 不需要 | 有序参考图数组，模型相关 | V4/V4.5 提示结构与 ZIP 图片；模型 ID 可修改 |
| OpenAI 兼容 Images | 不需要 | `/images/edits` | `b64_json` / URL 响应，尺寸和质量按渠道配置 |
| OpenAI 兼容 Chat | 不需要 | image_url | 必须返回支持格式的图片，而非纯文字 |

**GPT Image、Nano Banana 等是模型或服务名称，不等于一种统一协议。** 请使用供应商实际支持的模型 ID 和协议。当前不包含原生 Gemini、Responses、异步轮询、NovelAI V4+ 自动 Vibe 编码或多角色坐标控制。[详细配置说明](docs/IMAGE_PROVIDERS.md)

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

## 展示与导出

画册默认完整适配图片。可搜索的模板侧栏与阅读、HTML 导出共用工作台；自定义 HTML/CSS 支持本地图片、GIF、视频背景和显式授权的沙盒脚本。[展示模板架构与限制](docs/guide/PRESENTATION.md)。

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

已提供分镜/画册元数据、渠道查询、素材上传与读取、持久整册任务、ComfyUI 调度、SSE 事件和受控资源写入。不提供 Webhook 或整个内部状态的任意覆写。不要直接写内部 `/api/config` 来模拟公共接口。[接口边界与示例 →](docs/api/README.md)

## 数据、安全与费用

- 配置和生成素材默认存于本地 `data/`；调用云模型时，提示词、参考图会发往所选供应商，并非“全部离线”。
- 图像渠道密钥不进入新任务快照；其他服务配置或导出可能含敏感值，分享前务必检查。
- 默认只监听回环地址。`MIO_API_TOKEN` **只保护 `/api/v1`**，不把整个本地应用变成安全的公网服务。
- 已提交的云任务可能无法取消；停止本地等待不等于退款。默认不自动付费重试；可在队列中明确启用有限重试，结果不明仍禁止自动重发。
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


## 通用生产基座

真实画册任务由 Python 服务执行，网页关闭后继续；重新打开会恢复进度和结果。任务快照与每幕结果事务落盘，相同幂等键不会重复执行，无法确认的上游结果明确标记且不自动付费重试。ComfyUI 可通过已保存的 prompt ID 只读核对。

渠道适配器已拆分，云渠道支持折叠的高级 JSON 参数；结果同时保留首图与完整 `artifacts` 列表。素材索引可查引用、缺失和摘要不一致，清理需要预览确认，且只回收到本地目录。并发编辑使用版本校验，不默默覆盖另一客户端的数据。

- [完整使用与验收教程](docs/guide/FOUNDATION.md)
- [任务 API 客户端示例](examples/jobs_client.py)
- [OpenAPI](docs/api/openapi.json)

**边界：**旧同步生成/独立精修接口保留兼容，不具有持久任务的恢复语义；新集成请使用 `/jobs`。LLM 对话未服务化，未实现多租户、任意 Python 插件加载或视频生成。完整备份应停止服务后复制整个 `data/`（含任务数据库与密钥）；不要只复制运行中的 SQLite 主文件。

### 图片响应与模型搜索

Chat 图像渠道支持结构化图片、Base64、Markdown 图片及普通 HTTP(S) 图片链接（包含无扩展名和签名地址）。下载后继续校验实际图片格式。获取模型列表后，直接在模型 ID 输入框搜索，候选结果自动浮现；点击或用 ↑↓ / Enter 选择后，完整 ID 会覆盖同一个输入框并保存。支持手动填写。详见 [图像渠道教程](docs/IMAGE_PROVIDERS.md)。

### 手机端

手机采用底部文字导航、单列编辑与更大的触控控件；模型候选直接点选、队列按钮排序、画册菜单管理、完整图片阅读与导出均可使用。连接电脑时需配置受信任局域网监听及允许来源，不会默认开放公网。详见 [手机访问与触控教程](docs/guide/MOBILE.md)。

### 更直观的操作

首页可直接打开醒目的教程中心。队列检查只报告当前任务范围，不自动新建任务；删除会明确移除任务及对应画册。单幕失败默认不阻止同任务其他分镜；可选仅暂停该任务，或确认启用有限重试。画册多选支持鼠标沿路径滑选、反向取消及 Esc 退出；普通浏览仍可拖动排序。[完整操作说明](docs/QUEUE_AND_COLLECTION_UPDATE.md)。


### 原画册续生成与并行生产

队列页配置**每任务同时请求 1–16 幕**（默认 1）和 **30–7200 秒**等待超时（默认 600）。20 幕任务设为 4，先发 1–4，任意一幕完成就立即补发下一幕，不等待整批。任务默认按可拖动的队列顺序执行；点另一任务的「并行启动此任务」，两任务各 4 路，合计最多 8 路。继续、编辑和停止保留所有已确认图片，包括乱序完成的幕；未知结果不自动重试，人工重发须确认可能重复计费。[设置与操作说明](docs/QUEUE_AND_COLLECTION_UPDATE.md)。


### 更直接的任务控制与诊断

立即停止不再等待图片返回，迟到结果直接丢弃；已确认图片保留。队列显示为什么仍在等待，并可明确释放暂存画册。任务提示词直接在原分镜区修改，发送前读取最新保存值，实际请求输入可追溯；明确内容拒绝不会误当临时 502 反复重试。运行日志读取服务端持久记录。导出面板从已生成图片取样，轻量预览不降低导出原图质量。[操作说明](docs/QUEUE_AND_COLLECTION_UPDATE.md)。

## 直接修改后续分镜

回到原来的「分镜故事」，在「修改范围」选择具体画册版本并编辑，等待 Python 确认保存。服务每次请求前读取该版本最新内容，不需要独立任务编辑入口；正在发送的请求和已完成图片不变。排队中的分镜会直接使用新内容，失败/未知幕仍需原有继续确认。共享模板和工作流结构不被随意替换；关联渠道的模型、地址和参数从下一次请求读取最新保存值。实际请求输入可在服务端任务详情查看。[完整说明](docs/QUEUE_AND_COLLECTION_UPDATE.md)。

## 队列与渠道配置

队列采用紧凑工具栏和任务卡片，原始错误与逐幕记录收进详情。每幕发送前通过渠道 ID 读取最新模型、地址、参数和密钥绑定，卡片显示服务端确认的“下次请求”模型；配置无效时明确阻止派发，不回退旧模型。[完整配置架构与操作说明](docs/guide/CONFIGURATION.md)。

## 本次阅读与队列更新

工作台默认以约 7 KB 的 HTML 引用独立 JS/CSS，按功能维护源文件。自定义模板读取整册，手机翻页按单幕显示；三张样本仅用于导出样张。新安装默认自动重试所有 HTTP 5xx（额外 5 次），所有 4xx 不自动重试，422 标记并跳过。手动重试没有累计上限；未知结果仍需确认。已有安装保留保存过的失败策略，请在队列页核对。逐幕日志可展开实际提示词、模型与参数。详见 [队列说明](docs/QUEUE_AND_COLLECTION_UPDATE.md)。
