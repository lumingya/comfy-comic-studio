# 21份真实API图：独立语义标注

基线`aa06d0a`，实测实现为`71457f6`。先根据原图连线与ComfyUI/插件上游契约手写预期JSON Pointer，随后比较Mio映射；没有把Mio探测结果当真值。
标注范围是正词、负词、种子、宽、高共105个样本参数组合。默认映射按因果上最早的生成阶段选正词与画布，所有采样阶段同步种子；Flux模型采样尺寸校准跟随该主画布。

|判定|改前|改后|
|---|---:|---:|
|自动映射正确|52|66|
|可确定但漏绑|10|0|
|自动映射目标错误/不完整|4|0|
|不存在的参数被误绑|0|0|
|需人工决定却自动写入|0|0|
|需人工处理且保守不绑定|14|14|
|参数确实不存在且未误绑|25|25|
|默认阶段/尺寸联动策略未知，不计正确率|0|0|

人工处理14项（7图×正负词）：4份SD3图各编码器文本不同，3份成对条件输出图在未提供object_info契约时等待人工映射；这14项不算自动正确。
真正缺少25项输入：12图没有字面量宽高（24项）；Redux BasicGuider没有负词端口（1项）。不把它们算漏绑。
此前暂列未知的6项现已明确策略并核查上游：Redux画布27与ModelSamplingFlux30宽高联动，因为30用尺寸计算采样shift；漫画按因果首阶段选择正词6、共享负词33、画布27，保留后续6格各自文本与画布。该口径是明确的默认产品策略，并非所有用户可能意图的唯一答案；用户仍可手动覆盖。

## 逐图结果

|样本SHA标识|改前：正确/漏绑/误绑/人工/缺省/未知|改后：正确/漏绑/误绑/人工/缺省/未知|公开原始来源|
|---|---|---|---|
|`f986015b8f4b`|5/0/0/0/0/0|5/0/0/0/0/0|[原始发布文件](https://github.com/barstoolbluz/comfyui-client/blob/main/workflows/api/sdxl/sdxl-txt2img.json)|
|`d5274291bd76`|0/3/0/0/2/0|3/0/0/0/2/0|[原始发布文件](https://github.com/barstoolbluz/comfyui-client/blob/main/workflows/api/sdxl/sdxl-upscale.json)|
|`655d40f671a6`|3/0/0/2/0/0|3/0/0/2/0/0|[原始发布文件](https://github.com/barstoolbluz/comfyui-client/blob/main/workflows/api/sd35/sd35-txt2img.json)|
|`791854c46022`|0/1/0/2/2/0|1/0/0/2/2/0|[原始发布文件](https://github.com/barstoolbluz/comfyui-client/blob/main/workflows/api/sd35/sd35-upscale.json)|
|`307b139c99fc`|3/0/0/0/2/0|3/0/0/0/2/0|[原始发布文件](https://github.com/barstoolbluz/comfyui-client/blob/main/workflows/api/sdxl/sdxl-img2img.json)|
|`ae121aa6f8a3`|5/0/0/0/0/0|5/0/0/0/0/0|[原始发布文件](https://github.com/barstoolbluz/comfyui-client/blob/main/workflows/api/flux/flux-txt2img.json)|
|`f70be9265ddf`|0/3/0/0/2/0|3/0/0/0/2/0|[原始发布文件](https://github.com/barstoolbluz/comfyui-client/blob/main/workflows/api/flux/flux-upscale.json)|
|`42bc1ab92665`|1/0/0/2/2/0|1/0/0/2/2/0|[原始发布文件](https://github.com/barstoolbluz/comfyui-client/blob/main/workflows/api/sd35/sd35-img2img.json)|
|`f2346cebed95`|3/0/0/0/2/0|3/0/0/0/2/0|[原始发布文件](https://github.com/barstoolbluz/comfyui-client/blob/main/workflows/api/flux/flux-img2img.json)|
|`313ddd5f790f`|3/0/0/0/2/0|3/0/0/0/2/0|[原始发布文件](https://github.com/barstoolbluz/comfyui-client/blob/main/workflows/api/sdxl/sdxl-inpaint.json)|
|`96a0e789477e`|1/0/0/2/2/0|1/0/0/2/2/0|[原始发布文件](https://github.com/barstoolbluz/comfyui-client/blob/main/workflows/api/sd35/sd35-inpaint.json)|
|`5fd0e557fd65`|3/0/0/0/2/0|3/0/0/0/2/0|[原始发布文件](https://github.com/barstoolbluz/comfyui-client/blob/main/workflows/api/flux/flux-inpaint.json)|
|`a691c9736ec5`|5/0/0/0/0/0|5/0/0/0/0/0|[原始发布文件](https://github.com/comfyanonymous/ComfyUI_examples/blob/master/aura_flow/aura_flow_0.2_example.png)|
|`1b84265f3feb`|5/0/0/0/0/0|5/0/0/0/0/0|[原始发布文件](https://github.com/comfyanonymous/ComfyUI_examples/blob/master/chroma/chroma_example.png)|
|`8653f5522836`|5/0/0/0/0/0|5/0/0/0/0/0|[原始发布文件](https://github.com/comfyanonymous/ComfyUI_examples/blob/master/hidream/hidream_full_example.png)|
|`921fdc29a75e`|1/0/0/2/2/0|1/0/0/2/2/0|[原始发布文件](https://github.com/comfyanonymous/ComfyUI_examples/blob/master/flux/flux_depth_lora_example.png)|
|`f155f417d99c`|1/0/0/2/2/0|1/0/0/2/2/0|[原始发布文件](https://github.com/comfyanonymous/ComfyUI_examples/blob/master/flux/flux_fill_inpaint_example.png)|
|`d13d6bedaadb`|1/0/0/2/2/0|1/0/0/2/2/0|[原始发布文件](https://github.com/comfyanonymous/ComfyUI_examples/blob/master/flux/flux_canny_model_example.png)|
|`c5c9427693a3`|4/1/0/0/0/0|5/0/0/0/0/0|[原始发布文件](https://github.com/comfyanonymous/ComfyUI_examples/blob/master/controlnet/mixing_controlnets.png)|
|`36f3012270d0`|1/1/2/0/1/0|4/0/0/0/1/0|[原始发布文件](https://github.com/comfyanonymous/ComfyUI_examples/blob/master/flux/flux_redux_model_example.png)|
|`2df6c0ad8d1a`|2/1/2/0/0/0|5/0/0/0/0/0|[原始发布文件](https://github.com/comfyanonymous/ComfyUI_examples/blob/master/flux/flux_kontext_example_comic.webp)|

完整的预期指针、理由、实测指针、缺失与意外目标详见同名JSON。
该结果仅证明这21份图的静态映射语义；没有运行模型/GPU、验证插件运行时或评价成图。

## 上游契约依据

- https://github.com/Comfy-Org/ComfyUI/blob/master/nodes.py
- https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_sd3.py
- https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_flux.py
- https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_ip2p.py
- https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_custom_sampler.py
- https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_edit_model.py
- https://github.com/ssitu/ComfyUI_UltimateSDUpscale/blob/main/usdu_nodes.py
- https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_model_advanced.py
