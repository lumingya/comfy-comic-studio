# R1-AST-01 / R1-AST-02 修复记录

范围：`server/mio_server/pipeline/assistant.py` 及视图职责模块 `assistant_story.py`、独立剧本审阅面板与说明、新增 `server/tests/test_review_assistant.py`、专业审阅面板 DOM 测试的 script 部分。保留原 API 请求模型、作用域、数据库结构、`store.tx()` 与话修订号 CAS；未新增公开 token 或重新生成客户端。

## 修复前的红回归

先加入两个调用真实 `diff()` / `apply()`、使用内存 SQLite 的回归，再修改实现。夹具缺少 age 的初次准备错误修正后，产品断言真实失败：

```text
test_name_only_proposal_preserves_independent_bible_tags ... FAIL
AssertionError: Lists differ: ['initial'] != ['author']
test_two_sentence_changes_can_be_accepted_independently ... FAIL
AssertionError: 1 != 2
Ran 2 tests ... FAILED (failures=2)
```

第一项：提案只改名字；另一次设定集编辑把标签改为 `author`，话修订号不变；接受提案后标签实际回到 `initial`。第二项：同幕两句分别改写，实际只生成一个选择项。

## 实现

- 角色、场景和分幕的字段分别生成 operation；对白以原始句下标、动作和插入顺序生成独立 operation。相同输入产生相同 ID/内容，勾选顺序不影响合并结果。
- 应用在原事务内读取当前归一化视图，逐受改字段检查 `changes[field][0]`。同字段变化报 `Conflict`（HTTP 409）；未受改字段不会从完整 `after` 回写。旧版多字段/整组对白 operation 同样按 `changes` 应用，不存在只修新提案、旧请求仍覆盖的旁路。
- 句子操作按原始坐标一次合并，删除不会让后续接受项错位；保留未改句、以及替换句未改的 speaker/kind 和模型中的 bridge 等属性。连续新增句、连续新增幕按提案顺序落位，拒绝某个新增幕时使用存活锚点。接受重排、拒绝删除时，未被重排覆盖的幕保留原槽位。
- 保留整份 `after` 的既有合法性检查，但只写受选 delta。未知操作、未知字段、错误前后值结构、重复/重叠字段、无差异伪操作、非法句子操作及未知接受 ID 均拒绝；错误不能留下设定集、话或快照的部分提交。
- 锁定建议继续不可选；后端也核对实际锁定状态，防止移除 `blocked` 后写锁定幕。分幕相对顺序变化仍检查锁定幕。
- 面板每个新句 operation 都有独立 checkbox，并按其原始句下标显示句号；同幕第二句不再错误显示为第一句。README 同步说明实际接受粒度、原值冲突与句子搬移的插入/删除语义。

## 修复后验证

以下集中验证通过，共 33 项 Python 测试，另有 JSDOM、格式、编码检查：

```text
python -m unittest discover -s server/tests -t server -p test_review_assistant.py -q
  Ran 16 tests ... OK
python -m unittest discover -s server/tests -t server -p test_assistant_trash_import.py -q
  Ran 9 tests ... OK
python -m unittest discover -s server/tests -t server -p test_professional_review.py -q
  Ran 6 tests ... OK
# 以下从 server/ 执行
python -m unittest tests.test_api_system.BundleLegacyAssistantTests.test_assistant_propose_then_apply tests.test_api_v2.ScopeTests.test_scope_table -q
  Ran 2 tests ... OK
node server/tests/professional_review_panels.cjs
  QA DOM ... PASS
  Script DOM ... PASS
ruff check server/mio_server/pipeline/assistant.py server/tests/test_review_assistant.py
ruff format --check server/mio_server/pipeline/assistant.py server/tests/test_review_assistant.py
node web/node_modules/prettier/bin/prettier.cjs --check examples/extensions/script-review/panel.js examples/extensions/script-review/README.md server/tests/professional_review_panels.cjs
  All checks passed / All matched files use Prettier code style
```

新增回归覆盖：角色与场景未展示字段保留、旧多字段输入、设定集同字段冲突及快照不变、字段/句混选、句插入/删除/替换及部分接受、保留 speaker/kind/bridge、旧整组对白输入、连续新增幕、拒绝前一新增幕、重排与拒绝删除组合、锁定与畸形操作。API 用例确认实际 propose/apply 句级子集保存和 Bible 冲突 409；DOM 用例确认同幕两句 checkbox 互不联动及提交的接受 ID 子集。

已对所改源码、面板、测试与说明运行 UTF8 text guard，`git diff --check` 通过。

## 窄职责拆分复核

独立语义复审后，主控要求把本次增长到 617 行的助手按天然职责收拢。新建前确认 `assistant_story.py` 不存在；仅将视图字段常量、归一化投影、Diff/句差异生成及相邻的视图转模型函数机械迁入该模块。`assistant.py` 保留原 `AssistantError` 类定义、LLM/提案流程和 delta 应用事务，并通过直接导入保留原函数入口。没有调整 API、UI、差异格式或接受语义，也没有新增包装层、数据库迁移或生成物。

拆分后 `assistant.py` 为 395 行，`assistant_story.py` 为 242 行。按拆分前真实工作区源码保存 AST 快照，在搬迁和 ruff 整理后逐一比较两个模块中全部 22 个原定义（函数/异常类/常量），函数完整 AST 与常量值全部相同、无缺失或重复；11 个迁出名称从原入口导入时与新模块对象恒等，`AssistantError.__module__` 仍为 `mio_server.pipeline.assistant`。

拆分后重新执行上述 33 项 Python 窄回归，全部通过。两个模块的 ruff check / format、UTF8 text guard 与 `git diff --check` 通过。此前已通过且此次未修改的 DOM/UI 文件不重复跑浏览器或生成流程。

## 边界

仅使用内存数据库或 ApiCase 的 TEMP AppContext、合成成年中性故事和 FakeLLM/FakeVLM。没有访问个人运行数据、真实模型、ComfyUI 或付费服务，没有安装浏览器或运行 E2E。

句子没有新增持久化 ID；同一提案通过话 CAS 固定坐标基线。对白搬移显示为插入/删除建议，可分别接受；跨字段语义依赖（例如新增角色与引用该角色的分幕）仍由作者选择。完整仓库门禁和全新代理复审由主控统一执行，本记录不冒充其结论。
