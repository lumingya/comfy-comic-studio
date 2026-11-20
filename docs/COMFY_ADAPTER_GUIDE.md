# 30 分钟，为新的 ComfyUI 插件写一个 Mio 适配器

目标是一份独立可安装的小包，以及能离线证明它如何读写节点的测试。Mio 核心不用认识插件品牌。
参考成品在 [comfy-complex-adapters](../examples/extensions/comfy-complex-adapters/README.md)，
稳定接口以 [扩展 SDK](../server/mio_server/extensions/README.md#工作流识别规则) 为准。

## 0–5 分钟：先证明需要哪种适配

从 ComfyUI 导出 **API 格式** JSON，保留最小相关节点和连线，删去服务地址、凭据、个人提示词和私有模型名。
先用标签或手动映射：普通节点不需要新扩展。区分以下情况：

| 需求 | 稳定契约 | 输入与输出 |
| --- | --- | --- |
| 特殊 LoRA 对象、序列化字符串、多槽对象 | `workflow_slot_adapter` v1 | `inspect(node)` 描述；`write(node, slot, loras)` 返回已有输入的修改 |
| 自定义采样器、参考图与权重字段 | `workflow_binding` | 纯函数从 API graph 返回 kind/node/field/qualifier |
| 非标准 history 图片结构 | `comfy_output_adapter` v1 | `freeze(node, options)` 冻结解析计划；`collect(output, plan, transport)` 返回 `OutputImage` |
| 必须查询或写入插件服务端状态 | `comfy_state_adapter` v1 | capture/push/change/validate；宿主管理端点独占和恢复日志 |
| 只在 ComfyUI 浏览器中运行的 JS | 以上契约未必足够 | 先确认有可用服务器协议；不能把前端点击成功当成 API 可执行 |

不要把 IMAGE/MODEL/CONDITIONING 连线当作普通字符串输入。图片应映射到正确的上游 Loader。
若插件根本不在 history 留下可恢复输出，不能用 history 输出适配器假装解决断线恢复。

## 5–10 分钟：复制脚手架并缩小认领范围

在仓库根目录执行（示例目录尚不存在时）：

```powershell
Copy-Item -LiteralPath examples/extensions/comfy-complex-adapters -Destination examples/extensions/my-comfy-adapter -Recurse
```

把新目录的 `mio-extension.json` 改成以下内容，并删去不需要的参考实现、可选 Comfy 节点和离线拓扑。
新 ID 也要用于测试和包名，不要覆盖参考包的贡献 ID。

```json
{
  "id": "my-comfy-adapter",
  "name": "My Comfy adapter",
  "version": "0.1.0",
  "description": "One documented node shape",
  "main": "main.py"
}
```

以下完整 `main.py` 是一个更小的工作流绑定脚手架。`MySampler` 必须替换为实际导出的 class_type；
不要用包含“sampler”等模糊字符串的猜测规则。

```python
def identify(graph):
    for node_id, node in graph.items():
        if node["class_type"] != "MySampler":
            continue
        steps = node["inputs"].get("steps")
        if type(steps) is int:
            yield {"kind": "steps", "node": node_id, "field": "steps"}


def activate(mio):
    mio.contribute("workflow_binding", "my-sampler-steps", identify, contract=1)
```

认领规则必须足够窄：同时检查 class_type、所需字段和字段类型。未匹配的节点返回空结果；
已认领但结构损坏时应明确失败或产生可理解的诊断，不应顺手改写其他节点。

## 10–18 分钟：实现最小读写闭环

LoRA 参考是 `main.py` 的 `PowerStack`：保留输入顺序、重复模型名和各行元数据，
只改现有 `on/strength/strengthTwo`；空占位行不变。宿主分配稳定键，不要把数组位置当永久身份。
`inspect` 与 `write` 都只处理宿主给的副本，不联网，不读可变配置，不读取模型。
声明正确的 `can_disable`、`can_append` 和强度范围；不能新增输入的协议就声明不支持追加。

采样阶段可用 qualifier，如 `steps:hires` 和 `steps:detail`。参考包把
`[adapter-stage:hires]` 作为自己的标题约定；核心并不认识这段标记。
作者明确的标签和映射优先，而且宿主当前按 kind 整体抑制扩展补全。需要单独控制每个阶段时，
把全部阶段列入手动映射，避免只写一处后误以为其他位置仍被自动绑定。

参考包只追踪 IP-Adapter / ControlNet 的直接 `LoadImage` 上游；其他拓扑由作者显式映射。
所有图片占位仍使用 `{"$asset":"本机素材ID"}`，交给宿主上传，不在扩展中再做上传或提交。

自定义输出参考 `ArtifactOutput` 与可选 `comfy_node.py`。`freeze` 必须是纯函数，
把输出格式版本与解析选项固定成 JSON。`collect` 只读本节点 history；返回图片字节，
或当前端点可读取的 filename/subfolder/type。拒绝外部 URL、路径穿越、损坏数据与无界批次。
输出解析失败后由宿主进入核对路径；扩展不能偷偷再调用 `/prompt`。

## 18–25 分钟：先写离线证据

参考 [完整回归](../server/tests/test_complex_adapter_package.py)，替换其中的最小图和断言：

1. 精确匹配与未匹配节点：只认领自己的 class_type，源图始终不变。
2. 两个同名 LoRA：使用发现端点拿到的不同 key，分别改开关和 CLIP，其他行不变。
3. 基础 / Hires / Detailer：各 qualifier 独立生效，显式映射优先；连线不被覆盖。
4. 图片输入：正确 Loader 成为素材占位，输出上传计划正确；共享 Loader 冲突应失败。
5. 输出：有效内联图片与文件引用可读；空列表、坏 base64、伪图片、越界路径和错协议失败。
6. 冻结：改工作流或当前适配器后，已排队图与输出计划保持原样；缺摘要不换用新实现。
7. 生命周期：CTK → 安装 → 摘要启用 → 发现 → 编译 → 停用 → 卸载，核心目录无改动。

不要连用户显卡，不加载私人 LoRA，不使用计费云端。离线图可能不是完整的可执行工作流；
必须明确写在 README 中。真实兼容性另用已安装节点、已装模型和中性题材验证。

## 25–30 分钟：静态校验、打包、审阅

```powershell
python tools/check_extension_package.py examples/extensions/my-comfy-adapter
python -m unittest discover -s server/tests -t server -p test_complex_adapter_package.py -q
ruff check examples/extensions/my-comfy-adapter server/tests/test_complex_adapter_package.py
ruff format --check examples/extensions/my-comfy-adapter server/tests/test_complex_adapter_package.py
```

测试命令中的文件名换成自己的测试。CTK 只做静态检查，不执行扩展，不代表可以信任其代码。
把清单与入口放在 ZIP 根目录，或者直接从扩展市场导入目录；审阅内容摘要后启用。
从 `GET /api/v2/comfy-adapters` 核对贡献身份；从工作流的 `/loras` 和 `/compile` 核对实际效果。
改动任何包文件都要重新审阅摘要。已提交任务依赖旧输出协议时，先完成或核对它们再更新／停用。

## 适配边界与上游依据

这份参考实现核对了实际上游字段形态：
[Power LoRA Loader](https://github.com/rgthree/rgthree-comfy/blob/main/py/power_lora_loader.py)、
[IPAdapterAdvanced](https://github.com/cubiq/ComfyUI_IPAdapter_plus/blob/main/IPAdapterPlus.py)、
[FaceDetailer / DetailerForEach](https://github.com/ltdrdata/ComfyUI-Impact-Pack/blob/Main/modules/impact/impact_pack.py)、
[ControlNetApplyAdvanced](https://github.com/Comfy-Org/ComfyUI/blob/master/nodes.py)。
核对日期为 2026-11-21；没有复制上游实现，也没有声称每个上游版本都已真机跑过。
遇到新字段、特殊提交协议或未声明输出时，扩展作者应更新自己的包和夹具，而不是在 Mio 核心加品牌判断。
