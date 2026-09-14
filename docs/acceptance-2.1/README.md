# 2.1 验收记录

Linux / Python 3.13 / Playwright Chromium，受控本机接口。新增模板测试没有模型调用。

## 最终结果

`npm test` 退出码 0：JS 契约 55 项；Python 279 项（275 通过、4 项 Windows 专用测试跳过）；17 组 Chromium 回归合计 556 项，其中新模板专项 20 项，包含实际 2.0.0 升级验证。日志原样保留。最终完整 ZIP 解压后的启动、首次命名、新模板注册、原生保存、图片阅读、移动明暗与离线教程检查另有 15 项通过，见 `packaged-runtime.txt`。

## 基线与范围

使用实际交付的 `mio-2.0.0-source.zip`，SHA-256：

`58d5367146aca6fa6e928d9d5d5ce0a7e5037fb781b65f357dd2025319888f80`

在旧 GUI 保存六个内置模板、一份自定义副本、非默认的导出设置和画册版式后，停止旧服务，新版打开同一隔离 v2 工作区；深度比较旧模板和选择，不能仅以模板数量通过来代替非破坏性验证。

新模板专项：[seamless.txt](seamless.txt)。它包含实际读取/选择、排序、CSS 几何测量、正文无文字、保存重载、原图字节与本地 HTML 下载。完整回归结果见本目录的 `full-suite.txt`，最终压缩包验证见 `packaged-runtime.txt`。

## 图像检查

- [真实应用内阅读](reader-desktop.png)
- [桌面离线版](offline-1440-light.png)
- [移动浅色](offline-390-light.png)
- [移动深色](offline-390-dark.png)

已实际查看桌面与移动截图。相邻图片的 `getBoundingClientRect()` 上下边界差小于 0.6 px；无 caption 节点、可见幕标题、编号、重复封面和结尾。

版式保留完整图片及小图原尺寸，**不会裁剪图片内的白边**，也不会删除图片内的对白；只去掉画册模板外置文字区域。

## 可重复运行

```bash
npm ci
npx playwright install --with-deps chromium
MIO_SEAMLESS_BASELINE=/path/to/mio-2.0.0-source.zip npm test
MIO_PACKAGE_EVIDENCE=/tmp/mio-package-check node tests/packaged_runtime.mjs /path/to/mio-2.1.0-source.zip
```

不提供旧 ZIP 时，新增模板自身仍可测试，旧包升级对比会跳过；不要把无基线运行称为实际旧包验证。

没有收费供应商、实体手机、原生 Windows/macOS 或 Safari/Firefox 测试。保留原有 Windows 平台专用测试的跳过状态。
