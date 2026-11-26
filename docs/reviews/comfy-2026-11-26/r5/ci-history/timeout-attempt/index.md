# R5 timeout 修复与修复前 CI：出版索引草稿

状态：**RESULTS_RECORDED_REVIEW_REQUIRED**。这里只准备安全中性证据，不是新五路终审。修复前 8d1d CI 的 **REQUEST CHANGES** 与后续 6e30208 的有限验证分开保存；没有全门禁或新五路全 PASS 结论。

| 材料 | 固定版本与范围 |
| --- | --- |
| [修复前 CI 报告](ci-before-fix/report.md)／[逐项证据](ci-before-fix/ci-verified.json) | `8d1d9da515636967fa5c1c9e494ebd0be0fcec8c`；push 成功，PR Windows 完整后端真实失败，结论 REQUEST CHANGES |
| [timeout 修复有限验证](timeout-fix/report.md)／[安全聚合](timeout-fix/validation.json) | 主控记录提交 `6e302081e650210202b232990ab05bbd6961e149`；只涉及两个限定文件，保留首批格式误配失败与补跑成功 |
| [来源与发布清单](manifest.json) | 四份源文件的原始 SHA-256／Git blob SHA-1、各发布文件的 SHA-256／Git blob SHA-1、机械规范化及安全检查 |

首批 lint exit 0、format-check exit 1，测试未执行；主控解释为默认 88 列配置误配。补跑使用 server 100 列配置，format、offline-unit、diff-check 的记录均为 exit 0。3 个测试方法／50 个 Mock 子场景及 unittest 摘要 0.018 秒属于主控执行补充；resume JSON 直接记录的外层 offline-unit 耗时是 0.462 秒，两者分别保留。CPU guard 均为 `0x1`／`16384`，先于 Mio import。

旧 8d1d push `45752905758`、PR `45752911753` 分别 success／failure；合计 1/2 run、5/6 job、68/70 step success。PR Windows suite 的 deadline 分类断言失败不能被其他平台成功抵消，也不能用补跑本机有限 Mock 用例替代该远端矩阵。当前 allowlist 没有修复后远端 CI 终态报告。

原 ed45509 真实工作流复测和旧 `r4-publication-ready` 九文件不修改、不重记执行 HEAD。主控说明 Mio 217 模块聚合保持原哈希，出版者未读取产品或重算聚合。

源 allowlist 严格只有 `r5-timeout-validation/result.json`、`r5-timeout-validation/resume-result.json`、`r5-wave3-ci/report.md`、`r5-wave3-ci/ci-verified.json`。CI 两份文本只做 LF／单末尾换行规范化；两份小型验证 JSON 按解析后的完整字段聚合到 `timeout-fix/validation.json`，配置误配解释和额外测试摘要明确标为主控来源。原件字节与哈希不变，不携带 raw、脚本、日志、真实图或私有 oracle。

保持本目录的 `ci-before-fix/`、`timeout-fix/` 与根索引相对布局即可使用内部链接；实际仓库发布根由主控决定。出版只做文本／JSON／哈希和链接检查，未查询 CI／Git、未运行产品、测试、网络或浏览器，未改仓库或提交。入库后的实际 Git blob 核对仍由发布者另行完成。
