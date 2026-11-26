# 第四轮独立终审：隐私、仓库卫生与跨平台 CI

**职能结论：VERIFIED PASS。** 本结论仅覆盖固定提交的隐私、仓库卫生与指定远端 CI 证据，不代表其他四路产品终审通过。另记录一项本轮浏览器工具返回非任务页的 **Medium 已遏制流程事件**；它不是已证明的提交泄漏，但其初始会话记录影响仍未知，不能改写成“从未读取或返回非任务页”。

- 审计日期：2026-11-26。
- 固定 HEAD：`3e994bb80794dea7be9773f5cb9c47119bf34c27`。
- 比较基点：`38838ab43cf3d056951f2fc6c52afb737d34e3c6`；本审计使用两点差异并补查其间全部 10 个提交。
- 已读 AGENTS、README、ROADMAP 与完整原任务。此前审查、修复报告只作为提交内容执行字节/模式/schema 扫描，没有读取其结论来决定本次放行。CI 子审计是本轮新委派的只读独立核验。
- 未修改产品、Git 或用户原工作区；未执行本机单测、Vitest、构建、服务或产品探针。静态脚本使用标准库、顺序扫描并下调为 BelowNormal；没有执行本地并行门禁。

## 分级发现

| 分级 | 固定提交内未关闭缺陷 | 结论 |
| --- | ---: | --- |
| Blocker | 0 | 未发现 |
| High | 0 | 未发现 |
| Medium | 0 | 未发现提交内隐私/CI 缺陷；运行流程事件见下节 |
| Low | 0 | 未发现 |

### PRIV-R4-01 · Medium · 非任务浏览器表面意外返回，已遏制

本轮 Web 审计沿用此前记录的任务 MCP page ID 调用 snapshot；返回的是非任务页 a11y。随后同一执行单元仅检查 origin/path、UA、viewport、file inputs 与工作流链接筛选，也检出非任务 origin。该事实来自 root 的当前运行事件通报，并已直接向本轮 Web 审计员核对；本审计没有获取、查看、复现或转发意外页面输出。

据当事审计员确认，没有在该页点击、修改、下载、截图或显式写入文件，没有读取 Cookie、Authorization、浏览器 profile。没有将意外 URL、账号或页面文字写入拟发布 report/measurements。不能据此证明工具结果在会话系统中没有记录，也不能推定具体页面内容、账号暴露程度或插件故障根因；初始影响未知的边界保留。

已直接核验的遏制事实：停止使用该 MCP Chrome 入口；通过专属任务 CDP 新建独立 context/page；首次正文或 a11y 内容读取前，实际执行精确任务 origin 校验且结果为 true。Web 自动化进程读回单 CPU affinity `1`、BelowNormal priority `16384`，没有 import Mio。Web 后续安全测量文件只保留上述步骤与布尔事实，不含意外内容。此项视为已遏制的审计流程事件，不扩大解释为固定提交中的产品隐私缺陷；后续发布仍须按安全文件白名单检查。

## 提交与工作区证据

1. 最终差异包含 **106 个文件**，全部可按 UTF-8 解码，未发现 NUL 或图片文件头；没有新增二进制样图。其间 **10 个提交、167 个不同的路径/文件内容版本**均经同类扫描，没有曾加入后再删除的额外路径，敏感候选和二进制候选均为 0。
2. 检查的敏感类别包括个人 Windows/Unix 家目录或私人桌面绝对路径、私钥、常见 API/GitHub/AWS 凭据、JWT、长 Bearer/Cookie 载荷、带敏感参数的 URL、长凭据赋值以及内嵌 PNG/JPEG/base64 图片。没有回显潜在凭据值。
3. **19 个文档 JSON**做递归 schema 与字符串形态检查：没有原图节点字典键，没有长字符串或非指针提示词候选。**33 个文档 Markdown**没有原图字典片段候选。以上是机械内容卫生检查，没有采用旧报告的通过/失败结论。
4. 工作树 porcelain 为空，非忽略未跟踪文件为 **0**；106 个变更文件实际文本与 HEAD 一致。**15,877 个忽略项**全部归入现存依赖/构建/缓存类别：node_modules 15,313，dist 81，Python bytecode 457，ruff cache 26，没有无法归类的忽略项。本结论不是对依赖或缓存内部全部字节作机密审计。
5. 提交差异没有 `data/` 变更。实际 `data/` 共 **65 个受控文件，64 个 skip-worktree**，内容与 HEAD 一致。没有修改保护标记；没有触碰用户原工作区。

## 合成夹具与导入隐私边界

- `server/fixtures/workflow_slots_contract.json` 的 63 个既有 case，输入 workflow 逐项与比较基点相同，没有新增 case；既有 138 节点图没有被本轮替换或重新导入。不能把“本次没有新增外部图”扩大成“仓库历史从来没有真实图”。变更仅涉及分析修订及预期结果。
- 15 个发生变更的后端测试文件中的提示词、模型/LoRA 名称、图片名称与保存前缀字面值经 AST 提取并人工核对，为中性的 subject、region、exclusion、ink、synthetic 等合成值。没有读取网络来源或外部图片作为新增回归输入的文件调用。
- `server/tests/test_workflow_import_media.py:29`、`:42` 的 PNG/WebP 由内存中的 **2×2 白图**与测试元数据构造；没有把第三方版权图片编码后塞进源码。`:260` 的测试限定预检不写工作流、不入队、不联系 ComfyUI；`:299` 检查错误不回显输入字面值；`:308` 检查 v2 匿名拒绝并使用隔离测试令牌。
- `server/tests/test_workflow_wild_contracts.py:55` 的 200 节点压力图由 7 节点合成底图和 `:58` 的 193 次 Reroute 循环生成；它是有目的的规模用例，没有保留野生巨图内容。
- 静态检查新入口 `server/mio_server/api/library.py:142` 与解析器：文件预检流式限制为 64 MiB，元数据累计限制为 8 MiB，像素尺寸先限额；解析错误使用固定引导文案，接口只返回可导入结构及检查结果，没有保存上传原图或执行节点的新增路径。是否实际出图成功不属于此项证明。

## 远端 CI：归属、检出版本及完整步骤

通过远端 API 核验仓库归属为 `lumingya/comfy-comic-studio`，两 run 均为 completed/success；完整列表共 **6/6 job、68/68 step success**。缓存原始日志与本轮重新获取的远端日志逐行一致；不是仅看 badge 或摘要。

| Run | 实际检出版本 | 平台与运行时 |
| --- | --- | --- |
| [push 45670345960](https://github.com/lumingya/comfy-comic-studio/actions/runs/45670345960) | 三个 job 均检出固定 HEAD | Ubuntu gate：Python 3.13 / Node 20；Windows、Ubuntu launchers：Python 3.11 |
| [PR 45670360530](https://github.com/lumingya/comfy-comic-studio/actions/runs/45670360530) | 三个 job 均检出 `e9f72beb7c7fd99875e7d19728673d2928485b16` | 同上 |

PR 实际 merge 的两个父提交是历史 base `d9cfa801c42f19db29788ea044d31eaf1c50c221` 与固定 HEAD。当前 run/PR API 的 base 字段为 `98aefc051fb8a795f49528e9c70b5620dd90ae6d`；远端 compare 核验它是历史 first-parent 的祖先，相距 12 个提交，不能用该可变字段替代运行时第一父提交。PR merge 的 ci.yml 相对固定 HEAD 仅把 launchers timeout 从 30 调到 60 分钟并加注释，没有删减测试命令。

完整 job/step、run/job 关系、checkout 安全行号及 26 类实际命令 occurrence 均在 `privacy-ci.json` 的 CI 证据中保留。两个 run 各覆盖 AGENTS 的全部 10 行验证要求，包含：

- 后端与 Spike unittest；ruff check/format 的 server、clients、tools 覆盖（CI 分组执行，另含 extensions）。
- Python 客户端 `generate.py --check`；前端 `gen:api` 后对 schema.d.ts / extensionProtocol.ts 执行无差异检查。生成器源码同时确认 Python 快照、正式客户端和 AstrBot 副本都在 `--check` 范围。
- 前端 npm ci、format:check、typecheck、Vitest、build；随包校验与清单重建检查。
- Windows/Ubuntu 从零启动器及后端矩阵；扩展契约、CTK、离线面板脚本、AI 辅助扩展格式/单测/build/dist 一致性与发行包构建 smoke。

| 统计 | 固定 HEAD 的 push | PR merge |
| --- | ---: | ---: |
| 每个完整后端 suite 的用例数 | 1769 | 1880 |
| Windows 条件跳过 | 0 | 0 |
| 每个 Ubuntu 后端 suite 的条件跳过 | 3 | 3 |
| 前端文件 / 用例 | 118 / 964 | 129 / 1067 |
| 启动器每平台用例 | 31 | 31 |
| Spike 用例 | 80 | 80 |

PR 包含 base 侧额外变更，不能把其较大用例数写成固定提交的测试数量。“全绿”指已核验的 job/step 成功，包含上述明确条件跳过。发行包 smoke 实际是成功构建 ZIP 与 unsigned manifest，不证明安装器启动、签名更新安装、GPU 或付费服务可用。

原始日志 SHA-256：push `d017dbf7877b14c04b1b5cc85443be92bbc1d64936bac66103c383b345af8675`（2452 行）；PR `71275a0291221591e16c214bc1d5a4eeb4a833bec4649b2e0716906436442e14`（2695 行）。未把原始日志或私有路径放入公开 JSON。

## 发布与保留边界

本审计公开产物白名单为 `report.md`、`privacy-ci.json`。临时辅助脚本、原始日志、字面值复核材料与其他中间 JSON 均不作为公开交付；不能整目录复制。输出需保留 UTF-8 无 BOM，不含完整真实图、禁用图字典键、私人绝对路径或原始日志。

授权的仓库外 TEMP 原图缓存是本轮允许保留的审计输入，不属于 Git 泄漏。按任务顺序应在五审及证据发布后由 root 按路径所有权统一清理。本审计没有提前删除缓存，也没有签发“系统临时目录已清理完成”。后续收尾还需保持 Git clean、提交推送与最终公共产物白名单卫生；本报告不预先证明这些未来动作已完成。
