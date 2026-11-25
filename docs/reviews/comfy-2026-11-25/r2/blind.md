# Wave4 R2 独立野生盲审：REQUEST CHANGES

冻结产品提交：`6f9bdf2c56994397754f4ec2c782f1ab63bc75a0`。本审查没有修改产品、使用浏览器 Profile 或凭据、加载模型、执行 GPU 出图、访问付费服务或重复 Wave3 门禁。最终运行使用该提交的 Git 归档副本，归档 SHA-256 为 `901b833618cc7ccb3935a036449b9a032e8d6192a84e1f82b8b4ae0a2ea122b3`。

## 结论与分级

### Blocker

无。

### High H1：尺寸自动映射改写支持蒙版，未改生成尺寸

新抓的 [Image Merge 原件](https://raw.githubusercontent.com/fofr/cog-comfyui-image-merge/main/workflow.json) 有 32 节点，混合 Efficiency、三层 ControlNet、双 IPAdapter 蒙版和 UltimateSDUpscale。生成 latent 是 `/8/inputs/latent_image -> 4:3`，节点 4 的原生尺寸字段为 `empty_latent_width` 与 `empty_latent_height`。

Mio 却把 width 绑定到 `/56/inputs/width` 和 `/58/inputs/width`，height 同理。56 和 58 是 SolidMask，经过 FeatherMask / MaskComposite / InvertMask 连接两个 IPAdapter 的 `attn_mask`；它们属于模型调制支持支路。`width=1152` 编译只改两个蒙版，生成 latent 仍为原始 512×768；没有尺寸不生效提示。`height=896` 同类。全图连线虽然保持，参数语义已经错误。

[Efficiency 原生实现](https://raw.githubusercontent.com/jags111/efficiency-nodes-comfyui/main/efficiency_nodes.py) 的 `TSC_EfficientLoader.INPUT_TYPES` 声明上述生成尺寸；`RETURN_TYPES` 第 3 端口为 LATENT，`efficientloader` 用这两个字段创建 latent。产品根因位于 `binding_inference.py` 的尺寸依赖范围：模型祖先中的蒙版标量进入尺寸候选。需要按实际画布/latent 生产路径收窄作用域，无法确认时明确人工接管。

### Medium M1：双引导器共享文本未受正向保护

新抓的 [官方 HiDream E1.1 PNG](https://raw.githubusercontent.com/comfyanonymous/ComfyUI_examples/master/hidream/hidream_e1.1_example.png) 原生 prompt 有这些连接：

- 节点 52 `InstructPixToPixConditioning`：positive=`[6,0]`、negative=`[7,0]`。
- 节点 53 `DualCFGGuider`：cond1=`[52,0]`、cond2=`[52,1]`、negative=`[6,0]`，style=`nested`。
- 节点 54 `SamplerCustomAdvanced` guider=`[53,0]`，之后 VAEDecode8 → SaveImage9。

Mio 自动将 negative 唯一绑定到 `/6/inputs/text`。负词覆写确实只改这个目标，但该文本也经过 52 的 positive 输出进入 cond1，因此同一次操作还改了正向图像条件指令。没有共享条件提示。原生 [InstructPixToPix 契约](https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/comfy_extras/nodes_ip2p.py) 分别保留 positive/negative 为输出 0/1；[DualCFGGuider 契约](https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/comfy_extras/nodes_custom_sampler.py) 将 cond1/cond2/negative 作为三组条件使用。产品 `positive_literals` 只扫描 positive/conditioning，遗漏 guider 的 cond1/cond2 正向依赖。需要保护共享正向源并停止此自动负词写入。

### Low L1：原生双路条件仍有保守人工边界

Stable Cascade inpaint、SD3.5 Canny、Flux outpaint、Image Merge 与 Material Transfer 的清晰原生条件链未自动探测全部正负词。检查会给出 unbound / ambiguous 提示，原值保留，手工映射整图比较通过。属于可见保守边界，不能算自动成功；本次不将其升级为 Medium。

### Low L2：多阶段种子策略需要说明

Stable Cascade 的 StageC3 与 StageB33、Image Merge 的 sampler8 与 upscaler71 原本有不同种子。Mio 将一个 seed 同时写入两级，但 steps/cfg/sampler 只写首级。预先真值把这类分阶段参数列为人工，因此保留其严格预期不一致；未发现推断目标之外的结构损坏。建议明确“所有阶段种子同步”的产品策略或增加阶段选择，不将这一策略差异与 H1 的错误目标混为一谈。

## 独立采集、去重与真值方法

最终固定 15 份：9 PNG + 6 JSON；13 API + 2 UI；228 节点、85 类名，最大 32 节点。包含 Stable Cascade 双级与多参考/修复、Lumina、HiDream、Qwen 编辑、SD3.5 控制、Hunyuan 静态图像、Flux 外扩、T2I Adapter、Efficiency/IPAdapter/ControlNet/放大、Material Transfer、LayeredDiffusion、LoRA，以及 Use Everywhere 和 Fooocus UI 导出。对嵌套结构递归过滤视频、3D、音频类，未发现禁用类别。

公开 GitHub API 限流后使用免登录 raw 文件和小型归档。每份来源 URL、文件 SHA-256、独立拓扑哈希与类名计数均在 `sanitized-results.json`；原件、作者文本、模型文件名和图片仅留在临时材料，没有入库。

对指定五份旧清单只使用来源、哈希、结构与文件位置去重，没有使用旧 expected 或引擎结果作真值。115 条旧来源包括 initial75、supplement25、R1 盲15；实际可读 90 原件为 initial50 + supplement25 + R1 15。逐份独立提取 JSON/PNG prompt，按类名、字段类型、连线端口及五轮邻域细化重算拓扑，得到 89 种。首跑前排除了候选 7、9、12 三份旧拓扑重复。最终 15 份全部与已登记来源/哈希和 90 个可读旧原件拓扑不同。

**限制：原 initial75 中 25 份 Civitai 原件为 unavailable，只有登记来源/哈希/节点摘要，不能独立证明与这 25 份的拓扑都不同。** 当前75和R1盲15的原件均已完整覆盖拓扑去重。五轮邻域拓扑指纹用于去重，不声称是完备图同构证明。

在首次引擎运行前，根据原图连线与原生契约写下每类参数的自动/人工/不存在预期。预期文件 SHA-256 为 `9293cecf0989a14d883eb839110f5302cb2b69f328bdc5ce56c13e98d01e4d55`。15 份固定后没有按失败换样；全部失败留在统计。

## 验证结果

| 项目 | 结果 |
|---|---:|
| 实际 inspect-file 路由与独立提取一致 | 15/15 |
| API 实际 import + loras 路由 | 13/13 |
| UI 导出引导 + 实际 import 拒绝 | 2/2 |
| API 无改动编译 | 13/13 |
| 无改动编译存活节点原值一致 | 13/13 |
| 自动参数整图精确比较 | 86/86 |
| 人工参数整图精确比较 | 52/52 |
| 以上编译连线完整保留 | 138/138 |
| 两份真实 API LoRA 负权重覆写与关闭整图精确比较 | 4/4 |
| 空实例目录的离线诊断缺节点集合精确 | 13/13 |
| 原始图与原件未改写 | 15/15 |

整图比较在无改动编译基线上，只替换独立指定的标量/图片目标，再对完整字典、列表、类型和值作严格相等；同时单列每条连线。LoRA 单独将 model 强度写为 -0.73125，关闭则将 model/clip 两个强度归零，所有其他值和连线必须相同。证明的是目标写入无损；H1、M1 说明目标语义仍需单独验证。

严格预设语义检查 130 项中 99 项完全一致；其中自动预期 83/100、人工预期 11/25、不存在预期 5/5。31 项不一致包含安全保守拒绝、图像需要人工角色映射、多级种子策略和实际缺陷，不能把它们全部描述为同一种失败，也不能把“能编译”表述为语义通过。Image Merge 的两个真实 Save 节点均保留属于可接受输出策略，预先将其标为人工的严格不一致不计为产品缺陷。

初次 harness 把图片值传成 SHA 字符串，后来根据 compile 契约改成显式 `$asset` 对象并重新运行；该 harness 错误没有当成产品缺陷。原图、15 份样本和预期文件未改变。

## 独立命令与覆盖限制

所有脚本均在临时审查目录运行：`python scout.py`、`python fetch_examples.py`、`python finish_collect.py`、`python dedup.py`、`python contracts_fetch.py`、`python expectations.py`、`python freeze_source.py`、`python probe.py`、`python finalize.py`、`python check_evidence.py`。脚本输出为来源/结构/指针/计数，未打印作者提示词或模型名称。产品通过 `git archive` 冻结导出，之后不依赖并行修改中的工作区源码。

实际路由在进程内调用，使用空扩展注册表与内存 store；没有启动 HTTP 服务或 ComfyUI。离线诊断使用空 object_info 验证缺失类集合与链接边界；未声称本机节点/模型可用，也未执行自定义 VALIDATE_INPUTS。没有 120–300 节点真实样本或真实 GPU 运行，本次没有大型图性能覆盖。

固定15中两份 API LoRA 原始权重为正：已覆盖在真实图上请求负权重与关闭，没有作者原始启用负权重或原始禁用 API LoRA 覆盖。继续寻源后发现 [MagicNodes Easy UI](https://huggingface.co/DD32/MagicNodes/raw/main/workflows/mg_Easy-Workflow.json) 与 [SuperSimple UI](https://huggingface.co/DD32/MagicNodes/raw/main/workflows/mg_SuperSimple-Workflow.json) 的作者原始第1槽 `use_lora_1=false, strength_model_1=-1, strength_clip_1=0.2`，但发现时间在固定15之后；没有加入本次引擎统计，也不冒充启用负权重 API 验证。

H1 与 M1 未关闭，签发 **REQUEST CHANGES**。修复后应继续保留本轮失败原件复测，并由下一轮全新审查者额外采集未见样本。
