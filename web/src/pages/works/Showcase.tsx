import { ArrowRight, ChevronLeft, ChevronRight, ImageIcon, Star } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { assetUrl } from '../../api/client';
import type { SeriesCard } from '../../api/types';
import { useUI } from '../../app/ui-store';
import { ActionMenu, type MenuAction } from '../../components/ui';

const pad = (n: number) => String(n).padStart(2, '0');

/** Legacy shelf status: every panel has an adopted image → complete; otherwise what is missing. */
export function frameState(series: SeriesCard): {
  key: 'blank' | 'complete' | 'missing';
  n: number;
} {
  const panels = series.panel_count ?? 0;
  const done = series.adopted_count ?? 0;
  if (!panels) return { key: 'blank', n: 0 };
  return done >= panels ? { key: 'complete', n: 0 } : { key: 'missing', n: panels - done };
}

export function shelfDate(iso: string | undefined, language: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(language.startsWith('en') ? 'en-US' : 'zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** A parchment placeholder book, painted from data-* so titles are not read twice. */
export function Parchment({ series }: { series: SeriesCard }) {
  return (
    <span className="parchment">
      <span className="parchment-mark">MIO · COLLECTION</span>
      <span className="parchment-title" data-text={series.title} />
      {series.subtitle ? <span className="parchment-sub" data-text={series.subtitle} /> : null}
      <span className="parchment-rule" />
    </span>
  );
}

export function StarButton({ series, small }: { series: SeriesCard; small?: boolean }) {
  const { t } = useTranslation();
  const on = useUI((s) => s.starred.includes(series.id!));
  const toggle = useUI((s) => s.toggleStar);
  return (
    <button
      type="button"
      className={`btn ghost icon sm star-toggle ${on ? 'is-on' : ''}`}
      aria-pressed={on}
      aria-label={t(on ? 'classic.shelf.unstar' : 'classic.shelf.star')}
      title={t(on ? 'classic.shelf.unstar' : 'classic.shelf.star')}
      onClick={() => toggle(series.id!)}
    >
      <Star size={small ? 14 : 16} fill={on ? 'currentColor' : 'none'} />
    </button>
  );
}

/** "01 / 07" with 上一册 / 下一册 (legacy shelf-exhibit-nav). */
export function ShowcaseNav(props: { index: number; total: number; onIndex: (i: number) => void }) {
  const { t } = useTranslation();
  return (
    <div className="shelf-exhibit-nav">
      <button
        type="button"
        className="btn ghost icon sm"
        aria-label={t('classic.shelf.prev')}
        title={`${t('classic.shelf.prev')} (←)`}
        disabled={props.index <= 0}
        onClick={() => props.onIndex(props.index - 1)}
      >
        <ChevronLeft size={16} />
      </button>
      <span className="shelf-counter mono" aria-live="polite">
        {pad(props.index + 1)} / {pad(props.total)}
      </span>
      <button
        type="button"
        className="btn ghost icon sm"
        aria-label={t('classic.shelf.next')}
        title={`${t('classic.shelf.next')} (→)`}
        disabled={props.index >= props.total - 1}
        onClick={() => props.onIndex(props.index + 1)}
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/** One featured book at a time, cover left and colophon right (legacy 精选展示). */
export function Showcase(props: {
  books: SeriesCard[];
  index: number;
  onIndex: (i: number) => void;
  firstEditionId?: string;
  actions: (series: SeriesCard) => MenuAction[];
  onChangeCover: (series: SeriesCard) => void;
}) {
  const { t, i18n } = useTranslation();
  const { books, index, onIndex } = props;
  const b = books[Math.min(index, books.length - 1)];

  // ← / → leaf through the shelf unless focus is in a field or a dialog is up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || typing(e.target)) return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      else if (e.key === 'ArrowRight' && index < books.length - 1) onIndex(index + 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, books.length, onIndex]);

  if (!b) return null;
  const to = `/gallery/${b.id}`;
  const cast = (b.bible?.characters ?? []).map((c) => c.name).filter(Boolean);
  const state = frameState(b);
  const status = b.status ?? 'draft';
  const pics = b.adopted_count ?? 0;
  return (
    <article className="shelf-exhibit" key={b.id} aria-label={b.title}>
      <div className="exhibit-cover">
        <Link
          to={to}
          className="exhibit-cover-link"
          aria-label={`${t('classic.shelf.open')} · ${b.title}`}
        >
          {b.cover_asset_id ? (
            <img src={assetUrl(b.cover_asset_id, 1024)} alt="" decoding="async" />
          ) : (
            <span className="exhibit-book book-cover">
              <Parchment series={b} />
              <span className="book-spine" />
            </span>
          )}
        </Link>
        {pics ? (
          <span className="pic-count mono" title={t('classic.shelf.pics', { count: pics })}>
            ▧ {pics}
          </span>
        ) : null}
        <button
          type="button"
          className="glass-chip exhibit-recover"
          onClick={() => props.onChangeCover(b)}
        >
          <ImageIcon size={13} /> {t('classic.shelf.changeCover')}
        </button>
      </div>
      <div className="edition-info">
        <div className="edition-count">
          {b.id === props.firstEditionId
            ? t('classic.shelf.firstEdition')
            : t('classic.shelf.visualStory')}{' '}
          / {t('classic.shelf.frames', { count: b.panel_count ?? 0 })}
        </div>
        <h2>{b.title}</h2>
        <p className="synopsis">{b.subtitle || t('classic.shelf.noSynopsis')}</p>
        <div className="edition-byline">
          {cast.length ? cast.slice(0, 3).join(' · ') : t('classic.shelf.original')}
        </div>
        <div className="edition-entry">
          <Link to={to} className="read-link">
            {t('classic.shelf.open')} <ArrowRight size={14} />
          </Link>
          <span className="spacer" />
          <StarButton series={b} />
          <ActionMenu label={t('classic.shelf.manage')} actions={props.actions(b)} />
        </div>
        <div className="shelf-meta-line">
          <i className={`dot ${state.key === 'missing' ? 'is-amber' : ''}`} />
          <span>{t(`classic.shelf.${state.key}`, { count: state.n })}</span>
          <span className="sep">/</span>
          <span>{t(`series.status.${status}`)}</span>
          <span className="sep">/</span>
          <time dateTime={b.created_at}>{shelfDate(b.created_at, i18n.language)}</time>
        </div>
        <div className="edition-credit mono">
          MIO
          <span>{t('classic.shelf.credit')}</span>
        </div>
      </div>
    </article>
  );
}
