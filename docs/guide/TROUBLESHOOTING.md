# 故障排查

[教程中心](../README.md)

| 问题 | 检查与处理 |
| --- | --- |
| 页面打不开 | 确认 Python 3.10+、终端未退出、端口未占用，使用启动日志中的地址 |
| 缺少 mio_api 模块 | 必须复制完整项目（含 mio_api.py 和 mio_credentials.py）；仅替换 server.py 不够 |
| 打开 HTML 后云生成失败 | 云渠道通过同源 Python 转发，使用服务器地址，不要只双击 HTML |
| NovelAI/OpenAI 401 | 检查当前选中的图像密钥、是否已删除、是否与基础 URL 匹配；不是 Mio API Token |
| 图像生成 400 | 核对模型 ID、账户额度、协议、尺寸、quality；NovelAI 宽高需为 64 倍数 |
| Nano Banana 只返回文字 | 该渠道可能不是受支持的图像返回协议；不要把聊天文本当成图片 |
| ComfyUI 找不到模型 | 默认 checkpoint 是占位名，换成安装目录内真实模型 |
| ComfyUI 节点绑定错误 | 确认导入 API JSON，检查正负文本、输出节点和图片输入 |
| 队列没有自动开始 | 检查是否处于暂停，页面重载后也需要显式开始 |
| 改模型后旧任务没变 | 这是快照隔离；删除待执行任务后重新入队 |
| 停止后仍被扣费 | 上游可能已经接单，停止本地等待不等于取消云任务 |
| 外部 API 503 api_disabled | 在服务启动环境设置至少 32 字符的 MIO_API_TOKEN |
| 外部 API 401 | 使用 Authorization: Bearer，同一个服务进程里的 Token |
| 外部 API 429 | 已有外部生成占用执行槽；不要自动重试可能已付费的失败请求 |
| API 403 Origin | 浏览器 Origin 不在 MIO_ORIGINS；命令行客户端一般不发送 Origin |
| 保存显示未连接/冲突 | 检查 Python 进程与日志；先备份，不要直接覆盖 data 或强制写空配置 |
| 图像显示问号 | 尚未生成、服务失败或源文件丢失；查看日志和 data/assets/images |
| 中文下载文件名变成 download | 某些 Chromium 环境行为；内容仍可用，手工改文件名 |

外部 API 返回 `requestId` 方便调用方记录。服务日志不记录请求体和 Bearer Token；请勿自行将密钥放入 URL 查询参数（URL 会进入普通访问日志）。

需要报告 bug 时提供：操作步骤、预期/实际结果、运行环境、无敏感信息的错误码和日志。不要上传整个私人 data 目录或真实密钥。
