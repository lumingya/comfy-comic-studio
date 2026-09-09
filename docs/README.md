# Mio 教程中心

[项目首页](../README.md) · [English handbook](en/GUIDE.md) · [离线导航页](index.html)

## 新用户学习路线

1. [启动与第一本画册](guide/QUICKSTART.md)：环境、界面、配置、先跑一幕、整册、导出。
2. [分镜与创作流程](guide/WORKFLOW.md)：变量优先级、参考图、任务冻结、暂停和补齐。
3. [渠道、模型列表与本地密钥](guide/CHANNELS_AND_KEYS.md)：新增/删除、可选参数、模型发现、多密钥管理。
4. [图像渠道](IMAGE_PROVIDERS.md)：NovelAI、OpenAI Images/Chat、协议限制与费用。
5. [备份与迁移](guide/MIGRATION.md)：改名升级、素材路径、密钥、恢复检查。
6. [故障排查](guide/TROUBLESHOOTING.md)：连接、401、400、缺图与保存。

## 自动化与开发

- [外部 API 完整教程](api/README.md) / [English API guide](en/API.md)
- [OpenAPI 3.1 JSON](api/openapi.json)
- [Python 标准库客户端](../examples/mio_client.py)
- [开发、模块边界与新增渠道](DEVELOPMENT.md)
- [安全与部署](../SECURITY.md)

## 参考与历史

- [数据目录](DATA_LAYOUT.md)
- [ComfyUI 工作流库](WORKFLOW_UPDATE.md)：历史界面称「工作流配置」，当前入口为「图像引擎」。
- [队列、画册批量操作](QUEUE_AND_COLLECTION_UPDATE.md)
- [最新变更](CHANGELOG.md)
- [自动化验证记录](TEST_RESULTS.txt)

旧说明中的 ComfyComic Studio 指 Mio 的前身；存储协议里的旧标识是兼容性保留，不是遗漏的界面品牌。

## 阅读方式

教程首页和生成的 HTML 文档均可离线打开；服务器访问旧 `.md` 链接时也会显示排版阅读页。使用文档底部“查看 Markdown 源码”可读取 UTF-8 原文。若升级后仍看到旧页面，请重启 Python 服务并刷新页面。
