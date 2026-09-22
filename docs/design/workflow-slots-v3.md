# 工作流语义槽位 v3 方案 · 「基础、诚实、可兜底」

> 定位：替代 v2 文档。目标不是覆盖所有 ComfyUI 生态，而是**只写能证明的地方、写不了就明说、留一个人工兜底**。
> 依据：仓库内 50 个样本 + 站外 36 个高复杂度工作流的实测（见 `validation/` 两份报告）。

---

## 1. 目标与边界

### 1.1 必须达成
1. 修掉两个真 bug：多个同文件底模只换了一个；LoRA 中继（`loaded_loras → lora_syntax`）写不进去。
2. **永不"看起来成功、其实无效"**：写不到的地方一定出现在计划里并给出原因；死分支、无应用点、外星生态都要被说出来。
3. 装配工坊仍是两步：选底模、勾 LoRA。系统最多追问一次（成对底模）。
4. 只有一个分析引擎（Python）。JS 不再做检测，只按计划执行/渲染。
5. 零硬编码节点 ID / 插件名；零修改用户工作流文件；一切写入发生在提交时的内存载荷。

### 1.2 明确不做（从 v2 砍掉）
| 砍掉 | 原因 |
|---|---|
| 无 object_info 时的 R1/R2/R3 类型推断、束的多跳穿透 | 294 节点样本上发散；产品本来就同步 object_info，缺失时降级即可 |
| `sync-same / all / primary / custom` 四种策略 | 用"默认 + 勾选"替代，用户不需要理解策略 |
| 六种 Site 形态分类学、suspects 机制 | 保留 v1 已有的四种写法 + 两个小扩展；其余进 issues 提示 |
| 提示词回退（往正向提示词塞 `<lora:>`） | 在 Flux/Wan/Qwen/LTX/Nunchaku/Easy‑Use 上全部无效且污染提示词 |
| 通过 object_info 合成插件堆节点、LBW/lyco 方言、HIGH/LOW 文件名联想 | 收益小、脆 |
| JS 侧 `detect / normalize` 启发式 | 两套引擎每条规则写两遍是臃肿主因 |
| UI 格式导入 | 值得做，但是独立功能，不进槽位引擎 |

---

## 2. 概念（只有三个）

| 概念 | 定义 | 写法 |
|---|---|---|
| **模型目标** target | 某节点上一个持有权重文件名的字符串字段，且该节点的输出被 `model / unet` 类输入消费（object_info 可用时按声明类型判断） | 直接改字段值 |
| **LoRA 应用点** site | 五种形态：`chain`（LoraLoader 类节点）、`stack`（编号槽节点）、`object`（LoraManager 对象）、`syntax`（含 `<lora:` 的文本字段）、**`embedded`**（加载器内嵌 `lora_name`，容量 1） | 复用 v1 的四种写入 + embedded 单槽写入 |
| **来源** origin | 应用点字段被连线时，沿 STRING 边回溯到的节点。来源本身是应用点（LoraManager 对象 / 文本）→ 它是"中继"；否则来源不可写 | 中继：写来源；不可写：**断链写字面量**（`lora_syntax` 声明为 STRING，API 接受字面量，已核对源码） |

一个 **组** group = 共享同一来源的应用点集合；没有来源的应用点自成一组。组是用户能看见、能勾选的最小单位。

---

## 3. 分析规则（`analyze(workflow, object_info) → plan`）

分析只在后端跑一次（导入、object_info 变化、用户点"重新分析"时），结果作为 `slots.plan` 存进工作流包。

### 3.1 模型
1. 候选：沿用 v1 `model_candidates` 评分，**新增排除**键名匹配 `text|prompt|positive|negative|wildcard` 的字段（实测 `negative = "embedding:EasyNegative.pt"` 被当成模型）。
2. 资格：候选节点必须有输出被 `model | unet | model\d+` 键消费（一跳，不做传递推断）；object_info 可用时改为"声明输出类型以 `MODEL` 结尾"。不合格的候选进 `issues`（"附属权重，不进模型槽"），不再出现在目标里。
3. 主目标：评分最高、ID 最小（v1 规则不变）。**同文件的合格候选 = 随动目标**（默认写）；不同文件的 = 其他目标（默认不写，可勾选）。文件名比较前统一分隔符和大小写。
4. 已连线的 `ckpt_name / unet_name`：沿 STRING 边回溯 ≤ 8 跳；若来源节点没有连线输入、且恰有一个字符串字段等于当前文件名 → 该字段成为目标（角色沿用同文件/不同文件规则）；否则记为 `linked-unwritable` 并进 issues。
5. **成对底模**：当"不同文件的其他目标"里存在也驱动采样器的目标（其消费链一跳内有 `latent_image | samples | latent` 输入的节点），plan 标记 `paired: true`。这是唯一会让工坊多显示一个选择器的情况（Wan 2.2 HIGH/LOW、SDXL base/refiner）。

### 3.2 LoRA
1. 应用点收集：v1 的 chain / stack / object / syntax 检测 + `embedded`（节点同时持有权重文件字段和 `lora_name`‑类字段）。堆键正则放宽为 `^lora_?(\d+)(?:_name)?$`，兄弟字段按同 token 匹配 `strength | model_strength | clip_strength | wt | switch | on`，并同步 `num_loras | lora_count`。
2. **活跃过滤**（不活跃 = 不写，但列出并说明）：
   - 节点不在 API 图里（mode 2/4 导出时已剔除）；
   - 节点 MODEL / LORA_STACK 输出没有消费者；
   - 位于**字面量布尔开关的死分支**：`on_true/on_false`、`tt_value/ff_value`、`true_input/false_input`、`input{N}+select` 的选择端是字面量或无输入的基元 → 未选中的那一支不活跃（≈40 行，防官方模板静默无效）。
3. 连线的 `lora_syntax` 类字段：回溯 STRING 边。来源是应用点 → 中继组（写来源，`loaded_loras` 输出会自动同步到所有下游）；来源不可写（开关、拼接、缺失）→ 直写组（每个站点写同一串字面量）。
4. **单入口**：同一节点既消费 `LORA_STACK` 引脚又有自有对象 / embedded 站点 → 只算自有站点；没有可写 LoRA 参数的 `LORA_STACK` 生产者（Pool / Cycler / Randomizer）→ 只读来源，不成组。
5. **串联 / 并联**：站点 A 的 MODEL 输出沿 MODEL 边能到达站点 B 的 MODEL 输入 → 同一串联序列。用户新增的 LoRA **每个串联序列只追加一次（写在末尾站点）**，并联序列各追加一次。（rgthree 用户流 12 个 Power Lora Loader 串联 → 只写最后一个；Wan 2.2 两条通路 → 各写一次；alice 中继组按来源写一次。）
6. 无活跃应用点：
   - 主目标是核心语义加载器（字段名 `ckpt_name / unet_name`，object_info 声明输出 MODEL[, CLIP]）→ plan 给出 `synth`：在源的 MODEL（及被文本编码器消费的 CLIP）输出后插入核心 `LoraLoader` / `LoraLoaderModelOnly`；
   - 否则 `lora.enabled = false`，`reason` 写清楚（"此蓝图没有可用的 LoRA 应用点，且加载器不是标准类型"）。

### 3.3 输出结构
```jsonc
"plan": {
  "version": 3, "analyzedAt": "...", "objectInfoHash": "...",
  "model": {
    "paired": false,
    "targets": [
      {"key": "3699:ckpt_name", "nodeId": "3699", "path": "ckpt_name", "title": "默认底模",
       "current": "anikawaxl_v4.safetensors", "role": "primary"},          // primary | same | other | linked-unwritable
      {"key": "4528:ckpt_name", "role": "same", "...": "..."}
    ]
  },
  "lora": {
    "enabled": true, "reason": "",
    "groups": [
      {"key": "origin:2295:loras", "kind": "object", "origin": {"nodeId": "2295", "path": "loras"},
       "sites": [{"nodeId": "4542", "path": "lora_syntax"}, {"nodeId": "4565", "path": "lora_syntax"}, {"nodeId": "4586", "path": "lora_syntax"}],
       "pinned": [{"name": "QAQv2p2-150", "strength": 0.58}, {"name": "QAQv5p2_IL-40", "strength": 0.75}],
       "series": "S1", "active": true, "warn": ""}
    ],
    "synth": null                                   // 或 {"after": {"nodeId": "37", "modelSlot": 0, "clipSlot": null}, "classType": "LoraLoaderModelOnly"}
  },
  "issues": [{"level": "warn", "code": "dead-branch", "nodeId": "197:189", "text": "LoRA 节点位于未启用的分支（enable_turbo_mode=false），默认不写入"}]
}
```
用户侧覆盖（任务级或蓝图级）只有四个字段：
```jsonc
"overrides": {
  "model": "x.safetensors",                       // 或 {"3699:ckpt_name": "...", "4528:ckpt_name": "..."}（成对时）
  "loras": [{"name": "...", "strength": 0.8}],     // 用户追加的
  "unpin": ["QAQv2p2-150"],                        // 用户解锁移除的蓝图条目
  "disabled": ["origin:2295:loras"]                // 用户取消勾选的组 / 目标 key
}
```

---

## 4. 写入语义（`apply(workflow, plan, overrides, object_info) → (workflow', notices)`）

纯函数，输入不动，输出新图。

1. **模型**：写 `primary + same + 用户勾选的 other`；成对时按 key 分别写。object_info 有该字段的枚举列表而文件不在其中 → **报错**（不是跳过），错误在装配时的 dry‑run 就会出现。
2. **LoRA = 钉住 + 追加**：每个启用的组，最终列表 = `pinned − unpin + 用户条目`，同名条目以用户强度覆盖而不是重复。按形态写：
   - chain：数量超出现有节点 → 克隆尾节点重接下游（v1 逻辑）；少于 → 多余节点绕过（v1 逻辑）；
   - stack：填槽，其余槽关闭；对象式堆可增槽；固定槽溢出 → 报错"堆栈仅 N 槽"；
   - object：`active:true` 条目追加，`text` 字段作为投影同步；强度用数字写；
   - syntax：去掉可识别的旧标签后按最终列表重写；**不认识的标签原样保留**；
   - embedded：只放 1 条，超出 → 报错"此蓝图的加载器最多 1 个 LoRA"；
   - 中继组：写来源；直写组：把每个站点的连线替换为同一字面量。
3. 不活跃的组默认不写；用户在工作台勾选后才写，并在通知里标明。
4. `synth`：插入节点 ID 为 `源ID:lora`，把源输出的所有消费者重接到新节点，然后按 chain 规则写入。
5. 去掉工坊里的 `clamp(0.1, 1.5)`：强度范围以 object_info 的 min/max 为准，没有就 [−5, 5]。

---

## 5. 界面

### 5.1 装配工坊（用户主路径）
- 底模：一个选择器；`paired` 时显示两个，各自预填当前文件，标题用节点标题（"HIGH"/"LOW"、"Base"/"Refiner"）。
- LoRA：**锁定芯片**（蓝图自带，灰色带锁，点 × 即解锁移除 = `unpin`）+ 用户芯片（可调强度）。不再把蓝图 LoRA 当成可编辑默认值，也不再"记住上次覆盖"覆盖掉它们。
- 一行摘要，来自 plan：`将写入 2 个底模 · LoRA 追加到 3 处（1 处位于未启用分支，已跳过）`。`lora.enabled=false` 时 LoRA 区灰掉并显示 `reason`。
- 其余全部不出现。

### 5.2 工作台（高级、只读为主）
- 计划视图：目标列表（角色、当前值、原因）、组列表（形态、来源、站点、钉住条目、串联序号、活跃状态）、issues。
- 只有三个动作：
  1. 勾选 / 取消目标或组；
  2. **手动指定**：选节点 + 字段 → 加入 targets 或 groups。形态由字段值形态推断（权重文件名 → 目标；`lora_name` 类 → chain/embedded；对象列表 → object；文本 → syntax），仍受活跃过滤与写入校验约束；
  3. 重新分析（object_info 变了或工作流更新后）。

### 5.3 任务卡
- 展开显示本次实际写入的目标与站点、跳过的原因、报错信息。

---

## 6. 代码落点

| 位置 | 改动 |
|---|---|
| `backend/ecosystem/workflow_slots.py` | 重构为 `analyze()` + `apply()` 两个入口。保留并复用：`model_candidates`、`stack_slots`、`chain_descriptor / ordered_chain`、`_mirror_path_for`、`parse_lora_syntax`、四种写入函数。新增：STRING 回溯 `trace_origin`（≈40 行）、`embedded` 站点（≈30）、活跃过滤 + 死分支（≈60）、串联分组（≈40）、`synth`（≈50）、plan 组装（≈80）。删除：v1 的 `detect / normalize` 中与策略、模式选择相关的分支 |
| `backend/production/api.py` | 新增 `analyze-slots` 请求；`slot_overrides()` 的 dry‑run 改为 `apply(graph, plan, overrides)`；渲染路径同 |
| `js/workflow-slots.js` | 删除 `detect / normalize` 与所有启发式；保留一个按 plan 执行的 `applyPlan`（预览用，与 Python 共享契约夹具）；`currentLoras` 改为读 `plan.groups[].pinned` |
| `js/workflow-workbench.js` | 槽位区改为渲染 plan + 三个动作；导入时调用 `analyze-slots` |
| `js/architecture.js` | 工坊：成对选择器、锁定芯片、摘要行、去掉 clamp 与 remembered‑覆盖蓝图条目 |
| `tests/fixtures/workflow_slots_contract.json` | 扩为 `plan` + `apply` 双段；旧 27 例迁移；新增用例见 §8 |
| 迁移 | 旧 `slots` 配置首次打开时重新分析生成 plan；旧的 custom 目标若能匹配到新 key 则保留其 enabled 状态，否则进 issues 提示"不在蓝图中" |

估算：Python 净增约 300 行，JS 净减约 400 行。

---

## 7. 分期

| 期 | 内容 | 效果 |
|---|---|---|
| **第 1 期（修 bug）** | `analyze/apply` 骨架；同文件随动；`lora_syntax` 回溯 + 断链直写；钉住 + 追加；plan 存储与 dry‑run；工坊摘要行与锁定芯片；JS 去检测 | alice 家族全部正确；功能性 LoRA 不再需要用户维护 |
| **第 2 期（诚实）** | 活跃过滤 + 死分支；`embedded` + 堆键放宽；单入口 / 只读来源；串联分组；无应用点时 `synth` 或禁用；模型候选排除提示词键；成对底模选择器 | 官方模板不再静默无效；Easy‑Use / Efficiency 最多 1 个时明确报错、有堆时可写；Wan 2.2 可用；Power Lora Loader 库不被覆盖 |
| **第 3 期（兜底）** | 工作台"手动指定"；issues 视图 | Searge 之类外星生态由人指定，不再猜 |
| 独立项 | UI 格式导入（object_info 驱动的前端等价转换） | 去掉最大的导入门槛 |

---

## 8. 验收用例（契约夹具）

沿用 v2 列出的 alice 系列（A–I）中仍适用的部分，加上：

| # | 构造 | 期望 |
|---|---|---|
| 1 | 两个同文件 ckpt + 一个不同文件 ckpt | 前两者 `primary/same`，第三个 `other` 默认不写 |
| 2 | 中继：LoraManager 对象 → 3 个 `lora_syntax` + 1 个 SaveImagePlus | 一个中继组写来源；被动消费者不出现在站点里 |
| 3 | `lora_syntax` 来源是开关（不可写） | 直写组，三个站点得到同一字面量 |
| 4 | 钉住 + 追加：蓝图 `turbo×1`，用户加 `A×0.8` | 链 1→2 节点，turbo 保留在前；`unpin: [turbo]` 时只剩 A |
| 5 | 同名覆盖：蓝图 `A×0.5`，用户 `A×0.9` | 不重复，强度 0.9 |
| 6 | 12 个 Power Lora Loader 串联 | 用户条目只写最后一个；其余节点条目不动 |
| 7 | Wan 2.2 两条通路各带专属 LoRA，采样器 LATENT 串联 | `paired: true`；用户条目两条通路各追加一次；专属 LoRA 各自保留 |
| 8 | `Lora Stacker → Loader.lora_stack` + Loader 自有 `loras` | 只有自有对象成组，不重复写 |
| 9 | `Lora Pool → Cycler → Loader.lora_stack` | Pool/Cycler 不成组；写 Loader 自有对象 |
| 10 | 集成加载器（`ckpt_name + lora_name`）0 / 1 / 2 个 LoRA | 0：强度置 0；1：写入；2：报错"最多 1 个" |
| 11 | `easy loraStack`（`lora_1_name`, simple / advanced） | 识别为 stack；`num_loras` 同步；按 mode 写对应强度 |
| 12 | LoRA 链挂在 `switch=false` 的 `on_true` 上 | 组 `active:false` + issue；默认不写；勾选后写 |
| 13 | `ImpactSwitch select=2` 的 `input1` 上有 LoRA | 同上 |
| 14 | 无 LoRA 节点 + `UNETLoader` | `synth` 插 `LoraLoaderModelOnly`，消费者重接 |
| 15 | 无 LoRA 节点 + Nunchaku / Kijai 加载器 | `lora.enabled=false` + reason，不写提示词 |
| 16 | `ckpt_name ← PrimitiveString`（字面量提供者） | 提供者字段成为目标 |
| 17 | `ckpt_name ← ifElse` | `linked-unwritable` + issue |
| 18 | `negative = "embedding:x.pt"` | 不是模型候选 |
| 19 | 子图展平 ID `197:189` 上的链增长 | 克隆 ID `197:189:lora1`，8 个子图消费者全部重接 |
| 20 | object_info 枚举里没有用户选的文件 | 装配时 dry‑run 报错 |
| 21 | 手动指定 `SeargeLoras.lora_1` 为 embedded 站点 | 进入 plan，写入生效 |

---

## 9. 一句话

v3 = **v1 的四种写法 + 两个真修复（同文件随动、中继回溯/直写）+ 一个写入语义（钉住 + 追加）+ 一条诚实原则（不活跃就说、没有就禁用、外星就手动）**。比 v2 少一套引擎、少一层类型推断、少四种策略，覆盖面反而更实在。
