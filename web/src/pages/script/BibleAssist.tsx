import { useTranslation } from 'react-i18next';
import type { Episode, Panel, Series } from '../../api/types';
import { CastPicker } from './CastPicker';
import { ReferencePreview } from './ReferencePreview';
import './bible-assist.css';

/** Bible editing tools stay folded until the author wants to use structured scene context. */
export function BibleAssist({
  episode,
  series,
  panel,
  onChange,
  beforePreview,
}: {
  episode: Episode;
  series: Series;
  panel: Panel;
  onChange: (changes: Partial<Panel>) => void;
  beforePreview: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  return (
    <details className="quiet-advanced bible-assist">
      <summary>{t('bibleAssist.title')}</summary>
      <CastPicker
        value={panel.characters}
        series={series}
        onChange={(characters) => onChange({ characters })}
      />
      {series.bible.locations.length ? (
        <label className="field">
          <span>{t('script.location')}</span>
          <select
            value={panel.location_id ?? ''}
            onChange={(event) => onChange({ location_id: event.target.value || null })}
          >
            <option value="">{t('common.none')}</option>
            {series.bible.locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <ReferencePreview
        episodeId={episode.id!}
        panelId={panel.id!}
        series={series}
        beforeOpen={beforePreview}
      />
    </details>
  );
}
