# 独立文件架构：一次性转换工具

> **Mio 2.0 的显式旧数据转换入口。** 主界面、按文件保存、图片和执行链已经接入 v2。先关闭旧服务，转换到新目录，再让新版 `MIO_DATA_DIR` 指向结果。不要删除旧原件，也不要让旧版服务读取 v2。
>
> [完整启动与使用教程](FILE_LIBRARY.md) · [English](../en/FILE_LIBRARY_CONVERSION.md)

## 它现在可以做什么

- 读取已保存的旧版工作区，输出到一个**从未存在的新目录**。
- 把分镜、角色/场景预设、企划、计划、画册、版式和工作流保存为独立文件。
- 内部角色行、对话和队列快照也拆成单独文件，不留一个新的全工作区大 JSON。
- 把画册及快照引用的图片放入自己的目录。参考图、原图和精修图保持原始字节，不重采样、不重新生成。
- 保留被动 SVG 原图；包含脚本、外链、事件属性、外部实体等内容的 SVG 会被拒绝，不会执行或联网。
- 把识别到的凭据字段移到 `settings/secrets.json`，普通资源只保存空字段和本地引用。
- 保留持久任务、每幕结果、请求输入、幂等标识和删除标记；新目录中的执行器保持暂停。
- 在发布结果前校验资源计数、图片引用和源文件哈希。

这不是下载远端图片、补图或修复缺失数据的工具。遇到缺图、冲突、坏文件或不受支持的路径会停止，不会拿空字段、默认模板或重新生成结果代替。

## 准备

1. 备份旧项目。
2. **关闭旧版服务**，不只是关闭浏览器标签页。工具会检查旧 worker 锁，但这个检查不能代替停止所有可能修改源目录的程序。
3. 选择一个不存在的输出目录。即便目录是空的，也不允许覆盖。
4. 保留足够磁盘空间。转换在输出目录的同级隐藏暂存目录中进行；画册的独立性意味着同一参考图可能分别保存在多个资源中。

当前源码可直接运行，Python 3.10 及以上；转换命令不需要 Node，也不安装图像生成模型。

## 先试转，不发布结果

Windows 示例：

```powershell
python tools/convert_file_library.py --source "D:\Mio-old" --output "D:\Mio-data-v2" --source-stopped --dry-run
```

macOS / Linux 示例：

```bash
python tools/convert_file_library.py \
  --source "/path/to/Mio-old" \
  --output "/path/to/Mio-data-v2" \
  --source-stopped --dry-run
```

`--source` 可以是旧项目根目录、旧 `data` 目录，或一份完整的工作区配置 JSON。它不是单个分镜 JSON；单分镜使用 `tools/file_library.py import storyboards`。

如果配置 JSON 与原项目分开放置，可增加 `--project "/path/to/Mio-old"`，指定旧 `/images`、`vendor`、`examples` 图片所在项目。

试转会真正构建并校验暂存结果，然后删除暂存目录，不发布输出目录。它不是只检查文件名。

## 正式生成独立目录

确认试转无误后，去掉 `--dry-run`，其余参数相同：

```bash
python tools/convert_file_library.py \
  --source "/path/to/Mio-old" \
  --output "/path/to/Mio-data-v2" \
  --source-stopped
```

成功时输出包含：

- `published: true`：校验完成后才发布了新目录。
- `sourceUnchanged: true`：所读源文件哈希及源文件集合检查通过。
- `counts`：按实体类别统计的数量。
- `executionStartPolicy: "manual"`：不会因为转换自动继续执行。
- `guiRuntimeIntegrated: true`：结果可由 Mio 2.0 主程序使用；请用 `MIO_DATA_DIR` 指定它，仍不要覆盖旧原件。

完整报告位于新目录的 `runtime/conversion/report.json`。

## 如何检查结果

```bash
python tools/file_library.py --data "/path/to/Mio-data-v2" list albums
python tools/file_library.py --data "/path/to/Mio-data-v2" list storyboards
python tools/file_library.py --data "/path/to/Mio-data-v2" problems
```

查看某一实体时，把列表返回的 ID 填入命令：

```bash
python tools/file_library.py --data "/path/to/Mio-data-v2" get albums <实际ID>
```

报告中的几个重要字段：

| 字段 | 含义 |
|---|---|
| `excludedDeletedAlbumIds` | 源快照里仍出现、但已被持久删除标记删除的画册；不会复活到新目录的画廊中 |
| `generatedActiveWorkflowResources` | 原来内嵌于设置里的当前工作流，被提取成了独立文件 |
| `runtimeChanges` | 哪些任务从运行/待执行状态变为待核对或暂停 |
| `unassignedAssets` | 未被当前实体引用的图片，保留到运行区；无法安全识别的文件进入非展示隔离区 |
| `retainedOnlyInSource` | 没有转换到新目录的源文件，例如旧格式历史备份、缓存、锁文件或其他未知文件；**仍保留在旧目录，不能据此删除旧目录** |
| `sourceFiles` | 实际读取的源文件及其校验和；没有明文凭据 |

活跃预设和创作计划按原 ID 保存，模板/计划关联不因标题重名被改指向。一般的角色素材默认归入 `characters`；已明确标注 `category: "scenes"` 的素材归入场景目录，不通过标题猜测分类。

## 中断、冲突与安全规则

- 输出已存在：拒绝，包括空目录。校验结束瞬间才出现的同名目录也不覆盖。
- 任一转换步骤失败：正常异常退出会清理暂存目录，不发布半成品。
- 进程被强制终止：可能留下 `.输出名.converting-...` 暂存目录；不要把它当作成功结果，确认转换器已停止后可移除该暂存目录。
- 源文件在转换期间被外部修改：拒绝发布，需要停止修改者后重试。
- 已有配置提交日志：只在新目录解释完整的提交意图，**不回写修复旧目录**。
- SQLite WAL 尚未合并：先复制 DB/WAL/SHM 到私有暂存目录，再在那里恢复；不通过 SQLite 打开源数据库，也不触发源数据库 checkpoint。
- 正在运行的任务：转换为 `unknown`，保持结果待核对；不得静默重发。
- 已删除画册、已移除图片、精修原图和气泡配方：保留相应持久记录，旧生成结果不能把删除和修改覆盖回来。
- 密钥文件及含敏感暂存数据的文件使用限制权限；这是明文权限隔离，不是加密保险库。任意用户文本中的秘密无法可靠自动识别。

## 已执行的验证与限制

除受控 SQLite/文件故障测试外，验证还使用了**实际交付的 1.2.1 ZIP**：启动旧版界面，新建计划、上传图片变量、正常保存，然后停止旧服务进行转换。

已核对分镜、画册、角色、计划、对话、原有五个版式的内容，以及所有嵌入/上传图片的原始字节；旧数据目录中的文件在转换前后哈希一致。

另有真正的 worker 启动测试：打开转换后的执行数据库后，保持暂停，未调用生成函数。

执行环境是 Linux 沙箱、Chromium。Windows/macOS 的发布分支尚未进行原生设备测试；没有真实收费供应商验证。下面保留转换工具的专项验证范围；整应用、实际旧包转新界面及性能验收请见 [2.0 验收记录](../RELEASE_CURRENT.md)。
