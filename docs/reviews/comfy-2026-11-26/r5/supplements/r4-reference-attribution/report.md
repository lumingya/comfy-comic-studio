# R4 三项图片 BindingError 的既存证据归因

本项仅纯文件读取与源码静态核对，不是新盲测、产品重放或安全边界认定。历史执行源码为 `ed45509456b14006161d829666c466789e6a9e37`；原三项自动期望及原 47 分母均保持不变。

**三项异常都不是 harness 图片资产格式不合法。** 私有原始错误精确匹配固定“工作流里没有 [mio:init/ref] 输入节点，无法接收图片”；两项 init 的错误 SHA 为 `67d1aeaf22889a2699a6b95725bf0c12e015829206596e95245c92c47dec2223`，ref 为 `dc6a2656a19f863f3f88dc8729f8caaa2e166ed3cca68f361dd885f1920a560c`。保存的 baseline 也没有相应 kind 绑定。该消息说明自动编译结束时没有匹配 kind/qualifier，不能改述为错误写到了其他图片目标。

| 原样本 | 请求 | 原期望目标 | 自动结果归因 | 既有显式 mapping 证据 |
|---|---|---|---|---|
| r4b-01 | init | `/37/inputs/image` | 缺少该 kind 的自动绑定 | 原值写入成功、整图符合原组合 oracle |
| r4b-02 | init | `/38/inputs/image` | 缺少该 kind 的自动绑定 | 原值写入成功、整图符合原组合 oracle |
| r4b-09 | ref | `/95/inputs/image` | 缺少该 kind 的自动绑定 | 原值写入成功、整图符合原组合 oracle |

原 harness 把 oracle 中同一个单键 asset placeholder 对象原样交给自动与组合 mapping 调用；已核对对象仅有 `$asset` 一键且值为字符串，符合 compile.asset_value 的表示。既有 manual_compiled 已证明三个 placeholder 都可通过编译合同，目标分别解析为 37.image、38.image、95.image（mapping），目标值与原请求 typed-equal，且所需 asset ID 进入保存的 uploads。三个组合请求整图均符合原 oracle、无 mismatch、warnings=0，manual 文档及原文档末态均保存为未变。组合请求还改了其他原计划字段，因此不能把它冒称三次独立 image-only mapping 实测。逐项中性类型、值哈希、绑定、组合完整 delta 指针均在 results.json。

静态调用合同：compile.py:81–108 只包装/发现 asset placeholder，不验证资产存在性；bindings.py:312–326 对匹配绑定的非 None 值写入副本；render_models.py:23–27、74–84 的 values 为任意 object。compile.py:245–247 默认推断集合没有 init/ref/mask/control；:325–342 在最终绑定缺少图片 kind/qualifier 时抛上述 BindingError。BindingError 是 ValueError 子类，无固定结构化 code。显式 mapping 仍走相同值写入路径（compile.py:218–243；bindings.py:179–214），并非通过更换图片参数类型绕过错误。

**仍不据此认定 safe boundary。** 自动异常未返回 Compiled，原 warning 列表、完整结果 delta、effective targets 仍为 unknown/null；原 harness 在 except 分支硬编码 boundary_visible=True、has_unexpected_write=False，不能把它们当作产品警告或空 delta 证据。当前只能确定“缺自动图片绑定”，而非“缺合法图片资产”或已证实的目标误写。原自动图片期望是否属于产品应覆盖的合同，交由根部审定，不能改 oracle 或自动计为通过。

完成本次归因不需要新增产品请求。若根部仍要求隔离后的完整 delta，可按 results.json 中预先写明的最多 3 原请求 + 3 同目标单项 mapping 计划另授租约；当前未授权、未执行。编译接受也不等于资产上传或真实出图验证。

8 个明确白名单输入文件前后 SHA 均一致；纯文件 PID 49976，CPU 0x1/BelowNormal16384 读回；Mio import、产品、HTTP、测试、子进程均为 0。新目录之外未写入。

- results.json SHA256：fad648d7294317999f4696b5c3e44206d4f3daca66ac657a98be582558901c5f
- provenance-safe.json SHA256：26c8198dc816c85c93bff42e749699a8effcdf346195cecb1ab7096f83d1ccf5
