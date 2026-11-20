import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useBatchPatchPanels,
  useDeletePanel,
  useDuplicatePanel,
  usePatchPanel,
} from '../../api/series';
import type { Panel, PanelOverrides } from '../../api/types';
import { Icon } from '../../app/icons';
import { useAutoDraft, type AutosaveController } from '../../app/useAutoDraft';
import { shortcutBlocked } from '../../app/shortcuts';
import { confirm } from '../../components/confirm';
import { SaveState } from '../../components/SaveState';
import { toast, toastError } from '../../components/toast';
import { useEpisodeContext } from '../episode/EpisodePage';
import { variableTable } from '../script/variables';
import { captionText, replaceCaption } from './caption';
import { FrameLoraSettings } from './FrameLoraSettings';
import { FrameVariablePreview } from './FrameVariablePreview';
import {
  PromptSurface,
  type KnownVariables,
  type PromptSources,
  type PromptUsage,
} from './PromptSurface';
import { WorkshopDraftGuard } from './workshopSource';
export function FramePage({
  panel,
  index,
  count,
  panels,
  known,
  sources,
  used,
  base,
  onSelect,
  registerSave,
  moveFrame,
  reordering,
}: {
  panel: Panel;
  index: number;
  count: number;
  panels: Panel[];
  known: KnownVariables;
  sources: PromptSources;
  used: PromptUsage;
  /** The story's starting template (故事梗概 / 起手模板), '' when none. */
  base: string;
  onSelect: (id: string | undefined) => void;
  registerSave: (save: AutosaveController | null) => void;
  moveFrame: (id: string, dir: -1 | 1) => Promise<void>;
  reordering: boolean;
}) {
  const { t } = useTranslation();
  const { episode, series } = useEpisodeContext();
  const eid = episode.id!;
  const patch = usePatchPanel(eid);
  const batch = useBatchPatchPanels(eid);
  const duplicate = useDuplicatePanel(eid);
  const remove = useDeletePanel(eid);
  const initial = useMemo(
    () => ({
      description: panel.description,
      overrides: panel.overrides,
      dialogues: panel.dialogues,
    }),
    [panel],
  );
  const draft = useAutoDraft(initial, (changes) =>
    patch.mutateAsync({ panelId: panel.id!, changes }),
  );
  useEffect(() => {
    registerSave(draft);
    return () => registerSave(null);
  }, [registerSave, draft.flush]);
  const ov = draft.value.overrides;
  const variableValues = useMemo(
    () => new Map(Object.entries(variableTable(series, { ...panel, ...draft.value }))),
    [series, panel, draft.value],
  );
  const frameKnown = useMemo(() => {
    const merged = new Map(known);
    for (const [key, value] of variableValues) merged.set(key, merged.get(key) || !!value.trim());
    return merged;
  }, [known, variableValues]);
  const commit = () => {
    void draft.flushAll().catch(toastError);
  };
  const setOverrides = (changes: Partial<PanelOverrides>) =>
    draft.change((previous) => ({ ...previous, overrides: { ...previous.overrides, ...changes } }));
  const name = {
    value: draft.value.description,
    onChange: (description: string) => draft.change((previous) => ({ ...previous, description })),
    onBlur: commit,
  };
  const prompt = {
    value: ov.raw_prompt ?? '',
    onChange: (raw_prompt: string) => setOverrides({ raw_prompt }),
    onBlur: commit,
  };
  const negative = {
    value: ov.raw_negative ?? '',
    onChange: (raw_negative: string) => setOverrides({ raw_negative: raw_negative || null }),
    onBlur: commit,
  };
  const text = {
    value: captionText(draft.value.dialogues),
    onChange: (value: string) =>
      draft.change((previous) => ({
        ...previous,
        dialogues: replaceCaption(previous.dialogues, value),
      })),
    onBlur: commit,
  };

  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  const values = (ov.values ?? {}) as Record<string, unknown>;
  const setValue = (key: string, v: string) => {
    const next = { ...values };
    if (v.trim() === '') delete next[key];
    else next[key] = Number(v);
    setOverrides({ values: next });
  };

  return (
    <section
      className="workshop-page"
      data-editor-key={panel.id}
      onKeyDown={(event) => {
        if (
          !shortcutBlocked(event, event.currentTarget, true) &&
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === 's'
        ) {
          event.preventDefault();
          commit();
        }
      }}
    >
      <WorkshopDraftGuard save={draft} />
      <div className="row" style={{ marginBottom: 10 }}>
        <SaveState state={draft.state} />
        <span className="grow" />
        <button
          type="button"
          className="btn ghost small"
          disabled={!draft.busy() || draft.state === 'saving'}
          onClick={commit}
        >
          {t('common.save')}
        </button>
      </div>
      <div className="workshop-page-title">
        <input
          value={name.value}
          aria-label={t('ws.story.frameName')}
          onChange={(e) => name.onChange(e.target.value)}
          onBlur={name.onBlur}
        />
        <button
          type="button"
          className="ibtn"
          title={t('ws.story.moveUp')}
          aria-label={t('ws.story.moveUp')}
          disabled={index === 0 || reordering}
          onClick={() => void moveFrame(panel.id!, -1)}
        >
          <Icon name="up" />
        </button>
        <button
          type="button"
          className="ibtn"
          title={t('ws.story.moveDown')}
          aria-label={t('ws.story.moveDown')}
          disabled={index === count - 1 || reordering}
          onClick={() => void moveFrame(panel.id!, 1)}
        >
          <Icon name="down" />
        </button>
        <button
          type="button"
          className="ibtn"
          title={t('ws.story.copy')}
          aria-label={t('ws.story.copy')}
          onClick={async () => {
            try {
              await draft.flushAll();
            } catch (error) {
              toastError(error);
              return;
            }
            duplicate.mutate(panel.id!, {
              onSuccess: (ep) => {
                const sorted = [...ep.panels].sort((a, b) => a.order - b.order);
                onSelect(sorted[index + 1]?.id);
              },
              onError: toastError,
            });
          }}
        >
          <Icon name="copy" />
        </button>
        <button
          type="button"
          className="ibtn"
          title={t('ws.story.remove')}
          aria-label={t('ws.story.remove')}
          onClick={async () => {
            if (!(await confirm({ title: t('ws.story.removeConfirm'), danger: true }))) return;
            await draft.flushAll().catch(() => undefined);
            remove.mutate(panel.id!, {
              onSuccess: () => {
                draft.discard();
                onSelect(panels[index + 1]?.id ?? panels[index - 1]?.id);
              },
              onError: toastError,
            });
          }}
        >
          <Icon name="trash" />
        </button>
      </div>
      <div className="negative-heading prompt-heading">
        <label htmlFor="workshop-frame-prompt">{t('ws.story.prompt')}</label>
        {base && !prompt.value.trim() ? (
          <button
            type="button"
            className="btn small ghost"
            onClick={() => {
              prompt.onChange(base);
              document.getElementById('workshop-frame-prompt')?.focus();
            }}
          >
            <Icon name="plus" sm />
            {t('ws.story.applyBase')}
          </button>
        ) : null}
      </div>
      <PromptSurface
        id="workshop-frame-prompt"
        className="workshop-prompt"
        known={frameKnown}
        sources={sources}
        used={used}
        placeholder={t('ws.story.promptHint')}
        {...prompt}
      />
      <div className="negative-heading">
        <label htmlFor="workshop-frame-negative">{t('ws.story.negative')}</label>
        <button
          type="button"
          className="btn small ghost"
          disabled={batch.isPending}
          onClick={async () => {
            // Save this frame's pending edits first so the autosave cannot land after the batch.
            try {
              await draft.flushAll();
              await batch.mutateAsync({
                panelIds: panels.map((p) => p.id!),
                changes: { overrides: { raw_negative: negative.value || null } },
              });
              toast(t('ws.story.negativeAllDone', { n: panels.length }));
            } catch (error) {
              toastError(error);
            }
          }}
        >
          <Icon name="copy" sm />
          {t('ws.story.negativeAll')}
        </button>
      </div>
      <PromptSurface
        id="workshop-frame-negative"
        className="workshop-negative"
        known={frameKnown}
        sources={sources}
        used={used}
        placeholder={t('ws.story.negativeHint')}
        {...negative}
      />
      <div className="field">
        <label className="label" htmlFor="workshop-frame-caption">
          {t('ws.story.caption')}
        </label>
        <PromptSurface
          id="workshop-frame-caption"
          className="workshop-caption"
          known={frameKnown}
          sources={sources}
          used={used}
          prose
          {...text}
        />
      </div>
      <FrameVariablePreview
        prompt={prompt.value}
        negative={negative.value}
        caption={text.value}
        values={variableValues}
      />
      <details className="quiet-advanced">
        <summary>{t('ws.story.params')}</summary>
        <p className="help workshop-parameter-notice">{t('ws.story.paramsHelp')}</p>
        <div className="grid2">
          {(
            [
              ['width', ov.width, (v: string) => setOverrides({ width: num(v) })],
              ['height', ov.height, (v: string) => setOverrides({ height: num(v) })],
              ['steps', values.steps as number | undefined, (v: string) => setValue('steps', v)],
              ['cfg', values.cfg as number | undefined, (v: string) => setValue('cfg', v)],
              ['seed', ov.seed, (v: string) => setOverrides({ seed: num(v) })],
            ] as const
          ).map(([key, value, set]) => (
            <div className="field" key={key}>
              <label className="label" htmlFor={`frame-${key}`}>
                {t(`ws.story.param.${key}`)}
              </label>
              <input
                id={`frame-${key}`}
                type="number"
                value={value ?? ''}
                placeholder={t('ws.story.paramDefault')}
                onChange={(e) => set(e.target.value)}
                onBlur={commit}
              />
            </div>
          ))}
        </div>
        <FrameLoraSettings
          overrides={ov.slot_overrides ?? {}}
          onChange={(slot_overrides) => setOverrides({ slot_overrides })}
        />
      </details>
    </section>
  );
}
