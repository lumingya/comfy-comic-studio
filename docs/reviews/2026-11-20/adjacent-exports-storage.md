# 第三阶段审查：导出、模板与存储边界

审查范围：本次差异以外的 `album/render.py`、导出服务、背景导出 API 和 storage revision/事务路径；同时检查新模板使用的共同渲染边界。未修改生产代码，未触碰 `data/`。

## 发现

### [P1] 自定义模板可省略 `<head>`，使离线导出缺失 CSP

- 位置：`server/mio_server/album/templates.py:88-101`；`server/mio_server/album/render.py:202-212`
- 触发：通过模板导入 API 提交符合 loop/image 校验、但不含 `<head>` 的 HTML，例如 `<html><body>{{#books}}<main>{{#frames}}<img src="{{image}}"><img src="https://example.invalid/pixel">{{/frames}}</main>{{/books}}</body></html>`。
- 证据：模板 validator 只检查循环、`{{image}}` 和禁止 `<script>`，没有要求 head/body；`_finish` 仅在 `<head>` 匹配时插入 CSP，匹配不到时仍返回 HTML。用上述模板调用 `render_album` 后可复现 `Content-Security-Policy` / nonce 均缺失，而模板里的外链 URL 保留。
- 影响：离线导出安全约束要求每文件都有 nonce CSP、零外链；该路径允许导出的单文件绕开 `default-src 'none'` 等边界。普通自定义模板虽无法直接写 `<script>`，但仍可加载外部图片/样式或形成隐私外联。
- 最小修复：严格要求模板包含且仅包含 `<html>…<head>…</head>…<body>…</body></html>` 结构，或在渲染器检测无有效 head/body 时拒绝渲染；导出后验证 CSP meta、Mio nonce 脚本和闭合边界均存在。增加缺 head / 缺 body / 正常模板回归测试。

## 已检查且未发现问题的边界

- 导出 job 的 `idempotency_key` 在提交层参与幂等回执；文件下载通过 job id 查询导出结果而非用户路径。
- `storage.save_episode(expected_revision=...)` 在事务中检查当前 revision 并写入快照；新增分镜 PATCH 显式传入读取到的 revision。
- 自定义模板用户变量做 HTML 与花括号转义；模板内脚本拒绝；标准模板的 CSP nonce 和 `mio.album-html.v1` 元数据路径存在回归测试。
- 本轮没有改动相关导出 / storage 生产代码；未执行收费生成。
