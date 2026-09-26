import { BookOpen, Download, FileImage, FileText, Globe, Layers } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { download } from '../../api/client';
import { useExportPresets } from '../../api/production';
import { useUI } from '../../app/ui-store';
import { toastError } from '../../components/toast';
import { Empty, Field, Select } from '../../components/ui';
import { pickAdopted } from '../canvas/adopted';
import { AlbumExport } from './AlbumExport';
import { useEpisodeContext } from './EpisodePage';

type Format = 'slices' | 'long' | 'pdf' | 'html' | 'album';
const FORMATS: { id: Format; icon: ReactNode }[] = [
  { id: 'slices', icon: <Layers size={18} /> },
  { id: 'long', icon: <FileImage size={18} /> },
  { id: 'pdf', icon: <FileText size={18} /> },
  { id: 'html', icon: <Globe size={18} /> },
  { id: 'album', icon: <BookOpen size={18} /> },
];

export default function ExportTab() {
  const { t } = useTranslation();
  const { episode, series } = useEpisodeContext();
  const ui = useUI();
  const presets = useExportPresets();
  const [format, setFormat] = useState<Format>('slices');
  const [preset, setPreset] = useState('webtoon');
  const [busy, setBusy] = useState(false);
  const variants = series.variants ?? [];
  const variantId = variants.some((v) => v.id === ui.variantId) ? ui.variantId : null;

  if (!Object.keys(pickAdopted(episode.takes, variantId)).length)
    return <Empty>{t('canvas.noAdopted')}</Empty>;

  const run = async () => {
    const q = new URLSearchParams({ fmt: format, preset });
    if (variantId) q.set('variant_id', variantId);
    setBusy(true);
    try {
      await download(`/api/episodes/${episode.id}/export?${q}`, `${series.title}_${episode.title}`);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  const current = presets.data?.find((p) => p.id === preset);
  const variantPicker = variants.length ? (
    <Field label={t('series.variants')}>
      <Select
        value={variantId ?? ''}
        onChange={(v) => ui.setVariant(v || null)}
        options={[
          { value: '', label: t('board.baseVariant') },
          ...variants.map((v) => ({ value: v.id, label: v.name })),
        ]}
      />
    </Field>
  ) : null;

  return (
    <div className="export-page">
      <div className="format-grid">
        {FORMATS.map((f) => (
          <button
            key={f.id}
            className={`format-card ${format === f.id ? 'active' : ''}`}
            aria-pressed={format === f.id}
            onClick={() => setFormat(f.id)}
          >
            {f.icon}
            <strong>{t(`exporter.formats.${f.id}`)}</strong>
            <span className="small muted">{t(`exporter.formatHints.${f.id}`)}</span>
          </button>
        ))}
      </div>
      {format === 'album' ? (
        <div className="col" style={{ gap: 14 }}>
          {variantPicker ? (
            <div className="card" style={{ maxWidth: 520 }}>
              {variantPicker}
            </div>
          ) : null}
          <AlbumExport
            episodeId={episode.id}
            variantId={variantId}
            fallbackName={`${series.title}_${episode.title}`}
          />
        </div>
      ) : (
        <div className="card col" style={{ gap: 14, maxWidth: 520 }}>
          <Field label={t('exporter.preset')}>
            <Select
              value={preset}
              onChange={setPreset}
              options={(presets.data ?? [{ id: 'webtoon', label: 'Webtoon' }]).map((p) => ({
                value: p.id,
                label: p.label,
              }))}
            />
          </Field>
          {current ? (
            <p className="small muted mono" style={{ margin: 0 }}>
              {current.width}px · ≤{current.max_height}px · {current.format}
            </p>
          ) : null}
          {variantPicker}
          <div>
            <button className="btn primary" disabled={busy} onClick={run}>
              {busy ? <span className="spinner" /> : <Download size={15} />} {t('exporter.go')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
