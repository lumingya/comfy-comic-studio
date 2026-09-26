import * as Dialog from '@radix-ui/react-dialog';
import { CircleHelp, X } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { create } from 'zustand';

export const useHelp = create<{ open: boolean; set: (open: boolean) => void }>((set) => ({
  open: false,
  set: (open) => set({ open }),
}));

/** Which help page applies to a route. */
export function helpPageFor(pathname: string): HelpPage {
  if (/\/episodes\/[^/]+\/script/.test(pathname)) return 'script';
  if (/\/episodes\/[^/]+\/board/.test(pathname)) return 'board';
  if (/\/episodes\/[^/]+\/canvas/.test(pathname)) return 'canvas';
  if (/\/series\/[^/]+\/bible/.test(pathname)) return 'bible';
  if (pathname.startsWith('/jobs')) return 'jobs';
  if (pathname.startsWith('/settings')) return 'settings';
  return 'works';
}

export type HelpPage = 'works' | 'bible' | 'script' | 'board' | 'canvas' | 'jobs' | 'settings';

/** Item keys per page (text lives in i18n under help.pages.<page>.items.<key>). */
const ITEMS: Record<HelpPage, string[]> = {
  works: ['create', 'open', 'search', 'trash'],
  bible: ['characters', 'refs', 'variables', 'styles'],
  script: [
    'prompt',
    'description',
    'camera',
    'select',
    'menu',
    'batch',
    'io',
    'render',
    'history',
    'preview',
  ],
  board: ['render', 'adopt', 'candidates', 'edit', 'qa'],
  canvas: ['layout', 'lettering', 'export'],
  jobs: ['progress', 'retry', 'uncertain'],
  settings: ['comfy', 'profiles', 'llm', 'themes', 'tokens'],
};

const SHORTCUTS: [string, string][] = [
  ['?', 'help'],
  ['Ctrl+S', 'save'],
  ['Ctrl+A', 'all'],
  ['Esc', 'clear'],
  ['Del', 'delete'],
  ['↑ / ↓', 'move'],
  ['Shift+点击', 'range'],
  ['Ctrl+点击', 'toggle'],
  ['右键', 'menu'],
];

const isEditable = (el: EventTarget | null) =>
  el instanceof HTMLElement && !!el.closest('input, textarea, select, [contenteditable=true]');

/** `?` anywhere (outside text fields) opens the help for the current page. */
export function useHelpShortcut() {
  const set = useHelp((s) => s.set);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?' && !isEditable(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        set(!useHelp.getState().open);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [set]);
}

export function HelpButton() {
  const { t } = useTranslation();
  const set = useHelp((s) => s.set);
  return (
    <button
      className="btn ghost icon"
      title={`${t('help.title')} (?)`}
      aria-label={t('help.title')}
      onClick={() => set(true)}
    >
      <CircleHelp size={16} />
    </button>
  );
}

/** Side drawer: what this page does, its operations and the keyboard shortcuts. */
export function HelpDrawer() {
  const { t } = useTranslation();
  const open = useHelp((s) => s.open);
  const set = useHelp((s) => s.set);
  const page = helpPageFor(useLocation().pathname);
  return (
    <Dialog.Root open={open} onOpenChange={set}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="drawer" aria-describedby={undefined}>
          <Dialog.Close asChild>
            <button className="btn ghost icon sm dialog-close" aria-label={t('common.close')}>
              <X size={16} />
            </button>
          </Dialog.Close>
          <Dialog.Title>{t(`help.pages.${page}.title`)}</Dialog.Title>
          <p className="dialog-desc">{t(`help.pages.${page}.intro`)}</p>
          <dl className="help-list">
            {ITEMS[page].map((key) => (
              <div key={key}>
                <dt>{t(`help.pages.${page}.items.${key}.q`)}</dt>
                <dd>{t(`help.pages.${page}.items.${key}.a`)}</dd>
              </div>
            ))}
          </dl>
          <h3 className="help-sub">{t('help.shortcuts')}</h3>
          <dl className="help-keys">
            {SHORTCUTS.map(([keys, name]) => (
              <div key={name}>
                <dt>
                  <kbd className="kbd">{keys}</kbd>
                </dt>
                <dd>{t(`help.keys.${name}`)}</dd>
              </div>
            ))}
          </dl>
          <p className="small muted">{t('help.more')}</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
