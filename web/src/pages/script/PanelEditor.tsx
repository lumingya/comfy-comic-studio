import { useQueryClient } from '@tanstack/react-query';
import { Copy, History, Lock, Play, Trash2, Unlock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../api/client';
import { keys } from '../../api/keys';
import { useRender } from '../../api/production';
import { useDuplicatePanel, usePatchPanel } from '../../api/series';
import { ANGLES, SHOTS, TIMES, type Episode, type Panel, type Series } from '../../api/types';
import { useAutosave } from '../../app/autosave';
import { toast, toastError } from '../../components/toast';
import { Field, NumberInput, Select, TagInput, TextArea, TextInput } from '../../components/ui';
import { CompositionEditor } from './CompositionEditor';
import { CastEditor, DialogueEditor, PromptPreview } from './parts';
import { HistoryDialog, RecentTakes, RenderValuesFields, VariableOverrides } from './PanelExtras';
import { RATIOS, WIDTHS } from './options';
import { SaveState } from '../../components/SaveState';
import { StripFields } from './StripFields';

function parseOverrides(text: string): Record<string, unknown> | null {
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

const nodeJson = (panel: Panel) =>
  Object.keys(panel.overrides.node_overrides ?? {}).length
    ? JSON.stringify(panel.overrides.node_overrides, null, 2)
    : '';

/** The draft as it would be stored (node overrides parsed; invalid JSON keeps the saved ones). */
export function panelSnapshot(draft: Panel, nodeText: string): Panel {
  const node = parseOverrides(nodeText);
  return node === null
    ? draft
    : { ...draft, overrides: { ...draft.overrides, node_overrides: node } };
}

/**
 * Edits one panel.  Changes autosave shortly after typing stops (and when switching panels);
 * Ctrl+S saves at once.  Deleting is delegated to the parent so it can offer "Undo".
 */
export function PanelEditor(props: {
  episode: Episode;
  series: Series;
  panel: Panel;
  index: number;
  onDelete: (snapshot: Panel) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { episode, series } = props;
  const patch = usePatchPanel(episode.id!);
  const duplicate = useDuplicatePanel(episode.id!);
  const render = useRender(episode.id!);
  const [history, setHistory] = useState(false);
  const [draft, setDraft] = useState<Panel>(props.panel);
  const [nodeText, setNodeText] = useState(() => nodeJson(props.panel));
  const nodeOverrides = parseOverrides(nodeText);

  const autosave = useAutosave(async () => {
    const { id, order: _order, ...changes } = panelSnapshot(draft, nodeText);
    const send = () =>
      patch.mutateAsync({
        panelId: id!,
        changes,
        // The latest revision we know of (every save / reorder refreshes the cached episode).
        revision: qc.getQueryData<Episode>(keys.episode(episode.id!))?.revision ?? episode.revision,
      });
    try {
      await send();
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 409)) throw error;
      // Changed elsewhere meanwhile: reload, then write this panel's fields once more.
      await qc.refetchQueries({ queryKey: keys.episode(episode.id!), exact: true });
      await send();
    }
  });

  // Server-side changes (assistant, undo, another tab) replace the draft unless edits are pending.
  useEffect(() => {
    if (autosave.busy()) return;
    setDraft(props.panel);
    setNodeText(nodeJson(props.panel));
  }, [props.panel]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (changes: Partial<Panel>) => {
    setDraft((d) => ({ ...d, ...changes }));
    autosave.touch();
  };
  const setOv = (changes: Partial<Panel['overrides']>) =>
    set({ overrides: { ...draft.overrides, ...changes } });

  const locations = [
    { value: '', label: t('common.none') },
    ...series.bible.locations.map((l) => ({ value: l.id!, label: l.name })),
  ];
  const cameraUsed =
    !!draft.shot || !!draft.angle || !!draft.location_id || !!draft.time || !!draft.tags?.length;
  const values = (draft.overrides.values ?? {}) as Record<string, unknown>;
  const renderKeys = ['steps', 'cfg', 'denoise', 'sampler'];
  const valuesUsed =
    Object.keys(values).some((k) => renderKeys.includes(k) || k.startsWith('$')) ||
    !!draft.overrides.width ||
    !!draft.overrides.height ||
    !!draft.overrides.profile_id;

  // One-frame test run (legacy 试跑这一格): save first, then queue a single candidate.
  const renderOne = () =>
    autosave
      .flush()
      .then(() =>
        render.mutateAsync({ panel_ids: [draft.id!], candidates: 1, variant_ids: [null] }),
      )
      .then(() => toast(t('script.queued', { count: 1 })), toastError);

  return (
    <div
      className="panel-editor"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          autosave.flush().catch(toastError);
        }
      }}
    >
      <div className="save-bar">
        <span className="panel-title" title={draft.id}>
          {t('script.panelNo', { n: props.index + 1 })}
        </span>
        <SaveState state={autosave.state} invalid={nodeOverrides === null} />
        <span className="grow" />
        <button
          className="btn ghost sm"
          disabled={render.isPending}
          onClick={renderOne}
          title={t('script.renderOneHint')}
        >
          <Play size={14} /> {t('script.renderOne')}
        </button>
        <button className="btn ghost sm" onClick={() => setHistory(true)} title={t('history.hint')}>
          <History size={14} /> {t('history.button')}
        </button>
        <button
          className={`btn ghost sm ${draft.locked ? 'active' : ''}`}
          onClick={() => set({ locked: !draft.locked })}
          title={t('script.locked')}
        >
          {draft.locked ? <Lock size={14} /> : <Unlock size={14} />}{' '}
          {draft.locked ? t('script.unlock') : t('script.lock')}
        </button>
        <button
          className="btn ghost sm"
          disabled={duplicate.isPending}
          onClick={() =>
            autosave
              .flush()
              .then(() => duplicate.mutateAsync(draft.id!))
              .catch(toastError)
          }
        >
          <Copy size={14} /> {t('script.duplicate')}
        </button>
        <button
          className="btn ghost icon sm danger"
          title={t('script.deletePanel')}
          aria-label={t('script.deletePanel')}
          onClick={() => {
            autosave.discard();
            props.onDelete(panelSnapshot(draft, nodeText));
          }}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* What the image should obey comes first; structured helpers below are optional. */}
      <Field label={t('script.appendPrompt')} hint={t('script.appendPromptHint')}>
        <TextArea
          mono
          rows={3}
          value={draft.overrides.append_prompt}
          onChange={(append_prompt) => setOv({ append_prompt })}
        />
      </Field>
      <Field label={t('common.description')} hint={t('script.descriptionHint')}>
        <TextArea
          rows={2}
          value={draft.description}
          onChange={(description) => set({ description })}
        />
      </Field>
      <Field label={t('script.cast')}>
        <CastEditor
          value={draft.characters}
          series={series}
          onChange={(characters) => set({ characters })}
        />
      </Field>
      <Field label={t('script.dialogue')}>
        <DialogueEditor
          value={draft.dialogues}
          series={series}
          onChange={(dialogues) => set({ dialogues })}
        />
      </Field>

      <details className="advanced" open={cameraUsed}>
        <summary>
          {t('script.groupCamera')}
          {cameraUsed ? null : <span className="muted"> · {t('script.shots.unset')}</span>}
        </summary>
        <div className="col" style={{ gap: 14, marginTop: 14 }}>
          <div className="grid-2">
            <Field label={t('script.shot')}>
              <Select
                value={draft.shot || 'unset'}
                onChange={(v) => set({ shot: (v === 'unset' ? '' : v) as Panel['shot'] })}
                options={SHOTS.map((x) => ({
                  value: x || 'unset',
                  label: t(`script.shots.${x || 'unset'}`),
                }))}
              />
            </Field>
            <Field label={t('script.angle')}>
              <Select
                value={draft.angle || 'unset'}
                onChange={(v) => set({ angle: (v === 'unset' ? '' : v) as Panel['angle'] })}
                options={ANGLES.map((x) => ({
                  value: x || 'unset',
                  label: t(`script.angles.${x || 'unset'}`),
                }))}
              />
            </Field>
            <Field label={t('script.location')}>
              <Select
                value={draft.location_id ?? ''}
                onChange={(v) => set({ location_id: v || null })}
                options={locations}
              />
            </Field>
            <Field label={t('bible.time')}>
              <Select
                value={draft.time || 'unset'}
                onChange={(v) => set({ time: (v === 'unset' ? '' : v) as Panel['time'] })}
                options={TIMES.map((x) => ({
                  value: x || 'unset',
                  label: t(`script.times.${x || 'unset'}`),
                }))}
              />
            </Field>
          </div>
          <Field label={t('common.tags')}>
            <TagInput value={draft.tags ?? []} onChange={(tags) => set({ tags })} />
          </Field>
        </div>
      </details>

      <details className="advanced">
        <summary>
          {t('script.groupLayout')}
          <span className="muted">
            {' '}
            · {draft.aspect_ratio} · {t(`script.widths.${draft.width_mode}`)}
          </span>
        </summary>
        <div className="col" style={{ gap: 14, marginTop: 14 }}>
          <div className="grid-2">
            <Field label={t('script.ratio')}>
              <Select
                value={draft.aspect_ratio}
                onChange={(aspect_ratio) => set({ aspect_ratio })}
                options={[...new Set([draft.aspect_ratio, ...RATIOS])].map((r) => ({
                  value: r,
                  label: r,
                }))}
              />
            </Field>
            <Field label={t('script.widthMode')}>
              <Select
                value={draft.width_mode}
                onChange={(width_mode) => set({ width_mode })}
                options={WIDTHS.map((w) => ({ value: w, label: t(`script.widths.${w}`) }))}
              />
            </Field>
          </div>
          <StripFields draft={draft} set={set} />
        </div>
      </details>

      <details className="advanced" open={!!draft.regional || !!draft.controls?.length}>
        <summary>{t('composition.heading')}</summary>
        <div style={{ marginTop: 14 }}>
          <CompositionEditor episode={episode} draft={draft} set={set} />
        </div>
      </details>

      <details className="advanced" open={valuesUsed}>
        <summary>{t('render.heading')}</summary>
        <div className="col" style={{ gap: 14, marginTop: 14 }}>
          <RenderValuesFields
            overrides={draft.overrides}
            values={values}
            onChange={(v) => setOv({ values: v })}
            onOverrides={setOv}
          />
          <Field label={t('render.variables')}>
            <VariableOverrides
              values={values}
              known={Object.keys(series.variables ?? {})}
              onChange={(v) => setOv({ values: v })}
            />
          </Field>
        </div>
      </details>

      <details className="advanced">
        <summary>{t('script.advanced')}</summary>
        <div className="col" style={{ gap: 14, marginTop: 14 }}>
          <Field label={t('script.rawPrompt')}>
            <TextArea
              mono
              rows={3}
              value={draft.overrides.raw_prompt ?? ''}
              onChange={(v) => setOv({ raw_prompt: v || null })}
            />
          </Field>
          <div className="grid-2">
            <Field label={t('script.negativePrompt')}>
              <TextInput
                mono
                value={draft.overrides.negative_prompt}
                onChange={(negative_prompt) => setOv({ negative_prompt })}
              />
            </Field>
            <Field label={t('script.seed')}>
              <NumberInput
                value={draft.overrides.seed}
                onChange={(seed) => setOv({ seed })}
                placeholder={t('common.auto')}
              />
            </Field>
          </div>
          <Field
            label={t('script.nodeOverrides')}
            hint={nodeOverrides === null ? 'JSON ✗' : '{"/3/inputs/steps": 30}'}
          >
            <TextArea
              mono
              rows={4}
              value={nodeText}
              onChange={(v) => (setNodeText(v), autosave.touch())}
            />
          </Field>
        </div>
      </details>

      <section className="card" style={{ marginTop: 18 }}>
        <h2>{t('script.preview')}</h2>
        <PromptPreview episodeId={episode.id!} panelId={draft.id!} series={series} />
      </section>
      <section className="card" style={{ marginTop: 12 }}>
        <RecentTakes
          episode={episode}
          panelId={draft.id!}
          onRender={renderOne}
          busy={render.isPending}
        />
      </section>
      <HistoryDialog
        episodeId={episode.id!}
        panel={draft}
        open={history}
        onOpenChange={setHistory}
      />
    </div>
  );
}
