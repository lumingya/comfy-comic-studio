import { useQueries } from '@tanstack/react-query';
import { Check, ImagePlus, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, assetUrl, data, uploadAsset } from '../../api/client';
import { keys } from '../../api/keys';
import { useEpisodes, usePatchSeries } from '../../api/series';
import type { Episode, SeriesCard } from '../../api/types';
import { toast, toastError } from '../../components/toast';
import { Empty, FilePick, Modal } from '../../components/ui';

/** How many episodes the picker reads takes from (covers come from the opening chapters). */
const EPISODES = 12;

export interface CoverChoice {
  asset_id: string;
  adopted: boolean;
  label: string;
}

/**
 * Every usable image of a series, in reading order: base-variant, not rejected, on a panel
 * that still exists.  The first entry is what the automatic cover falls back to.
 */
export function coverChoices(episodes: Episode[]): CoverChoice[] {
  const out: CoverChoice[] = [];
  const seen = new Set<string>();
  for (const ep of episodes) {
    const panels = new Map((ep.panels ?? []).map((p) => [p.id!, p]));
    const takes = (ep.takes ?? [])
      .filter((t) => !t.variant_id && t.status !== 'rejected' && panels.has(t.panel_id))
      .sort(
        (a, b) =>
          (panels.get(a.panel_id)!.order ?? 0) - (panels.get(b.panel_id)!.order ?? 0) ||
          (a.created_at ?? '').localeCompare(b.created_at ?? ''),
      );
    for (const t of takes) {
      if (seen.has(t.asset_id)) continue;
      seen.add(t.asset_id);
      const panel = panels.get(t.panel_id)!;
      out.push({
        asset_id: t.asset_id,
        adopted: t.status === 'adopted',
        label: `${ep.title} · #${(panel.order ?? 0) + 1}`,
      });
    }
  }
  return out;
}

export function CoverPicker(props: {
  series: SeriesCard;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { series } = props;
  const manual = series.cover_auto === false;
  const episodes = useEpisodes(props.open ? series.id : undefined);
  const ids = (episodes.data?.items ?? []).slice(0, EPISODES).map((e) => e.id);
  const full = useQueries({
    queries: ids.map((id) => ({
      queryKey: keys.episode(id),
      queryFn: async () =>
        data(await api.GET('/api/episodes/{episode_id}', { params: { path: { episode_id: id } } })),
    })),
  });
  const loaded = full.map((q) => q.data).filter(Boolean) as Episode[];
  const found = coverChoices(loaded);
  // An uploaded (or no longer listed) chosen cover still shows up first.
  const choices =
    series.cover_asset_id &&
    series.cover_auto === false &&
    !found.some((c) => c.asset_id === series.cover_asset_id)
      ? [{ asset_id: series.cover_asset_id, adopted: false, label: series.title }, ...found]
      : found;
  const loading = episodes.isLoading || full.some((q) => q.isLoading);
  const patch = usePatchSeries(series.id!);
  const [uploading, setUploading] = useState(false);

  const choose = (cover: string | null) =>
    patch.mutate(
      { cover_asset_id: cover },
      {
        onSuccess: () => {
          toast(t('classic.shelf.coverSet'));
          props.onOpenChange(false);
        },
        onError: toastError,
      },
    );
  const upload = async (file: File) => {
    setUploading(true);
    try {
      choose((await uploadAsset(file, file.name)).id);
    } catch (error) {
      toastError(error);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal
      open={props.open}
      onOpenChange={props.onOpenChange}
      size="lg"
      title={`${t('classic.shelf.changeCover')} · ${series.title}`}
      description={t('classic.shelf.coverHint')}
      footer={
        <>
          <span className="cover-picker-state">
            {manual ? null : (
              <>
                <i className="dot" /> {t('classic.shelf.coverIsAuto')}
              </>
            )}
          </span>
          <FilePick accept="image/*" onFile={upload} disabled={uploading || patch.isPending}>
            <ImagePlus size={15} /> {t('classic.shelf.coverUpload')}
          </FilePick>
          <button
            className="btn"
            disabled={!manual || patch.isPending}
            onClick={() => choose(null)}
          >
            <RotateCcw size={14} /> {t('classic.shelf.coverAuto')}
          </button>
        </>
      }
    >
      {loading ? (
        <div className="cover-picker">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skeleton cover-choice" />
          ))}
        </div>
      ) : choices.length ? (
        <div className="cover-picker" role="listbox" aria-label={t('classic.shelf.changeCover')}>
          {choices.map((c) => {
            const current = c.asset_id === series.cover_asset_id;
            return (
              <button
                key={c.asset_id}
                type="button"
                role="option"
                aria-selected={current}
                className={`cover-choice ${current ? 'is-current' : ''}`}
                title={c.label}
                disabled={patch.isPending}
                onClick={() => choose(c.asset_id)}
              >
                <img src={assetUrl(c.asset_id, 320)} alt={c.label} loading="lazy" />
                {current ? (
                  <span className="cover-choice-mark">
                    <Check size={12} /> {t('classic.shelf.coverCurrent')}
                  </span>
                ) : c.adopted ? (
                  <span className="cover-choice-tag">{t('classic.shelf.adopted')}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : (
        <Empty compact title={t('classic.shelf.coverEmpty')} />
      )}
    </Modal>
  );
}
