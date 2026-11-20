# 复杂 ComfyUI 工作流参考适配器

这是可单独安装、启用、停用和卸载的 Mio 扩展。只使用 `contribute` 的三个稳定契约：
`workflow_slot_adapter`、`workflow_binding`、`comfy_output_adapter`，不访问 `mio.internal`。

## 覆盖什么

| 场景 | 本包的明确支持范围 |
| --- | --- |
| 多槽 LoRA | `Power Lora Loader (rgthree)` 的现有 `lora_N` 对象输入；重复文件名仍有独立稳定键；开关、MODEL/CLIP 强度及额外行元数据保留 |
| 多阶段采样 | `KSampler`、`KSamplerAdvanced`、`FaceDetailer`、`DetailerForEach` 的现有字面值参数；基础、Hires 和细化阶段可分别覆写 |
| IP-Adapter | `IPAdapterAdvanced.weight` → `strength:reference`；直接连接的 `LoadImage.image` → `ref:1` |
| ControlNet | `ControlNetApplyAdvanced.strength` → `strength:pose`；直接连接的 `LoadImage.image` → `control:pose` |
| 特殊输出 | 本包明确提供的 `MioArtifactOutput` history `artifacts` 协议，接受有限的 PNG/JPEG/WebP 等图片字节或 Comfy 文件引用，由宿主验证图片 |

LoRA 扩展只改节点**已有输入**，因此不提供追加新槽位。先在 ComfyUI 中增加槽位再重新导出。
已关闭的 LoRA 保留名称与强度；未使用的空占位行保持原样。允许的可调强度为本参考包声明的 -5～5。

节点类型与字段已按 [rgthree 源码](https://github.com/rgthree/rgthree-comfy/blob/main/py/power_lora_loader.py)、
[IP-Adapter 源码](https://github.com/cubiq/ComfyUI_IPAdapter_plus/blob/main/IPAdapterPlus.py)、
[Impact Pack 源码](https://github.com/ltdrdata/ComfyUI-Impact-Pack/blob/Main/modules/impact/impact_pack.py)和
[ComfyUI 源码](https://github.com/Comfy-Org/ComfyUI/blob/master/nodes.py)核对（2026-11-21）。
上游可能变更；离线契约测试不代表任意版本、任意图或真实模型已经验证。

## 安装与停用

在 Mio 的扩展市场导入本目录，审阅摘要后启用。也可以把目录内容打包成 ZIP 后导入；
ZIP 根目录应直接包含 `mio-extension.json`。本包没有 Python 额外依赖，不安装任何 ComfyUI 插件或模型。

从仓库根目录校验：

```powershell
python tools/check_extension_package.py examples/extensions/comfy-complex-adapters
python -m unittest discover -s server/tests -t server -p test_complex_adapter_package.py -q
```

通过 `GET /api/v2/comfy-adapters` 检查 `complex-power-stack`、`complex-artifacts` 的来源与摘要。
经 `GET /api/v2/workflows/{id}/loras` 读取实际组键与每颗 LoRA 的键，再把它们原样送回
`slot_overrides.groups`，不要自己拼造稳定键。

停用会移除本包的识别规则与贡献。已冻结的图不会被重新编译；未执行的自定义输出仍依赖原摘要，
缺少对应扩展时由宿主阻塞，不通过重新提交到上游来补救。运行中或待核对的依赖禁止卸载。
卸载默认由宿主管理私人数据，本包本身不写运行数据。

## 分阶段参数与参考图

基础采样默认使用 `base`，Detailer 默认使用 `detail`。给 Hires 采样节点标题加
`[adapter-stage:hires]`，即可使用以下已有通用值：

```json
{
  "values": {
    "seed:base": 7,
    "steps:base": 20,
    "steps:hires": 10,
    "denoise:hires": 0.4,
    "steps:detail": 6,
    "strength:reference": 0.7,
    "strength:pose": 0.5,
    "ref:1": {"$asset": "<本机素材ID>"},
    "control:pose": {"$asset": "<本机素材ID>"}
  }
}
```

`[adapter-ref:2]` 可声明 IP-Adapter 的第二个参考槽，`[adapter-control:depth]` 可声明控制类型。
不同 IP-Adapter 的权重当前共用 `strength:reference`；要逐节点不同权重，使用现有手动映射或 JSON Pointer 覆写。

作者的 `[mio:*]` 标签和手动映射优先，且宿主按**种类**而非 qualifier 判断是否已明确绑定。
例如明确映射一个 `steps` 后，本包不会擅自再补其他 `steps:*`；需要分别配置时，请把所有阶段一起手动映射。
普通 `steps` / `seed` 等无 qualifier 值仍作为每个阶段的回退值。

只追踪直接来自 `LoadImage` 第 0 输出的 IMAGE 连线；经过裁切、批次、条件切换或其他处理的图片源请显式映射到正确上游。
连接线本身绝不变成文件字符串。一个 Loader 被不同语义角色共享时，规则给出诊断并拒绝隐式图片绑定。

## 可选特殊输出节点

本扩展的 `comfy_node.py` 是单独给 ComfyUI 使用的示例。需要时由用户将它复制到
`ComfyUI/custom_nodes/mio_artifact_output/__init__.py` 后重启自己的 ComfyUI；安装 Mio 扩展不会执行这一步。
把 `MioArtifactOutput` 接到最终 IMAGE，并在工作流配置中选择：

```json
{"output_adapters": {"12": {"id": "complex-artifacts"}}}
```

history 格式为 `{"artifacts":[{"base64":"<严格base64图片>"}]}`，也可用
`{"filename":"frame.png","subfolder":"renders","type":"output"}`。
最多 16 张内联图片，每张不超过 10 MiB；拒绝 URL、越界路径、空输出和错误 base64。
仅传文件引用时，数据仍由宿主通过当前 ComfyUI 实例的 `view` 获取，不访问外部地址。

`workflow.json` 是**离线契约拓扑**，省略了真正出图所需的若干输入和模型；它不是可直接排队的完整作品工作流。
本轮没有安装 ComfyUI 节点、读取用户 LoRA 或向上游提交生成请求。

新插件的适配步骤见 [30 分钟实战指南](../../../docs/COMFY_ADAPTER_GUIDE.md)。
