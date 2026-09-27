import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { download, downloadPost, raw } from '../../api/client';
import { useImportAlbumTemplate, type AlbumTemplateInfo } from '../../api/open';
import { useExportPresets } from '../../api/production';
import { Icon } from '../../app/icons';
import { toast, toastError } from '../../components/toast';

/*
 * The legacy presentation drawer (ui-presentation.js + ui-export.js), in its order:
 *   templates → 本次展示与导出设置 (incl. 图片处理) → ZIP / PDF / 导出完整 HTML.
 * Everything that does NOT use a presentation template (platform slices, long image, motion comic)
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

/** The export draft, remembered across sessions like the legacy studioUI.exportDraft. */
export function useExportDraft(): [ExportDraft, (patch: Partial<ExportDraft>) => void] {
  const [draft, setDraft] = useState<ExportDraft>(() => {
    try {
      return { ...DEFAULT_DRAFT, ...JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') };
    } catch {
      return DEFAULT_DRAFT;
    }
  });
  const update = (patch: Partial<ExportDraft>) =>
    setDraft((d) => {
      const next = { ...d, ...patch };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
      return next;
    });
  return [draft, update];
}

function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Body shared by the preview and the real HTML export. */
function albumBody(
  p: { episodeId: string; templateId: string; variantId: string | null; lettered: boolean },
  d: ExportDraft,
) {
  return {
    episode_ids: [p.episodeId],
    template_id: p.templateId,
    variant_id: p.variantId,
    lettered: p.lettered,
    show_captions: d.captions,
    show_prompts: d.prompts,
    theme_color: d.themeColor,
    border: d.border,
    signature: d.signature,
  };
}

/** The album rendered with a legacy HTML template (POST /api/export/album), shown in an iframe. */
export function TemplatePreview(props: {
  episodeId: string;
  templateId: string;
  variantId: string | null;
  lettered: boolean;
  draft: ExportDraft;
}) {
  const { t } = useTranslation();
  const body = useDebounced(
    { ...albumBody(props, props.draft), image_profile: 'preview', max_width: 1400 },
    300,
  );
  const q = useQuery({
    queryKey: ['album-preview', body],
    staleTime: 5 * 60_000,
    retry: false,
    placeholderData: (previous) => previous,
    queryFn: async () =>
      (
        await raw('/api/export/album', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      ).text(),
  });
  return (
    <div className="presentation-preview-wrap">
      {q.data ? (
        <iframe
          title={t('reader.previewTitle')}
          sandbox="allow-scripts allow-popups"
          srcDoc={q.data}
        />
      ) : null}
      {q.isFetching && !q.data ? (
        <div id="presentation-preview-status" role="status">
          {t('reader.previewing')}
        </div>
      ) : q.error ? (
        <div id="presentation-preview-status" role="alert">
          {t('reader.previewFailed', { message: (q.error as Error).message })}
        </div>
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
  variantId: string | null;
  preset: string;
}) {
  const { t } = useTranslation();
  const presets = useExportPresets();
  const v = props.variantId ? `&variant_id=${encodeURIComponent(props.variantId)}` : '';
  const plan = useQuery({
    queryKey: ['slice-plan', props.episodeId, props.preset, props.variantId],
    retry: false,
    placeholderData: (previous) => previous,
    queryFn: async () =>
      (
        await raw(
          `/api/episodes/${props.episodeId}/slices?preset=${encodeURIComponent(props.preset)}${v}`,
        )
      ).json() as Promise<SlicePlan>,
  });
  const p = plan.data;
  const label = presets.data?.find((x) => x.id === props.preset)?.label ?? props.preset;
  const src = p ? `/api/episodes/${props.episodeId}/strip.png?width=${p.width}${v}` : '';
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
  templates: { id: string; title: string; description: string }[];
  infos: AlbumTemplateInfo[];
  look: string;
  native: string;
  onLook: (id: string) => void;
  hintOf: (id: string) => string;
  draft: ExportDraft;
  onDraft: (patch: Partial<ExportDraft>) => void;
  mode: string;
  onMode: (mode: 'auto' | 'single' | 'continuous') => void;
  episodeId: string | undefined;
  title: string;
  lettered: boolean;
  variants: { id: string; name: string }[];
  variantId: string | null;
  onVariant: (id: string | null) => void;
  platformOpen: boolean;
  onPlatform: (open: boolean) => void;
  studio: boolean;
  motionOpen: boolean;
  onMotion: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { draft: d, onDraft } = props;
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<Job | null>(null);
  const [status, setStatus] = useState('');
  const presets = useExportPresets();
  const importTpl = useImportAlbumTemplate();
  const file = useRef<HTMLInputElement>(null);
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
              variantId: props.variantId,
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
          variant_id: props.variantId,
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
    if (props.variantId) q.set('variant_id', props.variantId);
    return run(fmt, () => download(`/api/episodes/${ep}/export?${q}`, name));
  };
  const importFile = async (f: File) => {
    try {
      const body = JSON.parse(await f.text());
      importTpl.mutate(body, {
        onSuccess: (tpl) => {
          toast(t('reader.imported', { title: tpl.title }));
          props.onLook(tpl.id);
        },
        onError: toastError,
      });
    } catch {
      toastError(new Error(t('reader.badTemplate')));
    }
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
      <div id="presentation-template-list">
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
                props.onMotion(false);
              }}
            >
              <span className="presentation-swatch">
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
        <button type="button" className="btn small" onClick={() => file.current?.click()}>
          <Icon name="upload" sm />
          {t('reader.importTemplate')}
        </button>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void importFile(f);
          }}
        />
      </div>
      <details className="presentation-options" open>
        <summary>{t('reader.options')}</summary>
        {isNative ? (
          <div className="field">
            <label className="label" htmlFor="presentation-native-mode">
              {t('reader.readMode')}
            </label>
            <select
              id="presentation-native-mode"
              value={props.mode}
              onChange={(e) => props.onMode(e.target.value as 'auto' | 'single' | 'continuous')}
            >
              {(['auto', 'single', 'continuous'] as const).map((m) => (
                <option key={m} value={m}>
                  {t(`reader.readModes.${m}`)}
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
        {props.studio && props.variants.length ? (
          <div className="field">
            <label className="label" htmlFor="export-variant">
              {t('reader.variant')}
            </label>
            <select
              id="export-variant"
              value={props.variantId ?? ''}
              onChange={(e) => props.onVariant(e.target.value || null)}
            >
              <option value="">{t('reader.baseVariant')}</option>
              {props.variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
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
      {props.studio ? (
        <details className="quiet-advanced presentation-motion">
          <summary>{t('reader.motion.title')}</summary>
          <p className="help">{t('reader.motion.hint')}</p>
          <button
            type="button"
            className="btn small"
            disabled={!props.episodeId}
            aria-pressed={props.motionOpen}
            onClick={() => props.onMotion(!props.motionOpen)}
          >
            <Icon name="play" sm />
            {props.motionOpen ? t('reader.motion.close') : t('reader.motion.open')}
          </button>
        </details>
      ) : null}
    </aside>
  );
}
