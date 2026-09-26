import { Download, Monitor, Play, Smartphone, Volume2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadPost, raw } from '../../api/client';
import { useMotionPlan, type MotionMove, type MotionShot } from '../../api/motion';
import { usePatchPanel } from '../../api/series';
import type { Episode } from '../../api/types';
import { toastError } from '../../components/toast';
import { Loading, NumberInput, Select, Switch } from '../../components/ui';

type Aspect = 'portrait' | 'landscape';

function duration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

/** One shot: move picker and hold seconds; saved to Panel.motion (null = fully automatic). */
function ShotRow(props: { shot: MotionShot; moves: MotionMove[]; episodeId: string }) {
  const { t } = useTranslation();
  const { shot } = props;
  const patch = usePatchPanel(props.episodeId);
  const move = shot.move_overridden ? shot.move : 'auto';
  const holdOverride = shot.hold !== shot.auto_hold ? shot.hold : null;
  const [hold, setHold] = useState<number | null>(holdOverride);

  const save = (nextMove: string, nextHold: number | null) => {
    const motion =
      nextMove === 'auto' && nextHold === null ? null : { move: nextMove, hold: nextHold };
    patch.mutate({ panelId: shot.panel_id, changes: { motion } }, { onError: toastError });
  };

  return (
    <tr className={shot.has_image ? '' : 'muted'}>
      <td className="mono small">{shot.index + 1}</td>
      <td className="small" style={{ maxWidth: 260 }}>
        <div className="ellipsis">{shot.description || '—'}</div>
        {!shot.has_image ? <span className="chip warn">{t('exporter.motion.noImage')}</span> : null}
      </td>
      <td style={{ width: 170 }}>
        <Select
          value={move}
          onChange={(v) => save(v, hold)}
          options={[
            {
              value: 'auto',
              label: t('exporter.motion.autoMove', {
                move: t(`exporter.motion.moves.${shot.auto_move}`),
              }),
            },
            ...props.moves.map((m) => ({ value: m, label: t(`exporter.motion.moves.${m}`) })),
          ]}
        />
      </td>
      <td style={{ width: 96 }} onBlur={() => hold !== holdOverride && save(move, hold)}>
        <NumberInput
          value={hold}
          min={0.5}
          max={30}
          step={0.5}
          placeholder={String(shot.auto_hold)}
          onChange={setHold}
        />
      </td>
      <td className="small muted">
        {shot.lines.length ? (
          <span className="row" style={{ gap: 4 }} title={shot.lines.map((l) => l.text).join('\n')}>
            <Volume2 size={12} /> {shot.lines.length}
          </span>
        ) : null}
      </td>
    </tr>
  );
}

export function MotionExport(props: {
  episode: Episode;
  variantId: string | null;
  fallbackName: string;
}) {
  const { t } = useTranslation();
  const { episode, variantId } = props;
  const plan = useMotionPlan(episode.id, variantId, episode.revision ?? 0);
  const [aspect, setAspect] = useState<Aspect>('portrait');
  const [lettered, setLettered] = useState(true);
  const [voice, setVoice] = useState(true);
  const [subtitles, setSubtitles] = useState(false);
  const [busy, setBusy] = useState<'' | 'preview' | 'download'>('');

  const body = {
    episode_id: episode.id,
    variant_id: variantId,
    aspect,
    lettered,
    voice,
    subtitles,
  };

  const run = async (kind: 'preview' | 'download') => {
    setBusy(kind);
    // Open the tab synchronously (popup blockers), then point it at the generated file.
    const tab = kind === 'preview' ? window.open('', '_blank') : null;
    try {
      if (kind === 'download') {
        await downloadPost('/api/export/motion', body, `${props.fallbackName}_动态漫.html`);
      } else {
        const response = await raw('/api/export/motion', {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'Content-Type': 'application/json' },
        });
        const url = URL.createObjectURL(await response.blob());
        if (tab) tab.location.href = url;
        else window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (err) {
      tab?.close();
      toastError(err);
    } finally {
      setBusy('');
    }
  };

  if (!plan.data) return <Loading />;
  const playable = plan.data.shots.filter((s) => s.has_image).length;

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card col" style={{ gap: 14, maxWidth: 720 }}>
        <div className="row" style={{ gap: 8 }}>
          {(['portrait', 'landscape'] as const).map((a) => (
            <button
              key={a}
              className={`btn ${aspect === a ? 'primary' : ''}`}
              aria-pressed={aspect === a}
              onClick={() => setAspect(a)}
            >
              {a === 'portrait' ? <Smartphone size={14} /> : <Monitor size={14} />}
              {t(`exporter.motion.aspect.${a}`)}
            </button>
          ))}
          <span className="grow" />
          <span className="small muted">
            {t('exporter.motion.summary', {
              count: playable,
              duration: duration(plan.data.total_seconds),
            })}
          </span>
        </div>
        <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
          <Switch checked={voice} onChange={setVoice} label={t('exporter.motion.voice')} />
          <Switch
            checked={subtitles}
            onChange={setSubtitles}
            label={t('exporter.motion.subtitles')}
          />
          <Switch checked={lettered} onChange={setLettered} label={t('exporter.album.lettered')} />
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {t('exporter.motion.hint')}
        </p>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" disabled={!!busy || !playable} onClick={() => run('preview')}>
            {busy === 'preview' ? <span className="spinner" /> : <Play size={15} />}
            {t('exporter.motion.preview')}
          </button>
          <button
            className="btn primary"
            disabled={!!busy || !playable}
            onClick={() => run('download')}
          >
            {busy === 'download' ? <span className="spinner" /> : <Download size={15} />}
            {t('exporter.go')}
          </button>
        </div>
      </div>
      <div className="card" style={{ maxWidth: 720, padding: 0, overflow: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>{t('exporter.motion.panel')}</th>
              <th>{t('exporter.motion.move')}</th>
              <th>{t('exporter.motion.hold')}</th>
              <th>{t('exporter.motion.lines')}</th>
            </tr>
          </thead>
          <tbody>
            {plan.data.shots.map((shot) => (
              <ShotRow
                key={`${shot.panel_id}:${shot.move}:${shot.hold}`}
                shot={shot}
                moves={plan.data.moves}
                episodeId={episode.id}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
