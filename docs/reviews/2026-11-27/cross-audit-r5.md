# 当前 HEAD R5 独立交叉补测

日期：2026-11-27

构建：`b78de840044750fd29a214fcdba51ad130f4c925`

环境：已安装 Chrome 158.0.8127.37；项目自有隔离夹具；未访问用户当前浏览器页、私人工作区或付费服务。

## 结论

本轮补测关闭了部分原有证据缺口，但没有达到旗舰要求的连续五席 `VERIFIED PASS`。综合状态为 **NOT VERIFIED PASS**。

## 五席结果

### 架构 / 基座

- 六个工作台是独立的 declarative `episode` 面板；扩展关闭时通用宿主入口和工作区/浮层入口均条件隐藏。
- `App.smoke`、`hostSlots`、`host` 共 67 项通过；摘要、变更检测、安全模式、生命周期、六包检查和生成客户端/合同检查通过。
- 六个官方面板不声明 Python `main`，通过 iframe 与审核 bridge 运行。通用 Python 扩展仍在宿主进程执行，SDK 文档明确这不是 OS 进程沙箱；官方签名根也未验证。
- OpenAPI 对部分图片/下载/导出二进制响应仍记为 JSON/`Any`，方法和路径一致但严格媒体类型契约仍是 P2 缺口。
- 运行目录发行检查仍被受保护本机 seed 差异阻断，未修改这些文件。

### 交互 / 键盘

- 主应用核心旅程 16/16，onboarding/template 8/8；覆盖合集多选直拖与撤销、变量补全及合成 IME、120 幕纯文本拆幕、候选分割对比/缩放/平移/采用/Esc 焦点恢复。
- 六个扩展核心复跑 7/7；覆盖修图蒙版、QA 评分与批处理入口、精修队列、变体矩阵、Diff/检查点、动态漫参数与导出以及生命周期。
- 首次六包运行中曾出现一次 retouch 面板打开的时序观察，单包重跑和另一轮完整复跑均通过；按未复现 harness 观察保留，不记为确认产品缺陷。
- 真实系统 IME、实体手机、全主题/语言扩展矩阵和全站焦点归还仍未验证。

### 性能 / 功耗

- `check_roadmap_power.py` 全量 6/6：两种宽度的动态壁纸真实闲置约 30 秒后，后续样本解码帧、播放时间与 Paint/Raster/Composite/Swap 均为 0；恢复首帧约 32.3ms / 1.4ms。
- 长篇交互 2/2：120 幕、1,440 条候选、分割比较同步平移和焦点恢复通过，但单轮滚动 p95 为 62.6ms（1440，17 次超过 50ms）和 41.7ms（390，4 次超过 50ms）。这不是稳定回归判定，也不能沿用上一轮单样本的“无 >50ms”表述。
- 60/180 秒设置只检查持久化和计时器调度，没有真实等待；五模板打开/滚动性能、pan/divider 多轮尾分位、六包本轮启停性能、native blur/OS 失焦、GPU/VRAM/瓦数均未验证。

### 视觉 / 策展

- 主应用浅/深主题 1440/390 共 24/24，人工查看 40 张截图和两张联系表，未见明显溢出、裁切、重叠或主题错配。
- 六面板 84/84 与五模板 200/200 属既有专项证据；动态完整策展、六面板全主题/语言人工签发、物理设备和模板性能仍未覆盖。

### 混沌 / 安全

- 既有 R4 证据覆盖 503、超时、取消、卸载、XSS、TTS 和空态；当前工作树未修改。
- 本轮独立混沌席尚未形成终稿，因此 Linux 本机、签名发行包、完整路径兼容和临时资源清理不记通过。

## 可复现命令

```text
python tools/check_roadmap_browser.py --report <TEMP>/r5-roadmap.json --width 1440 --width 390 --theme light --theme dark --suite collections --suite completion --suite story-import --suite candidate-compare --suite onboarding --suite template
python tools/check_roadmap_power.py --report <TEMP>/r5-power.json
python tools/check_roadmap_power.py --only interactions --theme dynamic --report <TEMP>/r5-interactions.json
npm --prefix web test -- src/app/App.smoke.test.tsx src/extensions/hostSlots.test.tsx src/extensions/host.test.tsx
python clients/python/generate.py --check
python tools/generate_extension_contracts.py --check
```

临时报告和截图不属于仓库交付物；本轮没有提交它们，也没有操作用户接手的外部 recovery 目录。
