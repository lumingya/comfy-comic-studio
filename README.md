<div align="center">
  <img src="docs/assets/mio-banner.svg" alt="Mio · 绘页" width="900">
  <h1>Mio · 绘页</h1>
  <p>从一个故事，到一本画册。</p>
</div>

Mio 是用于分镜创作、图像生成、画册阅读与编辑的本地工作室，支持 ComfyUI、NovelAI 和 OpenAI 兼容图像服务。

[教程中心](docs/index.html) · [快速开始](docs/guide/QUICKSTART.md) · [English](docs/README.en.md)

## 启动

需要 Python 3.10+、Pillow 11.3–12.x 和现代浏览器。可执行变量另需 Node.js 20+，Git 扩展安装另需 Git。

在项目根目录运行：

```bash
python -m pip install -r packaging/requirements.txt
python server.py
```

打开 **http://127.0.0.1:8777**。Windows 可双击 `start.bat`；Linux/macOS 可运行 `sh start.sh`。

工作区默认位于 `data/`，也可通过 `MIO_DATA_DIR` 指定目录。更换程序前备份工作区，保留个人数据。

## 创作流程

1. 从首页打开「工作流与 API 配置」，配置图像渠道。
2. 在「创作工坊 → 分镜」填写画面提示词与台词。
3. 在「预设库」准备角色、服装、画风或图片变量。
4. 使用装配向导或连线画布组合分镜与预设，添加生成任务。
5. 在任务卡点击「开始」，查看逐幕进度。
6. 到画册集阅读、编辑图片或导出作品。

## 阅读与导出

阅读器提供展示模板、气泡与文字编辑，以及 HTML、图片 ZIP、PDF 导出。

[阅读与导出](docs/guide/PRESENTATION.md) · [图片编辑](docs/guide/IMAGE_STUDIO.md) · [备份与恢复](docs/guide/BACKUP.md)

## 扩展与开发

[扩展 SDK](docs/ECOSYSTEM_GUIDE.md) · [样式工坊与主题包](docs/STYLE_STUDIO.md) · [可执行变量](docs/COMPUTED_VARIABLES.md) · [外部 API](docs/api/README.md) · [OpenAPI](docs/api/openapi.json)

```bash
npm ci
npx playwright install chromium
npm run build
npm run test:current
```

[开发指南](docs/DEVELOPMENT.md) · [MIT License](LICENSE)
