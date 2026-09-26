// Theme scripts run when the theme is enabled and are torn down when it is disabled.
// `ctx` has: id, settings (current values), onSettings(fn), core (the studio API), styles.add(css),
// mount(selector, position, html), log(...). Return a dispose function.
export default function (ctx) {
  let stamp = null;
  const sync = (values) => {
    if (values.stamp !== false && !stamp) {
      stamp = document.createElement('div');
      stamp.className = 'paper-stamp';
      stamp.textContent = '绘页';
      document.body.appendChild(stamp);
    } else if (values.stamp === false && stamp) {
      stamp.remove();
      stamp = null;
    }
  };
  sync(ctx.settings);
  const off = ctx.onSettings(sync);
  ctx.log('纸间 · 手作工坊 已加载');
  return () => { off(); if (stamp) stamp.remove(); };
}
