# 内联图片输出示例

将本目录安装为 Mio 扩展并启用。另将 `comfy_node.py` 复制到 ComfyUI 的 `custom_nodes/mio_inline/__init__.py`，按自己的维护安排重启 ComfyUI。示例节点生成两个纯色块，不需要模型。

工作流导入以下 API 节点图：

```json
{"42":{"class_type":"MioInlineImages","inputs":{"color":"#6e8b72"},"_meta":{"title":"[mio:output]"}}}
```

工作流配置加入 `"output_adapters":{"42":{"id":"inline-images","options":{}}}`。在后一个带 `[mio:init]` 输入的阶段设置 `"feed_output":{"node_id":"42","index":1}`，即可传递第二张图；未指定时沿用第一张。所有结果仍会保留。索引从零开始；索引越界会停止后续阶段。

适配器从持久 history 读取 `images_base64`，断线后的核对使用相同协议。这是示例自行定义的协议，不代表其它插件的输出都使用此格式。真实插件可另外注册适配器。安装、启用、工作流配置、生成、核对均可通过开放 API 完成。
