# R4 固定版本审计与 R3 终态复验归档

本目录归档 2026-11-26 已有证据。审计对象固定为 `3e994bb80794dea7be9773f5cb9c47119bf34c27`，比较基点为 `38838ab43cf3d056951f2fc6c52afb737d34e3c6`。**该版本的 R4 汇总结论是 REQUEST CHANGES，五位审查员并非全 PASS。** 本归档不代表后来修复的复验，不以新的实现覆盖原始失败记录；后续修复仍须另开一轮独立验证。

## 结论与证据分层

| 角色 | 独立首版 | 授权互核后的证据口径 |
| --- | --- | --- |
| [通用性／架构](generality/report.md) | 限静态源码范围 VERIFIED PASS | [交叉实证](generality/cross-evidence.md)最终签名 REQUEST CHANGES，确认阶段歧义与数字字符串权重两项 Medium；[独立 Web 互核](generality/cross-web.md)另支持同一项列表性能 Medium |
| [编译正确性](compile/report.md) | REQUEST CHANGES，14 例中 12 过、2 败；两败为同一权重 Medium | [交叉互核](compile/cross-evidence.md)维持 REQUEST CHANGES，并确认阶段歧义 Medium；与通用性发现去重 |
| [真实工作流盲测](blind/report.md) | 限 12 份新 cohort 已测静态契约 VERIFIED PASS | [交叉互核](blind/cross-evidence.md)支持汇总 REQUEST CHANGES；保留本角色原测量，不冒充重跑了他人的案例 |
| [Chrome UX](web/report.md) | REQUEST CHANGES，资料库性能 Medium | 四组功能／视觉矩阵通过不消除性能问题；另如实保留误定位流程事件 |
| [隐私与 CI](privacy/report.md) | 限固定提交及指定门禁证据 VERIFIED PASS | 不替代产品终审；另记录一项已遏制的浏览器流程 Medium，初始会话影响未知 |

按根因去重后，固定版本有 **3 项产品 Medium**，不能把多位审查员复核同一项算成新缺陷：

1. **未知 conditioning 上游阶段的控制归属歧义。** 必要的前阶段采样结果经条件边进入后阶段时，图结构尚未证明通用 steps／cfg／sampler 应归属哪一阶段，当前却静默选择后阶段；原先 manual 真值仍然保留。历史自动写前阶段也不是获批准的真值。见[通用性 M1](generality/cross-evidence.md)、[编译 R4-COMPILE-02](compile/cross-evidence.md)和[保存的 sample1 逐请求归因](../r3/final-corpus/sample1-stage-attribution.md)。
2. **flat／Power LoRA 数字字符串权重误读。** 两种结构把有限数字字符串误读为默认模型权重 `1`、CLIP 空值，稳定键明确设为 `1` 的请求随后被当作无变化跳过，原字符串不变且无警告。两个案例只算一项。见[编译 R4-COMPILE-01](compile/report.md)及[封存测量](compile/results.json)。
3. **49 条合成大图资料库的列表重算延迟。** 保存和重开页被全库列表刷新拖住，已有两次单次请求观察为 21,473 ms 与 18,772 ms。该证据受单 CPU／BelowNormal 和既有测试库条件限制，没有同库基点对照，不能推成生产硬件绝对时延或本次某一提交的已证回归。见[Web 报告](web/report.md)、[测量](web/measurements.json)及[冻结源码与证据的独立互核](generality/cross-web.md)。两次 GET 耗时不是保存 POST 的精确计时，也未证明每个槽位计划每次都会完整重做分析。

另外保留 **1 项 Medium 审计流程事件**：旧浏览器入口意外返回非任务页 a11y，后续已停用该入口，改用专属隔离 context 并在读正文前校验精确 origin。不能改写成“从未返回非任务内容”，也不能据此声称固定提交已经泄漏。已知遏制事实与初始影响未知的边界见[隐私报告](privacy/report.md)和[Web 原始签名](web/report.md)；该流程事件独立于上述 3 项产品 Medium。

## R3 固定版本终态语料与 CI

[终态语料报告](../r3/final-corpus/report.md)和[安全机器结果](../r3/final-corpus/publish.json)是该固定版本的既有修复复验，不能称为新独立 R4 终审或全部自动识别通过：

| 固定队列 | 保留结果 |
| --- | ---: |
| current75 定向整图 | 226 / 230 |
| 原 R1 定向整图 | 66 / 70 |
| R2 严格原真值 | 101 / 130 |
| R2 原请求固定重放 | 122 / 138 |

[差异归因](../r3/final-corpus/delta-attribution.md)保留八项 current75／R1 missing 的证据缺口：原探针没有捕获各自请求级 actual delta、warning 与应用值后的 resolved target，**尚不能称安全撤回或安全忽略**。R2 另有三项真实自动阶段迁移与十三项有警告的空差分，仍按原分母保留失败。不能用另一个手工 mapping 请求成功抵消自动失败。原私有 138 节点图的完整编译仍因缺 frontend state 失败；显式尺寸 mapping 只证明绑定阶段精确，不代表完整编译或实际出图。

[终态 CI 报告](../r3/final-ci/report.md)与[逐 job／step 证据](../r3/final-ci/ci-verified.json)记录原 push **45670345960** 和 PR **45670360530** 均绿：6/6 job、68/68 step 成功。push 实际检出固定 `3e994bb…`；PR 实际检出 merge `e9f72beb7c7fd99875e7d19728673d2928485b16`，其父提交包括固定 HEAD 和当时 base `d9cfa801c42f19db29788ea044d31eaf1c50c221`。PR 的较大测试总数不能冒充固定 HEAD 的测试数量；Linux suite 的三个用例级条件跳过也在原证据中保留。此归档没有重新请求 CI、读原始日志或运行任何本地门禁。

## 发布范围与来源

仅逐项读取并复制主控明确授权的安全文件，不复制目录、图片、真实工作流、私有 oracle／probe、原始日志或其他中间产物。TEMP 源文件保持原样。下表来源路径以 `external-temp-evidence/` 为中性根标签，仅表示原外部临时证据集，不暴露用户目录。发布副本统一为 UTF-8 无 BOM、LF 行尾及末尾恰好一个换行；仅将 CRLF／CR 转成 LF、移除额外尾部空行或补足末尾换行，不重写测量、正文或签名。原始 SHA-256 针对封存源字节，发布 SHA-256 针对规范化后的实际副本；两者不能混用，逐项机械改动在下表和清单中记录。

原报告及 seal 内引用的哈希继续指向当时封存的原件，不随发布格式改写；LF 副本的哈希以下表及清单为准。经过 LF／EOF 规范化的副本与 TEMP 原件可能不逐字节相同，但除已记录的机械格式变化外内容保持。Git 入库会规范化文本行尾，因此不能从 TEMP 原始 SHA 推导 Git 中的发布字节；主控须在重新暂存这 28 个文件后，另外核对 Git blob 与规范化发布副本。本次归档检查不冒称已完成该暂存后核对。

[机器可读来源与哈希清单](publication-manifest.json)与[发布检查结果](publication-check.json)仅记录本次轻量归档检查，不是产品验证。检查包括 UTF-8 严格解码／无 BOM、LF／单一末尾换行、JSON 解析与递归禁用键、敏感模式、私人绝对路径、内嵌图候选及 Markdown 相对链接。清单同时给出按实际发布字节计算的预期 Git blob SHA-1，供主控重新暂存后对照；实际暂存核对状态在检查结果中明确保留为待办。JSON 指针字符串中的 `/inputs/` 等文字不是字典键，不误报为原图泄漏。正文中引用但未归档的私有证据文件名／哈希只是 provenance，不表示它们可以公开或已经入仓。

<!-- ARCHIVE_TABLE_START -->

| Source under external-temp-evidence/ | Published copy | Original SHA-256 | Published SHA-256 | Changes |
| --- | --- | --- | --- | --- |
| `audits/r4/generality/report.md` | [`r4/generality/report.md`](generality/report.md) | `726d88e07ac6ab3c3ca5e44c4ba1c2966308398b5ad012b153934da8d2f64b40` | `726d88e07ac6ab3c3ca5e44c4ba1c2966308398b5ad012b153934da8d2f64b40` | none; already LF with one terminal LF |
| `audits/r4/generality/cross-evidence.md` | [`r4/generality/cross-evidence.md`](generality/cross-evidence.md) | `d988f2759416e799a9db87e4eafdb46382744f3366188b8cdc9a20de5639c2a4` | `d988f2759416e799a9db87e4eafdb46382744f3366188b8cdc9a20de5639c2a4` | none; already LF with one terminal LF |
| `audits/r4/generality/cross-web.md` | [`r4/generality/cross-web.md`](generality/cross-web.md) | `892848fce1801e40934763499d1ad24a6f18411083cfff92693a195103aceacd` | `892848fce1801e40934763499d1ad24a6f18411083cfff92693a195103aceacd` | none; already LF with one terminal LF |
| `audits/r4/compile/report.md` | [`r4/compile/report.md`](compile/report.md) | `0214dd764ad35a564979d3ba731c8e9fd0c030774f86cb319f4e2260f0b4966b` | `0214dd764ad35a564979d3ba731c8e9fd0c030774f86cb319f4e2260f0b4966b` | none; already LF with one terminal LF |
| `audits/r4/compile/results.json` | [`r4/compile/results.json`](compile/results.json) | `df53d6f800ceba3df358813b27e521820e1df977dc72d5bf4ee3ada5b56ebd4c` | `89c0e2b3f40bfa565a79d1d7e88504e6defa3f4ed65e62842224962196d4b9a5` | CRLF to LF (187 line endings) |
| `audits/r4/compile/initial-seal.json` | [`r4/compile/initial-seal.json`](compile/initial-seal.json) | `ce2a7e9d619e3bf5b4da9509d34b72d2b4b2d507a37b7aed2c80de1864ca8449` | `ce2a7e9d619e3bf5b4da9509d34b72d2b4b2d507a37b7aed2c80de1864ca8449` | none; already LF with one terminal LF |
| `audits/r4/compile/cross-evidence.md` | [`r4/compile/cross-evidence.md`](compile/cross-evidence.md) | `00da6a04b05a6b01760ca81c85110e197c7d435795e3e68662b67b791ea5475f` | `00da6a04b05a6b01760ca81c85110e197c7d435795e3e68662b67b791ea5475f` | none; already LF with one terminal LF |
| `audits/r4/blind/report.md` | [`r4/blind/report.md`](blind/report.md) | `41979cdca47b04e00dced9fec00306e5d5dab4fed8c4dac9074102d4330d1600` | `41979cdca47b04e00dced9fec00306e5d5dab4fed8c4dac9074102d4330d1600` | none; already LF with one terminal LF |
| `audits/r4/blind/results.json` | [`r4/blind/results.json`](blind/results.json) | `f40df7671925b157f1c0dbe41a5f133e513e80eaa218a91bb1a0ceabde05580a` | `875063e0fbffc9db62a5f7cc17facfd6d2647a175dacae1b5526412dd782fb44` | CRLF to LF (1435 line endings); added terminal LF |
| `audits/r4/blind/initial-conclusion.json` | [`r4/blind/initial-conclusion.json`](blind/initial-conclusion.json) | `f77c4bd084a0704cd153d828aa3a2db9f675af9268e254e2f40a1d75b361632e` | `b8645643c420213e212c82f5c015141b509c6e7129386ce690fcfaae3a27e964` | CRLF to LF (56 line endings); added terminal LF |
| `audits/r4/blind/cohort-freeze.json` | [`r4/blind/cohort-freeze.json`](blind/cohort-freeze.json) | `25f44a971c8a9cf91a8aa6b7e18a52d6fe4b2877ae6ba819d95cec89a20744af` | `3cdc420ac96b42a58e5254ddd6e612b6c74e534953b65e214ac0d3b3f081881f` | CRLF to LF (360 line endings); added terminal LF |
| `audits/r4/blind/cross-evidence.md` | [`r4/blind/cross-evidence.md`](blind/cross-evidence.md) | `5aac021b19fdaa8a02c3580f92eeca6649365062b88eb3185e7aad07dd6f0c58` | `5aac021b19fdaa8a02c3580f92eeca6649365062b88eb3185e7aad07dd6f0c58` | none; already LF with one terminal LF |
| `audits/r4/web/report.md` | [`r4/web/report.md`](web/report.md) | `2341e901a843a7e393516b20766bd3416ce4e61c640ae23fa121218d670a0d15` | `2341e901a843a7e393516b20766bd3416ce4e61c640ae23fa121218d670a0d15` | none; already LF with one terminal LF |
| `audits/r4/web/measurements.json` | [`r4/web/measurements.json`](web/measurements.json) | `902266e338ee48c51d6db19c7cd2620f2721d3bf7661bd4612b665a53fb286e4` | `902266e338ee48c51d6db19c7cd2620f2721d3bf7661bd4612b665a53fb286e4` | none; already LF with one terminal LF |
| `audits/r4/privacy/report.md` | [`r4/privacy/report.md`](privacy/report.md) | `9ee5705d315c1a439c29700b879f22ae042e64a52195eb083772233ec7a1656e` | `9ee5705d315c1a439c29700b879f22ae042e64a52195eb083772233ec7a1656e` | none; already LF with one terminal LF |
| `audits/r4/privacy/privacy-ci.json` | [`r4/privacy/privacy-ci.json`](privacy/privacy-ci.json) | `ad31fe75868c7381b0def7256832bacc4215c4072822f7be30500d801b39e771` | `92f463e4c0e26332c878b1de1572fe3eaddc20b0cd5d0a3eb9fa05729b274412` | CRLF to LF (2022 line endings) |
| `repairs/r3-final-ci/report.md` | [`r3/final-ci/report.md`](../r3/final-ci/report.md) | `b9c3b487ae773096aed0f1575182b5b826527e0dfedd61096d5b68fd77c7f12f` | `c116c94ca8ff1286b79a2d6de968d11d729c816b101617ce6313d7051598ad90` | removed 1 extra terminal blank line(s) |
| `repairs/r3-final-ci/ci-verified.json` | [`r3/final-ci/ci-verified.json`](../r3/final-ci/ci-verified.json) | `659240528c46e83f01b8e2efab3b7023fb5ba35d2bb8677b9810af4b93410f27` | `617c1247e90b07a66b89195ccefadcc110c820f2d3a5cc6cd65d867bc7718f5e` | removed 1 extra terminal blank line(s) |
| `repairs/r3-final-corpus/report.md` | [`r3/final-corpus/report.md`](../r3/final-corpus/report.md) | `cbba7509ebc082385950c5326ec1a523833a51d88f442417c7648da52e4962d6` | `4de27fa402f6a98143b820a10a10b4976946a92c639b02a64c9f87f14afb610a` | CRLF to LF (70 line endings) |
| `repairs/r3-final-corpus/publish.json` | [`r3/final-corpus/publish.json`](../r3/final-corpus/publish.json) | `206ce08c4bf03433262ae01c44572aef316a74f973c0a75c9269f2efe7697bd6` | `6ff50af54ff1e56925a09afd3399484a6b7a4f5fffc574fd0ede8c9659a296d3` | CRLF to LF (13201 line endings) |
| `repairs/r3-final-corpus/delta-attribution.md` | [`r3/final-corpus/delta-attribution.md`](../r3/final-corpus/delta-attribution.md) | `5bf1fa27e49685fc9a969215c2b13970f91bc6bb080491634ea2c68ba1704d83` | `ef7616e823138e6b27dd250f7e9dddcb9ccedf85cab107aac09b59e0bd5bcc00` | CRLF to LF (77 line endings) |
| `repairs/r3-final-corpus/delta-attribution.json` | [`r3/final-corpus/delta-attribution.json`](../r3/final-corpus/delta-attribution.json) | `9d11de2b6693044c1e6684ce4f4c9e873f657df776fe0cdf8b10399558c3f147` | `4dac35d279ad5dd42ef66c84e8906c4c904c4dd3a293d79ddeaa202c2e873521` | CRLF to LF (1454 line endings) |
| `repairs/r3-final-corpus/sample1-stage-attribution.md` | [`r3/final-corpus/sample1-stage-attribution.md`](../r3/final-corpus/sample1-stage-attribution.md) | `7df0d0deb00ce47505fe4b57e2a8b2d506175062162c9866e6403732a6e28d32` | `73443534759a9340fb3da12f6f1273eb52b4775a621d83372318eb51cc45189e` | CRLF to LF (33 line endings) |
| `repairs/r3-final-corpus/sample1-stage-attribution.json` | [`r3/final-corpus/sample1-stage-attribution.json`](../r3/final-corpus/sample1-stage-attribution.json) | `d663e3b19aedb62884b3c745587b5e65ae9bc4d761c52affaf42482434f2e35a` | `ec8c2dbee819638efaea495358a7e956d6e4650e4595c04ce8b313bb852242ad` | CRLF to LF (382 line endings) |
| `repairs/r3-final-corpus/effective-provenance.json` | [`r3/final-corpus/effective-provenance.json`](../r3/final-corpus/effective-provenance.json) | `b48ceb0e44830f0aada1441f3a35a043dd90830b8579fd979bfd51488ffe808e` | `f95da07e2ca52b1b026a6007181270dc0f2faa03237ac42e52f7d5ab14f47209` | CRLF to LF (172 line endings) |

<!-- ARCHIVE_TABLE_END -->
