import {
  BookOpen,
  History,
  Languages,
  ListTodo,
  Moon,
  Settings,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useJobEvents, useJobs, useLive } from '../api/jobs';
import { useThemes, useUpdateStatus } from '../api/open';
import { ConfirmHost } from '../components/confirm';
import { Toaster } from '../components/toast';
import { setLocale } from '../i18n';
import { useRecents } from './recents';
import { applyTheme, resolveTheme, systemPrefersDark, toggled } from './theme';
import { useUI } from './ui-store';

/** Resolve the chosen theme (or the OS preference) and keep <html> in sync. */
function useAppliedTheme() {
  const choice = useUI((s) => s.theme);
  const themes = useThemes();
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setPrefersDark(query.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);

  const resolved = resolveTheme(choice, themes.data ?? [], prefersDark);
  useEffect(() => {
    applyTheme(document.documentElement, resolved.mode, resolved.theme);
  }, [resolved.mode, resolved.theme]);
  return resolved;
}

function ActiveJobsBadge() {
  const { t } = useTranslation();
  const { data } = useJobs(undefined, true);
  const n = data?.length ?? 0;
  return n ? (
    <span className="rail-badge" title={t('jobs.activeCount', { count: n })}>
      {n}
    </span>
  ) : null;
}

/** Episodes opened lately: one click back into the work, from anywhere. */
function RecentEpisodes() {
  const { t } = useTranslation();
  const items = useRecents((s) => s.items);
  const forget = useRecents((s) => s.forget);
  if (!items.length) return null;
  const link = ({ isActive }: { isActive: boolean }) =>
    `rail-link rail-recent ${isActive ? 'active' : ''}`;
  return (
    <div className="rail-recents" aria-label={t('nav.recent')}>
      <div className="rail-section">
        <History size={11} /> {t('nav.recent')}
      </div>
      {items.map((r) => (
        <div key={r.id} className="rail-recent-row">
          <NavLink
            to={`/episodes/${r.id}`}
            className={link}
            title={`${r.seriesTitle} · ${r.title}`}
          >
            <span className="rail-recent-title ellipsis">{r.title}</span>
            <span className="rail-recent-series ellipsis">{r.seriesTitle}</span>
          </NavLink>
          <button
            className="rail-recent-forget"
            aria-label={t('nav.removeRecent', { title: r.title })}
            title={t('nav.removeRecent', { title: r.title })}
            onClick={() => forget(r.id)}
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

function Version() {
  const { data } = useUpdateStatus();
  return data?.current ? <span className="rail-version">{data.current}</span> : null;
}

export function Shell() {
  const { t, i18n } = useTranslation();
  const setTheme = useUI((s) => s.setTheme);
  const recentThemes = useUI((s) => s.recentThemes);
  const theme = useAppliedTheme();
  const connected = useLive((s) => s.connected);
  useJobEvents();

  const link = ({ isActive }: { isActive: boolean }) => `rail-link ${isActive ? 'active' : ''}`;

  return (
    <div className="shell">
      <nav className="rail" aria-label={t('nav.main')}>
        <Link to="/" className="brand" aria-label={t('app.name')}>
          <span className="brand-mark">{t('app.name')}</span>
          <span className="brand-sub">{t('app.tagline')}</span>
        </Link>
        <NavLink to="/" end className={link} title={t('nav.works')}>
          <BookOpen size={17} /> <span className="rail-label">{t('nav.works')}</span>
        </NavLink>
        <NavLink to="/jobs" className={link} title={t('nav.jobs')}>
          <ListTodo size={17} /> <span className="rail-label">{t('nav.jobs')}</span>
          <ActiveJobsBadge />
        </NavLink>
        <NavLink to="/settings" className={link} title={t('nav.settings')}>
          <Settings size={17} /> <span className="rail-label">{t('nav.settings')}</span>
        </NavLink>
        <NavLink to="/trash" className={link} title={t('nav.trash')}>
          <Trash2 size={17} /> <span className="rail-label">{t('nav.trash')}</span>
        </NavLink>
        <RecentEpisodes />
        <div className="rail-foot">
          <button
            className="btn ghost icon"
            title={t('nav.theme')}
            aria-label={t('nav.theme')}
            onClick={() => {
              const next = toggled(theme.mode, recentThemes);
              setTheme(next, theme.mode === 'dark' ? 'light' : 'dark');
            }}
          >
            {theme.mode === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button
            className="btn ghost sm"
            title={t('nav.language')}
            onClick={() => setLocale(i18n.language === 'en' ? 'zh-CN' : 'en')}
          >
            <Languages size={15} /> <span className="btn-label">{t('nav.language')}</span>
          </button>
          <Version />
        </div>
      </nav>
      <main className="main">
        {connected === false ? <div className="offline-banner">{t('app.offline')}</div> : null}
        <Outlet />
      </main>
      <Toaster />
      <ConfirmHost />
    </div>
  );
}
