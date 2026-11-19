# RFC：高扩展度平台的下一阶段演进

状态：**设计提案，尚未实现**。日期：2026-11-19。平台契约基线：`a23923c`；当前树含 `d5a4164` 浏览器验收进程清理修复。
前置条件：M1–M4 加固及其实际验收已完成；具体结果和未覆盖范围见[实施记录](EXTENSION_PLATFORM_HARDENING_PLAN.md)。
本文中的新字段、消息、目录及端点均为协议草图，不能作为当前可调用接口使用。

## 1. 目标、事实与约束

目标是让新能力通过清晰契约接入，用户状态从创建到恢复形成闭环，同时维持本地优先、日常基座精简。
每个新增模块只暴露调用者实际需要的接口；边界优先落在已有协议、操作目录和任务身份处。
不向宿主 DOM 挂载扩展 React，不复制 AppContext，不创建与现有 Job Engine 竞争的调度算法。

| 已实现事实源 | 本提案复用方式 |
| --- | --- |
| `extensions/manifest.py`、`extensions/protocol.py` | Pydantic 声明、OpenAPI `MioContract_*`、生成的 TS 类型和运行常量 |
| `api/operations.py`、`extensions/panel_bridge.py` | 实际操作身份、已有权限与类型验证、面板请求模板白名单 |
| `private_store.py`、`api/theme_preferences.py`、`api/extension_private.py` | 所有权、严格 JSON、ETag/CAS、子树写入；不另造偏好存储 |
| `registry.py`、`jobs/executors.py`、`jobs/delivery.py` | 分层贡献、固定执行器身份、持久结果与重放约束 |
| `theme_media.py`、`theme_packages.py`、`backups/` | 有效媒体、逻辑卡片作用域、包校验、内容头及重启恢复 |
| `extensions/ai-assist/`、`exporting.py` | 从真实调用需求抽取 SDK；复用冻结、文件产物及取消模式 |

三层信任继续分开：主题只改变视觉；普通面板使用无同源 iframe 和声明白名单；受信 Python/工作区须审阅摘要。
用户已明确接受现有 HTML 主题设置页的自导航外发限制；它仍没有同源权限或业务 API 桥。
此项例外不扩大到新的主题能力，细节以[主题包契约](THEME_PACKAGES.md)和[CTK](EXTENSION_PLATFORM_CTK.md)为准。
五个不变量继续作为验收轴：身份一致、所有权清晰、最后意图一致、临时能力明确、验证结论有边界。

非目标：远程多用户平台、任意页面注入、默认启用扩展、自动升级共享 Python、自动执行收费操作、全能事件总线。
专业能力仍留在扩展与开放接口；新增内省、协议故障和进程诊断只放在 opt-in CLI/API 或深层诊断入口。

## 2. 声明式槽位、上下文与同步快捷键

### 2.1 提案协议

首批仅开放 `command_palette`、`context_menu.episode`、`inspector.panel` 三个命名槽位。
宿主渲染文字、图标、禁用态和已有表单控件；作者只能引用贡献 ID、内置图标 ID 与白名单动作。
复杂内容继续打开已有沙箱面板或受信工作区，不允许传 React 组件、HTML 字符串或可执行表达式。

```json
{
  "contributes": {
    "host_slots": [{
      "id": "summarize-selection", "slot": "command_palette", "title": "整理所选分镜",
      "icon": "file-text", "priority": 0,
      "when": {"all": [{"field": "selection.kind", "equals": "panels"}]},
      "action": {"kind": "open_surface", "surface_id": "outline"},
      "shortcut": {"code": "KeyJ", "ctrlOrMeta": true, "shift": true, "consume": true}
    }]
  }
}
```

`when` 只支持固定字段、有限深度的 `all/any/not` 与类型化比较；无 eval、正则执行或数据查询副作用。
普通面板的动作可为 `open_panel` 或清单已声明的 `request_id`，不能提交任意 URL、headers 或宿主函数名。
调用有副作用的请求必须由用户手势触发；权限、上下文版本及任务幂等在真实操作入口重新检查。
Inspector 首批只读字段和显式操作按钮；可写字段在后续提案中明确 revision 与对象授权后再开放。

### 2.2 上下文所有权和会话

宿主构造不可变 `CreationContextV1`，按订阅范围裁剪；主题不能订阅创作业务上下文。
快照示例：`{version:1, session, seq, context_id, route, series_id, episode_id, selection, revisions}`。
`selection` 只含类型和稳定 ID；`revisions` 对应实际文档版本，不使用 React 渲染次数代替业务版本。
默认不发送提示词正文、图片字节、全局设置、渠道地址或凭据；需要详情时继续走已授权只读请求。
普通面板的可见 ID 受其场景约束；受信工作区也只自动接收所订阅的最小快照。

宿主状态机：`unmounted → attached → ready → active ↔ suspended → disposed`。
每次真实 iframe 文档、activation 或 digest 改变时建立新 session；恢复显示仅恢复订阅，不重建用户会话。
消息携带 `session + seq`；迟到快照、旧文档回复和低序号结果丢弃。无增量基础时重新请求完整快照。
动作带 `context_id + expected_revisions`；上下文已经改变则返回 `context_stale`，不能把旧选择偷偷应用到新作品。

细粒度失效草图：`changed:{resources:[{kind:"episode",id:"ep_…",revision:"…"}]}`。
宿主维护资源种类到 Query Key 的固定映射，只使相应缓存失效；作者不能发送任意 Query Key。
变更通知只能声明自己的授权操作实际产生的资源；未知种类限速记录并忽略，不回退为全量失效。
订阅表、请求取消和上下文快照共享 iframe 会话所有权；普通拖动、缩放和透明度更新不撤销它们。

### 2.3 快捷键的同步决定

Manifest 中的预声明快捷键由宿主提前编译，keydown 同步判断路由、焦点、IME、输入控件和 `when`。
只有有效匹配且声明 `consume` 时同步 `preventDefault()`，随后异步发送固定动作和捕获的上下文快照。
现有异步全局事件链继续用于通知；其异步 `handled` 不再被描述成能撤回浏览器已经执行的默认行为。
`Ctrl/Cmd+Shift+0` 以及 `Digit0/Numpad0` 的等价恢复组合由宿主保留，Manifest 校验和捕获监听均拒绝覆盖。
恢复路径先于扩展分发，忽略槽位焦点与主题遮挡；测试覆盖重复按键、IME 和输入框。
同一快捷键冲突以宿主保留规则、显式用户选择、贡献 priority、`extension_id/id` 稳定次序裁决，并提供只读原因。

### 2.4 文件、验收和退路

扩充 `manifest.py/protocol.py`；新增 `web/src/extensions/hostSlots.tsx` 与 `creationContext.ts`。
复用 `app/CommandPalette.tsx`、`components/ContextMenu.tsx`、`pages/canvas/PanelInspector.tsx` 的现有渲染入口。
只在对应入口消费声明，不给主页面增加扩展管理控件；扩展代码仍单独构建和分发。

| 验收矩阵 | 必须观察到的结果 |
| --- | --- |
| 三槽位 × 普通面板/受信工作区 × 启停/替换 | 来源和摘要一致，权限检查保留，停用恢复宿主原行为 |
| 选择变化/切路由 × 请求乱序/卸载 | 旧 context 的写操作明确拒绝；无迟到缓存、草稿或订阅回写 |
| 两扩展同快捷键 × 输入焦点/IME/恢复键 | 同步消费恰好一次，冲突可解释，恢复键始终保留 |
| 单资源变化 × 多页面查询 | 仅相关 Query Key 失效，不能由扩展随意全量刷新 |

风险是上下文泄露和槽位膨胀。首批不开放通配订阅、任意条件脚本或可写 Inspector。
回滚时关闭新贡献类别的消费，保留清单和私有偏好；现有面板、工作区及手工操作继续工作。

## 3. 可组合、事件驱动主题

### 3.1 分层与便携身份

组合器产出一个有效主题快照，不改写来源包；初版层次固定为配色、布局、背景三层。
用户组合引用 `{id, source, digest}`，组合定义保存为提案中的服务端 `theme_composition` 文档，私有偏好继续归 `theme_data/<composition_id>/preferences.json`；包作者不能通过组合读取其他主题私有数据。浏览器 `ui-store` 只保留当前激活组合的引用，这个本机选择仍不属于工作区备份，不能把它与服务端组合定义混为一谈。
缺少来源或摘要改变时保留引用并标记失效，按层回退基础值；不静默换成同 ID 的新内容。

```json
{
  "version": 1,
  "layers": {
    "palette": {"id": "theme-…", "source": "theme-package", "digest": "…"},
    "layout": {"id": "theme-…", "source": "theme-package", "digest": "…"},
    "background": {"owner_theme_id": "theme-wallpaper", "wallpaper_id": "wallpaper_…"}
  }
}
```

各层有互斥白名单：配色写颜色令牌，布局写已批准的尺寸/阴影，背景使用完整 MediaDescriptor。
任意全量 CSS 无法自动推导分层所有权，故作为显式选择的单一 legacy 样式层，不与第二份任意 CSS 叠加。
卡片继续使用逻辑 `self` 和服务端语法位置绑定；公开主题 ZIP 不携带私有媒体、偏好或用户组合。
完整备份保存服务端组合定义、来源引用和私有状态；缺少扩展贡献主题时仍保留数据，重新审阅启用后再解析引用。媒体始终归原 `owner_theme_id`，组合仅引用，不复制或搬迁；宿主负责解析媒体地址，不向其他层的作者脚本暴露跨所有者的偏好或私有媒体地址。

### 3.2 声明式设置到 CSS 变量

在现有 `settings_schema` 字段上增加可选 `bind`，例如 `{target:"--mio-theme-user-overlay",unit:"number"}`。
绑定目标必须在该主题声明且宿主批准的变量表中；不能映射业务属性、任意选择器、URL 或 CSS 文本。
slider 绑定有界有限数值，switch 绑定固定值对，select 绑定静态白名单；file_upload 仍走媒体接口。
服务端校验默认值和绑定；运行时按同一模型校验已存偏好，未知或非法值回退该字段默认值并发出固定诊断。
CSS 变量由唯一 ThemeProvider 统一应用、跟踪及清理，窗口设置和卡片预览不能各自写根元素。
偏好仍按字段子树 CAS；派生变量是可重建结果，不写回包、不重复保存一份“有效偏好”。

### 3.3 单次视觉脚本与生命周期

新增 opt-in 的事件驱动脚本契约，旧脚本保持明确版本，不把无限循环改名为事件驱动。
首批事件仅为 `theme.applied`、`theme.preferences.changed`、`appearance.changed`、`visibility.changed`。
输入仅含该主题有效视觉值、动效策略和裁剪过的显示状态，不含作品 ID、内容、业务令牌或宿主对象。
每次调用建立独立 Worker，携带 `{contract:1, session, invocation_id, seq, event, input}`。
返回一次 `{invocation_id, colors:{token:value}}`；只允许颜色白名单，DOM、网络和业务能力不进入该接口。
宿主硬截止时间初值建议 100 ms，输入上限 64 KiB、输出 8 KiB；这些是待基准验收的提案参数。
Worker 超时即 terminate，不依赖作者合作；有界队列合并同类事件，只保留当前 session 的最新意图。
旧 invocation 结果不能覆盖新结果；切换主题、减动态、停用授权或卸载立即撤销 Worker 和待处理结果。
减少动态效果禁止自动脚本调用；视频例外仍只影响系统视频策略，不能绕过 Mio 手动暂停或动画图片策略。

状态机：`disabled → idle → running → completed/failed/timed_out → idle`，session 结束直接 `disposed`。
只有验证通过且仍属于当前主题的结果可提交；清理沿用“当前值仍属于我才恢复”的所有权检查。
超时、摘要不符、限速及非法令牌进入现有 opt-in 诊断，记录固定原因码，不记录源码和偏好值。

### 3.4 HTML 设置页与更强运行时

保留当前 HTML 设置页及其已接受的自导航外发限制，不将本文作为撤销用户决定的依据。
现有页面继续无同源、无业务桥，仍只能异步读写自己的设置；不能把 `connect-src` 写成绝对断网证明。
更安全的候选是“作者逻辑仅在 Worker + 宿主声明式表单”，作者不获得 Window 或 DOM。
若需要保留任意 DOM 页面，可单独试验受信外壳对内层导航的约束；它必须另做跨浏览器、导航及其他外发通道验收。
在独立验证及明确能力声明之前，不把候选运行时宣传成绝对离线，也不自动迁移现有作者页面。

文件：`themes.py`、`theme_media.py`、`protocol.py`、`theme_packages.py`；前端 `theme.ts/useTheme.tsx/themeScript.ts` 和设置面板。
先完成变量绑定，再完成组合解析，最后引入新 Worker 版本；不同时重写包分发格式和旧脚本运行时。
验收覆盖层缺失/摘要改变/同 ID 覆盖、默认值与未知偏好、脚本旧成功/超时晚到/卸载、全部媒体×动效矩阵。
真实浏览器单独验证首帧、Worker 终止、资源卸载与设置页边界；单测不能替代媒体解码或零外发结论。
回滚关闭新组合/脚本版本，回退基础主题；保留所有来源包、组合引用、私有媒体和偏好。

## 4. 版本化 SDK、扩展互操作与受管 Sidecar

### 4.1 从真实 AI 扩展抽取接口

`ai-assist/main.py` 已使用服务、路由、text_provider 和 workspace_surface；`core/service.py` 仍持有 `mio.internal`。
`core/operations.py` 已按 OpenAPI 发现操作、裁剪返回、执行权限和用户确认，这是优先抽取的实际边界。
先以 AI 辅助和 `examples/extensions/text-metrics` 两个调用者验证接口，再宣布 SDK v1 稳定。

```python
# 提案：只增加经真实调用证明需要的能力，具体名称待首轮实现评审。
sdk = mio.require_sdk(major=1, capabilities={"operations", "jobs", "private_state"})
spec = sdk.operations.describe(operation_id)
result = await sdk.operations.invoke(operation_id, arguments, expected=revision)
job = sdk.jobs.submit(kind, items, owner=episode_id, idempotency_key=request_key)
```

| 已有需要 | 拟稳定的所有权契约 |
| --- | --- |
| 操作发现/执行 | 固定操作 ID、版本、授权、有限返回、明确拒绝自动重试；敏感凭据与信任操作仍由用户直接执行 |
| 文档读取/任务提交 | ID 与版本化 DTO，不返回可变 store/engine/SQLite 对象；任务冻结 owner 与执行器身份 |
| 私有设置/服务回收 | 复用 PrivateStore、CAS、服务 close/busy；凭据引用不转换成可公开分发的设置 |
| 脱敏与提供者访问 | 扩展只提交自己的结果脱敏；宿主提供凭据感知的结果处理，不提供枚举全局密钥的方法 |

主版本变化显式拒绝不兼容契约；功能通过 capability 协商，未知能力不默认为支持。
`mio.internal` 继续明确不稳定且仅属于受信 Python，不为其每个字段添加机械代理，也不宣称它受 SDK 权限隔离。
版本、方法语义和消息模型继续从 Pydantic/OpenAPI 生成，Python 客户端和独立扩展示例一起验收。

### 4.2 扩展间命名空间与贡献裁决

允许提供方声明 `ext.<id>.<point>`；注册者必须拥有该 `<id>` 的当前激活身份。
提供方声明 `{contract_major, input_schema, output_schema, mode, priority_policy}`；消费者声明所需主版本与可选性。
命名空间不是目录路径或任意 Python import；跨进程只传有界 JSON/资源句柄，不传对象指针、文件路径或函数源码。
调用草图：`{point:"ext.ai-assist.summarize",major:1,request_id,context_revision,input}`。
可选提供者缺失返回 `provider_unavailable`；必要依赖阻塞激活，环依赖在安装/激活计划中拒绝。
停用先阻止新调用，再排空有截止时间的在途调用；更换 digest 不允许旧调用串接新实现。
Python 内互调仍是可信代码协作，不冒充安全沙箱；普通面板只能通过自己声明的请求入口触发互操作。

沿用 Registry 层与 source/digest，不把现有“后注册覆盖”全局改为 priority。
新扩展点必须显式选择单提供者、过滤链或多播；priority 只按该模式裁决，同值以 ID 稳定排序。
只读内省返回全部候选、当前赢家、被覆盖原因、契约版本、来源摘要、订阅/在途数量和故障码。
不输出 Python 对象 repr、用户输入、源码或凭据；同来源重注册不累积多层，停用恢复原贡献。

### 4.3 Sidecar 声明、启动与数据

提案清单增加 `runtime:{kind:"sidecar",contract:1,entry,capabilities}`；安装仍不执行，启用仍审阅完整摘要。
入口必须在包内且采用参数数组；不使用 shell 拼接，不自动下载解释器或安装系统/共享环境依赖。
首批运行宿主已具备的明确运行时；依赖交付、平台二进制及版本约束由包声明，CTK 只读校验。
Sidecar 是独立进程和依赖环境，**不是 OS 安全沙箱**；它仍是用户明确启用的受信本机代码。
`SidecarManager` 复用服务生命周期，负责启动、握手、心跳、排空、限时退出与自身子进程树回收。
包目录只读约定；持久数据仍归 `extensions_data/<id>`，主题私有数据不因 Sidecar 获得额外所有权。
临时套接字、进程租约和运行令牌位于宿主控制区，排除公开包和工作区便携备份。

状态机：`disabled → starting → handshaking → active → draining → stopped`，异常进入 `failed`，不无限重启。
握手包含包 digest、协议主版本、随机 challenge 和 runtime_generation；不匹配时撤销令牌并终止自身子进程。
重启退避和次数有界；安全模式不启动 Sidecar，卸载默认保留私有数据，忙碌任务仍遵守停用/替换保护。
进程回收必须校验宿主创建的 PID、创建时间与 generation；不能因 PID 复用误杀用户进程。

### 4.4 复用 v2 的短令牌与任务身份

传输使用已有 `/api/v2`、Authorization Bearer 和生成客户端，不另开绕过鉴权的任意业务 RPC。
短令牌、audience、扩展命名空间约束和续租是新增提案；当前普通 v2 scope 本身不提供这些隔离能力。
宿主以相同令牌解析、哈希和过期校验机制发行内存短令牌，绑定 extension_id、digest、activation、generation。
令牌 scope 取清单请求、用户授予与宿主允许范围的交集；默认无 admin、无 render，不允许自行铸造或扩大权限。
在 v2 验证中额外检查 audience、允许的操作 ID 和资源范围；不能仅凭令牌名字或 URL 前缀判断归属。
凭据经匿名管道或等效专用启动通道交付，不放 argv、日志、清单、包或备份；退出/超时/停用立即撤销。
续租由宿主确认同一激活与存活进程后执行；宿主重启时旧运行令牌全部失效，新 generation 重新握手。
宿主不把全局模型密钥自动交给 Sidecar；必须使用扩展自己的受控凭据或明确授权的宿主操作。

Sidecar 任务通过适配执行器接入现有 Job Engine，冻结 `(kind,source,digest)`，不由进程自行重建任务数据库。
每次请求附 job/item/attempt/epoch/generation；宿主拒绝旧进程结果，产物先校验并持久交付再回写作品。
发出外部或收费请求前持久标记 sent；断连或重启无法确认结果时进入 `uncertain`，不自动重发。
只有声明并验证 replay_safe 的结果交付可重放；同一 delivery_id/sha 的作品写入和回执必须同事务去重。
取消是“请求停止并核对结果”，不是证明上游未执行；无协作的进程被终止后，未决任务仍保留未知状态。

### 4.5 落地、验收与回滚

先改 `extensions/sdk.py`、`extensions/public.py` 和 AI 扩展，新增职责明确的 SDK 模块；再扩 `registry.py` 与 `manifest.py`。
Sidecar 新增 `extensions/sidecar.py`，接入 `manager.py` 与现有 SDK 服务所有权；鉴权扩 `auth.py`、`api/v2.py`。
复用 `jobs/executors.py/delivery.py/state_leases.py`、备份参与者契约和现有 opt-in 诊断，不创建通用任务提交后门。

| 验收矩阵 | 必须观察到的结果 |
| --- | --- |
| 两个真实调用者 × SDK 主版本/能力缺失 | 不经 internal 的目标链路可用；不兼容明确拒绝，不偷偷回退内部对象 |
| 互操作缺失/冲突/环依赖/提供者替换 | 裁决可解释，在途身份固定，停用无残留或重复执行 |
| 短令牌过期/越权/跨扩展/旧 generation | v2 拒绝访问；日志、产物、包及完整备份不含运行凭据 |
| 子进程崩溃/宿主重启 × 发送前/发送后/结果交付中 | 未发出可安全重试；已发出保持 uncertain；已收结果幂等交付 |
| 忙碌停用/卸载/安全模式/PID 复用 | 不误杀、不丢保留数据、不自动重启或再次计费 |

首轮使用本地无网络的示例 Sidecar 和模拟收费回执，不使用真实模型安装或付费调用充当测试夹具。
回滚可禁用新运行时和互操作贡献；撤销令牌、停止自己的进程，保留任务、未决回执和私有数据供核对。
不把 Sidecar 回滚为自动执行的 Python 扩展；用户必须重新审阅选定运行方式。

## 5. 大包操作进入统一 Job Engine

### 5.1 入口和所有权

先迁主题 ZIP 导入/导出，再迁备份导出/预检/暂存；主题仍可达 10 GiB，大小限制不因任务化而放宽。
沿用 `exporting.py` 的冻结、文件产物和独立下载模式；统一 Job 进度、取消、错误与显式重试。
提案入口如 `POST /themes/package-jobs`、`POST /backups/export-jobs`，返回 202 与 job_id；权限沿用原操作。
上传会话先落入宿主管理的临时区，结束后生成只读内容句柄，任务只引用句柄、大小、sha256 和来源身份。
不把 10 GiB 请求体放入 Job JSON，也不允许客户端传服务器任意路径；上传租约、配额和取消归宿主。

```json
{
  "contract": 1, "operation": "theme.import", "idempotency_key": "request_…",
  "source": {"upload_id": "upload_…", "sha256": "…", "size": 1048576},
  "expected": {"catalog_revision": "…", "package_digest": null},
  "options": {"replace": false}
}
```

相同幂等键必须对应同一规范化意图和文件摘要；参数或内容不同返回冲突，不能借重试替换输入。
包代码、私有状态、上传临时文件、已发布产物及恢复保护目录分别登记所有者，不复用包目录存用户数据。

### 5.2 内容头与维护控制面必须先拆清

当前 `Backups.head()` 涵盖 workspace 内的数据库与任务状态，`restore_guard` 也会检查活动任务。
直接把备份放进同一任务库，会让维护 Job 自己阻塞 quiescent，或让其状态变化使 expected_head 自失效。
因此任务化依赖先引入版本化的“可恢复内容头 / 维护控制面”划分，不能只加一个忽略全部忙碌任务的开关。
内容头继续包含作品、资产、私有状态以及用户业务任务的状态、冻结身份和交付回执。
仅宿主登记的维护控制记录、瞬时进度和租约不参与内容头；kind、执行器来源、意图 Schema 与控制面归属须严格验证。
扩展或归档不能靠自报 `maintenance=true` 把业务任务或用户数据排除；新增控制表只能保存受限操作元数据和内容句柄。
维护产物发布日志置于既有 recovery_root 的受验宿主子目录，用于重启核对，不当作第二个任务引擎。
初版每工作区只允许一个未终结维护 Job；其他维护提交明确冲突，先避免多个自排除规则相互穿透。
快照屏障只能豁免当前内建维护执行器的确切 job/item/epoch，并核对独占维护租约；继续拒绝其余活动/未知业务任务。
这项豁免是内部执行上下文，不能成为 HTTP `ignore_job_ids` 或扩展可传的通用参数。
恢复 stage Job 完成后才允许用户 apply；apply 继续使用正常闲置检查和既有下次启动目录事务。
内容头版本升级使旧恢复计划明确要求重新 stage，旧归档和保护副本保留；不悄悄重算并接受旧确认。

### 5.3 阶段提交、取消和恢复

维护阶段记录：`receiving → preflight → staging → validating → ready_to_commit → committed → completed`。
这些是现有 Job 的阶段元数据，不增加另一套 Job 顶层状态；异常沿用 failed/uncertain/canceled。
上传、解压、复制和哈希按块检查取消与预算；preflight 失败立即释放自己持有的临时文件与预留空间。
大部分 IO 在发布屏障外完成；最终提交前在原操作屏障与所属目录锁下重验 expected_head、摘要和目标身份。
包导入提交才改变目录/注册表；导出提交才公布不可变产物句柄；备份必须完成归档复检后才可下载。
提交前取消：删除本任务受验 staging，原包/用户数据不变。提交开始后取消：先完成或核对发布，再如实报告最终状态。
不把“客户端断开”视为任务取消；同 Job 可重新查询，新的下载响应不得重新执行导入或备份。
重启通过宿主发布日志区分未提交、已提交及结果未知；检查目标身份后复用回执，不重复执行副作用。
恢复 apply 仍由 `backups/startup.py` 的租约、校验和目录交换负责，任务线程不在线替换正在使用的工作区。

断点首期只支持可验证的完整上传成员和完整阶段，不承诺任意 ZIP 压缩流的字节级解压恢复。
续传必须验证上传会话、块偏移和摘要；最终整体 sha256 不匹配则拒绝发布，不能信任 Content-Length 或 mtime。
跨版本执行器/包摘要不符时阻塞并要求重新计划，不把旧 staging 自动交给新逻辑。
崩溃清理只处理带有效所有权日志、无活动租约且超保留期的临时树；未知目录只报诊断，绝不递归扫删用户目录。

### 5.4 磁盘预算和验收

每个卷分别预估 `上传剩余 + 解压/快照 + 输出归档 + 发布保护副本 + 安全余量`，再减去已确认可复用的字节。
预算包含同卷其他维护预留；跨卷复制不能按 rename 计费。压缩包按受验展开上限预检，不用压缩体积猜展开量。
预检后仍逐块计数并处理磁盘满；预算不是 OS 配额，不承诺能阻止其他本机程序抢占空间。
完成、失败和取消释放预留；有保留需求的产物/保护副本转换为明确持久占用，不假装已经回收。

文件：新增 `maintenance.py` 与任务意图模型；扩 `api/theme_packages.py/api/backups.py`、`theme_packages.py`、`exporting.py`。
内容头和屏障改动集中在 `backups/database.py/snapshot.py/service.py`、`jobs/operations.py/types.py`，恢复沿用 startup。
先证明控制面划分和精确自排除，再迁主题操作，最后迁备份；不先放宽现有 restore_guard。

| 验收矩阵 | 必须观察到的结果 |
| --- | --- |
| 小限额 × 原始/文件夹 ZIP × 假边界/超限/磁盘满 | 有背压、有界内存，取消后临时文件与预算无泄漏 |
| 用户私有状态修改 × 维护进度/暂停/重启 | 用户变化使旧计划失效；维护控制变化不自失效，不掩盖业务任务变化 |
| 阶段各切点 × 取消/断连/崩溃/同键重试 | 只出现原内容或验证完整的新内容，发布最多一次，回执可查询 |
| 四类主题来源/保留扩展数据 × 导出/恢复 | 延续 M1 全矩阵，公开主题包仍无私有媒体和偏好 |
| 冒充维护任务/其他活动作业/旧 head 版本 | 不获屏障豁免，明确拒绝或要求重新 stage |

风险是长锁、磁盘峰值和控制面误分类；初期禁并发维护发布，不对外宣称断电绝对原子。
回滚关闭新提交入口，保留已发布产物、恢复计划和原目录事务；先排空/核对在途任务，不能删除日志掩盖未知结果。

## 6. 分期依赖与统一完成标准

| 批次 | 交付及依赖 | 进入下一批的条件 |
| --- | --- | --- |
| E1 | 槽位/上下文 Schema、只读 Inspector、同步快捷键；依赖 M3 会话与 M4 生成链 | 三槽位组合测试、恢复键真浏览器、协议零漂移 |
| E2 | 设置变量绑定、分层组合，再引入新 Worker；可与 E1 的后半段独立推进 | 最后意图/摘要/动效矩阵与诊断通过，HTML 边界不被抹去 |
| E3 | AI 辅助与 text-metrics 验证窄 SDK，再做命名空间互操作 | 两真实调用者不依赖新增 internal 代理，停用/冲突/版本矩阵通过 |
| E4 | Sidecar 控制面、v2 短令牌、任务适配；依赖 E3 身份和接口 | 进程/令牌/未知结果矩阵通过，首次发布不要求真实付费调用 |
| E5 | 维护内容头/屏障、主题大包 Job，再迁备份 | 自排除不可冒用、崩溃切点和完整重启恢复矩阵通过 |

每批先写契约及验收，再实现有限文件范围；集中验证后独立提交推送，完成项同步路线图。
所有 API/Pydantic/消息变化都更新 Python 客户端、OpenAPI、TS 和协议常量，并执行两个生成器 `--check`。
门禁沿用[AGENTS](../AGENTS.md)、前后端全套检查、独立扩展前端与新增组合回归；不得只报告新增单测数量。
真实浏览器、跨平台进程树、媒体编解码、真实 10 GiB 性能及断电实验独立列项；未执行的项目明确记录。
测试使用临时工作区、白名单种子夹具和元数据/子进程替身，不安装真实共享依赖，不调用模型或收费服务。
验收报告按“根因 → 新契约 → 回归路径 → 实跑结果/限制”记录，并验证卸载、重装、备份及回滚均保留用户数据。
本 RFC 本身不增加任何新运行能力；以上提案需按批次落地并重新验证，不能借 M1–M4 的绿色结果宣称已经实现。
