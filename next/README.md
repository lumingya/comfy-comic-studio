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
├── tests/               单测（录制式假服务器，不需要 ComfyUI）
├── local/               本机私有文件：工作流副本、运行配置、状态快照（已忽略，不提交）
└── out/                 出图与指标（已忽略）
```

## 验证

```bash
cd next && python -m unittest discover -s tests -t . -q     # 约 5 秒
```

CI 在仓库根目录跑同一组：`python -m unittest discover -s next/tests -t next -q`。

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

## 验收记录

- [ ] 「爱丽丝」工作流：草稿版与成品版各跑通一次（只加标签）。耗时与结果记在这里。
