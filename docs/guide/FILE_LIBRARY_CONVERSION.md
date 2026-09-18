# 旧数据转换

将旧的聚合工作区转换为独立文件工作区。

## 准备

1. 备份旧项目，停止旧服务。
2. 选择一个尚不存在的输出目录，其父目录须已存在。
3. 确认磁盘空间足够存放工作区和图片副本。

## 运行

先检查转换结果：

```bash
python tools/convert_file_library.py --source "/path/to/Mio-old" --output "/path/to/Mio-data" --source-stopped --dry-run
```

检查通过后，去掉 `--dry-run` 再运行一次。

`--source` 可填写旧项目目录、数据目录或完整配置 JSON。配置 JSON 位于项目之外时，加上 `--project "/path/to/Mio-old"`，用于定位原图。

Windows 可使用带引号的本机路径。转换需要 Python 3.10+。

## 查看结果

```bash
python tools/file_library.py --data "/path/to/Mio-data" list albums
python tools/file_library.py --data "/path/to/Mio-data" list storyboards
python tools/file_library.py --data "/path/to/Mio-data" problems
```

转换报告位于 `runtime/conversion/report.json`，包括资源数量、原图检查、执行状态和保留在旧目录中的文件清单。

将 `MIO_DATA_DIR` 设置为输出目录，启动 Mio。检查画册、分镜、预设和图片后，再继续编辑；保留旧备份。

缺图、损坏资源、重复 ID 或输出目录冲突时，按报错修正后重新运行。

[文件工作区](FILE_LIBRARY.md) · [English](../en/FILE_LIBRARY_CONVERSION.md)
