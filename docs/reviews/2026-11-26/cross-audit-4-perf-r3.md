# CrossAudit-4-Perf-Power · 第三轮独立审计记录

签发：**NOT VERIFIED（未执行 R3 运行时性能采样，不签发 PASS）。** 本轮候选已有视觉席实测确认的未决 Medium `VIS-R3-M01`。总控在授予性能排他窗口前明确取消本轮性能采样，要求保留失败轮历史，在修复、完整门禁与全新独立 R4 中继续最终性能验收。本报告不缩减最终验收范围，也不把没有采样记作零缺陷通过。

本席未参与产品实现，唯一仓库写范围为本报告。已阅读 AGENTS、README、ROADMAP、原任务 `D:\Tencent Files\tx download\ai_studio_code (4).txt` 的完整 Wave 5、R2 性能报告与原始 compact JSON。六项专业能力遵循用户授权的独立、默认停用沙箱面板范围。使用 UTF8 Text Guard 规范写入并读回本报告；未修改产品、测试、生成物、发行数据或其他席报告，未 build、跑全量门禁、提交或推送。

## 本轮确实完成的只读事实

| 对象 | 独立核对结果 |
|---|---|
| 冻结源码 HEAD | `e7a4eac44bacb64f6d74dd5a028d0380b0aa69f8` |
| 自有源码快照 | 精确 Git archive：608 文件、9,056,975 B；只取 server、tools、64 项提交版发行数据及其清单、六包与 `mio_update_bootstrap.py` |
| 源码快照树 SHA-256 | `bc7d169214451aa4b6ac450829bd10a5cf7da74b6f2601f55e3a8c3cf55f33f0`；清理前再次核对全部归档文件长度与逐文件 SHA-256 |
| 实际现有 dist | 81 文件、2,424,023 B；未重新构建，逐文件路径、长度、SHA-256 与 R2 的 HTTP 81 资产证据完全相同，无新增、缺失或变化 |
| index SHA-256 | `ecd63ebe23e44f17c079d4d256765e9355e24a2fee50a7e30e5e0ece643ccbfa` |
| dist 树 SHA-256 | `72e282cce4015a7216f19be1bd8b038cb7aac6fe878a3d7be9331b47609df382` |
| R2 compact JSON | 269,667 B；SHA-256 `fdc54b26e119a6efdc05dce7b71f9c80ebba91b68b47ee163f45de34b6e20e94` |
| 当前 QA 面板 | `extensions/qa-review/panel.js`：28,296 B；SHA-256 `fd560a62b566022c879d9409b4e5476398fcef8c37173918dcfb43076a1775f5` |

以上树哈希的精确定义为：按 Windows `Path` 默认顺序（本组文件等价于 POSIX 相对路径 casefold 排序），逐文件向 SHA-256 更新 `UTF-8 POSIX相对路径 + NUL + 文件原字节`，文件末尾不加分隔符。大小写敏感 POSIX 排序会给出另一树哈希，不能据此误报资产变更。

静态差异核对范围为 R2 `5569dc294fd16c7478abbd31317da7e9055c3be7` 至本轮冻结提交：主应用 app/pages/styles、五旗舰模板所在 `server/mio_server/album`、另外五个专业包及提交版 data 没有变化。真正受影响的运行时代码为 QA `panel.js`、`models.py`、`pipeline/judge.py`、`pipeline/qa.py`；API 类型与说明、测试、夹具同步改变。相关性能源码工作树与冻结 HEAD 没有未提交差异。本席另将精确资产身份交给一个只读子席独立核对，结果一致；子席没有启动运行时或编辑文件。

## 未获窗口、未启动与取消原因

准备阶段其他四席仍在浏览器审计。本席遵守分阶段约束，从未获得总控的排他采样授权，也没有因单一审计席释放消息而自行启动。随后总控明确停止对已知失败候选进行本轮性能采样。

本席 **Chrome 启动 0、fixture 服务启动 0、端口开放 0、性能样本 0、截图 0**。只准备了自有 TEMP 中的冻结清单和中性夹具脚本，夹具从未执行。没有连接、终止或清理用户 Chrome、8788/8188、其他用户应用、私人运行数据或已接管 recovery。没有测量瓦数、VRAM 或整机能耗；不存在可报告为 R3 的 CPU、内存、帧间隔、解码或合成器结果。

`VIS-R3-M01` 来自视觉席真实实测，本席没有独立复现：动态壁纸模式的 `#prompt-completion` 背景为 68% alpha，1440×900 与 390×844 均会透出下层控件；等待 1600 ms、动画数为 0 后仍然存在。视觉席确认浅/深非动态模式为不透明背景，并在纯文字互核中确认本席 NOT VERIFIED 与其未决 Medium 无冲突。具体复现与原图由视觉席报告负责，本席不把他席截图描述写成自己的性能测量。

## R2 证据可保留，但不替代 R3

R2 的主应用、模板和其他五包性能源码及实际主应用构建均与本轮相同。因此其已完成的双宽 30/60/180 秒自然闲置、恢复、静帧/关闭/reader/reduce-motion、pure-CDP 原生失焦，六包三态与 36 次正常生命周期，60/120 幕拆幕导入与真实 pan/scroll/wheel，以及五模板 20 格/60 次打开、独立 PNG 解码/滚动/分页/GC，仍是**同字节既有证据**。它们的原始记录与限制保留在 [R2 性能报告](cross-audit-4-perf-r2.md)，本轮仅核对身份，没有将任何旧样本改标为 R3 新测。

这些身份事实不能让本轮签发 PASS。尤其 QA 新增的模型 note、score 与 assessed/unknown/not_assessed DOM，以及无参考角色、纯场景仍经过真实模型调用和 aggregate 的后端路径，不能继承旧 QA 的运行时结论。最终修复版本仍须以当前真实 API job 和真实 UI 测量以下完整范围：

- 动态壁纸自然闲置是否真实 decoded-frame 增量为 0，以及 Paint/Raster/Composite/Swap/Decode 分类；即时恢复、手动关闭、reader、reduce-motion 与真实原生 blur。
- 六包开启/关闭前后首屏实现请求、iframe、CPU、Working Set、Private Bytes、宿主及独立 iframe 显式 GC 堆、生命周期卸载回收；包括新 QA 分支的 payload 和 DOM。
- 60/120 幕本地拆幕和导入、看板滚动、任意候选左右对比的 pan/wheel 帧间隔与内存。
- 五旗舰模板 60/120 张实际独立图片的打开、解码、滚动、分页和 GC。

R2 的限制也不因同字节而消失：reader 1440 整页 Paint 非零；真实 blur 的 Composite/Swap 非零；renderer task 与 Chrome CPU 不等于整机能耗；PID 变化时交集 CPU 是下界；Working Set 求和会重复计共享页；顺序 RAM 样本不能单独归因扩展；120 幕本地解析/导入仍有约 100–321 ms 长帧。旧 before 与 CSS 控制干预均不能冒充当前构建结果。没有新增样本也不能证明这些指标已改善或退化。

## 四席纯文字互核

- **视觉席**确认 `VIS-R3-M01` 双宽、静置后仍存在的真实证据，且没有用截图代替性能；与本席未采样 NOT VERIFIED 无冲突。
- **架构席**确认三态 iframe=0、实现请求=0 只证明未加载，不推出零 CPU/RAM/合成器或性能无回归；QA 真正改变，dist 相同不消除新测缺口。
- **手感席**确认其交互、领域任务、输入和焦点实测不代表 CDP/CPU/GPU 性能；其本范围无新增 B/H/M、保留 Low，不能补齐本席缺测或抵消跨席 Medium。
- **混沌席**确认短程 deadline、传输、MessagePort/session/blob URL/监听器计数不能证明 retained heap、全进程 CPU/RAM 或 GPU 功耗，也不能替代新 QA 路径的性能测量；其本范围结果不抵消未决 Medium。

四席均明确无范围或结论冲突。本轮整体验收不能通过，本席没有发出任何 R3 VERIFIED PASS。

## 清理与可审计交接

唯一自有 TEMP 为 `C:\Users\QIU\AppData\Local\Temp\mio-crossperf-r3-261126`。已删除自己的准备 archive/冻结目录、夹具、脚本及清单，共 693 文件、11,590,249 B。仅保留 `summary.json`，14,552 B，SHA-256 **`3784c3ff05d43653bfcc63dc0ecb8842bf162c73285b671cfa87d32743fdd001`**。JSON 保存 81 资产逐文件指纹、源码快照身份、R2 证据身份、取消理由、所有缺测项、四席互核及清理边界。未触碰其他 TEMP 或 recovery。

因为没有启动任何长期进程或服务，没有需要关闭的本席 Chrome/fixture PID，也没有声称全机器不存在其他 Chrome。最终修复版本的性能目标原样保留，交由修复与完整门禁后的全新独立 R4 执行。

```json
{"audit":"cross-audit-4-perf-r3","head":"e7a4eac44bacb64f6d74dd5a028d0380b0aa69f8","status":"NOT VERIFIED","exclusive_window_granted":false,"runtime_performance_samples":0,"browser_launches":0,"fixture_service_launches":0,"screenshots":0,"source_archive_files":608,"dist_files_identical_to_r2":81,"known_cross_seat_medium":"VIS-R3-M01","r2_evidence_relabelled_as_r3":false,"final_scope_reduced":false,"own_temp_only_summary_retained":true}
```
