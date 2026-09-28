import { Cloud, Layers, SlidersHorizontal, Workflow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { useInstances, useProfiles, useSettings, useWorkflows } from '../../api/system';
import { usePageTitle } from '../../app/title';
import { ChannelsSection } from '../settings/ChannelsSection';
import { InstancesSection } from '../settings/InstancesSection';
import { ProfilesSection } from '../settings/ProfilesSection';
import { WorkflowsSection } from '../settings/WorkflowsSection';
import { Advanced } from '../settings/ConfigurationParts';

const TABS = ['instances', 'workflows', 'profiles', 'channels'] as const;
type Tab = (typeof TABS)[number];
const SECTIONS = {
  instances: InstancesSection,
  workflows: WorkflowsSection,
  profiles: ProfilesSection,
  channels: ChannelsSection,
};

/** Service first, configuration second. Deep links from the previous UI remain valid. */
export default function EnginePage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab') as Tab | null;
  const tab = requested && TABS.includes(requested) ? requested : 'instances';
  const local = tab === 'instances' || tab === 'workflows';
  const instances = useInstances();
  const workflows = useWorkflows();
  const profiles = useProfiles();
  const settings = useSettings();
  const open = (next: Tab) => setParams({ tab: next }, { replace: true });
  usePageTitle(t(`legacy.engine.tabs.${tab}`), t('legacy.engine.title'));
  const Section = SECTIONS[tab];
  const groups = [
    {
      id: 'local',
      tab: 'instances' as Tab,
      active: local,
      icon: Workflow,
      title: t('config.page.local'),
      text: t('config.page.localHint'),
      count: instances.data?.instances.length,
    },
    {
      id: 'cloud',
      tab: 'channels' as Tab,
      active: tab === 'channels',
      icon: Cloud,
      title: t('config.page.cloud'),
      text: t('config.page.cloudHint'),
      count: settings.data?.image_channels?.length,
    },
    {
      id: 'profiles',
      tab: 'profiles' as Tab,
      active: tab === 'profiles',
      icon: Layers,
      title: t('config.page.profiles'),
      text: t('config.page.profilesHint'),
      count: profiles.data?.length,
    },
  ];
  return (
    <div className="view">
      <section className="wf-page config-page">
        <header className="wf-bar">
          <div className="wf-bar-title">
            <span className="context-kicker">{t('legacy.engine.kicker')}</span>
            <div className="wf-bar-heading">
              <h1>{t('legacy.engine.title')}</h1>
            </div>
            <p className="wf-bar-lede">{t('config.page.intro')}</p>
          </div>
          <Link className="btn ghost" to="/settings?tab=general">
            <SlidersHorizontal size={15} />
            {t('config.page.textApi')}
          </Link>
        </header>
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
              className={`config-service ${group.active ? 'active' : ''}`}
              aria-current={group.active ? 'page' : undefined}
              onClick={() => {
                if (!group.active) open(group.tab);
              }}
            >
              <group.icon size={20} aria-hidden />
              <span className="grow">
                <strong>{group.title}</strong>
                <small>{group.text}</small>
              </span>
              {group.count !== undefined ? (
                <span className="config-count">{group.count}</span>
              ) : null}
            </button>
          ))}
        </nav>
        {local ? (
          <nav className="config-steps" aria-label={t('config.page.steps')}>
            <button
              type="button"
              className={tab === 'instances' ? 'active' : ''}
              aria-current={tab === 'instances' ? 'step' : undefined}
              onClick={() => open('instances')}
            >
              <b>1</b>
              {t('config.page.connect')}
            </button>
            <span aria-hidden>→</span>
            <button
              type="button"
              className={tab === 'workflows' ? 'active' : ''}
              aria-current={tab === 'workflows' ? 'step' : undefined}
              onClick={() => open('workflows')}
            >
              <b>2</b>
              {t('config.page.bind')}
              {workflows.data ? <small> {workflows.data.length}</small> : null}
            </button>
            <span aria-hidden>→</span>
            <button type="button" onClick={() => open('profiles')}>
              <b>3</b>
              {t('config.page.choose')}
            </button>
          </nav>
        ) : null}
        <div
          id="config-panel"
          role="tabpanel"
          aria-labelledby={`config-tab-${groups.find((group) => group.active)?.id}`}
          className="wf-section settings-panel config-panel"
        >
          <Section />
        </div>
        <div className="config-help">
          <Advanced title={t('config.page.helpTitle')}>
            <dl className="config-facts">
              <div>
                <dt>{t('config.page.local')}</dt>
                <dd>{t('config.page.localHelp')}</dd>
              </div>
              <div>
                <dt>{t('config.page.cloud')}</dt>
                <dd>{t('config.page.cloudHelp')}</dd>
              </div>
              <div>
                <dt>{t('config.page.profiles')}</dt>
                <dd>{t('config.page.profilesHelp')}</dd>
              </div>
              <div>
                <dt>{t('config.page.textApi')}</dt>
                <dd>{t('config.page.textHelp')}</dd>
              </div>
            </dl>
          </Advanced>
        </div>
      </section>
    </div>
  );
}
