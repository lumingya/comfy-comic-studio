import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useAddPanel,
  useBatchPatchPanels,
  useDeletePanel,
  useDuplicatePanel,
  usePatchPanel,
  useReorderPanels,
} from '../../api/series';
import type { Panel, PanelOverrides } from '../../api/types';
import { useWorkshop } from '../../api/workshop';
import { Icon } from '../../app/icons';
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

const caption = (p: Panel) =>
  p.dialogues.find((d) => d.kind === 'narration')?.text ?? p.dialogues[0]?.text ?? '';

/** A text field that edits locally and saves on blur or after a short pause. */
function useField(initial: string, save: (v: string) => void) {
  const [value, setValue] = useState(initial);
  const saved = useRef(initial);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    setValue(initial);
    saved.current = initial;
  }, [initial]);
  const commit = (v = value) => {
    clearTimeout(timer.current);
    if (v === saved.current) return;
    saved.current = v;
    saveRef.current(v);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    value,
    onChange: (v: string) => {
      setValue(v);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => commit(v), 800);
    },
    onBlur: () => commit(),
  };
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
  const [batch, setBatch] = useState(false);
  const [batchCount, setBatchCount] = useState(4);

  const addFrames = (count: number, prompt: string) => {
    let after = active?.id ?? null;
    const run = async () => {
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
          <div className="workshop-frames-list">
            {panels.map((p, i) => (
              <button
                key={p.id}
                type="button"
                className={p.id === active?.id ? 'active' : ''}
                aria-current={p.id === active?.id ? 'true' : undefined}
                onClick={() => setActiveId(p.id)}
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
                  disabled={add.isPending || !(batchCount >= 1 && batchCount <= 24)}
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
            onSelect={setActiveId}
          />
        ) : (
          <section className="workshop-page is-empty">
            <p className="help">{t('ws.story.noFrames')}</p>
          </section>
        )}
      </div>
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
}: {
  panel: Panel;
  index: number;
  count: number;
  panels: Panel[];
  known: KnownVariables;
  onSelect: (id: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const { episode } = useEpisodeContext();
  const eid = episode.id!;
  const patch = usePatchPanel(eid);
  const batch = useBatchPatchPanels(eid);
  const reorder = useReorderPanels(eid);
  const duplicate = useDuplicatePanel(eid);
  const remove = useDeletePanel(eid);
  const ov = panel.overrides;
  const setOverrides = (changes: Partial<PanelOverrides>) =>
    patch.mutate(
      { panelId: panel.id!, changes: { overrides: { ...ov, ...changes } } },
      { onError: toastError },
    );

  const name = useField(panel.description, (description) =>
    patch.mutate({ panelId: panel.id!, changes: { description } }, { onError: toastError }),
  );
  const prompt = useField(ov.raw_prompt ?? '', (raw_prompt) => setOverrides({ raw_prompt }));
  const negative = useField(ov.raw_negative ?? '', (v) =>
    setOverrides({ raw_negative: v || null }),
  );
  const text = useField(caption(panel), (v) => {
    const rest = panel.dialogues.filter((d) => d.kind !== 'narration');
    const narration = v.trim() ? [{ text: v, kind: 'narration' as const }] : [];
    patch.mutate(
      { panelId: panel.id!, changes: { dialogues: [...narration, ...rest] } },
      { onError: toastError },
    );
  });

  const move = (dir: -1 | 1) => {
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
    <section className="workshop-page" data-editor-key={panel.id}>
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
          onClick={() =>
            duplicate.mutate(panel.id!, {
              onSuccess: (ep) => {
                const sorted = [...ep.panels].sort((a, b) => a.order - b.order);
                onSelect(sorted[index + 1]?.id);
              },
              onError: toastError,
            })
          }
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
            remove.mutate(panel.id!, {
              onSuccess: () => onSelect(panels[index + 1]?.id ?? panels[index - 1]?.id),
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
                defaultValue={value ?? ''}
                placeholder={t('ws.story.paramDefault')}
                onBlur={(e) => {
                  if (e.target.value !== String(value ?? '')) set(e.target.value);
                }}
              />
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
