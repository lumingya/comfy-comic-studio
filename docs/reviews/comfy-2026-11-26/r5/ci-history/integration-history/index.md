# R5 预算回归与 ownership 候选：集成历史出版索引

状态：**RESULTS_RECORDED_REVIEW_REQUIRED**。本包保存失败、补丁验证与后续源冻结之间的时间关系，不是新五路终审或全门禁签字。新完整 CI、新五路审查、cleanup 均为 **PENDING**。

## 三层证据分别保留

| 层次 | 材料 | 身份与边界 |
| --- | --- | --- |
| 已发生的预算回归 | [6e CI 报告](budget-regression/report.md)／[逐项证据](budget-regression/ci-verified.json) | 固定 `6e302081e650210202b232990ab05bbd6961e149` 的两个 run 全部终态失败，未达到完整门禁覆盖 |
| 当时的 ownership 工作区补丁 | [原报告](ownership-fix/report.md)／[验证聚合](ownership-fix/validation.json)／[原出版清单](ownership-fix/manifest.json) | 三文件原字节保留，身份仍为 `worktree_patch_on_6e`，不追写为已提交的新 HEAD |
| 后来提交的同源候选 | [candidate-source.json](candidate-source.json) | 冻结文件记录干净 HEAD `fa6308384826fad7629b2c727d70230cc7951d05`，`tested_source_hashes_match=true`，作为后来封存关系，不改变旧报告身份 |

旧 ownership 报告中的工作区状态及当时 CI 待定描述是历史快照。现在以 budget-regression 两份新封存补齐 6e 的失败终态，以 candidate-source 单独说明后来的 fa 提交；不能覆盖历史文件来消除曾经的失败、误假设或未提交状态。

## 6e 失败不能被局部成功抵消

push `45764508808` 与 PR `45764513053` 均为 failure。六 jobs 的完整后端 suite 均出现同一 ERROR 与 FAIL：custom GET 的提前 `ReadTimeout` 不再有限重试，以及 custom `ConnectTimeout` 的 `sent=True` 不符应为 `False`。PR 实际 merge checkout 为 `f8f2bf71d2541e57bb3d37471f720b20323585aa`，不是 metadata head。

PR Windows 完整 suite 为 **1952 tests in 1823.257s，failures=1、errors=1**。其余 job 的 suite 数量／耗时、条件 skip 与全部步骤状态保留在原安全证据中。失败后的 client／web／分发／assistant／发行包等门禁未执行，没有 web artifact；不能把 shell 声明或已过的前置步骤算作后续成功。

这些完整 CI 反例继续否定把 timeout 分类宽泛应用到所有 `TimeoutException` 的假设。旧 6e 的 3 方法／50 Mock 子场景有限成功保持原样，不能升级为全门禁正确。

## fa 冻结关系与仍待证明的范围

原 ownership 验证是六方法，其中新增四方法／100 子场景、旧两方法；unittest 摘要 0.061 秒与外层 2.140 秒分别保留。首批显式配置引起的 I001 失败、测试未执行，以及补跑自动发现配置后四项 exit 0 也继续保留。这里只连接已测源与后来 fa 的冻结记录，不重新执行验证。

candidate-source 记录 Git 状态为空、Mio **217** 模块聚合 SHA-256 为 `5a5ee950ae0c972791ae17fab92978579adec7d6d419133e6eaf9eb9e649377d`，all-server **405** 文件聚合为 `7a8dec42eb98849d6eff92dfeb84dd9b329136ee7e16a754b367bb7dda60da17`。本出版者只读取冻结 JSON，没有查询 Git、读取产品或重算聚合。其相对 ed45509 的三文件清单包含更早的 `ui.tsx` 类型对齐，不应被误写成 ownership 局部补丁新增了第三个文件。

本地证据仍仅 MockTransport／工厂 mock／无线程 FakeDeadline，不证明真实 TLS、guard 线程或 socket。fa 新完整 CI 由其他观察员监控，未纳入本包；新五路审查与 cleanup 也没有完成结论。干净 Git 冻结状态不等于清理已经完成。

## 安全出版范围

[本次 manifest](manifest.json)记录六份显式白名单源的原始／发布 SHA-256、计算 Git blob SHA-1、逐项规范化及相对链接检查。ownership-fix 三份保持源字节完全一致；其他安全文本只在需要时规范为 UTF-8 无 BOM、LF 和单末尾换行。原封存文件与所有旧 ready 目录均不修改。

只组包这八个明确文件，不携带原图、产品源码、测试文件、脚本、原始日志或未成稿证据。本次没有运行产品、测试、网络、浏览器或 Git；Git blob 值仅由文件字节计算，实际入库核对由发布者另行完成。保持本目录相对布局即可使用内部链接，实际仓库发布根由主控决定。
