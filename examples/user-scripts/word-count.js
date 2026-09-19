/* 状态栏字数：ctx.slots.statusbar 是一个“挂载槽位”，live:true 表示每次界面重绘后都会重新渲染。 */
export default function (ctx) {
  ctx.slots.statusbar.register({
    id: 'words', live: true,
    render(el) {
      const frame = ctx.albums.current().frame;
      const n = (frame?.prompt || '').trim().length;
      el.textContent = n ? `提示词 ${n} 字` : '';
    }
  });
}
