# next/ · Phase 0.5 技术验证（Spike）

新架构的技术验证，与旧版代码完全独立，只用 Python 标准库（后续排版会用 Pillow）。任务与验收标准见[路线图 §7](../docs/ROADMAP.md)。

```
next/
├── mio_next/comfy/      ComfyUI 运行器
│   ├── bindings.py      [mio:*] 标签、JSON Pointer 映射、启发式兜底、变体裁剪、覆盖、内容检查（纯函数）
│   ├── ws.py            标准库 WebSocket 客户端（RFC 6455）
│   ├── client.py        HTTP + WebSocket：提交、进度、预览帧、逐节点耗时、取图；WS 不通时自动轮询
│   ├── adapters.py      前端状态节点适配（参数不在 API JSON 里的节点）
│   └── cli.py           python -m mio_next.comfy inspect | snapshot | run
├── mio_next/llm.py      反代客户端：文本、视觉、出图（兼容 OpenAI 接口），模型按顺序回退，JSON 校验失败时让模型修正
├── mio_next/script.py   结构化剧本：一句话 → 角色 / 场景 / 12–16 格 JSON；校验是纯函数（成年角色、全年龄、引用完整）
├── mio_next/prompts.py  双方言编译器：同一格 → Danbooru 标签（本地 SDXL）或英文描述加参考图编号（云端模型）
├── mio_next/render.py   出图：本地（ComfyUI，文生图 / 图生图加 tile）与云端（参考图定形；多参考失败时拼成一张并排参考图）
├── mio_next/judge.py    VLM 评审：逐格逐角色的身份分与标志特征；定位人脸供气泡避让
├── mio_next/layout.py   条漫排版：800 px 全宽分格、自动气泡（避脸、读序、尾巴指向说话人）、1280 px 切片
├── mio_next/bench.py    效果基准流水线：出图 → 评审 → 排版 → 报告，可断点续跑
├── mio_next/cli.py      python -m mio_next script | compile | bench
├── workflows/           内置工作流（带 [mio:*] 标签）：t2i_sdxl.json、i2i_tile.json
├── fixtures/            黄金故事（效果基准固定用这一份）
├── tests/               单测（录制式假服务器，不需要 ComfyUI 和反代）
├── local/               本机私有文件：工作流副本、运行配置、状态快照（已忽略，不提交）
└── out/                 出图与指标（已忽略）
```

## 验证

```bash
cd next && python -m unittest discover -s tests -t . -q     # 约 5 秒
```

CI 在仓库根目录跑同一组：`python -m unittest discover -s next/tests -t next -q`。

## 剧本与提示词

```bash
cd next
python -m mio_next script "雨夜里，刚辞职的插画师苏晚在旧书店避雨……" --out local/story.json   # 走本机反代
python -m mio_next compile fixtures/golden_story.json --panel p07                              # 查看两种方言
```

- 剧本 JSON：`characters`（id、性别、年龄 ≥ 20、外貌标签、用于一致性检查的 `signature`、英文描述）、`scenes`（地点、时间、标签）、`panels`（景别、机位、出场角色的表情 / 动作 / 标签、画面描述、对白）。
- 校验不通过时，把问题清单发回模型修正，最多两轮。默认模型 `gemini-3.7-flash`，失败回退 `gpt-5.2`。
- 黄金故事 `fixtures/golden_story.json`：《雨夜的未完画稿》，由上面那句话一次生成（gemini-3.7-flash，59 s，校验一次通过），14 格、3 个场景、2 个角色、14 句对白。人工只改了一处：p02 描述里的 "girl" 改为 "woman"。

## 效果基准

```bash
cd next
python -m mio_next bench fixtures/golden_story.json --out out/bench                 # 全部步骤
python -m mio_next bench fixtures/golden_story.json --out out/bench --approaches baseline --steps sheets,baseline
python -m mio_next bench fixtures/golden_story.json --out out/bench --approaches hybrid --steps cloud   # 可与上一条同时跑
```

| 步骤 | 内容 |
|---|---|
| `sheets` | 角色设定图。基线：本地文生图；混合：云端生成后本地图生图统一画风 |
| `baseline` | 旧管线的代表：每格只用 Danbooru 标签本地文生图 |
| `cloud` | 混合策略第一步：云端按参考图定构图和角色（只用反代，不占 ComfyUI） |
| `hybrid` | 混合策略第二步：本地图生图加 tile ControlNet 统一画风 |
| `judge` | VLM 评审：每格每个出场角色对照该策略自己的设定图打身份分（1–5），并检查标志特征 |
| `faces` | VLM 定位人脸，供气泡避让和尾巴指向 |
| `layout` | 排版并切成 800×1280 的 JPEG |
| `report`、`contact` | `metrics.json`、`REPORT.md`，以及逐格对照缩略图 |

- 每张图旁边都有同名 JSON：耗时、实际使用的模型、回退记录。已有的结果会跳过，中断后重跑即可续上（`--force` 重做）。
- 反代经常遇到 429 冷却和 reCAPTCHA 失败：客户端会按提示的冷却时间等待重试；一个模型重试用尽后，5 分钟内跳过它（熔断），再换下一个模型。云端出图默认串行。

## 运行器用法

工作流用 ComfyUI 的「导出（API）」保存。在节点标题里加标签，不改结构：

| 标签 | 作用 |
|---|---|
| `[mio:prompt=positive]` | 把正面提示词写进该节点的 `positive` 字段（`=字段` 可省略，按节点类型推断） |
| `[mio:negative]` `[mio:seed=noise_seed]` `[mio:width]` `[mio:height]` | 同上；同一标签出现在多个节点时一对多写入 |
| `[mio:output:draft]` / `[mio:output:final]` | 输出节点按变体分组；运行时只保留所选输出及其上游 |
| `[mio:inspect]` | 运行后读回该节点的文本（如 ShowText），用来核对最终提示词 |
| `[mio:ref:1]` `[mio:init]` `[mio:mask]` | 参考图、底图、蒙版输入 |

```bash
cd next
python -m mio_next.comfy inspect  local/wf.json --config local/wf.run.json
python -m mio_next.comfy snapshot local/wf.json --out local/wf.state.json
python -m mio_next.comfy run      local/wf.json --config local/wf.run.json --variant draft \
       --prompt "1girl, adult, office, city street" --seed 42 --width 832 --height 1216
```

运行配置（JSON，全部可选）：`mapping`（手动 JSON Pointer 绑定）、`values`（默认值）、`overrides`（按路径改已有参数，支持 `*`，不会新增键、不会覆盖连线）、`guard`（拦截词：提交前扫描整张图里的字符串，运行后再查 `[mio:inspect]` 读回的最终提示词）、`state`（snapshot 文件）、`frontend`（本次运行对前端状态节点的改动），以及按变体覆盖的 `variants.{draft,final}`。

每次运行写出 `out/<变体>-<种子>.json`：总耗时、逐节点耗时、缓存命中、预览帧数、读回的最终提示词、图片路径。效果基准直接读这些文件。

## 接入真实工作流时发现的兼容问题

| 现象 | 原因 | 运行器的处理 |
|---|---|---|
| 参数面板节点在 API JSON 里是空的（如 `ParameterControlPanel`） | 值存在前端，由浏览器推给服务器内存，ComfyUI 重启即丢 | `snapshot` 保存一次；运行前若服务器为空就推回，本次改动跑完即恢复 |
| 保存节点保存了图片，`/history` 却没有图 | 如 `SaveImagePlus` 的 `enable_preview=false` 时不回报图片 | `inspect` / `run` 会提示，并给出可用的覆盖路径 |
| 放大、细化等阶段没有出现在导出里 | 导出时这些组被静音，API 格式直接丢弃静音节点 | 建议导出时全部启用，再用 `[mio:output:*]` 选择变体，由运行器裁剪 |
| 界面上的全局种子节点在 API 里无效 | 只在前端工作 | 变体裁剪会去掉这类无下游的节点；种子由 `[mio:seed]` 写入 |
| 成品版没有复用草稿版的采样结果 | 如 `ParameterBreak.IS_CHANGED` 把 `time.time()` 算进哈希，每次提交都算「已变化」，下游全部重算 | 成品档改为把选中的草稿图作为 `[mio:init]` 输入，不依赖缓存 |

## 验收记录

- [x] 「爱丽丝」工作流（138 个节点）只加 8 个标题标签，结构逐项比对一致；草稿版和成品版都跑通。环境：2026-09-26，RTX 4060 Laptop 8 GB，832×1216，共 28 步（16 + 12 两段采样，工作流自带的「出图加速」开启）。

  | 变体（输出节点） | 保留节点 | 总耗时 | 缓存命中 | 预览帧 | 主要耗时 |
  |---|---|---|---|---|---|
  | draft（3600 PreviewImage） | 89/138 | 50.4 s（冷启动） | 0 | 28 | 加载模型 19.6 s，采样 11.9 + 5.5 s，VAE 3.0 s |
  | final（4277 SaveImagePlus） | 98/138 | 19.5 s | 40 | 28 | 采样 11.0 + 4.5 s，VAE 2.6 s |

  - **内容边界**：只用这份工作流的结构。运行配置覆盖了全部文本来源：固定前缀换成中性质量词，后缀和 LoRA 文本清空，全部 LoRA 关闭，角色是成年人。提交前扫描拦截词（负面提示词字段除外），运行后用 `[mio:inspect]` 读回最终提示词再查一遍。工作流副本、运行配置和状态快照只放在本机的 `next/local/`，不提交。
  - **覆盖只改取值**：运行配置里的覆盖都是参数取值（清空文本、关闭 LoRA、`enable_preview=true` 让保存节点回报图片），不增删节点和连线。
  - 这份导出里，放大和细化组在导出时是静音的，所以成品版等于底图经 SaveImagePlus 保存。要测真正的两档，需要启用这些组重新导出；参数面板快照显示工作流里有 5 个相关阶段（潜空间放大加 tile、迭代放大、分块放大、部位细化）。
