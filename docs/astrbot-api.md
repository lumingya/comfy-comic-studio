# /api/v1 扩展路由（供聊天机器人 / 自动化集成使用）

这些路由与其余 `/api/v1` 路由一样受 `MIO_API_TOKEN`（Bearer，≥32 位）保护，
成功响应为 `{"data": ..., "requestId": ...}`，错误为 `{"error": {"code", "message"}, "requestId": ...}`；
`production/*` 路由沿用生产队列自己的错误形状 `{"error": "message"}`。

| 方法 | 路由 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/catalog` | 一次返回 `workflows / storyboards / presets / layouts / channels / collections` |
| GET | `/api/v1/resources/workflows` | 已保存的 ComfyUI 工作流（不含图结构） |
| GET | `/api/v1/resources/presets` · `characters` · `scenes` | 变量集预设（`category` 区分角色 / 场景） |
| GET | `/api/v1/resources/layouts` | 画册导出模板（不含 html） |
| GET | `/api/v1/resources/channels` | 图像通道（不含密钥），`usesWorkflow` 标记 ComfyUI 通道 |
| GET | `/api/v1/resources/collections` | 合集 / 项目 |
| GET | `/api/v1/albums/<id>` | 画册文档，每幕带 `assetEndpoint`（可直接 GET 拿 dataUrl） |
| POST | `/api/v1/albums/export` | `{albumIds, format: html\|zip\|pdf, layoutId?, imageProfile?, themeColor?, border?, signature?, showCaptions?, showPrompts?}` → 文件下载 |
| * | `/api/v1/production/<route>` | 转发到生产队列：`assemble` `start` `start-many` `pause` `resume` `cancel` `remove` `tasks` `tasks/<id>` … |

## 典型流程

```http
GET  /api/v1/catalog
POST /api/v1/production/assemble
     {"storyId": "story_x", "presets": [{"kind": "characters", "id": "setting_x"}],
      "channelId": "comfyui", "workflowId": "wf_x", "title": "画册名",
      "requestId": "唯一字符串", "seed": 1, "seedEnabled": false}
POST /api/v1/production/start   {"id": "<task id>", "trusted": true}
GET  /api/v1/production/tasks/<task id>      # status / pages[].state / albumId / paused
POST /api/v1/albums/export      {"albumIds": ["<albumId>"], "format": "html", "layoutId": "export-afterglow"}
```

HTML 导出由 `backend/mio_layout_export.py` 在服务端完成，是浏览器端
`compileTemplateDocument` + `attachAlbumMetadata` 的 Python 移植：图片内联为 data URL，
注入模板样式 / 阅读运行时，并附带 `mio-album-data` 元数据，导出的文件可再次导入 Mio。
