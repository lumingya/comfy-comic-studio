import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUI } from '../../app/ui-store';
import { Switch } from '../../components/ui';

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

/**
 * Classic (default) keeps creation to prompt → characters → generate → pick.  Studio mode brings
 * back the professional toolkit — camera, part-level character tags, pose / depth slots, bleed,
 * gutters, JSON Pointer overrides, variants, QA — in an inspector drawer.  The choice is saved
 * in this browser and can be flipped at any time without losing anything already set.
 */
export function StudioSection() {
  const { t } = useTranslation();
  const studio = useUI((s) => s.studioMode);
  const setStudio = useUI((s) => s.setStudioMode);
  const modes = [
    { id: false, key: 'classic' },
    { id: true, key: 'studio' },
  ] as const;
  return (
    <div className="col" style={{ gap: 18 }}>
      <p className="soft" style={{ margin: 0 }}>
        {t('classic.settings.intro')}
      </p>
      <div className="mode-cards" role="radiogroup" aria-label={t('settings.tabs.studio')}>
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
              <span className="mode-card-title">
                {t(`classic.settings.${m.key}.title`)}
                {on ? (
                  <span className="chip ok">
                    <Check size={11} /> {t('classic.settings.current')}
                  </span>
                ) : null}
              </span>
              <span className="mode-card-body">{t(`classic.settings.${m.key}.body`)}</span>
            </button>
          );
        })}
      </div>
      <div className="card row" style={{ gap: 14 }}>
        <div className="grow">
          <strong>{t('classic.settings.switch')}</strong>
          <div className="small muted">{t('classic.settings.switchHint')}</div>
        </div>
        <Switch checked={studio} onChange={setStudio} label={t('classic.modeStudio')} />
      </div>
    </div>
  );
}
