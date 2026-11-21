# R5-UPDATER-CLOSE-01：关闭竞态独立复验

## 结论与范围

建议关闭该项。初版补修仍存在并发 `AppContext.close()` 提前释放 store / workspace lease
的真实反例；反馈作者补修整段关闭屏障后，同一反例转绿。本轮最终未发现仍需补修的问题。

审查基线为 `f87a613`，对象是隔离工作树中的 `server/mio_server/context.py`、
`server/mio_server/update/updater.py` 及新回归 `server/tests/test_review_context_shutdown.py`。
先独立阅读生产 diff、构造反例，再阅读作者 `fixes/close-race.md`。作者报告首次读取时尚未
落盘，后续已经对照。本人仅新增本报告，未改源码、测试、共享台账或主工作区，未提交推送。

环境为本机 Windows / Python **3.13.6**；不是 Ubuntu / Python 3.11 CI 的替代执行。

## 独立发现的红环及补修复验

初版仅将 updater 放入正常 closers 和初始化回滚栈，`AppContext.close()` 仍直接从共享
`closers` 列表 pop。两个关闭调用可以分走清理函数，越过 updater 的等待屏障。

受控交错如下，HTTP 工厂在创建任何 context 之前已替换为阻塞 `MockTransport`：

1. 创建 `autostart=False` 的临时 context，显式启动 `start_check()`，等 HTTP handler
   发出 entered 事件。
2. 用只发出事件后转调原方法的 wrapper 观察 `worker.join`；线程 A 执行 `ctx.close()`，
   等待 A 已进入 join。这时 updater closer 已被 pop，HTTP 仍未放行。
3. 线程 B 再执行同一个 `ctx.close()`。
4. 观察真实 workspace `FileLease`、SQLite store、worker 与状态文件；最后才放行 HTTP。

初版实际结果：

```text
first_close_waiting = true
second_close_returned = true
worker_alive = true
lease_reacquired_before_worker_finished = true
store_error = ProgrammingError: Cannot operate on a closed database.
state_exists_before_release = false
state_created_after_second_close_returned = true
threads_finished = true
```

这不是模拟 state 写入或模拟 lease：第二次 close 已返回，真实 store 已关闭，真实 lease
可重获，随后原 `Updater.check()` 才创建 `updates/state.json`。发现后立即反馈主控和作者。

作者随后以私有 `RLock` 覆盖整个 closers drain，并用 `_closing` 让同线程重入直接返回。
其他线程进入同一锁时必须等最外层 close 完成。本次原探针追加观察第二个调用者确实已
请求进入 close 锁，然后重放，结果全部符合预期：

```text
first_close_waiting = true
second_close_waiting = true
worker_alive = true
workspace_lease_retained = true
store_readable = true
state_not_yet_written = true
threads_finished = true
state_flushed = true
workspace_lease_released = true
errors = []
real_workspace_cleanup_succeeded = true
```

最后一项执行真实 `shutil.rmtree(ctx.data_dir)`，未重试或忽略删除错误。HTTP 放行前没有
提前释放 store / lease；放行后 worker 与两个关闭线程均结束，state 已保存，lease 可
重新取得，整个临时工作区可实际删除。

## 其余独立探针

以下探针均用 stdin 执行，未新增探针脚本；所有数据均放在 `TemporaryDirectory`。

| 探针 | 确定性交错与断言 | 结果 |
|---|---|---|
| 初始化失败回滚 | 在 context 的 Updater 构造工厂中显式启动阻塞检查；下一步 Dispatcher 构造注入 `ValueError`。观察 ExitStack 进入真实 updater join 后，构造线程仍等待、workspace lease 仍持有、state 未写。放行 HTTP 后 state 保存、worker 结束、原 `ValueError` 保留，lease 可重获 | 通过 |
| Updater 自身并发关闭 | 阻塞真实 `check()` 的 MockTransport 响应，两个线程同时进入 `Updater.close()`；两者均等待原 worker。此时依次调用 `start_check`、`check`、`preferences`、`download`、`stage`、`download_and_stage`、`cancel_pending`、`apply_pending`，8 项均以 `UpdateError` 拒绝。放行后两个 closer 均结束、worker 为 idle、state 存在；再次 close 正常返回 | 通过 |
| AppContext 同线程重入 | 末尾追加真实 closer callback，callback 内再次调用 `ctx.close()`，返回后读取 store 并尝试取得 workspace lease。重入没有继续清空后续 closers，store 仍可读、lease 仍持有；最外层 close 完成，无死锁，再次 close 正常返回 | 通过 |

上述初始化失败及 Updater 自身并发探针在最后的 context 屏障补修前通过；该补修仅增加
正常 `AppContext.close()` 的串行屏障，不改变它们所执行的 ExitStack / Updater 路径。
最终版本再次执行并发 context 与同线程重入两个原探针，均通过。

## 定向回归与因果核对

最终执行：

```powershell
python -m unittest discover -s server/tests -t server -p test_review_context_shutdown.py -v
```

结果为 **7 tests / 3.545s / OK**，无 skip。此前屏障补修前的原 5 项也曾独立执行通过；
这同时证明仅原 5 项不足以覆盖本次抓到的第二个关闭调用者。

最终 7 项分别覆盖原 LongformApiTests 方法的 `autostart=False` 零隐式请求及显式检查、
默认 HTTP lifespan 的启动检查、后台与同步 check 的关闭等待、关闭后变更命令拒绝、
真实签名清单 / ZIP 的既有安装嵌套 download + stage、并发 context close 与同线程重入。

代码核对显示：

- `startup_enabled=autostart` 抑制隐式启动，未禁用显式检查；不能把旧 `autostart=False`
  或未配置签名公钥当成旧行为零网络的依据。
- `Updater.close()` 在状态锁内封口并取 worker 引用，离开状态锁后 join，再等待同步操作
  共用的 execution lane。检查完成仍能取得状态锁保存结果，未出现持状态锁 join 的死锁。
- 已在执行 lane 内接纳的安装步骤通过线程局部 active 标志继续嵌套；后续新变更调用被
  拒绝。正常 context 关闭和初始化回滚均先等待 updater，再释放数据库及工作区 lease。
- 新的 context 关闭屏障覆盖完整清理序列，而非只保护一次 pop；同线程重入与异线程等待
  采用不同处理，原并发反例因此无法绕过。

## 边界

- 不导入默认 app、不访问用户运行数据、不访问外网或付费服务。所有 Updater HTTP 替换
  均在对应 context 构造前安装；直接构造的 Updater 从构造时即传入 MockTransport。
- 本轮结论是这些受控关闭交错下的写入 / lease 顺序和命令边界通过，不是对所有后台服务
  或任意扩展回调的全局线程安全承诺。
- `status()` / `pending()` 等结果读取仍可用；`releases()` 的只读目录请求没有纳入
  execution lane，也不产生本次 late state.json 写入，不将其误报为关闭后写工作区。
- HTTPX 版本目录 20 秒、feed 30 秒等现有配置是 I/O timeout，**不是整个操作的硬性总
  deadline**；close 可能等待已接纳请求较久。本轮没有引入总截止或可取消 transport。
- 未在本轮重跑完整跨平台 CI，不能由本机 Windows 受控绿环宣称 Ubuntu / Python 3.11
  或最终 CI 已绿；最终 CI 状态由主控另外确认。
