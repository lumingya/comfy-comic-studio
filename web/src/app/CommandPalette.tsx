import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { create } from 'zustand';
import { useAllEpisodes } from '../api/series';
import { useHelp, useQuickStart } from '../components/HelpDrawer';
import { setLocale } from '../i18n';
import { Icon, type IconName } from './icons';
import { NAV } from './nav';
import { useThemeToggle } from './useTheme';
import { useUI } from './ui-store';

export const useCommand = create<{ open: boolean; set: (open: boolean) => void }>((set) => ({
  open: false,
  set: (open) => set({ open }),
}));

type Kind = 'action' | 'pref' | 'help' | 'go' | 'album' | 'story';
interface Command {
  id: string;
  label: string;
  kind: Kind;
  icon: IconName;
  run: () => void;
}

/** ⌘K / Ctrl+K global command palette (legacy #command-dialog). */
export function CommandPalette() {
  const { t, i18n } = useTranslation();
  const open = useCommand((s) => s.open);
  const set = useCommand((s) => s.set);
  const navigate = useNavigate();
  const theme = useThemeToggle();
  const studio = useUI((s) => s.studioMode);
  const setStudio = useUI((s) => s.setStudioMode);
  const openHelp = useHelp((s) => s.set);
  const openQuick = useQuickStart((s) => s.set);
  const { groups } = useAllEpisodes();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        set(!useCommand.getState().open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [set]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setQuery('');
      setActive(0);
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    } else if (!open && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => navigate(to);
    const firstEpisode = groups.find((g) => g.episodes.length)?.episodes[0];
    return [
      {
        id: 'new-story',
        label: t('legacy.workshop.newStory'),
        kind: 'action',
        icon: 'plus',
        run: go(firstEpisode ? '/workshop' : '/gallery?new=1'),
      },
      {
        id: 'new-album',
        label: t('legacy.palette.newAlbum'),
        kind: 'action',
        icon: 'book',
        run: go('/gallery?new=1'),
      },
      {
        id: 'queue',
        label: t('legacy.palette.queue'),
        kind: 'action',
        icon: 'nodes',
        run: go('/jobs'),
      },
      {
        id: 'theme',
        label: theme.mode === 'dark' ? t('legacy.palette.toLight') : t('legacy.palette.toDark'),
        kind: 'pref',
        icon: 'sun',
        run: theme.toggle,
      },
      {
        id: 'lang',
        label: t('legacy.palette.language'),
        kind: 'pref',
        icon: 'spark',
        run: () => setLocale(i18n.language === 'en' ? 'zh-CN' : 'en'),
      },
      {
        id: 'studio',
        label: studio ? t('legacy.palette.studioOff') : t('legacy.palette.studioOn'),
        kind: 'pref',
        icon: 'brush',
        run: () => setStudio(!studio),
      },
      {
        id: 'help',
        label: t('legacy.help'),
        kind: 'help',
        icon: 'help',
        run: () => openHelp(true),
      },
      {
        id: 'quickstart',
        label: t('guide.quickstart'),
        kind: 'help',
        icon: 'help',
        run: () => openQuick(true),
      },
      {
        id: 'resources',
        label: t('guide.resources'),
        kind: 'help',
        icon: 'box',
        run: go('/settings?tab=resources'),
      },
      ...NAV.map<Command>((n) => ({
        id: `go-${n.to}`,
        label: t(n.label),
        kind: 'go',
        icon: n.icon,
        run: go(n.to),
      })),
      ...groups.map<Command>((g) => ({
        id: `album-${g.series.id}`,
        label: g.series.title,
        kind: 'album',
        icon: 'book',
        run: go(`/gallery/${g.series.id}`),
      })),
      ...groups.flatMap((g) =>
        g.episodes.map<Command>((e) => ({
          id: `story-${e.id}`,
          label: `${e.title} · ${g.series.title}`,
          kind: 'story',
          icon: 'story',
          run: go(`/workshop/${e.id}/script`),
        })),
      ),
    ];
  }, [groups, i18n.language, navigate, openHelp, openQuick, setStudio, studio, t, theme]);

  const q = query.trim().toLowerCase();
  const shown = q
    ? commands.filter((c) =>
        `${c.label} ${t(`legacy.palette.kinds.${c.kind}`)}`.toLowerCase().includes(q),
      )
    : commands;
  const at = Math.min(active, Math.max(shown.length - 1, 0));

  const run = (c: Command | undefined) => {
    if (!c) return;
    set(false);
    c.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next =
        (at + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % Math.max(shown.length, 1);
      setActive(next);
      list.current?.children[next]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(shown[at]);
    }
  };

  return (
    <dialog
      ref={dialog}
      id="command-dialog"
      className="command-dialog"
      aria-label={t('legacy.palette.label')}
      onClose={() => set(false)}
      onCancel={() => set(false)}
      onClick={(e) => e.target === dialog.current && set(false)}
    >
      {open ? (
        <>
          <div className="command-input">
            <span id="command-icon">
              <Icon name="search" />
            </span>
            <input
              type="text"
              id="command-input"
              autoComplete="off"
              autoFocus
              value={query}
              placeholder={t('legacy.palette.placeholder')}
              aria-label={t('legacy.palette.label')}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
            />
            <span>
              <button
                type="button"
                className="ibtn"
                title={t('legacy.palette.close')}
                aria-label={t('legacy.palette.close')}
                onClick={() => set(false)}
              >
                <Icon name="close" />
              </button>
            </span>
          </div>
          <div className="command-results" id="command-results" ref={list} role="listbox">
            {shown.length ? (
              shown.map((c, i) => (
                <button
                  key={c.id}
                  role="option"
                  aria-selected={i === at}
                  className={`command-item ${i === at ? 'active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => run(c)}
                >
                  <Icon name={c.icon} />
                  <span className="ellipsis">{c.label}</span>
                  <small>{t(`legacy.palette.kinds.${c.kind}`)}</small>
                </button>
              ))
            ) : (
              <p className="command-empty">{t('legacy.palette.empty')}</p>
            )}
          </div>
          <div className="command-footer">{t('legacy.palette.footer')}</div>
        </>
      ) : null}
    </dialog>
  );
}
