import { useQueryClient } from '@tanstack/react-query';
import {
  Copy,
  History,
  Lock,
  PanelRightClose,
  PanelRightOpen,
  Play,
  SlidersHorizontal,
  Trash2,
  Unlock,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../api/client';
import { keys } from '../../api/keys';
import { useRender } from '../../api/production';
import { useDuplicatePanel, usePatchPanel } from '../../api/series';
import { ANGLES, SHOTS, TIMES, type Episode, type Panel, type Series } from '../../api/types';
import { AutoSaveGuard, flushDraft } from '../../app/useAutoDraft';
import { shortcutBlocked } from '../../app/shortcuts';
import { useAutosave } from '../../app/autosave';
import { useStudio, useUI } from '../../app/ui-store';
import { insertVariable, PromptField, scanVariables } from '../../components/PromptField';
import { SaveState } from '../../components/SaveState';
import { toast, toastError } from '../../components/toast';
import { Field, NumberInput, Select, TagInput, TextArea } from '../../components/ui';
import { CastPicker } from './CastPicker';
import { CompositionEditor } from './CompositionEditor';
import { GenerateStage } from './GenerateStage';
import { HistoryDialog, RenderValuesFields, VariableOverrides } from './PanelExtras';
import { CastEditor, DialogueEditor, PromptPreview } from './parts';
import { RATIOS, WIDTHS } from './options';
import { StripFields } from './StripFields';
import { suggestedVariables, variableTable } from './variables';

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

/** A collapsible inspector group with a one-line summary of what is set. */
function Group(props: { title: string; summary?: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="inspector-group" open={props.open}>
      <summary>
        <span className="grow">{props.title}</span>
        {props.summary ? <span className="inspector-summary">{props.summary}</span> : null}
      </summary>
      <div className="inspector-body">{props.children}</div>
    </details>
  );
}

/**
 * Edits one panel.  The classic core — prompt with `{变量}`, characters, lines, generate & pick —
 * is the same in both modes; Studio mode adds the professional toolkit in an inspector drawer.
 * Changes autosave shortly after typing stops (and when switching panels); Ctrl+S saves at once,
 * Ctrl+Enter generates.  Deleting is delegated to the parent so it can offer "Undo".
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
  const studio = useStudio('script');
  const inspectorOpen = useUI((s) => s.inspectorOpen);
  const setInspectorOpen = useUI((s) => s.setInspectorOpen);
  const patch = usePatchPanel(episode.id!);
  const duplicate = useDuplicatePanel(episode.id!);
  const render = useRender(episode.id!);
  const [history, setHistory] = useState(false);
  const [draft, setDraft] = useState<Panel>(props.panel);
  const [nodeText, setNodeText] = useState(() => nodeJson(props.panel));
  const nodeOverrides = parseOverrides(nodeText);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const autosave = useAutosave(async () => {
    if (parseOverrides(nodeText) === null) throw new Error(t('common.invalidJson'));
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

  // Server-side changes (undo, another tab) replace the draft unless edits are pending.
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

  // The one prompt box: a legacy / "full prompt" panel edits raw_prompt (sent as written),
  // otherwise the words are appended after the automatic tags (characters, style, quality).
  const rawMode = draft.overrides.raw_prompt !== null && draft.overrides.raw_prompt !== undefined;
  const promptValue = rawMode ? (draft.overrides.raw_prompt ?? '') : draft.overrides.append_prompt;
  const setPrompt = (v: string) =>
    rawMode ? setOv({ raw_prompt: v }) : setOv({ append_prompt: v });
  const setRawMode = (raw: boolean) => {
    if (raw === rawMode) return;
    setOv(
      raw
        ? { raw_prompt: draft.overrides.append_prompt, append_prompt: '' }
        : { append_prompt: draft.overrides.raw_prompt ?? '', raw_prompt: null },
    );
  };
  const known = useMemo(() => variableTable(series, draft), [series, draft]);
  const uses = scanVariables(promptValue, known);
  const empty = uses.filter((u) => u.state === 'empty').map((u) => u.name);
  const missing = uses.filter((u) => u.state === 'missing').map((u) => u.name);
  const insert = (name: string) => {
    const el = promptRef.current;
    const { text, caret } = insertVariable(el, promptValue, name);
    setPrompt(text);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  };

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

  // Save first, then queue `count` candidates of this panel on the job engine.
  const generating = useRef(false);
  const generate = async (count: number) => {
    if (generating.current || render.isPending || nodeOverrides === null) return;
    generating.current = true;
    try {
      await flushDraft(autosave);
      await render.mutateAsync({ panel_ids: [draft.id!], candidates: count, variant_ids: [null] });
      toast(t('classic.stage.queuedToast', { count }));
    } catch (error) {
      toastError(error);
    } finally {
      generating.current = false;
    }
  };

  const cameraSummary = [
    draft.shot ? t(`script.shots.${draft.shot}`) : '',
    draft.angle ? t(`script.angles.${draft.angle}`) : '',
    draft.time ? t(`script.times.${draft.time}`) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const inspector = (
    <aside className="inspector" aria-label={t('classic.inspector.title')}>
      <header className="inspector-head">
        <SlidersHorizontal size={14} />
        <span className="grow">
          <strong>{t('classic.inspector.title')}</strong>
          <small>{t('classic.inspector.sub')}</small>
        </span>
        <button
          className="btn ghost icon sm"
          title={t('classic.inspector.hide')}
          aria-label={t('classic.inspector.hide')}
          onClick={() => setInspectorOpen(false)}
        >
          <PanelRightClose size={15} />
        </button>
      </header>

      <Group title={t('script.groupCamera')} summary={cameraSummary} open={cameraUsed}>
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
      </Group>

      <Group
        title={t('classic.inspector.cast')}
        summary={draft.characters.length ? String(draft.characters.length) : ''}
        open={draft.characters.some((c) => c.expression || c.action || c.outfit || c.tags?.length)}
      >
        <CastEditor
          value={draft.characters}
          series={series}
          onChange={(characters) => set({ characters })}
        />
      </Group>

      <Group
        title={t('script.groupLayout')}
        summary={`${draft.aspect_ratio} · ${t(`script.widths.${draft.width_mode}`)}`}
      >
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
      </Group>

      <Group
        title={t('composition.heading')}
        open={!!draft.regional || !!draft.controls?.length}
        summary={draft.controls?.length ? String(draft.controls.length) : ''}
      >
        <CompositionEditor episode={episode} draft={draft} set={set} />
      </Group>

      <Group title={t('render.heading')} open={valuesUsed}>
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
      </Group>

      <Group
        title={t('classic.inspector.advanced')}
        open={nodeOverrides === null || !!Object.keys(draft.overrides.node_overrides ?? {}).length}
      >
        <Field label={t('script.seed')}>
          <NumberInput
            value={draft.overrides.seed}
            onChange={(seed) => setOv({ seed })}
            placeholder={t('common.auto')}
          />
        </Field>
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
      </Group>

      <Group title={t('script.preview')} open>
        <PromptPreview episodeId={episode.id!} panelId={draft.id!} series={series} />
      </Group>
    </aside>
  );

  return (
    <div
      className={`panel-editor ${studio ? 'studio' : 'classic'} ${studio && inspectorOpen ? 'with-inspector' : ''}`}
      onKeyDown={(e) => {
        if (shortcutBlocked(e, e.currentTarget, true) || e.repeat) return;
        const mod = e.metaKey || e.ctrlKey;
        if (mod && e.key.toLowerCase() === 's') {
          e.preventDefault();
          autosave.flush().catch(toastError);
        } else if (mod && e.key === 'Enter') {
          e.preventDefault();
          void generate(useUI.getState().candidates);
        }
      }}
    >
      <AutoSaveGuard save={autosave} includeSearch />
      <div className="editor-main">
        <div className="save-bar editor-head">
          <span className="panel-badge mono" title={draft.id}>
            {String(props.index + 1).padStart(2, '0')}
          </span>
          <input
            className="panel-title-input"
            value={draft.description}
            placeholder={t('classic.editor.titlePlaceholder', { n: props.index + 1 })}
            aria-label={t('classic.editor.title')}
            title={t('script.descriptionHint')}
            onChange={(e) => set({ description: e.target.value })}
          />
          <span className="sr-only">{t('script.panelNo', { n: props.index + 1 })}</span>
          <SaveState state={autosave.state} invalid={nodeOverrides === null} />
          <span className="editor-actions">
            {studio ? (
              <>
                <button
                  className="btn ghost sm"
                  disabled={render.isPending}
                  onClick={() => void generate(1)}
                  title={t('script.renderOneHint')}
                >
                  <Play size={14} /> {t('script.renderOne')}
                </button>
                <button
                  className="btn ghost icon sm"
                  onClick={() => setHistory(true)}
                  title={t('history.hint')}
                  aria-label={t('history.button')}
                >
                  <History size={14} />
                </button>
                <button
                  className={`btn ghost icon sm ${draft.locked ? 'active' : ''}`}
                  onClick={() => set({ locked: !draft.locked })}
                  title={draft.locked ? t('script.unlock') : t('script.lock')}
                  aria-label={draft.locked ? t('script.unlock') : t('script.lock')}
                >
                  {draft.locked ? <Lock size={14} /> : <Unlock size={14} />}
                </button>
              </>
            ) : null}
            <button
              className="btn ghost icon sm"
              disabled={duplicate.isPending}
              title={t('script.duplicate')}
              aria-label={t('script.duplicate')}
              onClick={() =>
                flushDraft(autosave)
                  .then(() => duplicate.mutateAsync(draft.id!))
                  .catch(toastError)
              }
            >
              <Copy size={14} />
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
            {studio && !inspectorOpen ? (
              <button
                className="btn sm inspector-toggle"
                onClick={() => setInspectorOpen(true)}
                title={t('classic.inspector.show')}
              >
                <PanelRightOpen size={14} /> {t('classic.inspector.title')}
              </button>
            ) : null}
          </span>
        </div>

        <section className="editor-block">
          <div className="editor-label">
            <span>{t('classic.editor.prompt')}</span>
            {studio ? (
              <div
                className="segmented mini"
                role="group"
                aria-label={t('classic.editor.promptMode')}
              >
                <button
                  type="button"
                  className={rawMode ? '' : 'active'}
                  aria-pressed={!rawMode}
                  title={t('classic.editor.appendHint')}
                  onClick={() => setRawMode(false)}
                >
                  {t('classic.editor.modeAppend')}
                </button>
                <button
                  type="button"
                  className={rawMode ? 'active' : ''}
                  aria-pressed={rawMode}
                  title={t('classic.editor.rawHint')}
                  onClick={() => setRawMode(true)}
                >
                  {t('classic.editor.modeRaw')}
                </button>
              </div>
            ) : rawMode ? (
              <span className="chip ok" title={t('classic.editor.rawHint')}>
                {t('classic.editor.modeRaw')}
              </span>
            ) : null}
          </div>
          <PromptField
            inputRef={promptRef}
            value={promptValue}
            onChange={setPrompt}
            known={known}
            minRows={studio ? 4 : 6}
            aria-label={t('classic.editor.prompt')}
            placeholder={t('classic.editor.promptPlaceholder')}
          />
          <div className="var-line">
            <span className={`dot ${missing.length ? 'amber' : ''}`} aria-hidden />
            <span>
              {uses.length
                ? t('classic.editor.varsFound', { count: uses.length })
                : t('classic.editor.varsNone')}
              {empty.length
                ? ` · ${t('classic.editor.varsEmpty', { names: empty.join(', ') })}`
                : ''}
              {missing.length
                ? ` · ${t('classic.editor.varsMissing', { names: missing.join(', ') })}`
                : ''}
            </span>
          </div>
          <div className="var-chips" aria-label={t('classic.editor.insert')}>
            <span className="muted small">{t('classic.editor.insert')}</span>
            {suggestedVariables(series).map((name) => (
              <button
                key={name}
                type="button"
                className={`var-chip ${known[name] ? 'is-ok' : 'is-empty'}`}
                title={known[name] || t('classic.editor.varEmptyValue')}
                onClick={() => insert(name)}
              >
                {`{${name}}`}
              </button>
            ))}
          </div>
        </section>

        <section className="editor-block">
          <div className="editor-label">
            <span>{t('classic.editor.cast')}</span>
          </div>
          <CastPicker
            value={draft.characters}
            series={series}
            onChange={(characters) => set({ characters })}
          />
        </section>

        <section className="editor-block">
          <div className="editor-label">
            <span>{t('script.dialogue')}</span>
          </div>
          <DialogueEditor
            value={draft.dialogues}
            series={series}
            onChange={(dialogues) => set({ dialogues })}
          />
        </section>

        <details className="editor-fold" open={!!draft.overrides.negative_prompt}>
          <summary>{t('classic.editor.negative')}</summary>
          <TextArea
            mono
            rows={2}
            value={draft.overrides.negative_prompt}
            onChange={(negative_prompt) => setOv({ negative_prompt })}
            placeholder="lowres, bad hands, text"
          />
        </details>

        <GenerateStage
          episode={episode}
          panelId={draft.id!}
          onGenerate={(n) => void generate(n)}
          busy={render.isPending}
        />

        {!studio ? (
          <details className="editor-fold">
            <summary>{t('classic.editor.finalPrompt')}</summary>
            <PromptPreview episodeId={episode.id!} panelId={draft.id!} series={series} />
          </details>
        ) : null}
      </div>

      {studio && inspectorOpen ? inspector : null}

      <HistoryDialog
        episodeId={episode.id!}
        panel={draft}
        open={history}
        onOpenChange={setHistory}
      />
    </div>
  );
}
