import { Fragment, useState, type ComponentType, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useImportBundle, usePatchSettings, useSettings } from '../../api/system';
import { Icon, type IconName } from '../../app/icons';
import { usePageTitle } from '../../app/title';
import { toast, toastError } from '../../components/toast';
import { ConfigurationGuard } from './ConfigurationParts';
import { FilePick } from '../../components/ui';
import { TrashSection } from '../trash/TrashPage';
import { AccessSection } from './AccessSection';
import { ExtensionsSection } from './ExtensionsSection';
import { AppearanceSection } from './AppearanceSection';
import { GeneralSection } from './GeneralSection';
import { ThemesSection } from './ThemesSection';
import { UpdatesSection } from './UpdatesSection';

/**
 * 你的工作室 (legacy renderCurrentIdentity): the studio name shown in the sidebar, the creator
 * signature — optionally also the default album signature — and where the work is saved.
 * The collection is renamed from the top bar or 画册集.
 */
function WorkspaceSection() {
  const { t } = useTranslation();
  const settings = useSettings();
  const patch = usePatchSettings();
  const saved = {
    name: settings.data?.studio_name?.trim() || t('legacy.studio'),
    creator: settings.data?.creator_name ?? '',
  };
  const [draft, setDraft] = useState<typeof saved | null>(null);
  const [sync, setSync] = useState(true);
  const value = draft ?? saved;
  const name = value.name.trim();
  const creator = value.creator.trim();
  const dirty = name !== saved.name || creator !== saved.creator.trim();
  const signed = (settings.data?.signature ?? '') === (creator || name);
  const save = () => {
    if (!name || [...name].length > 40) {
      toastError(new Error(t('legacy.settings.studioNameRequired')));
      return;
    }
    patch.mutate(
      {
        studio_name: name,
        creator_name: creator,
        ...(sync ? { signature: creator || name } : {}),
      },
      {
        onSuccess: () => {
          setDraft(null);
          toast(t('legacy.settings.identitySaved'));
        },
        onError: toastError,
      },
    );
  };
  return (
    <>
      <ConfigurationGuard dirty={dirty} />
      <section className="settings-section">
        <h2>{t('legacy.settings.workspaceTitle')}</h2>
        <p>{t('legacy.settings.workspaceHint')}</p>
        <form
          className="identity-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!patch.isPending) save();
          }}
        >
          <div className="field">
            <label className="label" htmlFor="identity-workspace">
              {t('legacy.settings.studioName')}
            </label>
            <input
              id="identity-workspace"
              className="input"
              value={value.name}
              maxLength={40}
              placeholder={t('legacy.settings.studioPlaceholder')}
              disabled={!settings.data || patch.isPending}
              onChange={(e) => setDraft({ ...value, name: e.target.value })}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="identity-creator">
              {t('legacy.settings.creatorName')}
            </label>
            <input
              id="identity-creator"
              className="input"
              value={value.creator}
              maxLength={60}
              placeholder={t('legacy.settings.creatorPlaceholder')}
              disabled={!settings.data || patch.isPending}
              onChange={(e) => setDraft({ ...value, creator: e.target.value })}
            />
          </div>
          <label className="identity-sync">
            <span>{t('legacy.settings.syncSignature')}</span>
            <span className="switch">
              <input
                id="identity-sync-signature"
                type="checkbox"
                role="switch"
                checked={sync}
                onChange={(e) => setSync(e.target.checked)}
              />
              <span className="switch-track" aria-hidden="true" />
            </span>
          </label>
          <button
            type="submit"
            className="btn primary"
            disabled={!settings.data || patch.isPending || (!dirty && (!sync || signed))}
          >
            <Icon name="check" />
            {t('legacy.settings.saveIdentity')}
          </button>
        </form>
      </section>
      <section className="settings-section">
        <h2>{t('legacy.settings.storageTitle')}</h2>
        <div className="service-context">{t('legacy.storage')}</div>
        <p>{t('legacy.settings.storageBody')}</p>
        <div className="row">
          <Link className="btn" to="/settings?tab=data">
            <Icon name="disk" />
            {t('legacy.settings.tabs.data')}
          </Link>
        </div>
      </section>
    </>
  );
}

/** 数据与备份: .mio.zip bundles and the trash. */
function DataSection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const importBundle = useImportBundle();
  return (
    <>
      <section className="settings-section">
        <h2>{t('legacy.settings.dataTitle')}</h2>
        <p>{t('legacy.settings.dataBody')}</p>
        <div className="row">
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
    </>
  );
}

/** 外观与阅读: interface and reading preferences, then the theme gallery. */
function AppearanceAndThemes() {
  const { t } = useTranslation();
  return (
    <>
      <AppearanceSection />
      <section className="settings-section">
        <h2>{t('legacy.settings.themesTitle')}</h2>
        <ThemesSection />
      </section>
    </>
  );
}

/** 模型与连接: the text model API, then API tokens and webhooks for bots and scripts. */
function ModelsAndConnections() {
  const { t } = useTranslation();
  return (
    <>
      <GeneralSection />
      <section className="settings-section">
        <h2>{t('legacy.settings.accessTitle')}</h2>
        <AccessSection />
      </section>
    </>
  );
}

const GROUPS = [
  { id: 'common', tabs: ['workspace', 'appearance', 'general', 'data'] },
  { id: 'system', tabs: ['extensions', 'updates'] },
] as const;
type Tab = (typeof GROUPS)[number]['tabs'][number];
const TABS: readonly Tab[] = GROUPS.flatMap((g) => g.tabs);
/** Tabs that were merged into another one. */
const MERGED: Record<string, Tab> = { themes: 'appearance', access: 'general' };
const ICONS: Record<Tab, IconName> = {
  workspace: 'edit',
  appearance: 'sun',
  general: 'settings',
  data: 'disk',
  updates: 'refresh',
  extensions: 'box',
};

/** Existing sections render their own headings; the new ones use legacy settings-section. */
const SECTIONS: Record<Tab, ComponentType> = {
  workspace: WorkspaceSection,
  appearance: AppearanceAndThemes,
  general: ModelsAndConnections,
  data: DataSection,
  updates: UpdatesSection,
  extensions: ExtensionsSection,
};

/** 设置 — legacy layout: heading, grouped left nav, one section at a time. */
export default function SettingsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab') ?? '';
  const requested = (MERGED[asked] ?? asked) as Tab;
  const tab: Tab = TABS.includes(requested) ? requested : 'workspace';
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
