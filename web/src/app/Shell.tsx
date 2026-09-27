import {
  BookOpen,
  FolderOpen,
  History,
  Languages,
  ListTodo,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useJobEvents, useJobs, useLive } from '../api/jobs';
import { useThemes, useUpdateStatus } from '../api/open';
import { ConfirmHost } from '../components/confirm';
import { HelpButton, HelpDrawer, useHelpShortcut } from '../components/HelpDrawer';
import { Toaster } from '../components/toast';
import { setLocale } from '../i18n';
import { useComfyHealth } from './comfy';
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

/** The Mio mark: a tilted comic page (the classic favicon). */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg className="brand-logo" width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="16" fill="currentColor" />
      <path
        fill="var(--brand-ink, #15291c)"
        fillRule="evenodd"
        d="M14 12.5h36a2.5 2.5 0 0 1 2.5 2.5v14a2.5 2.5 0 0 1-2.5 2.5H14a2.5 2.5 0 0 1-2.5-2.5V15a2.5 2.5 0 0 1 2.5-2.5Z M39.5 22a4 4 0 1 0 8 0a4 4 0 1 0-8 0Z"
      />
      <path
        fill="var(--brand-ink, #15291c)"
        d="M14 34.5h16.5v17H14a2.5 2.5 0 0 1-2.5-2.5v-12a2.5 2.5 0 0 1 2.5-2.5Z"
      />
      <path
        fill="var(--brand-ink, #15291c)"
        d="M36 34.5h14a2.5 2.5 0 0 1 2.5 2.5v9a2.5 2.5 0 0 1-2.5 2.5h-9.5l-5 4.2v-4.2H36a2.5 2.5 0 0 1-2.5-2.5v-9a2.5 2.5 0 0 1 2.5-2.5Z"
      />
    </svg>
  );
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

function useVersion() {
  const { data } = useUpdateStatus();
  return data?.current ?? '';
}

/** Section name for the top bar, from the path. */
function useSection(): string {
  const { t } = useTranslation();
  const path = useLocation().pathname;
  if (path.startsWith('/jobs')) return t('nav.jobs');
  if (path.startsWith('/settings')) return t('nav.settings');
  if (path.startsWith('/trash')) return t('nav.trash');
  if (path.startsWith('/series/')) {
    if (path.endsWith('/bible')) return t('series.bible');
    if (path.endsWith('/variants')) return t('series.variants');
    return t('series.episodes');
  }
  if (path.startsWith('/episodes/')) {
    const tab = path.split('/')[3] ?? 'script';
    return ['script', 'board', 'canvas', 'read', 'export'].includes(tab)
      ? t(`episode.${tab}`)
      : t('episode.script');
  }
  return t('nav.works');
}

/** ComfyUI reachability with a breathing dot; opens the instance settings. */
function ComfyPill() {
  const { t } = useTranslation();
  const health = useComfyHealth();
  return (
    <Link
      to="/settings?tab=instances"
      className={`status-pill comfy-${health.state}`}
      title={health.detail || t(`classic.comfy.${health.state}`)}
    >
      <span className="dot" aria-hidden />
      <span className="status-pill-label">ComfyUI · {t(`classic.comfy.${health.state}`)}</span>
    </Link>
  );
}

function QueueLink() {
  const { t } = useTranslation();
  const { data } = useJobs(undefined, true);
  const n = data?.length ?? 0;
  return (
    <Link to="/jobs" className={`top-link ${n ? 'busy' : ''}`} title={t('nav.jobs')}>
      <ListTodo size={15} />
      <span className="top-link-label">{t('classic.queue')}</span>
      <span className="kbd">{n}</span>
    </Link>
  );
}

function StatusBar() {
  const { t } = useTranslation();
  const connected = useLive((s) => s.connected);
  const studio = useUI((s) => s.studioMode);
  const { data } = useJobs(undefined, true);
  const running = data?.length ?? 0;
  const version = useVersion();
  return (
    <footer className="statusbar" aria-label={t('classic.statusbar')}>
      <span className={`dot ${connected === false ? 'off' : 'live'}`} aria-hidden />
      <span>{connected === false ? t('classic.reconnecting') : t('classic.liveReady')}</span>
      {running ? (
        <span className="status-running">
          <span className="beacon" aria-hidden />
          {t('classic.running', { count: running })}
        </span>
      ) : null}
      <span className="grow" />
      <Link to="/settings?tab=studio" className="status-mode">
        {studio ? <Sparkles size={11} /> : null}
        {studio ? t('classic.modeStudio') : t('classic.modeClassic')}
      </Link>
      <span>{t('classic.localStorage')}</span>
      {version ? <span className="mono">Mio v{version.replace(/^v/, '')}</span> : null}
    </footer>
  );
}

const NAV = [
  { to: '/', key: '1', icon: BookOpen, label: 'nav.works', end: true },
  { to: '/jobs', key: '2', icon: ListTodo, label: 'nav.jobs' },
  { to: '/settings', key: '3', icon: Settings, label: 'nav.settings' },
  { to: '/trash', key: '4', icon: Trash2, label: 'nav.trash' },
] as const;

export function Shell() {
  const { t, i18n } = useTranslation();
  const setTheme = useUI((s) => s.setTheme);
  const recentThemes = useUI((s) => s.recentThemes);
  const collapsed = useUI((s) => s.navCollapsed);
  const setCollapsed = useUI((s) => s.setNavCollapsed);
  const studio = useUI((s) => s.studioMode);
  const theme = useAppliedTheme();
  const connected = useLive((s) => s.connected);
  const recent = useRecents((s) => s.items[0]);
  const section = useSection();
  const navigate = useNavigate();
  useJobEvents();
  useHelpShortcut();

  // Alt+1…4 jump between the main sections (legacy nav keys).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const item = NAV.find((n) => n.key === e.key);
      if (!item) return;
      e.preventDefault();
      navigate(item.to);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const link = ({ isActive }: { isActive: boolean }) => `rail-link ${isActive ? 'active' : ''}`;

  return (
    <div className={`shell ${collapsed ? 'nav-collapsed' : ''} ${studio ? 'is-studio' : ''}`}>
      <nav className="rail" aria-label={t('nav.main')}>
        <Link to="/" className="brand" aria-label={t('app.name')}>
          <BrandMark />
          <span className="brand-text">
            <span className="brand-mark">{t('app.name')}</span>
            <span className="brand-sub">{t('app.tagline')}</span>
          </span>
        </Link>
        <div className="rail-nav">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={'end' in n ? n.end : undefined}
              className={link}
              title={`${t(n.label)} · Alt+${n.key}`}
            >
              <n.icon size={17} /> <span className="rail-label">{t(n.label)}</span>
              {n.to === '/jobs' ? <ActiveJobsBadge /> : <span className="rail-key">{n.key}</span>}
            </NavLink>
          ))}
        </div>
        <RecentEpisodes />
        <div className="rail-foot">
          <button
            className="rail-collapse"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? t('classic.expandNav') : t('classic.collapseNav')}
            aria-label={collapsed ? t('classic.expandNav') : t('classic.collapseNav')}
          >
            {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            <span className="rail-label">{t('classic.collapseNav')}</span>
          </button>
          <Link to="/settings?tab=studio" className="rail-profile" title={t('classic.modeHint')}>
            <span className="rail-avatar" aria-hidden>
              {t('classic.me')}
            </span>
            <span className="rail-profile-text">
              <strong>{t('classic.studioName')}</strong>
              <small>{studio ? t('classic.modeStudio') : t('classic.modeClassic')}</small>
            </span>
          </Link>
        </div>
      </nav>
      <div className="app">
        <header className="topbar" aria-label={t('classic.toolbar')}>
          {recent ? (
            <Link
              to={`/series/${recent.seriesId}`}
              className="top-project"
              title={recent.seriesTitle}
            >
              <FolderOpen size={15} />
              <span className="ellipsis">{recent.seriesTitle}</span>
            </Link>
          ) : (
            <span className="top-project">
              <FolderOpen size={15} />
              <span className="ellipsis">{t('classic.studioName')}</span>
            </span>
          )}
          <span className="top-sep" aria-hidden />
          <span className="top-section">{section}</span>
          <span className="grow" />
          <ComfyPill />
          <QueueLink />
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
          <HelpButton />
        </header>
        <main className="main">
          {connected === false ? <div className="offline-banner">{t('app.offline')}</div> : null}
          <Outlet />
        </main>
        <StatusBar />
      </div>
      <Toaster />
      <ConfirmHost />
      <HelpDrawer />
    </div>
  );
}
