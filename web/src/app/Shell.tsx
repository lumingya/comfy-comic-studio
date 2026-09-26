import { BookOpen, Languages, ListTodo, Moon, Settings, Sun, Trash2 } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';
import { useJobEvents, useJobs, useLive } from '../api/jobs';
import { Toaster } from '../components/toast';
import { setLocale } from '../i18n';
import { useUI } from './ui-store';

function ActiveJobsBadge() {
  const { data } = useJobs(undefined, true);
  const n = data?.length ?? 0;
  return n ? (
    <span className="chip ok" style={{ marginLeft: 'auto' }}>
      {n}
    </span>
  ) : null;
}

export function Shell() {
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme } = useUI();
  const connected = useLive((s) => s.connected);
  useJobEvents();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const link = ({ isActive }: { isActive: boolean }) => `rail-link ${isActive ? 'active' : ''}`;

  return (
    <div className="shell">
      <nav className="rail" aria-label="main">
        <div className="brand">
          <span className="brand-mark">{t('app.name')}</span>
          <span className="brand-sub">{t('app.tagline')}</span>
        </div>
        <NavLink to="/" end className={link}>
          <BookOpen size={17} /> {t('nav.works')}
        </NavLink>
        <NavLink to="/jobs" className={link}>
          <ListTodo size={17} /> {t('nav.jobs')}
          <ActiveJobsBadge />
        </NavLink>
        <NavLink to="/settings" className={link}>
          <Settings size={17} /> {t('nav.settings')}
        </NavLink>
        <NavLink to="/trash" className={link}>
          <Trash2 size={17} /> {t('nav.trash')}
        </NavLink>
        <div className="rail-foot">
          <button className="btn ghost icon" title={t('nav.theme')} onClick={toggleTheme}>
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button
            className="btn ghost sm"
            onClick={() => setLocale(i18n.language === 'en' ? 'zh-CN' : 'en')}
          >
            <Languages size={15} /> {t('nav.language')}
          </button>
        </div>
      </nav>
      <main className="main">
        {connected === false ? <div className="offline-banner">{t('app.offline')}</div> : null}
        <Outlet />
      </main>
      <Toaster />
    </div>
  );
}
