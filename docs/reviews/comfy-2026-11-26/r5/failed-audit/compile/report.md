# R5 独立编译正确性首版审计

首版职责结论：27/27 个预先封存的中性案例通过，未发现 Blocker、High、Medium 或 Low 缺陷。该结论仅覆盖下列编译职责；整轮最终签署在全员首版封存与交叉事实核对后另行形成。

## 身份、独立性与范围

- 固定候选：`fa6308384826fad7629b2c727d70230cc7951d05`。
- 全任务差异基点：`38838ab43cf3d056951f2fc6c52afb737d34e3c6`，读取全部变更文件清单与提交序列，重点审查编译、绑定、语义路由、阶段/尺寸所有权及 LoRA 发现和写入的相关实现与差异。未读取任何同伴 R5 目录、旧审计结论或旧 oracle。
- 需求来源：原始任务、仓库 AGENTS.md、README.md、ROADMAP.md §2.1/§2.3/§2.4。采用固定基点与需求/规范双轴核对，按本轮独立职责约束自行审查。
- 本轮检查未修改源码、运行数据、既有证据或提交；运行后 Git 工作树仍干净。未装依赖、运行完整测试套件/build、调用 GPU、付费服务或重启用户服务。
- 首版证据全部仅写入本职责外部目录。公开结果使用中性标签、计数、类型、哈希及参数路径投影；完整合成源文档与原始结构仅留私有文件。

## 执行证据

- Oracle 在第一次产品导入前封存：`ec8732370b7e3dc9c402d320f8829b33960e7adf90b1f8b051f5b33af3ea14d0`；27 个源案例、完整预期结构、执行器与源码冻结清单均有 SHA256。
- 产品进程 PID：`47604`；guard 实际 UTC：`2026-11-26T07:09:48.028289+00:00`；第一次产品导入前亲自设置并读回 affinity=`1`、priority class=`16384`，设置或读回不符会终止。
- 结束 UTC：`2026-11-26T07:09:49.840322+00:00`；一次有限串行批次，总案例计时 1452.291 ms。没有失败、补测、替换样本或修改预期。
- 全部 server Python 文件 405 个，聚合 SHA256：`7a8dec42eb98849d6eff92dfeb84dd9b329136ee7e16a754b367bb7dda60da17`。
- 产品 Python 文件 217 个，聚合 SHA256：`5a5ee950ae0c972791ae17fab92978579adec7d6d419133e6eaf9eb9e649377d`。
- 执行前后逐文件原始字节聚合相同。产品租约已在批次结束后明确释放，不再调用产品。

## 检查方法与原始结果

26 次正常编译均逐项核对：完整类型敏感结构、精确 typed delta、预先算出的存活节点集合、所有存活连接、输出集合、未绑定参数的拒绝自动写入及警告，以及包含元数据/配置/时间字段的全源文档哈希。比较为类型敏感的规范 JSON；整数、浮点、布尔、字符串不会混同。typed delta 共 173 处，公开结果保留每一处的路径、前后类型和前后值哈希。第 C10 项为一次预先声明的连接改写拒绝，核对错误类型与全源文档哈希，不将其计为正常编译。

执行闭包的 oracle 独立从选中输出沿真实依赖计算；语义活动分支只决定自动写入目标，不用它剪掉运行依赖。完整源文档无损与编译裁剪分别断言。LoRA 请求在预先指定的中性节点/条目索引取得稳定键后发送；预期改动位置和最终完整结构在取得稳定键前已封存，并核对发现的组数与条目总数。

| 案例 | 预先固定的检查主题 | 结果 | 存活节点 | 连接 | typed delta |
|---|---|---|---:|---:|---:|
| C01 | ordinary native scalar chain | PASS | 7 | 9 | 11 |
| C02 | modern separated noise guider sigma chain | PASS | 12 | 12 | 10 |
| C03 | serial refinement first stage controls and seed fanout | PASS | 11 | 16 | 12 |
| C04 | opaque conditioning stage vetoes generic stage controls | PASS | 13 | 17 | 6 |
| C05 | two saved outputs retain both closures and text ambiguity | PASS | 14 | 18 | 18 |
| C06 | explicit multiple image roles preserve exact attachment | PASS | 13 | 15 | 7 |
| C07 | numeric strings remain manual without type guessing | PASS | 7 | 9 | 4 |
| C08 | manual mapping writes native numbers to string controls | PASS | 7 | 9 | 11 |
| C09 | bool is not an automatic integer or float | PASS | 7 | 9 | 8 |
| C10 | top level connection override is rejected | PASS | — | — | — |
| C11 | nested dictionaries and bool overrides preserve types | PASS | 7 | 9 | 3 |
| C12 | tag and manual mapping fanout preserve combined connection | PASS | 9 | 12 | 2 |
| C13 | static selector controls active branch but keeps all dependencies | PASS | 13 | 17 | 11 |
| C14 | pointer selector final state retargets bindings | PASS | 13 | 17 | 12 |
| C15 | unresolved selector preserves both scalar sites and text ambiguity | PASS | 14 | 18 | 18 |
| C16 | draft output prunes only unrelated output and inactive detached node | PASS | 7 | 9 | 11 |
| C17 | 36 LoRA chain exact stable item and untouched numeric strings | PASS | 43 | 81 | 2 |
| C18 | 36 model only LoRA chain disable without invented CLIP | PASS | 43 | 45 | 1 |
| C19 | 32 flat stack stable key preserves neighbors | PASS | 8 | 11 | 4 |
| C20 | flat bool integer float gate representations | PASS | 8 | 11 | 9 |
| C21 | simple mode only active count and selected weight set | PASS | 8 | 10 | 1 |
| C22 | advanced mode keeps simple and draft slots intact | PASS | 8 | 10 | 2 |
| C23 | 34 nested stack optional CLIP stays absent | PASS | 8 | 11 | 3 |
| C24 | 33 wrapped object entries preserve envelope and optional CLIP | PASS | 8 | 10 | 3 |
| C25 | native primitive upstream scalar write preserves connection | PASS | 8 | 10 | 1 |
| C26 | unknown scalar transform needs manual mapping | PASS | 8 | 10 | 0 |
| C27 | explicit bool and dict parameter values stay exact | PASS | 8 | 10 | 3 |

## 需求与规范核对结论

- 普通链与 Flux 风格分离链：正/负词、noise seed、尺寸、batch、steps、CFG、denoise、sampler、scheduler 按已有端口语义落在正确位置，现代双文本端口同步且保留其余字段。
- 串联 refinement：首阶段通用控制与尺寸保持阶段归属，执行 seed 按预期扇出，第二阶段独立提示词与细化设置未被覆盖。无法解释的 conditioning 阶段保留相应控制并给出手工接管警告。
- 多输出、静态及动态 selector：预期输出闭包完整，保留未活动输入的真实依赖；分支 pointer 改写后在最终状态重新推断，未留下旧分支参数写入。不同文本来源的歧义不会被自动覆盖。
- 显式标签与手工 mapping：一对多文本和五个不同图像角色按预期写入，asset 占位对象与所有连接保持；任意显式 bool/dict 值按提供的类型写入。数字字符串和 bool 不被当作自动整数/浮点参数，手工映射后可明确写入 native 数字。
- LoRA：36 节点带/不带 CLIP 链、32 项 flat、34 项嵌套及 33 项 wrapper 对象覆盖精确稳定键、负权重、独立开关、数字字符串、bool/int/float gate、simple/advanced 选中模式、count 范围、草稿位置与可选 CLIP 字段。邻项、另一模式保存值、对象外壳和额外字段均通过完整类型比较。
- 规范方面未发现本职责相关的标准违例。语义路由与完整执行闭包分层，未知变换保守移交显式映射；本审计没有以复制真实工作流或硬编码样本身份产生永久测试。

## 分级发现与未测

Blocker=0，High=0，Medium=0，Low=0。本批次为独立合成编译语义证据，不是任意插件可执行性的承诺。

未测：真实模型出图、插件运行实现、浏览器操作、真实外部工作流盲测、公共 HTTP 保存原子性/坏图隔离/目录缓存、第三方贡献适配器运行及参数面板提交。这些不从本报告推断通过；其他职责的实测事实需在交叉阶段核对。未重跑已由主控确认的远端 CI，本报告不把主控确认当作本职责独立复验。

`report.md`、`results.json`、执行身份、预运行封存和全部私有中性产物由 `initial-seal.json` 记录实际 SHA256；该首版封存后不再修改，后续交叉结论另存。
