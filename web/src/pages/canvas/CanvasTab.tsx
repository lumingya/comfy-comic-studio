import { LayoutTemplate, Lock, Plus, Save, Trash2, Unlock, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLayoutStrip, useSaveStrip } from '../../api/production';
import { DIALOGUE_KINDS, type LetteringLayer, type Strip } from '../../api/types';
import { useUI } from '../../app/ui-store';
import { toast, toastError } from '../../components/toast';
import {
  Empty,
  Field,
  NumberInput,
  Select,
  Switch,
  TextArea,
  TextInput,
} from '../../components/ui';
import { useEpisodeContext } from '../episode/EpisodePage';
import { pickAdopted } from './adopted';
import { StripStage, type Selection } from './StripStage';

type Box = [number, number, number, number];
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

  useEffect(() => {
    setStrip(episode.strip);
    setDirty(false);
  }, [episode.strip]);

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

  const speakers = [
    { value: '', label: t('script.narrator') },
    ...series.bible.characters.map((c) => ({ value: c.id, label: c.name })),
  ];

  return (
    <div className="canvas-layout">
      <div className="canvas-toolbar">
        <button className="btn" disabled={layout.isPending} onClick={() => autoLayout(false)}>
          <LayoutTemplate size={15} /> {t('canvas.relayoutPanels')}
        </button>
        <button className="btn" disabled={layout.isPending} onClick={() => autoLayout(true)}>
          {t('canvas.relayoutAll')}
        </button>
        <button
          className="btn ghost"
          onClick={() => {
            const id = `letter_${Date.now().toString(16)}`;
            const y = Math.max(40, Math.round(strip.height / 2));
            change({
              ...strip,
              manual: true,
              lettering: [
                ...strip.lettering,
                {
                  id,
                  panel_id: null,
                  kind: 'caption',
                  text: '…',
                  speaker_id: null,
                  box: [40, y, 320, y + 70],
                  tail_to: null,
                  vertical: false,
                  font_size: null,
                  locked: true,
                },
              ],
            });
            setSelection({ type: 'letter', id });
          }}
        >
          <Plus size={15} /> {t('canvas.addText')}
        </button>
        <span className="grow" />
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
            images={images}
            scale={scale}
            selection={selection}
            onSelect={setSelection}
            onPanelBox={(id, box) =>
              change({ ...strip, manual: true, panel_boxes: { ...strip.panel_boxes, [id]: box } })
            }
            onLetterBox={(id, box: Box) => editLetter(id, { box, locked: true })}
          />
        </div>
        <aside className="canvas-inspector card">
          {letter ? (
            <div className="col" style={{ gap: 12 }}>
              <div className="row">
                <h2 className="grow" style={{ margin: 0 }}>
                  {t('canvas.text')}
                </h2>
                <button
                  className="btn ghost icon sm"
                  title={t('script.locked')}
                  onClick={() => editLetter(letter.id, { locked: !letter.locked })}
                >
                  {letter.locked ? <Lock size={14} /> : <Unlock size={14} />}
                </button>
                <button
                  className="btn ghost icon sm danger"
                  aria-label={t('common.delete')}
                  onClick={() => (
                    change({
                      ...strip,
                      lettering: strip.lettering.filter((l) => l.id !== letter.id),
                    }),
                    setSelection(null)
                  )}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <TextArea
                rows={3}
                value={letter.text}
                onChange={(text) => editLetter(letter.id, { text, locked: true })}
              />
              <Field label={t('script.kind')}>
                <Select
                  value={letter.kind}
                  options={DIALOGUE_KINDS.map((k) => ({ value: k, label: t(`script.kinds.${k}`) }))}
                  onChange={(kind) => editLetter(letter.id, { kind, locked: true })}
                />
              </Field>
              <Field label={t('script.speaker')}>
                <Select
                  value={letter.speaker_id ?? ''}
                  options={speakers}
                  onChange={(s) => editLetter(letter.id, { speaker_id: s || null })}
                />
              </Field>
              <Field label={t('canvas.fontSize')}>
                <NumberInput
                  value={letter.font_size}
                  min={10}
                  max={120}
                  placeholder={t('common.auto')}
                  onChange={(font_size) => editLetter(letter.id, { font_size, locked: true })}
                />
              </Field>
              <Switch
                checked={letter.vertical}
                onChange={(vertical) => editLetter(letter.id, { vertical, locked: true })}
                label={t('canvas.vertical')}
              />
            </div>
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
              <p className="small muted">{t('canvas.hint')}</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
