# Mio 1.0.0

Mio 是本地优先的分镜编排、多渠道图像生产与画册工作台。

## 创作与管理

- 分镜、角色预设、变量、参考图与单幕参数覆盖。
- ComfyUI 工作流库及批量导入，NovelAI 与 OpenAI 兼容图像渠道。
- FIFO 生成队列、暂停、待执行任务排序与删除、执行快照和缺页补齐。
- 画册阅读、精修、拖动排序、右键批量管理与 HTML 导出。
- 多条本地图像密钥、渠道删除、模型列表获取与手动输入；尺寸、质量可选。

## 分镜精修助手 · 界面优化

- 合并重复的目标信息；目标与会话选择集中在紧凑的上下文栏。
- 留白式对话画布、分镜线稿图标、三张快捷指令卡与居中的书写区。
- 缩小默认输入区，保留拖动调整、展开、附件、修改前确认和停止操作。
- 全屏、浮窗、手机与矮窗口分别适配；切换尺寸不清空草稿。
- 新增独立助手布局与交互测试，运行 `npm run test:assistant`。

## 启动、文档与市场调整

- Windows 启动使用中文 UTF-8 无 BOM、CRLF 脚本：优先 `.venv`、`venv`，再查找 `python`、`py`，结束后暂停。发行生成器逐字节复制脚本。
- 中英文说明集中介绍 Mio 的现有功能；备份恢复独立成章。
- 市场弹窗使用单一滚动区域，取消背景实时模糊，屏幕外卡片按需参与布局与绘制。
- 搜索防抖，仅刷新结果区域，保留输入焦点和导入链接；安装与预览操作继续使用事件委托。
- 界面本地化按 DOM 变化区域合并处理，不再为局部更新扫描整个工作台。作者内容不参与翻译。

## 文档与接口

- UTF-8 中英文 README、离线教程、搜索、目录、代码复制与移动端阅读。
- 默认关闭的 `/api/v1`，Bearer 鉴权、只读资源与同步单图生成。
- OpenAPI、Python 示例、明确的能力与错误响应，不开放全量配置覆盖。

## 验证范围

[完整自动化测试日志](TEST_RESULTS.txt)。市场压力测试可运行 `node tests/market_performance.mjs`；测试使用临时目录，不读取用户数据。

压力测试条件：240 张额外资源卡、500 本画册各 32 幕、Chromium 四倍 CPU 降速、120 帧滚动及 12 次局部文字变化。同机一次前后对比，全文扫描从 12 次降为 0 次，本地化累计耗时从 452.8 ms 降为 2.8 ms，帧间隔 P95 从 58.9 ms 降为 25.7 ms。该结果是合成负载测量，不代表所有设备的实际帧率。

付费供应商使用协议替身。当前环境不提供 Windows CMD，原生启动执行检查由 Windows CI 运行；未在本机验证 Windows 启动或 exe 编译，也未执行付费出图。

## English summary

Mio brings storyboards, image providers, a render queue and illustrated albums into one local-first workspace. This update adds the Chinese Windows launcher, focused product documentation and a lighter marketplace: scoped localization, offscreen card rendering and debounced result-only search. Automated tests use isolated data and provider fixtures; native Windows execution and paid generation remain separately verifiable.
