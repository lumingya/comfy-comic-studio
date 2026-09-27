/** The legacy line icons (legacy/js/app.js `paths`), drawn with the legacy `svg.icon` stroke. */
import type { CSSProperties } from 'react';

const PATHS = {
  grid: "<rect x='3' y='3' width='7' height='7' rx='1'/><rect x='14' y='3' width='7' height='7' rx='1'/><rect x='3' y='14' width='7' height='7' rx='1'/><rect x='14' y='14' width='7' height='7' rx='1'/>",
  story: "<rect x='3' y='4' width='18' height='16' rx='2'/><path d='M3 10h18M10 10v10'/>",
  users:
    "<circle cx='9' cy='8' r='3'/><path d='M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5'/>",
  nodes:
    "<rect x='3' y='3' width='6' height='6' rx='1'/><rect x='15' y='15' width='6' height='6' rx='1'/><path d='M6 9v9h9M15 6h6M18 3v6'/>",
  spark: "<path d='m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3ZM20 2v4M18 4h4'/>",
  search: "<circle cx='10.5' cy='10.5' r='6.5'/><path d='m16 16 4.5 4.5'/>",
  plus: "<path d='M12 5v14M5 12h14'/>",
  down: "<path d='m6 9 6 6 6-6'/>",
  up: "<path d='m6 15 6-6 6 6'/>",
  star: "<path d='m12 3 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3L12 17.4l-5.6 3 1.1-6.3L3 9.6l6.2-.9L12 3Z'/>",
  folder:
    "<path d='M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z'/>",
  book: "<path d='M12 5c-3-2-7-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-3-1-7-1-10 1ZM12 5v15'/>",
  image:
    "<rect x='3' y='3' width='18' height='18' rx='2'/><circle cx='8' cy='8' r='1.5'/><path d='m21 15-5-5L6 21'/>",
  check: "<path d='m5 12 4 4L19 6'/>",
  shield: "<path d='m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z'/><path d='m8 12 3 3 5-5'/>",
  download: "<path d='M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5'/>",
  upload: "<path d='M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5'/>",
  box: "<path d='m12 3 9 5v9l-9 5-9-5V8l9-5ZM3 8l9 5 9-5M12 13v9M7.5 5.5l9 5'/>",
  settings:
    "<path d='M4 7h16M4 17h16'/><circle cx='9' cy='7' r='3' fill='var(--bg)'/><circle cx='16' cy='17' r='3' fill='var(--bg)'/>",
  sun: "<circle cx='12' cy='12' r='4'/><path d='M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1'/>",
  play: "<path d='m7 4 14 8-14 8V4Z'/>",
  pause: "<path d='M8 4v16M16 4v16'/>",
  stop: "<rect x='5' y='5' width='14' height='14' rx='2'/>",
  refresh: "<path d='M20 8a8 8 0 1 0 0 8M20 3v6h-6'/>",
  more: "<circle cx='5' cy='12' r='1'/><circle cx='12' cy='12' r='1'/><circle cx='19' cy='12' r='1'/>",
  list: "<path d='M8 5h13M8 12h13M8 19h13M3 5h.1M3 12h.1M3 19h.1'/>",
  copy: "<rect x='8' y='8' width='13' height='13' rx='2'/><path d='M16 8V3H3v13h5'/>",
  trash: "<path d='M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7'/>",
  edit: "<path d='m14 5 5 5M4 15 16 3a2 2 0 0 1 5 5L9 20l-6 1 1-6Z'/>",
  arrow: "<path d='M5 12h14m-5-5 5 5-5 5'/>",
  close: "<path d='m6 6 12 12M6 18 18 6'/>",
  terminal: "<path d='m4 6 6 6-6 6M13 18h7'/>",
  clock: "<circle cx='12' cy='12' r='9'/><path d='M12 7v5l3 2'/>",
  disk: "<path d='M3 3h15l3 3v15H3V3ZM7 3v6h10V3M7 21v-8h10v8'/>",
  expand: "<path d='M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5'/>",
  attach: "<path d='m8 13 7-7a3 3 0 0 1 4 4L9 20a5 5 0 0 1-7-7L13 2'/>",
  send: "<path d='m22 2-7 20-4-9-9-4 20-7ZM11 13 22 2'/>",
  eye: "<path d='M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z'/><circle cx='12' cy='12' r='3'/>",
  compare:
    "<rect x='3' y='4' width='7' height='16' rx='1'/><rect x='14' y='4' width='7' height='16' rx='1'/>",
  help: "<circle cx='12' cy='12' r='9'/><path d='M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3M12 17h.1'/>",
  brush: "<path d='m14 6 4 4M8 14 18 3a2 2 0 0 1 3 3L11 17M10 15c-7-3-3 6-8 6 7 1 10-2 8-6Z'/>",
  home: "<path d='m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-8H9v8H4a1 1 0 0 1-1-1Z'/>",
  link: "<path d='M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1'/><path d='M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'/>",
  moon: "<path d='M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z'/>",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  sm,
  className = '',
  style,
}: {
  name: IconName;
  sm?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      className={`icon ${sm ? 'sm' : ''} ${className}`}
      viewBox="0 0 24 24"
      aria-hidden
      style={style}
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}
