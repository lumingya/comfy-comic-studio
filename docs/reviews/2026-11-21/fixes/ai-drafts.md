# AI 页面草稿修复：SET-AI-03 / SET-AI-04

范围仅为 `extensions/ai-assist/page/` 的聊天、设置与对应 DOM 回归；未修改 AI 后端、主设置页面或默认应用入口。未提交或推送。

## SET-AI-03：被删除的对话不再污染新草稿

- 把选择会话与 404 回退统一到完整的草稿恢复转换：同时恢复正文、附件、pending，清理旧错误、回执提示、发送／恢复／上传状态和本地选中项。
- 404 回退读取独立的 `mio.assist.draft.new`；原会话的正文、附件、原请求 key 和冻结 payload 保留在原会话的 sessionStorage key 中，不自动重发。页面不再拿旧请求状态覆盖新草稿。
- 读取草稿时，仅允许恢复与当前会话 ID 一致的 pending；此前已经污染的新草稿可继续编辑其正文，但不会恢复另一个会话的发送意图。
- 每次切换递增 composer epoch，旧发送、回执查询和上传的迟到结果不能再更改新草稿；重置当前 mutation 观察状态，使旧发送尚未结束时，新对话也可以显式发送。重置只解除本页状态，不声称取消已提交到服务端的操作。

## SET-AI-04：保存成功不会丢弃提交后的编辑

- 提交保留不可变状态快照；成功回调仅在当前草稿仍为该快照时关闭和导航。
- 普通保存期间继续接受编辑时，保留弹窗及新草稿，并提示“已保存提交的设置，后续修改尚未保存。”；不会自动保存后来输入。
- 提交内容改变显示模式时，保存 pending 期间禁用所有标签页及整个原生 fieldset 内的输入、选择、权限开关、增删渠道和模型目录按钮。因为宿主收到设置成功通知后会按新模式卸载 iframe，不能在这段期间接受随后丢失的输入。保存失败会完整解禁并保留提交草稿。
- dirty 基线推进到上一次成功提交的快照。因此在保存途中把字段改回初值，仍可以再次保存，撤销刚才实际写入的值。
- 保存失败保留当前字段及 dirty 状态，重试前清除旧错误。显示模式导航以弹窗最初模式为基线。

## 回归与验证

先加 4 个真实 React DOM 回归，修复前均失败，分别观察到：旧对话正文覆盖独立新草稿、已污染新草稿只读、成功保存错误关闭、保存中撤销字段后无法再次保存。随后完成最小修复并补充竞态覆盖。

最终新增 12 个用例，全部使用 Vitest / jsdom / Testing Library 和 mock fetch：

1. 旧 pending 会话 404 后，保留原 session 记录，恢复独立新草稿，正文及附件不混入，可以显式创建和发送新消息。
2. 已污染的 `draft.new` 保留可编辑正文，清除不匹配的 pending，不自动提交。
3. 至 5. 404 回退期间旧回执的 accepted、not_found、404 错误三种迟到结果均不能清空／锁定／报错到新草稿。
6. 旧发送仍在等待时会话 GET 返回 404，新草稿仍可发送，迟到的旧发送错误不破坏新状态，原请求记录保留。
7. 保存中新增模型输入：第一次 PUT 使用原快照，弹窗保留；第二次显式保存才写新值并关闭。
8. 保存中把模型改回原值：仍为待保存变更；第二次保存失败保留字段，第三次重试成功。
9. 至 11. 保存显示模式变更时，模型与渠道／操作权限／显示方式三个标签页分别检查所有当前控件和所有标签原生 disabled；用户输入与切换标签不会生效，成功只提交快照并关闭、导航。
12. 显示模式变更保存失败后，所有标签与表单重新启用，模式和模型草稿完整保留。

集中验证结果：

```text
npm --prefix extensions/ai-assist/page run format:check   PASS
npm --prefix extensions/ai-assist/page test               2 files / 34 tests PASS
npm --prefix extensions/ai-assist/page run build          tsc + Vite PASS
```

Vite 仍提示单 chunk 大于 500 kB；未为本次局部状态修复改拆包策略。未调用模型、真实网络服务、ComfyUI、个人运行数据；没有浏览器安装、E2E 或默认应用入口改动。

## 已跟踪分发产物

- 删除旧 `page/dist/assets/index-Csg6vB_q.js` 与 `index-BbqJvcRf.css`。
- 新构建为 `page/dist/assets/index-CfHqejZ7.js`，566,065 bytes；`page/dist/index.html` 引用已同步。
- 新 CSS 为 `index-Dxzc9sIq.css`，10,397 bytes；只为 fieldset 清除浏览器默认边框、边距与 padding，保留原表单布局。
- `dist` 忽略规则会隐藏新哈希文件，整合提交时需要显式 `git add -f extensions/ai-assist/page/dist/assets/index-CfHqejZ7.js extensions/ai-assist/page/dist/assets/index-Dxzc9sIq.css`，同时暂存旧文件删除和 HTML 变更。

## 独立宿主反例与补修

首次实现有一个组件内测试断言“显示模式保存期间继续编辑，在最后一次保存时才导航”，该测试没有挂载真实宿主，漏掉了模式刷新带来的 iframe 生命周期。独立复审用当前主界面 dist 与 AI dist 的真实 Chrome 临时 host mock 发现：`floating → page` 的 PUT 等待时切至模型标签并输入 `unsaved-after-mode-submit`，PUT 成功后 `useAssistAction.onSuccess` 先通知宿主，宿主重新读取 surface.mode=page，立即过滤并卸载 floating iframe。实际 `iframeCount=0`、`putCount=1`，服务端只收到旧模型；后续输入已经丢失，组件自己的快照 onClose 保护无法阻止卸载。

因此明确纠正合同：普通保存保留新编辑；**显示模式发生变化的提交期间，不接受后续表单编辑**。没有修改宿主刷新，也没有把 suppress 一次通知当成生命周期保护。新增三个标签页完整禁用测试，修复前均因标签仍 enabled 而失败；修复后与失败解禁测试一起通过。旧的不成立组件测试替换为这一明确禁用合同，普通保存保留新输入的原断言仍保留。

补修只增加提交模式快照、pending 判定、原生 fieldset 与标签按钮 disabled，以及 fieldset 默认样式归零。

同一独立复审者已回传窄复验通过：AssistSettings 12/12；真实宿主 Chrome 中，模式 pending 期间所有标签与模式选择原生 disabled，成功后 `floatingFrame=0 / pageFrame=1` 并正确导航。普通保存期间可继续输入，宿主收到 changed 后 iframe 和弹窗仍在，第二次显式保存新模型成功；最终 fieldset CSS 在 1440／390 px、浅／深色下复验通过。宿主组合遗漏合并回 SET-AI-04 关闭，详细图证及临时 mock 执行由独立复审报告持有。

边界：原会话未知结果记录留在原 sessionStorage key 中供恢复／核对，没有添加已删会话的 UI 恢复入口；这不代表旧操作被撤回。更广泛的跨窗口设置写冲突与附件备份 URL 分别由其它修复处理。
