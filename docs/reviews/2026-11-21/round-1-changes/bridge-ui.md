# 第一轮：隔离桥与前端状态流

审查基线：`git diff 6aa0f8f...125e07f`，源提交 `125e07f1600464b93736392c04f7d0ae8412c63d`。报告形成时 HEAD 仍为该源提交；以下行号均指该提交。本报告只写入本文件，不修改生产代码、测试、生成物、共享台账或个人数据，不提交与推送。

## 结论

- 确认 1 项 Canvas 保存缺陷，与 Spec 审查独立复现的是同一 P1；已通知主控合并，不能重复计数。
- 桥接、会话与默认模板回退没有新增的默认发行配置下可复现缺陷。
- 单列 1 项部署相关清理风险：ASGI 2.4 的断开异常分支。离线分支探针成立，但当前 Uvicorn 的 HTTP scope 为 ASGI 2.3，尚不能据此认定默认发行配置会泄漏。

## 已确认的重复发现

### P1 — dirty Canvas 草稿借用远端最新 revision，覆盖他人取景

**位置：** `web/src/pages/canvas/CanvasTab.tsx:45,58–60`；`web/src/pages/canvas/useStripHistory.ts:73–76`；`web/src/api/production.ts:84–97`。

**触发：** 本地画布基于 revision 3 修改宽度，保持未保存；另一窗口保存新的画格位置，当前窗口缓存收到 revision 4；当前窗口点击保存。

**预期：** 草稿仍以其原始 revision 3 比较并返回 409，保留两边内容供用户核对。

**实际：** dirty history 保留 revision 3 的旧取景，而 `useSaveStrip(episode.id, episode.revision)` 已从缓存取得 revision 4。旧取景以 `base_revision=4` 提交，服务端现值也为 4，因此 CAS 校验通过并覆盖远端修改。

**离线证据：** 临时 Node/jsdom 探针直接 transpile 执行真实 `CanvasTab` 和 `useStripHistory`，仅替换依赖的 UI/API。捕获结果：

```text
currentServerRevision = 4
currentServerBox = [0,770,800,1837]
requestBaseRevision = 4
requestBox = [0,170,800,1237]
requestWidth = 900
```

临时脚本：`C:/Users/QIU/AppData/Local/Temp/mio-ui-race-vm.cjs`。此证据来自受限的 UI 子审查；主控已通知 Spec 轴先行独立复现并统一修复，因此本项仅保留交叉证据，未继续重复探针。

**影响：** 新增的跨窗口防覆盖保护被正常缓存刷新绕过；取景和排版可静默丢失。

**最小修补建议：** 将保存基线 revision 与 history 的 saved 快照共同保存。只有 history 真正接收服务端快照或成功 acknowledge 时才推进基线；dirty 时不能随 episode props 推进。回归应同时断言旧草稿与旧 token，而非只断言请求带有某个 revision。

## 合理怀疑及限定条件

### 候选 P2 — ASGI 2.4 断开异常使媒体清理依赖生成器/GC 收尾

**位置：** `server/mio_server/extensions/panel_media.py:204–216`。

**已证实的分支条件：** 在真实 `dispatch_media` 返回的 `StreamingResponse` 上，以 outer `scope.asgi.spec_version='2.4'` 执行响应，令 `send` 在首块 `http.response.body` 抛出 `OSError`。项目钉住的 Starlette 0.52.1 将其转换为 `ClientDisconnect` 并跳过后面的 background task。发送异常刚返回时，临时文件仍打开，`release()` 次数为 0。显式关闭迭代器/对象销毁后的清理时机受异步生成器与 GC 影响，不能作为确定的请求终结清理。

**最短探针结构：** 用 `SimpleNamespace(response='download', method='GET')`、无权限或数据依赖的 128 KiB `application/octet-stream` ASGI producer 调用 `dispatch_media`；替换 `TemporaryFile` 为记录句柄的包装；执行上述响应并统计回调。输出的关键断言为：

```text
ClientDisconnect
{'immediate_file_closed': False, 'immediate_release_count': 0}
```

临时脚本：`C:/Users/QIU/AppData/Local/Temp/mio-panel-media-disconnect-probe.py`。未启动服务或访问网络。

**预期：** 失败、取消及流结束都有确定的 finally 清理，释放文件与扩展并发名额。

**影响假设：** 若部署所用服务器采用此 ASGI 2.4 断开机制，反复取消下载可暂时保留临时文件和并发槽位；实际持续时长取决于 GC 与服务器持有响应/异常的方式。

**为何不计入已确认默认缺陷：** 当前安装的 Uvicorn 0.40.0 的 `h11_impl` 和 `httptools_impl` 均向应用报告 `spec_version='2.3'`，通常走 Starlette 的 disconnect listener 与正常 background cleanup。尚未在默认 Uvicorn 路径证明可持续泄漏，不能把模拟 ASGI 2.4 分支结果冒充默认部署复现。

**最小修补方向：** 如果项目承诺支持此 ASGI 分支，可用拥有文件生命周期的响应子类或 async iterable，在整个 response `__call__` 外层 `try/finally` 调用现有幂等 `close()`；增加发送头或首块失败的测试，而非仅依赖 `BackgroundTask`。若只支持当前 Uvicorn 路径，此项可记录为加固建议。

## 覆盖与未发现缺陷的边界

### Standards 轴

已读 `AGENTS.md`、README、路线图、CI，以及共享审查说明/台账。围绕改动检查模块拆分是否改变状态所有权、是否将专业功能重新硬接到基座导航、是否破坏原生沙箱和声明权限边界。未重复报告格式/类型等 CI 可直接检查的事项；未把代码拆分或既有代码异味当作缺陷。

### Spec / 行为轴

- **声明与 HTTP 桥：** `manifest.py`、`protocol.py`、`panel_bridge.py`、`panel_media.py`、host slots/surfaces 路由。检查 response 模式与方法/scope 约束、同包面板归属、声明路径匹配、静态路由冲突保护、path 参数编码、v2 凭据转发、跨扩展/重定向拒绝。未找到新增可复现的权限绕过。
- **二进制与生命周期：** `ExtensionFrame`、`extensionBridge`、`extensionMedia`，以及相关现有测试。检查声明决定传输模式、消息 source/session、AbortSignal、dispose/导航、端口释放、下载宿主按钮、真实分块上限、MIME/长度/静态图片验证、文件名处理。新增仅执行上述断开清理探针；没有重跑旧 host Blob URL 原探针。
- **只读创作上下文：** `creationContext`、`creationChannel`、`useCreationChannel`、`hostSlots`、`ExtensionTab`、CommandPalette。检查 owner cleanup、语义序号与右键调用快照、origin/source/session、ready、白名单、速率/大小边界、异步授权迟到结果、跨话失效、入口摘要/激活复核。没有重复原有“右键 B”或重复 ID 测试作为新发现。
- **宿主拆分：** `hostFrame`、`hostFloating`、`hostEvents`、`hostSurfaces` 与旧 `host.tsx` 差异；检查订阅撤销与旧 frame/session 决策隔离。主要为原行为拆出，未发现可复现的新回归。
- **UI 状态：** BoardTab/BoardReview/BoardZoomDialog 候选索引、未采用筛选、双图固定和采用/弃用；CanvasTab/StripStage/Letter/canvasTools/useStripHistory/PacingDialog 的保存、编辑、撤销及避让/节奏迟到结果；ScriptTab/PanelEditor/BibleAssist/PanelVariableFix/ReferencePreview/FramePage 的 flush、补值与引用预览。除上列重复 Canvas 问题外，未形成其他确认缺陷。ReferencePreview 的迟到本地 setState 被目标 key 卸载隔离，未发现跨对象写入证据。
- **其他前端拆分与默认模板：** Assembly/Presets 拆分后的 actions/interaction/menus/library 状态路径，Reader controller/environment/view、templateFile 与 album/exporting 默认值。核对失效偏好在模板目录成功后回退至 monograph（不存在则 native），网络目录未成功时不直接改写持久偏好。未发现新的默认回退错误。

未覆盖真实 ComfyUI、收费模型、恶意浏览器实现、所有 ASGI 服务器或全部真实浏览器时序；未安装浏览器、未跑 E2E/全量测试、未读改个人 data。SDK 的二进制返回类型问题已提示主控转交 SDK 审查者，不在此重复扩展调查。本报告不是对全仓安全性或全部并发时序的零缺陷证明。
