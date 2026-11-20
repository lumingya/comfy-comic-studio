# 声明式创作入口与只读上下文

本轮只实现 RFC E1 的窄子集：三处宿主入口打开已有沙箱面板，面板可声明接收有界、只读的创作元数据。
没有任意 DOM、脚本条件、快捷键、请求动作、可写 Inspector、跨扩展业务广播或通用 RPC。
既有受信工作区键盘通知链保持原行为，与这里的普通 opaque 面板通道分开。

## 三个入口

```json
{
  "contributes": {
    "host_slots": [{
      "version": 1,
      "id": "inspect-selection",
      "slot": "command_palette",
      "title": "创作上下文",
      "icon": "eye",
      "priority": 0,
      "action": {"kind": "open_panel", "panel_id": "inspect"}
    }]
  }
}
```

- `slot` 只接受 `command_palette`、`context_menu.episode`、`inspector.panel`。
- `panel_id` 必须指向同一包 `contributes.panels` 中已声明的 `episode` 面板。
- 图标只接受 `eye/book/image/list/spark/nodes`，优先级为 −100 至 100；同优先级按扩展 ID、贡献 ID 排序。
- 命令面板和本话分镜右键菜单只在具有当前话上下文时显示；画布 Inspector 还要求有选中画格。
- 动作只打开宿主弹窗中的 `sandbox="allow-scripts"` iframe，不直接提交生成、修改或导出。
- 点击前后复核捕获的 `context_id` 以及当前启用摘要和激活身份；旧选择或停用声明明确拒绝。
- 右键菜单使用右键目标的选区快照，不改变编辑器原有持久选择；关闭菜单不会把目标暗中换成另一格。

不声明槽位的专业包仍可通过具体话「挑图 / 分镜」旁的通用「扩展」菜单找到，菜单只列当前启用的
`episode` 面板。扩展详情仍走原生 `/workshop/assembly/<话 ID>/ext/<扩展 ID>.<面板 ID>` 路由。
这不是把专业工具硬接回主导航；没有启用面板时菜单不出现。

只读发现接口为 `GET /api/extension-host-slots`，开放接口对应 `/api/v2/extension-host-slots`（`read`）。
目录中的每个条目含面板声明、当前 `activation` 和审核 `digest`；停用、内容改变、安全模式时不提供入口。

## 固定白名单通知

在目标面板声明以下可选字段，并至少声明一个 `GET` + `read` 请求：

```json
{
  "subscriptions": ["creation.context.changed", "selection.changed"]
}
```

沿用普通面板 ready/init 握手，收到初始化后发送：

```js
parent.postMessage({
  type: 'mio:creation:subscribe', version: 1, session,
  event: 'creation.context.changed', enabled: true,
}, '*');
```

宿主通知形状为：

```json
{
  "type": "mio:creation:event", "version": 1, "session": "当前 iframe 会话",
  "activation": "当前激活身份", "digest": "已审阅的内容摘要",
  "event": "selection.changed",
  "context": {
    "version": 1, "seq": 5, "context_id": "语义快照 ID", "route": "script",
    "series_id": "作品 ID", "episode_id": "话 ID",
    "selection": {"kind": "panels", "ids": ["画格 ID"], "truncated": false},
    "revisions": {"episode": 3}
  }
}
```

上下文只携带稳定 ID、视图类型和真实文档修订号，不携带提示词、台词、图片、配置或凭据。
同一语义快照不会因重绘而增加序号；选区最多 100 个 ID，超出时明确 `truncated:true`。
需要详情时，继续通过面板原先声明的受限只读请求；此通道不给写操作附加权限或自动参数。

宿主核验 opaque origin、来源窗口、会话、ready 状态和声明白名单，每次通知前只读复核服务端
当前激活与摘要。消息最多 16 KiB，变化按 100 ms 合并，只保留最新快照；订阅控制最多每秒 20 条。
旧序号、旧上下文、跨话结果、未知事件和额外 payload 不发送；不接受面板自定义业务事件。
导航、关闭、停用或激活替换会清除订阅、计时器与在途校验。页面内恢复显示不赋予额外能力。

面板应检查 `event.source === parent`、`session` 和版本，固定激活身份，丢弃较小 `seq`；相同 `seq`
可以分别收到两个白名单事件。关闭时以 `enabled:false` 取消订阅。可安装的完整只读消费者见
[创作上下文示例](../examples/extensions/creation-inspector/README.md)。

## 验证入口

```bash
python tools/check_extension_package.py examples/extensions/creation-inspector
python -m unittest discover -s server/tests -t server -p test_extension_host_slots.py -q
npm --prefix web test -- src/extensions/creationChannel.test.ts src/extensions/hostSlots.test.tsx src/extensions/host.test.tsx
```

这些测试验证声明、身份、边界和生命周期；真实浏览器中的弹窗、目录可发现性与窄屏布局由本轮统一验收记录。

2026-11-21 已用本机已安装的 Chrome 完成 `1440×960 / 390×844` × 浅色／深色四组专项：
每组均从真实命令面板、分镜右键菜单和画布 Inspector 打开示例面板，核对上下文通知与显式只读版本请求，
随后停用并确认入口和 iframe 消失。右键非当前 B 格时，示例收到 B，而编辑器 A 格仍保持当前状态。
四组均无页面或面板横向溢出、控制台错误、外网请求、模型调用或任务提交；12 张临时截图逐张目视后删除。
夹具只使用临时工作区和中性几何画面；该结果不代表已接入付费模型或完整 RFC E1。

可重放命令（不安装浏览器或依赖，不重新构建）：

```bash
python tools/check_creation_browser.py
```
