/* 保存提醒：ctx.around('save', wrapper) 包装核心的 save()。wrapper 收到 next（原函数或下一层）和原参数；
   忘记调用 next 也不会丢数据吗？会——所以务必返回 next(...args)。出错时平台会自动回退到原函数。 */
export default function (ctx) {
  let saves = 0, last = Date.now();
  const stop = ctx.around('save', (next, ...args) => { saves += 1; last = Date.now(); return next(...args); });
  ctx.slots.statusbar.register({ id: 'saves', live: true, render(el) { el.textContent = `已保存 ${saves} 次`; } });
  const timer = setInterval(() => { if (Date.now() - last > 10 * 60 * 1000) { ctx.ui.toast('已有 10 分钟没有保存了'); last = Date.now(); } }, 60 * 1000);
  return () => { clearInterval(timer); stop(); };
}
