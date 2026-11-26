# R4 固定语料终态复测报告

状态：`RESULTS_RECORDED_REVIEW_REQUIRED`。全部固定记录已保存；精确不符仍按原真值保留，未宣称全通过。
源码 HEAD：`ed45509456b14006161d829666c466789e6a9e37`。原始产品主批及补充恢复分别留证；这是修复复测，不是新独立审查。

## 固定分母

| 队列 | 精确 | 不符 | 比较结果未测 | 已记录 / 固定分母 |
|---|---:|---:|---:|---:|
| current75 原严格请求 | 226 | 4 | 0 | 230 / 230 |
| R1 原严格请求 | 66 | 4 | 0 | 70 / 70 |
| R1 显式 mapping | 20 | 0 | 0 | 20 / 20 |
| current75/R1 真实 LoRA 操作 | 14 | 0 | 0 | 14 / 14 |
| R2 原严格真值 | 104 | 26 | 0 | 130 / 130 |
| R2 fixed138 原请求 | 122 | 16 | 0 | 138 / 138 |
| R2 原 manual boundary | 15 | 0 | 0 | 15 / 15 |
| R3 真实 LoRA 操作 | 26 | 0 | 0 | 26 / 26 |
| R3 advanced 派生操作 | 20 | 0 | 0 | 20 / 20 |
| 原 compile core | 10 | 0 | 0 | 10 / 10 |
| 原 compile LoRA | 13 | 0 | 0 | 13 / 13 |
| R4 blind 原自动请求 | 36 | 11 | 0 | 47 / 47 |
| R4 compile 冻结 C01–C14 | 14 | 0 | 0 | 14 / 14 |

样本数：current75 75/75、R1 15/15、R2 15/15（13 API、2 UI）、R3 15/15、R4 blind 12/12。
所有逐请求指针、typed delta、warning 投影、历史 multiset 对照与完整计数见 [publish.json](publish.json)。

## 八项既有 missing

8 个自动请求全部实测：resolved targets、全部 typed delta、marker 写入路径均为空；各自有对应 kind 的明确忽略 warning；连接和源文档保持。
8 个显式 mapping 请求均只改原指定一个指针，typed 整图精确，其余字段和连接保持。这证明这些请求没有静默写到其他位置；原自动真值仍不符，不能改记为通过。

| 固定样本 / kind | 原目标 | 自动 delta | kind 忽略提示 | 显式 mapping 精确 |
|---|---|---|---|---|
| current75-2df6c0ad8d1a:prompt | `/6/inputs/text` | `[]` | True | True |
| current75-2df6c0ad8d1a:negative | `/33/inputs/text` | `[]` | True | True |
| current75-2df6c0ad8d1a:width | `/27/inputs/width` | `[]` | True | True |
| current75-2df6c0ad8d1a:height | `/27/inputs/height` | `[]` | True | True |
| R1-hf-lora-stack:width | `/134/inputs/width` | `[]` | True | True |
| R1-hf-lora-stack:height | `/134/inputs/height` | `[]` | True | True |
| R1-cog-consistent-character:width | `/29/inputs/width` | `[]` | True | True |
| R1-cog-consistent-character:height | `/29/inputs/height` | `[]` | True | True |

## R2 sample1 阶段意图

原产品调用前 manual oracle 未改变。steps/cfg/sampler 的自动请求均无自动目标、空 delta，并各自发出忽略提示；已不再无提示从一个阶段迁移到另一阶段。
6 个显式请求分别只选择 `/3`、`/33` 的对应字段，逐次 typed 整图精确、连接与源文档保持；未用 canvas-primary 替代阶段意图。

| kind | 自动行为 | `/3` 显式单字段精确 | `/33` 显式单字段精确 |
|---|---|---|---|
| steps | manual_required_or_unbound + kind warning | True | True |
| cfg | manual_required_or_unbound + kind warning | True | True |
| sampler | manual_required_or_unbound + kind warning | True | True |

R2 strict 的 130 条原记录均存在：auto 100（78 精确、22 不符）、manual 25（21 精确、4 不符）、absent 5（5 精确）。fixed138 仍为 122/138；其中 sample1 三条旧自动写入预期现为空 delta，按旧请求原样判不符，不能换真值凑通过。

## R4 blind 保留的不符

原严格自动请求 36/47；以下 11 条照原 oracle 保留。原 raw 未保存完整 warnings 的记录只保留 warning_count/错误字段存在性，不把缺失 warnings 解释成零提示。

| case / kind | 原目标 | 实际目标 | 实际 delta | 错误 / warning 数 |
|---|---|---|---|---|
| r4b-01 / width | `/40/inputs/width` | `` | `` | 1 |
| r4b-01 / height | `/40/inputs/height` | `` | `` | 1 |
| r4b-01 / init | `/37/inputs/image` | `未记录` | `未记录` | BindingError |
| r4b-02 / width | `/40/inputs/width` | `` | `` | 1 |
| r4b-02 / height | `/40/inputs/height` | `` | `` | 1 |
| r4b-02 / init | `/38/inputs/image` | `未记录` | `未记录` | BindingError |
| r4b-03 / seed | `/10/inputs/noise_seed` | `/10/inputs/noise_seed,/11/inputs/noise_seed` | `/10/inputs/noise_seed,/11/inputs/noise_seed` | 0 |
| r4b-04 / seed | `/3/inputs/seed` | `/14/inputs/seed,/3/inputs/seed` | `/14/inputs/seed,/3/inputs/seed` | 0 |
| r4b-09 / prompt | `/67/inputs/text` | `` | `` | 1 |
| r4b-09 / negative | `/62/inputs/text` | `` | `` | 1 |
| r4b-09 / ref | `/95/inputs/image` | `未记录` | `未记录` | BindingError |

空 delta 的自动缺口和两条 seed 多目标策略差异保持区分；此报告不将它们统一归为安全边界。

## 私有 138

只读 SQLite 原选择得到 1 份 138-node 文档；mapping=0、tag=0，LoRA 43 项。自动绑定仅 output=1、seed=2；width、height、batch 各从历史 1 撤至 0，与 eb/3e 相同。
width/height 原 literal 指针显式 mapping 的绑定阶段整图精确；batch 显式 mapping 的完整 compile 本轮未测。
完整 compile=false，BindingError 路径为 compile_workflow → _frontend_plan，缺 frontend state；inspection 也为 compilable=false，保留 ambiguous/unbound 等提示代码。未补状态、未把绑定阶段成功冒称完整 compile 成功。

## 资源、来源与恢复记账

| 会话 | PID | UTC 开始 | UTC 结束 | affinity 读回 | priority |
|---|---:|---|---|---|---:|
| primary | 8564 | 2026-11-26T03:40:37.150522+00:00 | 2026-11-26T03:40:48.185008+00:00 | `0x1` | 16384 |
| failed_supplement_recovery | 40500 | 2026-11-26T03:43:53.146729+00:00 | 2026-11-26T03:43:54.151536+00:00 | `0x1` | 16384 |

两次产品进程均在任何 Mio import 前读回 CPU 0x1、BelowNormal 16384，均已退出；串行、无子进程、无服务/网络/模型调用。
主批补充因 R1 selector 写成 URL 后缀而失败，原失败日志保留；恢复用固定 id。原失败补充的首 4 个 kind、8 个 marker 请求在内存完成但未保存，按授权重新采集并逐请求 checkpoint；10 个 completed cohort 重跑为 0。
首版出版另有 HTTPS 驱动盘正则误判与 ref 白名单遗漏：均为纯出版错误。旧 publish/report 已归档；原始 13 个 ref 记录从未缺失或重跑。

真实私有 provenance 为 `run-provenance-private.json`、`recovery/provenance-private.json`、`effective-provenance-private.json`；公开有效投影现为 [effective-provenance.json](effective-provenance.json)，不引用不存在的文件。

产品源码：217 个 py，SHA256 `5a5ee950ae0c972791ae17fab92978579adec7d6d419133e6eaf9eb9e649377d`。
全部 server：404 个 py，SHA256 `483fe89f5ea73cc39f5a99f4b4ebbe89a47021f1b376f47d180e971328b6f9b9`。
主批与恢复均证实：源码、844 个旧原件/产物、DB 主文件前后 hash 一致；恢复另外保持 59 个既有当前结果文件字节不变。

## 对外投影 allowlist 与限制

公开只含固定 case/公共来源、类型、计数、布尔、哈希、指针、有限数值、通用 kind 忽略提示；其他文本仅类型/长度/哈希。递归拒绝五个禁用原图字典键与真正私有路径。
没有 raw graph、模型名、用户文本、私有绝对路径；全部原始图、完整警告及异常仅留 TEMP。R3 advanced 20 项原 raw 只保存 unexpected delta 和整图精确布尔，没有保存完整 actual delta 路径，该字段明确为未记录，不能把投影空数组当零写入。
未执行单测全套、前端测试、构建、ComfyUI/GPU、baseline replay 或新采集；所有原真值和历史失败均保留。
