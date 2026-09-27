import type { IconName } from './icons';

/** The legacy sidebar: home, collection, workshop, workflows & APIs, settings. */
export const NAV: readonly {
  to: string;
  key: string;
  icon: IconName;
  label: string;
  short?: string;
  match: (path: string) => boolean;
}[] = [
  { to: '/', key: '0', icon: 'home', label: 'legacy.nav.home', match: (p) => p === '/' },
  {
    to: '/gallery',
    key: '1',
    icon: 'book',
    label: 'legacy.nav.gallery',
    match: (p) => p.startsWith('/gallery') || p.startsWith('/series/'),
  },
  {
    to: '/workshop',
    key: '2',
    icon: 'story',
    label: 'legacy.nav.workshop',
    match: (p) => p.startsWith('/workshop') || p.startsWith('/jobs'),
  },
  {
    to: '/engine',
    key: '3',
    icon: 'nodes',
    label: 'legacy.nav.engine',
    short: 'legacy.nav.engineShort',
    match: (p) => p.startsWith('/engine'),
  },
  {
    to: '/settings',
    key: ',',
    icon: 'settings',
    label: 'legacy.nav.settings',
    match: (p) => p.startsWith('/settings') || p.startsWith('/trash'),
  },
];
