/* Studio Kit — front-end half (Mio SDK v3).
   `export default function (ctx)` runs once the extension is enabled. Return a function to run on
   dispose, or `{ dispose, api }` to also publish an API for other extensions (ctx.extensions.get).
   Everything registered through ctx is removed automatically when the extension is disabled or
   hot-reloaded, so dispose only has to undo things done outside the SDK.

   v2 surface (still here): slots.nav / dock / inspector / frameCard / albumCard / contextMenu /
   commands / toolbar, exporters, events, albums, api, storage tiers, settings, icons.

   v3 additions demonstrated below:
     ctx.anchors      put buttons/HTML at named places in the core UI (topbar, sidebar-nav, statusbar, creation-tabs, …)
     ctx.mount        attach UI next to ANY element by CSS selector; re-applied after every render
     ctx.patch        wrap any core function (renderShell here) in a restorable chain
     ctx.filters      value pipelines the core runs (prompt.compose, command.items, frame.render)
     ctx.keys         keyboard shortcuts with owner cleanup
     ctx.styles       runtime CSS / CSS variables scoped to this extension
     ctx.slots.settings  a full page inside 设置
     ctx.tasks        long-running Python jobs with progress + cancel
     ctx.api(..., {raw:true}) / api.url()  raw HTML/file responses from Python routes
     ctx.core         direct access to state/ui/render/modal/... when the SDK is not enough
     ctx.expose / ctx.extensions   cross-extension APIs */
export default function studioKit(ctx) {
  const { ui, albums, core } = ctx;
  const seen = [];
  const h = (strings, ...values) => strings.reduce((out, s, i) => out + s + (i < values.length ? ui.esc(values[i]) : ''), '');
  let settings = { badge: 'KIT', accent: '#e8a33d', suffix: '' };

  /* ---- settings drive live UI: CSS variables + re-render of the anchor items ---------------- */
  const applySettings = values => {
    settings = { ...settings, ...values };
    ctx.styles.vars({ '--sk-accent': settings.accent || '#e8a33d' });
    ctx.anchors.refresh();
  };
  ctx.settings.get().then(applySettings).catch(() => {});
  ctx.settings.onChange(applySettings);

  /* ---- events: everything the platform emits, front and back --------------------------- */
  ctx.events.on('album.opened', p => seen.push('album.opened ' + p.id));
  ctx.events.on('frame.selected', p => seen.push('frame.selected ' + (p.index ?? p.step)));
  ctx.events.on('theme.changed', p => ui.toast('主题已切换：' + (p.id || '官方')));
  ctx.events.on('page.published', p => seen.push('page.published ' + p.albumId + ':' + p.index));
  ctx.events.on('styles.changed', p => seen.push('styles.changed ' + p.kind));

  /* ---- anchors: named places inside the core UI ------------------------------------------- */
  ctx.anchors.register('topbar', {
    id: 'badge', live: true, order: 10,
    html: () => h`<button type="button" class="sk-badge" title="Studio Kit · 打开实验室 (⌘/Ctrl+Shift+K)">${settings.badge || 'KIT'}</button>`,
    render(el) { el.innerHTML = h`<button type="button" class="sk-badge" title="Studio Kit · 打开实验室 (⌘/Ctrl+Shift+K)">${settings.badge || 'KIT'}</button>`; el.firstChild.onclick = () => ui.settingsTab('lab'); }
  });
  ctx.anchors.register('sidebar-nav', { id: 'lab', label: '实验室', icon: 'notebook', title: 'Studio Kit 实验室', cls: 'btn small ghost', run: () => ui.settingsTab('lab') });
  ctx.anchors.register('statusbar', { id: 'events', live: true, html: () => h`<span class="sk-status">Kit · ${seen.length} 个事件</span>` });
  ctx.anchors.register('creation-tabs', { id: 'notebook', label: '笔记', icon: 'notebook', run: () => ui.navigate('notebook') });

  /* ---- mount: hang UI next to any element the core renders -------------------------------- */
  ctx.mount({
    id: 'frame-tip', selector: '.workshop-page-title, .quiet-scene-top', position: 'after', max: 1,
    html: () => '<small class="sk-frame-tip">Studio Kit：提示词会自动追加「' + ui.esc(settings.suffix || '（未设置后缀）') + '」</small>'
  });

  /* ---- patch: wrap a core function; restored automatically on disable --------------------- */
  ctx.patch('renderShell', function (next, ...args) {
    const result = next(...args);
    const crumb = document.querySelector('#topbar .breadcrumb strong');
    if (crumb && !crumb.dataset.skTouched) { crumb.dataset.skTouched = '1'; crumb.title = 'renderShell 已被 studio-kit 包装 — 这是一个 ctx.patch 示例'; }
    return result;
  });

  /* ---- filters: the core asks for the final value at named points ------------------------- */
  ctx.filters.add('prompt.compose', text => settings.suffix && !text.includes(settings.suffix) ? text.replace(/[,\s]+$/, '') + ', ' + settings.suffix : text);
  ctx.filters.add('command.items', items => [{ title: 'Studio Kit · 打开实验室', type: '扩展 · studio-kit', icon: 'notebook', run: () => ui.settingsTab('lab') }, ...items]);

  /* ---- keys: global shortcut ------------------------------------------------------------- */
  ctx.keys.register('mod+shift+k', () => ui.settingsTab('lab'), { description: '打开 Studio Kit 实验室' });

  /* ---- settings page (slots.settings) ---------------------------------------------------- */
  ctx.slots.settings.register({
    id: 'lab', label: 'Studio Kit', icon: 'notebook', kicker: 'Studio Kit · 实验室', description: '后台任务、原始响应、跨扩展 API 与核心直达接口的演示页。',
    async render(root) {
      root.className = 'sk-lab';
      const tasks = await ctx.tasks.list().catch(() => []);
      root.innerHTML = h`
        <section class="settings-section"><h3>后台任务（Python ctx.tasks.spawn）</h3>
          <p class="soft small">任务在扩展进程里运行，不占用请求线程；这里轮询进度并可取消。</p>
          <div class="row">${ui.button('启动 20 步任务', 'play', 'sk-task-start', '', 'small primary')}${ui.button('刷新', 'refresh', 'sk-refresh', '', 'small ghost')}</div>
          <div id="sk-tasks">${tasks.map(t => h`<div class="sk-task"><code>${t.id}</code><span>${t.name}</span><progress max="1" value="${t.progress}"></progress><span>${t.status} ${t.message}</span>${t.status === 'running' ? `<button type="button" class="btn small ghost" data-act="sk-task-cancel" data-id="${ui.esc(t.id)}">取消</button>` : ''}</div>`).join('') || '<p class="soft small">还没有任务。</p>'}</div>
        </section>
        <section class="settings-section"><h3>原始响应（ctx.response / ctx.file）</h3>
          <p class="soft small">Python 路由可以直接返回 HTML、SVG、CSV 或任意文件，而不只是 JSON。</p>
          <div class="row"><a class="btn small ghost" href="${ctx.api.url('/report')}" target="_blank" rel="noopener">在新标签打开 HTML 报告 ↗</a><a class="btn small ghost" href="${ctx.api.url('/manifest-file')}" download>下载清单文件</a></div>
          <img alt="由 Python 生成的 SVG" src="${ctx.api.url('/badge.svg?text=studio-kit')}" style="margin-top:12px;height:32px">
        </section>
        <section class="settings-section"><h3>核心直达（ctx.core）</h3>
          <p class="soft small">当前工作区：<code>${String(core.ui.workspace)}</code> · 画册 ${core.state.books.length} 本 · 企划 ${core.state.projects.length} 个 · 主题模式 ${ctx.theme.mode()}</p>
          <div class="row">${ui.button('切换深浅色', 'sun', 'sk-toggle-mode', '', 'small ghost')}${ui.button('弹出核心 modal', 'box', 'sk-modal', '', 'small ghost')}</div>
        </section>
        <section class="settings-section"><h3>跨扩展 API</h3>
          <p class="soft small">其他扩展可以通过 <code>ctx.extensions.get('studio-kit')</code> 调用 <code>note(text)</code> 与 <code>events()</code>。</p>
          <pre class="mio-log">${seen.slice(-12).join('\n') || '（尚未收到事件）'}</pre>
        </section>`;
      root.onclick = async event => {
        const button = event.target.closest('[data-act]'); if (!button) return;
        const act = button.dataset.act;
        if (act === 'sk-task-start') { const { id } = await ctx.api('/tasks/start', { steps: 20 }); ui.toast('任务已启动 ' + id); ctx.tasks.wait(id, { onProgress: () => this.render(root) }).then(() => { ui.toast('任务完成'); this.render(root); }).catch(e => ui.toast(e.message, 'error')); }
        if (act === 'sk-task-cancel') { await ctx.tasks.cancel(button.dataset.id); this.render(root); }
        if (act === 'sk-refresh') this.render(root);
        if (act === 'sk-toggle-mode') { ctx.theme.setMode(ctx.theme.mode() === 'dark' ? 'light' : 'dark'); this.render(root); }
        if (act === 'sk-modal') core.modal('来自扩展的弹窗', '<p>这是 ctx.core.modal —— 与工作室自己的弹窗完全一样。</p>');
      };
    }
  });

  /* ---- navigation page ----------------------------------------------------------------- */
  ctx.slots.nav.register({
    id: 'notebook', label: '工作室笔记', icon: 'notebook', order: 10, kicker: 'Studio Kit · 示例工作区',
    description: '这一整页由扩展渲染。它可以读取当前画册，调用扩展自己的 Python 接口，也可以打开阅读器或跳转到分镜。',
    async render(root) {
      const current = albums.current();
      const log = await ctx.api('/log').catch(e => ({ events: [], error: e.message }));
      root.innerHTML = h`
        <div class="grid2">
          <section class="settings-section"><h3>当前上下文</h3>
            <p>草稿：<strong>${current.plan?.title || '—'}</strong> · 分镜 #${(current.frameIndex ?? 0) + 1}</p>
            <p>${current.frame?.prompt ? '提示词：' + current.frame.prompt.slice(0, 160) : '在“创作画册”里选一格分镜，这里会跟着变化。'}</p>
            <div class="row">${ui.button('回到分镜', 'story', 'sk-goto-frame', '', 'small')}${ui.button('新建示例草稿', 'plus', 'sk-new-album', '', 'small ghost')}</div>
          </section>
          <section class="settings-section"><h3>画册集 (${albums.list().length})</h3>
            ${albums.list().slice(0, 8).map(b => h`<p><button type="button" class="btn small ghost" data-act="sk-open" data-id="${b.id}">${b.title}</button> <small>${b.generatedSteps}/${b.totalSteps} 页</small></p>`).join('') || '<p class="soft">还没有生成的画册。</p>'}
          </section>
        </div>
        <section class="settings-section"><h3>后端事件日志（Python 半边写入 workspace 层）</h3>
          ${log.error ? h`<p class="danger">${log.error}</p>` : ''}
          <pre class="mio-log">${(log.events || []).map(e => e.at + ' ' + e.kind + ' ' + JSON.stringify(e.payload)).join('\n') || '（暂无事件；生成一页后再来看）'}</pre>
          <div class="row">${ui.button('清空日志', 'trash', 'sk-clear-log', '', 'small ghost')}${ui.button('刷新', 'refresh', 'sk-refresh', '', 'small ghost')}</div>
        </section>
        <section class="settings-section"><h3>前端事件</h3><pre class="mio-log">${seen.slice(-20).join('\n') || '（尚未收到事件）'}</pre></section>`;
      root.onclick = async event => {
        const button = event.target.closest('[data-act]'); if (!button) return;
        const act = button.dataset.act;
        if (act === 'sk-goto-frame') ui.navigate(1);
        if (act === 'sk-new-album') { albums.create('Studio Kit 示例草稿'); ui.toast('已创建草稿'); }
        if (act === 'sk-open') albums.open(button.dataset.id);
        if (act === 'sk-clear-log') { await ctx.api('/log/clear', {}); this.render(root); }
        if (act === 'sk-refresh') this.render(root);
      };
    }
  });

  /* ---- dock panel ---------------------------------------------------------------------- */
  ctx.slots.dock.register({
    id: 'events', title: '事件流', icon: 'notebook',
    render(root) {
      root.innerHTML = h`<p class="soft small">最近的平台事件（前端 + 后端中继）。</p><pre class="mio-log">${ctx.events.recent().slice(-15).map(r => r.source + ' → ' + r.event).join('\n') || '（空）'}</pre>`;
    }
  });

  /* ---- reader inspector ---------------------------------------------------------------- */
  ctx.slots.inspector.register({
    id: 'page-notes', title: 'Studio Kit · 页备注',
    render(root, { book, page }) {
      const key = ('note-' + book.id + '-' + (page?.stepIndex ?? 0)).replace(/[^a-zA-Z0-9_-]/g, '_'); // storage keys: [a-zA-Z0-9_-]
      root.innerHTML = h`<textarea rows="3" class="mio-note" placeholder="给这一页写点备注（保存在扩展 workspace 层）"></textarea><div class="row">${ui.button('保存备注', 'check', 'sk-save-note', '', 'small')}</div>`;
      const area = root.querySelector('textarea');
      ctx.storage.get(key).then(v => { if (v && area.isConnected) area.value = v; }).catch(e => ctx.log(e.message));
      root.querySelector('[data-act="sk-save-note"]').onclick = async () => { await ctx.storage.set(key, area.value.slice(0, 2000)); ui.toast('备注已保存'); };
    }
  });

  /* ---- quick actions ------------------------------------------------------------------- */
  ctx.slots.frameCard.register({
    id: 'tag-frame', label: '标记重点', icon: 'star', title: '在提示词前加 (masterpiece) 标记',
    when: c => !!c.frame,
    run(c) { const patch = { prompt: '(masterpiece) ' + c.frame.prompt.replace(/^\(masterpiece\) /, '') }; if (c.plan?.templateId && !c.story) albums.updateFrame(c.plan.id, c.index, patch); else albums.updateStoryFrame(c.story?.id, c.index, patch); ui.toast('已标记分镜 #' + (c.index + 1)); }
  });
  ctx.slots.albumCard.register({
    id: 'summarize', label: '', icon: 'spark', title: '用 LLM 生成一句话简介（Python 半边）',
    async run(c) { const r = await ctx.api('/summarize', { albumId: c.id }); ui.toast('简介：' + r.synopsis); }
  });
  ctx.slots.contextMenu.register({ id: 'star-album', label: '星标并置顶（Studio Kit）', icon: 'star', kinds: ['album'], run(c) { albums.update(c.id, { liked: true }); } });
  ctx.slots.contextMenu.register({ id: 'copy-prompt', label: '复制这一格的提示词', icon: 'copy', kinds: ['frame'], run(c) { navigator.clipboard?.writeText(c.frame?.prompt || ''); ui.toast('已复制'); } });
  ctx.slots.toolbar.register({ id: 'open-notebook', label: '笔记', icon: 'notebook', run: () => ui.navigate('notebook') });
  ctx.slots.commands.register({ id: 'open-notebook', title: '打开工作室笔记', icon: 'notebook', run: () => ui.navigate('notebook') });

  /* ---- browser-side exporter ----------------------------------------------------------- */
  ctx.exporters.register({
    id: 'script-txt', label: '脚本文本 (.txt)', extension: 'txt', mime: 'text/plain',
    run(album) {
      const text = [album.title, '', ...album.steps.map(s => '#' + (s.stepIndex + 1) + ' ' + s.name + '\n' + (s.caption || '') + '\n' + s.prompt)].join('\n');
      return { blob: new Blob([text], { type: 'text/plain;charset=utf-8' }), filename: album.title + '.txt' };
    }
  });

  /* ---- an extension-provided icon (shows up as ctx.ui.icon('notebook')) ------------------ */
  ctx.icons.mount({ notebook: '<path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6z"/><path d="M6 3v18"/><path d="M9 8h6M9 12h6"/>' });

  ctx.settings.get().then(v => { if (v.dockOnStart) document.querySelector('#mio-dock-toggle')?.click(); }).catch(() => {});
  ctx.onDispose(() => ctx.log('studio-kit disposed'));
  ctx.log('studio-kit ready (SDK ' + ctx.apiVersion + (ctx.dev ? ', linked folder' : '') + ')');

  /* ---- cross-extension API ------------------------------------------------------------- */
  return {
    api: { note: text => ctx.api('/log/note', { text }), events: () => seen.slice() },
    dispose() { /* everything else is owner-scoped and cleaned up by the platform */ }
  };
}
