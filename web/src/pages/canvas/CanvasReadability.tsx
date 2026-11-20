import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStripReport } from '../../api/canvas';

export function ReadabilityBadge(props: { episodeId: string; bust: string }) {
  const { t } = useTranslation();
  const q = useStripReport(props.episodeId, props.bust);
  const r = q.data;
  if (!r) return null;
  if (r.readable)
    return (
      <span className="chip ok" title={t('canvas.readableHint')}>
        <CheckCircle2 size={13} /> {t('canvas.readable')}
      </span>
    );
  const parts = (
    [
      ['missing', r.missing.length],
      ['face_hits', r.face_hits.length],
      ['overlaps', r.overlaps.length],
      ['order', r.order.length],
      ['outside', r.outside.length],
      ['cut', r.cut.length],
    ] as const
  ).filter(([, n]) => n);
  return (
    <span
      className="chip warn"
      title={parts.map(([k, n]) => `${t(`canvas.problems.${k}`)} × ${n}`).join('\n')}
    >
      <TriangleAlert size={13} /> {t('canvas.problemsN', { count: r.problems })}
    </span>
  );
}
