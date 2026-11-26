# R6 局部验证与提交源码身份发布准备

本包为 **RESULTS_RECORDED_REVIEW_REQUIRED / AWAIT_R6_DELIVERY_PUBLICATION**，仅准备外部安全证据。没有写仓库、提交或推送，也没有运行产品、测试、构建、浏览器或网络请求。来源的 30 个测试方法是已执行的有限局部验证，不是完整 CI；远端 CI 未由本组包查询，五路审查和最终交付亦不在本包签署范围。

## 文件与时间线

| 阶段 | 安全发布文件 | 保留的事实 |
|---|---|---|
| 首次局部检查 | [validation](validation.json)、[源冻结聚合投影](frozen-source.json) | parent `6122ccab6aae015d1fb20295db4a66158e8f790f` 上的未提交工作树；lint 退出 0，format check 退出 1，测试未执行，successful=false。 |
| 机械格式恢复 | [format recovery](format-recovery.json) | 仅 helper 与测试两文件格式化；来源分别记录前后 SHA 和 ast_unchanged=true，第一次未执行测试的事实不变。 |
| 格式后局部检查 | [formatted validation](formatted/validation.json)、[格式后源冻结聚合投影](formatted/frozen-source.json) | 相关检查退出码 0/0；30 个唯一测试方法执行，failure/error/skip 均 0。仍保留 parent 下受测工作树身份。 |
| 提交封存 | [committed source](committed-source.json) | 后来提交 `fe914065c7aafb0672bfe10274361f83179ce7f1`，来源声明 tested_source_hashes_match=true；不把前述测试改写成提交后重新执行。 |
| 三文件独立字节核对 | [source byte identity](source-byte-identity.json) | 只读取精确 `git show fe:<path>` 和对应三份工作区源码，计算 raw SHA256/Git blob SHA1，并做 stdlib AST 比较。 |
| 出版完整性 | [manifest](manifest.json) | 六份原始 JSON 的来源/发布双 SHA、投影范围和前后源 SHA 检查；生成文件另记发布 SHA。 |

首次验证 UTC 为 `2026-11-26T07:58:58.814133+00:00` 至 `07:58:58.996517+00:00`；记录的外层 elapsed_seconds 为 `0.5173803000361659`，不以墙钟差替换原计时。首个 format check 针对三文件退出 1，format recovery 明确仅两文件需要机械格式恢复。

格式后局部验证 UTC 为 `2026-11-26T08:00:11.252252+00:00` 至 `08:00:13.253246+00:00`。来源的 unit elapsed_seconds 为 **0.07075790001545101s**，外层 elapsed_seconds 为 **2.2118770999950357s**；两者是不同计时范围，不混用。四个测试类/方法入口及实际加载的 30 个方法 ID 保留，不能把 30 个方法称为全后端或完整 CI。

## 冻结身份与范围

首次与格式后 validation/frozen-source 的 CPU guard 均为 affinity **1**、priority class **16384**，并记录先于产品导入；format recovery 也保留同一限制。首次未格式化聚合与后来格式化聚合各自保留，不用后者覆盖前者。

格式后／提交记录的实际源码聚合为：

- runtime **218**：`a00155daa5515501eb3ee117f284c2ae1f8152ac038d7efa7f6208c46b8ad487`
- all-server **407**：`018c572cec3c9a629b13e4ea3bf6f6b5fd1323b0581c5f696c294007c61f7b32`
- helper：`e9a50786e9beeb38810feb096e4d6a28bda2c1639eca567dd755c580aedbd4ae`
- 测试源码：`1cd613abbae1be087b4464e189bc4c86851d31227db5038ce4690789450f40fd`

218/407 的全清单聚合及干净 source_status 是来源 JSON 的冻结声明。本组包没有再读取其余 404 个 server 文件，也没有作独立全树状态查询。两份安全冻结文件以原聚合、数量和三份限定变更文件的 hash 替代重复逐文件大表，原始完整冻结 JSON 的 SHA 仍在 manifest。

## 三文件字节与 AST 证明

限定文件为 `server/mio_server/comfy/inspection.py`、`server/mio_server/comfy/inspection_candidates.py`、`server/tests/test_workflow_inspection_candidates.py`。本次核对时三文件均无 CRLF，工作区原字节与 `git show fe:<path>` 原字节 **3/3 相同**，对应 SHA256 和计算 Git blob SHA1 逐项相同；LF newline 比较与 stdlib AST 比较也均 **3/3 相同**。没有出现需要仅用换行等价替代原字节一致的文件。

AST 核对使用隔离 Python `-I -B -S` 的标准库 `ast.parse`／`ast.dump(include_attributes=False)`，只输出 AST hash；进程在解析前设置并读回 affinity 1、BelowNormal 16384，没有应用导入、方法执行或代码值输出。它核的是当前三文件与提交 blob，不是重新执行格式前后的 producer 格式恢复证明；后者仍明确来源于 format-recovery.json。

这三文件结果不能扩成全部 checkout 字节与 CI blob 一致：本组包没有读取远端 CI checkout，也没有读取整树其余文件。提交父身份来自 committed-source.json，本次只做被允许的三个 `git show`，没有查询 Git status、log、diff 或远端。

## 安全出版边界

只消费六份明确 JSON，以及被单独允许的三文件提交/工作区字节；private logs、其他审查、原图、提示词或资产内容均未读取或复制。来源 JSON 中的 218/407 项 hash 清单只作元数据投影，不读取其余 404 项对应源码，也不复制重复完整清单。六份源 JSON 保持原字节，安全副本去除整表与任何本机绝对路径，必要代码相对路径、测试 ID、数值、失败记录、guard 和来源 SHA 保留。发布包统一 UTF-8 无 BOM、LF、单 EOF；递归禁键、路径/秘密/资产检查、相对链接与双 hash 检查记于 manifest。

本包应等 R6 交付时再发布。历史 71 文件已由主控在 parent `6122ccab6aae015d1fb20295db4a66158e8f790f` 所在交付链归档，不在此重新组包或改变旧审计结论；后续完整 CI 与五路审查必须使用它们自己的实际候选和 checkout 证据。
