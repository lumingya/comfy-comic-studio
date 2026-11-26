# ed45509 远端 CI 终态封存

**结论：REQUEST CHANGES，不能作为完整绿灯。** 本次只承担只读远端 CI 观察与证据归档，不是新一轮五审角色。固定源码为 `ed45509456b14006161d829666c466789e6a9e37`。没有改源码、workflow 或 gates，没有手动触发 CI，没有运行本机 Mio、测试、lint、构建、HTTP 或浏览器。

## 两个确切运行的最终结果

| Run | 最终 run 结论 | gate | Ubuntu launchers / 后端 | Windows launchers / 后端 |
| --- | --- | --- | --- | --- |
| [push 45750256236](https://github.com/lumingya/comfy-comic-studio/actions/runs/45750256236) | cancelled | success | success | cancelled |
| [PR 45750263955](https://github.com/lumingya/comfy-comic-studio/actions/runs/45750263955) | cancelled | **failure** | success | cancelled |

两个运行在后续 push 后进入取消终态。PR 的 run 总结为 cancelled，不会抹去此前已发生的 gate 类型检查失败。完整远端 API 清单为 6 个 job、70 个 step，其中 3 个 job、59 个 step success；其余状态、完整名称与编号均保留在 `ci-verified.json`，没有拿部分成功或 badge 冒充全绿。

## 精确失败边界

失败 job：`139676069344`。失败 step：`v4 web (API types current + format + typecheck + tests + build)`。

实际失败命令为 `npm --prefix web run typecheck`，执行程序 `tsc --noEmit`，exit 2：

- `src/components/ui.tsx(185,3): error TS2300: Duplicate identifier 'onCloseAutoFocus'.`
- `src/components/ui.tsx(191,3): error TS2300: Duplicate identifier 'onCloseAutoFocus'.`

此处没有失败测试名称：失败发生在 TypeScript 检查，尚未执行 Vitest。日志明确先越过 npm ci、gen:api、API 生成物无差异检查及 Prettier；Prettier 输出全部匹配。bash `-e` 失败即停，故随后声明在 shell 头中的 web test、面板脚本、web build 并未执行；之后上传、随包、独立 assistant、发行包 step 均未完成。JSON 区分“shell 头声明的命令”与“有成功执行证据的命令”，没有把声明当执行。

失败原始 job 日志的安全证据行号为 620–625；完整 run 日志的对应安全行号另保留在 JSON。预期异常测试打印的日志没有被当成本次失败原因。

## 实际 checkout 与 PR parents

- push 三个 job 的实际 checkout 日志均为固定 `ed45509456b14006161d829666c466789e6a9e37`。
- PR 三个 job 实际 checkout 均为 merge `53f891a74aec61e724495762c436e2a1f8bf2cfc`，不是 metadata head。
- 远端 immutable git commit API 确认 PR merge 恰有两个父提交：`5569dc294fd16c7478abbd31317da7e9055c3be7` 与 `ed45509456b14006161d829666c466789e6a9e37`。

每个 job 的 checkout 安全行号、完整 API job/step 归属、实际 CI workflow blob、PR 当前 base 与实际 first-parent 的关系都在 JSON 中保留。

## 已执行门禁与实际用例数

| 项目 | push 固定树 | PR merge 树 |
| --- | --- | --- |
| gate / Ubuntu 完整后端 | 每 suite 1819，OK，skipped=3 | 每 suite 1949，OK，skipped=3 |
| Windows 完整后端 | 取消，无完整结果计数 | 取消，无完整结果计数 |
| 启动器 | Windows 与 Ubuntu 各 31，OK，0 skip | Windows 与 Ubuntu 各 31，OK，0 skip |
| Spike | 80，OK，0 skip | 80，OK，0 skip |
| web Vitest | 119 文件 / 965 用例通过 | 未执行，typecheck 先失败 |
| 独立 assistant | 2 文件 / 34 用例通过 | 未执行 |

push gate 已成功执行 AGENTS 的全部 10 行要求，含 Python 客户端 `--check`、前端 gen:api 后的 schema/protocol 无差异、ruff、前端格式/类型/测试/构建、next、随包校验、扩展契约/CTK、assistant build/dist 一致性及发行包构建 smoke。但其 Windows 完整后端被取消，因此仍不构成跨平台完整通过。PR 已执行的生成与 lint/后端要求保留成功证据；类型失败后的命令和 step 明确未完成。

Linux `unittest -q` 运行日志只给出 `skipped=3` 总数，没有直接打印每个 skip 的 case ID。远端读取固定 push 与实际 PR merge 的 immutable 源码，三项 Windows 文件系统条件守卫完全一致，归因到 `tests.test_windows_path_aliases.ThemePathAliasTests` 的：

1. `test_ordinary_short_path_is_accepted_by_package_and_resource_checks`
2. `test_missing_child_below_ordinary_short_path_is_allowed`
3. `test_real_junction_ancestor_is_rejected`

前两项需要 Windows 8.3 aliases，后一项需要 Windows junction。JSON 保留源码行号、blob SHA 与装饰器，并明确这是源码条件归因，不冒充 quiet 日志直接输出了逐 case 身份。Windows 完整 suite 取消，不能用启动器的 0 skip 推断全部 Windows case 已执行。

## 历史预览产物

push 上传产物 ID 为 **15086046905**，名称为 `web-preview-ed45509456b14006161d829666c466789e6a9e37`，明确属于 run `45750256236`。其名称、run 关联和 gate 实际 checkout 精确匹配；大小 758554 字节，API digest 为 `sha256:3c647ce866997241133d5a004497586baf92faaba9681434dee40f1d1b77f40b`。

该产物只证明固定 push 树的 web build/上传已成功，不代表这两个 CI run 全绿，也不适用于后续 `8d1d9da515636967fa5c1c9e494ebd0be0fcec8c`。按 root 指示，它只保留历史用途，没有由本观察员下载或启动预览。

## 归档与发布边界

只公开 `report.md` 与 `ci-verified.json`。原始日志、API 原件及辅助脚本只留在本轮独立 TEMP 目录，不覆盖 r3 原件，不整目录发布。JSON 已检查禁用图字典键、凭据标记和私人绝对路径，使用 UTF-8 无 BOM；不含完整真实图或原始日志正文。

发行包 smoke 是构建产物检查，不证明安装器启动、签名更新安装、GPU 或付费服务。本封存报告也不证明后续修复已通过 CI；后续只观察新固定提交对应的两个新 run。
