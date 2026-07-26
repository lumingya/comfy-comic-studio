# ComfyComic Studio

ComfyComic Studio 是一个本地运行的连环画批量制作工作台。它使用原生 HTML/CSS/JavaScript 提供模板、角色矩阵、剧情、画廊和 ComfyUI 工作流界面，并由 Python 标准库服务负责本地配置与图片持久化。

## 启动

环境要求：Python 3.10 或更高版本。项目本身没有第三方 Python 依赖。

在 Windows 上双击 `start.bat`，或在项目目录运行：

```powershell
python server.py
```

然后访问 <http://127.0.0.1:8777/index.html>。ComfyUI 默认地址为 <http://127.0.0.1:8188>；如浏览器直接连接失败，请为 ComfyUI 启用 CORS。

## 数据位置

- `data/*.json`：模板、工作流、LLM、聊天与界面配置。
- `images/`：从 ComfyUI 持久化的图片。
- `comfy_comic_data.json`：旧版单文件配置，仅用于首次迁移。

这些目录默认被 Git 忽略。升级或大改前建议备份 `data/` 与 `images/`。API Key 会保存在本机配置中，请勿把数据目录提交或分享。

## 主要流程

1. 在“ComfyUI 工作流”中导入 API 格式 JSON，并选择积极提示词与输出节点。
2. 在“连环画模板配置”中维护分镜及 `{character}`、`{style}`、`{outfit}` 等变量。
3. 在“批量角色矩阵”中填写替换值并选择模板。
4. 可先在“LLM 剧情与模板”中生成或调整剧情，再启动批量绘图。
5. 生成结果会进入画廊，可单页重绘或导出自包含 HTML。

## 验证

```powershell
python -m unittest discover -s tests -v
python -m py_compile server.py
node --check app.js
node --check comfy.js
node --check llm.js
npx --yes eslint@8 app.js comfy.js llm.js
npx --yes html-validate index.html
```

本地服务只监听 `127.0.0.1`。静态服务仅公开应用前端文件与 `images/` 中的图片，不会直接公开 `data/`、源码、Git 元数据或旧配置文件。图片代理限制单张图片为 50 MB，并只允许读取项目 `images/` 目录中的本地文件；LLM 请求默认在 120 秒后超时。
