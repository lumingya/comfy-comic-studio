import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEpisode, useEpisodes } from '../../api/series';
import { useProfiles, useSettings } from '../../api/system';
import { useAssemble, useWorkshop, type Preset } from '../../api/workshop';
import { Icon } from '../../app/icons';
import { useRenderRoute } from '../../app/renderRoute';
import { toast, toastError } from '../../components/toast';
import { ownCancel } from '../../components/topLayer';
import { AssemblyCanvas, EMPTY_DESIGN, canvasTasks, type CanvasDesign } from './AssemblyCanvas';
import { AssemblyReview } from './AssemblyReview';
import { AssemblyIntents } from './assemblyIntent';

const STEPS = ['story', 'presets', 'name'] as const;

const displayName = (p: Preset) =>
  p.entries.find((e) => e.key === 'character_display_name')?.value.trim() ||
  p.title.split('·')[0].trim();

/** 新建生成任务: storyboard + image service → presets → name, then 「添加待命任务」. */
export default function AssembleDialog({
  initialStory,
  onClose,
}: {
  initialStory?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const ws = useWorkshop();
  const boards = useEpisodes(ws.data?.id);
  const profiles = useProfiles();
  const settings = useSettings();
  const collection = settings.data?.collection_title || t('classic.shelf.defaultTitle');
  const assemble = useAssemble();
  const [mode, setMode] = useState<'wizard' | 'canvas'>('wizard');
  const [design, setDesign] = useState<CanvasDesign>(EMPTY_DESIGN);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [story, setStory] = useState(initialStory ?? '');
  const [profile, setProfile] = useState('');
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const intents = useRef(new AssemblyIntents());
  const presets = ws.data?.presets ?? [];
  const items = boards.data?.items ?? [];
  const storyId = story || items[0]?.id;
  const board = items.find((b) => b.id === storyId);
  const { data: storyboard } = useEpisode(storyId);
  const route = useRenderRoute(profile, ws.data?.default_profile_id, ws.isPending, false);

  useEffect(() => {
    const d = ref.current;
    if (!d || d.open) return;
    if (typeof d.showModal === 'function') d.showModal();
    else d.setAttribute('open', '');
  }, []);

  const auto = useMemo(() => presets.slice(0, 1).map((p) => p.id!), [presets]);
  const picked = chosen ?? auto;
  const ordered = picked
    .map((id) => presets.find((p) => p.id === id))
    .filter((p): p is Preset => !!p);
  const first = presets.find((p) => p.id === picked[0]);
  const defaultTitle = [board?.title, first ? displayName(first) : ''].filter(Boolean).join(' · ');
  const name = title ?? defaultTitle.slice(0, 120);
  const profileList = profiles.data ?? [];
  const profileId = profile;
  const profileName = route.profile?.name ?? t('ws.assemble.profileDefault');
  const request = {
    storyboard_id: storyId ?? '',
    preset_ids: picked,
    title: name,
    profile_id: profileId || null,
    variables,
  };
  const intentKey = intents.current.keyFor('wizard', request);
  // Synchronize per-node intent keys when request contents change, ignoring canvas movement.
  design.stories.forEach((node) =>
    intents.current.keyFor(node.id, {
      storyboard_id: node.storyId,
      preset_ids: design.presets
        .filter((p) => design.edges.some((edge) => edge.story === node.id && edge.preset === p.id))
        .map((p) => p.presetId),
      title: node.title.trim(),
      profile_id: profileId || null,
    }),
  );
  intents.current.retain(['wizard', ...design.stories.map((node) => node.id)]);

  const toggle = (id: string) =>
    setChosen(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  const submit = () =>
    assemble.mutate(
      { ...request, idempotency_key: intentKey },
      {
        onSuccess: () => {
          intents.current.clear('wizard');
          toast(t('ws.assemble.added'));
          close();
        },
        onError: toastError,
      },
    );
  const close = () => {
    ref.current?.close?.();
    onClose();
  };
  const changeDesign = (next: CanvasDesign) => {
    setDesign(next);
    setConfirming(false);
  };
  /** Canvas mode: one standby task per storyboard node, after an inline confirmation. */
  const submitCanvas = async () => {
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
    if (!confirming) return setConfirming(true);
    setBusy(true);
    let done = 0;
    try {
      for (const [i, task] of tasks.entries()) {
        const body = { ...task, profile_id: profileId || null };
        const node = design.stories[i].id;
        await assemble.mutateAsync({
          ...body,
          idempotency_key: intents.current.keyFor(node, body),
        });
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
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };
  const environment = (
    <section className="designer-card designer-environment">
      <header className="designer-card-head">
        <span className="designer-kicker">
          {mode === 'canvas' ? t('ws.canvas.kEnv') : t('ws.assemble.kEnv')}
        </span>
        <h4>{t('ws.assemble.env')}</h4>
      </header>
      <div className="field">
        <span className="label" id="designer-channel-label">
          {t('ws.assemble.channel')}
        </span>
        <p aria-labelledby="designer-channel-label">{route.summary}</p>
      </div>
      <div className="field">
        <label className="label" htmlFor="designer-profile">
          {t('ws.assemble.profile')}
        </label>
        <select
          id="designer-profile"
          value={profileId}
          onChange={(e) => setProfile(e.target.value)}
        >
          <option value="">{t('ws.assemble.profileDefault')}</option>
          {profileList.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <p className="help">{t('ws.assemble.profileHelp')}</p>
        {storyboard?.panels.some((panel) => panel.overrides.profile_id) ? (
          <p className="help">{t('route.panelOverrides')}</p>
        ) : null}
      </div>
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
        <div className="designer-head">
          <div className="designer-modes" role="group" aria-label={t('ws.assemble.mode')}>
            {(['wizard', 'canvas'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`btn ${mode === m ? 'active' : 'ghost'}`}
                aria-pressed={mode === m}
                onClick={() => {
                  setMode(m);
                  setConfirming(false);
                }}
              >
                <Icon name={m === 'wizard' ? 'list' : 'nodes'} sm />
                {t(m === 'wizard' ? 'ws.assemble.wizard' : 'ws.canvas.mode')}
              </button>
            ))}
          </div>
          <p className="designer-head-note">
            {mode === 'canvas' ? t('ws.canvas.note') : t('ws.assemble.note')}
          </p>
        </div>
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
            <aside className="designer-navigation">
              <div className="designer-brand">
                MIO <span>PRODUCTION STUDIO</span>
              </div>
              <h2>
                {t('ws.assemble.brand1')}
                <br />
                {t('ws.assemble.brand2')}
              </h2>
              <p>
                {t('ws.assemble.brandLede1')}
                <br />
                {t('ws.assemble.brandLede2')}
              </p>
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
              <div className="designer-safety">
                <Icon name="shield" sm /> {t('ws.assemble.safety1')}
                <small>{t('ws.assemble.safety2')}</small>
              </div>
            </aside>
            {step === 0 ? (
              <section className="designer-step" data-step="0">
                <header className="designer-step-head">
                  <h3>{t('ws.assemble.storyTitle')}</h3>
                  <p>{t('ws.assemble.storyLede')}</p>
                </header>
                <div className="designer-columns">
                  <div className="designer-main">
                    <section className="designer-card">
                      <header className="designer-card-head">
                        <span className="designer-kicker">{t('ws.assemble.kStory')}</span>
                        <h4>{t('ws.assemble.whichStory')}</h4>
                      </header>
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
                      </div>
                    </section>
                    {environment}
                  </div>
                </div>
              </section>
            ) : step === 1 ? (
              <section className="designer-step" data-step="1">
                <header className="designer-step-head">
                  <h3>{t('ws.assemble.presetsTitle')}</h3>
                  <p>{t('ws.assemble.presetsLede')}</p>
                </header>
                {chosen === null && first ? (
                  <p className="designer-auto-note">
                    <span>{t('ws.assemble.autoNote', { title: first.title })}</span>
                  </p>
                ) : null}
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
                <p className="help">{t('ws.assemble.reviewNext')}</p>
              </section>
            ) : (
              <section className="designer-step" data-step="2">
                <header className="designer-step-head">
                  <h3>{t('ws.assemble.nameTitle')}</h3>
                  <p>{t('ws.assemble.nameLede')}</p>
                </header>
                <div className="designer-columns designer-naming">
                  <div className="designer-main">
                    <section className="designer-card">
                      <header className="designer-card-head">
                        <span className="designer-kicker">{t('ws.assemble.kName')}</span>
                        <h4>{t('ws.assemble.whatName')}</h4>
                      </header>
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
                        <div className="help">{t('ws.assemble.collectionHelp')}</div>
                      </div>
                    </section>
                    <AssemblyReview
                      body={request}
                      variables={variables}
                      onVariables={setVariables}
                    />
                  </div>
                  <aside className="designer-side">
                    <section className="designer-card designer-summary-card">
                      <header className="designer-card-head">
                        <span className="designer-kicker">{t('ws.assemble.kCheck')}</span>
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
                        <div className="designer-summary-row">
                          <dt>{t('ws.assemble.channel')}</dt>
                          <dd>{route.summary}</dd>
                        </div>
                        <div className="designer-summary-row">
                          <dt>{t('ws.assemble.profile')}</dt>
                          <dd>
                            <span>{profileName}</span>
                          </dd>
                        </div>
                        <div className="designer-summary-row is-chips">
                          <dt>{t('ws.assemble.presets')}</dt>
                          <dd>
                            {ordered.map((p, index) => (
                              <span className="designer-summary-chip" key={p.id}>
                                <span>
                                  {index + 1}. {p.title}
                                </span>
                                <b>{t('ws.assemble.items', { count: p.entries.length })}</b>
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
          {mode === 'canvas' ? (
            <button
              type="button"
              className="btn primary"
              disabled={!design.stories.length || busy}
              title={design.stories.length ? undefined : t('ws.canvas.needStory')}
              onClick={() => void submitCanvas()}
            >
              <Icon name="plus" />
              {confirming
                ? t('ws.canvas.confirm', { count: design.stories.length })
                : t('ws.canvas.submit')}
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
              disabled={!storyId}
              onClick={() => setStep(step + 1)}
            >
              <Icon name="arrow" />
              {t('ws.assemble.next')}
            </button>
          ) : (
            <button
              type="button"
              className="btn primary"
              disabled={!storyId || name.length > 120 || assemble.isPending}
              onClick={submit}
            >
              <Icon name="plus" />
              {t('ws.assemble.submit')}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
