# R3 画布血缘跟进修复

本页记录 `eb876cf` 同队列复测暴露的复合潜空间回归修复，不是新一轮独立终审。原 [67/70 失败记录](corpus-after.md)及预写真值保留。

## 修复范围

仅修改 `binding_scope.py`、`binding_dimensions.py` 与 `test_workflow_canvas_scope.py`。

- 共享画布端口及尺寸字段角色，沿 `samples_to/samples_from` 追踪复合潜空间的所有区域，不把后级 finishing sampler 误当首级。
- 跟踪画布证明是否完整。未知中间依赖、已知 image 与未知 operand/source/target 混合的区域，都不能被已知支路掩盖，也不能令已见 sampler 自动晋升。
- 根输出血缘不完整时保留人工接管；模型、VAE、条件、尺寸、参考图、蒙版及 upscaler 配置等明确的非画布角色不混入生成阶段。
- 未按插件类名猜测 ColorMatch、未知 bundle 或数字变换。原 hf 两项自动真值缺失与私有 138 三项撤回仍需如实计量，不能靠改真值消除。

## 有限本机验证

| 阶段 | 实际结果 | 证据界限 |
|---|---|---|
| 初始 compound/unknown 修复 | 5 模块、66 方法通过 | 其后 mixed 完整性修复使此快照过期，原日志保留 |
| mixed 与根血缘完整性修复 | 68 方法，67 通过、1 失败，退出 1 | 发现已有 `reference_image` 被误当未知画布依赖；失败没有覆盖 |
| 补齐 reference_image 后 | 仅重跑受影响的 16 方法，全部通过、退出 0 | 未重跑全部 68 方法，完整覆盖由后续新提交 CI 提供 |
| 最后三文件检查 | Ruff、格式、UTF-8、源码编译、diff-check 通过 | 未运行全仓本机单测或前端测试 |

最后两次实际测试进程为 40372 和 7528，均在导入 Mio 前将 affinity 从 `0xffff` 限为 `0x1` 并读回，同时设为 BelowNormal、读回 priority class 16384。各次仅一个 Python 进程，launcher 启动子进程数 0；运行期间源码哈希不变，完成后进程退出。没有模型、GPU、ComfyUI 服务或付费 API 调用。

最后源码写入时间为 **2026-11-25 17:53:37.276574 UTC**（北京时间 **2026-11-26 01:53:37.276574**）。最终三文件 SHA-256：

| 相对仓库路径 | SHA-256 |
|---|---|
| `server/mio_server/comfy/binding_scope.py` | `abf8c3c48eb692e58307986ec2b902aa70570e927b6dd7689dd7966f5f156d6d` |
| `server/mio_server/comfy/binding_dimensions.py` | `b2313017cea27fd1c6cafb2943d50bbb006ca49c22e8a01c6965d8fb99bc385c` |
| `server/tests/test_workflow_canvas_scope.py` | `2f0da59e7e2dee621889f7fcd0f19456b33b9b7e60394eda661ea3d2ede24cb7` |

原 66 项日志 SHA-256 为 `ad1685794997178b0b14a683a7be5e6437f97187e51b3e4aa9f1bd63a7a46149`，原结果 JSON 为 `823617c988bb2b5414e8b3731d005e9b47228aff830feb4e203911906d311413`，核对未变。临时完整输出保留供最终证据收集，随后与任务缓存一起清理；本页只保留中性结构、计数及摘要。

后续仍需对最后源码重跑固定真实队列、取得新提交完整远程门禁，并启动五位全新上下文审查者。现有通过结果不作这些未完成要求的替代。
