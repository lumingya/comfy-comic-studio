# 修复后固定证据与集成 CI：发布索引草稿

状态：**RESULTS_RECORDED_REVIEW_REQUIRED**；原固定版本集成 CI 封存结论为 **REQUEST CHANGES**。本目录只为既有结果准备安全文本发布副本，不是新五路终审，也不将修复复测改记为全通过。固定语料、性能及失败 CI 证据属于 `ed45509456b14006161d829666c466789e6a9e37`；后续 `8d1d9da515636967fa5c1c9e494ebd0be0fcec8c` 类型修复与待定 CI 单独记录，不替换原证据。

预期发布根目录为 `docs/reviews/comfy-2026-11-26/r4/repairs/after-repair/`；本草稿及七份副本保持相同的相对布局。来源、原始与发布 SHA-256、机械行尾改动及预期 Git blob SHA-1 见 [manifest.json](manifest.json)。TEMP 原件保持不变，副本仅统一 UTF-8 无 BOM、LF 和末尾单一换行；报告内部对封存原件的哈希引用不改写。首版 manifest 原字节另存于发布目录外，不纳入预期发布 allowlist。

## 固定复测结果

[终态语料报告](final-corpus/report.md)、[安全机器结果](final-corpus/publish.json)和[有效 provenance 投影](final-corpus/effective-provenance.json)保留原分母与不符：

| 固定队列 | 原结果 |
| --- | ---: |
| current75 原严格请求 | 226 / 230 |
| R1 原严格请求 | 66 / 70 |
| R2 原严格真值 | 104 / 130 |
| R2 fixed138 原请求 | 122 / 138 |
| R4 blind 原自动请求 | 36 / 47 |
| R4 compile 冻结 C01–C14 | 14 / 14 |

八项既有 missing 的八个自动请求已有逐项空目标／空 delta／对应 kind 忽略提示，八个显式 mapping 请求各只改原指定单一指针并保持 typed 整图精确。这补足所记请求的无静默错写和可接管证据，原自动真值不符仍然保留。

R2 sample1 的三项自动控制保持无目标、空 delta 并给出 kind 提示；两个阶段的六个显式请求各自单字段精确。此阶段意图证据、上述八项 missing 的显式证明与 14/14 compile 结果分别记录，不能彼此替代，更不能据此消除固定队列其他不符。完整警告缺失、R3 advanced 未记录 actual delta、私有 138 缺 frontend state 等限制仍按原报告保留。

## 已有目录性能测量

[performance.json](performance/performance.json)只记录修复后既有的四次测量，单 CPU affinity `0x1`、BelowNormal priority class `16384`；没有在本次出版任务发请求或新增测量。

| segment | elapsed_ms | 目录条数 |
| --- | ---: | ---: |
| cold_catalog | 2516.515 | 49 |
| warm_catalog | 126.084 | 49 |
| import_one_distinct_200_node_graph | 445.527 | 不适用 |
| refresh_after_one_distinct_import | 639.258 | 50 |

沿用原 R4 Web 拥有的合成资料库；测量后临时导入已移除，原 49 条摘要恢复。原 JSON 保留冷进程条件、响应字节／哈希和额外详情／清理请求记账。四个有限测量点不是压力或 profile 循环，也不是对整体性能或新独立终审的签字。

## 原固定版本集成 CI 与后续类型修复

[CI 封存报告](integration-ci-failed/report.md)与[安全逐项证据](integration-ci-failed/ci-verified.json)的结论为 **REQUEST CHANGES**，不能用取消终态或部分成功改写为全绿：

| ed45509 原运行 | 最终 run 结论 | gate | Windows 完整后端 |
| --- | --- | --- | --- |
| push 45750256236 | cancelled | success | cancelled，无完整计数 |
| PR 45750263955 | cancelled | failure，TS2300 | cancelled，无完整计数 |

两 run 均在后续 push 后取消；PR gate 先前已在 `tsc --noEmit` 报 `ui.tsx` 两处 `onCloseAutoFocus` 重复声明，取消不抹去该失败。PR 实际 checkout 为 merge `53f891a74aec61e724495762c436e2a1f8bf2cfc`。其 web Vitest、build 及后续未完成步骤不能算已执行，完整 job／step 状态继续保留在原安全证据中。

[类型修复记录](integration-ci-failed/merge-type-fix.json)表明 `8d1d9da515636967fa5c1c9e494ebd0be0fcec8c` 仅调整 `web/src/components/ui.tsx` 的 `onCloseAutoFocus` 类型声明，与主线合并形态对齐；没有改变运行行为或后端，没有把整条主线上游合入工作区，也没有重跑后端语料。本目录语料证据的原 ed45509 HEAD 和哈希不变。

修复记录中的新 push **45752905758**、新 PR **45752911753** 均为 **PENDING，须另行核验**。尚无这两 run 的新 CI 终态报告；本次出版任务没有查询 CI，不能为它们签发通过结论。

## 出版边界

源 allowlist 严格只有 `r4-final-corpus/report.md`、`r4-final-corpus/publish.json`、`r4-final-corpus/effective-provenance.json`、`r4-preview/performance.json`、`r4-final-ci/report.md`、`r4-final-ci/ci-verified.json`、`r4-preview/merge-type-fix.json`。不携带 raw、脚本、日志、真实图或私有 oracle。清单中的安全检查仅涵盖文本／JSON／哈希和预期布局链接，不属于产品验证。仓库文件和 Git 暂存／提交均未改动；实际入库后的 Git blob 一致性仍需发布者另行核对。
