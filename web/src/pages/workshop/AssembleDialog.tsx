import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { useCreationKits } from '../../api/creationKits';
import { useEpisodes, useSeries } from '../../api/series';
import { useSettings } from '../../api/system';
import type { LoraSlotOverrides } from '../../api/workflowLoras';
import {
  useAssemble,
  useWorkshop,
  useQueueAction,
  requireQueueAccepted,
  type GenerationOptions,
  type Preset,
} from '../../api/workshop';
import { Icon } from '../../app/icons';
import { toast, toastError } from '../../components/toast';
import { ownCancel } from '../../components/topLayer';
import { QueryError } from '../../app/errors';
import { AssemblyCanvas, EMPTY_DESIGN, canvasTasks, type CanvasDesign } from './AssemblyCanvas';
import { AssemblyReview } from './AssemblyReview';
import { AssemblyIntents } from './assemblyIntent';
import { GenerationSettings, GenerationSummary, generationValid } from './GenerationSettings';
import { workshopHref } from './workshopSource';
import './creation-kits.css';
import './assemble-dialog.css';

const STEPS = ['story', 'presets', 'name'] as const;
const displayName = (p: Preset) =>
  p.entries.find((e) => e.key === 'character_display_name')?.value.trim() ||
  p.title.split('·')[0].trim();

/** Storyboard, optional presets, and frozen generation settings form one task. */
export default function AssembleDialog({
  initialStory,
  onClose,
}: {
  initialStory?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const [params] = useSearchParams();
  const [kitId, setKitId] = useState(params.get('kit') ?? '');
  const kits = useCreationKits();
  const ws = useWorkshop();
  const kit = useSeries(kitId || undefined);
  const source = kitId ? (kit.data?.kind === 'kit' ? kit.data : undefined) : ws.data;
  const sourcePending = kitId ? kit.isPending : ws.isPending;
  const boards = useEpisodes(source?.id);
  const settings = useSettings();
  const collection = settings.data?.collection_title || t('classic.shelf.defaultTitle');
  const assemble = useAssemble(kitId || undefined);
  const queue = useQueueAction();
  const [mode, setMode] = useState<'wizard' | 'canvas'>('wizard');
  const [design, setDesign] = useState<CanvasDesign>(EMPTY_DESIGN);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [story, setStory] = useState(initialStory ?? '');
  const [generation, setGeneration] = useState<GenerationOptions>();
  const [slotOverrides, setSlotOverrides] = useState<LoraSlotOverrides>();
  const [readyToStart, setReadyToStart] = useState(false);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const intents = useRef(new AssemblyIntents());
  const presets = source?.presets ?? [];
  const items = boards.data?.items ?? [];
  const storyId = story ? items.find((item) => item.id === story)?.id : items[0]?.id;
  const board = items.find((b) => b.id === storyId);
  const storyReady = !!board && board.panel_count > 0;
  const canvasReady =
    design.stories.length > 0 &&
    design.stories.every((node) =>
      items.some((item) => item.id === node.storyId && item.panel_count > 0),
    );

  useEffect(() => {
    const d = ref.current;
    if (!d || d.open) return;
    if (typeof d.showModal === 'function') d.showModal();
    else d.setAttribute('open', '');
  }, []);

  const picked = chosen ?? [];
  const ordered = picked
    .map((id) => presets.find((p) => p.id === id))
    .filter((p): p is Preset => !!p);
  const first = presets.find((p) => p.id === picked[0]);
  const defaultTitle = [board?.title, first ? displayName(first) : ''].filter(Boolean).join(' · ');
  const name = title ?? defaultTitle.slice(0, 120);
  const serviceReady = generationValid(generation);
  const generationRequest = {
    generation,
    ...(generation?.workflow_id && slotOverrides ? { slot_overrides: slotOverrides } : {}),
  };
  const request = {
    storyboard_id: storyId ?? '',
    preset_ids: picked,
    title: name,
    ...generationRequest,
    variables,
  };
  const intentKey = intents.current.keyFor('wizard', request);
  const changeSource = (id: string) => {
    setKitId(id);
    setStory('');
    setGeneration(undefined);
    setSlotOverrides(undefined);
    setChosen(null);
    setTitle(null);
    setVariables({});
    setDesign(EMPTY_DESIGN);
    setStep(0);
    intents.current = new AssemblyIntents();
    assemble.reset();
  };
  // Synchronize per-node intent keys when request contents change, ignoring canvas movement.
  design.stories.forEach((node) =>
    intents.current.keyFor(node.id, {
      storyboard_id: node.storyId,
      preset_ids: design.presets
        .filter((p) => design.edges.some((edge) => edge.story === node.id && edge.preset === p.id))
        .map((p) => p.presetId),
      title: node.title.trim(),
      ...generationRequest,
    }),
  );
  intents.current.retain(['wizard', ...design.stories.map((node) => node.id)]);

  const toggle = (id: string) =>
    setChosen(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  const submit = async (start: boolean) => {
    if (!storyReady) return;
    setBusy(true);
    try {
      const made = await assemble.mutateAsync({ ...request, idempotency_key: intentKey });
      if (start) {
        const result = await queue.mutateAsync({ action: 'start', ids: [made.series.id!] });
        requireQueueAccepted(result, made.series.id!);
      }
      intents.current.clear('wizard');
      toast(t(start ? 'ws.generation.started' : 'ws.assemble.added'));
      close();
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    ref.current?.close?.();
    onClose();
  };
  const changeDesign = (next: CanvasDesign) => {
    setDesign(next);
  };
  /** Canvas mode uses the same settings and queue as the guided form. */
  const submitCanvas = async (start: boolean) => {
    if (!canvasReady) return;
    let tasks;
    try {
      tasks = canvasTasks(design, {
        empty: t('ws.canvas.needStory'),
        unlinked: t('ws.canvas.needPreset'),
      });
    } catch (e) {
      toastError(e);
      return;
    }
    setBusy(true);
    let done = 0;
    try {
      for (const [i, task] of tasks.entries()) {
        const body = { ...task, ...generationRequest };
        const node = design.stories[i].id;
        const made = await assemble.mutateAsync({
          ...body,
          idempotency_key: intents.current.keyFor(node, body),
        });
        if (start) {
          const result = await queue.mutateAsync({ action: 'start', ids: [made.series.id!] });
          requireQueueAccepted(result, made.series.id!);
        }
        intents.current.clear(node);
        done += 1;
      }
      toast(t('ws.canvas.added', { count: done }));
      close();
    } catch (e) {
      if (done) toast(t('ws.canvas.added', { count: done }));
      toastError(e);
      // Drop the nodes that already became tasks so a retry does not duplicate them.
      const left = design.stories.slice(done);
      setDesign({
        ...design,
        stories: left,
        edges: design.edges.filter((x) => left.some((n) => n.id === x.story)),
      });
    } finally {
      setBusy(false);
    }
  };
  const environment = (
    <section className="designer-card designer-environment">
      <GenerationSettings
        value={generation}
        onChange={(next) => {
          if (next.workflow_id !== generation?.workflow_id) setSlotOverrides(undefined);
          setGeneration(next);
        }}
        lora={{ value: slotOverrides, onChange: setSlotOverrides }}
        defaultProfile={source?.default_profile_id}
        sourceDefaults={source?.generation_defaults}
        waiting={sourcePending}
        onReadyChange={setReadyToStart}
        disabled={busy}
        onConfigure={close}
      />
    </section>
  );

  return (
    <dialog
      id="modal"
      ref={ref}
      className="modal-wide assembly-designer"
      aria-labelledby="modal-title"
      onCancel={(e) => {
        if (!ownCancel(e)) return;
        e.preventDefault();
        close();
      }}
    >
      <header className="modal-head">
        <div className="grow">
          <h2 id="modal-title">{t('ws.queue.new')}</h2>
        </div>
        <button type="button" className="ibtn" aria-label={t('ws.close')} onClick={close}>
          ✕
        </button>
      </header>
      <div className="modal-body">
        <div className="designer-toolbar">
          <div className="field creation-kit-source">
            <label className="label" htmlFor="designer-source">
              {t('kits.source')}
            </label>
            <select
              id="designer-source"
              value={kitId}
              disabled={assemble.isPending || busy}
              onChange={(event) => changeSource(event.target.value)}
            >
              <option value="">{t('kits.workshop')}</option>
              {kitId && !kits.data?.some((kit) => kit.id === kitId) ? (
                <option value={kitId}>
                  {sourcePending ? t('kits.loadingSource') : t('kits.missingSource')}
                </option>
              ) : null}
              {(kits.data ?? []).map((kit) => (
                <option key={kit.id} value={kit.id}>
                  {kit.title}
                </option>
              ))}
            </select>
            {kitId && source ? (
              <Link
                className="btn small"
                to={workshopHref(storyId ? `/workshop/story/${storyId}` : '/workshop/story', kitId)}
                onClick={close}
              >
                {t('workshopSource.edit')}
              </Link>
            ) : null}
          </div>
          <div className="designer-modes" role="group" aria-label={t('ws.assemble.mode')}>
            {(['wizard', 'canvas'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`btn ${mode === m ? 'active' : 'ghost'}`}
                aria-pressed={mode === m}
                onClick={() => {
                  setMode(m);
                }}
              >
                <Icon name={m === 'wizard' ? 'list' : 'nodes'} sm />
                {t(m === 'wizard' ? 'ws.assemble.wizard' : 'ws.canvas.mode')}
              </button>
            ))}
          </div>
        </div>
        {kits.isError ? <QueryError error={kits.error} onRetry={kits.refetch} /> : null}
        {kitId && kit.error ? <QueryError error={kit.error} onRetry={kit.refetch} /> : null}
        {kitId && !sourcePending && !source && !kits.isError ? (
          <p className="notice warn">{t('kits.missingSource')}</p>
        ) : null}
        {boards.isError ? <QueryError error={boards.error} onRetry={boards.refetch} /> : null}
        {mode === 'canvas' ? (
          <>
            <div className="canvas-environment">
              <div className="designer-columns">
                <div className="designer-main">{environment}</div>
              </div>
            </div>
            <AssemblyCanvas
              design={design}
              onChange={changeDesign}
              boards={items}
              presets={presets}
            />
          </>
        ) : (
          <div className="designer-workbench">
            <ol className="assembly-stepper" aria-label={t('ws.assemble.steps')}>
              {STEPS.map((s, i) => (
                <li
                  key={s}
                  className={i === step ? 'active' : i < step ? 'done' : ''}
                  aria-current={i === step ? 'step' : undefined}
                >
                  <b>{i < step ? <Icon name="check" sm /> : i + 1}</b>
                  <span>{t(`ws.assemble.step.${s}`)}</span>
                </li>
              ))}
            </ol>
            {step === 0 ? (
              <section className="designer-step" data-step="0">
                <header className="designer-step-head">
                  <h3>{t('ws.assemble.storyTitle')}</h3>
                </header>
                <div className="designer-story-settings">
                  <section className="designer-card">
                    <div className="field">
                      <label className="label" htmlFor="designer-story">
                        {t('ws.assemble.story')}
                      </label>
                      <select
                        id="designer-story"
                        value={storyId ?? ''}
                        onChange={(e) => {
                          setStory(e.target.value);
                          setChosen(null);
                          setTitle(null);
                          setVariables({});
                        }}
                      >
                        {items.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.title} · {t('ws.story.frames', { count: b.panel_count })}
                          </option>
                        ))}
                      </select>
                      {board && !storyReady ? (
                        <div className="help" role="status">
                          {t('ws.generation.emptyStory')}{' '}
                          <Link
                            to={workshopHref(`/workshop/story/${board.id}`, kitId)}
                            onClick={close}
                          >
                            {t('ws.generation.editStory')}
                          </Link>
                        </div>
                      ) : null}
                    </div>
                  </section>
                  {environment}
                </div>
              </section>
            ) : step === 1 ? (
              <section className="designer-step" data-step="1">
                <header className="designer-step-head">
                  <h3>{t('ws.assemble.presetsTitle')}</h3>
                  <p>{t('ws.assemble.presetsLede')}</p>
                </header>
                <div
                  className="designer-presets"
                  role="group"
                  aria-label={t('ws.assemble.presets')}
                >
                  {presets.map((p) => {
                    const on = picked.includes(p.id!);
                    const keys = p.entries.map((e) => e.key);
                    return (
                      <label key={p.id} className={`designer-preset${on ? ' selected' : ''}`}>
                        <input type="checkbox" checked={on} onChange={() => toggle(p.id!)} />
                        <span className="designer-preset-mark" aria-hidden="true" />
                        <span className="designer-preset-icon">
                          <Icon name="users" sm />
                        </span>
                        <span className="designer-preset-body">
                          <strong>{p.title}</strong>
                          <small>{t('ws.assemble.presetKind', { count: keys.length })}</small>
                          <span className="designer-preset-keys">
                            {keys.slice(0, 4).map((k) => (
                              <code key={k}>{`{${k}}`}</code>
                            ))}
                            {keys.length > 4 ? <code>+{keys.length - 4}</code> : null}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <ol className="assembly-preset-order" aria-label={t('ws.assemble.presetOrder')}>
                  {ordered.map((preset, index) => (
                    <li key={preset.id}>
                      <span>{preset.title}</span>
                      {([-1, 1] as const).map((direction) => (
                        <button
                          type="button"
                          className="btn ghost"
                          key={direction}
                          disabled={index + direction < 0 || index + direction >= picked.length}
                          aria-label={t(
                            direction < 0 ? 'ws.assemble.moveUp' : 'ws.assemble.moveDown',
                            { title: preset.title },
                          )}
                          onClick={() => {
                            const next = [...picked];
                            [next[index], next[index + direction]] = [
                              next[index + direction],
                              next[index],
                            ];
                            setChosen(next);
                          }}
                        >
                          <Icon name={direction < 0 ? 'up' : 'down'} sm />
                        </button>
                      ))}
                    </li>
                  ))}
                </ol>
              </section>
            ) : (
              <section className="designer-step" data-step="2">
                <header className="designer-step-head">
                  <h3>{t('ws.assemble.nameTitle')}</h3>
                </header>
                <div className="designer-columns designer-naming">
                  <div className="designer-main">
                    <section className="designer-card">
                      <div className="field">
                        <label className="label" htmlFor="designer-title">
                          {t('ws.assemble.albumName')}
                        </label>
                        <input
                          id="designer-title"
                          value={name}
                          maxLength={120}
                          placeholder={t('ws.assemble.albumNameHint')}
                          onChange={(e) => setTitle(e.target.value)}
                        />
                      </div>
                      <div className="field">
                        <label className="label" htmlFor="designer-project">
                          {t('ws.assemble.collection')}
                        </label>
                        <select id="designer-project" value="default" disabled>
                          <option value="default">{collection}</option>
                        </select>
                      </div>
                    </section>
                    <AssemblyReview
                      body={request}
                      kitId={kitId || undefined}
                      variables={variables}
                      onVariables={setVariables}
                    />
                  </div>
                  <aside className="designer-side">
                    <section className="designer-card designer-summary-card">
                      <header className="designer-card-head">
                        <h4>{t('ws.assemble.summary')}</h4>
                      </header>
                      <dl className="designer-summary">
                        <div className="designer-summary-row">
                          <dt>{t('ws.assemble.story')}</dt>
                          <dd>
                            <span>{board?.title}</span>
                            <small>
                              {t('ws.story.frames', { count: board?.panel_count ?? 0 })}
                            </small>
                          </dd>
                        </div>
                        <div className="designer-summary-row">
                          <dt>{t('ws.assemble.collection')}</dt>
                          <dd>
                            <span>{collection}</span>
                          </dd>
                        </div>
                        <GenerationSummary value={generation} slotOverrides={slotOverrides} />
                        <div className="designer-summary-row is-chips">
                          <dt>{t('ws.assemble.presets')}</dt>
                          <dd>
                            {ordered.map((p, index) => (
                              <span className="designer-summary-chip" key={p.id}>
                                <span>
                                  {index + 1}. {p.title}
                                </span>
                              </span>
                            ))}
                          </dd>
                        </div>
                      </dl>
                    </section>
                  </aside>
                </div>
              </section>
            )}
          </div>
        )}
      </div>
      <div className="modal-footer designer-footer">
        <span className="designer-footer-hint">
          {mode === 'canvas'
            ? t('ws.canvas.footer', {
                stories: design.stories.length,
                edges: design.edges.length,
              })
            : t('ws.assemble.stepOf', { n: step + 1, total: STEPS.length })}
        </span>
        <span className="grow" />
        <button type="button" className="btn ghost" onClick={close}>
          {t('ws.cancel')}
        </button>
        {mode === 'canvas' || step === STEPS.length - 1 ? (
          <button
            type="button"
            className="btn"
            disabled={
              !source || !serviceReady || busy || (mode === 'canvas' ? !canvasReady : !storyReady)
            }
            onClick={() => void (mode === 'canvas' ? submitCanvas(false) : submit(false))}
          >
            {t('ws.generation.later')}
          </button>
        ) : null}
        {mode === 'canvas' ? (
          <button
            type="button"
            className="btn primary"
            disabled={!source || !serviceReady || !readyToStart || !canvasReady || busy}
            title={design.stories.length ? undefined : t('ws.canvas.needStory')}
            onClick={() => void submitCanvas(true)}
          >
            <Icon name="plus" />
            {t('ws.generation.start')}
          </button>
        ) : step > 0 ? (
          <button type="button" className="btn" onClick={() => setStep(step - 1)}>
            <Icon name="arrow" className="is-back" />
            {t('ws.assemble.prev')}
          </button>
        ) : null}
        {mode === 'canvas' ? null : step < STEPS.length - 1 ? (
          <button
            type="button"
            className="btn primary"
            disabled={!source || !storyReady || !serviceReady}
            onClick={() => setStep(step + 1)}
          >
            <Icon name="arrow" />
            {t('ws.assemble.next')}
          </button>
        ) : (
          <button
            type="button"
            className="btn primary"
            disabled={
              !source ||
              !storyReady ||
              !serviceReady ||
              !readyToStart ||
              name.length > 120 ||
              assemble.isPending ||
              busy
            }
            onClick={() => void submit(true)}
          >
            <Icon name="plus" />
            {t('ws.generation.start')}
          </button>
        )}
      </div>
    </dialog>
  );
}
