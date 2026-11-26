# HTTP 预算 timeout 分类修复：有限验证记录

状态：**RESULTS_RECORDED_REVIEW_REQUIRED**。主控记录修复提交为 `6e302081e650210202b232990ab05bbd6961e149`，已 push；本文件仅整理已有中性验证，不是全门禁、新五路终审或真实网络／图片执行签字。

## 两个限定文件与已有验证

源 JSON 的 before／after 哈希均一致，范围只有：

- `examples/extensions/standard-image-channels/transport.py`：`b3d3eb17e004f8bb6083fc23d6ba540c2943a559169ace8e06e82247c9752d49`。
- `server/tests/test_cloud_timeout_classification.py`：`1984ce2ac1891fbe6268f2c01261593f987dff027a725e384864cc82c68dae66`。

完整安全聚合与来源哈希见 [validation.json](validation.json)。本次出版没有读取上述源码或执行这些命令。

| 批次 | 记录项 | exit code | 记录的外层耗时 |
| --- | --- | ---: | ---: |
| 首批 | lint | 0 | 0.070 秒 |
| 首批 | format-check | 1 | 0.037 秒 |
| 补跑 | format-check-configured | 0 | 0.045 秒 |
| 补跑 | offline-unit | 0 | 0.462 秒 |
| 补跑 | diff-check | 0 | 0.060 秒 |

首批格式检查失败原样保留，测试在该批未执行。主控执行补充说明：首批误用了默认 88 列格式配置，补跑改为 server 的 100 列配置后通过；它不表示已观察到产品格式缺陷。已通过的 lint 未重复，首批 result 也没有被补跑覆盖。

主控执行补充另记录：离线 unittest 为 **3 个测试方法、50 个 Mock 子场景**，unittest 摘要耗时 **0.018 秒**。紧凑 resume JSON 直接记录的是外层 `offline-unit` 批次 0.462 秒和 exit 0；两种计时范围不同，不能混用。验证只用 MockTransport，原生传输构造被禁止；不是 50 个独立 unittest 方法，也不证明真实 TLS／HTTP 服务在本机重放成功。

两份 JSON 均记录串行、非完整 suite、source unchanged。所有保存的 guard 均为实际 affinity `0x1`、priority class `16384`，且 `verified_before_mio_import=true`。本出版任务只读这四份显式白名单证据，没有读取脚本／日志或运行 Mio、测试、服务、HTTP、浏览器。

## 原失败与修复范围分开保留

修复前的 8d1d 远端 CI 仍为 **REQUEST CHANGES**：push `45752905758` 成功，PR `45752911753` 失败。PR 实际 merge 为 `3b4ef74eb0e0c1a70f769979efafa7d5a45ab04a`；Windows 完整后端跑完 1949 例并有 1 个断言失败。唯一失败为 `test_tls_handshake_stall_obeys_deadline`：要求异常包含 `deadline`，实际为 `Image service connection failed`。这是已保存 CI 证据，不是本次出版重新复现。

两文件修复和有限 Mock 验证不能把上述历史失败改写为通过；本 allowlist 没有 6e30208 对应远端 CI 终态报告。

主控提供的范围说明为：Mio 的 217 个模块聚合 SHA-256 仍为 `5a5ee950ae0c972791ae17fab92978579adec7d6d419133e6eaf9eb9e649377d`。本次出版没有重算该聚合。既有真实工作流复测仍属于原 `ed45509456b14006161d829666c466789e6a9e37`，没有移记为在 6e30208 执行，也没有因该聚合保持而追加兼容性或全终审通过结论。
