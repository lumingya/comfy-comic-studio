# Timeout ownership 收窄补丁：有限验证出版记录

状态：**RESULTS_RECORDED_REVIEW_REQUIRED**。版本标识为 **`worktree_patch_on_6e`**，基底 `6e302081e650210202b232990ab05bbd6961e149`；本份证据描述主控交付时尚未提交的两文件工作区补丁，不是已提交的新 HEAD。之后的新提交须由主控另行记录，不能自动替换此处的补丁身份。

本文件仅整理指定验证，不是 R5 独立审查或全门禁签字。完整安全聚合见 [validation.json](validation.json)，原始来源哈希、计算 Git blob SHA-1 与发布规范见 [manifest.json](manifest.json)。

## 必须保留的反例与修复意图

主控提供的 6e CI 观察快照为：两个 Linux job 均出现同一组 ERROR／FAIL。custom GET 的提前 `ReadTimeout` 不再按原有限预算重试而报 ERROR；custom `ConnectTimeout` 的 `sent=True` 与应为 `False` 不符而 FAIL。它们反驳了把 timeout 分类宽泛应用到所有 `TimeoutException` 的假设，不能被旧 6e 局部 3 方法／50 子场景成功记录洗成全门禁正确。

主控随后将补丁收窄为 native guard ownership：仅原生受控路径拥有相应预算分类，custom transport 保留原规则。这里是主控提供的补丁意图和 CI 失败快照，不是本出版者读取产品后得出的源码结论。主控另提供的独立静态复核未见阻断，也不等于 R5 五路审查签字。

负责远端 CI 的观察员仍在等待 Windows 终态报告；本 allowlist 没有该未成稿报告，本出版任务也没有读取、查询或补造远端结论。**新 CI 终态、新五路审查、清理均为 PENDING。**

## 两个固定文件与已有验证

两份源 JSON 的 before／after 哈希一致，范围为：

- `examples/extensions/standard-image-channels/transport.py`：`6ea6c8ee92319e4160b2952a3f06e44f999abb7ce700872d04c65d0da8c22ebd`。
- `server/tests/test_cloud_timeout_classification.py`：`85070b64185f33c52f6d7f05e6a4309a22186b42c56d69619055ab77458addf9`。

| 批次 | 记录项 | exit code | 记录的外层耗时 |
| --- | --- | ---: | ---: |
| 首批 | lint | 1 | 0.041 秒 |
| 补跑 | lint-server-autodiscovery | 0 | 0.040 秒 |
| 补跑 | format-check | 0 | 0.042 秒 |
| 补跑 | offline-unit | 0 | 2.140 秒 |
| 补跑 | diff-check | 0 | 0.060 秒 |

首批 lint 的失败与未执行测试保持原样。resume JSON 明确说明显式 `--config` 改变了 server 测试的 first-party import 发现上下文，而实际 CI 按每文件自动发现 server 配置；无需改源代码。主控将该首批失败标为 I001，并说明补跑按 CI 自动发现 server 配置、使用 100 列格式。I001 代码与 100 列说明属于主控补充，紧凑 JSON 直接保存失败原因文字、运行名称与退出码。

源 JSON 记录新增 **4 个方法／100 个确定性子场景**，另选 **2 个旧回归方法**。显式白名单 `offline-unit.log` 的三行摘要直接为分隔线、`Ran 6 tests in 0.061s`、`OK`。因此保存的是六个方法的 unittest 摘要 **0.061 秒**，与 JSON 外层 `offline-unit` 的 **2.140 秒**分别记录，不把 100 个子场景冒充 100 个 unittest 方法。完整日志不复制发布，仅保留来源哈希与三行中性摘要。

## 验证与出版边界

验证只使用 MockTransport／工厂 mock 和无线程 FakeDeadline；源 JSON 明确 `network=false`、非完整 suite、串行。真实 TLS、guard 线程和 socket 路径仍需远端证明。全部三个去重进程的 guard 均记录实际 affinity `0x1`、priority class `16384`、`verified_before_mio_import=true`；出版者没有重新执行这些验证。

源 allowlist 严格只有 `r5-timeout-ownership-validation/result.json`、`r5-timeout-ownership-validation/resume-result.json`、`r5-timeout-ownership-validation/offline-unit.log`。两份 JSON 的解析值完整聚合，初始失败不覆盖；中性日志只提取三行摘要。所有额外 CI／补丁语义说明均归于主控任务快照，不作为独立实测。

原文件字节与哈希不变。发布文本仅做 UTF-8 无 BOM、LF 和单末尾换行规范化；本任务未读原图、产品源码、其他日志或未成稿 CI 报告，未执行产品、测试、服务、网络、浏览器或 Git 查询，未改仓库与旧 R4／R5 ready 文件。实际入库后的 Git blob 核对仍需发布者另行完成。
