/* 场记本 — the smallest useful SDK v3 extension.
   Front end: a toolbar button, a dock panel, a topbar anchor button and a custom variable type.
   Back end (plugin.py): two JSON routes storing notes in the extension's workspace tier.
   Tip: link this folder in 设置 → 扩展中心 → 链接本地文件夹; edits hot-reload. */
export default async function setup(ctx) {
  ctx.anchors.register('topbar', { id: 'quick-note', icon: 'edit', title: '场记本 · 记一笔', run: () => ctx.slots.toolbar.find('scene-notebook:note')?.run({ plan: ctx.albums.current().plan }) });

  ctx.variables.registerType('palette', { label: '场记本 · 配色词', normalize: value => String(value || '').split(',').map(s => s.trim()).filter(Boolean).join(', ') });

  ctx.slots.toolbar.register({
    id: 'note', label: '记一笔', icon: 'edit',
    async run(context) {
      const title = context.plan?.title || '未命名画册';
      await ctx.api('/notes', { title, text: '一次新的创作记录', createdAt: Date.now() });
      ctx.ui.toast('已记录到扩展的 workspace 数据层。');
    }
  });

  ctx.slots.dock.register({
    id: 'notebook', title: '场记本', icon: 'edit',
    async render(root) {
      const notes = await ctx.api('/notes');
      root.textContent = '';
      if (!notes.length) { root.textContent = '还没有记录，点击分镜工具栏的“记一笔”开始。'; return; }
      for (const note of notes) { const row = document.createElement('p'); row.textContent = note.title + ' · ' + note.text; root.append(row); }
    }
  });

  ctx.events.on('album.created', p => ctx.api('/notes', { title: p.title, text: '新建画册', createdAt: Date.now() }));
  return () => {}; // Everything registered through ctx is removed automatically on disable.
}
