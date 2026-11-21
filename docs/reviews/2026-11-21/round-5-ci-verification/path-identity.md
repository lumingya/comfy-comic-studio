# R5-WIN-PATH-01：第二次补修的全新窄复审

结论：在以下独立边界中未发现新问题，支持关闭 R5-WIN-PATH-01。最终精确提交的跨平台整合 CI 由主控另行确认；本报告不代称 CI 已经通过。

## 范围与先行攻击路径

本代理不是修复者，也不是首先发现 extended-length 前缀绕过的审查者。先阅读相对 `43cc414` 的稳定宿主及更新恢复测试差异，再读共享台账与修复者的 R5 附录，没有重跑既有 60 项整批回归。

先行假设为：

1. 身份归一化遗漏了普通 / extended drive、UNC / extended UNC 或大小写 / 8.3 的组合，仍可把同一目录当作不同目录。
2. 归一化错误地混淆不同安装根、卷、共享或子目录，使租约过度串行，或让归属检查接受错误根。
3. 去掉前缀后的比较值误用于文件操作，破坏真实长路径；或者租约的进程内 key 统一了，实际 OS 文件锁仍可被另一前缀绕过。

静态检查确认 `_path_identity()` 的结果只进入祖先 / 等值比较、journal 根归属及租约 key；没有代替实际 `Path` 执行读写、rename 或清理。原始 workspace 的链接 / reparse point 检查仍在 `resolve()` 之前，`_plain()` 保留原有链接检查与词法归属第一层保护。

## 独立离线反证

自建 TEMP harness，通过真实宿主函数和既有签名包夹具完成 **4 项测试，0.542 秒，全部通过**。没有修改生产代码、持久测试、共享台账或其他代理文件。

| 反证 | 实际执行与结果 |
| --- | --- |
| 纯路径命名空间 | 普通 / extended drive、普通 / extended UNC、大小写及尾分隔符三组同路径相等；不同卷、子目录、服务器、共享、本地与 UNC 等六组保持不同；`pipe`、`GLOBALROOT`、volume-device 三种命名空间拒绝。UNC 全部用已解析 `PureWindowsPath` 护栏，未访问网络。 |
| 真实别名与 I/O | 本机真实目录的普通、extended、实际 8.3、extended + 8.3、`..`、大小写共六种写法映射成同一身份，另一子目录保持不同。实际 8.3 别名与长名不同，未以退化的相同路径冒充测试。`_workspace()` 和 `workspace_updates()` 返回值仍带 extended 前缀，经该路径写文件后普通路径能读回相同内容。 |
| 真实跨进程租约 | 父进程持有普通根租约，同线程 extended 重入共享同一 owners 项；独立 `python -S` 子进程以 extended 根获取租约，实际 OS 文件锁拒绝。另一个安装根在其他线程同时成功获取租约，没有被错误合并。退出后 owners 恢复原值。 |
| 混合别名的签名安装 | 两个独立 TEMP 签名夹具组合真实 8.3、大小写、extended 根 / workspace：普通根配 extended 短名数据目录；extended 根配普通短名数据目录。两组实际 `Updater.apply_pending()` 均拒绝位于 `web/` 内的工作区；私有 marker、pending 逐字内容、完整旧版及稳定宿主保持不变。 |

调用方式：

```powershell
python -X utf8 "$env:TEMP\mio-r5-identity-independent.py" "<repository-root>"
```

TEMP harness 初次执行因自身一处 raw string 尾反斜杠产生语法错误，未进入任何探针；修正该脚本后执行上述四项。没有把该错误记为生产缺陷。完成后只删除本代理创建的该脚本；所有测试目录由各自 TEMP 夹具清理。

## 结论与边界

- Standards：身份与实际文件 I/O 分离；沿用既有进程内锁和 OS 文件租约，没有新增路径专用安装流程或静默重试。
- Spec：原 extended-prefix 数据覆盖路径及其与真实短名、大小写的混合形式得到阻止；同一安装身份不能通过前缀变体并发，不同安装根仍可独立操作。
- 环境为 Windows / Python 3.13.6、本机普通大小写不敏感文件系统。未测试远端 UNC、DFS / 网络别名或启用了每目录大小写敏感标记的卷；纯路径等价护栏不等于网络共享的真实 I/O 验收。
- 未重复所有中断恢复、长路径及 junction 矩阵；相关实际验证以原独立[Windows 路径复审](windows-paths.md)和[修复记录](../fixes/update-recovery.md)为准。本报告只对上述窄边界给出独立结论，不宣称全仓或全部 Windows 路径形态零缺陷。
