# 3.1.0-dev.3 · 11 项可靠性验收

日期：2026-09-16。测试只使用本地受控服务与隔离数据目录，未调用付费生成服务。

## 验收覆盖

| 项目 | 验证内容 | 实现与测试 |
| --- | --- | --- |
| 台词 ID | 反转、删除、显式空台词；拒绝重复 ID | `state.js`、`creation.js`、`tests/review.mjs` |
| 编辑焦点 | 同一 textarea/input 实例、选择区、合成 CompositionEvent；插入后台提示不吞编辑容器；主动切幕不残留旧值 | `dom-updates.js`、`assembly-workshop.js`、浏览器 20 项 |
| 物理取消 | 真实本地 HTTP 端点收到所属 prompt 的取消；不请求全局 interrupt；阻塞读取在短时间退出；回执和 ID 跨最终提交保留 | `providers/comfyui.py`、`comfy_cancel.py`、`transport.py`、可靠性测试 |
| 429 | Retry-After 秒/日期、指数退避、取消等待、连续故障计数不增加；history/view 限流仍只提交一次 prompt | `reliability.py`、两套调度通路、可靠性测试 |
| 动态提示 | 后创建先打开 / 先创建后打开的 dialog 次序；图片工作台错误提示实际可见 | 浏览器与图片工作台截图 |
| 图片编辑 | 松开鼠标前画布变化；原生双击、竖排、独立尾柄、选择保留、真实后端保存 | `ui-image-studio.js`、`mio_pictures.py`、浏览器 |
| 缩略图与媒体 | HTTP WebP、胶片条 URL、缓存复用及全局淘汰、原图不被清理；256 KiB 有界读取、SHA-256、硬链接；不相信文件名冒充摘要 | `mio_media.py`、浏览器、可靠性测试 |
| 错误 | CUDA OOM、模型/节点缺失和限流分类；密钥去除；列表不携带原始错误正文，诊断接口可读取脱敏记录 | `reliability.py`、`production/store.py`、可靠性测试 |
| 大导出 | 27 × 5 MiB（135 MiB）资源 ZIP，CRC 与逐字节原图核对；PDF 对象/xref；浏览器真实 ZIP/PDF 下载 | `mio_export.py`、可靠性测试、浏览器 |
| 重启 | 安全 ready 批次保留并暂停；不确定在途项不自动重发；从未提交的幕不要求逐个风险恢复 | 生产队列与原生运行时测试 |
| 职责分离 | 普通调度类、显式服务对象、HTTP 路由与媒体/代理分层；全部 Python 和既有 UI 回归 | 完整测试入口 |

PDF 还使用独立的 pypdf 解析器进行了一次额外校验：2 页、2 个可读取嵌入图片均通过。pypdf 不属于运行时依赖。

## 可复现命令

```bash
python -m pip install -r packaging/requirements.txt
npm ci
npx playwright install chromium
npm run build
npm run test:current
python tools/package_project.py --output ../mio-packages
```

主测试矩阵：Python 396 项（4 项环境相关跳过）、前端契约 56 项、装配 39 项、架构 37 项、阅读 26 项、展示 42 项、图片 30 项、专项浏览器 20 项。可靠性专项 15 项包含在 Python 总数中，不重复累计。

完整结果与交付包复验以 [TEST_RESULTS.txt](TEST_RESULTS.txt) 为准。

## 图片证据

[图片工作台：竖排、气泡尾端与动态错误提示](acceptance-review/image-studio.png)

[真实单册导出入口](acceptance-review/export.png)

## 限制与安全取舍

1. ComfyUI 在线实现参考：[server.py](https://github.com/comfyanonymous/ComfyUI/blob/master/server.py)。使用原子按任务取消入口，避免先检查队列再全局 interrupt 的竞态。旧服务端或任务 ID 未收到时明确反馈未确认，宁可要求核对也不误停共享实例。未在真 GPU 上测量释放时延或模型缓存占用。
2. CJK 输入法测试是合成 CompositionEvent 加真实控件身份验证，不是操作系统真实输入法键盘自动化。
3. 浏览器验收使用 Chromium；Windows 启动器只做静态格式、分支和打包一致性验证，没有 Windows 实机或 EXE 构建。
4. ZIP 不承担自定义模板脚本复制；PDF 为逐页图片，SVG/缺页采用明确的 ZIP 降级路径，不默默漏页。下载由浏览器接管；准备或传输中断不会在二进制文件尾部混入 JSON。
5. 不提供旧存档迁移承诺。原图/不可变资产由程序采用新文件写入策略维护，不应在文件系统中原位篡改硬链接资产。
