# CI 收尾：任务连接的并发读取

基线：`c84ce33`。范围只包括共享 jobs SQLite 连接在结果交付与依赖查询路径上的序列化；本文件供新的独立复审者复现，不修改其他审查结论。

## 已观察的失败

- GitHub Actions `44860473482` 的 Python 3.13 gate 在 `tests.test_api.CrudTests.test_listings_carry_progress_and_covers` 失败。真实任务有 12 格、实例容量 2；一项在已发送后成为 `uncertain`，错误为 `executor_crash / InterfaceError: bad parameter or other API misuse`，整任务因此 `blocked`。
- 本机 Windows、Python 3.13.6、SQLite 3.50.4（`sqlite3.threadsafety == 3`）重复运行未经修改的原测试，failfast 在第 20 次复现同一错误，耗时 44.122 秒。失败项为 index 3，`upstream == 0:p4`。全程使用原 `ApiCase` 的临时工作区和假 Comfy/LLM；未连接实际服务。
- 同一旧代码的另一次 30 次重复全部通过（67.663 秒），说明自然复现有竞态，不将一次通过视为解决。

自然复现命令（在 `server/`）：

```powershell
python -X utf8 -c "import unittest; from tests.test_api import CrudTests; suite=unittest.TestSuite(CrudTests('test_listings_carry_progress_and_covers') for _ in range(80)); r=unittest.TextTestRunner(verbosity=1,failfast=True).run(suite); raise SystemExit(not r.wasSuccessful())"
```

本机原始失败日志位于 `%TEMP%/mio-sqlite-listings-stress.txt`，只包含测试临时夹具；不入库。CI 默认将 `mio.jobs` logger 设为 CRITICAL，故已保存的 CI 断言包含异常类型与信息，没有 SQLite 抛出点的完整 Python traceback；不伪称已有该栈。

## 可证伪假设与确定性红环

依次检验的候选为：

1. 每任务 guard 内、连接锁外的 `_pending_delivery()` 能与 `tick()/get()` 或另一个任务共用连接，预测：真实完工路径存在未持 `engine.lock` 的 execute/fetch。
2. `job_references()` 的游标跨 `yield` 交给消费者，预测：直接依赖检查和暂停迭代会在连接锁外访问，或持锁阻塞别的查询。
3. 工作文档 `SQLiteStore` 的连接绕过自己的锁；窄静态检查没有找到 render/result 路径中这样的访问，优先级降低，没有改动该 store。

新增 `server/tests/test_review_sqlite_concurrency.py`：在真实 SQLite 连接外加透明护栏，只断言 execute、fetch 和事务入口/出口均在引擎的既有 RLock 内，不替换 SQL 结果、不重试、不吞错。旧代码运行 4 项测试确定得到 **2 failures、2 errors**；直接指向 `_pending_delivery()` 与 `job_references()` 的无锁 execute，真实并行完工无法完成。该护栏让测试秒级可判定，不依赖撞中稀有 SQLite 竞态。

## 最小修复

- `jobs/delivery.py`：`_pending_delivery()` 自行取得 `engine.lock`，在同一锁内 execute + fetchone。它可被仅持 job guard 的正常完工、回放和异常分类路径调用，不能依赖上层偶然持锁。
- `jobs/dependencies.py`：在 `engine.lock` 内把 snapshot 与所有输入行完整取回，随后释放锁再解析并 yield。消费者暂停不保留活动 SQLite 游标或引擎锁。
- 没有扩大到完整执行器调用或 `on_complete` 回调持锁，没有新增重试、重发、吞错、mock 修补或跳过。原有每任务交付与幂等语义保持。

## 已运行的验证

```powershell
python -X utf8 -m unittest tests.test_review_sqlite_concurrency tests.test_result_delivery tests.test_api -q
```

31 项通过，24.113 秒。新 4 项覆盖：连接锁保护的 pending 读、24 项并行完工与主线程读/调度、依赖生成器暂停后其他线程仍可读、完工回调里另线程可读。断言全部项目只执行一次、attempt 为 1、交付状态为 applied。之后为护栏补充事务入口/出口检查并确保反例不会因测试清理而死锁，新 4 项再次通过（0.158 秒）。

修复后，在同一 Python 3.13.6 环境对原 `test_listings_carry_progress_and_covers` 运行 **40 次全部通过**，90.412 秒；每次包含 12 个真实任务项的离线渲染、交付与采用，总计 480 项，没有调整原测试、mock 或重试。对应本机日志为 `%TEMP%/mio-sqlite-listings-fixed.txt`。有限重复通过不能证明所有线程交错均无缺陷，连接护栏负责锁边界的确定性回归。

`ruff check`、`ruff format --check`、`git diff --check` 对三个相关文件通过。最终跨平台整套 CI 由主控跟进，此处不提前宣称通过。

## 边界

- 本机仅 Windows / Python 3.13.6；护栏使用 CPython 的 RLock 所有权检查，仅属于测试，不进入生产代码。
- 自然复现建立了相同外部症状，确定性护栏证明两处真实连接序列化漏洞；没有原始 CI 异常栈，因此不把某一条 SQL 称作已由 CI 栈唯一锁定的抛出点。
- 未触碰真实运行数据、外部服务、付费 API、前端并行改动、共享台账或提交；所有权为上述两个生产模块、本测试与本报告。
