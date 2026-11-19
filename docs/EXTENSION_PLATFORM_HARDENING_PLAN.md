# 扩展与主题平台加固实施记录

日期：2026-11-19。基线：`cf54c68`；审查原文见根目录《架构详解.md》。该文记录修复前的固定版本，不将其历史验收结果当作本轮结果。

## M0：契约与执行顺序

已按模块通读根目录架构审查、README、ROADMAP、THEME_PACKAGES、EXTENSION_MARKET、EXTENSION_BACKUP_CONTRACT 与扩展 SDK 说明。实现遵守三层信任边界，不增加日常创作界面入口，不包装 AppContext 为伪稳定 SDK。

### 私有数据布局与旧数据

```text
extensions/<id>/                         可执行包，公开分发
themes/<id>/                             独立主题包，公开分发
extensions_data/<id>/settings.json        SDK 设置，宿主保留
extensions_data/<id>/preferences.json     宿主/窗口偏好，宿主保留
extensions_data/<id>/...                  受审备份参与者的业务数据
theme_data/<id>/preferences.json          所有来源主题的私有偏好
theme_data/<id>/wallpapers/<id>.json       上传媒体元数据
theme_data/<id>/wallpapers/<id>.<suffix>   上传媒体
```

同一个 `PrivateStore(kind, id)` 负责身份、路径、严格 JSON、有界读取、原子写入及媒体校验。保留既有 `extensions_data` SDK/参与者契约，避免搬迁扩展业务树。新上传绝不写入 `themes/`。

旧 `extension_data/<id>/preferences.json`、`themes/<id>/user_wallpapers/` 是明确登记的旧来源：读取时在新位置不存在时回退；新写入只使用新位置；同名不同内容保留两份，canonical 优先并由诊断列出 shadow/conflict，不自动覆盖、合并或删除旧文件。媒体删除是显式操作，须删除该媒体的所有已识别副本，避免旧副本复活。卸载默认保留私有状态，只有明确 `delete_data=true` 才校验后清理所属新旧数据。整个过程不在本机自动搬迁或删除任何用户数据。

备份文件目录只有一份受验事实源；head、快照、归档白名单/限额和恢复校验共用它。新旧物理来源均进入完整工作区备份，包含已卸载保留数据；公开主题 ZIP 始终只含包资源。恢复不依赖主题当时已注册，也不执行归档中的扩展代码。SDK 保留文件不能被扩展参与者抢占或修改。

### 并发偏好协议

GET/PUT 保留 JSON 对象接口，响应携带内容 revision/ETag。新增类型化 PATCH：`{expected_revision, path: string[], value}`，path 为 JSON 对象子树路径，空路径表示整个对象；校验 revision、读取、子树更新、原子落盘在同一任务操作屏障中完成。冲突返回 409，不静默覆盖。宿主浮窗只更新 `floating_surfaces.<surface_id>`。

前端按 QueryClient 和资源键串行提交，在真正发送时取得最新权威 revision；每项意图拥有递增序号，只有最新意图可更新可见 cache/草稿或回滚。冲突先重取，仅允许重放明确子树意图，不自动重放整对象写入；卸载后请求可完成持久化，但不得回写已失效组件状态。

### 可携带主题身份

采用逻辑卡片根 `.theme-card[data-theme-id="self"]`。CSS 扫描器只在选择器语法位置识别此根；`/card-style` 与全主题样式服务以当前真实 ID 确定性绑定，随后执行卡片隔离过滤。旧包显式 ID 在受验打包时规范成逻辑根，注释、声明值和 URL 不变；不在导出时对任意 CSS 做全局字符串替换。主题资源内容身份与运行时绑定分离，往返导出稳定。

### 分阶段文件与验收

| 阶段 | 主要文件范围 | 进入下一阶段的验收 |
| --- | --- | --- |
| M1 | `private_store.py`、`extension_preferences.py`、`api/theme_preferences.py`、`backups/{extension_data,ui_data,participants,themes}.py`、卸载路径、对应测试 | PrivateStore 边界、四类主题与扩展的 API→head→备份→重启恢复矩阵，保留/删除/旧路径测试，目标 Ruff |
| M2 | `extensions/dependencies.py`、`theme_media.py`、`theme_packages.py`、主题资源路由、拆分 extensions 路由、前端有效媒体决策 | 依赖 closure/marker/cycle/固定计划、主题往返/card CSS、两种 ZIP 入口一致、媒体 MIME/动画矩阵、前端目标测试 |
| M3 | 偏好 API/模型、`web/src/api/open.ts`、设置面板、`extensions/host.tsx` 与桥 | CAS/子树/兄弟写入、Deferred 乱序/卸载、单 iframe 长会话/active/通知/窄屏/穿透结构，类型检查 |
| M4 | 协议 Schema/生成器、CTK CLI/只读诊断、跨模块测试、浏览器专项脚本、CI | 下列全量门禁；浏览器存在才执行专项，否则交付一键脚本并明确未实跑 |
| M5 | `docs/HIGH_EXTENSIBILITY_RFC.md`、ROADMAP、本文验收记录、根架构文档状态链接 | 仅在 M1–M4 代码与生成产物门禁通过后写 RFC，不提前实现槽位/Sidecar/通用框架 |

命令使用现有 `.venv/Scripts/python.exe`，不安装共享 Python 包或浏览器：

```powershell
.venv/Scripts/python.exe -m unittest discover -s server/tests -t server -q
.venv/Scripts/python.exe -m ruff check server extensions clients tools
.venv/Scripts/python.exe -m ruff format --check server extensions clients tools
.venv/Scripts/python.exe clients/python/generate.py --check
.venv/Scripts/python.exe -m unittest discover -s next/tests -t next -q
.venv/Scripts/python.exe tools/check_distribution.py
npm --prefix web run format:check
npm --prefix web run typecheck
npm --prefix web test
npm --prefix web run build
npm --prefix web run gen:api
npm --prefix extensions/ai-assist/page test
```

若环境已提供 pytest，再实际执行后端 pytest；仓库权威 unittest 门禁不以 pytest 缺失替代。生成器重新运行后再以 check 或临时文件比较确认零漂移。数据清单在本机已有运行差异，必须如实列出；干净 Git 种子校验单独报告，禁止刷新清单。真实浏览器、真实模型/GPU、真实 pip 安装均与模拟验收分开。

M0 结论：方案没有不可逆数据迁移或自动删除取舍，可以直接推进 M1。每阶段先完成所有编辑，集中运行对应验收，通过后记录并组织提交。

## 实跑记录

### M1 已完成

根因：包扫描与私有状态共享目录假设；扩展偏好目录分裂；SDK 仍保留独立的安全校验实现。
新契约：PrivateStore 统一身份、祖先路径、严格 JSON 与原子保存；私有状态文件清单贯穿 head、快照、白名单及重启恢复。已知旧来源保留并完整备份；默认卸载保留数据，显式删除校验所属树。旧壁纸容器允许同 ID 重装，注册失败保留原私有文件。

实跑：`test_private_store`、`test_theme_private_store`、`test_private_data_lifecycle`、`test_backup_ui_data`、`test_backup_participants`、`test_backup_themes`、`test_extension_data`、`test_theme_preferences`，61 项通过（28.172 秒）。SDK 适配额外覆盖 `test_backup_extension_data`，其所属 6 模块共 54 项通过。首次局部验收发现测试误用 `get_doc` 的不存在返回契约，改为断言 NotFound 后集成通过；没有放宽产品校验。M1 客户端与 TS OpenAPI 产物已重新生成。最终全量门禁另行记录。

### M2 已完成

根因：dry-run 与安装二次解析、主题 ID 与卡片选择器耦合、媒体适配丢失字段、ZIP 两份校验及 HTTP 职责混杂。
新契约：精确 pins + 宿主版本 constraints + `--no-deps` 固定计划，安装后校验完整依赖闭包与原宿主版本；导出选择器规范为逻辑 `self` 并由服务端绑定；包内与上传媒体共享 MediaDescriptor、显式 MIME 和有效背景选择；内存 ZIP 适配复用磁盘权威校验；路由按 transport、surfaces、private、theme_catalog 拆分，权限与操作 ID 保持不变。

实跑：主题/偏好/扩展/面板/依赖及新平台契约 91 项通过（27.057 秒）；前端 4 文件 198 项通过，含 160 条来源×媒体×动效组合；tsc、Ruff lint、301 文件格式、客户端 check 通过。初跑发现旧字段集合/目录断言和探测函数 patch 路径需要随契约调整；新增媒体组合测试还捕获统一助手未传 assets 命名空间，修正后上述整批通过。未将格式头部夹具视为真实解码验证。

### M3 已完成

根因：整对象并发写与旧响应回写，渲染回调更新和 iframe 会话清理相耦合。
新契约：强 ETag、同屏障 CAS/子树 PATCH；按 QueryClient/资源串行的意图队列和权威对账，整对象远程冲突不重放；草稿保留未提交字段，卸载后停止组件写回。浮窗只写所属子树，订阅跟随 iframe 文档与 activation/digest，active 仅挂起；增加四生命周期通知、窄屏夹取、容器穿透、失败反馈和逃生键硬保护。

实跑：后端并发/偏好/备份等 6 模块 71 项通过（33.482 秒）；独立审查补出的注释分隔与 @scope/@supports 身份绑定由平台契约 5 项通过；前端队列 10、设置面板 7、浮窗 8，共 25 项通过；tsc 与相关 Prettier 通过。包含双线程 CAS 唯一胜者、Deferred 旧成功/旧失败、已观察 GET 新版本后旧 PATCH 迟到、双 QueryClient、卸载和同 iframe 长会话。真实浏览器专项在 M4 单独执行。

### M4 已完成

新契约与工程资产：

- Manifest、Panel HTTP、Panel/Workspace/主题设置消息和限额由 `extensions/protocol.py` 统一声明并进入两份 OpenAPI；`extensionProtocol.ts` 为生成的类型/运行常量，生产消费者已接线。媒体类型也引用生成响应模型。
- 只读 CTK 与管理员诊断 API 共用结构化发现；旧数据冲突、无索引媒体、卡片过滤和摘要变化可查，不执行外来代码或输出私有值。运行诊断必须显式启用，容量有界。
- 流式对抗语料涵盖 104 种任意分块、伪边界、提前拒绝、断连/取消、磁盘临时文件回收；CSS 语料覆盖注释、转义、大小写、image-set、畸形闭合、兄弟选择器。
- 四来源备份矩阵中的扩展主题经真实临时扩展包审阅/启用注册，重启恢复不执行归档代码；显式重装启用后读回已恢复状态。

真实浏览器发现并修复了额外生产问题：设置页 CSP 在 `sandbox allow-scripts` 后缺分号，导致 `script-src` 被当作 sandbox flag、全部作者脚本和桥均无法运行。修复并增加按指令拆分的 nonce 回归。修复后，Chrome 157.0.8103.50 实际通过内容穿透底层按钮、标题栏交互、遮挡 CSS 下逃生，以及 fetch/图片/顶层导航阻断；**自身导航仍有 1 次请求到达探测端**。维护者明确选择“保留现有设置页，接受自导航外发限制”，这是对最初绝对断网表述的显式例外，未将其伪装成阻断通过，也未新增任何业务 API 权限。

| 门禁 | 实际结果 |
| --- | --- |
| 后端 unittest 全量 | 1118 项，首跑 1 失败、1 跳过（367.815 秒）；唯一失败为新增 CTK 测试 `subprocess text=True` 遗漏 encoding。修复后受影响编码/CTK/主题/协议 24 项通过，强化后的四来源真实重启矩阵单项也通过。遵循仓库只重跑受影响验证，不声称重新跑过全量 unittest |
| 后端 pytest 全量 | 系统已有 Python/pytest：1061 passed、2 skipped，另 892 subtests passed（712.68 秒）；两条 ZIP 重复成员警告来自拒绝测试。未向 `.venv` 或共享环境安装 pytest/第三方包 |
| Ruff lint / format | server、extensions、clients、tools 全通过，313 个文件格式一致 |
| Python 客户端/协议生成 | 均重新生成，两个 `--check` 通过 |
| TS OpenAPI 一致性 | 再生成前后 SHA-256 相同，零漂移；CTK 模型命名与既有工作流诊断的冲突已改为 `ExtensionDiagnosticReport` 后验证 |
| 前端 Prettier / tsc / Vite | 均通过；Vite 保留 >500 kB chunk 提示，不是构建失败 |
| 前端 Vitest 全量 | 84 文件，782 项通过；白名单改为同源生成常量后受影响 4 文件 186 项通过 |
| 独立 AI 扩展前端 | 22 项、Prettier、build 通过，dist 与既有提交无漂移 |
| Spike | 80 项通过 |
| CTK 随包实例 | AI 扩展与壁纸主题静态检查 valid=true；不是执行或代码信任认证 |
| 本机发行清单 | check_distribution 和 build_distribution --check 均因原有 3 项差异拒绝通过；未重置个人数据、未调用 --approve-changes |
| 同提交干净种子/发行 ZIP 冒烟 | 只用清单夹具及 Git 中已批准的 64 文件，校验通过；当前候选代码打包 431 成员、ZIP CRC 通过，临时产物已清理，未签名、未发布 |
| 真实浏览器专项 | 系统 Chrome + 既有 Python Playwright，临时工作区/回环服务执行；成功项与已接受自导航边界见上，未安装浏览器 |

额外边界：没有真实模型、GPU、云端或收费服务调用，没有真实 pip 安装测试，没有签名发布或跨浏览器/全编解码认证。本机数据不是可直接发行的干净默认数据。工具说明、诊断开启方式和一键浏览器命令见[平台 CTK](EXTENSION_PLATFORM_CTK.md)。M1–M4 的代码、生成物与受影响验证已通过，可进入仅设计的 M5。

浏览器脚本在 Windows 上由父进程持有临时工作区，再结束并等待子进程后清理，避免 TerminateProcess 跳过子进程 finally。修正后真实专项重跑通过，父进程所属临时树残留为 0；此前本轮创建的 5 份探测树经专用 fixture 身份校验后清理，未匹配的路径不删除。

### 八项发现的交付映射

| 发现 | 根因 → 新契约 | 回归路径 | 实跑证据 |
| --- | --- | --- | --- |
| TB-1 | 内置主题私有壁纸目录被当成缺损包 → 包/私有状态物理分离，旧容器只按明确形态识别 | `test_backup_ui_data.py` 四来源上传→head→备份→真实重启 | M1 集成 61 项通过；真实扩展贡献夹具强化后单项通过 |
| TB-2 | 偏好和媒体未接备份事实源 → 同一受验文件清单驱动摘要、快照、归档校验与重启恢复 | `test_backup_ui_data.py` 篡改、过期计划、保护备份、旧来源；`test_theme_private_store.py` | M1 集成通过，后端全量 pytest 通过 |
| EX-1 | 单数偏好目录绕开 SDK/参与者 → 复数所有者目录写入，旧路径只读回退且完整保留/备份 | `test_private_store.py`、`test_private_data_lifecycle.py`、`test_backup_ui_data.py` | M1 集成与 M3 后端 71 项通过 |
| EX-2 | 基础传递检查放在 extras 循环中，二次 pip 解析不固定 → 完整 closure/marker/cycle，精确计划和宿主约束，安装后验收 | `test_extension_dependencies.py` 元数据与子进程矩阵 | 22 项及 M2 后端 91 项通过，无真实 pip |
| TB-3 | 内容身份改变而选择器绑定旧 ID → 逻辑 self，服务端按实际 ID 绑定；仅改选择器属性值并保留注释/声明 | `test_theme_packages.py`、`test_theme_platform_contract.py` 往返、注释、scope/supports | M2 91 项、后续平台契约和受影响 24 项通过 |
| F-FE-1 | React 回调变化撤销会话订阅 → iframe 文档/activation 所有权、稳定引用、active 挂起及失效会话回收 | `host.test.tsx` 同一 iframe 长会话、路由、目录刷新、派发中卸载 | M3 host 8 项、协议接线 22 项、前端全量 782 项通过；真实穿透/标题栏也通过 |
| F-FE-2 | 无条件整对象并发写及旧响应回写 → CAS 子树、资源队列、序号/epoch、脏草稿与失败权威对账 | `test_preference_concurrency.py`、`preferenceWrites.test.tsx`、`ThemeSettingsPanel.test.tsx` | 后端 13 项并发矩阵、前端队列 10/面板 7 项及完整 pytest/Vitest 通过 |
| F-FE-3 | 用户媒体适配丢失 animated → 同源 MediaDescriptor/MIME、Provider 与卡片共享有效背景 | `test_theme_platform_contract.py`、`useTheme.test.tsx`、`ThemesSection.test.tsx` | M2 前端 198 项（含 160 组合），全量 782 项，受影响 186 项通过；不冒充真实解码 |

### M5 已完成：仅设计

交付 [HIGH_EXTENSIBILITY_RFC.md](HIGH_EXTENSIBILITY_RFC.md)，以 `a23923c` 平台契约及 `d5a4164` 验收清理为基线，覆盖宿主槽位/上下文/同步快捷键、分层与事件驱动主题、窄版本 SDK/互操作/Sidecar、以及大包维护 Job。每项明确协议草图、所有权、状态机、分期文件、验收矩阵及回滚，不实现新运行能力。

最终校读额外明确：组合定义属于服务端文档，浏览器激活选择不混入工作区备份承诺；私有媒体继续归原主题所有者；Sidecar 不是 OS 沙箱；维护 Job 只能以确切宿主身份获得屏障自排除，不让自身进度掩盖用户数据变化；HTML 设置页保留已接受边界。UTF-8、JSON 示例、相对链接及围栏检查通过，路线图同步。M5 只改文档，不重复运行已通过的代码门禁。
