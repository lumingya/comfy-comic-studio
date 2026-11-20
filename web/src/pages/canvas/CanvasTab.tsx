import {
  LayoutTemplate,
  Plus,
  Redo2,
  Save,
  Sparkles,
  Undo2,
  Wand2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLayoutStrip, useSaveStrip } from '../../api/production';
import type { LetteringLayer } from '../../api/types';
import { shortcutBlocked } from '../../app/shortcuts';
import { useUnsavedGuard } from '../../app/autosave';
import { toast, toastError } from '../../components/toast';
import { Empty, Field, NumberInput, Select, TextInput } from '../../components/ui';
import { useEpisodeContext } from '../episode/EpisodePage';
import { pickAdopted } from './adopted';
import { LetterInspector } from './LetterInspector';
import { PacingDialog } from './PacingDialog';
import { PanelInspector } from './PanelInspector';
import { usePublishCreationContext } from '../../extensions/creationContext';
import { ReadabilityBadge } from './CanvasReadability';
import {
  alignLetters,
  newLayer,
  selectedLetterIds,
  syncLetterStyle,
  toggleLetter,
} from './canvasTools';
import { LetterTools } from './LetterTools';
import { useAvoidLettering } from './canvasAssist';
import { StripStage, type Selection } from './StripStage';
import { useStripHistory } from './useStripHistory';

type Box = [number, number, number, number];

export default function CanvasTab() {
  const { t } = useTranslation();
  const { episode, series } = useEpisodeContext();
  const layout = useLayoutStrip(episode.id);
  const save = useSaveStrip(episode.id);
  const history = useStripHistory(episode.strip, episode.revision);
  const { strip, dirty, change } = history;
  const saving = useRef(false);
  const layingOut = useRef(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [scale, setScale] = useState(0.6);
  const [pacing, setPacing] = useState(false);
  const avoid = useAvoidLettering(episode.id);
  const revision = useRef(episode.revision);
  revision.current = episode.revision;
  useUnsavedGuard(dirty || save.isPending, true);

  // A new server copy (auto layout, pacing) replaces the canvas — but never unsaved edits.
  useEffect(() => {
    if (!saving.current && !layingOut.current) history.receive(episode.strip, episode.revision);
  }, [episode.strip, episode.revision, save.isPending, layout.isPending]);

  const saveStrip = () => {
    if (saving.current || layingOut.current) return;
    const snapshot = history.snapshot();
    saving.current = true;
    save.mutate(snapshot, {
      onSuccess: (stored) => {
        history.acknowledge(snapshot, stored);
        toast(t('common.saved'));
      },
      onError: toastError,
      onSettled: () => {
        saving.current = false;
      },
    });
  };

  const panels = useMemo(
    () => [...episode.panels].sort((a, b) => a.order - b.order),
    [episode.panels],
  );
  const images = useMemo(() => pickAdopted(episode.takes), [episode.takes]);
  const panelId =
    selection?.type === 'panel' && strip.panel_boxes[selection.id] ? selection.id : null;
  usePublishCreationContext({
    route: 'canvas',
    series_id: series.id,
    episode_id: episode.id,
    panel_ids: panelId ? [panelId] : [],
    revision: episode.revision,
  });
  const letter =
    selection?.type === 'letter' ? strip.lettering.find((l) => l.id === selection.id) : undefined;
  const selectedIds = selectedLetterIds(selection).filter((id) =>
    strip.lettering.some((l) => l.id === id),
  );
  const avoidSelected = () => {
    if (saving.current || layingOut.current || avoid.isPending) return;
    const snapshot = history.snapshot();
    const ids = snapshot.strip.lettering
      .filter((l) => selectedIds.includes(l.id) && (l.kind === 'speech' || l.kind === 'thought'))
      .map((l) => l.id);
    if (!ids.length) return;
    avoid.mutate(
      { base_revision: snapshot.baseRevision, strip: snapshot.strip, layer_ids: ids },
      {
        onSuccess: (preview) => {
          if (
            history.current() !== snapshot.strip ||
            history.snapshot().baseRevision !== snapshot.baseRevision ||
            revision.current !== preview.revision
          ) {
            toast(t('canvas.avoidStale'));
            return;
          }
          change(preview.strip);
          if (preview.unresolved.length)
            toast(t('canvas.avoidUnresolved', { count: preview.unresolved.length }));
        },
        onError: toastError,
      },
    );
  };
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

  const autoLayout = (relayout: boolean) => {
    if (dirty || saving.current || layingOut.current) return;
    const snapshot = history.snapshot();
    layingOut.current = true;
    layout.mutate(
      { relayout_lettering: relayout, baseRevision: snapshot.baseRevision },
      {
        onSuccess: (stored) => {
          history.acknowledge(snapshot, stored);
          toast(t('canvas.laidOut'));
        },
        onError: toastError,
        onSettled: () => {
          layingOut.current = false;
        },
      },
    );
  };

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
    <div
      className="canvas-layout"
      tabIndex={0}
      onKeyDown={(e) => {
        if (
          !shortcutBlocked(e, e.currentTarget, true) &&
          (e.metaKey || e.ctrlKey) &&
          e.key.toLowerCase() === 's'
        ) {
          e.preventDefault();
          if (dirty && !save.isPending && !layout.isPending) saveStrip();
          return;
        }
        if (!shortcutBlocked(e, e.currentTarget) && (e.metaKey || e.ctrlKey) && !e.altKey) {
          const key = e.key.toLowerCase();
          if (key === 'z' || key === 'y') {
            e.preventDefault();
            if (key === 'y' || e.shiftKey) history.redo();
            else history.undo();
          }
        }
      }}
    >
      <div className="canvas-toolbar">
        <button
          className="btn ghost icon"
          aria-label={t('canvas.undo')}
          title={t('canvas.undoHint')}
          disabled={!history.canUndo}
          onClick={history.undo}
        >
          <Undo2 size={15} />
        </button>
        <button
          className="btn ghost icon"
          aria-label={t('canvas.redo')}
          title={t('canvas.redoHint')}
          disabled={!history.canRedo}
          onClick={history.redo}
        >
          <Redo2 size={15} />
        </button>
        <button
          className="btn"
          onClick={() => setPacing(true)}
          disabled={dirty || save.isPending || layout.isPending}
        >
          <Wand2 size={15} /> {t('pacing.open')}
        </button>
        <button
          className="btn"
          disabled={dirty || save.isPending || layout.isPending}
          title={dirty ? t('canvas.unsaved') : undefined}
          onClick={() => autoLayout(false)}
        >
          <LayoutTemplate size={15} /> {t('canvas.relayoutPanels')}
        </button>
        <button
          className="btn"
          disabled={dirty || save.isPending || layout.isPending}
          title={dirty ? t('canvas.unsaved') : undefined}
          onClick={() => autoLayout(true)}
        >
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
          <ReadabilityBadge episodeId={episode.id} bust={String(episode.revision)} />
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
          disabled={!dirty || save.isPending || layout.isPending}
          title="Ctrl+S"
          onClick={saveStrip}
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
            onPanelBox={(id, box: Box, crop?: Box) =>
              change({
                ...strip,
                manual: true,
                panel_boxes: { ...strip.panel_boxes, [id]: box },
                crops: crop ? { ...strip.crops, [id]: crop } : strip.crops,
              })
            }
            onLetter={(id, patch) => editLetter(id, { ...patch, locked: true })}
          />
        </div>
        <aside className="canvas-inspector card">
          {letter ? (
            <>
              <LetterInspector
                letter={letter}
                series={series}
                onEdit={(patch) => editLetter(letter.id, patch)}
                onDelete={() => {
                  change({
                    ...strip,
                    lettering: strip.lettering.filter((l) => l.id !== letter.id),
                  });
                  setSelection(null);
                }}
              />
              <LetterTools
                strip={strip}
                selected={selectedIds}
                source={letter}
                onToggle={(id) => setSelection(toggleLetter(selection, id, true))}
                onAlign={(alignment) => change(alignLetters(strip, selectedIds, alignment))}
                onSync={() => change(syncLetterStyle(strip, selectedIds, letter))}
                onAvoid={avoidSelected}
                avoiding={avoid.isPending}
                disabled={save.isPending || layout.isPending}
              />
            </>
          ) : panelId ? (
            <PanelInspector
              key={panelId}
              assetId={images[panelId]}
              box={strip.panel_boxes[panelId] as Box}
              crop={strip.crops[panelId] as Box | undefined}
              onCrop={(crop) => {
                const crops = { ...strip.crops };
                if (crop) crops[panelId] = crop;
                else delete crops[panelId];
                change({ ...strip, crops });
              }}
              onBack={() => setSelection(null)}
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
              <Field
                label={t('canvas.direction')}
                hint={strip.text_direction === 'vertical' ? t('canvas.directionHint') : undefined}
              >
                <Select
                  value={strip.text_direction}
                  options={(['horizontal', 'vertical'] as const).map((d) => ({
                    value: d,
                    label: t(`canvas.directions.${d}`),
                  }))}
                  onChange={(text_direction) => change({ ...strip, text_direction })}
                />
              </Field>
            </div>
          )}
        </aside>
      </div>
      <PacingDialog
        episodeId={episode.id}
        panels={panels}
        open={pacing}
        onOpenChange={setPacing}
        onApplied={(stored) => {
          if (history.receive(stored.strip, stored.revision)) autoLayout(true);
        }}
      />
    </div>
  );
}
