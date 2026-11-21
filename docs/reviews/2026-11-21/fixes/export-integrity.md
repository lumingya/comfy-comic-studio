# R1-EXP-01：完整构图导出修复

范围：保存画布的 HTML、portable PDF / ZIP 与连续 PNG / 切片一致性。采用规划 A 的全宽安全分带，没有用文案或额外附件代替正文。

## 原红与中性复现

全部夹具在 TEMP 建立，素材为中性色块，未读取个人 data、运行模型或调用付费服务。

`test_review_export_integrity` 的两格夹具保存 `400 × 3500` 画布，逻辑先格放在 `y=2100..2300`，后格放在 `y=100..300`；独立 `INTERLUDE` 在 `y=1000..1060`，保留末尾空白。修前真实 HTML 的首幅导出图宽仅 200，拼回全宽断言为 `200 != 400`，未覆盖文字区域。另在独立模块中加载 HEAD 的原 `album/build.py` / `pipeline/file_export.py`，不覆盖工作区文件，实际得到：

```text
baseline pages: [(200, 200), (200, 200)]
baseline PDF MediaBox: [0 0 150 150], [0 0 150 150]
baseline combined source coverage height: 400
required saved composition: 400 x 3500, INTERLUDE box y=1000..1060
```

这两幅单格图只包含各自格的取景，格间正文与 3100 行其余画布未进入产物。原审查的完整 API 对照另见 [SPEC-02](../round-1-changes/spec.md)。

## 实质修改

- `pipeline/export_composition.py` 生成全宽、按视觉 y 递增且严格覆盖 `[0,H)` 的分带；单带最高 1600 行。优先使用不经过字形 / 尾线 / 旋转 SFX 保守边界的切点，超大层无法避开时硬切，像素接缝仍保留。重叠格保持现有绘制顺序，逻辑格排序不再作为裁切覆盖范围。
- `album/build.py` 的默认输出在保存几何 / 文字存在时使用该分带，首尾、格间空白、未绑定正文、跨格文字与仅文字画布一并渲染。没有保存构图或 `lettered=false` 时，导出完整采用原图，不按默认格比例额外裁切。单格阅读契约仍可显式使用内部 `mode="panels"`。
- v1 保留 `books/album/steps`、连续 `stepIndex`、`$mioImage` 及真实编码图片尺寸；加性 `album.composition={width,height}`、`step.sourceRegion=[0,y0,width,y1]`。每话仍是一个 book，模板的图数、目录与进度按分带数计算，补充台词每格只归属一个带。
- 原生 HTML 逐带编码到临时文件，模板先处理短 token，随后按 48 KiB 原始块写入 base64；不会累计整话的图片 bytes / base64。保留原有模板渲染、nonce CSP、目录、单双页、灯箱及焦点运行时。
- clean / archive PDF 的图片改为逐 64 行压缩到临时文件的 Flate RGB 流，不再重新 JPEG 化。publish PDF 才使用显式 JPEG 分支。现有连续 PNG 与切片使用相同区域渲染器。
- `album/media.py` 对预览缩放结果保留最少 1 行：`800 × 1` 尾带缩至 320 / 400 宽时不会因 `round()` 得到 0 高而失败，原始 `sourceRegion` 不变。
- `regions.py` 保持 FreeType 的全局小数相位；`lettering.draw_layer(origin=...)` 在全局坐标取整后再平移气泡框 / 尾点，且保留原始浮点宽度用于折行。旋转 SFX 的 sprite 原点也先在全局取整。独立复审发现的 `.5` 坐标与奇数带起点反例由此修复，默认原有完整画布调用不变。
- `importer.py` 仅在加性元数据构成完整、连续、全宽分区、图片齐全，每带声明宽高与实际图片一致，且实际图可由该源区域统一缩放得到时恢复无缝栅格 strip。缩放检查为 `actual_h == max(1, round(source_h * actual_w / source_w))`，保留合法预览薄带的最少 1 行。显式 `Strip.rasterized=false` 默认字段标记已烘焙构图，导入值为 true，避免再次添加标题、尾标与 END_SPACE。不将此表述为恢复可编辑文字 / 原始格层。非法、重叠、缺段 / 缺图、声明尺寸不符或缩放比例不符的元数据继续走普通严格导入。末尾可仅有 1 行：只有整套构图通过上述验证，`convert_frame` 才收到显式 `rasterized_band=True`，允许仅回退带的逻辑 Panel 比例；实际图片尺寸、源区域及 box 均不变。普通旧分镜 / 画册始终保留原来的非法比例拒绝语义，`ratio_of` 不作全局放宽。

## 回归与独立验证

新增 `server/tests/test_review_export_integrity.py` 的 16 项测试覆盖：

- 中性 INTERLUDE、首尾 / 格间留白的实际 HTML 与 PDF 像素拼回；ZIP、PNG、同宽无损切片逐像素对照。
- 倒序、重叠、跨边、尾线、旋转 SFX、超大文字硬切、仅文字画布，以及没有保存构图 / 明确原图输出。
- clean 与 archive HTML / PDF 无损分支；publish / preview 只校验编码、真实尺寸与源覆盖，不作有损字节相等断言。
- v1 图片解引用 → 目录格式导入 → 精确重建 → 再导出；非法交叠分区拒绝取得 rasterized 语义；`H=3201` 的最后 1 行往返仍逐像素保留。
- 薄带逻辑比例例外只授予完整、真实图片支撑的 composition；缺少 composition、缺 sourceRegion、缺段、缺图、声明尺寸不符五种反例继续拒绝，合法 `400 × 1` 构图仍通过。
- 实际 PNG 与声明均为 `1 × 100`、却伪造 `400 × 1` sourceRegion 的覆盖反例仍拒绝，并保留旧作品、话与资产元数据；合法 `800 × 1` 尾带预览至 320 / 400 宽的实际 HTML → v1 → 目录导入仍保留源坐标及高度。
- 100000 行 HTML：原生路径的 Frame 只持文件 token，像素分配不超过单源 / `400 × 1600` 单带上界；完成或编码阶段取消后 spool 全部删除，受控输出 partial 删除。
- speech / thought / caption 的全局 `.5` 框与尾线、奇数 1551 原点、真实 512 行 PNG 和奇数 album 分带，以及 SFX 小数中心的全局像素网格。

现有阅读回归保留独立单格裁切 / 字框外扩断言，并显式选择内部 panels 模式；默认导出与 API 断言改为完整画布。没有删除不丢内容、像素或取消断言。

相关后端主批 123 项全部通过（`test_review_export_integrity`、`test_reading`、`test_region_export`、`test_album`、`test_album_matrix`、`test_export_jobs`、`test_bundle_import`、`test_assistant_trash_import`；80.571 秒）。收口自查追加 1px 尾带红测并修复后，只重跑该新增用例及受影响旧导入两模块，14 项全部通过；独立复审追加 preview 窄尾带边界后，新增 API 回归与受影响 `test_album` 共 21 项全部通过。Python lint / 编译、格式、UTF-8 与 `git diff --check` 检查通过。全仓门禁、生成契约与提交由主控统一执行。

全新复审者 `verify_export_fixes` 独立复跑 `.5` / 奇数原点反例：speech、thought、caption、SFX 横 / 竖八组均为 0 像素差异。其真实已安装 Chrome 157 在三套新 HTML × 1440 / 390 px × 浅 / 深十二组中验证目录、单双页、灯箱、Tab 焦点及恢复、无横向溢出，控制台零错误；没有安装浏览器。完整独立结论由该代理另行记录。

该复审者另外独立完成 `800 × 3201` clean / preview 320 / preview 400 的尾带编码，以及实际 HTML API → 解引用 v1 图片 → 真实目录导入 → 再导出，均保留 rasterized、3201 源高度和最后 1 行；clean 全图 0 像素差异。

### 全量复审捕获的普通导入回归

主控全量 1559 项发现本修复曾把 `ratio_of` 的超范围比例全局回退为 `2:3`，使普通旧分镜 `width=1,height=100` 不再触发模型拒绝，导致四个真实导入事务保护回归未抛 `ValueError`。已首先原样复跑以下四个断言，全部红：

- `test_other_engine_review.LegacyOverwriteReviewTests.test_failed_album_overwrite_keeps_existing_work_and_episode`
- `test_other_engine_review.LegacyOverwriteReviewTests.test_failed_project_overwrite_keeps_existing_episode`
- `test_other_final_recheck.OtherFinalImporterTests.test_run_late_failure_rolls_back_album_recipe_and_asset_batch`
- `test_other_fresh_recheck.OtherFreshImporterTests.test_failed_album_overwrite_does_not_publish_asset_metadata`

纠正为上文的严格例外：恢复普通 `ratio_of`，先校验完整分区并逐张载入图片、只保留资产元数据，确认声明尺寸对应实际图片后再创建 rasterized Panel；没有读取整套图片到内存。四个旧断言保持原样，新测试另外封住伪造 / 不完整 metadata 不能取得例外。仅集中重跑四个失败、15 项导出及受影响旧导入模块，共 32 项全部通过（21.790 秒），不重复已通过的整批 123 项。Python lint、格式及 UTF-8 检查通过；全新复审者仅需再核对普通坏比例拒绝与合法薄带正例。

同一独立复审者随后用实际 PNG `1 × 100`、声明 `1 × 100`、伪造 composition `400 × 1` / sourceRegion `[0,0,400,1]`，确认只对照声明与实际尺寸仍可取得例外。新增真实旧作覆盖回归先红（`ValueError not raised`）；最终追加上述源区域统一缩放关系校验后，该输入拒绝且原 series / episode / asset_ids 全部保持。只重跑旧四项、新伪造覆盖、严格例外、clean 1px 往返、实际 preview 320 / 400 HTML 往返与正常 v1，共 9 项全部通过（6.459 秒）；没有重新跑 123 项或扩展抽象。同一复审者仅需用原输入再次窄验。

## 明确边界

- 逐像素相等针对同宽 clean / archive 的栅格 composition；preview / publish 是有损 / 缩放档，不能据此宣称像素字节相等。
- HTML `auto` 仍遵守既有 512 MiB 内联预算：先 clean，超预算重建 publish，并在统计中返回 `auto_compressed`。明确 clean / archive 不触发此降档；portable auto 为 clean。
- 内建文件 writer 的内存不随整话高度增长；仍保留单源图 / 缩放格及单个文字层开销。旧式自定义整 HTML exporter、第三方整图 layout 保留其既有契约，不冒称这些扩展也获得有界内存。
- 栅格往返恢复保存构图与连续像素，不恢复原始可编辑层；缩放 / 有损产物重建保留源范围与坐标，无法恢复已丢弃的原始采样。
- 仅执行中性离线生成、临时工作区、真实本机浏览器检查；无真实云端、ComfyUI、收费 API、个人素材或物理断电测试。
