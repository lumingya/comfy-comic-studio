/* Studio Kit — front-end half (Mio SDK v2).
   `export default function (ctx)` runs once the extension is enabled; returning a function
   registers a dispose hook. Everything registered through ctx is removed automatically when
   the extension is disabled, so dispose only has to undo things done outside the SDK.

   What this file demonstrates:
     ctx.slots.nav         a full page in the left navigation
     ctx.slots.dock        a side panel in the shared extension dock
     ctx.slots.inspector   a section inside the reader's frame inspector
     ctx.slots.frameCard   quick action on the active storyboard frame
     ctx.slots.albumCard   quick action on album cards
     ctx.slots.contextMenu right-click entries for albums and frames
     ctx.slots.commands    command palette entries
     ctx.slots.toolbar     storyboard toolbar button
     ctx.exporters         a browser-side exporter (plain-text script)
     ctx.events            listen to album/frame/theme events (front) and backend events (relayed)
     ctx.albums            active control: open, select, update, annotate
     ctx.api               call the Python half's routes (/log, /summarize) */
export default function studioKit(ctx) {
  const { ui, albums } = ctx;
  const seen = [];
  const h = (strings, ...values) => strings.reduce((out, s, i) => out + s + (i < values.length ? ui.esc(values[i]) : ''), '');

  /* ---- events: everything the platform emits, front and back --------------------------- */
  const stopEvents = [
    ctx.events.on('album.opened', p => seen.push('album.opened ' + p.id)),
    ctx.events.on('frame.selected', p => seen.push('frame.selected ' + (p.index ?? p.step))),
    ctx.events.on('theme.changed', p => ui.toast('主题已切换：' + (p.id || '官方'))),
    ctx.events.on('page.published', p => seen.push('page.published ' + p.albumId + ':' + p.index)),
    ctx.events.on('ext:studio-kit:settings.changed', () => ui.toast('设置已更新')),
  ];

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
      const key = 'note:' + book.id + ':' + (page?.stepIndex ?? 0);
      root.innerHTML = h`<textarea rows="3" class="mio-note" placeholder="给这一页写点备注（保存在扩展 workspace 层）"></textarea><div class="row">${ui.button('保存备注', 'check', 'sk-save-note', '', 'small')}</div>`;
      const area = root.querySelector('textarea');
      ctx.storage.get(key).then(v => { if (v && area.isConnected) area.value = v; });
      root.querySelector('[data-act="sk-save-note"]').onclick = async () => { await ctx.storage.set(key, area.value.slice(0, 2000)); ui.toast('备注已保存'); };
    }
  });

  /* ---- quick actions ------------------------------------------------------------------- */
  ctx.slots.frameCard.register({
    id: 'tag-frame', label: '标记重点', icon: 'star', title: '在提示词前加 (masterpiece) 标记',
    when: c => !!c.frame,
    run(c) { albums.updateFrame(c.plan.id, c.index, { prompt: '(masterpiece) ' + c.frame.prompt.replace(/^\(masterpiece\) /, '') }); ui.toast('已标记分镜 #' + (c.index + 1)); }
  });
  ctx.slots.albumCard.register({
    id: 'summarize', label: '', icon: 'spark', title: '用 LLM 生成一句话简介（Python 半边）',
    async run(c) { const r = await ctx.api('/summarize', { albumId: c.id }); ui.toast('简介：' + r.synopsis); }
  });
  ctx.slots.contextMenu.register({
    id: 'star-album', label: '星标并置顶（Studio Kit）', icon: 'star', kinds: ['album'],
    run(c) { albums.update(c.id, { liked: true }); }
  });
  ctx.slots.contextMenu.register({
    id: 'copy-prompt', label: '复制这一格的提示词', icon: 'copy', kinds: ['frame'],
    run(c) { navigator.clipboard?.writeText(c.frame?.prompt || ''); ui.toast('已复制'); }
  });
  ctx.slots.toolbar.register({ id: 'open-notebook', label: '笔记', icon: 'notebook', run: () => ui.navigate('notebook') });
  ctx.slots.commands.register({ id: 'open-notebook', title: '打开工作室笔记', icon: 'notebook', run: () => ui.navigate('notebook') });
  ctx.slots.commands.register({ id: 'export-script', title: '导出当前画册脚本 (.txt)', icon: 'download', run: c => { if (c.book) ui.toast('在画册卡片右键选择“导出 · 脚本”'); else ui.toast('先打开一本画册'); } });

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
  ctx.log('studio-kit ready');
  return () => stopEvents.forEach(stop => stop());
}
