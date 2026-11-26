# CrossAudit-4-Perf-Power · 第二轮独立审计

签发：**本席性能/功耗代理指标范围 VERIFIED PASS：0 Blocker / 0 High / 0 未决 Medium。** R1 C4-M01 由当前实际构建的真实手势复验关闭。**这不是整体任务完成**：总控终盘新增 QA-DIALOGUE-M01（缺少台词契合度），架构席已确认并改为 NOT VERIFIED PASS；性能通过不能抵消该能力缺口。

本席未参与产品实现。唯一仓库写范围为本报告；不修改产品、测试、构建、发行数据或私人运行数据，不提交或推送。原任务为 `D:\Tencent Files\tx download\ai_studio_code (4).txt`，六项专业能力按用户授权以独立、默认停用的官方沙箱面板提供。已阅读 AGENTS、README、ROADMAP、原任务、Playwright 与 UTF8 Text Guard 技能，并复用仓库 Python Playwright/CDP 夹具；不安装浏览器、包或新依赖。

## 候选身份与方法边界

- 精确源码：`5569dc294fd16c7478abbd31317da7e9055c3be7`。只从 Git HEAD archive 必需的 server、tools、data、六扩展与 `mio_update_bootstrap.py`；不复制工作树运行数据或受保护本机文件。
- 本轮绑定的既有 `web/dist/index.html` SHA-256：`ecd63ebe23e44f17c079d4d256765e9355e24a2fee50a7e30e5e0ece643ccbfa`。未构建；复制该实际 build 到隔离快照。dist 81 文件、2,424,023 B；整树按排序相对路径、NUL、字节计算 SHA-256：`72e282cce4015a7216f19be1bd8b038cb7aac6fe878a3d7be9331b47609df382`。
- 冻结源码和 dist 688 文件、11,439,721 B，首次导入前整树同算法 SHA-256：`64f0056042b41557467aa1f31570dcbbb389eae92c894df8ee40dcea51eccdf2`。Python 导入缓存不改变 Git 源码身份；实际 HTTP index 及全部资产的哈希另有下述实测。
- 唯一 TEMP：`C:\Users\QIU\AppData\Local\Temp\mio-crossperf-r2-261126`。本轮 `prepare.py`、`run.py` 与以新 ROOT 加载的 `audit.py` 均在此目录执行，结束后只保留紧凑summary；历史 R1 的 frozen/ZIP/HTML 不用于新候选。
- R1 历史 before 固定为 `d9cfa801c42f19db29788ea044d31eaf1c50c221` / index `66e3085d61fc54a598243e1d3a36b95e05ea4de17cdbb8b4ff21d4013692a33d`。只把原始受控采样当历史对照，不把 CSS 注入结果冒充当前 build。
- CDP trace 的 Paint/Raster/Composite/Swap 分类、renderer TaskDuration、进程 CPU 时间、JS heap、Windows Working Set/Private Bytes 分层列出；不换算为瓦数、GPU 利用率或 VRAM。共享页可能被 Working Set 求和重复计算。小样本 plateau 不等于永不泄漏。
- 自然 idle 必须媒体先解码、最后真实输入到 pause 的真钟时长匹配阈值，且 document.hidden=false、hasFocus=true、无全屏覆盖，manual/reduce-motion=false，路由不在 reader/layout/全屏导出预览。只记录原生 timer 安排不能替代 60/180 秒等满；暂停后另测稳定窗口的零 decoded-frame 增量与 trace 分类。

## 当前修复的静态互核

独立只读复核确认 C4-M01 的修复提交为 `54be02f3fad7ea22dfa273f76ce59d66f519a0c4`：`web/src/styles/studio.css:113–116` 去掉每个候选徽章的 `backdrop-filter: blur(3px)`，背景由 70% 改成 92%；`SplitCompare.tsx` 未改。`web/src/pages/board/boardCompositing.test.ts:36–55` 保护静态 CSS 不变量，不能测 Chrome Layerize。R1 历史受控注入矩阵支持减少底层重复 backdrop 层的归因，实际新build的独立复验见下文。

## 实际测量身份与排他窗口

排他采样窗口为 **2026-11-26 11:35:18—12:09:12 +08:00**，总控确认其他四席没有浏览器、重测试或构建。前席因代理回复上限交接，不是产品失败；接续保留全部已完成数据，只补模板和真正的原生失焦。已安装 Chrome **158.0.8127.37**，Windows，1440×900 / 390×844，无 CPU/网络限速。除最后原生失焦外，性能测量为 headless。复用已有 Python Playwright/CDP，不安装浏览器或包，未访问 8788/8188、用户标签页、付费模型或真实出图服务。

最终聚合时将冻结的 **607 个源码文件**逐字节与精确 Git archive 提交对照，0 mismatch；冻结 dist 与当时工作树 dist 整树哈希仍相同。通过隔离服务 HTTP 实际读取 **全部81文件 / 2,424,023 B**，逐文件字节与SHA-256均匹配冻结dist，完整路径指纹保留在summary。总控12:12起另行放行QA修复；该授权后的代码变化不属于本席采样漂移，本报告始终只绑定5569dc2 / ecd63…构建。

已有 chrome-headless-shell PID30336 / 父node20208 创建于11月24日，早于本轮两天，未触碰、不算本席实例或新竞争工作负载；最终另按创建时间看到既有recovery范围的非自有驻留Chrome，依总控明确要求不连接、不读取内容、不终止、不清理。**没有声称整机零其他Chrome**。本席未重跑全量测试或build；总控已提供后端1738、前端127 files/1076、其余基础门禁及CI45745955229三job成功，作为外部前提，不冒充本席再次执行。

## 指标定义

CDP类别为 `devtools.timeline,disabled-by-default-devtools.timeline,cc,viz,gpu,media,disabled-by-default-media`，保留事件名、线程、类别、次数与X相位耗时。嵌套/跨线程时长可能重叠，不换算GPU百分比。原始trace只在内存聚合，不保存大trace。

host/iframe的 `JSHeapUsedSize` 为对应target显式GC后的JS堆，不含解码位图/纹理。Working Set为自有Chrome组RSS求和，可能重复计算共享页；Private Bytes为同组Windows private总量，仍不是JS堆或VRAM。CPU是固定窗口两端 `SystemInfo.getProcessInfo.cpuTime` 差值；PID集合变化仅计共同存活PID，属于下界。GPU进程CPU不是GPU利用率。**没有电表/能源计数/电池实验，不报告瓦数、节能百分比或VRAM。** 有限GC/DOM平台不证明无限期无泄漏。

## 动态壁纸：自然等待与覆盖

本机中性H.264，1280×720、30fps、8秒循环。每宽真实自然等待30/60/180秒，非假计时器，非只检查timer安排。阈值前仍播放；暂停时hidden=false、hasFocus=true、无全屏遮挡，静帧/reduce-motion关闭，位于设置页。暂停后立即1秒及另稳定3秒采样，恢复由真实输入至首个requestVideoFrameCallback测量。

| 宽 / 阈值 | 实际输入→pause s | 恢复输入 / 首帧ms |
|---|---:|---|
| 1440 / 30 | 30.0038 | 鼠标 / 5.9 |
| 1440 / 60 | 60.0040 | 按键 / 28.6 |
| 1440 / 180 | 180.0023 | 滚轮 / 37.4 |
| 390 / 30 | 30.0036 | 鼠标 / 2.8 |
| 390 / 60 | 60.0043 | 按键 / 29.0 |
| 390 / 180 | 180.0039 | 滚轮 / 3.6 |

六个稳定3秒窗口均decoded+0、currentTime冻结，Paint/Raster/Composite/Swap/Decode各0次/0ms；renderer task0.094–1.499ms、Chrome CPU delta8.096–17.815ms，故不是整进程零CPU。关闭idle档超过35.7秒后两宽仍各90帧/3秒；两宽静帧模式五类trace全零。四档持久化已实际验证。

阅读室覆盖另等5.5秒settled：两宽壁纸paused=true、帧+0、Decode/Raster/Swap为零；**1440整页仍104 Paint/10.897ms、renderer task132.351ms**，390五组全零。早先仅等700ms的样本含阅读内容解码和转场，不能归为壁纸继续解码，也不能说阅读室整页完全静止。

### 真实原生失焦

原headless、headed双context，以及追加OS HWND切换的Playwright探针，均双方hasFocus=true，不作失焦通过或产品失败。已装driver `crPage.js:438` 对自身主frame session开启焦点仿真；另一CDP session发false没有撤销它。

最终采用**直接CDP websocket**控制新建的自有Chrome/profile，无Playwright页面session、无焦点仿真。按唯一自有标题找HWND，先确认属于刚创建的本席Chrome PID及创建时刻，再使两个自有原生窗口A→B→A，记录GetForegroundWindow每次等于目标HWND。不碰用户窗口，不覆盖JS getter；采用禁用原生遮挡后台化开关，保持hidden=false而单独施加blur。

| 失焦稳定采样 | 1440 | 390 |
|---|---:|---:|
| focus；hidden；paused | true→false→true；始终false；false→true→false | 相同 |
| wall s；decoded/dropped delta | 3.004；0/0 | 3.014；0/0 |
| renderer task ms | 0.871 | 0.792 |
| Paint/Raster次数 | 0/0 | 0/0 |
| Composite次数/ms | 15/0.595 | 10/0.435 |
| Swap次数/ms | 18/2.732 | 12/1.886 |
| Chrome CPU delta ms；PID稳定 | 1374.031；否，交集下界 | 63.937；是 |

currentTime两宽完全冻结，返回前台后恢复播放并增加帧。1440含decode字符串32事件/0.382ms全是MojoAudio/VideoDecoderService::GetSupportedConfigs与RasterDecoderImpl::Initialize，**不是视频帧解码**；390为零。1440 browser/GPU进程CPU约1057.711/294.315ms，390为34.707/13.018ms。可签真实失焦暂停和恢复，不能签整浏览器零工作。

## 六扩展：三态与36次生命周期

关闭/未安装→全启未打开→多轮开关后再全停用。每宽各态cold-cache-disabled、warm、warm顺序n=3，共18首屏；全部iframe0、六包implementation请求0。ready为导航至设置控件可用；CPU在ready后等700ms+GC，再测固定3秒idle，**不是导航起首3秒CPU**。

下表为各态n=3中位数：

| 宽/指标 | 关闭 | 启用未打开 | 再停用 |
|---|---:|---:|---:|
| 1440 ready ms | 445.164 | 429.823 | 427.277 |
| 1440 host GC JS MiB | 5.692 | 5.741 | 5.957 |
| 1440 3s CPU delta ms | 527.570 | 32.366 | 38.268 |
| 1440 Working Set MiB | 710.668 | 792.996 | 1201.711 |
| 1440 Private Bytes MiB | 410.469 | 459.641 | 811.727 |
| 390 ready ms | 449.564 | 409.857 | 427.739 |
| 390 host GC JS MiB | 5.694 | 5.747 | 5.956 |
| 390 3s CPU delta ms | 33.628 | 33.704 | 33.550 |
| 390 Working Set MiB | 1026.500 | 1018.285 | 1067.059 |
| 390 Private Bytes MiB | 701.895 | 687.324 | 710.328 |

1440关闭态CPU三样本655.174/30.410/527.570ms，第三PID集合变化只计下界；不能用中位数说启用扩展省CPU。同浏览器顺序运行，未独立重启/随机化/清除全部解码与GPU缓存，RAM增长不单归因扩展，不声称全启零RAM成本。

真实生命周期为 **2宽×3主题(paper/ink/video)×6包=36次**，每宽18，每包两宽共6，不是每包18。打开host GC JS11.563–12.631MiB、独立iframe1.809–1.888MiB，关闭host5.829–6.001MiB；36次关闭iframe全归零，无iframe CDP boundary/error。同主题关闭nodes固定：1440为692/693/842，390为686/687/836，没有逐包递增；两宽jobs前后不变。无本实验可证的泄漏Medium，但有限正常生命周期不代替第5席deadline/Abort/body/POST异常取证。

## C4-M01：历史、干预、实际新build分列

历史before为d9cfa801… / index66e3085…；受控CSS仍为同一旧build，仅徽章backdrop-filter blur(3px)→none，同时背景.7→.92。实际新build为本报告5569dc2 / ecd63…，**没有对它注入修复CSS**。样本120幕/1440候选复用12张480×640独立中性图，不代表1440张不同大纹理。历史每宽每模式n2；当前双宽×三主题，各格独立context。pan为60 pointermove，board和compare各40 wheel。

| 对象/宽 | pan p95 ms | pan max ms | 每次>50ms | task ms / wall s |
|---|---:|---:|---:|---|
| 旧before/1440 | 196.2 | 221.3–242.0 | 60 | 11855.9–11993.7 / 12.187–12.337 |
| 旧before/390 | 179.6–183.8 | 196.3–221.2 | 60 | 11129.1–11297.9 / 11.462–11.641 |
| 旧CSS干预/1440 | 20.8–20.9 | 25.0–29.2 | 0 | 1565.0–1589.6 / 1.936–1.974 |
| 旧CSS干预/390 | 12.6 | 20.9–21.0 | 0 | 1177.2–1275.9 / 1.899–1.902 |
| 实际新build/1440三主题 | 20.9–25.0 | 25.2–37.5 | 0 | 1625.6–1811.2 / 2.092–2.218 |
| 实际新build/390三主题 | 12.6 | 12.9–16.8 | 0 | 1169.1–1213.3 / 1.901–1.913 |

当前6 board scroll p95为12.5–29.2ms、max≤37.7ms，6 compare wheel p95为8.0–8.3ms、max≤9.7ms；**6pan+6board+6wheel的>50ms全0**。大图打开277.082–308.957ms；pan/wheel两图transform一致，divider键盘50→52，任意候选对明确采用后唯一adopted为take07，退出原图焦点全true。

历史短CPU profile的Layerize从45次/2000.962ms/max203.427降到52次/221.118ms/max23.263。结合受控干预与实际提交54be02f…支持局部重复backdrop图层化归因；不是新build profile，也不证明全站唯一瓶颈。静态CSS回归不能替代真实手势。**R1 C4-M01在本冻结候选关闭。**

拆幕保留边界：60/120各宽n2，预览24行且总数正确，未调用LLM。1440预览60幕138.264–145.318ms、120幕305.784–341.940ms；390为127.148–139.980/322.355–373.706ms。120幕fill有284.0–321.5ms帧间隔，60幕部分100.1–108.5ms；这是一次文本替换/解析，不是持续pan回归，不能泛化整站零长帧。真导入120幕为391.805ms/928.247ms，各新增120且原1440候选保留，再仅删新增ID恢复夹具。

## 五旗舰离线模板：60/120独立PNG

五模板×60/120×双宽，**20独立context/60次打开**，每格n3；每张为独立480×640中性PNG，total=unique=60/120，loading=lazy数亦等于总图数。首屏自然等待至少一图complete且naturalWidth>0，不强迫全部离屏decode。

| 模板 | 1440 open中位ms 60→120 | 390 open中位ms 60→120 | 手势后loaded：1440 60/120；390 60/120 |
|---|---:|---:|---|
| Monograph | 52.584→59.658 | 54.376→65.169 | 10/10；14/14 |
| Nocturne | 47.699→51.991 | 60.090→51.777 | 31/31；31/31 |
| Folio | 49.708→60.345 | 51.336→56.545 | 60/62；31/31 |
| Zine连续阅读 | 56.147→62.142 | 52.605→61.590 | 22/22；15/15 |
| Contact Sheet | 70.279→81.897 | 56.398→66.020 | 60/120；58/58 |

20个40次wheel与8个30次ArrowRight分页，rAF p95全4.3ms、>50ms全0；scroll max≤16.8ms、pagination max≤33.7ms。Nocturne实际到31/总数；Folio桌面跨页到59/60或61/120，手机单页到31/总数。分页模板wheel仅滚动扉页少量高度，另有真实分页证据；Zine本次选webtoon，不冒充全部模式。

精确 `Decode Image` 事件的120张手势证据：1440五模板依次7次/3.588ms、30/14.408、60/24.478、17/7.411、102/56.246；390为11/5.276、30/12.809、30/14.100、11/4.699、52/30.118。natural loaded差不等于decode数，不将RasterDecoder命令或嵌套decode事件相加，不声称各模板全120图已解码。

60次往返about:blank+GC的nodes全4，初blank heap约0.554MiB，后两轮约0.731（Zine0.741）；首开GC heap1.814–1.890MiB，手势后2.040–2.116MiB。未见JS随60→120倍增或逐次无界增长，不由此推论纹理/解码缓存/总RAM不增长。进程WS/private在JSON另列，非各模板独占RAM排名。20格稳态horizontalOverflow=false，宽恰1440/390、video0、外联0；未检查每个动画时刻，不替代视觉席全矩阵。

## 探针失败、互核与清理

- Playwright三组未施加实际blur的数据原样保留；最终raw证据替代它们，不改成通过样本。OS补探针前两次因ctypes HWND参数/标题传播没找到窗口，finally清理后修正。
- 模板第一轮第10格的wait_for_function字符串轮询被导出CSP拒绝unsafe-eval；保留前9格，改直接读状态，仅续剩11格，最终20/60完整。未放宽产品CSP。
- raw前三次分别遇“前台可见就绪前等视频”“初始native hidden”“应用更新title后旧标题不能恢复HWND”；未完成行不计结果，最后完整两宽。失败史与影响均入summary，未把技术exit0等同产品通过。
- 1440关闭态及raw1440的PID变化均标CPU下界，未删除高CPU样本制造节能差值。
- 四席均已完成纯文字互核并明确无冲突。架构席确认三态/18首屏/36关闭和资源边界一致；启用的通用menu/metadata不等于加载六实现。48契约/隔离不代替CPU/RAM。手感席功能/焦点与本席transform、take07采用、退出焦点一致；实际TTS补证由其/总控独立完成，本席不声称声学验证。视觉席确认逐帧/像素矩阵与本席稳态性能回答不同问题；可靠性席确认deadline/Abort/body/POST和XSS/隐私不由普通GC替代。没有为互核重复其重测试。
- **QA-DIALOGUE-M01是总控/架构独立新增未决Medium**，不在本席性能目标中，仍阻止整体验收。所有PASS只绑定本报告精确冻结对象及实测覆盖。

最终自有Chrome/fixture **12:09:12 +08:00**退出，raw记录25 PID alive=[]；模板12:06:20退出，其6 PID alive=[]。12:09:23按唯一TEMP路径CIM查自有Python/Chrome为0，已先向总控/手感席释放窗口，之后不再重开。不对整机所有Chrome作清零声明。

最终仅保留紧凑summary.json给总控：含HTTP81资产指纹、sourcefreeze、各阶段指标、事件/线程聚合、旧d9与CSS干预区别、错误史、跨席边界和逐阶段清理。聚合后精确清理自有生成HTML、图片/视频、冻结夹具、ZIP、脚本、日志及已知自建recovery；不碰其他TEMP、用户接管bridge recovery或私人数据。交接提供最终字节数/SHA-256，避免文件自哈希循环。

```json
{"audit":"cross-audit-4-perf-r2","head":"5569dc294fd16c7478abbd31317da7e9055c3be7","status_own_scope":"VERIFIED PASS","blocker":0,"high":0,"unresolved_medium_own_scope":0,"overall_acceptance":"NOT SIGNED: QA-DIALOGUE-M01 unresolved","C4M01":"closed on actual build","idle_natural":"2 widths x30/60/180 seconds","real_os_blur":"2/2","extension_lifecycle":36,"first_screen_samples":18,"template_cells":20,"template_opens":60,"http_files_byte_match":81,"source_files_byte_match":607,"watts_measured":false,"screenshots":0,"own_processes_all_exited":true}
```
