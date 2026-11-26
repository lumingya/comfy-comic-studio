# Civitai 原 35 行：只读文件存在性与首批恢复建议

本阶段只有原 manifest 与 R6 安全元数据两个内容来源；只对 manifest 已明示的精确路径做存在性/size/mtime 检查，没有读取或散列任何图文件，没有扫描其他目录、联网、Mio、测试或修改旧数据。

35 行共 34 来源：**10 份登记 JSON 文件仍存在，25 行无登记文件路径，涉及 24 个唯一 missing 来源**。10 份既存文件都有历史完整 raw/recovered/canonical SHA；当前只确认路径和文件 metadata，未重算字节 hash。25 行均没有历史完整 raw/canonical SHA，只有 12hex 身份前缀。该前缀在 10 个有完整记录的行上全部匹配 canonical SHA 前缀，raw SHA 前缀匹配为 0，不能把它当原序列化字节 hash。当前原字节一致性没有在本阶段重新验证。

JSON 声明的 3 个来源：

| 来源 ID | 原登记文件 | JSON entry 数 | 元数据 file type |
|---|---|---:|---|
| 1621455 | 已有登记文件 | 1 | Config |
| 2503119 | 原missing | 2 | Config |
| 2539304 | 原missing | 1 | Config |

1621455 已有文件；**2503119、2539304 是原 missing**，可作为最小首批两来源候选。JSON 的 file type 为 Config，可能只是配置，必须读到正文并通过静态图结构检查才能算有效图。

R6 已枚举的 31 个来源共 169 个 file entries：扩展名计数 `{"json": 4, "zip": 165}`，file type 计数 `{"Archive": 165, "Config": 4}`。所有 31 个来源都有 ZIP 声明，3 个还有 JSON 声明；PNG/WebP 声明为 0。原 missing 中已枚举的 23 个唯一来源共 137 entries：扩展名 `{"json": 3, "zip": 134}`，type `{"Archive": 134, "Config": 3}`。这些都只是文件声明，不能证明 URL 可达、可匿名下载或文件内含有效静态图。1215102 只保留上一阶段成功引用，未保留 extension/type 计数；21100/1466666 的旧 HTTP403 保持不重试，其中 1466666 是 missing。

建议等待根部 GO 后，固定按 **2503119 → 2539304**，每源一次 metadata GET、至多一次 JSON 文件 GET，总上限 4 GET，串行、不重试、不改选其他来源。metadata 用现有 16KiB chunk /512KiB cap；JSON 文件采用 16KiB chunk /2MiB cap 与 35秒总截止。只在新单次响应仍声明 Workflows + JSON/Config、公共数值 version/file IDs 后，按最小数值 (version ID,file ID) 固定选一项；文件失败、重定向、超限、格式错误或仅配置时即停止该源，不试下一文件。无 Cookie/token/登录/挑战。

仅 JSON 是该首批候选格式。action-plan.json 同时列明后续 PNG/WebP/ZIP 的 magic、大小、metadata 解压与 archive 成员限制；它们不在本批下载提案中，不自动解压模型或执行任何内容。未知二进制、模型权重和可执行内容一律拒绝。

即使取得同来源的有效新图，因原 missing 没有完整 raw hash 或历史 version/file ID，也只能首先记为**独立补充**。原 current75、基线、原 35 行与所有历史真值/分母保持，不能据此改写旧 missing 或冒称原字节恢复。具体逐行身份 hash、已保存 hash 层级、路径存在性结果和预先固定的文件选择规则见 action-plan.json。

来源前后两个 SHA 与全部已声明路径 stat 均保持一致。action-plan.json SHA256：`a9dba5c76af313d428d75b3780af6d94035e4a86e308cd397f609b62e3a83edc`。

状态：**只读计划已准备；未授权或执行任何新网络/产品调用。**
