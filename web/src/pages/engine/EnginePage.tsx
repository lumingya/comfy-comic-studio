import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useInstances, useProfiles, useWorkflows } from '../../api/system';
import { useComfyHealth } from '../../app/comfy';
import { Icon, type IconName } from '../../app/icons';
import { usePageTitle } from '../../app/title';
import { ChannelsSection } from '../settings/ChannelsSection';
import { InstancesSection } from '../settings/InstancesSection';
import { ProfilesSection } from '../settings/ProfilesSection';
import { WorkflowsSection } from '../settings/WorkflowsSection';

const TABS = ['instances', 'workflows', 'profiles', 'channels'] as const;
type Tab = (typeof TABS)[number];

const SECTIONS: Record<Tab, ComponentType> = {
  instances: InstancesSection,
  workflows: WorkflowsSection,
  profiles: ProfilesSection,
  channels: ChannelsSection,
};
const GLYPHS: Record<Tab, IconName> = {
  instances: 'nodes',
  workflows: 'terminal',
  profiles: 'box',
  channels: 'link',
};

/** 工作流与 API 配置 — the legacy workflow page: header bar, service switcher, then the editor. */
export default function EnginePage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab') as Tab | null;
  const tab: Tab = requested && TABS.includes(requested) ? requested : 'instances';
  const comfy = useComfyHealth();
  const qc = useQueryClient();
  const instances = useInstances();
  const workflows = useWorkflows();
  const profiles = useProfiles();
  usePageTitle(t(`legacy.engine.tabs.${tab}`), t('legacy.engine.title'));

  const counts: Record<Tab, number | undefined> = {
    instances: instances.data?.instances.length,
    workflows: workflows.data?.length,
    profiles: profiles.data?.length,
    channels: undefined,
  };
  const tone =
    comfy.state === 'online' ? 'tone-good' : comfy.state === 'checking' ? '' : 'tone-bad';
  const state = t(`classic.comfy.${comfy.state}`);
  const Section = SECTIONS[tab];

  return (
    <div className="view">
      <section className="wf-page wf-page-comfy">
        <header className="wf-bar">
          <div className="wf-bar-title">
            <span className="context-kicker">{t('legacy.engine.kicker')}</span>
            <div className="wf-bar-heading">
              <h1>{t('legacy.engine.title')}</h1>
            </div>
            <p className="wf-bar-lede">{t('legacy.engine.lede')}</p>
          </div>
          <div className="wf-bar-side">
            <div className={`wf-connection wm-connection ${tone}`}>
              <button
                type="button"
                className="wf-connection-summary"
                title={comfy.detail || state}
                onClick={() => setParams({ tab: 'instances' }, { replace: true })}
              >
                <i className="wf-dot" aria-hidden />
                <span className="wf-connection-main">
                  <strong>{comfy.name}</strong>
                  <span className="wf-connection-url mono">{comfy.detail}</span>
                </span>
                <span className="wf-connection-state">
                  <b>{state}</b>
                </span>
              </button>
              <button
                type="button"
                className="ibtn wf-connection-check"
                aria-label={t('legacy.home.checks.test')}
                title={t('legacy.home.checks.test')}
                onClick={() => void qc.invalidateQueries({ queryKey: ['comfy-health'] })}
              >
                <Icon name="refresh" />
              </button>
            </div>
          </div>
        </header>
        <nav className="wf-channel-nav" aria-label={t('legacy.engine.channelKicker')}>
          <div className="wf-channel-nav-label">
            <span className="context-kicker">{t('legacy.engine.channelKicker')}</span>
            <strong>{t('legacy.engine.channelTitle')}</strong>
          </div>
          <div className="wf-channel-tabs" role="tablist">
            {TABS.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={`wf-channel-tab ${tab === id ? 'active' : ''}`}
                onClick={() => setParams({ tab: id }, { replace: true })}
                title={t(`legacy.engine.tabs.${id}d`)}
              >
                <span className="wf-channel-glyph">
                  <Icon name={GLYPHS[id]} />
                </span>
                <span className="wf-channel-text">
                  <span className="wf-channel-name">{t(`legacy.engine.tabs.${id}`)}</span>
                  <small className={id === 'instances' ? tone : 'tone-idle'}>
                    <i className="wf-dot" aria-hidden />
                    {id === 'instances'
                      ? state
                      : counts[id] !== undefined
                        ? `${counts[id]} · ${t(`legacy.engine.tabs.${id}d`)}`
                        : t(`legacy.engine.tabs.${id}d`)}
                  </small>
                </span>
                {tab === id ? (
                  <span className="wf-channel-check">
                    <Icon name="check" />
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </nav>
        <div className="wf-section settings-panel" role="tabpanel">
          <Section />
        </div>
      </section>
    </div>
  );
}
