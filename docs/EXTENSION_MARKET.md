# 扩展市场目录

扩展是可独立复制、导入的文件夹。市场只提供查找与下载入口，不改变扩展包格式，也不自动执行下载的代码。安装后须在扩展详情中查看并启用。

默认目录 `extensions/catalog.json` 仅列出实际随包的 AI 辅助与素纸主题，名称和版本读取各自的 `mio-extension.json`。可在市场中填写自己的 HTTP / HTTPS 目录地址；留空恢复随包目录。不接受包含用户名或密码的地址，地址片段会被移除。

远程目录是 UTF-8 JSON，例如：

```json
{
  "format_version": 1,
  "items": [
    {
      "id": "example-tool",
      "name": "示例工具",
      "version": "1.0.0",
      "description": "一个独立的创作扩展",
      "author": "Example",
      "homepage": "https://example.org/example-tool",
      "tags": ["创作"],
      "package_url": "https://example.org/example-tool-1.0.0.zip",
      "sha256": "填写 ZIP 文件的 64 位 SHA256 十六进制摘要"
    }
  ]
}
```

`id`、`name`、`version`、`package_url`、`sha256` 必填，其他元数据可省略。ID 由小写字母、数字、下划线与短横线构成，长度 2–48；一个目录中的 ID 不可重复。ZIP 可直接包含扩展文件，也可包含单个顶层扩展目录。包内清单 ID 与版本须和目录完全一致。目录不超过 2 MB / 500 项，压缩包不超过 50 MB，解压安全检查由扩展导入器统一完成。

目录默认缓存 10 分钟，手动刷新立即重新获取。刷新失败会保留同一来源上一次成功的目录并显示错误；切换来源会清空旧远程目录，避免从错误来源安装。用户配置和缓存存放在工作区的 `extension-market.json`，不写回扩展包。

开放 API 与本机界面具有相同能力：

- `GET /api/v2/extension-market?refresh=false`：来源、目录摘要、条目、安装状态和可执行动作。
- `PUT /api/v2/extension-market/source`，请求 `{ "url": "https://example.org/catalog.json" }`：切换目录。
- `POST /api/v2/extension-market/{id}/install`，请求 `{ "expected_catalog_digest": "列表中的摘要", "expected_sha256": "条目的摘要" }`：下载、校验并安装为禁用状态。

市场管理需要 admin 令牌。安装会再次核对目录摘要、包摘要及包内身份，过时的选择会被拒绝。更新同样需要用户主动选择，覆盖对应用户扩展后保持禁用；不影响该扩展独立的数据目录。此目录协议允许自建市场；项目未连接第三方公共市场。
