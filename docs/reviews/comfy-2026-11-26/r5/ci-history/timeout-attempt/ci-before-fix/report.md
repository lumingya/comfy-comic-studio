# 8d1d9da 远端 CI 证据核验

**结论：REQUEST CHANGES。** 本次仅承担远端 CI 只读观察与证据归档，不是新一轮五审角色，也不证明五路产品终审或后续清理已经完成。

固定源码：`8d1d9da515636967fa5c1c9e494ebd0be0fcec8c`。审计日期：2026-11-26。没有修改源码、Git、workflow 或 gates，没有手动触发新 CI，没有运行本机 Mio、测试、lint、构建、HTTP 或浏览器。只保留一个观察节奏，按 45–60 秒查询两个确切 run；产物出现后仅追加一次详情请求。

## 归属与完整终态

通过远端 REST/CLI 核验仓库 `lumingya/comfy-comic-studio`、run/job 归属、完整步骤及日志。合计 1/2 run、5/6 job、68/70 step success。不是只看 metadata head 或 badge。

| Run | Job / 平台 | 结论 | 实际 checkout |
| --- | --- | --- | --- |
| [45752905758 / push](https://github.com/lumingya/comfy-comic-studio/actions/runs/45752905758) | [gate](https://github.com/lumingya/comfy-comic-studio/actions/runs/45752905758/job/139684698508) | success | `8d1d9da515636967fa5c1c9e494ebd0be0fcec8c` |
| [45752905758 / push](https://github.com/lumingya/comfy-comic-studio/actions/runs/45752905758) | [launchers (windows-latest, Python 3.11)](https://github.com/lumingya/comfy-comic-studio/actions/runs/45752905758/job/139684698509) | success | `8d1d9da515636967fa5c1c9e494ebd0be0fcec8c` |
| [45752905758 / push](https://github.com/lumingya/comfy-comic-studio/actions/runs/45752905758) | [launchers (ubuntu-latest, Python 3.11)](https://github.com/lumingya/comfy-comic-studio/actions/runs/45752905758/job/139684698917) | success | `8d1d9da515636967fa5c1c9e494ebd0be0fcec8c` |
| [45752911753 / pull_request](https://github.com/lumingya/comfy-comic-studio/actions/runs/45752911753) | [gate](https://github.com/lumingya/comfy-comic-studio/actions/runs/45752911753/job/139684723305) | success | `3b4ef74eb0e0c1a70f769979efafa7d5a45ab04a` |
| [45752911753 / pull_request](https://github.com/lumingya/comfy-comic-studio/actions/runs/45752911753) | [launchers (windows-latest, Python 3.11)](https://github.com/lumingya/comfy-comic-studio/actions/runs/45752911753/job/139684723495) | failure | `3b4ef74eb0e0c1a70f769979efafa7d5a45ab04a` |
| [45752911753 / pull_request](https://github.com/lumingya/comfy-comic-studio/actions/runs/45752911753) | [launchers (ubuntu-latest, Python 3.11)](https://github.com/lumingya/comfy-comic-studio/actions/runs/45752911753/job/139684723587) | success | `3b4ef74eb0e0c1a70f769979efafa7d5a45ab04a` |

完整 step 名称、编号、结论、checkout 安全行号及 shell 命令的日志映射均保留在 `ci-verified.json`。每个命令只有在实际执行成功有证据时才视为覆盖；shell 头声明本身不证明后续命令已执行。命令类别在另一个 job 成功，不会抹去 Windows 独立后端矩阵的失败。

## PR 实际合并版本

push 三个 job 的实际 checkout 均为固定提交。PR 三个 job 的实际 checkout 均为 `3b4ef74eb0e0c1a70f769979efafa7d5a45ab04a`，由日志中 `git log -1 --format=%H` 的实际返回值确认。

远端 immutable commit API 确认 PR merge 恰有两个 parents：`5569dc294fd16c7478abbd31317da7e9055c3be7` 与 `8d1d9da515636967fa5c1c9e494ebd0be0fcec8c`。第二 parent 精确等于固定源码，没有把 API metadata head 当 PR merge checkout。

当前 API base 与实际 first-parent 的关系：`{"api_base_sha": "98aefc051fb8a795f49528e9c70b5620dd90ae6d", "actual_first_parent": "5569dc294fd16c7478abbd31317da7e9055c3be7", "equal": false, "compare_status": "ahead", "ahead_by": 21, "behind_by": 0, "merge_base_sha": "98aefc051fb8a795f49528e9c70b5620dd90ae6d", "api_base_is_ancestor": true, "remote_main_sha_observed_after_terminal": "5569dc294fd16c7478abbd31317da7e9055c3be7", "actual_first_parent_matches_remote_main": true}`。运行版本仍以 immutable checkout/parents 为准。
API pull_requests.base.sha 仍为旧祖先，不能把它当实际 main。终态后直接读取 refs/heads/main，确认为上述 first-parent，JSON 记录这两层证据。

两个实际 checkout 的 CI workflow blob SHA：

- push：`f7b08e4b1a182d9eb5b7c0831b46f8cf1e2d6470`。
- PR：`5ae8d64f24cb26d9f7288d6d55fff59b85acdaca`。

实际 workflow 差异如下；不能把不同的合并树当同一树：

```diff
--- fixed-head-ci.yml
+++ pr-merge-ci.yml
@@ -84,7 +84,8 @@
       matrix:
         os: [windows-latest, ubuntu-latest]
     runs-on: ${{ matrix.os }}
-    timeout-minutes: 30
+    # The full Windows suite continues past 30 minutes; retain every test with a bounded budget.
+    timeout-minutes: 60
     steps:
       - uses: actions/checkout@v4
       - uses: actions/setup-python@v5
```

实际 workflow 的 job 超时预算分别为：

- push：`{"gate": 30, "launchers": 30}` 分钟。
- pull_request：`{"gate": 30, "launchers": 60}` 分钟。

本轮 PR Windows suite 实际跑完并报一个断言失败，不是 job 超时或取消；不能用 push 的 30 分钟配置解释 PR 的 60 分钟 job。

## AGENTS 与附加门禁

| AGENTS 验证要求 | push 成功证据 | PR 成功证据 |
| --- | --- | --- |
| backend unittest | true | false |
| ruff server/clients/tools check and format | true | true |
| Python generated API clients current | true | true |
| Spike unittest | true | true |
| shipped data manifest | true | true |
| web format | true | true |
| web typecheck | true | true |
| web tests | true | true |
| web build | true | true |
| web API generation plus no-diff | true | true |

ruff 在 CI 按 server/extensions 与 clients/tools 分组执行，check 与 format 都检查。Python 客户端 `--check` 覆盖快照、正式客户端和 AstrBot 副本；前端 gen:api 后对 schema.d.ts / extensionProtocol.ts 运行 git 无差异检查。

附加门禁包括扩展契约一致性、适配器/启动恢复宿主 lint 与格式、文档链接、扩展/主题 CTK、离线面板脚本、随包清单重建检查、独立 assistant 格式/测试/build/dist 一致性、发行包构建 smoke。32 类实际 shell 命令逐项记录在 JSON；Windows/Ubuntu 启动器和完整后端的状态独立保留。

## 实际测试数量与 skip

| Run | Job / suite | 实际用例 | skip | 失败/错误 | 结果 |
| --- | --- | ---: | ---: | ---: | --- |
| 45752905758 | gate / Spike unit tests (next/) | 80 | 0 | 0 / 0 | OK |
| 45752905758 | gate / v4 server (lint + unit tests) | 1819 | 3 | 0 / 0 | OK |
| 45752905758 | launchers (windows-latest, Python 3.11) / Launchers (static, bootstrap, real start.bat / start.sh from scratch) | 31 | 0 | 0 / 0 | OK |
| 45752905758 | launchers (windows-latest, Python 3.11) / v4 server unit tests | 1819 | 0 | 0 / 0 | OK |
| 45752905758 | launchers (ubuntu-latest, Python 3.11) / Launchers (static, bootstrap, real start.bat / start.sh from scratch) | 31 | 0 | 0 / 0 | OK |
| 45752905758 | launchers (ubuntu-latest, Python 3.11) / v4 server unit tests | 1819 | 3 | 0 / 0 | OK |
| 45752911753 | gate / Spike unit tests (next/) | 80 | 0 | 0 / 0 | OK |
| 45752911753 | gate / v4 server (lint + unit tests) | 1949 | 3 | 0 / 0 | OK |
| 45752911753 | launchers (windows-latest, Python 3.11) / Launchers (static, bootstrap, real start.bat / start.sh from scratch) | 31 | 0 | 0 / 0 | OK |
| 45752911753 | launchers (windows-latest, Python 3.11) / v4 server unit tests | 1949 | 0 | 1 / 0 | FAILED |
| 45752911753 | launchers (ubuntu-latest, Python 3.11) / Launchers (static, bootstrap, real start.bat / start.sh from scratch) | 31 | 0 | 0 / 0 | OK |
| 45752911753 | launchers (ubuntu-latest, Python 3.11) / v4 server unit tests | 1949 | 3 | 0 / 0 | OK |

| Run | Vitest suite | 文件/用例 | 通过 / 总数 |
| --- | --- | --- | --- |
| 45752905758 | v4 web (API types current + format + typecheck + tests + build) | files | 119 / 119 |
| 45752905758 | v4 web (API types current + format + typecheck + tests + build) | cases | 965 / 965 |
| 45752905758 | Standalone assistant extension | files | 2 / 2 |
| 45752905758 | Standalone assistant extension | cases | 34 / 34 |
| 45752911753 | v4 web (API types current + format + typecheck + tests + build) | files | 133 / 133 |
| 45752911753 | v4 web (API types current + format + typecheck + tests + build) | cases | 1100 / 1100 |
| 45752911753 | Standalone assistant extension | files | 2 / 2 |
| 45752911753 | Standalone assistant extension | cases | 34 / 34 |

push 固定树与 PR merge 树的计数分别记录，不能互相替代。`unittest -q` 只直接给出 aggregate skipped 计数，并不逐 case 打印名字或理由。本次另外读取两个 immutable revision 的 Windows 路径测试源码，按完全相同的条件守卫解释 Linux 的三个 skip：

- `tests.test_windows_path_aliases.ThemePathAliasTests.test_ordinary_short_path_is_accepted_by_package_and_resource_checks`：`unittest.skipUnless(os.name == "nt", "8.3 aliases are a Windows filesystem feature")`；源码 `server/tests/test_windows_path_aliases.py:39`。
- `tests.test_windows_path_aliases.ThemePathAliasTests.test_missing_child_below_ordinary_short_path_is_allowed`：`unittest.skipUnless(os.name == "nt", "8.3 aliases are a Windows filesystem feature")`；源码 `server/tests/test_windows_path_aliases.py:46`。
- `tests.test_windows_path_aliases.ThemePathAliasTests.test_real_junction_ancestor_is_rejected`：`unittest.skipUnless(os.name == "nt", "junctions are a Windows filesystem feature")`；源码 `server/tests/test_windows_path_aliases.py:81`。

前两项属于 Windows 8.3 aliases，后一项属于 Windows junction。JSON 保留两版本源码 blob SHA。此为源码条件归因，明确不冒充 quiet 日志直接给出了逐 case 运行身份。Windows 完整 suite 是否 0 skip，以各自实际终态日志为准；启动器的 0 skip 不替代完整后端结果。

## 预览产物与编译版本

- push run `45752905758`：artifact **15086224952**，`web-preview-8d1d9da515636967fa5c1c9e494ebd0be0fcec8c`；758554 字节，digest `sha256:8c8d505885af88895b499dde7a30494d8acfdcf0d9f6f137f943519d9de1c94e`，expired=`false`，expires_at=`2026-11-28T04:24:43Z`。名称与实际 checkout 匹配：`true`；API run 关联匹配：`true`。
- pull_request run `45752911753`：artifact **15087376545**，`web-preview-3b4ef74eb0e0c1a70f769979efafa7d5a45ab04a`；766799 字节，digest `sha256:f4a6347d24556e13d72bd174660532c75f165268ed118ae9bc5a1e17976c318e`，expired=`false`，expires_at=`2026-11-28T04:21:31Z`。名称与实际 checkout 匹配：`true`；API run 关联匹配：`true`。

实际 workflow 使用 actions/upload-artifact@v4，在 web build 后上传 web/dist，以 github.sha 命名。push 产物专用于固定源码，PR 产物名称包含实际 merge SHA；不能拿旧 ed45509 产物代替新 8d1d9da。artifact 存在本身不等于全部 CI 绿灯，本观察员没有下载或启动产物。

## 失败/跳过步骤与日志归档

- run `45752905758`：最终 `success`；非 success step 数 `0`；真实失败/取消/跳过状态均在 JSON 中保留。
- `raw-ci-45752905758.log`：2514 行，原始 SHA-256 `c12d6baba1dc6f60378f8201ba8b751fd49debf96172438985e9c7f40773fcb4`。
- run `45752911753`：最终 `failure`；非 success step 数 `2`；真实失败/取消/跳过状态均在 JSON 中保留。
  - job `139684723495` / v4 server unit tests，安全行 2131：`Process completed with exit code 1.`
- `raw-ci-45752911753.log`：2676 行，原始 SHA-256 `0256161fe6f6a33646b6875cd78da1028d1376bdcf45ba5ec0076ef0b6eeec7e`。

唯一真实失败用例：`tests.test_review_cloud_deadline.CloudDeadlineReviewTests.test_tls_handshake_stall_obeys_deadline`；exit code `1`。完整 suite 的 `Ran 1949 tests` 与 `FAILED (failures=1)` 已直接观察，quiet 日志对该失败用例给出名字；这与 skip 的源码归因不同。

- 安全行 2117：`FAIL: test_tls_handshake_stall_obeys_deadline (tests.test_review_cloud_deadline.CloudDeadlineReviewTests.test_tls_handshake_stall_obeys_deadline)`
- 安全行 2121：`self.assertIn("deadline", str(caught.exception), details)`
- 安全行 2122：`AssertionError: 'deadline' not found in 'Image service connection failed' : elapsed=1.187000s, remaining=0.012999999999919964, causes=[('LLMError', None), ('ConnectTimeout', None), ('ConnectTimeout', None), ('TimeoutError', None)]`
- 安全行 2125：`Ran 1949 tests in 1757.857s`
- 安全行 2127：`FAILED (failures=1)`
- 安全行 2131：`Process completed with exit code 1.`

断言要求异常包含 deadline，实际为 Image service connection failed。仅记录观察事实，不在本轮 CI 证据工作中推断或修复实现。所有原始日志仍保留在私有归档，未公开完整 traceback 或运行器路径。

独立只读源码诊断交接确认：该测试在共同基点、当前 main 与固定 8d1d9da 分支均已有且 blob 相同（6587c4595e6ef5d2430a00cb8cbc453b4e1b790e），本任务未改。不能描述为仅由 main 新引入；后续定位另行进行。

GHA 测试中预期故障分支打印的 error/trace 不被等同于 CI failure；实际失败按 API step 结论及对应输出判定。原始日志/API 原件/辅助脚本仅留 TEMP，公开白名单只有 `report.md`、`ci-verified.json`，不整目录复制。两个公开文件检查 UTF-8 无 BOM、禁用图字典键、凭据标记及私人绝对路径，不包含完整真实图或原始日志正文。

发行包 smoke 是发行 ZIP/manifest 构建检查，不外推为安装器启动、签名更新安装、GPU 或付费服务通过。CI 证据通过也不替代接下来的五路独立产品终审。
