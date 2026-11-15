import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { raw } from '../../api/client';
import { useSettings } from '../../api/system';
import { useExportPresets } from '../../api/production';

export type Profile = 'auto' | 'clean' | 'publish' | 'archive';
export const PROFILES: Profile[] = ['auto', 'clean', 'publish', 'archive'];
export type Quality = 'lossless' | 'q95' | 'q90' | 'q80';
export const QUALITIES: Record<Quality, number> = { lossless: 0, q95: 95, q90: 90, q80: 80 };

export interface ExportDraft {
  themeColor: string; // '' = the template's own accent
  border: number;
  signature: string;
  captions: boolean;
  deduplicateCaptions: boolean;
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
  deduplicateCaptions: true,
  prompts: false,
  profile: 'auto',
  preset: 'webtoon',
  quality: 'q90',
};

type StoredDraft = Omit<ExportDraft, 'signature'> & {
  signature: string | null;
  captionPreference?: boolean;
};

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
      if (patch.captions !== undefined) next.captionPreference = patch.captions;
      const { signature: _signature, ...kept } = next;
      localStorage.setItem(DRAFT_KEY, JSON.stringify(kept));
      return next;
    });
  return [
    {
      ...draft,
      captions: draft.captionPreference ?? true,
      deduplicateCaptions: draft.captionPreference !== true,
      signature: draft.signature ?? fallback,
    },
    update,
  ];
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
export function albumBody(
  p: { episodeId: string; templateId: string; lettered: boolean },
  d: ExportDraft,
) {
  return {
    episode_ids: [p.episodeId],
    template_id: p.templateId,
    lettered: p.lettered,
    show_captions: d.captions,
    deduplicate_captions: d.deduplicateCaptions,
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
  // Reserve space only for actionable loading/error feedback, not a permanent success banner.
  const status = q.error
    ? t('reader.previewFailed', { message: (q.error as Error).message })
    : !q.data
      ? q.isFetching
        ? t('reader.previewLoading')
        : ''
      : q.isFetching
        ? t('reader.previewUpdating')
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
export function useReport() {
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
