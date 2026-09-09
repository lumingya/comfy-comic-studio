/* Compatibility guards. Full preserved views are materialized by the source extractor. */
'use strict';

function installNativeUIModule() {
  const ns = globalThis.ComfyComic;
  const scenePrevious = renderSceneComposer;
  renderSceneComposer = function() {
    const template = currentTemplate();
    if (template && !template.frames?.length) {
      return '<div class="empty">' + icon('story') + '<h3>分镜列表为空</h3><p>空模板可以正常保存。添加第一幕后即可编辑和生成，最多支持512幕。</p>' + btn('添加第一幕', 'plus', 'add-frame', '', 'primary') + '</div>';
    }
    return scenePrevious();
  };
  const readerPrevious = openReader;
  openReader = function(id) {
    const book = bookBy(id);
    if (!book) throw new Error('The book no longer exists.');
    if (!book.totalSteps && !book.steps?.length) {
      modal(book.title || '空画册', '<div class="empty"><h3>还没有分镜</h3><p>这本画册已正常读取，目前没有可阅读的图片。</p></div><div class="modal-footer">' + btn('关闭', '', 'close-modal', '', 'primary') + '</div>');
      return;
    }
    return readerPrevious(id);
  };
  renderPythonSettings = function() {
    return '<section class="settings-section"><h2>Python 原生配置同步</h2><p>同源读取和保存已自动配置，无需填写接口路径。</p><div class="service-context"><strong>GET /api/config</strong><br><strong>POST /api/config</strong><br>10 个必填字段顶层平铺，删除时透传 forceWrite。</div><div class="row wrap" style="margin:18px 0">' + btn('重新读取后端', 'refresh', 'v3-connect-backend') + btn('立即保存', 'disk', 'v3-save-backend', '', 'primary') + '</div><p class="help">' + esc(backendRuntime.error || '新编辑会清除旧网络错误并重新安排保存。未读取成功前不会覆盖后端数据。') + '</p></section><section class="settings-section"><h2>ComfyUI 服务</h2><div class="grid2">' + field('运行模式', '<select data-setting="comfy.mode">' + opt('mock', '离线预览', state.settings.comfy.mode) + opt('real', '真实 ComfyUI', state.settings.comfy.mode) + '</select>') + field('ComfyUI 地址', setting('comfy.baseUrl', state.settings.comfy.baseUrl)) + '</div><div class="row">' + btn('测试连接', 'refresh', 'test-engine') + btn('智能节点映射', 'nodes', 'v3-settings-tab', 'data-tab="mapping"') + '</div></section>';
  };
  const renderPrevious = render;
  render = function() {
    const result = renderPrevious();
    document.querySelectorAll('input[id="story-target"]').forEach(input => { input.max = String(ns.MAX_FRAMES); });
    const xmlCount = document.getElementById('xml-count');
    if (xmlCount?.tagName === 'SELECT') {
      const number = document.createElement('input');
      number.id = 'xml-count'; number.type = 'number'; number.min = '1'; number.max = String(ns.MAX_FRAMES);
      number.value = xmlCount.value || '6'; number.setAttribute('aria-label', 'XML template frame count, 1 to 512');
      xmlCount.replaceWith(number);
    }
    const mappingInputs = document.querySelectorAll('[data-v3-binding="allowLink"]');
    mappingInputs.forEach(input => { input.checked = false; input.disabled = true; input.title = '连线禁止被普通文本覆盖，请绑定上游文本节点。'; });
    return result;
  };
  ns.modules.ui = true;
}

/* Artwork-only reader state. Editing/critique controllers remain laboratory tools. */
function createReaderPresentationModel(totalSteps = 0, mode = 'webtoon') {
  const state = { total: Math.max(0, Number(totalSteps) || 0), index: 0, mode, info: false, filmstrip: false };
  const seek = index => {
    state.index = Math.max(0, Math.min(Math.max(0, state.total - 1), Number(index) || 0));
    return state.index;
  };
  return {
    state,
    seek,
    next() { return seek(state.index + (state.mode === 'spread' ? 2 : 1)); },
    previous() { return seek(state.index - (state.mode === 'spread' ? 2 : 1)); },
    setMode(next) { if (['spread', 'webtoon', 'gallery'].includes(next)) state.mode = next; },
    spread() {
      const first = Math.floor(state.index / 2) * 2;
      return [first < state.total ? first : null, first + 1 < state.total ? first + 1 : null];
    }
  };
}

function highlightedPromptHTML(value, definitions, values = {}) {
  const escape = text => String(text ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&#60;', '>': '&#62;', '"': '&quot;', "'": '&#39;' })[char]);
  return createFreePromptPolicy().tokens(value, definitions).map(token => token.type === 'variable'
    ? '<mark class="' + (!Object.hasOwn(values, token.key) || values[token.key] === '' ? 'empty-token' : '') + '" data-prompt-variable="' + escape(token.key) + '">' + escape(token.value) + '</mark>'
    : escape(token.value)).join('');
}

function createCollectionDisplayModel() {
  const validModes = new Set(['showcase', 'grid']);
  function mode(value) { return validModes.has(value) ? value : 'showcase'; }
  function page(total, requested = 0, pageSize = 24) {
    const size = Math.max(1, Number(pageSize) || 24);
    const count = Math.max(0, Number(total) || 0);
    const pages = Math.max(1, Math.ceil(count / size));
    const index = Math.max(0, Math.min(pages - 1, Math.floor(Number(requested) || 0)));
    return { index, pages, start: index * size, end: Math.min(count, (index + 1) * size), total: count };
  }
  function fit(width, height, maxWidth, maxHeight, upscale = true) {
    if (![width, height, maxWidth, maxHeight].every(value => Number.isFinite(value) && value > 0)) return { width: 0, height: 0, scale: 0 };
    const scale = Math.min(maxWidth / width, maxHeight / height, upscale ? Infinity : 1);
    return { width: width * scale, height: height * scale, scale };
  }
  return Object.freeze({ mode, page, fit });
}

function createWorkspaceChromePolicy() {
  function navigation(visibility = {}) {
    return [
      [0, 'book', '画册集', '1'],
      [1, 'story', '创作画册', '2'],
      ...(visibility.logs === true ? [[6, 'terminal', '运行日志', '3']] : []),
      [7, 'nodes', '扩展功能', ''],
      ...(visibility.llm === true ? [[4, 'spark', 'AI 写故事', '4']] : []),
      [5, 'settings', '设置', ',']
    ];
  }
  function ownsDisplayPreferences(tab) { return tab === 'appearance'; }
  function brandFontSize(preferred, availableWidth, measuredWidth) {
    if (![preferred, availableWidth, measuredWidth].every(value => Number.isFinite(value) && value > 0)) return 0;
    return Math.min(preferred, preferred * Math.max(0, availableWidth - 2) / measuredWidth);
  }
  return Object.freeze({ navigation, ownsDisplayPreferences, brandFontSize });
}

function settingLabel(entry) {
  return entry.label || ({ character_display_name: '角色展示名 / 旁白', character: '角色名 / 提示词', character2: '同行角色', outfit: '服装', style: '画风', scene: '场景与环境', weapon: '道具', mood: '情绪', lora: 'LoRA', lora_strength: 'LoRA 强度', trigger: '角色特征', tone: '故事基调' })[entry.key] || entry.key;
}

function characterSettingHelp(key) {
  return key === 'character_display_name' ? '用于旁白和画册展示，例如「七海」。不会自动加入出图提示词。'
    : key === 'character' ? '用于出图提示词，填写模型识别的角色名或触发词，例如 nanami。' : '';
}

/* Native UI strings. Authored titles, captions, prompts and API data are not translated. */
function createStudioLocaleCatalog(initial = 'zh-CN') {
  const pairs = [
    ['画册集','Collections'],['我的画册','My books'],['创作画册','Create a book'],['实验室','Laboratory'],['设置','Settings'],['工作室','Workspace'],['工作室设置','Settings'],['运行日志','Activity log'],['AI 写故事','AI story writer'],
    ['分镜故事','Storyboard'],['角色与画面设定','Character & scene'],['生成队列','Render queue'],['工具与资源','Tools & resources'],['功能开关','Modules'],['外观与阅读','Appearance & reading'],['智能节点映射','Workflow input mapping'],['服务与保存','Services & storage'],['视觉审校','Visual review'],
    ['精选展示','Showcase'],['紧凑网格','Grid'],['首页展示方式','Collection view'],['保留大图欣赏，或快速浏览更多画册。','Enjoy a large artwork, or browse more books at a glance.'],['展示方式已保存','View preference saved'],
    ['语言 / Language','Language / 语言'],['界面语言','Interface language'],['只切换界面文字，不翻译画册名称、提示词或台词。','Changes interface text only. Your book titles, prompts and captions remain untouched.'],['显示与语言','Display & language'],['调整阅读习惯，让工作室更适合你。','Make the studio feel like your own.'],
    ['默认阅读模式','Default reading mode'],['打开一本画册时，默认从卷轴阅读开始。','Books open in the continuous scroll view by default.'],['卷轴 · 连续阅读','Scroll · continuous reading'],['对开本 · 双页画册','Spread · facing pages'],['画廊 · 大图与胶卷','Gallery · image & filmstrip'],
    ['艺术字体风格','Display typography'],['只改变界面标题与装饰文字，编辑区保持易读。','Applies to headings and accents. Editors stay clear and legible.'],['书刊 · 雅致衬线','Editorial · elegant serif'],['手札 · 东方笔意','Journal · calligraphic'],['典藏 · 古典书卷','Classic · artbook serif'],['丰富字体按需下载；离线时自动使用系统字体。','Fonts load on demand. System fonts are used automatically when offline.'],
    ['字体已就绪','Font styles ready'],['正在加载字体，当前使用系统字体。','Loading fonts; system fonts are available now.'],['字体加载不可用，已使用系统字体。','Web fonts are unavailable. System fonts are in use.'],['艺术字体','Display typography'],
    ['新建画册集','New collection'],['切换画册集','Switch collection'],['重命名当前画册集','Rename collection'],['关闭画册集菜单','Close collection menu'],['画册集名称','Collection name'],['重命名画册集','Rename collection'],['新的画册集已建立。','Collection created.'],
    ['把故事留在画面里，把时间留给创作。','Stories in every frame. More space to create.'],['创作新画册','Create a book'],['寻找一本画册...','Find a book...'],['搜索画册','Search books'],['星标','Starred'],['所有画册','All books'],['已完成','Complete'],['生成中','Rendering'],['待补齐','Needs frames'],['星标收藏','Bookmarks'],['最近创建','Newest'],['最近修改','Recently edited'],['分镜数量','Frame count'],
    ['画册状态','Book status'],['画册排序','Sort books'],['批量选择与管理','Select and manage books'],['每一帧，都值得被好好收藏。','Every frame deserves a place in your collection.'],['翻开这本画册','Open this book'],['取消星标','Remove bookmark'],['导出与管理画册','Export and manage book'],['画册操作','Book actions'],['选择这本画册','Select this book'],['退出选择','Exit selection'],['全部选择','Select all'],['已选 {count} 本','{count} selected'],['{count} 本画册','{count} books'],['{count} 幕','{count} frames'],['第 {current} / {total} 页','Page {current} of {total}'],
    ['上一册','Previous book'],['下一册','Next book'],['上一页','Previous'],['下一页','Next'],['补齐 {count} 幕','Resume {count} frames'],['仅保留封面示例，十二幕分镜模板仍可用于创作。','Cover-only sample. The 12-scene storyboard is still available for your own book.'],['留一点空白，给新的故事。','Leave room for your next story.'],['没有找到匹配的画册，试试其他名字。','No books match. Try a different name.'],['这里还没有画册。可以开始创作，或载入一份封面示范。','No books here yet. Create one or load the cover sample.'],['载入精选示范','Load the sample'],['开始创作','Start creating'],['原创画册','Original artbook'],['原创','Original'],
    ['对开本','Spread'],['卷轴','Scroll'],['画廊','Gallery'],['关闭画册','Close book'],['进入或退出全屏','Enter or exit full screen'],['本幕文字','Frame notes'],['阅读模式','Reading mode'],['分镜缩略图','Frame thumbnails'],['当前分镜信息','Frame information'],['显示或收起分镜胶卷','Show or hide filmstrip'],['查看本幕文字','Show frame notes'],['收起分镜文字','Close frame notes'],['查看画面提示词','Show image prompt'],['复制提示词','Copy prompt'],['原始比例','Original proportions'],['这一幕，让画面自己说话。','Let this frame speak for itself.'],['到实验室使用精修扩展','Open refinement tools in the laboratory'],['尚未生成的分镜','Frame not generated'],['这本画册还没有分镜。','This book has no frames yet.'],['先生成或上传画面，再来翻阅。','Generate or upload images before reading.'],
    ['新画册','New book'],['生成画册','Generate book'],['画面由你定义，故事自由发生。','Your vision. Your story. No limits on expression.'],['画册名称','Book title'],['给画册一个名字','Name your book'],['分镜模板','Storyboard template'],['选择分镜模板...','Choose a storyboard...'],['新建分镜模板','New storyboard'],['导入分镜模板','Import storyboard'],['分镜列表','Scenes'],['新增一幕','Add scene'],['分镜名称','Scene title'],['前移分镜','Move scene earlier'],['后移分镜','Move scene later'],['复制此幕','Duplicate scene'],['删除此幕','Delete scene'],['画面提示词','Image prompt'],['描述你想看见的画面...','Describe the image you imagine...'],['台词 / 旁白','Dialogue / narration'],['也可以让画面自己说话。','Or let the image speak for itself.'],['查看变量替换后的提示词','Preview the resolved prompt'],
    ['只有已定义的 {变量名} 会高亮。其他括号、权重与符号原样保留。','Only declared {variables} are highlighted. Other brackets, weights and symbols stay exactly as written.'],['提示：有未闭合的花括号。若是变量可检查闭合；若用于提示词权重，请忽略。不会影响生成。','Tip: an opening brace is not closed. Check it if it is a variable, or ignore this for prompt weights. Generation is never blocked.'],
    ['高级选项','Advanced options'],['修改范围','Edit scope'],['修改共享分镜模板','Edit shared storyboard'],['仅修改当前画册这一幕','Override this scene for this book'],['负向提示词（可留空）','Negative prompt (optional)'],['覆盖本幕渲染参数','Override render parameters for this scene'],['默认使用工作流参数，不自动覆盖。','Workflow parameters are preserved unless you enable overrides.'],['此幕单独的画面设定','Scene-specific settings'],['导出分镜','Export storyboard'],['恢复共享分镜','Reset to shared storyboard'],['宽度','Width'],['高度','Height'],['采样步数','Sampling steps'],['去噪强度','Denoise'],
    ['设定一次，贯穿所有分镜。留空的属性会自然略过。','Define once for the whole book. Empty attributes are simply omitted.'],['新增属性','Add attribute'],['未填写，生成时忽略此项','Empty; omitted during generation'],['设定预设','Setting preset'],['选择预设...','Choose a preset...'],['应用','Apply'],['将当前设定存为预设','Save settings as a preset'],['高级：自定义节点与单幕设定','Advanced: custom nodes and scene overrides'],['打开节点映射','Open input mapping'],['角色名','Character'],['同行角色','Companion'],['服装','Outfit'],['画风','Art style'],['场景与环境','Scene & environment'],['道具','Props'],['情绪','Mood'],['角色特征','Character traits'],['故事基调','Story tone'],['可留空','Optional'],['文本','Text'],['数字','Number'],['开关','Boolean'],['添加属性','Add attribute'],['显示名称','Display name'],['变量标识符','Variable identifier'],['属性类型','Attribute type'],['预设名称','Preset name'],
    ['关闭','Close'],['取消','Cancel'],['确认','Confirm'],['完成','Done'],['保存','Save'],['删除','Delete'],['导出','Export'],['导入','Import'],['复制','Copy'],['编辑','Edit'],['重试','Retry'],['刷新','Refresh'],['继续','Resume'],['暂停','Pause'],['中止','Cancel task'],['开始队列','Start queue'],['查看运行日志','View activity log'],['查找缺失分镜','Find missing frames'],['复制日志','Copy log'],['清空日志','Clear log'],['等待执行','Queued'],['正在渲染','Rendering'],['已暂停','Paused'],['已中止','Canceled'],['执行失败','Failed'],
    ['专业工具留在这里。开启你需要的，其余交给画面。','Professional tools live here. Enable what you need; leave the rest to the artwork.'],['扩展与模板市场','Extensions & templates'],['单页精修','Page refinement'],['局部蒙版','Inpainting mask'],['分镜写作助手','Storyboard assistant'],['连接视觉模型，检查画面与角色一致性。','Connect a vision model to review images and character consistency.'],['基于原画册的工作流快照，原地替换一页。','Refine one page using the book’s original workflow snapshot.'],['涂抹局部区域，需要对应的图生图工作流。','Paint a mask. A compatible image-to-image workflow is required.'],['用自然语言调整源分镜，不改动已有画册。','Edit the source storyboard with natural language. Existing images stay unchanged.'],['所有实验扩展默认关闭。开启一个工具后，选择画册与分镜即可使用。阅读器始终保持简洁。','Experimental tools are off by default. Enable one, then choose a book and frame. The reader always stays clean.'],['工作画册','Target book'],['目标分镜','Target frame'],['纯粹阅读','Open reader'],['审校这张图','Review this image'],['API 设置','API settings'],['想改变什么？','What would you like to change?'],['强度','Strength'],['重绘这一页','Refine this page'],['绘制蒙版','Paint a mask'],['检查节点映射','Check input mapping'],['打开助手','Open assistant'],['扩展使用说明','Extension guide'],['外部服务只在你主动操作时调用，离线演示会明确标注。','External services run only when you request them. Offline demonstrations are clearly labeled.'],
    ['你的工作室','Your workspace'],['名称显示在工作室侧栏。随时可以修改，不改变已有画册集、画册或设定预设。','This name appears in the sidebar. Changing it does not alter your collections, books or setting presets.'],['工作室名称','Workspace name'],['创作者署名','Creator signature'],['同时更新默认画册签名','Also update the default book signature'],['保存名称与署名','Save name & signature'],['当前保存方式','Current storage'],['配置服务与保存','Configure services & storage'],['导出备份','Export backup'],['返回画廊','Back to books'],
    ['只留下你需要的功能','Keep only the tools you need'],['核心功能','Core feature'],['辅助工具','Additional tools'],['悬浮精修助手','Floating assistant'],['模板与扩展市场','Template & extension market'],['启用','Enable'],['停用','Disable'],['为长时间创作调校界面','Settle into your creative space'],['安静一点，紧凑一点，或让阅读成为你的默认入口。','Quieter, denser, or made for reading. Tune the workspace to your preferences.'],['界面主题','Theme'],['日光适合明亮环境；暗室让画面更突出。','Light for bright rooms; dark to let the artwork stand out.'],['暗室 / Dark','Dark'],['日光 / Light','Light'],['界面密度','Interface density'],['舒适','Comfortable'],['紧凑','Compact'],['紧凑模式减少表格与面板间距。','Compact mode reduces table and panel spacing.'],['减少动态效果','Reduce motion'],['关闭入场、微光和翻页动画；同时尊重系统减弱动态设置。','Reduces entrances and page-turn effects, while respecting your system motion preference.'],['阅读器默认行为','Reader defaults'],['打开画册时的模式','Default opening mode'],['只影响下次打开的画册，不打断当前阅读。','Applies to the next book you open, without interrupting your current reading.'],['助手修改前确认','Confirm assistant edits'],['应用工具修改前，显示将受影响的模板与分镜。','Shows the target storyboard and scenes before applying tool changes.'],
    ['Python 原生配置同步','Native Python configuration sync'],['同源读取和保存已自动配置，无需填写接口路径。','Same-origin read and save endpoints are already configured.'],['10 个必填字段顶层平铺，删除时透传 forceWrite。','Ten required top-level fields; forceWrite is sent for authorized deletions.'],['重新读取后端','Reload backend'],['立即保存','Save now'],['ComfyUI 服务','ComfyUI service'],['运行模式','Run mode'],['离线预览','Offline preview'],['真实 ComfyUI','Real ComfyUI'],['ComfyUI 地址','ComfyUI URL'],['测试连接','Test connection'],['本地预览模式','Offline preview'],['ComfyUI 待连接','ComfyUI disconnected'],['ComfyUI 已连接','ComfyUI connected'],['队列','Queue'],['切换界面主题','Toggle theme'],['折叠侧栏','Collapse sidebar'],['展开侧栏','Expand sidebar'],['搜索与快速操作','Search & commands'],
    ['智能节点映射','Smart input mapping'],['导入工作流 JSON','Import workflow JSON'],['从节点定义读取字段','Read node definitions'],['导入映射包','Import mappings'],['导出映射包','Export mappings'],['添加映射项','Add binding'],['工作流名称','Workflow name'],['结果图片节点（可手动输入，留空自动查找）','Output image node (leave blank to detect)'],['节点 ID（可手动填）','Node ID (editable)'],['输入字段 / 路径','Input field / path'],['值类型','Value type'],['值从哪里来？','Value source'],['映射高级控制','Advanced binding controls'],['自动类型','Auto type'],['本幕正向提示词','Scene positive prompt'],['负向提示词','Negative prompt'],['本幕台词','Scene caption'],['分镜名称','Scene name'],['读取变量','Read variable'],['自定义值 / 模板文本','Custom value / template text'],['随机种子','Random seed'],['分镜高级参数','Scene parameter override'],['上传参考图 / 重绘图','Uploaded reference / refinement image'],['保持工作流原值','Keep workflow value'],['重新识别文本字段','Detect text field again'],['允许新增此可选输入字段','Allow adding this optional input'],['允许覆盖原节点连线','Allow overwriting original link'],['查看实际提交 JSON','Preview submission JSON'],['一帧试跑','Test one frame'],['编辑完整蓝图','Edit full workflow'],['每次任务随机化蓝图中的种子','Randomize workflow seeds for each task'],['配置高级分镜参数','Map scene parameters'],['自动识别正负提示词','Detect positive / negative nodes'],
    ['画册导出模板','Book export templates'],['模板与插件市场','Template marketplace'],['GitHub 托管','GitHub hosting'],['快速开始教程','Quick-start guide'],['工程备份与恢复','Backup & restore'],['系统自检','Diagnostics'],['设计 HTML/CSS 阅读版式，不改变源画面与台词。','Design an HTML/CSS reading layout without changing source artwork or captions.'],['安装或导入分镜、画册版式与工作流。','Install or import storyboards, book layouts and workflows.'],['上传或安装可复用模板，不上传私有工程。','Publish or install reusable templates, never your entire private workspace.'],['低频工具集中在这里，主侧栏只保留日常创作入口。','Less-used tools stay here so the sidebar remains focused on daily work.'],
    ['导出你的故事','Export your story'],['画册导出模板','Book export template'],['自定义此模板','Customize template'],['导入模板','Import template'],['从市场下载','Get from marketplace'],['本次主题色','Accent color'],['分镜框线 / px','Frame border / px'],['显示剧情台词','Include captions'],['附带提示词水印','Include image prompts'],['管理模板库','Manage templates'],['生成并下载画册','Build & download book'],['用自己的 HTML 模板，为每一个故事设计阅读体验。','Give each story its own reading experience with HTML templates.'],['自定义版式只作用于导出的 HTML，不会改动作品与原始台词。','Layouts affect exported HTML only; source artwork and captions remain unchanged.'],['外观与信息','Design & details'],['HTML / CSS 源码','HTML / CSS source'],['模板包','Template package'],['发布到 GitHub','Publish to GitHub'],['实时预览 · 前 3 幕','Live preview · first 3 frames'],['独立沙盒 · 无网络请求','Isolated preview · no network requests'],['设为默认','Set as default'],['还原修改','Revert changes'],['保存为我的模板','Save as my template'],['保存模板','Save template'],['模板名称','Template name'],['阅读版式','Reading layout'],['简介','Description'],['作者','Author'],['版本','Version'],['纸张与排版','Paper & typography'],['主题色','Accent'],['画布底色','Canvas'],['纸张色','Paper'],['文字颜色','Text'],['字体','Typeface'],['版心宽度','Content width'],['页间距','Page gap'],['圆角','Corner radius'],['用于预览的画册','Preview book'],['完整 HTML / CSS 文档','Complete HTML / CSS document'],['插入分镜循环','Insert frame loop'],['模板变量与安全规则','Variables & safety rules'],['刷新预览','Refresh preview'],['恢复未保存草稿','Recover draft'],['新建模板','New template'],
    ['视觉审校 API','Visual review API'],['填写 API / 配置模型','Configure API / model'],['带图连通性测试','Test with an image'],['运行模式','Run mode'],['连接来源','Connection source'],['独立配置（推荐）','Independent settings (recommended)'],['复用 LLM 的地址、模型与密钥','Reuse story model connection'],['服务商预设','Provider preset'],['视觉模型名称','Vision model'],['单次超时 / 秒','Timeout / seconds'],['报告通过标准','Passing score'],['附带角色参考立绘','Include character reference'],['附带前一幕画面','Include previous frame'],['审校重点','Review focus'],['带图测试连接','Test vision connection'],['保存并关闭','Save & close'],['离线演示：不调用 API','Offline demo: no API calls'],['真实视觉 API','Real vision API'],['配置 API','Configure API'],['审校整本画册','Review whole book'],['停止整册审校','Stop book review'],['复制报告','Copy report'],['API 设置','API settings'],['修改 API 配置','Edit API settings'],['重试审校','Retry review'],['将此建议填入重绘框','Add suggestion to refinement prompt'],['结构与一致性诊断','Anatomy & continuity'],
    ['GitHub 模板发布与安装','Publish & install with GitHub'],['直接上传到仓库','Upload to repository'],['GitHub 网页上传教程','Upload on GitHub.com'],['从仓库安装','Install from repository'],['只上传这一个资源','Upload only this resource'],['GitHub 仓库','GitHub repository'],['分支','Branch'],['仓库内文件路径','Repository file path'],['提交说明','Commit message'],['检查仓库与文件','Check repository & file'],['上传并提交','Upload & commit'],['下载所选模板','Download selected template'],['打开 GitHub 上传页面','Open GitHub upload page'],['复制预计 Raw 地址','Copy expected Raw URL'],['创建仓库','Create repository'],['创建 Fine-grained Token','Create fine-grained token'],['权限与接口文档','Permissions & API docs'],['即将上传的内容','Upload preview'],['资源','Resource'],['类型','Type'],['大小','Size'],['范围','Scope'],['仅一个模板文件','One template file only'],['上传到 GitHub','Upload to GitHub'],['上传教程','Upload guide'],['安装','Install'],['卸载','Uninstall'],['下载模板','Download template'],['预览','Preview'],['全部','All'],['画册 HTML 模板','Book HTML templates'],['分镜剧本','Storyboards'],['角色资产','Character assets'],['工作流','Workflows'],['审校规则','Review rules'],['解析并导入','Parse & import'],['返回画册导出','Back to book export'],
    ['先认识你的工作室。','Meet your workspace.'],['先用默认名称','Use a default name'],['进入工作室','Enter workspace'],['创作者署名（可选）','Creator signature (optional)'],['分镜精修助手','Storyboard assistant'],['编辑指令','Edit instruction'],['修改前确认','Confirm before editing'],['发送','Send'],['停止','Stop'],['对话记录','Conversations'],['修改目标 / 画册集与源分镜模板','Target / collection and source storyboard'],['用自然语言，修改提示词与台词','Edit prompts and captions with natural language'],['离线规则模式','Offline rule mode'],['原生接口与512幕回归检查','Native API & 512-frame diagnostics'],['通过','Passed'],['未通过','Not passed']
  ];
  const messages = Object.fromEntries(pairs);
  let language = initial === 'en' ? 'en' : 'zh-CN';
  function text(source, values = {}) {
    const template = language === 'en' ? messages[source] || source : source;
    return String(template).replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (whole, key) => Object.hasOwn(values, key) ? String(values[key]) : whole);
  }
  function translate(source) {
    if (language !== 'en') return source;
    const original = String(source), core = original.trim();
    let value = messages[core];
    if (!value) {
      const count = core.match(/^(\d+)\s*本画册$/), frame = core.match(/^(\d+)\s*幕$/), selected = core.match(/^(?:选中|已选择)\s*(\d+)\s*本$/);
      if (count) value = count[1] + ' books';
      else if (frame) value = frame[1] + ' frames';
      else if (selected) value = selected[1] + ' selected';
    }
    return value ? original.slice(0, original.indexOf(core)) + value + original.slice(original.indexOf(core) + core.length) : source;
  }
  return { get language() { return language; }, setLanguage(value) { language = value === 'en' ? 'en' : 'zh-CN'; }, text, translate, messages };
}

function extendStudioLocaleCatalog(catalog) {
  Object.assign(catalog.messages, {
    '角色展示名 / 旁白': 'Display name / narration',
    '角色名 / 提示词': 'Character name / prompt',
    '用于旁白和画册展示，例如「七海」。不会自动加入出图提示词。': 'Used in narration and book details, for example Nanami. Never automatically added to image prompts.',
    '用于出图提示词，填写模型识别的角色名或触发词，例如 nanami。': 'Used in image prompts. Enter the name or trigger recognized by your model, for example nanami.',
    '删除画册集': 'Delete collection',
    '删除当前画册集': 'Delete current collection',
    '确定删除这个画册集？': 'Delete this collection?',
    '未命名画册集': 'Untitled collection',
    '将移除 {books} 本画册、{plans} 份创作草稿、{templates} 套专属分镜和 {sets} 组设定。': 'This removes {books} books, {plans} book drafts, {templates} exclusive storyboards and {sets} setting presets.',
    '关联的角色记录、对话与队列任务也会移除；全局工作流和导出模板保留。': 'Related character records, conversations and queue tasks will also be removed. Global workflows and export templates are kept.',
    '另外 {count} 项被其他画册集使用的资产会保留。': '{count} assets referenced by other collections will be retained.',
    '这是最后一个画册集，删除后会建立一个新的空白画册集。': 'This is the last collection. A new empty collection will be created afterward.',
    '无法撤销，建议先导出备份。磁盘文件的清理由你的后端策略决定。': 'This cannot be undone; export a backup first. Physical file cleanup is governed by your backend.',
    '请先等待当前生成、审校、上传或保存任务结束，再删除画册集。': 'Wait for active generation, review, upload or save tasks to finish before deleting this collection.',
    '工程在确认期间发生变化，请重新检查后删除。': 'The project changed while awaiting confirmation. Review it and try again.',
    '画册集已删除，正在等待后端保存确认。': 'Collection deleted locally; waiting for the backend to confirm the save.',
    '画册集已删除；当前尚未连接后端，请保存或导出备份。': 'Collection deleted locally. Connect to the backend or export a backup to retain this change.',
    '工作流配置': 'Workflow configuration',
    '智能节点映射': 'Workflow configuration',
    '智能节点映射器': 'Workflow configuration',
    '扩展功能': 'Extensions',
    '实验室': 'Extensions',
    '扩展功能使用说明': 'Extension guide',
    '扩展功能的目标画册': 'Target book for extensions',
    '到扩展功能使用精修扩展': 'Open refinement extensions',
    '显示运行日志': 'Show activity log',
    '画册与创作是核心功能，始终保留。其他模块可以按需开启，隐藏不会删除历史作品。': 'Books and creation are always available. Optional modules can be hidden without deleting your work.',
    '阅读、精修和导出已生成的画册。': 'Read, refine and export generated books.',
    '画册、分镜、设定预设和生成队列收纳在一个工作区。': 'Book drafts, storyboards, setting presets and rendering share one workspace.',
    '独立查看生成、连接、保存与审校的运行过程。': 'Inspect rendering, connections, saves and review activity.',
    '可选功能：把想法写成剧情台词或分镜初稿。默认关闭，不影响普通生成。': 'Optional: turn ideas into dialogue or storyboard drafts. Off by default; rendering works without it.',
    '可拖动的小悬浮球；悬停展开说明，点击对话。只修改源分镜模板。': 'Drag the floating button, hover for its label, or click to chat. It edits source storyboards only.',
    '连接支持图片输入的模型，检查真实画面并给出修改建议。': 'Connect a vision-capable model to inspect artwork and suggest refinements.',
    '从设置中的“工具与资源”进入，不再占用主侧栏。': 'Available under Settings > Tools & resources, keeping the sidebar clear.',
    '使用已有 Python 后端时，由服务负责保存与文件夹管理，不需要浏览器目录授权。': 'Your Python service manages saves and folders, without browser directory permissions.',
    '创作流程由你定义，工具保持安静。': 'Define your creative process. Let the tools stay out of the way.',
    '从画册创作到生成画册，含本地三幕练习。': 'Learn the creative workflow with a local three-scene exercise.',
    '下载工程 JSON 或兼容目录包。': 'Download a project JSON backup or portable directory archive.',
    '给自己的创作空间取个名字。后端连接和使用教程都可以稍后在设置里处理，不会挡住你开始创作。': 'Name your creative space. Connections and tutorials can wait until later in Settings.',
    '默认名称为“我的工作室”。之后可以随时在设置中修改。教程不会在命名之前自动弹出。': 'You can use the default name and change it later. Tutorials never interrupt the naming step.',
    '当前为离线矢量演示，不会调用 GPU。真实精修需连接 ComfyUI。': 'Offline vector demonstration. Connect ComfyUI for real image refinement.',
    '此画册的工作流没有图像输入映射。当前只能重新文生图，不能原图局部精修。': 'This workflow has no image-input binding. It can regenerate from text but cannot inpaint the original.',
    '已找到图像输入映射，请确认原工作流支持所需的图生图或蒙版节点。': 'Image-input binding found. Confirm that your workflow supports the required image-to-image or mask nodes.',
    '标识符用于 {变量名} 高亮。它只影响属性识别，不会限制你的提示词语法。': 'The identifier enables {variable} highlighting. It never restricts your prompt syntax.',
    'LoRA 等属性只有在工作流中映射到对应节点输入时才生效。需要某一幕单独变化，可以在分镜高级选项中覆盖属性。': 'LoRA and other properties take effect when bound to workflow inputs. Use advanced scene settings for individual overrides.',
    '变量名（任意自定义变量）': 'Variable name (any custom attribute)',
    '自定义内容（支持 {变量名}）': 'Custom value (supports {variables})',
    '分镜参数名': 'Scene parameter name',
    '此来源会按每一幕自动传入，无需重复填写。': 'This value is supplied for each scene automatically.',
    '只有单幕高级覆盖开启时生效。': 'Applies only when advanced scene overrides are enabled.',
    'JSON 路径以 / 开头，支持嵌套对象和数组。覆盖连线会改变拓扑，请仅在明确知道节点要求时开启。': 'JSON paths begin with / and support nested objects and arrays. Upstream workflow links are protected.',
    '默认保留工作流的尺寸、采样器、CFG 与 LoRA 参数。高级分镜参数只有你启用并映射后才会覆盖。': 'Workflow size, sampler, CFG and LoRA settings are preserved by default. Scene overrides apply only when enabled and mapped.',
    '试跑结果将显示在这里。连接地址集中在“服务连接”设置，不在本页面重复配置。': 'A test render will appear here. Configure service addresses in the connection settings.',
    '从左侧节点添加字段，或手动建立映射。没有任何必填的固定节点类型。': 'Add an input from the node browser, or define a binding manually. No fixed node types are required.',
    'Token 不写入磁盘，关闭窗口即清除。': 'The token is never written to disk and is cleared when this window closes.',
    '使用 POST /chat/completions，支持多模态和工具调用': 'Uses POST /chat/completions with image input and tool calling.',
    '离线规则模拟（不调用 API）': 'Offline rule simulation (no API calls)',
    '模型名称': 'Model name',
    '服务商预设': 'Provider preset',
    '全局负向提示词': 'Global negative prompt',
    '这是一份模板，不包含画册图片。': 'This is a template, not a collection of book images.',
    '从第一个镜头开始。': 'Start with the first shot.',
    '可以写一段完整的画面，也可以只留下几个词。': 'Describe a full scene, or begin with just a few words.',
    '添加分镜': 'Add a scene',
    '队列已结束，已生成画面全部保留。': 'The queue has finished. All completed images were retained.',
    '正在读取 Python 工作室...': 'Loading workspace from Python...',
    '正在提交 Python 后端...': 'Saving to Python backend...',
    '后端保存未确认 · 请检查设置': 'Save not confirmed · check settings',
    '有待保存修改': 'Unsaved changes',
    '尚未连接保存服务 · 当前未保存到后端': 'Storage service disconnected · not saved to backend',
    '已读取 /api/config，保存使用 POST 平铺字段。': 'Loaded /api/config. Saves use the native flat POST payload.',
    'POST /api/config 已由后端确认。': 'POST /api/config was confirmed by the backend.'
  });
  return catalog;
}