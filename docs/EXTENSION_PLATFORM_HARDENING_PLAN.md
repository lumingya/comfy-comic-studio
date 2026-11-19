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
