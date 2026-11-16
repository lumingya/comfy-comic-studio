# 参数面板状态适配器

安装并启用后，在工作流配置中填写 `"state_adapters":{"1":"example-pcp"}`，其中 `1` 是 ParameterControlPanel 节点 ID。通过工作流 `capture-state` API 捕获并保存 `config.state`，再提交试绘或生成任务。

示例复用 `/danbooru_gallery/pcp/load_config` 与 `save_config` 协议，需要用户安装对应 ComfyUI 插件。Mio 核心负责端点独占、持久记录原状态、写入核验、执行后恢复以及第三方冲突保留；扩展只负责协议，不自行管理事务。

任务冻结扩展摘要。运行中、结果不确定或尚有待恢复状态时不能停用扩展。尚未运行的任务在适配器不可用时阻塞，恢复原版本后才能继续。更新扩展不会让旧任务静默使用新实现。
