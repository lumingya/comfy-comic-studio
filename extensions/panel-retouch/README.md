# 单格精修工作台

这是一个独立可选的 Mio 官方扩展。启用并审阅扩展摘要后，从扩展工作区打开「单格精修」；没有启用时主界面不会加载其页面或静态资源。

工作台直接使用 Mio 的本机 API：选择作品和话，加载候选与出图配置，然后可以画笔/矩形绘制蒙版、橡皮擦、调整笔刷大小、撤销/重做、反选和羽化；也可以按方向外扩，或用文字指令编辑。所有结果先作为新的候选，不会自动替换采用图。确认精修候选并按「采用此候选」后，才会更新该格当前采用的图。

编辑会按原候选尺寸本地生成蒙版 PNG 并上传为素材。外扩和修图需要所选出图配置包含对应工作流；指令编辑依配置使用本地工作流或已配置的云端编辑渠道。调用远端图像渠道可能产生费用。任务具备幂等键、状态跟踪、显式取消；网络超时或失败不会自动重试。按 `Tab` 在控件间移动；画布聚焦时支持 `Ctrl/Cmd+Z` 撤销与 `Ctrl/Cmd+Shift+Z` 重做；对比滑杆可用方向键微调。

工作区通过宿主注入的 `workspace-bridge.js` 读取主题令牌与语言，并只对同源 `/api` 发请求。响应式布局适配窄屏和桌面，主图、空态、任务错误与 API 失败均有可读反馈。

## 本地校验

```bash
python tools/check_extension_package.py extensions/panel-retouch
node extensions/panel-retouch/tests/manifest.test.cjs
node extensions/panel-retouch/tests/logic.test.cjs
node extensions/panel-retouch/tests/mask.test.cjs
node extensions/panel-retouch/tests/workspace.test.cjs
node extensions/panel-retouch/tests/app.test.cjs
```

测试模拟 API 和 Canvas，不执行真实 ComfyUI 或云端出图，也不代替浏览器中的视觉验收。
