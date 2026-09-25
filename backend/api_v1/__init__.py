"""Mio public automation API (``/api/v1``).

Importing this package registers every route module on :data:`ROUTER`. The OpenAPI
document (:func:`openapi`) and the Markdown route table (:func:`route_table`) are
generated from the same registrations.
"""

from backend.api_v1.core import ROUTER, ApiError, handle  # noqa: F401

# Documentation order of the functional areas.
for _name, _description in (
    ("system", "健康检查、能力发现、OpenAPI 文档与路由索引。"),
    ("workspace", "工作区状态、完整快照、索引重建与文件问题。"),
    ("library", "文件库通用读写：分镜、角色/场景预设、画册集、创作计划、画册、版式、工作流、角色行、会话。支持 ETag 并发控制、合并补丁、复制、导入导出与排序。"),
    ("storyboards", "分镜的分幕（frames）细粒度增删改与排序。"),
    ("presets", "角色 / 场景预设的变量条目（entries）细粒度读写。"),
    ("albums", "画册：列表、详情、修改、删除、逐页图片编辑、导入导出。"),
    ("settings", "设置文档（comfy / llm / xml / workspace）读写；密钥只写不读。"),
    ("channels", "图像渠道：增删改、设为当前、测试连接、模型列表、密钥池；以及图像服务类型注册表。"),
    ("generation", "同步单张出图（云端渠道）。整册、可恢复的执行请用 jobs 或 production。"),
    ("jobs", "持久生成任务：幂等提交、暂停/继续/取消/重试、失败策略、事件回放。与浏览器队列共用同一执行器。"),
    ("production", "生产队列：分镜 + 预设 + 渠道/工作流 → 画册；装配、开始、暂停、克隆、逐幕修改。"),
    ("workflows", "ComfyUI 工作流：连接检查、节点信息、槽位分析与应用、设为当前工作流。"),
    ("llm", "文本模型与视觉审图：使用已保存的连接与密钥，在服务端代发请求。"),
    ("assets", "本地图片素材：读取、原始字节、上传、抓取远程图片、索引与清理、维护。"),
    ("recycle", "回收站：列出、恢复、永久删除、清空、自动清理。"),
    ("marketplace", "分镜市场：索引、抓取远程分镜、安装到文件库。"),
    ("ecosystem", "扩展、主题、样式、用户脚本、预处理、事件与导入导出器；以及扩展自身的后端路由。"),
    ("update", "更新中心：检查、应用、回滚、重启。"),
    ("catalog", "给聊天机器人的精简只读视图：一次拿到可选的工作流、分镜、预设、版式、渠道和画册集。"),
):
    ROUTER.tag(_name, _description)

from backend.api_v1 import system, library, parts, settings, channels, llm, catalog, albums, assets, generation, jobs, production  # noqa: E402,F401
from backend.api_v1.generation import GENERATION_SLOT, generation_payload  # noqa: E402,F401
from backend.api_v1.spec import VERSION, openapi, route_table  # noqa: E402,F401
from backend.api_v1.system import capabilities  # noqa: E402,F401
