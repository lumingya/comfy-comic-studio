import { Fragment, useState, type ComponentType, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useImportBundle, usePatchSettings } from '../../api/system';
import { useCollectionTitle } from '../../app/CollectionSwitch';
import { Icon, type IconName } from '../../app/icons';
import { usePageTitle } from '../../app/title';
import { toast, toastError } from '../../components/toast';
import { manualHref, useQuickStart } from '../../components/HelpDrawer';
import { ConfigurationGuard } from './ConfigurationParts';
import { FilePick } from '../../components/ui';
import { setLocale } from '../../i18n';
import { TrashSection } from '../trash/TrashPage';
import { LegacyImportDialog } from '../works/LegacyImportDialog';
import { AccessSection } from './AccessSection';
import { ExtensionsSection } from './ExtensionsSection';
import { GeneralSection } from './GeneralSection';
import { StudioSection } from './StudioSection';
import { ThemesSection } from './ThemesSection';
import { UpdatesSection } from './UpdatesSection';

/** 你的工作室: the collection name, interface language and where data lives. */
function WorkspaceSection() {
  const { t, i18n } = useTranslation();
  const title = useCollectionTitle();
  const patch = usePatchSettings();
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? title;
  return (
    <>
      <ConfigurationGuard dirty={value.trim() !== title} />
      <section className="settings-section">
        <h2>{t('legacy.settings.workspaceTitle')}</h2>
        <p>{t('legacy.settings.workspaceHint')}</p>
        <div className="field">
          <label className="label" htmlFor="collection-name">
            {t('legacy.settings.collectionName')}
          </label>
          <input
            id="collection-name"
            className="input"
            value={value}
            disabled={patch.isPending}
            maxLength={60}
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="ui-language">
            {t('legacy.settings.language')}
          </label>
          <select
            id="ui-language"
            className="input"
            value={i18n.language === 'en' ? 'en' : 'zh-CN'}
            onChange={(e) => setLocale(e.target.value as 'en' | 'zh-CN')}
          >
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
          </select>
        </div>
        <button
          className="btn primary"
          disabled={!value.trim() || value.trim() === title || patch.isPending}
          onClick={() =>
            patch.mutate(
              { collection_title: value.trim() },
              {
                onSuccess: () => {
                  setDraft(null);
                  toast(t('common.saved'));
                },
                onError: toastError,
              },
            )
          }
        >
          <Icon name="check" />
          {t('legacy.settings.saveName')}
        </button>
      </section>
      <section className="settings-section">
        <h2>{t('legacy.settings.storageTitle')}</h2>
        <div className="service-context">{t('legacy.storage')}</div>
        <p>{t('legacy.settings.storageBody')}</p>
      </section>
    </>
  );
}

/** 数据与备份: legacy import, .mio.zip bundles and the trash. */
function DataSection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const importBundle = useImportBundle();
  const [legacy, setLegacy] = useState(false);
  return (
    <>
      <section className="settings-section">
        <h2>{t('legacy.settings.dataTitle')}</h2>
        <p>{t('legacy.settings.dataBody')}</p>
        <div className="row">
          <button className="btn" onClick={() => setLegacy(true)}>
            <Icon name="download" />
            {t('legacy.settings.legacyImport')}
          </button>
          <FilePick
            accept=".zip"
            disabled={importBundle.isPending}
            onFile={(file) =>
              importBundle.mutate(file, {
                onSuccess: (r) => {
                  toast(t('works.imported', { count: 1 }));
                  navigate(`/gallery/${r.series_id}`);
                },
                onError: toastError,
              })
            }
          >
            <Icon name="upload" />
            {t('legacy.settings.bundleImport')}
          </FilePick>
        </div>
      </section>
      <section className="settings-section">
        <h2>{t('legacy.settings.trashTitle')}</h2>
        <TrashSection />
      </section>
      <LegacyImportDialog open={legacy} onOpenChange={setLegacy} />
    </>
  );
}

/** 工具与资源 (legacy renderResourceHub): the tutorials and the less-used tools. */
function ResourcesSection() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const openQuick = useQuickStart((s) => s.set);
  const en = i18n.language === 'en';
  const items: { icon: IconName; title: string; text: string; run: () => void }[] = [
    {
      icon: 'help',
      title: t('guide.quickstart'),
      text: t('guide.res.quickstart'),
      run: () => openQuick(true),
    },
    {
      icon: 'book',
      title: t('guide.res.handbook'),
      text: t('guide.res.handbookBody'),
      run: () => window.open(manualHref('', en), '_blank', 'noopener'),
    },
    {
      icon: 'list',
      title: t('guide.res.jobs'),
      text: t('guide.res.jobsBody'),
      run: () => navigate('/jobs'),
    },
    {
      icon: 'disk',
      title: t('guide.res.backup'),
      text: t('guide.res.backupBody'),
      run: () => navigate('/settings?tab=data'),
    },
    {
      icon: 'terminal',
      title: t('guide.res.api'),
      text: t('guide.res.apiBody'),
      run: () => window.open('/docs', '_blank', 'noopener'),
    },
  ];
  return (
    <section className="settings-section">
      <h2>{t('legacy.settings.tabs.resources')}</h2>
      <p>{t('guide.res.lede')}</p>
      <div className="resources-list">
        {items.map((item) => (
          <button key={item.title} type="button" className="resource-link" onClick={item.run}>
            <Icon name={item.icon} />
            <span className="grow">
              <strong>{item.title}</strong>
              <small>{item.text}</small>
            </span>
            <Icon name="arrow" sm />
          </button>
        ))}
      </div>
    </section>
  );
}

const GROUPS = [
  { id: 'common', tabs: ['workspace', 'general', 'data', 'updates'] },
  { id: 'advanced', tabs: ['studio', 'themes', 'extensions', 'access', 'resources'] },
] as const;
type Tab = (typeof GROUPS)[number]['tabs'][number];
const TABS: readonly Tab[] = GROUPS.flatMap((g) => g.tabs);
const ICONS: Record<Tab, IconName> = {
  workspace: 'edit',
  general: 'settings',
  data: 'disk',
  updates: 'refresh',
  studio: 'grid',
  themes: 'brush',
  extensions: 'box',
  access: 'link',
  resources: 'box',
};

/** Existing sections render their own headings; the new ones use legacy settings-section. */
const SECTIONS: Record<Tab, ComponentType> = {
  workspace: WorkspaceSection,
  general: GeneralSection,
  data: DataSection,
  updates: UpdatesSection,
  studio: StudioSection,
  themes: ThemesSection,
  extensions: ExtensionsSection,
  access: AccessSection,
  resources: ResourcesSection,
};

/** 设置 — legacy layout: heading, grouped left nav, one section at a time. */
export default function SettingsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab') as Tab | null;
  const tab: Tab = requested && TABS.includes(requested) ? requested : 'workspace';
  const open = (id: Tab) => setParams({ tab: id }, { replace: true });
  usePageTitle(t(`legacy.settings.tabs.${tab}`), t('legacy.nav.settings'));

  // Arrow keys move between tabs, as in any tablist.
  const onKeyDown = (e: KeyboardEvent) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length];
    open(next);
    document.getElementById(`settings-tab-${next}`)?.focus();
  };

  const Section = SECTIONS[tab];
  return (
    <div className="view">
      <div className="page-heading">
        <div>
          <h1>{t('legacy.nav.settings')}</h1>
          <p>{t('legacy.settings.lede')}</p>
        </div>
      </div>
      <div className="settings-layout">
        <nav
          className="settings-nav"
          role="tablist"
          aria-orientation="vertical"
          aria-label={t('legacy.nav.settings')}
          onKeyDown={onKeyDown}
        >
          {GROUPS.map((group) => (
            <Fragment key={group.id}>
              <span className="settings-nav-label">{t(`legacy.settings.groups.${group.id}`)}</span>
              {group.tabs.map((id) => (
                <button
                  key={id}
                  id={`settings-tab-${id}`}
                  role="tab"
                  aria-selected={tab === id}
                  aria-controls="studio-settings-content"
                  tabIndex={tab === id ? 0 : -1}
                  className={tab === id ? 'active' : ''}
                  onClick={() => open(id)}
                >
                  <Icon name={ICONS[id]} sm />
                  {t(`legacy.settings.tabs.${id}`)}
                </button>
              ))}
            </Fragment>
          ))}
        </nav>
        <div
          id="studio-settings-content"
          role="tabpanel"
          aria-labelledby={`settings-tab-${tab}`}
          className="settings-panel"
        >
          <Section />
        </div>
      </div>
    </div>
  );
}
