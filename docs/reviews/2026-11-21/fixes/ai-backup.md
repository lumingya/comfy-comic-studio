# SET-AI-01：真实附件上传后的工作区备份修复

范围：`extensions/ai-assist/core/attachments.py`、`core/service.py`、`core/backup.py` 与新增 `tests/test_review_attachment_backup.py`。不修改扩展页面、宿主路由或附件保留策略；提交与推送由主控整合执行。

## 原始红回归

新增用例通过真实 `AppContext` / `TestClient` 开启 AI 扩展，在内存生成 1×1 中性 PNG，并调用 `POST /api/ext/ai-assist/attachments`。所有运行数据均在 TEMP，`autostart=False`、`seed_instance=False`，显式设置 `ctx.legacy_root` 为 TEMP 空目录。

```powershell
$env:PYTHONPATH='server'
python -m unittest tests.test_bundled_extensions -k test_real_upload_backup_inspect_restore_and_restart -v
```

修复前：1 test / 1.909s，`FAILED (failures=1)`。真实上传返回 201，当前附件 URL 可读取原 PNG；随后 `GET /api/backups/head` 返回 400：`AI assistant attachment metadata does not match its image`。

三个候选原因按现有证据排序为：上传与备份 URL 契约分叉、上传元数据尺寸不符、备份参与者加载旧代码。上传实际返回值及源码表明，生产者使用 `/api/ext/ai-assist/attachments/{id}`，校验者仅接受 `/api/ai-assist/attachments/{id}`；无需请求模型或创建对话即可触发。

## 修复规则

- 当前规范 URL 统一由 `core/attachments.py:attachment_url()` 生成，真实上传和备份校验共用此规则。
- 备份仅额外接受精确绑定当前附件 ID 的旧数据别名 `/api/ai-assist/attachments/{id}`。不接受 origin、query、fragment、其他 ID、`v2` 变体、路径遍历或尾斜杠，不增加任何 HTTP 兼容路由。
- 旧备份不批量迁移或改写元数据文件；磁盘字节、归档摘要和 head 的一致性语义保持原样。运行时 `service.attachment()` 对这一个合法旧别名返回规范当前 URL，恢复重启后该 URL 通过真实 GET 读取原 PNG。现有页面同样按 ID 构造当前附件 URL。
- 原有成对文件、ID、大小、受支持 MIME、引用关系、JSON、路径、归档摘要、凭据剥离和大小预算校验均保留。上传的 Pillow 类型、像素上限与图片完整性校验未改变。
- 备份复制仍经 `shutil.copyfile`，没有引入图片整文件读取；用例对 `Path.read_bytes` 设置失败哨兵，验证复制路径不调用该方法。

## 集中验证

```powershell
$env:PYTHONPATH='server'
python -m unittest tests.test_bundled_extensions tests.test_backup tests.test_backup_catalog tests.test_backup_participants tests.test_backup_extension_data tests.test_backup_path_aliases tests.test_backup_ui_data tests.test_backup_themes -k backup -q
python -m unittest tests.test_bundled_extensions -k test_upload -q
ruff check extensions/ai-assist/core/attachments.py extensions/ai-assist/core/backup.py extensions/ai-assist/core/service.py extensions/ai-assist/tests/test_review_attachment_backup.py
ruff format --check extensions/ai-assist/core/attachments.py extensions/ai-assist/core/backup.py extensions/ai-assist/core/service.py extensions/ai-assist/tests/test_review_attachment_backup.py
python tools/generate_extension_contracts.py --check
python C:/Users/QIU/.codex/skills/utf8-text-guard/scripts/text_guard.py check extensions/ai-assist/core/attachments.py extensions/ai-assist/core/backup.py extensions/ai-assist/core/service.py extensions/ai-assist/tests/test_review_attachment_backup.py
git diff --check -- extensions/ai-assist/core/backup.py extensions/ai-assist/core/service.py
```

集中备份测试：84 tests / 97.891s，`OK (skipped=1)`。唯一跳过为本机不能创建目录 symbolic link；同模块模拟 Windows reparse 标记的拒绝分支实际执行通过。新增 7 个用例全部执行，无跳过。

运行时附件元数据规范化还会经过模型图片内容与实际素材 API 的调用路径，因此额外运行对应两项既有上传用例：2 tests / 5.293s，`OK`，模型使用固定假服务。没有重复已经通过的备份测试。四个 Python 文件的 ruff、format、UTF-8 检查通过，扩展桥契约 `up to date`，差异空白检查通过。

额外运行 `python clients/python/generate.py --check` 返回 `out of date: openapi-v2.json`。本修复没有路由、请求或响应 schema 改动；共享工作区正并行修改 API，由主控集中核对和重新生成，未在本子任务中写生成物。

新增 7 个回归覆盖真实上传、head / export / download / inspect / stage / apply / 重启；恢复后原附件可读且备份后的新附件消失；无附件工作区；精确旧别名往返及返回 URL；恶意 URL；重新计算归档 entry hash 后的错误 ID / 大小 / MIME / token query；流式复制与单文件 / 总预算上限；两种 URL 下的 metadata 凭据拒绝与显式包含凭据。

## 边界

没有调用真实模型、外部网络、ComfyUI 或付费服务，没有安装浏览器或运行 E2E，没有读取个人运行配置或复制整个 `data/`。旧别名测试验证的是受支持历史数据的严格读取，不承诺任意旧版本迁移。没有把删除对话后的附件保留观察升级为缺陷，也没有增加附件级联删除或 GC。
