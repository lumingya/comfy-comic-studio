import {
  CheckCircle2,
  LayoutTemplate,
  Plus,
  Save,
  Sparkles,
  TriangleAlert,
  Wand2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStripReport } from '../../api/canvas';
import { useLayoutStrip, useSaveStrip } from '../../api/production';
import type { LetteringLayer, Strip } from '../../api/types';
import { useUI } from '../../app/ui-store';
import { toast, toastError } from '../../components/toast';
import { Empty, Field, NumberInput, Select, TextInput } from '../../components/ui';
import { useEpisodeContext } from '../episode/EpisodePage';
import { pickAdopted } from './adopted';
import { LetterInspector } from './LetterInspector';
import { PacingDialog } from './PacingDialog';
import { DEFAULT_STYLE } from './sfx';
import { StripStage, type Selection } from './StripStage';

type Box = [number, number, number, number];

function newLayer(strip: Strip, kind: 'caption' | 'sfx'): LetteringLayer {
  const y = Math.max(40, Math.round(strip.height / 2));
  const sfx = kind === 'sfx';
  return {
    id: `letter_${Date.now().toString(16)}`,
    panel_id: null,
    kind,
    text: sfx ? '砰！' : '…',
    speaker_id: null,
    box: sfx ? [300, y, 500, y + 90] : [40, y, 320, y + 70],
    tail_to: null,
    vertical: false,
    font_size: null,
    locked: true,
    bridge_to: null,
    style: sfx ? DEFAULT_STYLE : null,
  };
}

function ReadabilityBadge(props: { episodeId: string; variantId: string | null; bust: string }) {
  const { t } = useTranslation();
  const q = useStripReport(props.episodeId, props.variantId, props.bust);
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

export default function CanvasTab() {
  const { t } = useTranslation();
  const { episode, series } = useEpisodeContext();
  const variantId = useUI((s) => s.variantId);
  const layout = useLayoutStrip(episode.id);
  const save = useSaveStrip(episode.id);
  const [strip, setStrip] = useState<Strip>(episode.strip);
  const [dirty, setDirty] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [scale, setScale] = useState(0.6);
  const [pacing, setPacing] = useState(false);

  useEffect(() => {
    setStrip(episode.strip);
    setDirty(false);
  }, [episode.strip]);

  const panels = useMemo(
    () => [...episode.panels].sort((a, b) => a.order - b.order),
    [episode.panels],
  );
  const images = useMemo(() => pickAdopted(episode.takes, variantId), [episode.takes, variantId]);
  const change = (next: Strip) => {
    setStrip(next);
    setDirty(true);
  };
  const letter =
    selection?.type === 'letter' ? strip.lettering.find((l) => l.id === selection.id) : undefined;
  const editLetter = (id: string, patch: Partial<LetteringLayer>) =>
    change({
      ...strip,
      lettering: strip.lettering.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    });
  const addLayer = (kind: 'caption' | 'sfx') => {
    const layer = newLayer(strip, kind);
    change({ ...strip, lettering: [...strip.lettering, layer] });
    setSelection({ type: 'letter', id: layer.id });
  };

  const autoLayout = (relayout: boolean) =>
    layout.mutate(
      { relayout_lettering: relayout, variant_id: variantId },
      { onSuccess: () => toast(t('canvas.laidOut')), onError: toastError },
    );

  if (!Object.keys(images).length) return <Empty>{t('canvas.noAdopted')}</Empty>;
  if (!Object.keys(strip.panel_boxes).length)
    return (
      <Empty
        action={
          <button className="btn primary" onClick={() => autoLayout(true)}>
            <LayoutTemplate size={15} /> {t('canvas.autoLayout')}
          </button>
        }
      >
        {t('canvas.needLayout')}
      </Empty>
    );

  return (
    <div className="canvas-layout">
      <div className="canvas-toolbar">
        <button className="btn" onClick={() => setPacing(true)} disabled={dirty}>
          <Wand2 size={15} /> {t('pacing.open')}
        </button>
        <button className="btn" disabled={layout.isPending} onClick={() => autoLayout(false)}>
          <LayoutTemplate size={15} /> {t('canvas.relayoutPanels')}
        </button>
        <button className="btn" disabled={layout.isPending} onClick={() => autoLayout(true)}>
          {t('canvas.relayoutAll')}
        </button>
        <button className="btn ghost" onClick={() => addLayer('caption')}>
          <Plus size={15} /> {t('canvas.addText')}
        </button>
        <button className="btn ghost" onClick={() => addLayer('sfx')}>
          <Sparkles size={15} /> {t('canvas.addSfx')}
        </button>
        <span className="grow" />
        {!dirty ? (
          <ReadabilityBadge
            episodeId={episode.id}
            variantId={variantId}
            bust={String(episode.revision)}
          />
        ) : null}
        <button
          className="btn ghost icon"
          aria-label="zoom out"
          onClick={() => setScale(Math.max(0.2, scale - 0.1))}
        >
          <ZoomOut size={15} />
        </button>
        <span className="mono small muted">{Math.round(scale * 100)}%</span>
        <button
          className="btn ghost icon"
          aria-label="zoom in"
          onClick={() => setScale(Math.min(1.5, scale + 0.1))}
        >
          <ZoomIn size={15} />
        </button>
        {dirty ? <span className="chip warn">{t('canvas.unsaved')}</span> : null}
        <button
          className="btn primary"
          disabled={!dirty || save.isPending}
          onClick={() =>
            save.mutate(strip, { onSuccess: () => toast(t('common.saved')), onError: toastError })
          }
        >
          <Save size={15} /> {t('common.save')}
        </button>
      </div>
      <div className="canvas-body">
        <div className="canvas-scroll">
          <StripStage
            strip={strip}
            panels={panels}
            images={images}
            scale={scale}
            selection={selection}
            onSelect={setSelection}
            onPanelBox={(id, box: Box) =>
              change({ ...strip, manual: true, panel_boxes: { ...strip.panel_boxes, [id]: box } })
            }
            onLetter={(id, patch) => editLetter(id, { ...patch, locked: true })}
          />
        </div>
        <aside className="canvas-inspector card">
          {letter ? (
            <LetterInspector
              letter={letter}
              series={series}
              onEdit={(patch) => editLetter(letter.id, patch)}
              onDelete={() => {
                change({ ...strip, lettering: strip.lettering.filter((l) => l.id !== letter.id) });
                setSelection(null);
              }}
            />
          ) : (
            <div className="col" style={{ gap: 12 }}>
              <h2 style={{ margin: 0 }}>{t('canvas.strip')}</h2>
              <Field label={t('canvas.width')}>
                <NumberInput
                  value={strip.width}
                  min={320}
                  max={2400}
                  onChange={(v) => v && change({ ...strip, width: v })}
                />
              </Field>
              <Field label={t('canvas.margin')}>
                <NumberInput
                  value={strip.margin}
                  min={0}
                  max={400}
                  onChange={(v) => change({ ...strip, margin: v ?? 0 })}
                />
              </Field>
              <Field label={t('canvas.background')}>
                <TextInput
                  mono
                  value={strip.background}
                  onChange={(background) => change({ ...strip, background })}
                />
              </Field>
              <Field label={t('canvas.direction')} hint={t('canvas.directionHint')}>
                <Select
                  value={strip.text_direction}
                  options={(['horizontal', 'vertical'] as const).map((d) => ({
                    value: d,
                    label: t(`canvas.directions.${d}`),
                  }))}
                  onChange={(text_direction) => change({ ...strip, text_direction })}
                />
              </Field>
              <p className="small muted">{t('canvas.hint')}</p>
            </div>
          )}
        </aside>
      </div>
      <PacingDialog
        episodeId={episode.id}
        panels={panels}
        open={pacing}
        onOpenChange={setPacing}
        onApplied={() => autoLayout(true)}
      />
    </div>
  );
}
