# R5 失败审查轮安全归档

**固定 fa 候选：REQUEST CHANGES。本轮不能签 PASS。** 五个角色的独立首版及交叉终态保留各自封存身份；本包只做外部安全出版，不是第六位审查，也没有执行产品、测试、浏览器或网络查询。

候选为 `fa6308384826fad7629b2c727d70230cc7951d05`，全任务基点为 `38838ab43cf3d056951f2fc6c52afb737d34e3c6`。本包包含 26 份明确白名单证据的发布副本，以及本索引和 [出版 manifest](manifest.json)。原始首版、交叉报告、终态及 seal 均未改写。原 seal 中的 SHA 继续指向原始来源字节；发布副本的 SHA 另列，不能混作同一字节身份。

## 精确文件入口

| 角色 | 首版 | 交叉 | 终态与封存 |
|---|---|---|---|
| Generality | [report](generality/report.md)、[initial seal](generality/initial-seal.json) | [cross](generality/cross.md) | [final](generality/final.json) |
| Compile | [report](compile/report.md)、[initial seal](compile/initial-seal.json) | [cross](compile/cross.md) | [final](compile/final.md)、[cross seal](compile/cross-seal.json) |
| Blind | [report](blind/report.md)、[initial seal](blind/initial-seal.json) | [cross report](blind/cross-report.md) | [final](blind/final.md)、[cross-final seal](blind/cross-final-seal.json) |
| Web | [report](web/report.md)、[initial seal](web/initial-seal.json) | [cross](web/cross.md) | [final](web/final.md)、[cross seal](web/cross-seal.json) |
| Privacy | [report](privacy/report.md)、[initial seal](privacy/initial-seal.json) | [cross report](privacy/cross-report.md) | [final](privacy/final.md)、[cross seal](privacy/cross-seal.json)、[过程补充](privacy/cross-process-supplement.json)、[补充 seal](privacy/cross-process-supplement-seal.json) |

未存在的候选文件名记录在 manifest；没有为补齐格式而伪造角色文件，也未读取它们引用的私有或其他机器记录。

## 两项独立 Medium，各计一次

1. **R5-BLIND-M1：合法空文本及配对文本字段的人工恢复候选发现不完整。** 空正负文本的精确显式映射可以编译，但候选诊断没有提供实际文本恢复目标。前端通用字段下拉仍可手选，不能扩大为完全无法接管；编译通过也不能反证候选发现完整。
2. **R5-BLIND-M2：普通 resize／preprocess 多跳图像链的人工角色提示丢失。** 源图像与用途消费者之间隔有普通处理节点时，base/init/control 等角色未传播到候选报告；独立源被压成通用参考展示，用户需自行推断角色并增加参数。精确 mapping 无损不等于发现与引导没有体验缺口，也不要求对任意未知变换作自动恒等改写。

多个角色对同一根因的交叉确认不重复计数。两项 Medium 均是该固定 fa 的未修发现，足以打回整轮；Compile 和 Generality 不另增加重复产品 Medium。CI 的固定 push/PR merge 绿灯不能覆盖这两个问题。

## 实测分母与证据限度

- Compile 的 27/27 声明案例、173 处 typed delta 及其图/闭包/连接/源文档检查保留；这些显式编译案例不能替代空文本或间接图像角色的候选发现覆盖。
- Blind 的 API 导入、editor-only 指引、自动状态、去除 no-op 的真实写入、显式 mapping、缺失字段和输出手选边界按原表分别记账，不把 12 个新样本改成 12 个自动成功，也不改 frozen oracle。
- Web 原始 **112/136** 通过与 **24 条 strict 哈希失败**不变。离线核查范围仅为已有的 **12 份导出**，每份两个字段 `/5/inputs/cfg` 与 `/5/inputs/denoise` 发生数值相等的整数值浮点表示归一；这支持有限 Low 分类，不能改记 136/136、放宽后端 typed 合同或宣称原 JSON 数字词法/字节级保存。
- Web 单次普通动作 `1125.23 ms` 仍是包含定位、滚动及可操作性等待的有界观察，不是渲染基准。Web 两项 Low 与历史文档的一项 publication Low 分开；三个历史文档重复同一个合成标识，只是一项 publication Low，不是三项新缺陷。
- 历史缺失原件、私有 138 完整编译的前端状态边界、空标签不能代替标签回归、巨大图与真实长链等未测范围均按原报告保留。本包没有补读或重测来填这些缺口。

## 三次过程输出事件分开保留

| 独立事件 | 已披露事实与后续限制 |
|---|---|
| Privacy 首版的差异显示 | 遮罩遗漏了基点夹具中无扩展名标识；停止原文显示、披露并改用类型/长度/hash 投影。 |
| Generality 首版的完整差异显示 | 显示了既有受控夹具标识及文本片段，终端输出截断；未独立证明标识现实归属，不能据可见范围清除未知截断内容。 |
| Generality 交叉的嵌套请求序列化 | 一次终端事件显示三个预冻结中性请求块，分别 11、11、12 条，共 34 条；类别包括审查者中性文本、合成图片标签、普通采样项、数字与 pointer。随后停止私有样本、oracle 和结果读取，后续只用明确公共白名单。 |

可见已报告输出未观察到凭据，不等于未知或截断内容已证明无敏感数据。三次过程事件不同于历史三文档标识的 publication Low，也不自动证明三项新产品隐私缺陷或原用户私图泄漏。本包只保存披露及计数，不重放任何事件原值。

## 审查后独立修复引用

主控后续通知：提交 `dc5e045` 与 `7a77d34` 已对历史三个文档各一处合成资产名作独立机械脱敏；证明文件为仓库相对引用 `docs/reviews/comfy-2026-11-26/r5/synthetic-asset-redaction.json`，通知的 SHA256 为 `41b667faec7b14f0d83353b1e66ed1aafd8e89175c591f25d0446ac052988fb8`。主控报告已区分原工作区 CRLF、after raw、旧 Git blob SHA 与实际发布 LF blob SHA，并读回三份 Git blob。

这是审查封存之后的独立修复引用，来源为主控消息。本组包没有读取该非白名单文件或查询 Git，不验证其当前仓库状态，不将其写回旧报告，更不把该 Low 后续修复改述为固定 fa 当时已经通过。

## 安全出版与后续要求

源文件只来自上述 26 项，不包含 product-private、私有 oracle、original、raw、截图、未知 JSON、脚本或日志。图/截图文件名仅在发布副本化为中性引用；安全 seal 的 `name` 字符串只保留 SHA 投影。公开来源 URL 如含账户/原文件名也仅保留整条 URL 的 SHA。所有原名映射不带入本包。SHA、数值、case 标识、代码相对路径及必要 JSON pointer 字符串保留；未读取其指向的非白名单文件。

副本统一 UTF-8 无 BOM、LF、末尾单换行；manifest 记录每份原/发布 SHA256、计算 Git blob SHA1、机械脱敏类别和数量、原件未改检查、递归禁键及路径/资产/秘密/链接检查。仅核查包内实际存在链接；非本包引用不伪称已归档或已验证。manifest 自身 SHA 在交接消息单列。

后续修复必须形成新的候选身份，完成所需完整门禁，并重新进行五位全新上下文的完整审查及交叉核验；不能继承本轮的局部通过拼出全 PASS。最终素材清理、工作区保全比较、交付提交与推送及其最终实际 checkout CI 仍需独立证据；本包未签完成。
