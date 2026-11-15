import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { useCreationKits } from '../../api/creationKits';
import { useEpisode, useEpisodes, useSeries } from '../../api/series';
import { useProfiles, useSettings } from '../../api/system';
import type { RenderProfile } from '../../api/types';
import { useAssemble, useWorkshop, type Preset } from '../../api/workshop';
import { Icon } from '../../app/icons';
import { resolveProfile, useRenderRoute } from '../../app/renderRoute';
import { toast, toastError } from '../../components/toast';
import { ownCancel } from '../../components/topLayer';
import { QueryError } from '../../app/errors';
import { AssemblyCanvas, EMPTY_DESIGN, canvasTasks, type CanvasDesign } from './AssemblyCanvas';
import { AssemblyReview } from './AssemblyReview';
import { AssemblyIntents } from './assemblyIntent';
import { workshopHref } from './workshopSource';
import './creation-kits.css';
import './assemble-dialog.css';

const STEPS = ['story', 'presets', 'name'] as const;
type ImageService = 'local' | 'cloud' | 'hybrid';
const profileService = (profile: RenderProfile): ImageService =>
  !profile.cloud_shape ? 'local' : profile.cloud_refine ? 'hybrid' : 'cloud';

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
  const [params] = useSearchParams();
  const [kitId, setKitId] = useState(params.get('kit') ?? '');
  const kits = useCreationKits();
  const ws = useWorkshop();
  const kit = useSeries(kitId || undefined);
  const source = kitId ? (kit.data?.kind === 'kit' ? kit.data : undefined) : ws.data;
  const sourcePending = kitId ? kit.isPending : ws.isPending;
  const boards = useEpisodes(source?.id);
  const profiles = useProfiles();
  const settings = useSettings();
  const collection = settings.data?.collection_title || t('classic.shelf.defaultTitle');
  const assemble = useAssemble(kitId || undefined);
  const [mode, setMode] = useState<'wizard' | 'canvas'>('wizard');
  const [design, setDesign] = useState<CanvasDesign>(EMPTY_DESIGN);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [story, setStory] = useState(initialStory ?? '');
  const [profile, setProfile] = useState('');
  const [serviceChoice, setServiceChoice] = useState<ImageService | null>(null);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const intents = useRef(new AssemblyIntents());
  const presets = source?.presets ?? [];
  const items = boards.data?.items ?? [];
  const storyId = story ? items.find((item) => item.id === story)?.id : items[0]?.id;
  const board = items.find((b) => b.id === storyId);
  const { data: storyboard } = useEpisode(storyId);
  const route = useRenderRoute(profile, source?.default_profile_id, sourcePending, false);

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
  const defaultProfile = resolveProfile(profileList, null, source?.default_profile_id).profile;
  const service = serviceChoice ?? route.kind ?? 'local';
  const serviceProfiles = profileList.filter((value) => profileService(value) === service);
  const missingService = !profiles.isPending && (!route.profile || route.kind !== service);
  const serviceReady = !profiles.isPending && !!route.profile && route.kind === service;
  const chooseService = (next: ImageService) => {
    setServiceChoice(next);
    const fallback = defaultProfile && profileService(defaultProfile) === next;
    setProfile(
      fallback ? '' : (profileList.find((value) => profileService(value) === next)?.id ?? ''),
    );
    setConfirming(false);
  };
  const profileName = route.profile?.name ?? t('ws.assemble.profileDefault');
  const routeSummary = route.profile?.binding_required ? t('kits.pendingBinding') : route.summary;
  const request = {
    storyboard_id: storyId ?? '',
    preset_ids: picked,
    title: name,
    profile_id: profileId || null,
    variables,
  };
  const intentKey = intents.current.keyFor('wizard', request);
  const changeSource = (id: string) => {
    setKitId(id);
    setStory('');
    setProfile('');
    setServiceChoice(null);
    setChosen(null);
    setTitle(null);
    setVariables({});
    setDesign(EMPTY_DESIGN);
    setConfirming(false);
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
        <h4>{t('ws.assemble.env')}</h4>
      </header>
      <div className="field">
        <label className="label" htmlFor="designer-channel">
          {t('ws.assemble.channel')}
        </label>
        <select
          id="designer-channel"
          value={service}
          disabled={profiles.isPending || assemble.isPending || busy}
          onChange={(event) => chooseService(event.target.value as ImageService)}
        >
          <option value="local">{t('route.local')}</option>
          <option value="cloud">{t('route.cloud')}</option>
          {route.kind === 'hybrid' ||
          (defaultProfile && profileService(defaultProfile) === 'hybrid') ? (
            <option value="hybrid">{t('route.hybrid')}</option>
          ) : null}
        </select>
        {!missingService && (route.kind !== 'local' || route.profile?.binding_required) ? (
          <p className="help">{routeSummary}</p>
        ) : null}
      </div>
      <div className="field">
        <label className="label" htmlFor="designer-profile">
          {t('ws.assemble.profile')}
        </label>
        <select
          id="designer-profile"
          value={serviceReady ? profileId : ''}
          disabled={!serviceProfiles.length || profiles.isPending || assemble.isPending || busy}
          onChange={(event) => {
            setProfile(event.target.value);
            setServiceChoice(null);
            setConfirming(false);
          }}
        >
          {defaultProfile && profileService(defaultProfile) === service ? (
            <option value="">
              {t('ws.assemble.sourceProfile', { name: defaultProfile.name })}
            </option>
          ) : !serviceReady ? (
            <option value="">{t('ws.assemble.noServiceProfile')}</option>
          ) : null}
          {serviceProfiles.map((value) => (
            <option key={value.id} value={value.id}>
              {value.name}
            </option>
          ))}
        </select>
        {missingService ? (
          <p className="help" role="status">
            {t('ws.assemble.serviceMissing', { service: t(`route.${service}`) })}
          </p>
        ) : route.profile?.binding_required ? null : route.state === 'missing' ? (
          <p className="help" role="status">
            {route.detail}
          </p>
        ) : null}
        <Link
          className="designer-configure"
          to={
            missingService || route.profile?.binding_required
              ? '/engine?tab=profiles'
              : route.state === 'missing'
                ? route.to
                : '/engine?tab=profiles'
          }
          onClick={close}
        >
          {t('ws.assemble.configureService')}
        </Link>
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
                  setConfirming(false);
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
                    <header className="designer-card-head">
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
                        <div className="designer-summary-row">
                          <dt>{t('ws.assemble.channel')}</dt>
                          <dd>{routeSummary}</dd>
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
        {mode === 'canvas' ? (
          <button
            type="button"
            className="btn primary"
            disabled={!source || !serviceReady || !design.stories.length || busy}
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
            disabled={!source || !storyId || !serviceReady}
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
              !source || !storyId || !serviceReady || name.length > 120 || assemble.isPending
            }
            onClick={submit}
          >
            <Icon name="plus" />
            {t('ws.assemble.submit')}
          </button>
        )}
      </div>
    </dialog>
  );
}
