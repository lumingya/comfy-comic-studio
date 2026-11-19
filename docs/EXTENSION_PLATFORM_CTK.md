# 扩展与主题平台契约及诊断

这些工具是开发者按需调用的只读入口，不增加日常创作页面控件。通过静态检查不等于信任包代码，也不代表真实依赖、脚本或浏览器兼容性已验证。

## 契约事实源

- `server/mio_server/extensions/manifest.py` 定义 Manifest 与声明式贡献。
- `extensions/protocol.py` 复用这些模型，统一面板 HTTP、Panel/Workspace/主题设置 postMessage、生命周期、事件决定和限额。
- 本机与 v2 OpenAPI 的 `MioContract_*` 组件来自同一声明，没有额外可调用业务路由；权限、来源窗口、origin、nonce、摘要和文件系统校验仍由各边界执行。
- `tools/generate_extension_contracts.py` 生成 `web/src/api/extensionProtocol.ts` 的运行常量及 OpenAPI 类型别名，前端宿主与后端注入桥实际使用它们。媒体类型从同一 OpenAPI 响应模型引用。

接口或协议变更后的生成与只读校验：

```powershell
.venv/Scripts/python.exe tools/generate_extension_contracts.py
.venv/Scripts/python.exe clients/python/generate.py
npm --prefix web run gen:api
.venv/Scripts/python.exe tools/generate_extension_contracts.py --check
.venv/Scripts/python.exe clients/python/generate.py --check
```

CI 还会重新生成 TS 并检查工作树差异。Schema 不取代 Pydantic 自定义语义校验，不证明任意 Python 扩展已得到进程隔离。

## 静态合规检查

```powershell
.venv/Scripts/python.exe tools/check_extension_package.py extensions/ai-assist
.venv/Scripts/python.exe tools/check_theme_package.py themes/theme-wallpaper
```

两个命令均接受目录或 ZIP。只读源文件；ZIP 仅在临时目录调用既有权威导入校验，不启用包，不执行包内 main/backup，不安装依赖。报告为 JSON，错误返回退出码 1，警告保留 0。它们检测包结构、声明、媒体、卡片 CSS 过滤等；`valid=true` 不能证明代码可信、无凭据或实际业务可运行。

管理员可调用 `GET /api/v2/extensions/diagnostics`（本机 `/api/extensions/diagnostics`）读取工作区观察结果。它与 CLI 复用同一诊断函数，包含旧来源 fallback/shadow/conflict、无索引媒体、已审阅摘要变化及包问题。仅输出固定错误码、合法所有者 ID、逻辑来源和固定文案，不输出偏好内容、路径原文或异常原文。诊断不搬迁、合并或删除用户文件；并发外部文件变动可能使观察过时。

## 视觉运行诊断

在 DevTools 显式开启并刷新：

```js
sessionStorage.setItem('mio.diagnostics', 'true');
location.reload();
// 读取冻结的只读快照：
window.mioThemeDiagnostics;
```

最多保留 128 条，记录主题 ID、有效摘要、组件、递增会话、固定原因码和时间。覆盖摘要缺失/不符、WebCrypto、取回失败、超限、Worker 错误、超时、限速、样式加载与清理；不记录源码、URL、偏好、凭据或异常原文。关闭开关后，下一次读取或诊断事件会清空历史。此记录不会把主题升级为业务扩展。

## 独立真实浏览器专项

```powershell
npm --prefix web run build
python tools/check_extension_browser.py
```

使用已经安装的 Python Playwright 和系统 Chrome/Edge；也可传 `--browser <可执行文件>`。脚本绝不自动安装浏览器或包，只创建临时工作区与回环服务，结束时关闭自己创建的进程和临时文件，不访问用户运行目录或模型服务。它验证真实鼠标命中底层按钮、标题栏交互、遮挡 CSS 下的逃生键和设置页 CSP；JSON 会单列自身导航观察，不能把 fetch 被拦截写成绝对断网。

本轮在 Chrome 157.0.8103.50 实测：修正设置页 CSP 指令间缺失分号后，内容穿透、标题栏、逃生键以及 fetch/图片/顶层导航阻断均通过；作者脚本的自身导航仍有 1 次请求到达回环探测端。该浏览器不支持 `navigate-to`。此项是明确的浏览器边界，不能由 jsdom 或响应头字符串证明消除；具体处置与全部门禁记录见[实施记录](EXTENSION_PLATFORM_HARDENING_PLAN.md)。

维护者在本轮明确选择“保留现有设置页，接受自导航外发限制”。因此这是已接受的运行边界，不作为绝对断网通过项。专项脚本默认完整输出观察结果；需要将自导航也作为硬门禁时，加 `--require-navigation-blocked`，当前受测 Chrome 会返回非零。设置页的业务权限与私有数据所有权没有因该例外扩大。
