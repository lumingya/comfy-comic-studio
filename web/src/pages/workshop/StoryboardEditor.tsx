import { useDesktopSelection, type DesktopContext } from '../../app/useDesktopSelection';
import { useSelection } from '../../app/selection';
import { ContextMenu, useContextMenu } from '../../components/ContextMenu';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useAddPanel,
  useBatchDeletePanels,
  useBatchPatchPanels,
  useDeletePanel,
  useDuplicatePanel,
  usePatchPanel,
  useReorderPanels,
} from '../../api/series';
import type { Panel, PanelOverrides } from '../../api/types';
import { useWorkshop } from '../../api/workshop';
import { Icon } from '../../app/icons';
import {
  AutoSaveGuard,
  flushDraft,
  useAutoDraft,
  type AutosaveController,
} from '../../app/useAutoDraft';
import { shortcutBlocked } from '../../app/shortcuts';
import { SaveState } from '../../components/SaveState';
import { captionText, replaceCaption } from './caption';
import { confirm } from '../../components/confirm';
import { toastError } from '../../components/toast';
import { useEpisodeContext } from '../episode/EpisodePage';
import { PromptSurface, type KnownVariables } from './PromptSurface';

/** Every variable some preset defines (true when at least one gives it a value). */
export function useKnownVariables(): KnownVariables {
  const ws = useWorkshop();
  return useMemo(() => {
    const known: KnownVariables = new Map();
    for (const p of ws.data?.presets ?? [])
      for (const e of p.entries) known.set(e.key, known.get(e.key) || !!e.value.trim());
    for (const [k, v] of Object.entries(ws.data?.variables ?? {}))
      known.set(k, known.get(k) || !!v.trim());
    return known;
  }, [ws.data]);
}

export const basePromptKey = (id: string) => `mio.basePrompt.${id}`;

/** 分镜工坊: legacy frame list + page editor (name, prompt, negative, caption, parameters). */
export default function StoryboardEditor() {
  const { t } = useTranslation();
  const { episode } = useEpisodeContext();
  const known = useKnownVariables();
  const panels = useMemo(
    () => [...episode.panels].sort((a, b) => a.order - b.order),
    [episode.panels],
  );
  const [activeId, setActiveId] = useState<string | undefined>(panels[0]?.id);
  const active = panels.find((p) => p.id === activeId) ?? panels[0];
  const add = useAddPanel(episode.id!);
  const editorSave = useRef<AutosaveController | null>(null);
  const registerSave = useCallback((save: AutosaveController | null) => {
    editorSave.current = save;
  }, []);
  const choose = async (id: string | undefined) => {
    try {
      if (editorSave.current) await flushDraft(editorSave.current);
      setActiveId(id);
    } catch (error) {
      toastError(error);
    }
  };
  const panelIds = useMemo(() => panels.map((p) => p.id!), [panels]);
  const selection = useSelection(panelIds);
  const menu = useContextMenu<DesktopContext>();
  const duplicate = useDuplicatePanel(episode.id!);
  const removeMany = useBatchDeletePanels(episode.id!);
  const removeSelected = async (ids: string[]) => {
    if (
      !ids.length ||
      removeMany.isPending ||
      !(await confirm({ title: t('batch.deleteTitle', { count: ids.length }), danger: true }))
    )
      return;
    try {
      if (editorSave.current) await flushDraft(editorSave.current).catch(() => undefined);
      await removeMany.mutateAsync(ids);
      if (active?.id && ids.includes(active.id)) editorSave.current?.discard();
      selection.clear();
    } catch (error) {
      toastError(error);
    }
  };
  const copySelected = async (ids: string[]) => {
    try {
      if (editorSave.current) await flushDraft(editorSave.current);
      for (const id of ids) await duplicate.mutateAsync(id);
    } catch (error) {
      toastError(error);
    }
  };
  const desktop = useDesktopSelection({
    itemAttribute: 'data-selection-id',
    selection,
    enabled: true,
    pinned: false,
    contextOpen: !!menu.state,
    onExit: selection.clear,
    onOpen: (id) => {
      void choose(id);
    },
    onDelete: (ids) => {
      void removeSelected(ids);
    },
    onContext: menu.openAt,
    onCloseContext: menu.close,
  });
  useEffect(() => {
    if (active?.id && !selection.ids.length) selection.anchorAt(active.id);
  }, [active?.id, selection.ids.length, selection.anchorAt]);
  const [batch, setBatch] = useState(false);
  const [batchCount, setBatchCount] = useState(4);

  const addFrames = (count: number, prompt: string) => {
    let after = active?.id ?? null;
    const run = async () => {
      if (editorSave.current) await flushDraft(editorSave.current);
      if (!Number.isInteger(count) || count < 1 || count > 24) return;
      for (let i = 0; i < count; i += 1) {
        const ep = await add.mutateAsync({
          panel: {
            description: t('ws.story.frameN', { n: panels.length + i + 1 }),
            overrides: { raw_prompt: prompt } as PanelOverrides,
          },
          after,
        });
        const sorted = [...ep.panels].sort((a, b) => a.order - b.order);
        const idx = after ? sorted.findIndex((p) => p.id === after) + 1 : sorted.length - 1;
        after = sorted[idx]?.id ?? after;
        setActiveId(after ?? undefined);
      }
    };
    run().catch(toastError);
  };

  return (
    <>
      <div className="workshop-editor">
        <nav className="workshop-frames" aria-label={t('ws.story.framesLabel')}>
          <div
            className="workshop-frames-list desktop-list"
            ref={desktop.ref}
            tabIndex={0}
            onClickCapture={desktop.onClickCapture}
            onContextMenu={desktop.onContextMenu}
            onPointerDown={desktop.onPointerDown}
            onDragStartCapture={desktop.onDragStartCapture}
          >
            {(desktop.snapshot ?? selection.ids).length ? (
              <div className="selection-bar" role="status">
                <span>
                  {t('interaction.selected', { count: (desktop.snapshot ?? selection.ids).length })}
                </span>
                <button type="button" className="btn ghost small" onClick={selection.clear}>
                  {t('common.cancel')}
                </button>
              </div>
            ) : null}
            {panels.map((p, i) => (
              <button
                key={p.id}
                type="button"
                className={`${p.id === active?.id ? 'active' : ''} ${selection.has(p.id!) ? 'checked' : ''} ${menu.state?.payload.focusId === p.id ? 'is-context' : ''}`}
                data-selection-id={p.id}
                data-selection-open
                aria-selected={selection.has(p.id!) || undefined}
                aria-current={p.id === active?.id ? 'true' : undefined}
              >
                <small>{String(i + 1).padStart(2, '0')}</small>
                <span>{p.description || t('ws.story.frameN', { n: i + 1 })}</span>
              </button>
            ))}
          </div>
          <div className="workshop-frames-actions">
            <button
              type="button"
              className="btn small"
              disabled={add.isPending}
              onClick={() => addFrames(1, '')}
            >
              <Icon name="plus" sm />
              {t('ws.story.addFrame')}
            </button>
            <button
              type="button"
              className="btn small"
              disabled={add.isPending}
              aria-expanded={batch}
              onClick={() => setBatch(!batch)}
            >
              <Icon name="list" sm />
              {t('ws.story.addFrames')}
            </button>
            {batch ? (
              <div className="workshop-batch-add">
                <label>
                  {t('ws.story.batchCount')}
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={batchCount}
                    onChange={(e) => setBatchCount(Number(e.target.value))}
                  />
                </label>
                <button
                  type="button"
                  className="btn small primary"
                  disabled={
                    add.isPending ||
                    !(Number.isInteger(batchCount) && batchCount >= 1 && batchCount <= 24)
                  }
                  onClick={() => {
                    setBatch(false);
                    addFrames(batchCount, localStorage.getItem(basePromptKey(episode.id!)) ?? '');
                  }}
                >
                  {t('ws.story.batchGo')}
                </button>
              </div>
            ) : null}
          </div>
        </nav>
        {active ? (
          <FramePage
            key={active.id}
            panel={active}
            index={panels.indexOf(active)}
            count={panels.length}
            panels={panels}
            known={known}
            onSelect={(id) => void choose(id)}
            registerSave={registerSave}
          />
        ) : (
          <section className="workshop-page is-empty">
            <p className="help">{t('ws.story.noFrames')}</p>
          </section>
        )}
      </div>
      {menu.state ? (
        <ContextMenu
          x={menu.state.x}
          y={menu.state.y}
          returnFocus={menu.state.payload.target}
          onClose={menu.close}
          groups={[
            {
              items: [
                {
                  label: t('ws.story.copy'),
                  disabled: duplicate.isPending,
                  onSelect: () => {
                    void copySelected(menu.state!.payload.ids);
                  },
                },
                {
                  label: t('common.delete'),
                  danger: true,
                  disabled: removeMany.isPending,
                  onSelect: () => {
                    void removeSelected(menu.state!.payload.ids);
                  },
                },
                { label: t('classic.shelf.selectFiltered'), onSelect: selection.all },
                { label: t('classic.shelf.clearSelection'), onSelect: selection.clear },
              ],
            },
          ]}
        />
      ) : null}
    </>
  );
}

function FramePage({
  panel,
  index,
  count,
  panels,
  known,
  onSelect,
  registerSave,
}: {
  panel: Panel;
  index: number;
  count: number;
  panels: Panel[];
  known: KnownVariables;
  onSelect: (id: string | undefined) => void;
  registerSave: (save: AutosaveController | null) => void;
}) {
  const { t } = useTranslation();
  const { episode } = useEpisodeContext();
  const eid = episode.id!;
  const patch = usePatchPanel(eid);
  const batch = useBatchPatchPanels(eid);
  const reorder = useReorderPanels(eid);
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

  const move = async (dir: -1 | 1) => {
    try {
      await draft.flushAll();
    } catch (error) {
      toastError(error);
      return;
    }
    const ids = panels.map((p) => p.id!);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    reorder.mutate(ids, { onError: toastError });
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
      <AutoSaveGuard save={draft} includeSearch />
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
          disabled={index === 0}
          onClick={() => move(-1)}
        >
          <Icon name="up" />
        </button>
        <button
          type="button"
          className="ibtn"
          title={t('ws.story.moveDown')}
          aria-label={t('ws.story.moveDown')}
          disabled={index === count - 1}
          onClick={() => move(1)}
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
      </div>
      <PromptSurface
        id="workshop-frame-prompt"
        className="workshop-prompt"
        known={known}
        placeholder={t('ws.story.promptHint')}
        {...prompt}
      />
      <div className="negative-heading">
        <label htmlFor="workshop-frame-negative">{t('ws.story.negative')}</label>
        <button
          type="button"
          className="btn small ghost"
          onClick={() =>
            batch.mutate(
              {
                panelIds: panels.map((p) => p.id!),
                changes: { overrides: { raw_negative: negative.value || null } },
              },
              { onError: toastError },
            )
          }
        >
          <Icon name="copy" sm />
          {t('ws.story.negativeAll')}
        </button>
      </div>
      <PromptSurface
        id="workshop-frame-negative"
        className="workshop-negative"
        known={known}
        placeholder={t('ws.story.negativeHint')}
        foot={false}
        {...negative}
      />
      <div className="field">
        <label className="label" htmlFor="workshop-frame-caption">
          {t('ws.story.caption')}
        </label>
        <PromptSurface
          id="workshop-frame-caption"
          className="workshop-caption"
          known={known}
          prose
          {...text}
        />
      </div>
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
      </details>
    </section>
  );
}
