# Wave 4 R3 — CrossAudit-5-Privacy-Hygiene-CI

审查基点：`38838ab43cf3d056951f2fc6c52afb737d34e3c6`。冻结提交：`50bb3fad2189b54f45f4cc0e0c6d2071d2e73090`。两者已独立经 Git 解析。审查先完整阅读任务及仓库三份入口文档，再检查历史、源码与执行证据；没有用旧轮结论代替初次独立审查。

**最终职责范围签字：VERIFIED PASS（冻结提交的隐私、任务 Git 内容、本机执行证据与指定远程 CI）。** R3 全任务仍因其他职责已实证的产品缺陷退回；任务缓存最终清理和后续提交收口未发生，不在本签字中冒充完成。

## Standards

### Blocker / High / Medium / Low

本职责范围内均无已证实的源码、提交内容或隐私违规发现。

- 全任务 8 个提交、最终 76 个变更路径；检查可达历史中全部 120 个新增或改写 blob，包含中间提交版本，未只检查最终 diff。
- 全部新增 blob 为 UTF-8 文本；未发现图片或其他二进制、内嵌图片载荷、用户目录绝对路径、凭据形状、长字面凭据赋值、私钥、JWT 或带鉴权参数下载链接。扫描只保存文件位置与类别，不保存可疑值。
- 文档统计 JSON 未包含 API 节点图或 UI nodes/links 原始图。进一步检查字符串字段，图片扩展名命中仅来自公开来源 URL 或语料文件标识；没有作者提示词或模型权重字段载荷。公开来源、哈希、节点类型、指针和结果统计不冒充原始图。
- 已知公共语料目录共 103 个文件：47 JSON、55 PNG、1 WebP。逐字节 Git blob 哈希与全任务新增 blob 交集为零；未将原始公开样本复制入提交。
- 新增回归采用中性合成节点、短占位文本和人为拓扑。图片导入测试通过 PIL 即时构造 2×2 白色 PNG/WebP，不读取第三方图片；大图测试通过循环生成节点。既有槽位契约 JSON 的本轮改动是分析版本及精确保真期望，不是新增外部样本库。
- 未读取 credential store、环境 secret 值、Cookie、浏览器 profile 文件、会话抓包或其他聊天；未访问私有原图，未修改原始用户工作区。

证据：`history-scan.json`、`json-strings.json`、`corpus-hash-intersections.json`；媒体合成与泄漏断言见 `server/tests/test_workflow_import_media.py`；中性集成拓扑见 `server/tests/test_workflow_wild_contracts.py`。正则扫描不是形式化保密证明，结论同时依赖结构检查、合成夹具源码检查与公共语料字节交集核验。

## Spec

### Blocker / High / Medium / Low

本职责源码与固定 R3 两次 CI 范围无已证实缺陷。远程门禁和清理分别记录实际状态：前者已全绿，后者有意保留未完成。

### 本机门禁的真实覆盖

独立阅读执行器、原始日志及结果 JSON，而非仅转述主控结论：

| 检查 | 实际证据 |
|---|---|
| 后端完整 discover | 1,724 tests，1,097.772 秒；`OK (skipped=8)`；结果退出 0 |
| Ruff / format | 两项退出 0，424 个文件格式无需修改 |
| Python 客户端 | 原始结果退出 0；本审查额外独立执行 `--check` 退出 0 |
| Spike | 80 tests，退出 0 |
| 随包数据 | 验证 64 个文件，退出 0 |
| 前端 format / typecheck | 两项退出 0 |
| 前端测试 | 118 个测试文件、964 tests passed，退出 0 |
| 前端 build | 退出 0；既有大 chunk 警告仍存在 |
| 前端 API 类型生成 | 执行退出 0，后续工作树没有生成物差异 |

完整后端进程于 UTC 2026-11-25 16:13:05—16:31:26 执行。其结果中 HEAD 为尚未提交本轮源码的前一提交，同时有当时 tracked diff 摘要；因此它是本机工作树执行证据，不能单独证明冻结提交 SHA 的远端结果。准确 SHA 的验证另由下面的新 CI 实际 checkout 与日志完成。此前被主动停止的旧进程未计为通过。进程级 Git 注入隔离只设置 `GIT_CONFIG_COUNT=0`，没有读取或更改其他 Git 配置值。

### 指定 R3 远程 CI：两次 run、六个 jobs 实际全绿

独立经 `gh run view`、两份完整原始日志、逐 job checkout 输出和 GitHub commit parents 核验。不是仅查 API 顶层绿色，也没有使用旧任务提交的 CI 结果代替本轮结果。

- [push run 45655165365](https://github.com/lumingya/comfy-comic-studio/actions/runs/45655165365)：`event=push`，`headSha=50bb3fad…`，三 job 的日志实际 checkout 全部为 `50bb3fad2189b54f45f4cc0e0c6d2071d2e73090`。UTC 2026-11-25 16:56:04 完成，`conclusion=success`。
- [PR run 45655190322](https://github.com/lumingya/comfy-comic-studio/actions/runs/45655190322)：`event=pull_request`，`headSha=50bb3fad…`；三 job 日志实际 checkout 全部为 `86cf06010c65c2d838ec11ff9da708023a657aac`，其父提交分别为主分支 `766c38b9d602ab43f565bca3a52e813dbd2f488a` 和冻结提交 `50bb3fad…`。UTC 2026-11-25 17:00:35 完成，`conclusion=success`。PR 的合并快照包含主分支其他改动，计数不能伪装成纯任务分支的同一套计数。

| Run / job | 真实运行环境和套件结果 | Job 结论 |
|---|---|---|
| push gate | Ubuntu；Python 3.13.18、Node 20.20.2；后端 1,724，`OK (skipped=3)`；Spike 80；web 118 文件 / 964 项；独立扩展 2 文件 / 34 项 | success |
| push launcher Ubuntu | Python 3.11.18；full launcher 31，OK；完整后端 1,724，`OK (skipped=3)` | success |
| push launcher Windows | Python 3.11.9；full launcher 31，OK；完整后端 1,724，OK | success |
| PR gate | Ubuntu；Python 3.13.18、Node 20.20.2；后端 1,770，`OK (skipped=3)`；Spike 80；web 120 文件 / 986 项；独立扩展 2 文件 / 34 项 | success |
| PR launcher Ubuntu | Python 3.11.18；full launcher 31，OK；完整后端 1,770，`OK (skipped=3)` | success |
| PR launcher Windows | Python 3.11.9；full launcher 31，OK；完整后端 1,770，OK | success |

两份 gate 日志均实际包含后端及客户端 / 工具 lint 和格式、Python 客户端生成一致性、前端 API 生成后 `git diff --exit-code`、前端格式 / 类型 / 测试 / build、随包检查、独立扩展与发行包冒烟，相关步骤均为 success。Linux / Windows 的 full launcher 使用 `MIO_LAUNCHER_FULL=1`，包含从零启动器执行，不以静态脚本检查代替；随后另跑完整 server discover。

同时读取了实际 checkout 提交的 workflow blob：push 为 `b9ea6beb0eb0f2693672508264eff4e9d841699c`；PR merge 为 `0a5aa700a3b93ab5713b38e4dd5725ea82eedc01`。PR 主分支版将 launcher job 预算设为 60 分钟，不能误写为纯分支版的 30 分钟，也没有因此删减完整后端执行。

脱敏细证为 `ci-verified.json`，含事件、head、真实 checkout、父提交、工作流版本、每步结论、实际命令、套件统计及原始日志字节数 / SHA-256。原始日志只留临时审计区供核对，不直接提交。上述是 R3 固定源码的完成证据；产品读取冻结解除后的源码、工作树或新 CI 均不包含在这份签字内。

旧 PR run `45630115612` 的失败只作上下文：实际 checkout `792284d988cc703e269cf288e59637947135e14d`，父提交为当时主分支和旧任务提交。三个 jobs 的完整 server 套件均暴露两项隔离根断言及一项重复清理错误。主分支后续 `f91546df8836576b255ba4940fb20fcdf610e339` 对这些断言与清理归属有直接修正，最新 PR merge 已包含该修复；不能由此反推最新 CI 一定通过。旧失败摘录与父提交见 `old-ci-context.json`。

### 工作树、推送与临时目录

初次审查及交叉探针后，冻结分支 `git status --porcelain` 均为空；未跟踪非忽略文件为零。忽略项为 Python / Ruff 缓存、依赖目录和前端构建产物；未发现任务外部样本目录混入。已跟踪随包文件仍受 skip-worktree 保护，本轮未改 `data/`。冻结阶段分支相对 upstream 为 0 ahead / 0 behind。之后已向主控释放产品读取冻结以便修复其他审查问题；这不是对修复期间当前工作树或未来推送状态的声明，最终后续提交仍需重新核对。

审查时有意保留的任务临时根目录为 `mio-wf-recovery-20261125`。其一级目录完整盘点为：`.browser-workspace.mio-recovery`、`__pycache__`、`audits`、`before`、`blind-r1`、`browser-profile`、`browser-workspace`、`civitai`、`community`、`gate-instrument`、`repairs`、`supplement-complex`、`supplement-official`。嵌套审查与语料均受该任务根包含；本审查新增内容只在 `audits/r3/privacy/`，没有在别处建立缓存。浏览器 profile 只盘点目录名，未读取其文件。

旧 `mio-wf-hunt-74af19ae` 已实际核验不存在。系统 TEMP 同前缀另见 `mio-candidate-gate-1us8jvzb`，归属未核验，未读取或删除；未知归属目录不作为任务清理对象。此前提及的其他目录不能仅凭名字删除。当前仍需保留任务语料供本轮审查收敛，故本报告明确不声称缓存已清理。

## 同轮交叉互核（职责范围外）

收到本轮其他审查的新发现后，本审查独立构造 5 个全新的中性内存图，通过公开 compile / inspect / slot 入口重复核验，未执行对方的采集脚本、未使用外部原图。

| 其他审查发现 | 本审查独立结果 |
|---|---|
| High：参考生成依赖被误作主生成阶段 | 控制参考、风格参考两个变体均复现：只写辅助域，主域不变，`warnings=[]`、`compilable=true` |
| Medium：辅助输出继承 payload 的选择范围 | route 为 `undeclared-output-port`，仍写第一分支的文本和尺寸 |
| Medium：局部对象文本镜像补入未请求标签 | 仅改一个权重，原来不在该字段中的另一条目被补入 |
| Medium：可接受的数字字符串链权重不保真 | 仅改 clip，未请求 model 字段由字符串 `0.7` 变为数值 `1` |

五个探针均保持源文档不变；这不能抵消编译副本语义错误。上述产品缺陷支持本轮整体退回，但不会被伪装为本审查独立发现的隐私问题，也不会因隐私检查通过而被豁免。证据见 `cross-verification.json`；分级及修复归属由当前轮 Generality / Compile 报告承接。

## 签字边界

Standards：0 Blocker / 0 High / 0 Medium / 0 Low 隐私或提交卫生发现。Spec：冻结源码、本机证据及指定 R3 两次 CI 范围 **VERIFIED PASS**。此签字不豁免同轮已独立复现的 High / Medium 产品缺陷，R3 全任务仍是 **REQUEST CHANGES**。

缓存最终删除及后续修复提交的干净推送状态尚未完成，也未伪报完成。需要主控收集脱敏材料并确认本轮审查不再需要样本后，再对已确认归属的任务临时根进行清理；发生后才可另作收口核验。

公开保存仅使用本报告及脱敏 JSON 细证。原始 CI 日志、公共样本原件和任务执行脚本仍是临时调查材料，应在主控收集脱敏证据后随任务临时根清理，不直接复制到仓库。
