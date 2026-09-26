import {
  Cloud,
  KeyRound,
  Layers3,
  Palette,
  Puzzle,
  RefreshCw,
  Server,
  SlidersHorizontal,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { Fragment, type ComponentType, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { usePageTitle } from '../../app/title';
import { AccessSection } from './AccessSection';
import { ChannelsSection } from './ChannelsSection';
import { ExtensionsSection } from './ExtensionsSection';
import { GeneralSection } from './GeneralSection';
import { InstancesSection } from './InstancesSection';
import { ProfilesSection } from './ProfilesSection';
import { ThemesSection } from './ThemesSection';
import { UpdatesSection } from './UpdatesSection';
import { WorkflowsSection } from './WorkflowsSection';

const GROUPS = [
  { id: 'basic', tabs: ['general', 'themes', 'updates'] },
  { id: 'render', tabs: ['instances', 'workflows', 'profiles', 'channels'] },
  { id: 'open', tabs: ['extensions', 'access'] },
] as const;
type Tab = (typeof GROUPS)[number]['tabs'][number];
const TABS: readonly Tab[] = GROUPS.flatMap((g) => g.tabs);

const ICONS: Record<Tab, LucideIcon> = {
  general: SlidersHorizontal,
  themes: Palette,
  updates: RefreshCw,
  instances: Server,
  workflows: Workflow,
  profiles: Layers3,
  channels: Cloud,
  extensions: Puzzle,
  access: KeyRound,
};

const SECTIONS: Record<Tab, ComponentType> = {
  general: GeneralSection,
  themes: ThemesSection,
  updates: UpdatesSection,
  instances: InstancesSection,
  workflows: WorkflowsSection,
  profiles: ProfilesSection,
  channels: ChannelsSection,
  extensions: ExtensionsSection,
  access: AccessSection,
};

export default function SettingsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab') as Tab | null;
  const tab: Tab = requested && TABS.includes(requested) ? requested : 'general';
  const open = (id: Tab) => setParams({ tab: id }, { replace: true });
  usePageTitle(t(`settings.tabs.${tab}`), t('settings.heading'));

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
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{t('settings.heading')}</h1>
        </div>
      </header>
      <div className="settings-layout">
        <nav
          className="settings-nav"
          role="tablist"
          aria-orientation="vertical"
          aria-label={t('settings.heading')}
          onKeyDown={onKeyDown}
        >
          {GROUPS.map((group) => (
            <Fragment key={group.id}>
              <div className="settings-nav-group">{t(`settings.groups.${group.id}`)}</div>
              {group.tabs.map((id) => {
                const Icon = ICONS[id];
                return (
                  <button
                    key={id}
                    id={`settings-tab-${id}`}
                    role="tab"
                    aria-selected={tab === id}
                    aria-controls="settings-panel"
                    tabIndex={tab === id ? 0 : -1}
                    className={`rail-item ${tab === id ? 'active' : ''}`}
                    onClick={() => open(id)}
                  >
                    <Icon size={15} /> {t(`settings.tabs.${id}`)}
                  </button>
                );
              })}
            </Fragment>
          ))}
        </nav>
        <section
          id="settings-panel"
          role="tabpanel"
          aria-labelledby={`settings-tab-${tab}`}
          className="settings-panel"
        >
          <h2 className="settings-panel-title">{t(`settings.tabs.${tab}`)}</h2>
          <Section />
        </section>
      </div>
    </div>
  );
}
