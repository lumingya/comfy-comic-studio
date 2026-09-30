import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from '../../app/icons';
import { STUDIO_FEATURES, useUI, type StudioFeature } from '../../app/ui-store';

/** Tiny schematic of each layout, drawn with the theme's own colours. */
function Sketch({ studio }: { studio: boolean }) {
  return (
    <svg viewBox="0 0 160 92" className="mode-sketch" aria-hidden>
      <rect x="1" y="1" width="158" height="90" rx="8" className="s-frame" />
      <rect x="1" y="1" width="26" height="90" rx="8" className="s-rail" />
      <rect x="36" y="12" width={studio ? 72 : 114} height="26" rx="4" className="s-field" />
      <rect x="36" y="44" width={studio ? 30 : 46} height="7" rx="3.5" className="s-chip" />
      <rect x="36" y="58" width={studio ? 72 : 114} height="22" rx="4" className="s-stage" />
      <rect x={studio ? 84 : 126} y="62" width="20" height="14" rx="3" className="s-accent" />
      {studio ? (
        <g>
          <rect x="116" y="8" width="38" height="76" rx="5" className="s-drawer" />
          {[18, 32, 46, 60].map((y) => (
            <rect key={y} x="121" y={y} width="28" height="7" rx="2" className="s-line" />
          ))}
        </g>
      ) : null}
    </svg>
  );
}

/** One legacy settings row: icon, title and explanation, then the control on the right. */
function SettingsRow(props: {
  icon: IconName;
  title: string;
  body: string;
  control: ReactNode;
  muted?: boolean;
}) {
  return (
    <div className={`settings-row ${props.muted ? 'is-muted' : ''}`}>
      <Icon name={props.icon} />
      <div className="grow">
        <h3>{props.title}</h3>
        <p>{props.body}</p>
      </div>
      {props.control}
    </div>
  );
}

function RowSwitch(props: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        role="switch"
        aria-label={props.label}
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span className="switch-track" aria-hidden="true" />
    </label>
  );
}

const ICONS: Record<StudioFeature, IconName> = {
  script: 'story',
  retouch: 'brush',
  variants: 'copy',
  layout: 'grid',
  motion: 'play',
};

/**
 * 功能开关 (legacy optionalModulesHTML): the creation mode as two quick choices, then one switch
 * per professional tool — the script inspector, retouch & QA, batch variants, strip layout and
 * motion comics can each be kept or hidden.  Everything is saved in this browser and can be
 * flipped at any time without losing what was already set.
 */
export function StudioSection() {
  const { t } = useTranslation();
  const studio = useUI((s) => s.studioMode);
  const setStudio = useUI((s) => s.setStudioMode);
  const off = useUI((s) => s.studioOff);
  const setFeature = useUI((s) => s.setStudioFeature);
  const enabled = STUDIO_FEATURES.filter((f) => !off.includes(f)).length;
  const modes = [
    { id: false, key: 'classic' },
    { id: true, key: 'studio' },
  ] as const;
  return (
    <>
      <section className="settings-section">
        <h2>{t('classic.settings.modeTitle')}</h2>
        <p>{t('classic.settings.intro')}</p>
        <div
          className="mode-cards mode-cards-compact"
          role="radiogroup"
          aria-label={t('classic.settings.modeTitle')}
        >
          {modes.map((m) => {
            const on = studio === m.id;
            return (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={on}
                className={`mode-card ${on ? 'on' : ''}`}
                onClick={() => setStudio(m.id)}
              >
                <Sketch studio={m.id} />
                <span className="mode-card-text">
                  <span className="mode-card-title">
                    {t(`classic.settings.${m.key}.title`)}
                    {on ? (
                      <span className="chip ok">
                        <Check size={11} /> {t('classic.settings.current')}
                      </span>
                    ) : null}
                  </span>
                  <span className="mode-card-body">{t(`classic.settings.${m.key}.body`)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>
      <section className="settings-section feature-switches">
        <h2>{t('classic.settings.featuresTitle')}</h2>
        <p>{t('classic.settings.featuresBody')}</p>
        <SettingsRow
          icon="book"
          title={t('classic.settings.core.title')}
          body={t('classic.settings.core.body')}
          control={<span className="settings-row-note">{t('classic.settings.core.note')}</span>}
        />
        <SettingsRow
          icon="spark"
          title={t('classic.settings.switch')}
          body={t('classic.settings.switchHint')}
          control={
            <RowSwitch label={t('classic.modeStudio')} checked={studio} onChange={setStudio} />
          }
        />
        <div
          className="feature-children"
          role="group"
          aria-label={t('classic.settings.toolsLabel')}
        >
          {STUDIO_FEATURES.map((f) => (
            <SettingsRow
              key={f}
              icon={ICONS[f]}
              muted={!studio}
              title={t(`classic.settings.features.${f}.title`)}
              body={t(`classic.settings.features.${f}.body`)}
              control={
                <RowSwitch
                  label={t(`classic.settings.features.${f}.title`)}
                  checked={!off.includes(f)}
                  disabled={!studio}
                  onChange={(on) => setFeature(f, on)}
                />
              }
            />
          ))}
        </div>
        <p className="help feature-summary" role="status">
          {studio
            ? t('classic.settings.summaryOn', { count: enabled, total: STUDIO_FEATURES.length })
            : t('classic.settings.summaryOff')}
        </p>
      </section>
    </>
  );
}
