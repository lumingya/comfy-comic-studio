# 第二轮独立复审：SDK receipt 与剧本审阅

审查日期：2026-11-21。基线 HEAD 为 `125e07f`，但本报告审查的是当前工作区的实际修复代码和新增测试，不是仅比较 HEAD。复审者未参与第一轮或本次实现；没有派下级代理，没有修改生产代码、测试、生成物或共享台账，也没有提交或推送。

已读取项目 AGENTS / README / ROADMAP、本轮 README / FINDINGS、`fixes/sdk-receipts.md`、`fixes/script-review.md`，并审阅对应工作区实现与新增测试。原作者的 31 / 33 项测试通过记录只用于定位，以下结论另有独立离线攻击证据。

## 当前结论

| 项目 | 结论 | 独立证据 |
| --- | --- | --- |
| R1-SDK-01 | 可关闭 | 从 `125e07f` 原 CLI 实际产生的 v1 receipt，以及新 v2 receipt，155 / 156 / 180 字符键都能保留已有任务恢复并完成；再续跑任务不增长 |
| R1-SDK-02 | 可关闭 | negative / seed / profile / node / slot / bridge 绑定均只 GET 后拒绝；复审捕获的新增默认字段集成问题已修复，正确 pending 绑定完成且续跑无新任务，见下文 R2-SDK-DEFAULT-01 |
| R1-AST-01 | 可关闭 | 旧整组 operation 也只写 `changes`；独立 Bible 编辑保留；真实 HTTP 同字段冲突及晚发生的 episode CAS 都返回 409 且回滚 series / episode / snapshots |
| R1-AST-02 | 可关闭 | 11 个字段 operation 中仅接受 4 项，只写该 4 项；对白搬移 / 替换 / 删除的 8 种子集，新增 / 删除 / 重排的 24 种顺序与部分接受均符合预期；后端锁定无法通过删去 UI `blocked` 绕过 |

## 独立探针与结果

### 1. 真实旧 receipt，而非把新 receipt 的版本号改成 1

通过 `git show 125e07f:clients/python/markdown_album.py` 读取原 CLI，在内存载入该模块；复用现有 SDK / ApiCase 只作真实请求编码与隔离 FastAPI / 假出图执行器的夹具。输入为两格中性 Markdown。

针对 v1、v2，各用 155 / 156 / 180 字符键：

- 原 v1 的 155 字符键先让 HTML 导出真正接单，再在客户端收到结果前抛出 `OSError`；156 / 180 字符键由原代码实际触发导出 API 422。落盘 receipt 都还没有 generation `job_id`，覆盖“任务已提交、资源 ID 尚未写入 receipt”的窗口。
- 新 v2 同样让第一次 HTML 导出真正接单后丢失响应，而不是在请求前直接失败。
- 用当前模块、同一目录、同一键恢复。6 组最终都恰好有 **1 个生成任务 + 2 个导出任务**，此前已接收的任务 ID 全部保留，`status=completed`；同一命令再跑结果相同，任务数不增长。
- 对 180 字符键的尾字符 A / B、Markdown 内容两个变体和 generation / html / pdf 三阶段，12 个派生键全部不同、确定且不超过 160 字符。这是有限输入的分离验证，不宣称数学上证明 SHA256 无碰撞。

实现依据：`clients/python/markdown_album.py:192` 的 `stage_key()`、`:306` 的 receipt 版本检查及 `:311` 的 v2 创建；v1 generation 保留原键，合法旧导出后缀保留，仅替换原本必被 API 拒绝的超长导出键。

### 2. pending 绑定必须比较完整业务意图

独立 pending receipt 分别对第二格加入 `raw_negative`、`seed=0`、`profile_id`、`node_overrides`、`slot_overrides`，以及对白 `bridge=true`。实际创建对应分镜后调用当前 `run_album(..., bind_storyboard=id)`：

```text
pending_rejected_no_post = [negative, seed, profile, node, slots, bridge]
```

逐项断言只有 `GET /api/v2/workshop/storyboards/{id}`，receipt 原字节不变、任务数不变。直接比较真实服务返回值时，原字段默认值和元数据变化可归一；Episode / Panel / Overrides / Dialogue / Strip 各层新增未知字段均保守拒绝。持久化修改 strip 背景后，绑定也只 GET 后拒绝，说明不是仅覆盖生成参数。

探针最初尝试在 StoryboardCreate 输入内填 strip；该请求模型有意不接收 strip，因此输入会被忽略，不能用来证明绑定缺陷。已改为在隔离 store 中修改持久化 strip，再核对真实 GET；没有把夹具错误记为产品问题。

实现依据：`clients/python/markdown_album.py:102`、`:163`、`:169`、`:185`、`:207`。排除元数据的范围是显式白名单；其余字段保留后做完整归一比较。

### 3. 旧 operation、同字段冲突与事务

自行构造内存 SQLite 的成年角色、场景和三格话，生成字段提案后合并为旧式多字段 operation。另一次独立 Bible 编辑修改角色 trigger / tags / outfits，以及场景 tags / description / time，episode revision 不变；按逆序接受旧 operation 后，提案的 name / signature / location name / panel angle 生效，以上独立字段全部保留。

另走实际 `/api/episodes/{id}/assistant/apply` 两条独立失败路径：

1. Bible 同字段已改，反转 operation 顺序后应用，HTTP **409**；series、episode、快照与应用前完全相同。
2. Bible 提案仍有效，但另存话标题使 episode revision 变旧；在 Bible 写入之后才触发的 episode CAS 同样 HTTP **409**，整个事务回滚，Bible 也没有残留修改。

实现依据：`assistant.py:275`、`:283`、`:377` 的字段 delta；`:421` / `:433` 的统一事务与受改字段核对；`:610` 的话 CAS。

### 4. 部分接受、原始坐标、顺序与锁定

- 角色 / 场景 / 分幕共 11 个字段差异，接受逆序列出的 4 项；重新投影后的完整 story 恰好等于“基线只改这 4 个值”，拒绝项没有落盘。
- 对白基线 `Alpha, Bravo, Charlie, Delta`，其中 Bravo 有 speaker / thought / bridge 元数据；提案把 Charlie 搬到开头并改写 Bravo。实际生成 add@0、replace@1、remove@2 三个独立项。8 种接受子集逐一在全新内存库验证，勾选 ID 逆序，均符合插入、替换、删除各自独立的明确结果；未改句及改文本句的 speaker / kind / bridge 保留。
- 提案同时新增 A / B / C、删除 p1 并重排；拒绝新增 B 和删除 p1，分别拒绝 / 接受 reorder，实际顺序为 `p1,p2,newA,p3,newC` / `p1,newA,p3,newC,p2`。operation 列表本身反转仍保持新增顺序。
- 对两格存量 + 两格新增、删除另一个存量格的 24 种排列，全部接受后与提案顺序逐一相同。
- 锁定 p2 后，对字段、对白新增、删除、重排四类提案各自手动删除 `blocked` 再提交，后端均 `Conflict`，且前置 Bible operation、episode、快照都回滚。不是只依赖面板禁用。
- 另运行一次 `node server/tests/professional_review_panels.cjs`：Script DOM 的逐句 checkbox、blocked、显式子集、陈旧 / 竞态版本及失败再生成检查 PASS；QA DOM 同工具附带检查 PASS。

实现依据：`assistant.py:67`、`:86`、`:301`、`:344` 以及 `apply()` 的受改字段 / 锁定 / 顺序检查；`examples/extensions/script-review/panel.js:112` 使用原句坐标显示对白号。

## R2-SDK-DEFAULT-01：并行新增 Strip 默认字段导致普通 pending 绑定失败（P2，已修复并独立关闭）

复审期间其他修复在 `server/mio_server/models.py:483` 增加 `Strip.rasterized: bool = False`。当时 Episode API 因此返回该字段，但 SDK `SUBMISSION_DEFAULTS['strip']` 未同步。

修复前最短离线触发（`a` 是当时工作区的 markdown_album，`mio` 为 TEMP ApiCase 内真实 SDK）：

```python
board = a.parse_markdown("# Neutral\n## One\na green chair\n> Hello.")
actual = mio.create_storyboard(board)
assert a.matches_submission(board, actual) is False
```

修复前归一差异仅为：

```text
expected.strip: {..., manual:false}
actual.strip:   {..., manual:false, rasterized:false}
```

实际 pending `run_album(..., bind_storyboard=actual['id'])` 也抛 `ValueError('the chosen storyboard does not match this Markdown submission')`，只 GET，没有 POST。原本相同内容、安全可恢复的分镜因此不能绑定。此问题来自当前集成的默认契约漂移，不是允许额外业务内容偷渡；保守拒绝方向本身正确。

已即时通知主控、SDK 作者和导出修复作者。SDK 作者在 `clients/python/markdown_album.py:160` 补入 `rasterized=False`，并新增真实 Episode / Panel / Dialogue / PanelOverrides / Strip 默认契约对照，以及持久化 True / 背景差异的 CLI 只 GET 拒绝回归；已审读这些新增测试。

随后只重跑这一新增条件的独立 TEMP 探针：同一真实 API 分镜分别持久化 `rasterized=True` 和不同背景，均只 GET 后拒绝，receipt 原字节和 job 数不变；每次恢复默认后，完整归一内容相等且 `rasterized is False`，正确 pending 绑定完成，原命令续跑不新增任务。

```text
persisted_rasterized_true_and_layout_rejected_before_post = true
explicit_defaults_pending_bind = completed
default_bind_resume_no_new_jobs = true
```

该新增问题已独立复验关闭，原四项当前没有未关闭的确证缺陷。原阶段键和剧本相关已通过探针未重复运行。

2026-11-21 职责拆分收尾：已只读核对新的 `assistant_story.py` 单向依赖及两种全新进程导入顺序，11 个旧入口与新模块对象恒等，实际 API 的模块与原 `AssistantError` 对象保持不变；`assistant.py:211–389` 仍以同一 `store.tx()` 包住全部 store 读写，`:388` 保留 `expected_revision=base_revision`，未发现循环依赖或事务边界变化，R1-AST-01 / R1-AST-02 正式关闭（上文助手行号记录拆分前位置，本次未重复 33 项回归）。

## 执行范围与外部条件

独立 Python 探针只写 `%TEMP%/mio_r2_*` 脚本和 ApiCase 临时工作区 / 内存 SQLite。前两段探针中有两处测试夹具假设修正（StoryboardCreate 不接收 strip；SequenceMatcher 在相邻改写时的配对方式），修正后只重跑受影响段，未以夹具失败判产品失败，也未重复整套已通过测试。

本报告没有重跑原作者 31 / 33 项套件或全仓门禁。未访问个人 data，未运行真实 ComfyUI、云端 / 付费模型、浏览器或 E2E，未测试磁盘真实断电 / 多进程并发目录写入。跨字段语义依赖、真实模型生成质量与长会话浏览器效果仍在原声明边界之外。最终全仓门禁、生成一致性、提交推送和远端 CI 由主控统一执行。
