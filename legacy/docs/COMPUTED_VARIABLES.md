# 可执行变量与两阶段生成

Mio 的变量可以是字面量，也可以是一段异步 JavaScript 函数体。脚本在 **阶段 0：前置准备** 执行；所有依赖成功后，**阶段 1：分镜生成** 才会入队。

需要 Python 3.10+；脚本运行还需要 PATH 中的 Node.js 20+。不需要 npm install 来启动产品。Acorn 解析器随源码提供，许可证在 backend/ecosystem/ACORN_LICENSE。

## 从界面开始

1. 打开“创作工坊 → 预设库”，展开一个属性分组。
2. 点击属性上的“可执行变量”入口，选择结果类型，编辑函数体。
3. 设置本册的 uint32 随机种子，以及 1–180 秒执行上限。单段同步运算最多运行 30 秒。
4. 添加生成任务并开始。含脚本时确认执行，查看各节点的等待、执行、缓存命中或失败状态。
5. 只有全部成功，生成队列才接收已经求值的变量；源画册的脚本保持不变。

## 标准 ctx SDK

| API | 返回值与约定 |
| --- | --- |
| `ctx.get('name')` | 同步取得已解析依赖的 JSON 副本；不存在或未声明的动态依赖立即报错 |
| `ctx.random()` | 可复现的 [0, 1) 伪随机数；Math.random 使用同一序列 |
| `ctx.seed` | 从本册种子和变量名确定的节点种子，不等同于直接填写的本册种子 |
| `await ctx.llm.chat(prompt, options)` | 字符串；使用保存的 LLM 连接，支持 model、temperature、max_tokens |
| `await ctx.image.generate(prompt, options)` | 本地不可变图片资产 `{kind:'mio-image',src,name,mime}` |

图像 options 支持 `channelId`（保存的图像渠道 ID，省略使用当前渠道）、`negative`、`images`（本地资产数组）、`width`、`height`、`seed`、`steps`、`cfg`、`timeout`、`name`。ComfyUI 还可使用保存的 `workflowId` 或显式 API 格式 `workflow`。

尺寸、参数和参考图数量以所选渠道为准。ComfyUI 自定义节点应检查最终工作流；复杂映射可直接传入已构造好的 API workflow。使用 sceneParameter 来源时，在 options 中显式设置 renderOverride: true；variables 可提供绑定所需的已解析变量值。

返回值必须符合属性结果类型：text 字符串、number 有限数值、boolean 开关、json JSON 值、image SDK 返回的本地资产。不能返回函数、undefined、循环对象或任意远程图片 URL。

## 依赖图，不按属性排列顺序执行

脚本会先用 AST 解析器检查语法，并发现 `ctx.get('literal_name')` / `ctx['get']('literal_name')` 调用。注释和普通字符串里的代码不会误算依赖。显式 dependsOn 与发现的依赖合并。

动态名字、函数别名等无法静态发现的读取，必须在编辑器“依赖变量”中写出全部可能的名字。`ctx.get()` 只允许访问这组已解析的输入。缺失依赖、重复键、循环依赖、非法脚本都会在任何模型请求前阻止整次准备。

独立节点并发执行，有依赖的节点等待上游完成。全局最多 4 个准备任务、4 个脚本执行槽、4 个模型请求槽；每个脚本最多 8 次 SDK 模型调用。一个脚本内的多个 RPC 由宿主顺序处理；需要真正并行时拆成独立变量节点。

## 示例一：动态角色头像

先建字面量 `character`，例如 `short silver hair, green eyes, blue coat`。再建 image 类型 `portrait`：

```js
return await ctx.image.generate(
  'portrait, plain background, ' + ctx.get('character'),
  {seed: ctx.seed, width: 768, height: 768, name: '角色参考'}
);
```

后续分镜写 `走在雨中的 {character}，参考人物：{portrait}`。图片变量通过既有图像输入绑定进入图像渠道，不会被当成普通字符串拼进提示词。ComfyUI 必须配置可接收图片的 LoadImage 等节点，云端渠道必须支持参考图。

## 示例二：LLM 自适应环境

字面量 `story_mood` 为 `一封多年未寄出的信，重逢但不悲伤`。text 类型 `environment`：

```js
return await ctx.llm.chat(
  '请根据以下故事情绪，给出一行英文场景提示词，不要引号和解释：' +
  ctx.get('story_mood'),
  {temperature: 0.6, max_tokens: 180}
);
```

然后建 image 类型 `location_reference`：

```js
return await ctx.image.generate(ctx.get('environment'), {
  seed: ctx.seed, width: 1024, height: 768, name: '环境参考'
});
```

`portrait` 与 `environment` 可并行；`location_reference` 等待 `environment`。分镜使用 `{portrait}` 与 `{location_reference}`，两者全部准备好才开始生成。

## 示例三：可复现随机牌组

json 类型 `deck`：

```js
const deck = ['月亮', '星星', '太阳', '隐者', '力量', '世界'];
for (let i = deck.length - 1; i > 0; i--) {
  const j = Math.floor(ctx.random() * (i + 1));
  [deck[i], deck[j]] = [deck[j], deck[i]];
}
return deck.slice(0, 3);
```

text 类型 `first_card`：

```js
return ctx.get('deck')[0];
```

更改本册种子可重新抽取；相同种子、脚本与输入复用缓存。种子只能保证本地随机序列和输入相同，不能保证远端 LLM 或扩散模型逐像素复现。

## 保存、缓存与失败语义

- `compute={script,dependsOn,timeout}` 保存在原属性内，类型与分组一起保存/导出。
- 缓存签名包含画册、变量名、脚本配置、结果类型、依赖实际值、节点种子以及模型配置摘要。修改任何这些输入会产生新缓存键。
- 成功缓存位于 `data/macro-cache/`，图片以内容哈希存放于 `data/macro-assets/`。图片丢失时不继续引用坏缓存。
- 发起有副作用的执行前先写入未确认标记。超时、取消、崩溃、网络结果不确定或落盘失败后，这个标记阻止无提示重试。
- “生成队列 → 强制重算并生成”会明确提示忽略缓存和未确认标记，可能再次计费。
- 服务重启后，未结束记录标为 interrupted。
- 准备记录仅保留最近一批以控制体积，缓存不自动淘汰已付费结果。命名空间配额 32 MiB，单值 2 MiB；变量输入/组合结果限制 1 MiB。接近缓存配额时会拒绝新执行，请先备份，再通过明确的缓存清理操作处理，或离线移走该缓存目录。主动清理意味着后续需要重新调用模型。
- 图片资产不会按时间自动清理，因为源画册、队列或导出可能仍引用它们。维护者应先备份并核对引用，再离线清理。

## 执行一致性

生成队列获得独立求值快照，不跟随源画册脚本的后续修改。修改源画册影响下一次生成；已有结果在历史记录中查看。单幕字面量覆盖优先于本册值；可执行脚本应放在本册属性中，单幕不支持独立脚本节点。

异步 API 的实际超时可能长于脚本等待时限；仍在进行的网络线程会占用全局模型请求槽，直到该请求退出。
