/* 阅读器快捷键：ctx.keymap 绑定全局按键；when 决定何时生效；ctx.core 直达应用函数。 */
export default function (ctx) {
  const readerOpen = () => document.querySelector('#reader')?.open;
  ctx.keymap.add({ id: 'next', keys: 'j', label: '阅读器：下一页', when: readerOpen, run: () => ctx.core.setReaderStep(ctx.core.ui.step + 1) });
  ctx.keymap.add({ id: 'prev', keys: 'k', label: '阅读器：上一页', when: readerOpen, run: () => ctx.core.setReaderStep(Math.max(0, ctx.core.ui.step - 1)) });
  ctx.keymap.add({ id: 'recent', keys: 'mod+shift+r', label: '打开最近更新的画册', run() {
    const latest = [...ctx.albums.list()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    if (latest) ctx.albums.open(latest.id); else ctx.ui.toast('还没有画册');
  } });
}
