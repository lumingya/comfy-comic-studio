# Mio 教程中心

[项目首页](../README.md) · [English handbook](en/GUIDE.md) · [离线导航页](index.html)

## 2.3.0 完整画面与明确归属

[自适应阅读、实时本册设定与独立预设库](RELEASE_2_3_0.md) · [验收记录](acceptance-2.3.0/README.md)

## 2.2.3 重命名与连续失败保护

[现有名称编辑、标签用途及连续失败暂停](RELEASE_2_2_3.md) · [验收记录](acceptance-2.2.3/README.md)

## 2.2.2 预设编辑隔离

[切换、独立草稿、应用与另存为](RELEASE_2_2_2.md) · [验收记录](acceptance-2.2.2/README.md)

## 2.2.1 预设管理补齐

[删除预设、复制追加与覆盖的区别](RELEASE_2_2_1.md)

## 2.2 完整内容与分享

[随包 data、升级、HTML/ZIP 分享及独立导入选择](guide/CONTENT_AND_SHARING.md) · [2.2 发布与验收](RELEASE_2_2_0.md)

## 独立文件架构

[保存、复制、分享、按需加载与密钥](guide/FILE_LIBRARY.md) · [English](en/FILE_LIBRARY.md)

[旧数据显式转换到新目录](guide/FILE_LIBRARY_CONVERSION.md) · [2.0 发布与完整验收](RELEASE_2_0_0.md)。主程序只读取 v2；旧原件保留，不自动迁移或覆盖。

## 新用户学习路线

1. [启动与第一本画册](guide/QUICKSTART.md)：环境、界面、配置、先跑一幕、整册、导出。
2. [分镜与创作流程](guide/WORKFLOW.md)：变量优先级、参考图、任务冻结、暂停和补齐。
3. [渠道、模型列表与本地密钥](guide/CHANNELS_AND_KEYS.md)：新增/删除、可选参数、模型发现、多密钥管理。
4. [图像渠道](IMAGE_PROVIDERS.md)：NovelAI、OpenAI Images/Chat、协议限制与费用。
5. [备份与恢复](guide/BACKUP.md)：完整备份、素材路径、密钥与恢复检查。
6. [故障排查](guide/TROUBLESHOOTING.md)：连接、401、400、缺图与保存。

## 画册展示与图片编辑

[1.2.2 分镜导入首幕保护](RELEASE_1_2_2.md)

[1.2.1 余光 · 画面优先的连续阅读](RELEASE_1_2_1.md)

[横竖小图阅读、封面取景、气泡图层、替换/删除/恢复、安全素材扩展](guide/IMAGE_STUDIO.md) · [1.1.1 连续阅读与无重载面板](RELEASE_1_1_1.md)

## 手机端

[手机显示、触控操作、同一 Wi-Fi 连接与安全注意](guide/MOBILE.md) · [English](en/MOBILE.md)

## 图片作为变量

[图片上传、中文变量、顺序编号、快照及备份](guide/IMAGE_VARIABLES.md)

## 服务端生产基座

[关页继续、持久任务、幂等提交、素材索引、安全清理与受控 API](guide/FOUNDATION.md) · [English](en/FOUNDATION.md)

## 自动化与开发

- [外部 API 完整教程](api/README.md) / [English API guide](en/API.md)
- [OpenAPI 3.1 JSON](api/openapi.json)
- [Python 标准库客户端](../examples/mio_client.py)
- [开发、模块边界与新增渠道](DEVELOPMENT.md)
- [安全与部署](../SECURITY.md)

## 参考与历史

- [数据目录](DATA_LAYOUT.md)
- [ComfyUI 工作流库](WORKFLOW_UPDATE.md)：历史界面称「工作流配置」，当前入口为「图像引擎」。
- [队列、并发超时、断点继续与画册批量操作](QUEUE_AND_COLLECTION_UPDATE.md)
- [最新变更](CHANGELOG.md)
- [自动化验证记录](TEST_RESULTS.txt)


## 阅读方式

教程首页和生成的 HTML 文档均可离线打开；服务器访问`.md` 链接时也会显示排版阅读页。使用文档底部“查看 Markdown 源码”可读取 UTF-8 原文。若更新文档后仍看到缓存页面，请重启 Python 服务并刷新页面。

## 展示模板与画册预览

新增：[无缝 · 纯图阅读（2.1）](RELEASE_2_1_0.md)，没有配文区，画面零间距连续排列。

[统一预览与导出、媒体背景、沙盒脚本及性能边界](guide/PRESENTATION.md)

- [配置何时生效：渠道、分镜与请求](guide/CONFIGURATION.md) — 改模型、地址和密钥后哪些任务使用新配置，以及紧凑队列界面的操作。
