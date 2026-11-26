# R5 隐私、仓库卫生与 CI 独立首版

审查 UTC：2026-11-26T07:18:27.798035+00:00。固定候选 `fa6308384826fad7629b2c727d70230cc7951d05`；完整任务基点 `38838ab43cf3d056951f2fc6c52afb737d34e3c6`，基点确为 merge-base。已阅读原任务、共同约束、职责验收和仓库三份入门文档。

候选职责结论：**未发现触发整轮打回的 Blocker / High / Medium；保留 1 项 Low 发布卫生问题。** 这不是全任务完工声明，也尚未签发整轮 `VERIFIED PASS`。首版独立完成，未读其他 R5 同伴报告；跨审与最终交付另写文件，不改本版。

## 分级发现

**R5-PRIV-L1 — Low — 三处历史审计文档保留了同一合成测试资产文件名。**

位置：`docs/reviews/comfy-2026-11-25/r2/web.md:30`、`r2/web-after.md:57`、`docs/reviews/comfy-2026-11-26/r3/web.md:56`。原值长度 43，SHA-256 为 `65157057980324a03a4474023a5bbe481cf1649cab4936e5ec754df9865f30bd`；本报告不复述其原值。三份文档属于本任务新增，前两份在 `50bb3fad2189b54f45f4cc0e0c6d2071d2e73090` 引入，后一份在 `eb876cfbb8cf14de34a99b6544469460c11acc24` 引入。

旧报告声明该素材为中性合成夹具；没有证据将其认定为私人模型标识、作者提示词或凭据泄露。问题在于本轮公共投影规则明确禁止保留此类文件名。最小修正是仅将该字面量替换为中性描述与长度/哈希，保留测量、稳定键、操作结果和历史结论。原始 Git blob 与每文件 SHA 已记于 `publication-low.json`。无需因此改产品源码。

## 完整差异与合成来源

- 完整范围为 148 个文本文件、83 份文档（35 JSON）、19 个后端测试文件；没有新增或改变的二进制文件，Git diff SHA-256 为 `2effe4a2697741653baa8b16876b74efd70ee87a74bb1bfacb634b53a780d5df`。
- 文档 JSON 的递归结构键扫描和全部文档的引号键扫描未发现禁止的图结构键；凭据、私有路径、邮件、长媒体内联及常见令牌模式无命中。扫描存在通用局限，不能将模式零命中夸大成对任意字符串的绝对隐私证明。
- 186 个唯一来源 URL 只落在公共源码/素材来源域及 1 个测试保留域；无用户名密码组件、敏感查询参数或直接模型权重 URL。只核验来源指针，没有重新抓取素材或访问浏览器登录态。
- 新测试的文字与媒体构造经 AST 和字节常量检查：所查提示字段为短中性值，图片夹具由测试创建，最大字节常量为 50 字节，没有原始版权样图混入。原有槽位契约的 3 条新增唯一文本值全部沿用基点已有标签标识，新标识数为 0；它们属于保留已有图内容的预期更新，不是新下载工作流。
- 新文件导入 route 与解码器静态检查没有持久化图片、排队或服务外呼；仅进行有界 JSON/PNG/WebP 元数据解析。Python 与 AstrBot 生成客户端字节一致，二进制请求媒体类型、响应模型与 OpenAPI 相合；真实生成一致性另由下述 CI 执行证据支持。
- 当前原始字节冻结：server 405 个 Python 文件聚合 `7a8dec42eb98849d6eff92dfeb84dd9b329136ee7e16a754b367bb7dda60da17`；产品运行时代码 217 个文件聚合 `5a5ee950ae0c972791ae17fab92978579adec7d6d419133e6eaf9eb9e649377d`。它们与共同说明相符，未将旧候选运行伪称为本候选运行。

## 远端实际执行证据

复用观察员已获取的原始六份 job 日志、run/jobs JSON、合并提交 metadata 和确切源码 bytes；逐一重算哈希、解析真实 checkout 与脚本。本审查新增远程查询和下载均为 0。

| 事件 | 实际 checkout | Windows 完整后端 | Linux launcher 完整后端 | Linux gate 完整后端 |
|---|---|---|---|---|
| push `45768262520` | `fa6308384826fad7629b2c727d70230cc7951d05` | 1823 / 0 skip | 1823 / 3 skip | 1823 / 3 skip |
| PR `45768270363` | `8b9318a7ceba2e37f1f24e6d113cf39d49510d2a` | 1969 / 0 skip | 1969 / 3 skip | 1969 / 3 skip |

六个 jobs 和所有登记 steps 的原始 metadata 均为 completed/success；每个 checkout 均来自日志实际 `git log` 的后继 SHA。合并提交 parents 的顺序为 `e7a4eac44bacb64f6d74dd5a028d0380b0aa69f8`、`fa6308384826fad7629b2c727d70230cc7951d05`，tree 为 `23c53c61fae3f5a02b5d37c94953583beca1d492`。没有用 API head 字段代替 checkout，也没有把 1823 与 1969 当成同一分母。

14 条 required 命令的全部出现位置都与实际 emitted scripts 匹配；两个 gate 都是 fail-fast Bash 并有成功 step metadata，原 AGENTS 的 lint 范围由 server+extensions 与 clients+tools 两组实际完成。额外的扩展契约、文档自测/扫描、示例和 bootstrap lint、前端生成文件 diff、面板脚本、分发构建检查、独立助手格式/测试/构建/dist diff、真实 launcher 全模式和发行包 smoke 也在实际脚本中并已成功完成。两份实际 workflow 的命令一致；分支 launcher 预算 30 分钟，合并版本为 60 分钟。

两个 gate 的可见结果还包括：Spike 各 80；前端 push 119 文件/965 测试、PR 133 文件/1100 测试；助手各 2 文件/34 测试；64 份随包文件和清单检查通过。源码生成契约/客户端 current 与前端生成后的 Git diff 均成功。发行 smoke 明确为未签名，不声称签名更新验收。

Linux 每次恰好 3 个 skip，源于三个必须在 Linux 跳过的 Windows 文件系统用例；Windows 为 0。两份 skip/TLS 关键源码在分支、合并和本地实际 bytes 完全一致，Git blob 与 SHA-256 均独立匹配。真实 loopback TLS ClientHello、SSLContext HTTPS、截止/取消断言确实存在于标准发现的测试模块，证书缺失会增加 skip；因此成功的完整 quiet suite 及耗尽的 skip 预算支持“无额外 TLS skip”的**源码锚定推论**。没有伪造逐 TLS 测试名称的运行日志或单项实测耗时。完整证据分别在 `ci-independent-log-review.json`、`ci-command-coverage.json`、`ci-raw-metadata-review.json` 与 `ci-extra-output-review.json`。

## 工作区保全与交付待证

当前任务 worktree 的普通 Git status 为 0；65 个受控 data 文件中 64 个具有 skip 标记。37 个 ignored 目录记录仅为 35 个缓存、web 构建产物和依赖目录；未递归读取依赖树，未清理任何目录。

原工作区在 2026-11-26T07:08:17Z 的有界观察为 5 项既有未跟踪记录、暂存与未暂存 diff 摘要均空；65 个受控 data 文件中 64 个 skip。仅存元数据与纯哈希，私有冻结在 `protected-workspaces-before-delivery.json`。没有更早内容基线，不能据此宣称历史全程未变，也不能把既有记录归因本任务；最终阶段应与本冻结比较并保留它们。

主控最后仍需补齐：五路首版后的交叉互核与签字；本 Low 的机械匿名化证明；明确白名单中的外部真实样本/缓存清理记录；最终文档及路线图状态；最终 task status 干净、原工作区冻结保持；最终提交已推送且最终 HEAD 的远端 CI 真实 checkout/命令结果。当前 fa 的绿灯不能代替未来提交的状态，外部原始素材尚存不能伪称已清理。

## 未测与审查过程限制

本审查无 Mio import、产品 HTTP、浏览器、测试/lint/build/GPU/付费服务运行，无全 TEMP 枚举或浏览器 profile 读取。没有替其他四职责判断产品泛化、编译或 UX。

一次旧夹具差异检查发生了终端遮罩遗漏，根部已获披露；后续只输出结构、计数和哈希。因此不声称审查工具输出全程零原文。此首版报告与公开机器投影另作递归安全检查，原工作区冻结仅作私有比对。

机器汇总为 `review.json`，来源文档 SHA 与所有首版文件 SHA 在汇总/封存中登记。
