# 第三阶段相邻文件审查：API 安全边界

范围：本次未修改的 `server/mio_server/auth.py`、`api/guard.py`、`api/v2.py`、`api/operations.py` 及其 scope / guard / operation tests。未触碰 `data/`。

## 结论

未发现 P0-P2 缺陷。

- `required_scope` 的 render/admin/read/write 分支覆盖新增工作流 LoRA 查询、分镜 / 预设 CRUD；`test_api_v2.py` 已包含新增路径的 scope 表和匿名 / read / write 对抗。
- `api/v2.py` 在除 `/meta` 外的 OpenAPI 路径统一写入 bearer security，并对全部 router 使用 `Depends(token_of)`；扩展路由另由声明 scope 校验。
- `LocalGuard` 对 `/api` unsafe HTTP 与 WebSocket 做 Host、Origin、Sec-Fetch-Site 校验，明确排除 `/api/v2`；`test_guard.py` 覆盖跨站写、DNS rebinding、允许主机、Vite 代理、WebSocket 和扩展安装。
- `OperationRoute` 在认证 / 校验依赖之后捕获扩展包装链，限制 `next` 只能调用一次且不能替换 ctx；operation extension tests 覆盖启停、摘要和来源回退。

## 边界

- 未修改的 scope 表仍采用“GET 一律 read、未命中 render/admin 的写方法一律 write”默认策略；这符合当前路由分类，后续新增特殊 POST 必须同步加入正则和 scope 测试。
- 未模拟真实反向代理的 `root_path` / Host 重写组合；现有测试覆盖显式允许域名和本机代理场景。
- 任务书尚未实现的任务编排 / deliverables、workflow-slot adapter 契约不属于本相邻文件安全缺陷，已保留在规格审查报告中。
