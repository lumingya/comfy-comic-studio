# fa 候选 CI 与预览身份发布准备

本包仅归档五份明确白名单证据。状态为 **RESULTS_RECORDED_REVIEW_REQUIRED**：固定候选 CI 已有成功终态证据，但没有五路全 PASS、最终清理或整体任务完成签名。本次仅文件安全检查与投影，没有 Mio 导入、产品调用、测试、构建、浏览器、CI/gh/Git 查询或仓库写入。

| 证据 | 发布文件 | 范围 |
|---|---|---|
| 固定候选 CI | [原报告内容](ci/report.md)、[完整安全 CI 记录](ci/ci-verified.json) | 保全原内容，仅统一 LF 与单 EOF；包括实际 checkout、完整步骤、跳过数、制品与观察限制。 |
| 实际预览创建身份 | [服务器安全投影](preview/running-server-r5.json) | 仅 PID、前后端身份、模块聚合、CPU/优先级、预览 origin、制品/静态文件计数及创建后 catalog 计数。 |
| CI ZIP 来源证明 | [制品安全投影](preview/artifact-fa63083-provenance.json) | 仅公开制品身份、原 ZIP 实测 digest 结论、字节数、index SHA、文件总数和无本机构建标记。 |
| Chrome 空白连通前置记录 | [连通安全投影](preview/connection-headless.json) | 仅原记录时间、浏览器身份/模式/PID、连接及空白上下文摘要、CPU/优先级、候选身份；缺失 CDP 端口明确为 null。 |
| 出版完整性 | [双哈希与投影字段清单](manifest.json) | 输入/发布 SHA256、计算 Git blob SHA1、规范化、字段删除/推导与安全检查。 |

## CI 身份与限度

固定分支 HEAD 是 `fa6308384826fad7629b2c727d70230cc7951d05`。原 CI 证据中 push run `45768262520` 与 PR run `45768270363`、合计六个 job 均成功；push 实际 checkout 为 fa，PR 实际 checkout 为 merge `8b9318a7ceba2e37f1f24e6d113cf39d49510d2a`。不得把 PR merge 的代码或测试总数混称分支 fa 的执行；完整细节以保全的两份 CI 文件为准。

CI 报告将 quiet suite 与真实 TLS/HTTPS 覆盖的连接明确标为源码及聚合结果推论，没有单独 TLS-only job、逐方法计时或本地复跑。本包保留该限定，也不把 CI 成功写成新五路审查或 Web 交互通过。

## ZIP 与实际预览记录

公开制品 ID `15093284680` 来自 run `45768262520`、source head fa。原 ZIP 证明记录字节数 `758554`，`archive_digest_verified=true`，digest 为 `sha256:4eeffd1d5b2f337506cfd89eae400cd72e2cc9bb1467445056cacaa7b5af7ff0`；这项实测 digest 证明保留在投影中。本组包未读取 ZIP、资产内容或重新下载验证。

来源记录 `local_build_run=false`，没有本机构建。制品共 81 文件；index SHA256 为 `76e359396b1a4a06ff72e21bef3d48c81c82d75ea1115a09755d546aa8373a3a`。服务器记录前后端同为 fa、217 个后端模块聚合为 `5a5ee950ae0c972791ae17fab92978579adec7d6d419133e6eaf9eb9e649377d`，资产核验与 CPU `0x1` / BelowNormal `16384` 读回均早于 Mio 导入。以上是既有记录摘要，本组包未导入产品。

服务器创建 app 后的 `catalog_entries_after_app_creation=0` 仅是该创建时点的计数，不能改称普通 catalog 交互、加载 49 项目录后的性能或完整网页审查。服务器来源未含独立观测时间，本包不补造时间戳。

## Chrome 模式与先后记录

原连接记录时间为 `2026-11-26T06:57:53.818454+00:00`，模式为已安装 Chrome 的 `--headless=new`，不是可见普通窗口。原记录只证明 direct CDP 连接与新建后关闭的空白上下文；`product_navigation_performed=false`、`candidate_preview_ready=false` 均保留。空白连通不是 Web 审查。

后续服务器文件记录实际 fa 预览创建；它不回写早先空白连通记录的 false。本包也没有将连接记录的候选就绪标记改为 true。白名单三源均未记录 CDP 端口，因此发布连接投影使用 `cdp_port=null` 并说明未记录；不由预览 origin 端口推断 CDP 端口。

## 安全出版处理

仅保留上述五源及其公开投影。本机绝对静态目录删除，81 项逐文件 path/bytes/hash 明细不发布，仅保留总数；不复制 ZIP、原图、提示词、资产文件名、脚本、日志、账户、private provenance 或其他审查目录。没有读取原工作区保护证据，也没有搜索其路径。

全部发布文件采用 UTF-8 无 BOM、LF 与末尾单换行。两个 CI 文件保全原内容，三个预览文件仅按 manifest 的显式字段白名单投影；原件字节和 SHA 不变。递归禁用字典键、私路、资产名和秘密检查只检查本包文件，Markdown 相对链接在包内验证，公开外链不联网访问。manifest 自身 SHA 单独在交接消息给出。
