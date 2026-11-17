import { Cloud, Layers, Plug, Workflow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useInstances, useProfiles, useSettings, useWorkflows } from '../../api/system';
import { usePageTitle } from '../../app/title';
import { ChannelsSection } from '../settings/ChannelsSection';
import { InstancesSection } from '../settings/InstancesSection';
import { ProfilesSection } from '../settings/ProfilesSection';
import { WorkflowsSection } from '../settings/WorkflowsSection';

const TABS = ['instances', 'workflows', 'profiles', 'channels'] as const;
type Tab = (typeof TABS)[number];
const SECTIONS = {
  instances: InstancesSection,
  workflows: WorkflowsSection,
  profiles: ProfilesSection,
  channels: ChannelsSection,
};

export default function EnginePage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab') as Tab | null;
  const tab = requested && TABS.includes(requested) ? requested : 'instances';
  const instances = useInstances();
  const workflows = useWorkflows();
  const profiles = useProfiles();
  const settings = useSettings();
  const open = (next: Tab) => setParams({ tab: next }, { replace: true });
  usePageTitle(t(`legacy.engine.tabs.${tab}`), t('legacy.engine.title'));
  const Section = SECTIONS[tab];
  const groups = [
    {
      id: 'instances',
      tab: 'instances' as Tab,
      active: tab === 'instances',
      icon: Plug,
      title: t('config.page.local'),
      count: instances.data?.instances.length,
    },
    {
      id: 'workflows',
      tab: 'workflows' as Tab,
      active: tab === 'workflows',
      icon: Workflow,
      title: t('config.page.workflows'),
      count: workflows.data?.length,
    },
    {
      id: 'cloud',
      tab: 'channels' as Tab,
      active: tab === 'channels',
      icon: Cloud,
      title: t('config.page.cloud'),
      count: settings.data?.image_channels?.length,
    },
    {
      id: 'profiles',
      tab: 'profiles' as Tab,
      active: tab === 'profiles',
      icon: Layers,
      title: t('config.page.profiles'),
      count: profiles.data?.length,
    },
  ];
  return (
    <div className="view">
      <section className="wf-page config-page">
        <h1 className="sr-only">{t('legacy.engine.title')}</h1>
        <div className="config-navigation">
          <nav
            className="config-services"
            role="tablist"
            aria-label={t('config.page.services')}
            onKeyDown={(event) => {
              const index = groups.findIndex((group) => group.active);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? groups.length - 1
                    : event.key === 'ArrowRight'
                      ? (index + 1) % groups.length
                      : event.key === 'ArrowLeft'
                        ? (index + groups.length - 1) % groups.length
                        : -1;
              if (next < 0) return;
              event.preventDefault();
              open(groups[next].tab);
              document.getElementById(`config-tab-${groups[next].id}`)?.focus();
            }}
          >
            {groups.map((group) => (
              <button
                type="button"
                key={group.id}
                id={`config-tab-${group.id}`}
                role="tab"
                aria-selected={group.active}
                aria-controls="config-panel"
                tabIndex={group.active ? 0 : -1}
                className={`config-service ${group.id === 'profiles' ? 'config-service-secondary' : ''} ${group.active ? 'active' : ''}`}
                aria-current={group.active ? 'page' : undefined}
                onClick={() => {
                  if (!group.active) open(group.tab);
                }}
              >
                <group.icon size={20} aria-hidden />
                <span className="grow">
                  <strong>{group.title}</strong>
                </span>
                {group.count !== undefined ? (
                  <span className="config-count">{group.count}</span>
                ) : null}
              </button>
            ))}
          </nav>
        </div>
        <div
          id="config-panel"
          role="tabpanel"
          aria-labelledby={`config-tab-${groups.find((group) => group.active)?.id}`}
          className="wf-section settings-panel config-panel"
        >
          <Section />
        </div>
      </section>
    </div>
  );
}
