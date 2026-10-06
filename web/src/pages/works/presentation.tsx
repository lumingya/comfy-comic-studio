import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { download, downloadPost, raw } from '../../api/client';
import { useImportAlbumTemplate, type AlbumTemplateInfo } from '../../api/open';
import { TemplateStudio } from './TemplateStudio';
import { parseTemplateFile, TemplateFileError } from './templateFile';
import { NATIVE_LAYOUTS, nativeLayout, type NativeLayout } from './readingStage';
import { useExportPresets } from '../../api/production';
import { useSettings } from '../../api/system';
import { Icon } from '../../app/icons';
import { toast, toastError } from '../../components/toast';

/*
 * The legacy presentation drawer (ui-presentation.js + ui-export.js), in its order:
 *   templates → 本次展示与导出设置 (incl. 图片处理) → ZIP / PDF / 导出完整 HTML.
 * Everything that does NOT use a presentation template (platform slices, long image)
 * lives in its own collapsed group below, never side by side with the template exports.
 */

export type Profile = 'auto' | 'clean' | 'publish' | 'archive';
export const PROFILES: Profile[] = ['auto', 'clean', 'publish', 'archive'];
export type Quality = 'lossless' | 'q95' | 'q90' | 'q80';
const QUALITIES: Record<Quality, number> = { lossless: 0, q95: 95, q90: 90, q80: 80 };

export interface ExportDraft {
  themeColor: string; // '' = the template's own accent
  border: number;
  signature: string;
  captions: boolean;
  prompts: boolean;
  profile: Profile;
  preset: string;
  quality: Quality;
}

const DRAFT_KEY = 'mio.reader.export';
const DEFAULT_DRAFT: ExportDraft = {
  themeColor: '',
  border: 0,
  signature: '',
  captions: true,
  prompts: false,
  profile: 'auto',
  preset: 'webtoon',
  quality: 'q90',
};

type StoredDraft = Omit<ExportDraft, 'signature'> & { signature: string | null };

/**
 * The export draft, remembered across sessions like the legacy studioUI.exportDraft — except
 * the signature: like legacy it starts from 设置 → 工作室's default album signature every time
 * the reader opens, and an edit only lasts for this visit.
 */
export function useExportDraft(): [ExportDraft, (patch: Partial<ExportDraft>) => void] {
  const fallback = useSettings().data?.signature ?? '';
  const [draft, setDraft] = useState<StoredDraft>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
      return { ...DEFAULT_DRAFT, ...stored, signature: null };
    } catch {
      return { ...DEFAULT_DRAFT, signature: null };
    }
  });
  const update = (patch: Partial<ExportDraft>) =>
    setDraft((d) => {
      const next = { ...d, ...patch };
      const { signature: _signature, ...kept } = next;
      localStorage.setItem(DRAFT_KEY, JSON.stringify(kept));
      return next;
    });
  return [{ ...draft, signature: draft.signature ?? fallback }, update];
}

/** `value` after it stopped changing for `ms`; compared by content, so literals don't loop. */
function useDebounced<T>(value: T, ms = 350): T {
  const key = JSON.stringify(value);
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(JSON.parse(key) as T), ms);
    return () => clearTimeout(id);
  }, [key, ms]);
  return v;
}

/** Body shared by the preview and the real HTML export. */
function albumBody(
  p: { episodeId: string; templateId: string; lettered: boolean },
  d: ExportDraft,
) {
  return {
    episode_ids: [p.episodeId],
    template_id: p.templateId,
    lettered: p.lettered,
    show_captions: d.captions,
    show_prompts: d.prompts,
    theme_color: d.themeColor,
    border: d.border,
    signature: d.signature,
  };
}

/** Where the reader was in a template preview, kept across live refreshes (see runtime.js). */
const previewSpots = new Map<string, { y: number; spread: number }>();

/**
 * The album rendered with a legacy HTML template (POST /api/export/album), shown in an iframe.
 *
 * `revision` is the episode's: every adopted take (a finished job item, 采用, 重跑) bumps it, so the
 * preview re-renders with the new image instead of serving a stale copy — and then goes back to
 * the scroll position / spread the reader was at.
 */
export function TemplatePreview(props: {
  episodeId: string;
  templateId: string;
  lettered: boolean;
  draft: ExportDraft;
  revision?: number;
  /** Adopted pictures / panels, for the legacy status line 整册阅读 · 已生成 N / M 幕. */
  progress?: { done: number; total: number };
}) {
  const { t } = useTranslation();
  const frame = useRef<HTMLIFrameElement>(null);
  const spot = `${props.episodeId}|${props.templateId}`;
  const request = useDebounced(
    {
      body: { ...albumBody(props, props.draft), image_profile: 'preview', max_width: 1400 },
      revision: props.revision ?? 0,
    },
    300,
  );
  const q = useQuery({
    queryKey: ['album-preview', request.body, request.revision],
    staleTime: 5 * 60_000,
    retry: false,
    placeholderData: (previous) => previous,
    queryFn: async () =>
      (
        await raw('/api/export/album', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request.body),
        })
      ).text(),
  });
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.data?.type !== 'mio-reader-state') return;
      previewSpots.set(spot, { y: Number(e.data.y) || 0, spread: Number(e.data.spread) || 0 });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [spot]);
  const restore = () => {
    const at = previewSpots.get(spot);
    if (at) frame.current?.contentWindow?.postMessage({ type: 'mio-reader-restore', ...at }, '*');
  };
  // Legacy #presentation-preview-status: one line above the album, kept while it re-renders.
  const status = q.error
    ? t('reader.previewFailed', { message: (q.error as Error).message })
    : !q.data
      ? q.isFetching
        ? t('reader.previewLoading')
        : ''
      : props.progress
        ? [
            t('reader.previewStatus', props.progress),
            q.isFetching ? t('reader.previewUpdating') : '',
          ]
            .filter(Boolean)
            .join(' · ')
        : '';
  return (
    <div className="presentation-preview-wrap">
      {status ? (
        <div id="presentation-preview-status" role={q.error ? 'alert' : 'status'}>
          {status}
        </div>
      ) : null}
      {q.data ? (
        <iframe
          ref={frame}
          title={t('reader.previewTitle')}
          sandbox="allow-scripts allow-popups"
          srcDoc={q.data}
          onLoad={restore}
        />
      ) : null}
    </div>
  );
}

interface SlicePlan {
  preset: string;
  width: number;
  height: number;
  heights: number[];
  format: string;
}

/** Stage scale of the slice preview: one scale for every preset, so widths and heights compare. */
const SCALE = 0.55;

/** Where the platform preset cuts the strip: every slice as its own sheet, to scale. */
export function SlicePreview(props: {
  episodeId: string;
  preset: string;
  /** The episode revision: new images re-plan the cuts and reload the strip. */
  revision?: number;
}) {
  const { t } = useTranslation();
  const presets = useExportPresets();
  const plan = useQuery({
    queryKey: ['slice-plan', props.episodeId, props.preset, props.revision ?? 0],
    retry: false,
    placeholderData: (previous) => previous,
    queryFn: async () =>
      (
        await raw(
          `/api/episodes/${props.episodeId}/slices?preset=${encodeURIComponent(props.preset)}`,
        )
      ).json() as Promise<SlicePlan>,
  });
  const p = plan.data;
  const label = presets.data?.find((x) => x.id === props.preset)?.label ?? props.preset;
  const src = p
    ? `/api/episodes/${props.episodeId}/strip.png?width=${p.width}&rev=${props.revision ?? 0}`
    : '';
  let top = 0;
  return (
    <div className="room-canvas slice-preview" id="reader-canvas">
      {plan.error ? (
        <div id="presentation-preview-status" role="alert">
          {t('reader.previewFailed', { message: (plan.error as Error).message })}
        </div>
      ) : !p ? (
        <div id="presentation-preview-status" role="status">
          {t('reader.platform.loading')}
        </div>
      ) : (
        <>
          <p className="slice-preview-head">
            <strong>{t('reader.platform.previewTitle')}</strong>
            {t('reader.platform.previewInfo', {
              preset: label,
              width: p.width,
              count: p.heights.length,
            })}
          </p>
          <div className="slice-preview-list">
            {p.heights.map((h, i) => {
              const y = top;
              top += h;
              return (
                <figure key={`${p.preset}-${i}`} className="slice-preview-item">
                  <figcaption>{t('reader.platform.sliceN', { n: i + 1, height: h })}</figcaption>
                  <div
                    className="slice-preview-crop"
                    style={{ width: p.width * SCALE, height: h * SCALE }}
                  >
                    <img
                      src={src}
                      alt=""
                      style={{ width: p.width * SCALE, top: -y * SCALE }}
                      draggable={false}
                    />
                  </div>
                </figure>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function sizeText(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${i ? size.toFixed(1) : size} ${units[i]}`;
}

/** Legacy exportImageSummary: what 图片处理 did, from the X-Mio-Export header. */
function useReport() {
  const { t } = useTranslation();
  return (response: Response): string => {
    let s: {
      profile: string;
      scrubbed: number;
      recompressed: number;
      original_bytes: number;
      output_bytes: number;
      auto_compressed: boolean;
      over_budget: boolean;
    };
    try {
      s = JSON.parse(response.headers.get('x-mio-export') || '');
    } catch {
      return '';
    }
    const parts: string[] = [];
    if (s.profile === 'archive') parts.push(t('reader.report.archive'));
    else {
      if (s.scrubbed) parts.push(t('reader.report.scrubbed', { count: s.scrubbed }));
      if (s.profile === 'publish') {
        if (s.auto_compressed) parts.push(t('reader.report.auto'));
        parts.push(
          t(s.original_bytes ? 'reader.report.publish' : 'reader.report.publishSize', {
            count: s.recompressed,
            from: sizeText(s.original_bytes),
            to: sizeText(s.output_bytes),
          }),
        );
      } else parts.push(t('reader.report.kept'));
    }
    if (s.over_budget)
      parts.push(t('reader.report.budget', { size: sizeText((s.output_bytes * 4) / 3) }));
    return parts.join('；') + '。';
  };
}

type Job = 'html' | 'zip' | 'pdf' | 'slices' | 'long';

export function PresentationDrawer(props: {
  open: boolean;
  onClose: () => void;
  templates: { id: string; title: string; description: string; accent?: string }[];
  infos: AlbumTemplateInfo[];
  look: string;
  native: string;
  onLook: (id: string) => void;
  hintOf: (id: string) => string;
  draft: ExportDraft;
  onDraft: (patch: Partial<ExportDraft>) => void;
  /** 留白 阅读方式 (legacy nativeReaderMode). */
  layout: NativeLayout;
  onLayout: (layout: NativeLayout) => void;
  episodeId: string | undefined;
  title: string;
  lettered: boolean;
  platformOpen: boolean;
  onPlatform: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { draft: d, onDraft } = props;
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<Job | null>(null);
  const [status, setStatus] = useState('');
  const presets = useExportPresets();
  const importTpl = useImportAlbumTemplate();
  const file = useRef<HTMLInputElement>(null);
  const [studioOpen, setStudioOpen] = useState(false);
  const report = useReport();
  const isNative = props.look === props.native;
  const accent =
    (props.infos.find((x) => x.id === props.look)?.options as { accent?: string } | undefined)
      ?.accent ?? '#8fae8b';
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? props.templates.filter((x) => `${x.title} ${x.description}`.toLowerCase().includes(needle))
    : props.templates;
  const preset = presets.data?.find((p) => p.id === d.preset);
  // The chosen template stays in view: after an import it is at the end of the list.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!props.open) return;
    listRef.current
      ?.querySelector<HTMLElement>('.presentation-choice[aria-pressed="true"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [props.open, props.look, shown.length]);
  const platformPresets = (presets.data ?? []).filter((p) => p.width > 0);

  const run = async (job: Job, go: () => Promise<Response>) => {
    if (!props.episodeId) return;
    setBusy(job);
    setStatus(t('reader.preparing', { format: job.toUpperCase() }));
    try {
      const response = await go();
      const note = report(response);
      setStatus([t(`reader.done.${job}`), note].filter(Boolean).join(' '));
      toast(t(`reader.done.${job}`));
    } catch (err) {
      setStatus('');
      toastError(err);
    } finally {
      setBusy(null);
    }
  };
  const ep = props.episodeId ?? '';
  const name = props.title || 'album';
  const exportHtml = () =>
    run('html', () =>
      downloadPost(
        '/api/export/album',
        {
          ...albumBody(
            {
              episodeId: ep,
              templateId: props.look,
              lettered: props.lettered,
            },
            d,
          ),
          title: props.title,
          image_profile: d.profile,
        },
        `${name}.html`,
      ),
    );
  const exportPortable = (format: 'zip' | 'pdf') =>
    run(format, () =>
      downloadPost(
        '/api/export/portable',
        {
          episode_ids: [ep],
          format,
          lettered: props.lettered,
          show_captions: d.captions,
          title: props.title,
          image_profile: d.profile,
        },
        `${name}.${format}`,
      ),
    );
  const exportPlatform = (fmt: 'slices' | 'long') => {
    const q = new URLSearchParams({ fmt, preset: d.preset });
    const quality = QUALITIES[d.quality];
    if (fmt === 'slices' || quality) q.set('quality', String(quality));
    return run(fmt, () => download(`/api/episodes/${ep}/export?${q}`, name));
  };
  const importFile = async (f: File) => {
    let body: Record<string, unknown>;
    try {
      body = parseTemplateFile(await f.text(), f.name, {
        invalid: t('reader.badTemplate'),
        notTemplate: t('reader.notTemplate'),
        badMeta: t('reader.badTemplateMeta'),
        fromHtml: t('reader.templateFromHtml'),
      });
    } catch (e) {
      toastError(e instanceof TemplateFileError ? e : new Error(t('reader.badTemplate')));
      return;
    }
    importTpl.mutate(body, {
      onSuccess: (tpl) => {
        toast(t('reader.imported', { title: tpl.title }));
        props.onLook(tpl.id);
      },
      onError: toastError,
    });
  };

  return (
    <aside
      className="presentation-drawer"
      id="presentation-drawer"
      hidden={!props.open}
      aria-label={t('reader.drawer')}
    >
      <header>
        <div>
          <small>PRESENTATION STUDIO</small>
          <h2>{t('reader.drawerTitle')}</h2>
        </div>
        <button
          type="button"
          className="ibtn"
          title={t('reader.drawerClose')}
          aria-label={t('reader.drawerClose')}
          onClick={props.onClose}
        >
          <Icon name="close" />
        </button>
      </header>
      <label className="presentation-search">
        <Icon name="search" sm />
        <input
          id="presentation-search"
          type="search"
          value={query}
          placeholder={t('reader.search')}
          aria-label={t('reader.searchLabel')}
          aria-controls="presentation-template-list"
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div id="presentation-template-list" ref={listRef}>
        {shown.length ? (
          shown.map((x) => (
            <button
              key={x.id}
              type="button"
              className={`presentation-choice ${props.look === x.id && !props.platformOpen ? 'selected' : ''}`}
              aria-pressed={props.look === x.id}
              onClick={() => {
                props.onLook(x.id);
                props.onPlatform(false);
              }}
            >
              <span
                className="presentation-swatch"
                style={x.accent ? ({ '--swatch': x.accent } as CSSProperties) : undefined}
              >
                <Icon name={x.id === props.native ? 'image' : 'book'} />
              </span>
              <span>
                <strong>{x.title}</strong>
                <small>{props.hintOf(x.id)}</small>
              </span>
              {props.look === x.id ? <Icon name="check" sm /> : null}
            </button>
          ))
        ) : (
          <p className="help choice-empty">
            {t('reader.noMatch', { query: query.trim() })}{' '}
            <button type="button" className="link-button" onClick={() => setQuery('')}>
              {t('reader.clearSearch')}
            </button>
          </p>
        )}
      </div>
      <div className="presentation-tools">
        <button
          type="button"
          className="btn small"
          title={t('reader.customizeHint')}
          disabled={!props.infos.length}
          onClick={() => setStudioOpen(true)}
        >
          <Icon name="edit" sm />
          {t('reader.customize')}
        </button>
        <button type="button" className="btn small" onClick={() => file.current?.click()}>
          <Icon name="upload" sm />
          {t('reader.importTemplate')}
        </button>
        <input
          ref={file}
          type="file"
          accept=".html,.htm,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void importFile(f);
          }}
        />
      </div>
      {studioOpen ? (
        <TemplateStudio
          templates={props.infos}
          initialId={props.infos.some((x) => x.id === props.look) ? props.look : props.infos[0].id}
          preview={{
            episodeId: props.episodeId,
            lettered: props.lettered,
            captions: d.captions,
          }}
          onSaved={(id) => {
            props.onLook(id);
            props.onPlatform(false);
          }}
          onClose={() => setStudioOpen(false)}
        />
      ) : null}
      <details className="presentation-options" open>
        <summary>{t('reader.options')}</summary>
        {isNative ? (
          <div className="field">
            <label className="label" htmlFor="presentation-native-mode">
              {t('reader.readMode')}
            </label>
            <select
              id="presentation-native-mode"
              value={props.layout}
              onChange={(e) => props.onLayout(nativeLayout(e.target.value))}
            >
              {NATIVE_LAYOUTS.map((m) => (
                <option key={m} value={m}>
                  {t(`reader.layouts.${m}`)}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <>
            <div className="field">
              <label className="label" htmlFor="export-color">
                {t('reader.themeColor')}
              </label>
              <span className="export-color-row">
                <input
                  id="export-color"
                  type="color"
                  value={d.themeColor || accent}
                  onChange={(e) => onDraft({ themeColor: e.target.value })}
                />
                {d.themeColor ? (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => onDraft({ themeColor: '' })}
                  >
                    {t('reader.themeReset')}
                  </button>
                ) : null}
              </span>
            </div>
            <div className="field">
              <label className="label" htmlFor="export-border">
                {t('reader.border')}
              </label>
              <input
                id="export-border"
                type="number"
                min={0}
                max={8}
                value={d.border}
                onChange={(e) =>
                  onDraft({ border: Math.max(0, Math.min(8, Number(e.target.value) || 0)) })
                }
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="export-signature">
                {t('reader.signature')}
              </label>
              <input
                id="export-signature"
                value={d.signature}
                maxLength={120}
                onChange={(e) => onDraft({ signature: e.target.value })}
              />
            </div>
          </>
        )}
        <label>
          <input
            id="export-captions"
            type="checkbox"
            checked={d.captions}
            onChange={(e) => onDraft({ captions: e.target.checked })}
          />{' '}
          {t('reader.captions')}
        </label>
        {!isNative ? (
          <label>
            <input
              id="export-prompts"
              type="checkbox"
              checked={d.prompts}
              onChange={(e) => onDraft({ prompts: e.target.checked })}
            />{' '}
            {t('reader.prompts')}
          </label>
        ) : null}
        <div className="field export-profile">
          <label className="label" htmlFor="export-image-profile">
            {t('reader.profile')}
          </label>
          <select
            id="export-image-profile"
            value={d.profile}
            onChange={(e) => onDraft({ profile: e.target.value as Profile })}
          >
            {PROFILES.map((p) => (
              <option key={p} value={p}>
                {t(`reader.profiles.${p}.label`)}
              </option>
            ))}
          </select>
          <div className="help" id="export-image-profile-help">
            {t(`reader.profiles.${d.profile}.help`)}
          </div>
        </div>
      </details>
      <div className="presentation-export">
        <div className="presentation-portable">
          <button
            type="button"
            className="btn small"
            disabled={!props.episodeId || !!busy}
            onClick={() => exportPortable('zip')}
          >
            <Icon name="download" sm />
            {t('reader.zip')}
          </button>
          <button
            type="button"
            className="btn small"
            disabled={!props.episodeId || !!busy}
            onClick={() => exportPortable('pdf')}
          >
            <Icon name="download" sm />
            {t('reader.pdf')}
          </button>
        </div>
        <p className="help">{t('reader.portableHelp')}</p>
        <button
          type="button"
          className="btn primary"
          disabled={!props.episodeId || !!busy}
          onClick={exportHtml}
        >
          <Icon name="download" />
          {busy === 'html' ? t('reader.exporting') : t('reader.exportHtml')}
        </button>
        <div id="export-status" role="status">
          {status}
        </div>
      </div>
      <details
        className="quiet-advanced presentation-platform"
        open={props.platformOpen}
        onToggle={(e) => props.onPlatform((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>{t('reader.platform.title')}</summary>
        <p className="help">{t('reader.platform.hint')}</p>
        <div className="field">
          <label className="label" htmlFor="export-platform">
            {t('reader.platform.preset')}
          </label>
          <select
            id="export-platform"
            value={d.preset}
            onChange={(e) => onDraft({ preset: e.target.value })}
          >
            {platformPresets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          {preset ? (
            <div className="help">
              {t('reader.platform.spec', {
                width: preset.width,
                height: preset.max_height,
                format: d.quality === 'lossless' ? 'PNG' : preset.format,
              })}
            </div>
          ) : null}
        </div>
        <div className="field">
          <label className="label" htmlFor="export-quality">
            {t('reader.platform.quality')}
          </label>
          <select
            id="export-quality"
            value={d.quality}
            onChange={(e) => onDraft({ quality: e.target.value as Quality })}
          >
            {(Object.keys(QUALITIES) as Quality[]).map((q) => (
              <option key={q} value={q}>
                {t(`reader.platform.qualities.${q}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="presentation-portable">
          <button
            type="button"
            className="btn small"
            disabled={!props.episodeId || !!busy}
            onClick={() => exportPlatform('slices')}
          >
            <Icon name="download" sm />
            {t('reader.platform.slices')}
          </button>
          <button
            type="button"
            className="btn small"
            disabled={!props.episodeId || !!busy}
            onClick={() => exportPlatform('long')}
          >
            <Icon name="download" sm />
            {t('reader.platform.long')}
          </button>
        </div>
      </details>
    </aside>
  );
}
