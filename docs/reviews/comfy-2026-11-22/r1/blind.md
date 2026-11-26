# Wave4 独立野生盲测审计2

**结论：NOT VERIFIED PASS。2项 Medium，需要修复后复验。**

固定版本 `71457f6`。自行公开搜索与下载后选定15份首次出现的静态工作流：14份API图、1份UI-only，原容器为11 PNG、4 JSON，共337节点。按来源URL与独立重算拓扑排除了首轮75份及本轮重复。所有原件和脚本均仅在当前系统临时目录，没有修改产品或仓库。

| 指标 | 改前 aa06d0a | 本轮版本 |
|---|---:|---:|
| API图静态导入/编译 |14/14|14/14|
| 自动可确定语义组合正确 |38/50|50/50|
| 需人工映射时安全不自动写入 |14/20|18/20|
| 定向编译符合人工目标 |52/70|68/70|

语义组合分别是正词、负词、种子、宽、高；来源图人工标签先于产品探测建立。默认首个因果生成阶段拥有文本与画布，所有采样／精修种子同步。50项自动确定与20项需人工映射是独立分母，安全留空不算自动识别成功。基线无新文件解码器，因此改前仅比较同一14份独立提取的API图，不能称PNG文件导入成功。

实际调用产品 inspect-file/import/get/loras 处理函数：15份文件解码与独立提取一致，14份API导入/取回原图一致，1份UI返回API导出指引且不作为执行图导入。采用内存Store和空注册表，未启动HTTP、SQLite运行环境、浏览器或ComfyUI。

3个真实原生LoRA分别做负权重与禁用，共6次精确写入且保留连线；真实活跃LoRA总计5项，另外2项Efficiency堆叠被漏检。针对漏检的2项，手工JSON Pointer负权重／禁用4次精确通过。4个rgthree槽位均为None，不计活跃LoRA覆盖。20次显式人工映射均只改指定字段。

15/15源文件和源图保持不变；14/14无编辑编译保留节点内容未变。4份会按输出闭包删除不可达节点或冗余预览，这与源图修改分开计量。依赖诊断明确未检查实例，空object_info正确提示缺失类。独立标注的原图死分支缺少必填conditioning_2，在提供其节点契约后被诊断发现。

## 发现

### BLIND-M01 · Medium · Independent latent composition canvases are overwritten together

width binds5.width,62.width,65.width and height binds5.height,62.height,65.height. Requests768x960 replace384x768 subjects and1920x1088 background with the same size. Composite offsets656/1368/1016 and288 remain fixed.

Changing a global canvas parameter silently changes independent composition operands and destroys the authored layout.

修复方向：Respect independent dimension domains at multi-input composition. A generic explicit port contract may identify destination; otherwise require manual mapping for unequal parallel canvas sources.

### BLIND-M02 · Medium · Active upstream Efficiency LoRA stacks are omitted from controls

Both actual import and loras handlers report zero LoRA items. The only group is the loader empty embedded lora_name; the named upstream stack slot is silently absent.

Creators cannot see, change or independently disable an already active LoRA through its automatic controls. Arbitrary JSON Pointer overrides are available and passed4 exact-write tests, but do not replace requested automatic stack controls.

修复方向：Traverse model-consuming loader stack data inputs and use structural stack codecs with explicit effective-weight/count/mode contracts. Avoid treating model_str/clip_str as effective in simple mode.

## 公开来源与范围

| 样本 | 实际格式 | 节点数 | 来源 |
|---|---|---:|---|
| lora.png | api | 8 | [原作者文件](https://raw.githubusercontent.com/comfyanonymous/ComfyUI_examples/master/lora/lora.png) |
| lora_multiple.png | api | 9 | [原作者文件](https://raw.githubusercontent.com/comfyanonymous/ComfyUI_examples/master/lora/lora_multiple.png) |
| sdxl_refiner_prompt_example.png | api | 11 | [原作者文件](https://raw.githubusercontent.com/comfyanonymous/ComfyUI_examples/master/sdxl/sdxl_refiner_prompt_example.png) |
| night_evening_day_morning.png | api | 29 | [原作者文件](https://raw.githubusercontent.com/comfyanonymous/ComfyUI_examples/master/area_composition/night_evening_day_morning.png) |
| night_evening_day_morning_subject.png | api | 32 | [原作者文件](https://raw.githubusercontent.com/comfyanonymous/ComfyUI_examples/master/area_composition/night_evening_day_morning_subject.png) |
| square_area_for_2_subjects.png | api | 21 | [原作者文件](https://raw.githubusercontent.com/comfyanonymous/ComfyUI_examples/master/area_composition/square_area_for_2_subjects.png) |
| 2_pass_pose_worship.png | api | 20 | [原作者文件](https://raw.githubusercontent.com/comfyanonymous/ComfyUI_examples/master/controlnet/2_pass_pose_worship.png) |
| depth_controlnet.png | api | 10 | [原作者文件](https://raw.githubusercontent.com/comfyanonymous/ComfyUI_examples/master/controlnet/depth_controlnet.png) |
| noisy_latents_3_subjects.png | api | 20 | [原作者文件](https://raw.githubusercontent.com/comfyanonymous/ComfyUI_examples/master/noisy_latent_composition/noisy_latents_3_subjects.png) |
| flux_controlnet_example.png | api | 13 | [原作者文件](https://raw.githubusercontent.com/comfyanonymous/ComfyUI_examples/master/flux/flux_controlnet_example.png) |
| SD15_LCM_IPAdapter_Facefix.png | ui | 59 | [原作者文件](https://raw.githubusercontent.com/nerdyrodent/AVeryComfyNerd/main/workflows/SD15/SD15_LCM_IPAdapter_Facefix.png) |
| helper/hf-lora-stack.json | api | 34 | [原作者文件](https://huggingface.co/minhnhatdo/colab-notebook/resolve/ee749d145346cd4221107a1d22f5527e40f0f024/workflow/workflow_api.json) |
| helper/cog-consistent-character.json | api | 29 | [原作者文件](https://raw.githubusercontent.com/fofr/cog-consistent-character/main/workflow_api.json) |
| helper/cog-face-to-many.json | api | 14 | [原作者文件](https://raw.githubusercontent.com/fofr/cog-face-to-many/main/face-to-many-api.json) |
| helper/cog-face-to-sticker.json | api | 28 | [原作者文件](https://raw.githubusercontent.com/fofr/cog-face-to-sticker/main/face-to-sticker-api.json) |

完整SHA-256、类集合、人工目标、逐项编译差异、LoRA操作及路由结果见同目录 `BLIND_REPORT.json`。未保存原提示词或模型路径到报告。

局限：最大API图34节点，UI59节点；本轮没有新增120–300+ API巨图或WebP。插件中多输出契约未声明时按人工接管计量。未执行节点、下载模型、跑GPU或云服务，也未验证图片质量及真实浏览器交互。两项缺陷都已发给总控和独立编译审计；潜空间尺寸问题已获后者独立复现。
