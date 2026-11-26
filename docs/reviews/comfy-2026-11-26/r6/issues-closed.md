# 历轮发现、通用修复与保留边界

以下按根因主题索引，不将多人重叠发现相加为唯一缺陷总数。原始分级、失败、固定输入及有限修复回放保持在原轮；R6 在 fe 全任务范围重新独立审查并交叉核验，没有未关闭的范围内 Medium 以上问题。

| 原发现主题 | 通用修复与验证 | 原始记录 |
|---|---|---|
| 深选择器递归、失活文本仍可写、未知辅助输出被猜作恒等载荷 | 有界迭代/循环检测、mode 检查、明确端口与路由契约；执行依赖与自动写入归属分离 | [首轮发现与永久回归](../../../COMFY_WORKFLOW_COMPATIBILITY_2026-11-21.md) |
| 多画布、参考支路和支持蒙版的几何输入被误当主画布 | 沿实际 image/latent 数据血缘与阶段推断；不确定尺寸要求显式 mapping，保护后级精修 | [R2](../../../COMFY_WORKFLOW_R2_REPAIRS_2026-11-26.md)、[R3](../../../COMFY_WORKFLOW_R3_REPAIRS_2026-11-26.md) |
| 正负词共享来源、区域词与全局文本归属混淆 | 保护已占用字段与共享正词；区分 base conditioning、局部附加和不确定组合 | [永久语义回归索引](../../../COMFY_WORKFLOW_COMPATIBILITY_2026-11-21.md)、[R6 独立交叉](audits/generality/cross-review.md) |
| 覆写 selector 后沿旧分支冻结、LoRA 稳定键静默转移 | 在最终有效配置上重新推断；同次分支切换与受影响 LoRA 写入明确拒绝并要求重新检查 | [R2](../../../COMFY_WORKFLOW_R2_REPAIRS_2026-11-26.md) |
| 稀疏/空/关闭 LoRA、simple/count/advanced、numeric-string 与文本镜像被破坏 | shape/value/plan/writer 分层；按原生结构和稳定 occurrence key 精确修改，保留邻项、开关、类型和无归属正文 | [R3](../../../COMFY_WORKFLOW_R3_REPAIRS_2026-11-26.md)、[R4](../../../COMFY_WORKFLOW_R4_REPAIRS_2026-11-26.md)、[R6 33 项栈及类型合同](audits/compile/report.md) |
| 大图库目录重复分析、缓存失效与坏图隔离 | 内容与注册代际参与缓存身份，隔离错误与返回可变对象；有限冷/热/导入/刷新测量分开，未声称压力基准 | [R4 修复](../../../COMFY_WORKFLOW_R4_REPAIRS_2026-11-26.md)、[最终通用性审查](audits/generality/final.md) |
| UI-only/封装 API/PNG/WebP 与损坏输入报错不清 | 有界媒体预检、有效 API 图优先、UI 概览与三步 API 导出说明；不猜浏览器 widget 执行状态 | [十类拓扑与格式回归](../../../COMFY_WORKFLOW_COMPATIBILITY_2026-11-21.md)、[真实 Chrome](audits/web/report.md) |
| 导入入口键盘不可达、异步结果可采纳旧值、焦点与长标题溢出 | 原生按钮、当前检查完成后启用控件、有限下拉呈现与焦点恢复；四格亲见，失败编排与局部恢复另列 | [R2](../../../COMFY_WORKFLOW_R2_REPAIRS_2026-11-26.md)、[R3](../../../COMFY_WORKFLOW_R3_REPAIRS_2026-11-26.md)、[R6 Web](audits/web/final.md) |
| R5 M1：合法空/空白上游文本及配对 negative 候选遗漏 | 只读候选推断纳入合法空串、上游来源与语义配对，不扩大自动绑定；新 8 方法、相关 30 方法及四格实际展示/手选 | [原五份失败](../r5/index.md)、[候选回归](../../../../server/tests/test_workflow_inspection_candidates.py)、[R6 Web](audits/web/report.md) |
| R5 M2：图片经过处理链后的 init/control/mask 候选缺失 | 人工用途血缘与自动恒等路线分开；保留输出槽和选定闭包；三条独立多跳图片链四格手选保存/导出 | [有限原发现回放及原 format false](evidence/core-and-ci/finding-replay/report.md)、[独立编译](audits/compile/final.md)、[独立 Web](audits/web/final.md) |
| 远程集成中的 TS 重复类型、超时归属与 TLS 预算回归 | 只根治真实失败；保留曾经六个 job 失败及跳过步骤，使用实际 checkout 和完整 suite 证明新候选 | [集成历史](../r5/ci-history/integration-history/index.md)、[fe 完整 CI](evidence/core-and-ci/ci/report.md) |

## 保留的三个唯一 Low

1. **BL-L1**：13 条新增盲测的自动期待实际保守不写，明确提示人工配置；原 false 不改，76 次显式 mapping 精确不能洗掉自动覆盖不足。
2. **BL-L2**：普通第三方 detailer 的 image 输入仍缺 init 用途提示；通用 ref/字段与自定义语义 key 可接管。原 mask 期待另含 node-only oracle 忽略 output 槽差异，两个角色对原 false 均保留。
3. **W-01**：浏览器 JSON parse/stringify 不保留整数值 float 的字面类型；源 strict/hash false 与 post-wire 保存/导出 12/12 精确是不同边界，不放宽后端 strict typed 合同。

详见[新盲测的原差异](audits/blind/report.md)、[编译交叉](audits/compile/cross-review.md)和[Web 终签](audits/web/final.md)。原 25 件失落、weak-prefix 算法未知、私有 138 缺 frontend state、UI-only 不可直接 compile、未知动态插件/无线/子图执行及模型/GPU 可运行性都另列为证据或静态边界，不改成已通过。
