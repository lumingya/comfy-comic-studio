# 创作上下文检查器

一个真实的只读 E1 消费者：从命令面板、话的上下文菜单或检查器槽位打开同一个扩展面板，查看宿主提供的作品／话 ID、路由、选区 ID、修订号和事件序号。不展示提示词、台词或其他作品正文。

## 安装与使用

在本目录按明确清单打包：

```bash
python -m zipfile -c creation-inspector.zip mio-extension.json panel.html panel.js README.md
```

从扩展管理导入文件夹或 ZIP，审阅摘要后启用。在具体话中选择「创作上下文」入口；面板完成握手后订阅 `creation.context.changed` 与 `selection.changed`。切换分镜／画布或改变选区时，它只刷新已有上下文信息，不启动生成或修改作品。

「核对本话版本」是可选的显式只读请求：通过已有 `GET /episodes/{episode_id}` 操作获取服务端版本，只显示响应中的 `id` 和 `revision`，不展开其他字段。晚到的旧话响应会被丢弃；失败或超时不自动重试。

## 窄契约

- `host_slots` 的三个版本 1 声明只执行 `open_panel`，均指向本包的 `inspect` 面板：`command_palette`、`context_menu.episode`、`inspector.panel`。
- 订阅白名单只含上述两个宿主事件。消息检查父窗口、版本与会话；事件额外检查上下文形状与激活摘要，丢弃低于已见 `seq` 的快照，不发送自定义业务事件。
- 面板只有一个 `read` 请求声明，没有写入、出图、任意 URL 或请求头能力。它不使用 Python 入口、`ctx.internal`、直接网络、浏览器存储或业务字段正文。
- 关闭时发送 `enabled:false` 取消两个订阅，并清理事件监听器和读取超时。停用、卸载及内容摘要变化的隔离仍由宿主管理。
- 本例没有直接写入动作、全局快捷键、条件表达式或任意脚本槽位。声明式入口只能打开受审阅面板，不是执行任意宿主代码的逃生口。

## 检查

在仓库根目录运行：

```bash
node --check examples/extensions/creation-inspector/panel.js
python tools/check_extension_package.py examples/extensions/creation-inspector
```

需要支持版本 1 `host_slots` 与面板 `subscriptions` 的宿主。静态 CTK 只验证包和声明，不能代替真实槽位入口、选区事件和生命周期的浏览器验收。
