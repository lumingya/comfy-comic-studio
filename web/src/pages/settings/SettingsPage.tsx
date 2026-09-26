import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { AccessSection } from './AccessSection';
import { ChannelsSection } from './ChannelsSection';
import { ExtensionsSection } from './ExtensionsSection';
import { GeneralSection } from './GeneralSection';
import { InstancesSection } from './InstancesSection';
import { ProfilesSection } from './ProfilesSection';
import { ThemesSection } from './ThemesSection';
import { UpdatesSection } from './UpdatesSection';
import { WorkflowsSection } from './WorkflowsSection';

const TABS = [
  'general',
  'workflows',
  'profiles',
  'instances',
  'channels',
  'themes',
  'extensions',
  'access',
  'updates',
] as const;
type Tab = (typeof TABS)[number];

export default function SettingsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') ?? '')
    ? (params.get('tab') as Tab)
    : 'general';

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="overline">{t('nav.settings')}</div>
          <h1>{t('settings.heading')}</h1>
        </div>
      </header>
      <nav className="tabs-list" role="tablist">
        {TABS.map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`tab ${tab === id ? 'active' : ''}`}
            onClick={() => setParams({ tab: id }, { replace: true })}
          >
            {t(`settings.tabs.${id}`)}
          </button>
        ))}
      </nav>
      <div style={{ marginTop: 20 }}>
        {tab === 'general' ? <GeneralSection /> : null}
        {tab === 'workflows' ? <WorkflowsSection /> : null}
        {tab === 'profiles' ? <ProfilesSection /> : null}
        {tab === 'instances' ? <InstancesSection /> : null}
        {tab === 'channels' ? <ChannelsSection /> : null}
        {tab === 'themes' ? <ThemesSection /> : null}
        {tab === 'extensions' ? <ExtensionsSection /> : null}
        {tab === 'access' ? <AccessSection /> : null}
        {tab === 'updates' ? <UpdatesSection /> : null}
      </div>
    </div>
  );
}
