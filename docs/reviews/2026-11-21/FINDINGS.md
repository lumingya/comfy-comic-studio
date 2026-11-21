# 发现与修复台账

固定原始范围：`git diff 6aa0f8f...125e07f`。开始时工作区干净，64 项随包数据保持本机保护。

本文件由主控维护；审查者在自己的报告中记录证据，并发消息通知主控。新的复审代理先读取本表，再按相关报告定位，无需重复加载全部历史过程。

| ID | 审查轴/领域 | 问题与触发条件 | 证据/报告 | 修复与回归 | 新代理复审 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| R1-PUB-01 | 持久化/备份 P2 | intent 后缺图，取消及后续重试失败仍阻塞备份 | [Publication](round-1-changes/publication.md) | [备份/GC](fixes/backup-gc.md)，含历史attempt结果关联补修 | [功能复核](round-2-verification/storage-completion.md) | 已关闭 |
| R1-PUB-02 | 持久化/恢复 P2 | stage1 完成却误用 stage0 local_result | [Publication](round-1-changes/publication.md) | [恢复修复](fixes/publication-recovery.md) | [功能复核](round-2-verification/storage-completion.md) | 已关闭 |
| R1-PUB-03 | 持久化/对账 P2 | 终态及早期checkpoint缺图时显式对账不能补取 | [Publication](round-1-changes/publication.md) | [恢复修复](fixes/publication-recovery.md)，含多阶段/lease组合补修 | [功能复核](round-2-verification/storage-completion.md) | 已关闭 |
| R1-PUB-04 | 持久化/丢弃 P2 | discard_result未联动delivery，单项重试仍阻塞 | [Publication](round-1-changes/publication.md) | [恢复修复](fixes/publication-recovery.md)，同item事务回滚 | [功能复核](round-2-verification/storage-completion.md) | 已关闭 |
| R1-PUB-05 | 持久化/回收 P3 | 未登记staging在删除任务和GC后遗留 | [Publication](round-1-changes/publication.md) | [备份/GC](fixes/backup-gc.md)，共享hash/链接反证 | [首份复核](round-2-verification/storage.md)、[功能复核](round-2-verification/storage-completion.md) | 已关闭，未重复三项链接/根外实验 |
| R1-UI-01 | 需求/画布 P1 | dirty旧草稿借新revision覆盖远端 | [Spec](round-1-changes/spec.md)、[UI](round-1-changes/bridge-ui.md) | [草稿基线](fixes/canvas-baseline.md)，含pacing交错补修 | [UI/媒体复核](round-2-verification/ui-media.md) | 已关闭 |
| R1-EXP-01 | 需求/导出 P1 | HTML/PDF丢格间留白正文 | [Spec](round-1-changes/spec.md) | [完整构图](fixes/export-integrity.md)，含小数相位/尾1px补修 | [导出复核](round-2-verification/export.md) | 已关闭 |
| R1-AST-01 | 规范/审阅 P2 | 旧提案完整after回退独立Bible改动 | [Standards](round-1-changes/standards.md) | [字段/句级delta](fixes/script-review.md) | [SDK/Script复核](round-2-verification/sdk-script.md) | 已关闭，注明既有缺口 |
| R1-SDK-01 | SDK P2 | 长阶段键导致生成后导出422且不能续跑 | [Ecosystem/SDK](round-1-changes/ecosystem-sdk.md) | [receipt修复](fixes/sdk-receipts.md)，新旧版本有界稳定键 | [SDK/Script复核](round-2-verification/sdk-script.md) | 已关闭 |
| R1-SDK-02 | SDK P2 | pending绑定可混入额外生成设置 | [Ecosystem/SDK](round-1-changes/ecosystem-sdk.md) | [receipt修复](fixes/sdk-receipts.md)，默认归一后全业务等价 | [SDK/Script复核](round-2-verification/sdk-script.md) | 已关闭 |
| R1-CLD-01 | 渠道 P2 | 真实阻塞read超过总截止 | [Ecosystem/SDK](round-1-changes/ecosystem-sdk.md) | [网络截止](fixes/cloud-deadline.md)，独享socket/SSLContext和清理 | [网络复核](round-2-verification/network.md) | 已关闭，DNS/无socket边界保留 |
| R1-MED-01 | 媒体桥/部署边界 | ASGI2.4断开清理延迟；默认2.3未证实 | [Bridge/UI](round-1-changes/bridge-ui.md) | [响应清理](fixes/media-cleanup.md) | [UI/媒体复核](round-2-verification/ui-media.md) | 加固已关闭，不冒称默认部署漏洞 |
| R1-AST-02 | 需求/审阅粒度 | 多句修改合成同一op，逐句展示但不能逐句接受/拒绝 | Spec 离线探针 | [句/字段修复](fixes/script-review.md)，33项Python与DOM回归 | verify_sdk_script_fixes | 已关闭 |
| R2-SDK-DEFAULT-01 | 集成/SDK | 新增Strip.rasterized默认字段使相同pending绑定误拒 | [SDK/Script复审](round-2-verification/sdk-script.md) | [默认契约回归](fixes/sdk-receipts.md) | 同一独立复审者窄验 | 已关闭 |

状态：待复现 → 已确认 → 修复中 → 待独立复审 → 已关闭。重复发现合并到原 ID；证据不成立时保留反证理由。

第一轮共五份主审报告；Canvas跨报告重复项合并。第二轮追加的取消重试、多阶段缺早期文件、小数相位、1px尾段和默认字段漂移均已纳入原项或独立集成项，未因首个回归变绿而忽略。`storage.md`保留其发现当时的开放状态，最终正常业务关闭矩阵以`storage-completion.md`为准；后者明确未重复三项链接/根外实验。

## 阶段完成标准

- 第一轮：五份独立报告已交付，每个发现有结论与证据，确认问题均有实际修复与回归。
- 第二轮：新的审查者检查上述修复，没有未关闭的已确认问题。
- 第三轮：其他模块的覆盖清单、发现与修复均已记录，新增修复同样有新代理复审。
- 收尾：生成物无漂移、必要门禁通过、最后提交推送并确认对应 CI。

## 其他文件审查

第三轮范围固定为 `ddf8d81` 的原变更集以外模块。恢复入口大小问题在生命周期与设置两份报告重复，合并为 R3-LIFE-06；附件删除后可读因保留合同未明确只记观察，不冒充漏洞。

| ID | 原模块问题 | 修复证据 | 新代理结论 | 状态 |
| --- | --- | --- | --- | --- |
| R3-LIFE-01 P1 | 并发安装混版/清pending | [更新事务](fixes/update-recovery.md) | [更新/安装复核](round-4-adjacent-verification/update-packages.md) | 已关闭 |
| R3-LIFE-02 P1 | 移走应用后中断，恢复器自身丢失 | [稳定恢复宿主](fixes/update-recovery.md) | [更新/安装复核](round-4-adjacent-verification/update-packages.md) | 已关闭 |
| R3-LIFE-03 P2 | --data未传入更新器 | [启动参数](fixes/update-recovery.md) | [更新/安装复核](round-4-adjacent-verification/update-packages.md) | 已关闭 |
| R3-LIFE-04 P2 | 扩展覆盖rename失败删除旧包 | [扩展发布](fixes/extension-lifecycle.md) | [更新/安装复核](round-4-adjacent-verification/update-packages.md) | 已关闭 |
| R3-LIFE-05 P2 | 信任快照失败仍active/半快照不能重试 | [扩展加载](fixes/extension-lifecycle.md) | [更新/安装复核](round-4-adjacent-verification/update-packages.md) | 已关闭 |
| R3-LIFE-06 P2 | 前端2GiB拒绝服务端允许的2–12GiB | [设置/上限](fixes/settings-drafts.md) | [设置/AI复核](round-4-adjacent-verification/settings-ai.md) | 已关闭 |
| R3-SCHED-01 P2 | queue回执写失败后重复提交 | [队列意图](fixes/queue-pool.md) | [事件/队列/鉴权](round-4-adjacent-verification/events-queue-auth.md) | 已关闭 |
| R3-SCHED-02 P2 | 一个坏端口阻断健康实例 | [实例校验/隔离](fixes/queue-pool.md) | [事件/队列/鉴权](round-4-adjacent-verification/events-queue-auth.md) | 已关闭 |
| R3-EVENT-01 P2 | Webhook重试忽略停用/删除/轮换 | [每次重试复验](fixes/webhook-dispatch.md) | [事件/队列/鉴权](round-4-adjacent-verification/events-queue-auth.md) | 已关闭 |
| R3-EVENT-02 P2 | 坏URL中断其后合法订阅 | [URL隔离](fixes/webhook-dispatch.md) | [事件/队列/鉴权](round-4-adjacent-verification/events-queue-auth.md) | 已关闭 |
| R3-EVENT-03 P3 | 首次并发emit产生多个worker/close遗留 | [生命周期锁](fixes/webhook-dispatch.md) | [事件/队列/鉴权](round-4-adjacent-verification/events-queue-auth.md) | 已关闭 |
| R3-ACCESS-01 P2 | WS握手后吊销/到期仍收新事件 | [只读持续鉴权](fixes/websocket-tokens.md) | [事件/队列/鉴权](round-4-adjacent-verification/events-queue-auth.md) | 已关闭 |
| R3-ACCESS-02 P2 | API夹具默认legacy回退读取本机data | [默认TEMP隔离](fixes/test-isolation.md) | [事件/队列/鉴权](round-4-adjacent-verification/events-queue-auth.md) | 已关闭 |
| SET-AI-01 P2 | 正常上传后backup/head失败 | [附件URL与往返](fixes/ai-backup.md) | [设置/AI复核](round-4-adjacent-verification/settings-ai.md) | 已关闭 |
| SET-AI-02 P2 | General/Channels旧draft覆盖已刷新设置 | [字段意图/CAS](fixes/settings-drafts.md) | [设置/AI复核](round-4-adjacent-verification/settings-ai.md) | 已关闭 |
| SET-AI-03 P2 | 删除会话404的pending污染new并卡住 | [会话epoch隔离](fixes/ai-drafts.md) | [设置/AI复核](round-4-adjacent-verification/settings-ai.md) | 已关闭 |
| SET-AI-04 P3 | 保存成功吞后续编辑/模式changed卸载宿主 | [保存快照及模式切换禁用](fixes/ai-drafts.md) | [真实宿主窄验](round-4-adjacent-verification/settings-ai.md) | 已关闭 |
| R4-SET-UI-01 P2 | arrive动画保留identity transform，使fixed保存条落到视口外 | [实际CSS/bbox反证](round-4-adjacent-verification/settings-ai.md) | backwards fill后桌面/窄屏浅深8图及坐标点击 | 已关闭 |
| R4-RENDER-FONT-01 P1 | Ubuntu无系统字体时复制Pillow内存字体失败，分带导出不可用 | 远端Ubuntu/Python3.11实际回归 | [局部字体相位代理](fixes/export-integrity.md)，31项相关回归 | [新字体复核](round-4-adjacent-verification/memory-fonts.md)，162个phase view | 已关闭，远端整合另核对 |
