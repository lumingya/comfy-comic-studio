# R3-ACCESS-02：共享 API 测试输入隔离

状态：已修复并完成下列定向验证；待新的独立审查者复核。未修改生产代码、共享台账或生成物，未提交或推送。

## 原风险

`ApiCase.setUp()` 虽然给 `AppContext.create()` 传入独立 TEMP 工作区，但未设置
`ctx.legacy_root`。普通工坊请求经 `ensure_workshop(None)` 回退到
`importer.LEGACY_ROOT`，从仓库 `data/` 导入分镜和预设。该目录的随包文件可能被本机使用改写，
因此临时数据库并不足以保证测试输入隔离，也使测试结果依赖本机状态。

此修复针对默认读取边界；原审查未证明该链路写回原数据或向外发送内容。

## 修复与保护

- `server/tests/api_harness.py` 在创建应用和 TestClient 前，把每个测试的
  `ctx.legacy_root` 设为其自身 `TEMP/empty-legacy`。该目录默认不存在，工坊使用空白分镜和默认预设，
  不触发生产 fallback；所有 AppContext 仍由显式 TEMP 路径创建。
- `server/tests/test_workshop.py` 仅在原有四个公开样例断言用例中调用 `shipped_workshop()`：
  seeded、assemble snapshots、clone task、preview。该辅助方法显式使用 `copy_shipped_data()`，
  只提取随包清单内的 `storyboards` 与 `presets/characters` 到该测试自己的 `TEMP/legacy-fixture`。
  不复制整个 `data/`，不扩展到用户目录，也不依赖本机额外素材。
- 空 legacy 工坊用例直接验证共享夹具的默认隔离路径，移除原有仓库内的不存在目录常量。
- 新增 `server/tests/test_review_test_isolation.py` 两个回归，分别实际请求本机工坊和
  v2 scoped storyboard API。每次先将 `importer.LEGACY_ROOT` 改指独立 TEMP 哨兵目录，
  再截获 `importer._load_dir`。请求必须成功且读取器未被调用，同时断言夹具根属于该测试自身 TEMP。
  即使默认隔离将来回归，测试也只会命中受控哨兵和 mock，不会访问仓库真实 legacy 内容。

没有修改 `test_api_v2` 的 scope 用例；它只需要空工坊，不应加载样例。

## 已执行验证

开发前执行 `python tools/protect_local_data.py`，输出 `Protected 64 shipped data files.`。
随后完成全部代码编辑，再集中执行：

```text
# 工作目录：server/
python -m unittest tests.test_review_test_isolation tests.test_workshop tests.test_workshop_v2 tests.test_api_v2.ScopeTests tests.test_api_v2.ApiV2Tests -q
Ran 16 tests in 22.952s
OK

# 工作目录：仓库根
ruff check server/tests/api_harness.py server/tests/test_workshop.py server/tests/test_review_test_isolation.py
All checks passed!
ruff format --check server/tests/api_harness.py server/tests/test_workshop.py server/tests/test_review_test_isolation.py
3 files already formatted
python -m py_compile server/tests/api_harness.py server/tests/test_workshop.py server/tests/test_review_test_isolation.py
通过（退出码 0）
```

三份 Python 文件和本记录另通过 UTF8 Text Guard 检查；定向 `git diff --check` 通过。
没有调用默认 app 入口，没有运行真实 ComfyUI、付费云端、浏览器或 E2E。

## 验证边界

本轮覆盖共享夹具的两个实际读取入口、四项公开样例依赖以及既有相关工坊/权限测试，
不声称已复核所有测试类的自建 AppContext，也未运行全量项目门禁。
独立审查应确认默认根在应用创建前赋值、公开样例只在显式测试中载入，以及哨兵回归可阻止默认读取。
