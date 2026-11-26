# Mio 静态工作流兼容性：R6 终审与交付索引

产品候选固定为 `fe914065c7aafb0672bfe10274361f83179ce7f1`，全任务基点为 `38838ab43cf3d056951f2fc6c52afb737d34e3c6`。五名全新审查者在该候选完整门禁通过后独立开展审查，先封存首版，再交叉核验；五份最终职责签字均为 **VERIFIED PASS**。root 实际复核 196 件首版与 57 件终版 payload 的哈希，源码身份保持不变。

该结论覆盖产品审查轮。最终出版、缓存清理和交付提交另有回执，不由审查者预签。

- [中文交付报告](final-report.md)
- [53 项原要求与证据账本](requirement-evidence-ledger.json)
- [分类统计与分母](classification-calculations.json)
- [历轮发现与关闭索引](issues-closed.md)
- [最终交付与清理回执](delivery-receipt.md)

## 五路独立首版、交叉与终签

| 职责 | 独立首版 | 实质交叉 | 最终签字 |
|---|---|---|---|
| 通用性与架构 | [report](audits/generality/report.md) | [cross](audits/generality/cross-review.md) | [VERIFIED PASS](audits/generality/final.md) |
| 新增真实盲测 | [report](audits/blind/report.md) | [cross](audits/blind/cross-report.md) | [VERIFIED PASS](audits/blind/final.md) |
| 编译正确性 | [report](audits/compile/report.md) | [cross](audits/compile/cross-review.md) | [VERIFIED PASS](audits/compile/final.md) |
| 真实 Chrome 体验 | [report](audits/web/report.md) | [cross](audits/web/cross-review.md) | [VERIFIED PASS](audits/web/final.md) |
| 隐私、洁净与 CI | [report](audits/privacy/report.md) | [cross](audits/privacy/cross.md) | [VERIFIED PASS](audits/privacy/final.md) |

[root 整轮实证归并](protocol/root-round-acceptance.json)不合并重复发现。保留三个唯一 Low：自动推断的保守覆盖、普通 detailer 输入的 init 用途提示、浏览器 JSON 数字表示。旧 false、预期错误、实际未改写和未测边界均留在各自分母中；没有将五份 PASS 写成所有请求无差异。

## 主要实证

- [固定 current75 末态复测](evidence/core-and-ci/current75/report.md)：46 API、29 UI-only；原整图 Python 值比较 206/230→226/230，旧显式手选操作为 0。
- [新 29 次真实手选](audits/compile/consolidated-results.json)：29 个单绑定字段写入、完整 strict typed 编译与预期闭包精确；预期剪枝另列。
- [13 份独立新样本](audits/blind/selected-provenance-safe.json)：6 API、7 UI，完整来源、raw/canonical/拓扑哈希与已见身份限制保留。
- [真实 Chrome 四格](audits/web/report.md)：252 次动作、30 张审查者实际查看视图；原 16 次预览与第 17 次局部只读恢复分开。
- [候选完整远程门禁](evidence/core-and-ci/ci/report.md)：push/PR 六个 job 的实际 checkout、命令、结果和 TLS 证据边界。
- [修复与来源补充](evidence/index.md)：原始失败、有限恢复和来源缺证不因最终通过而删除。

## 字节身份与公共材料

[发布源映射](publication-source-map.json)逐件区分原审查文件 SHA、公开文件 SHA 与 Git blob SHA。公开副本只作 UTF-8/LF/末尾换行规范化及三处已知本机路径前缀脱敏；原审查 seal 和原结果未修改。审查报告中的原始 SHA 指向封存时字节，不能与规范化后的 Git 字节混用。

公开材料仅按各角色精确白名单选择。原工作流、样图、完整请求/返回、私有 oracle、隔离数据库、浏览器标识、下载 JSON、截图与临时脚本均不在本目录。[安全扫描的元数据键误报归因](protocol/publication-scan-adjudication.json)保留首次停止与六个精确例外；例外是审计文件身份和 Markdown 链接记录，不放开真实图结构。

R5 的五份 **REQUEST CHANGES** 与两项 Medium 原样保留在 [R5 归档](../r5/index.md)；R6 不改写历史签字。全部过程回显事件仍披露，未授予 process-clean PASS。原工作区的数据保护与其并发提交/未跟踪状态变化分别说明，不能声称原工作区整体未变。
