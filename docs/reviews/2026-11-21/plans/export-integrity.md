# R1-EXP-01：完整构图导出规划

目标：默认成品完整保留保存画布；不以改文案或给正文另加附件代替修复。

**A（首选）全宽安全分带。** 共用冻结 composition；保存几何/文字存在时，HTML、portable PDF/ZIP 与长图/切片均从 `render_region` 读取。纵向分区严格覆盖 `[0,H)`，全宽、不漏不重；优先避开字形、尾线与 SFX，无法避开时硬限分带并保证接缝像素。按全局 y 排序，不按 panel 顺序裁图；重叠盒按现有绘制顺序，首尾边距、纯空白带、尾留白及纯文字画布均保留，不自动重排或重新嵌字。

**B 单话单长图 frame。** 流式 PNG 落盘再流式嵌入 HTML；PDF/切片仍消费相同 composition。v1 每话一图，改动面小，但灯箱解码巨图、超长尺寸限制及章内翻页退化，不宜默认。

两案均让 `auto` 在无保存构图时输出完整原图，不调用比例裁切；旧逐格模式仅显式选择。`lettered=false` 继续明确输出原图。默认行为变化须替换现有“未保存也自动取景”的回归。

v1 保留 `books/album/steps`、`$mioImage`、连续 `stepIndex` 与真实图片尺寸；A 每带一 step，命名“画布第 n 段”，图数/进度按带数，每话仍一 book。可选坐标扩展支持精确拼回；补充台词仅归属一次。三模板不裁带，保留目录、单双页、灯箱与焦点交互。当前往返测试只验证图片解引用；旧目录导入将 step 变 panel，须识别扩展恢复无缝 strip，不能声称已能恢复编辑层。

像素内存限单源图、单带及单字层；HTML 也需文件 writer，不能继续累计全部 bytes/base64。`clean` 的 PDF 改无损 Flate；PNG/同宽无损切片/HTML/PDF 拼回逐像素相等。缩放与显式有损档只允许改变采样/编码，不改覆盖与坐标。

最小 ownership：一名 worker 负责共享计划、`album/{build,render}.py`、`exporting.py`、`pipeline/{regions,file_export}.py`、`importer.py`；API 增模式则同步生成契约。回归入口：`test_region_export`、`test_reading`、`test_album`、`test_album_matrix`、`test_export_jobs`；覆盖缺陷样例、空白/跨格/倒序重叠、未保存原图、v1 拼回、三模板交互及长篇分配/取消清理。仅 TEMP 中性夹具，不碰用户数据/真实服务。

```python
Composition(mode="saved" | "original" | "panels", width=..., height=...)
Part(index=..., source_box=(0, y0, width, y1), panel_ids=...)
iter_parts() -> Iterator[Part]  # lazy pixels; encoded assets spool to disk
render_part(part, width=...)   # existing global sampling grid + halo
# v1 additive metadata; legacy readers may ignore it
album["composition"] = {"width": W, "height": H}
step["sourceRegion"] = [0, y0, W, y1]
```

依据：`album/build.py:161–176`、`pipeline/episode_strip.py:60–74`、`pipeline/file_export.py:60–94`、`exporting.py:435–576`、`album/render.py:248–271`、`importer.py:337–357`；现有原图/自动取景冲突见 `test_reading.py:317–339`，v1 往返断言见 `test_album_matrix.py:121–149`。
