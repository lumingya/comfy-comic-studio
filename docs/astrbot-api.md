# 聊天机器人 / 自动化集成速查

这些路由与其余 `/api/v1` 路由一样，需要 `MIO_API_TOKEN`（Bearer，至少 32 个字符）。响应格式统一：

- 成功：`{"data": ..., "requestId": ...}`。
- 失败：`{"error": {"code", "message"}, "requestId": ...}`。生产队列的错误也使用这个格式（契约 2.0 起）。

完整说明见 [API 教程](api/README.md)，全部路由见 [路由总表](api/ROUTES.md)。

## 让用户“按编号挑选”

| 方法 | 路由 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/catalog` | 一次返回 `workflows`、`storyboards`、`presets`、`layouts`、`channels`、`collections` |
| GET | `/api/v1/resources/workflows` | 已保存的 ComfyUI 工作流（不含节点图） |
| GET | `/api/v1/resources/presets`、`characters`、`scenes` | 变量集预设，用 `category` 区分角色和场景 |
| GET | `/api/v1/resources/layouts` | 画册导出版式（不含 HTML） |
| GET | `/api/v1/resources/channels` | 图像渠道（不含密钥和地址）；`usesWorkflow` 标出 ComfyUI 渠道 |
| GET | `/api/v1/resources/collections` | 画册集 |
| GET | `/api/v1/albums/<id>` | 画册详情，每一页带 `assetEndpoint`（GET 它可以拿到 dataUrl，`/assets/raw?path=` 返回原图字节） |

## 典型流程：一句话生成一本画册

```http
GET  /api/v1/catalog
POST /api/v1/production/tasks
     {"storyId": "story_x", "presets": [{"kind": "characters", "id": "setting_x"}],
      "channelId": "comfyui", "workflowId": "wf_x", "title": "画册名", "seed": 1, "seedEnabled": false}
POST /api/v1/production/tasks/<task id>/start      {"trusted": true}
GET  /api/v1/production/tasks/<task id>            # status、pages[].state、albumId、paused
POST /api/v1/albums/export     {"albumIds": ["<albumId>"], "format": "html", "layoutId": "export-afterglow"}
```

补充说明：

- 装配时可以带 `requestId` 作为幂等键；省略时由服务端生成。`title` 也可以省略，默认取分镜标题。
- 装配只生成快照，不会产生费用；`start` 必须带 `trusted: true`（确认启动生成和可能产生的费用），否则返回 `403 forbidden`。
- 轮询 `status`：`standby`（未开始）、`ready` / `preparing` / `running`（进行中），`complete` / `partial` / `failed` / `cancelled` / `interrupted`（结束）。
- 旧的动作式路由（`/production/assemble`、`/production/start` …）仍然可用，并且支持用 `ids` 批量操作。

## 机器人还能做的事

- **临时写一个分镜**：`POST /api/v1/library/storyboards {"title", "frames": [{"prompt", "caption"}]}`，返回的 `id` 可以直接用于装配。
- **修改角色设定**：`PUT /api/v1/library/characters/<id>/entries/<变量名> {"value": "..."}`。
- **切换图像渠道**：`POST /api/v1/channels/<id>/activate`。
- **审图**：`POST /api/v1/albums/<id>/steps/<n>/critique`，结果会写回这一页。
- **让文本模型帮忙写分镜**：`POST /api/v1/llm/chat {"messages": [...]}`，使用用户已经保存的模型和密钥。

HTML 导出由 `backend/mio_layout_export.py` 在服务端完成，它是浏览器端 `compileTemplateDocument` 与 `attachAlbumMetadata` 的 Python 移植：

- 图片内联为 data URL。
- 注入模板样式和阅读运行时。
- 附带 `mio-album-data` 元数据，导出的文件可以再导入 Mio（`POST /api/v1/library/import` 的 `html` 字段）。
