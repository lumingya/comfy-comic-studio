# R5-UPDATER-CLOSE-01：更新检查越过工作区关闭（P2）

## 范围与结论

修复基线为隔离工作树 `f87a613`。只修改 `server/mio_server/context.py`、
`server/mio_server/update/updater.py`，新增独立回归
`server/tests/test_review_context_shutdown.py`。未修改通用 drain、任务 runtime、生产队列、
原 longform 测试、共享审查索引或路线图；未提交或推送。

CI `44883371650` 的 Ubuntu / Python 3.11 主后端门禁在 1577 项中仅有一个清理错误：
`LongformApiTests.test_v2_read_previews_write_commands_and_revision_contract` 的
`TemporaryDirectory.cleanup → shutil.rmtree → os.rmdir` 报
`OSError: [Errno 39] Directory not empty: '/tmp/tmpqgeney6a'`。
源日志为本机临时目录中的 `mio-review-ci-ubuntu-f87a.txt`，第 488–504 行。

本次受控复现证实，越过 `ctx.close()` 的具体写入者是 `mio-update`，不是该测试的变量预览、
任务调度器或队列线程。不能仅从此证据推断其他后台资源均有问题或均已无问题。

## 因果路径与红环

1. 原失败测试实际继承 `LongformFixture`。它和 `ApiCase` 一样按 LIFO 注册清理：
   `ctx.close()` 确实先于临时目录清理，因此更换清理顺序不能解决问题。
2. `AppContext.create(autostart=False)` 原来只阻止 engine 和 queue 自启动。
   测试的 `with TestClient(create_app(ctx))` 仍执行 API lifespan，调用
   `updater.startup_check(ctx.settings().update_feed)`。
3. 更新器默认 `auto_check=True`，默认空 `update_feed` 表示查询 GitHub releases 目录。
   目录查询和 `check()` 不要求签名公钥；无公钥只限制安装与清单验签。因此旧用例确实可能
   隐式访问外网，不能因为 `autostart=False`、无公钥或“preview”命名就声称它零网络。
4. `Updater.check()` 收到响应后调用 `_save_state()`，它会创建 `updates/` 并原子保存
   `state.json`。旧 `AppContext.closers` 未登记 updater，Updater 也没有 close。

生产修改前先执行了一个独立回归：直接实例化并执行原失败 longform 方法，用阻塞的
`httpx.MockTransport` 卡住自动更新响应，再并发调用 `ctx.close()`。命令为：

```powershell
$env:PYTHONPATH = 'server'
python -m unittest tests.test_review_context_shutdown -v
```

初版单项回归在 **1.086 秒**失败：

```text
AssertionError: True is not false :
AppContext.close returned while its update worker could still write state
Ran 1 test ... FAILED (failures=1)
```

随后在构建上下文之前 patch `Updater._http` 为同一个阻塞 MockTransport，重新执行原方法。
该诊断脚本只把真实 `os.rmdir(root)` 的调用时机拦住：让 `shutil.rmtree` 先遍历并删除
全部孩子，在最终删除根目录前释放 HTTP 响应、等待原更新线程结束，再调用真实 rmdir。
没有替换 `_save_state`，也没有伪造删除异常。实测输出：

```text
close returned; updater alive: True
post-close root children: ['updates']
post-close state write: True
OSError errno= 41 winerror= 145
real rmdir failed because root was repopulated
```

本机为 Windows / Python 3.13，目录非空对应 `errno=41 / winerror=145`；CI 的 Linux
对应 `errno=39`。二者都是该路径上真实最终 rmdir 观察到目录被重新填充，不能把 Windows
输出冒称为本机复现了 Linux errno 数值。一次性诊断脚本已清除，未加入产品或测试启动器。

首轮补修后的全新独立复验又证实一个同源关闭竞态：线程 A 从 `closers` 中取出 updater
并阻塞等待，线程 B 同时调用 `ctx.close()` 时会继续取走剩余 closer，提前关数据库并释放
工作区租约。新增受控回归把 A 精确卡在 updater worker 的 join，再发起 B；补修屏障前
该项在 **0.161 秒**失败，断言为：

```text
AssertionError: True is not false :
a concurrent close bypassed the updater's workspace shutdown barrier
```

## 修复与关闭契约

- `Updater` 新增默认开启的 `startup_enabled` 构造参数，`AppContext` 将 `autostart`
  传入。`autostart=False` 现在也关闭隐式更新检查；显式 `check()` / `start_check()`
  仍可用。正常默认上下文仍在 HTTP 生命周期启动时检查更新。
- `AppContext` 在构建回滚栈和正常 closers 中登记 `updater.close`。正常关闭时它先于
  其他服务、数据库和工作区租约运行；不再允许更新线程在租约释放后补写状态。
- `AppContext.close()` 的整个 closer 序列由同一个重入锁保护。其他线程的 close 必须等到
  同一次关闭完成；本线程回调中的重入安全返回，不会提前执行后续数据库／租约清理。
- `Updater.close()` 先封口后台启动与新的显式变更命令，再等待已接纳的后台线程和同步
  更新操作退出。join 不持有 `_lock`，否则正在完成的 `check()` 无法保存状态。
- 已接纳的安装操作可完成其嵌套 download / stage；关闭后发起的 `check()`、
  `start_check()`、偏好写入等命令被拒绝，不能重新创建已删的更新目录。
- 不通过忽略清理错误、重试删除、延时睡眠或提前释放租约掩盖仍可写线程。

## 绿环与验证

新增 7 项回归均在构建任何 AppContext / Updater 之前替换 HTTP 工厂，所有响应均由
MockTransport 提供，所有数据仅位于临时目录：

1. 直接执行原 longform 方法，断言 `autostart=False` 没有隐式请求；随后显式检查仍成功。
2. 默认启动上下文仍经 TestClient 生命周期启动检查，关闭会等待它完成。
3. 阻塞显式后台检查，断言 close 未返回且真实工作区租约仍被持有；释放响应后完成状态
   写入、线程退出和租约释放。关闭后的显式命令不再访问 HTTP 或重新建目录。
4. 同样验证同步 `check()` 不会绕过关闭等待。
5. 通过假目录、签名清单和 ZIP 完整走已接纳安装的后续 download / stage，关闭不会把
   嵌套步骤误判为新命令而中断，pending 成功落盘后才释放租约。
6. 两个并发上下文 close 共用完整关闭屏障；更新响应被卡住时，第二次 close 仍等待、
   数据库仍可读、真实工作区租约仍持有。
7. 同线程 closer 回调重入 `ctx.close()` 后，数据库与租约仍可用直到外层关闭继续执行。

集中执行：

```powershell
$env:PYTHONPATH = 'server'
python -m unittest tests.test_review_context_shutdown tests.test_longform_api tests.test_update tests.test_update_catalog tests.test_review_update_recovery -q
ruff check server/mio_server/context.py server/mio_server/update/updater.py server/tests/test_review_context_shutdown.py
ruff format --check server/mio_server/context.py server/mio_server/update/updater.py server/tests/test_review_context_shutdown.py
python -m py_compile server/mio_server/context.py server/mio_server/update/updater.py server/tests/test_review_context_shutdown.py
git diff --check
```

首轮结果为 **46 tests / 35.323s / OK**；并发屏障补修后重跑受影响的同一组验证，结果为
**48 tests / 23.701s / OK**。Ruff 检查、三文件格式检查、编译及 diff 空白检查通过。

全新独立复验代理又以自己的探针复验：并发第二个 close 已进入锁请求后仍等待，期间
store 可读、租约保持、state 尚未写入；放行响应后两次 close 与 worker 均退出，state
落盘、租约可重新取得，真实 `rmtree(workspace)` 成功。同线程重入及构建失败的 ExitStack
回滚也通过独立受控探针；作者 7 项回归由该代理另跑，**7 tests / 3.545s / OK**。
本报告不宣称本轮已重新运行整套 CI。

## 边界

- 本轮测试不导入默认 app、不访问真实工作区、不启动真实外部服务或付费 API。
  此边界专指本轮新回归与受控诊断；旧测试原来的隐式联网行为已在上文单独记录。
- HTTP 请求沿用现有配置：版本目录请求 20 秒、显式 feed 检查 30 秒 HTTPX I/O 超时，
  下载沿用其现有超时。I/O 超时不是整个更新操作的硬性总耗时截止；close 保证等待已接纳
  操作完成后才放开工作区，不承诺在固定总时长内返回。持续缓慢但不断有数据的源仍可能
  延长关闭；本轮未扩展为可取消 transport 或新的总截止实现。
- `status()` / `pending()` 等读取结果的能力仍可在关闭后使用；不把读取已完成结果误作
  可重新写工作区的操作。AppContext 的并发关闭屏障属于独立反例证实所需的必要补修，
  未扩展到任务调度器或生产队列的生命周期重构。
