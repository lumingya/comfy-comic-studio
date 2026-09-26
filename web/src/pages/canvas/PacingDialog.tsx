import { Wand2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePacingApply, usePacingSuggest } from '../../api/canvas';
import type { Panel, PacingPreview } from '../../api/types';
import { toast, toastError } from '../../components/toast';
import { Modal } from '../../components/ui';
import { parseStops, css } from './backdrop';

function Value(props: { field: string; value: unknown }) {
  const { t } = useTranslation();
  const { field, value } = props;
  if (value === null || value === undefined || value === '') return <>—</>;
  if (field === 'width_mode') return <>{t(`script.widths.${value as string}`)}</>;
  if (field === 'inset_align') return <>{t(`script.align.${value as string}`)}</>;
  if (field === 'transition_background') {
    const stops = parseStops(String(value));
    if (!stops) return <>{t('script.transparent')}</>;
    const bg =
      stops.length === 1 ? css(stops[0]) : `linear-gradient(90deg, ${stops.map(css).join(', ')})`;
    return <span className="swatch" style={{ background: bg }} title={String(value)} />;
  }
  return <>{String(value)}</>;
}

/** Automatic pacing: reviewable per-panel suggestions, applied in one revision. */
export function PacingDialog(props: {
  episodeId: string;
  panels: Panel[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onApplied: () => void;
}) {
  const { t } = useTranslation();
  const suggest = usePacingSuggest(props.episodeId);
  const apply = usePacingApply(props.episodeId);
  const [preview, setPreview] = useState<PacingPreview | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const byId = new Map(props.panels.map((p) => [p.id, p]));

  useEffect(() => {
    if (!props.open) return;
    suggest.mutate(undefined, {
      onSuccess: (p) => {
        setPreview(p);
        setAccepted(new Set(p.suggestions.map((s) => s.panel_id)));
      },
      onError: toastError,
    });
  }, [props.open]);

  const toggle = (id: string) => {
    const next = new Set(accepted);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setAccepted(next);
  };
  const commit = () =>
    preview &&
    apply.mutate(
      {
        base_revision: preview.revision,
        patches: preview.suggestions
          .filter((s) => accepted.has(s.panel_id))
          .map((s) => ({ panel_id: s.panel_id, changes: s.changes })),
      },
      {
        onSuccess: () => {
          toast(t('pacing.applied', { count: accepted.size }));
          props.onOpenChange(false);
          props.onApplied();
        },
        onError: toastError,
      },
    );

  const items = preview?.suggestions ?? [];
  return (
    <Modal
      open={props.open}
      onOpenChange={props.onOpenChange}
      size="lg"
      title={t('pacing.heading')}
      description={t('pacing.hint')}
      footer={
        items.length ? (
          <>
            <button className="btn ghost" onClick={() => props.onOpenChange(false)}>
              {t('common.cancel')}
            </button>
            <button
              className="btn primary"
              disabled={!accepted.size || apply.isPending}
              onClick={commit}
            >
              <Wand2 size={15} /> {t('pacing.applyN', { count: accepted.size })}
            </button>
          </>
        ) : undefined
      }
    >
      {suggest.isPending ? <span className="spinner" /> : null}
      {preview && !items.length ? <div className="notice">{t('pacing.none')}</div> : null}
      {items.length ? (
        <ul className="diff-list">
          {items.map((s) => {
            const panel = byId.get(s.panel_id);
            const changes = Object.entries(s.changes).filter(([, v]) => v !== null);
            return (
              <li key={s.panel_id} className="diff-op">
                <label className="row" style={{ alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    checked={accepted.has(s.panel_id)}
                    onChange={() => toggle(s.panel_id)}
                    aria-label={t('pacing.panelN', { n: s.order + 1 })}
                  />
                  <span className="grow">
                    <span className="row small">
                      <strong>{t('pacing.panelN', { n: s.order + 1 })}</strong>
                      <span className="muted">{(s.reasons ?? []).join(' · ')}</span>
                    </span>
                    <table className="diff-table">
                      <tbody>
                        {changes.map(([field, after]) => (
                          <tr key={field}>
                            <th>{t(`pacing.fields.${field}`)}</th>
                            <td className="before">
                              <Value
                                field={field}
                                value={panel?.[field as keyof Panel] as unknown}
                              />
                            </td>
                            <td className="after">
                              <Value field={field} value={after} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}
    </Modal>
  );
}
