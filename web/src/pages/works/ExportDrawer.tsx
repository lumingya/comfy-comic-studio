import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { download, raw } from '../../api/client';
import {
  continueExport,
  submitExport,
  waitForExport,
  type ExportKind,
} from '../../api/exportTasks';
import { useLive } from '../../api/jobs';
import type { Job } from '../../api/types';
import { exportCreationKit } from '../../api/creationKits';
import { useImportAlbumTemplate, type AlbumTemplateInfo } from '../../api/open';
import { useExportPresets } from '../../api/production';
import { useSeries } from '../../api/series';
import { Icon } from '../../app/icons';
import { QueryError } from '../../app/errors';
import { toast, toastError } from '../../components/toast';
import { Field, Select, TextInput, NumberInput } from '../../components/ui';
import {
  albumBody,
  PROFILES,
  QUALITIES,
  useReport,
  type ExportDraft,
  type Profile,
  type Quality,
} from './presentation';
import { NATIVE_LAYOUTS, nativeLayout, type NativeLayout } from './readingStage';
import { TemplateStudio } from './TemplateStudio';
import { parseTemplateFile } from './templateFile';
import { listStoryboards } from '../workshop/storyActions';
import './export-drawer.css';

type Format = 'html' | 'pdf' | 'zip' | 'slices' | 'long' | 'source' | 'kit';
const FORMATS: Format[] = ['html', 'pdf', 'zip', 'slices', 'long', 'source', 'kit'];

export function PresentationDrawer(props: {
  open: boolean;
  onClose: () => void;
  templates: { id: string; title: string; description: string; accent?: string }[];
  infos: AlbumTemplateInfo[];
  look: string;
  native: string;
  onLook: (id: string) => void;
  draft: ExportDraft;
  onDraft: (patch: Partial<ExportDraft>) => void;
  layout: NativeLayout;
  onLayout: (layout: NativeLayout) => void;
  seriesId: string | undefined;
  episodes: { id?: string; title: string }[];
  episodeId: string | undefined;
  title: string;
  lettered: boolean;
  onPlatform: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { draft: d, onDraft } = props;
  const [format, setFormat] = useState<Format>('html');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [failure, setFailure] = useState('');
  const [exportJob, setExportJob] = useState<Job | null>(null);
  const [canceling, setCanceling] = useState(false);
  const ticket = useRef<{ signature: string; key: string; id?: string } | null>(null);
  const waiting = useRef<AbortController | null>(null);
  const progress = useLive((state) =>
    exportJob ? state.progress[`${exportJob.id}:0`] : undefined,
  );
  useEffect(() => () => waiting.current?.abort(), []);
  const [studio, setStudio] = useState(false);
  const [kitTitle, setKitTitle] = useState<string | null>(null);
  const [episodeSelection, setEpisodes] = useState<string[] | null>(null);
  const [presetSelection, setPresets] = useState<string[]>([]);
  const selectedEpisodes = episodeSelection ?? (props.episodeId ? [props.episodeId] : []);
  const source = useSeries(props.open && format === 'kit' ? props.seriesId : undefined);
  const allEpisodes = useQuery({
    queryKey: ['kit-export-episodes', props.seriesId],
    enabled: props.open && format === 'kit' && !!props.seriesId,
    queryFn: () => listStoryboards(props.seriesId!),
  });
  const presets = useExportPresets();
  const importTpl = useImportAlbumTemplate();
  const file = useRef<HTMLInputElement>(null);
  const report = useReport();
  const slices = format === 'slices';
  const platform = slices || format === 'long';
  const rendered = ['html', 'pdf', 'zip'].includes(format);
  const native = props.look === props.native;
  const preset = presets.data?.find((p) => p.id === d.preset);
  const accent =
    (props.infos.find((x) => x.id === props.look)?.options as { accent?: string })?.accent ??
    '#8fae8b';
  useEffect(() => {
    props.onPlatform(props.open && slices);
  }, [props.open, slices, props.onPlatform]);
  useEffect(() => {
    setEpisodes(null);
    setPresets([]);
    setKitTitle(null);
    setStatus('');
    setFailure('');
  }, [props.seriesId]);
  useEffect(() => {
    waiting.current?.abort();
    waiting.current = null;
    ticket.current = null;
    setExportJob(null);
    setBusy(false);
    setCanceling(false);
    setStatus('');
    setFailure('');
  }, [props.seriesId, props.episodeId, props.title]);
  useEffect(() => {
    if (!props.open) {
      waiting.current?.abort();
      waiting.current = null;
      setBusy(false);
      setCanceling(false);
    }
  }, [props.open]);
  const choose = (value: Format) => {
    setFormat(value);
    setStatus('');
    setFailure('');
    ticket.current = null;
    setExportJob(null);
  };
  const toggle = (ids: string[], id: string) =>
    ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
  const disabled =
    busy ||
    (format === 'source'
      ? !props.seriesId
      : format === 'kit'
        ? !source.data || !allEpisodes.data || !selectedEpisodes.length
        : !props.episodeId);
  const background = async (kind: ExportKind, body: unknown, name: string, signal: AbortSignal) => {
    const signature = JSON.stringify([kind, body]);
    if (ticket.current?.signature !== signature) {
      ticket.current = { signature, key: `export-${crypto.randomUUID()}` };
      setExportJob(null);
    }
    const current = ticket.current;
    const job = current.id
      ? await continueExport(current.id, signal)
      : await submitExport(kind, body, current.key, signal);
    current.id = job.id;
    signal.throwIfAborted();
    setExportJob(job);
    return waitForExport(job.id, name, setExportJob, signal);
  };
  const cancel = async () => {
    if (!exportJob || canceling) return;
    const currentId = exportJob.id;
    setCanceling(true);
    try {
      await raw(`/api/jobs/${exportJob.id}/cancel`, { method: 'POST' });
    } catch (error) {
      if (ticket.current?.id === currentId) toastError(error);
    } finally {
      if (ticket.current?.id === currentId) setCanceling(false);
    }
  };
  const run = async () => {
    if (disabled || waiting.current) return;
    const controller = new AbortController();
    waiting.current = controller;
    setCanceling(false);
    setBusy(true);
    setStatus('');
    setFailure('');
    try {
      const ep = props.episodeId!;
      const name = props.title || 'album';
      const title = props.title.slice(0, 120);
      let result: Response;
      if (format === 'source')
        result = await download(`/api/series/${props.seriesId}/bundle`, `${name}.mio.zip`);
      else if (format === 'kit')
        result = await exportCreationKit({
          series_id: props.seriesId!,
          episode_ids: selectedEpisodes,
          preset_ids: presetSelection,
          title: (kitTitle ?? props.title.slice(0, 120)).trim(),
        });
      else if (format === 'html')
        result = await background(
          'album',
          {
            ...albumBody({ episodeId: ep, templateId: props.look, lettered: props.lettered }, d),
            title,
            image_profile: d.profile,
          },
          `${name}.html`,
          controller.signal,
        );
      else if (format === 'zip' || format === 'pdf')
        result = await background(
          'portable',
          {
            episode_ids: [ep],
            format,
            lettered: props.lettered,
            show_captions: d.captions,
            deduplicate_captions: d.deduplicateCaptions,
            title,
            image_profile: d.profile,
          },
          `${name}.${format}`,
          controller.signal,
        );
      else {
        const quality = QUALITIES[d.quality];
        result = await background(
          'strip',
          {
            episode_id: ep,
            fmt: format,
            preset: slices ? d.preset : 'webtoon',
            quality: slices || quality ? quality : null,
          },
          name,
          controller.signal,
        );
      }
      if (!controller.signal.aborted) {
        ticket.current = null;
        setExportJob(null);
        setStatus(
          [
            t(format === 'source' || format === 'kit' ? 'exportUi.done' : 'exportUi.started'),
            report(result),
          ]
            .filter(Boolean)
            .join(' '),
        );
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      setFailure(
        ['canceled', 'blocked', 'paused'].includes(message) ? t(`jobs.states.${message}`) : message,
      );
    } finally {
      if (waiting.current === controller) {
        waiting.current = null;
        setBusy(false);
      }
    }
  };
  const importFile = async (f: File) => {
    try {
      const body = parseTemplateFile(await f.text(), f.name, {
        invalid: t('reader.badTemplate'),
        notTemplate: t('reader.notTemplate'),
        badMeta: t('reader.badTemplateMeta'),
        fromHtml: t('reader.templateFromHtml'),
      });
      const template = await importTpl.mutateAsync(body);
      props.onLook(template.id);
      toast(t('reader.imported', { title: template.title }));
    } catch (error) {
      toastError(error);
    }
  };
  return (
    <aside
      className="presentation-drawer export-drawer"
      id="presentation-drawer"
      hidden={!props.open}
      aria-label={t('reader.drawer')}
    >
      <header>
        <div>
          <h2>{t('exportUi.title')}</h2>
          <p>{props.title}</p>
        </div>
        <button
          type="button"
          className="ibtn"
          aria-label={t('reader.drawerClose')}
          onClick={props.onClose}
        >
          <Icon name="close" />
        </button>
      </header>
      <div className="export-drawer-body">
        <fieldset disabled={busy}>
          <Field label={t('exportUi.format')}>
            <Select
              value={format}
              onChange={choose}
              options={FORMATS.map((value) => ({ value, label: t(`exportUi.formats.${value}`) }))}
            />
          </Field>
          {format === 'pdf' || format === 'zip' || format === 'source' ? (
            <p className="export-purpose">{t(`exportUi.hints.${format}`)}</p>
          ) : null}
          {format !== 'kit' ? (
            <p className="export-scope">
              {t(format === 'source' ? 'exportUi.wholeWork' : 'exportUi.scope')}
            </p>
          ) : null}
          {format === 'html' ? (
            <>
              <Field label={t('exportUi.layout')}>
                <Select
                  value={props.look}
                  onChange={props.onLook}
                  options={props.templates.map((x) => ({ value: x.id, label: x.title }))}
                />
              </Field>
              {native ? (
                <Field label={t('reader.readMode')}>
                  <Select
                    value={props.layout}
                    onChange={(value) => props.onLayout(nativeLayout(value))}
                    options={NATIVE_LAYOUTS.map((value) => ({
                      value,
                      label: t(`reader.layouts.${value}`),
                    }))}
                  />
                </Field>
              ) : null}
            </>
          ) : null}
          {rendered ? (
            <>
              {format !== 'pdf' ? (
                <label className="export-check">
                  <input
                    type="checkbox"
                    checked={d.captions}
                    onChange={(e) => onDraft({ captions: e.target.checked })}
                  />
                  {t('exportUi.captions')}
                </label>
              ) : null}
              <Field label={t('reader.profile')}>
                <Select
                  value={d.profile}
                  onChange={(profile) => onDraft({ profile: profile as Profile })}
                  options={PROFILES.map((value) => ({
                    value,
                    label: t(`reader.profiles.${value}.label`),
                  }))}
                />
              </Field>
            </>
          ) : null}
          {format === 'html' && !native ? (
            <details className="export-advanced">
              <summary>{t('exportUi.more')}</summary>
              <div className="export-grid">
                <Field label={t('reader.themeColor')}>
                  <span className="export-color-row">
                    <input
                      type="color"
                      value={d.themeColor || accent}
                      onChange={(e) => onDraft({ themeColor: e.target.value })}
                    />
                    {d.themeColor ? (
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={() => onDraft({ themeColor: '' })}
                      >
                        {t('reader.themeReset')}
                      </button>
                    ) : null}
                  </span>
                </Field>
                <Field label={t('reader.border')}>
                  <NumberInput
                    value={d.border}
                    min={0}
                    max={8}
                    onChange={(border) =>
                      onDraft({ border: Math.max(0, Math.min(8, border ?? 0)) })
                    }
                  />
                </Field>
              </div>
              <Field label={t('reader.signature')}>
                <TextInput
                  value={d.signature}
                  maxLength={120}
                  onChange={(signature) => onDraft({ signature })}
                />
              </Field>
              <label className="export-check">
                <input
                  type="checkbox"
                  checked={d.prompts}
                  onChange={(e) => onDraft({ prompts: e.target.checked })}
                />
                {t('reader.prompts')}
              </label>
            </details>
          ) : null}
          {format === 'html' ? (
            <details className="export-advanced">
              <summary>{t('exportUi.templateTools')}</summary>
              <div className="presentation-tools">
                <button
                  type="button"
                  className="btn sm"
                  disabled={!props.infos.length}
                  onClick={() => setStudio(true)}
                >
                  <Icon name="edit" sm />
                  {t('reader.customize')}
                </button>
                <button
                  type="button"
                  className="btn sm"
                  disabled={importTpl.isPending}
                  onClick={() => file.current?.click()}
                >
                  <Icon name="upload" sm />
                  {t('reader.importTemplate')}
                </button>
                <input
                  hidden
                  type="file"
                  ref={file}
                  accept=".html,.htm,.json"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void importFile(f);
                  }}
                />
              </div>
            </details>
          ) : null}
          {platform ? (
            <>
              {slices ? (
                <Field label={t('reader.platform.preset')}>
                  <Select
                    value={d.preset}
                    onChange={(preset) => onDraft({ preset })}
                    options={(presets.data ?? [])
                      .filter((p) => p.width > 0)
                      .map((p) => ({ value: p.id, label: p.label }))}
                  />
                </Field>
              ) : null}
              <Field label={t('reader.platform.quality')}>
                <Select
                  value={d.quality}
                  onChange={(quality) => onDraft({ quality: quality as Quality })}
                  options={(Object.keys(QUALITIES) as Quality[]).map((value) => ({
                    value,
                    label: t(`reader.platform.qualities.${value}`),
                  }))}
                />
              </Field>
              {slices && preset ? (
                <p className="help">
                  {t('reader.platform.spec', {
                    width: preset.width,
                    height: preset.max_height,
                    format: d.quality === 'lossless' ? 'PNG' : preset.format,
                  })}
                </p>
              ) : null}
              {slices && presets.isError ? (
                <QueryError error={presets.error} onRetry={presets.refetch} />
              ) : null}
            </>
          ) : null}
          {format === 'kit' ? (
            <>
              <Field label={t('exportUi.kitName')}>
                <TextInput
                  value={kitTitle ?? props.title.slice(0, 120)}
                  maxLength={120}
                  onChange={setKitTitle}
                />
              </Field>
              <fieldset className="export-content">
                <legend>{t('exportUi.episodes')}</legend>
                {(allEpisodes.data ?? props.episodes).map((ep) =>
                  ep.id ? (
                    <label className="export-check" key={ep.id}>
                      <input
                        type="checkbox"
                        checked={selectedEpisodes.includes(ep.id)}
                        onChange={() => setEpisodes(toggle(selectedEpisodes, ep.id!))}
                      />
                      {ep.title}
                    </label>
                  ) : null,
                )}
              </fieldset>
              <fieldset className="export-content">
                <legend>{t('exportUi.presets')}</legend>
                {(source.data?.presets ?? []).map((p) => (
                  <label className="export-check" key={p.id}>
                    <input
                      type="checkbox"
                      checked={presetSelection.includes(p.id)}
                      onChange={() => setPresets(toggle(presetSelection, p.id))}
                    />
                    {p.title}
                  </label>
                ))}
                {source.data && !source.data.presets.length ? (
                  <p className="help">{t('exportUi.noPresets')}</p>
                ) : null}
              </fieldset>
              {source.isError ? <QueryError error={source.error} onRetry={source.refetch} /> : null}
              {allEpisodes.isError ? (
                <QueryError error={allEpisodes.error} onRetry={allEpisodes.refetch} />
              ) : null}
            </>
          ) : null}
        </fieldset>
      </div>
      <footer className="export-drawer-footer">
        {busy && exportJob ? (
          <div className="row">
            <span role="status">
              {t(`jobs.states.${exportJob.state}`)}
              {progress !== undefined ? ` · ${Math.round(progress * 100)}%` : ''}
            </span>
            <button className="btn" disabled={canceling} onClick={() => void cancel()}>
              {t('common.cancel')}
            </button>
          </div>
        ) : null}
        {failure ? (
          <p className="notice error" role="alert">
            {failure}
          </p>
        ) : null}
        {status ? <p role="status">{status}</p> : null}
        <button
          type="button"
          className="btn primary"
          disabled={disabled}
          onClick={() => void run()}
        >
          <Icon name="download" sm />
          {busy ? t('reader.exporting') : t('common.export')}
        </button>
      </footer>
      {studio ? (
        <TemplateStudio
          templates={props.infos}
          initialId={props.infos.some((x) => x.id === props.look) ? props.look : props.infos[0].id}
          preview={{
            episodeId: props.episodeId,
            lettered: props.lettered,
            captions: d.captions,
            deduplicateCaptions: d.deduplicateCaptions,
          }}
          onSaved={props.onLook}
          onClose={() => setStudio(false)}
        />
      ) : null}
    </aside>
  );
}
