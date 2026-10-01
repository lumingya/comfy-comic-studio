import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useJobEvents, useJobs, useLive } from '../api/jobs';
import { useUpdateStatus } from '../api/open';
import { useSettings } from '../api/system';
import { ConfirmHost } from '../components/confirm';
import { HelpDrawer, QuickStart, useHelp, useHelpShortcut } from '../components/HelpDrawer';
import { Toaster } from '../components/toast';
import { CommandPalette, useCommand } from './CommandPalette';
import { useComfyHealth } from './comfy';
import { CollectionSwitch } from './CollectionSwitch';
import { Icon } from './icons';
import { NAV } from './nav';
import { useAppliedTheme, useThemeToggle } from './useTheme';
import { useStudio, useUI } from './ui-store';

/** The legacy Mio mark: four tilted comic panels. */
export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden>
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

export function useVersion() {
  const { data } = useUpdateStatus();
  return (data?.current ?? '').replace(/^v/, '');
}

/** Page name for the top bar breadcrumb (legacy shows just the current page). */
function useSection(): string {
  const { t } = useTranslation();
  const path = useLocation().pathname;
  if (path.startsWith('/workshop')) {
    const tab = path.split('/')[2] || 'story';
    return ['story', 'presets', 'assembly'].includes(tab)
      ? t(`ws.head.${tab}`)
      : t('legacy.nav.workshop');
  }
  if (path.startsWith('/gallery/')) return t('legacy.nav.gallery');
  if (path.startsWith('/jobs')) return t('legacy.workshop.heads.board');
  if (path.startsWith('/series/')) return t('legacy.nav.gallery');
  if (path.startsWith('/trash')) return t('legacy.settings.trashTitle');
  const item = NAV.find((n) => n.match(path));
  return item ? t(item.label) : t('legacy.nav.home');
}

function Sidebar() {
  const { t } = useTranslation();
  const path = useLocation().pathname;
  const collapsed = useUI((s) => s.navCollapsed);
  const setCollapsed = useUI((s) => s.setNavCollapsed);
  const openCommand = useCommand((s) => s.set);
  const version = useVersion();
  const studio = useSettings().data?.studio_name?.trim() || t('legacy.studio');
  return (
    <aside className="sidebar" id="sidebar" aria-label={t('nav.main')}>
      <Link className="brand" to="/" aria-label={t('app.name')}>
        <BrandMark />
        <div className="brand-text">
          <div className="brand-name">Mio</div>
          <div className="brand-sub">
            {t('legacy.brandSub')} {version ? <span>v{version.split('-')[0]}</span> : null}
          </div>
        </div>
      </Link>
      <button
        className="side-search"
        aria-label={t('legacy.searchLabel')}
        onClick={() => openCommand(true)}
      >
        <Icon name="search" />
        <span className="grow">{t('legacy.search')}</span>
        <kbd className="kbd">⌘ K</kbd>
      </button>
      <nav className="nav-list" aria-label={t('legacy.navLabel')}>
        {NAV.map((n) => {
          const active = n.match(path);
          return (
            <NavLink
              key={n.to}
              to={n.to}
              className={`nav-item ${active ? 'active' : ''} ${n.key === ',' ? 'nav-settings' : ''}`}
              aria-current={active ? 'page' : undefined}
              title={t(n.label)}
            >
              <Icon name={n.icon} />
              <span>{t(n.label)}</span>
              {n.short ? (
                <span className="nav-short" aria-hidden>
                  {t(n.short)}
                </span>
              ) : null}
              <b className="nav-key">{n.key}</b>
            </NavLink>
          );
        })}
      </nav>
      <div className="spacer" />
      <button
        className="nav-collapse"
        aria-label={collapsed ? t('legacy.expand') : t('legacy.collapse')}
        title={collapsed ? t('legacy.expand') : t('legacy.collapse')}
        onClick={() => setCollapsed(!collapsed)}
      >
        <Icon name="list" />
        <span>{collapsed ? t('legacy.expand') : t('legacy.collapse')}</span>
      </button>
      <div className="profile">
        <Link
          className="workspace-profile-button"
          to="/settings?tab=workspace"
          aria-label={t('legacy.profileLabel')}
          title={t('legacy.profileTip')}
        >
          <span className="avatar">{[...studio][0]}</span>
          <span className="grow">
            <strong>{studio}</strong>
            <p>{t('legacy.studioSub')}</p>
          </span>
        </Link>
      </div>
    </aside>
  );
}

function ServiceChip() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const health = useComfyHealth();
  const state = t(`classic.comfy.${health.state}`);
  const tone =
    health.state === 'online' ? 'tone-good' : health.state === 'checking' ? '' : 'tone-bad';
  return (
    <button
      type="button"
      className={`image-service-chip ${tone}`}
      title={health.detail || state}
      aria-label={t('legacy.service', { name: 'ComfyUI', state })}
      onClick={() => navigate('/engine?tab=instances')}
    >
      <i className="dot" aria-hidden />
      <span>ComfyUI · {state}</span>
    </button>
  );
}

function Topbar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data } = useJobs(undefined, true);
  const theme = useThemeToggle();
  const openHelp = useHelp((s) => s.set);
  const section = useSection();
  return (
    <header aria-label={t('legacy.toolbar')} className="topbar" id="topbar">
      <CollectionSwitch />
      <div className="top-separator" />
      <div className="breadcrumb">
        <strong>{section}</strong>
      </div>
      <span className="spacer" />
      <ServiceChip />
      <button className="top-queue" onClick={() => navigate('/jobs')} title={t('nav.jobs')}>
        <Icon name="nodes" sm />
        {t('legacy.queue')} <b>{data?.length ?? 0}</b>
      </button>
      <button
        type="button"
        className="ibtn"
        title={t('legacy.theme')}
        aria-label={t('legacy.theme')}
        onClick={theme.toggle}
      >
        <Icon name={theme.mode === 'dark' ? 'sun' : 'moon'} />
      </button>
      <button
        type="button"
        className="ibtn"
        title={`${t('legacy.help')} (?)`}
        aria-label={t('legacy.help')}
        aria-haspopup="dialog"
        onClick={() => openHelp(true)}
      >
        <Icon name="help" />
      </button>
    </header>
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
    <footer className="statusbar" id="statusbar" aria-label={t('classic.statusbar')}>
      <i className={`dot ${connected === false ? 'amber' : ''}`} />
      <Link className="disk-status-action" to="/settings?tab=data">
        {connected === false ? t('classic.reconnecting') : t('legacy.settings.tabs.data')}
      </Link>
      {running ? (
        <span className="status-running">
          <span className="beacon" aria-hidden />
          {t('classic.running', { count: running })}
        </span>
      ) : null}
      <span className="spacer" />
      {studio ? (
        <Link to="/settings?tab=studio" className="status-mode">
          {t('classic.modeStudio')}
        </Link>
      ) : null}
      <span>{t('legacy.storage')}</span>
      {version ? <span style={{ marginLeft: 17 }}>Mio v{version}</span> : null}
    </footer>
  );
}

export function Shell() {
  const collapsed = useUI((s) => s.navCollapsed);
  // The classic script list styles key off html:not(.is-studio): follow the script editor switch.
  const studio = useStudio('script');
  const connected = useLive((s) => s.connected);
  const navigate = useNavigate();
  const { t } = useTranslation();
  useAppliedTheme();
  useJobEvents();
  useHelpShortcut();

  const density = useUI((s) => s.density);
  const fontScale = useUI((s) => s.fontScale);
  const reduceMotion = useUI((s) => s.reduceMotion);
  const lettering = useUI((s) => s.lettering);
  // Legacy nav state lives on <html> (the legacy stylesheet keys off it).
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.navCollapsed = String(collapsed);
    root.classList.toggle('is-studio', studio);
    root.dataset.density = density;
    root.dataset.fontScale = fontScale;
    root.dataset.reduceMotion = String(reduceMotion);
    root.dataset.lettering = lettering;
  }, [collapsed, studio, density, fontScale, reduceMotion, lettering]);

  // Alt+0 / 1 / 2 / 3 / , jump between sections (legacy nav keys; e.code survives macOS Alt).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const key = /^Digit(\d)$/.exec(e.code)?.[1] ?? (e.code === 'Comma' ? ',' : e.key);
      const item = NAV.find((n) => n.key === key);
      if (!item) return;
      e.preventDefault();
      navigate(item.to);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <>
      <Sidebar />
      <div className="app">
        <Topbar />
        <main className="main" id="main">
          {connected === false ? <div className="offline-banner">{t('app.offline')}</div> : null}
          <Outlet />
        </main>
      </div>
      <StatusBar />
      <CommandPalette />
      <Toaster />
      <ConfirmHost />
      <HelpDrawer />
      <QuickStart />
    </>
  );
}
