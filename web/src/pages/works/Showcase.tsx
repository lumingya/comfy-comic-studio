import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  MoreHorizontal,
  RefreshCw,
  Star,
} from 'lucide-react';
import { useEffect, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { assetUrl } from '../../api/client';
import type { SeriesCard } from '../../api/types';
import { useUI } from '../../app/ui-store';
import { missingOf, type ShelfState } from './shelf';

const pad = (n: number) => String(n).padStart(2, '0');

/** The ⋯ button of an album: the same menu as a right-click, anchored under the button. */
export function BookMenuButton(props: {
  label: string;
  onMenu: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className="btn ghost icon sm"
      aria-label={props.label}
      title={props.label}
      aria-haspopup="menu"
      onClick={props.onMenu}
    >
      <MoreHorizontal size={16} />
    </button>
  );
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
  stateOf: (series: SeriesCard) => ShelfState;
  onMenu: (series: SeriesCard, e: MouseEvent<HTMLButtonElement>) => void;
  onResume: (series: SeriesCard) => void;
  resuming?: boolean;
  onChangeCover: (series: SeriesCard) => void;
  selected?: boolean;
  context?: boolean;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { books, index, onIndex } = props;
  const b = books[Math.min(index, books.length - 1)];

  // ← / → leaf through the shelf unless focus is in a field or a dialog is up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        props.disabled ||
        e.defaultPrevented ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        typing(e.target)
      )
        return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      else if (e.key === 'ArrowRight' && index < books.length - 1) onIndex(index + 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, books.length, onIndex, props.disabled]);

  if (!b) return null;
  const to = `/gallery/${b.id}`;
  const cast = (b.bible?.characters ?? []).map((c) => c.name).filter(Boolean);
  const state = props.stateOf(b);
  const missing = missingOf(b);
  const pics = b.adopted_count ?? 0;
  return (
    <article
      className={`shelf-exhibit ${props.selected ? 'is-selected' : ''} ${props.context ? 'is-context' : ''}`}
      key={b.id}
      aria-label={b.title}
      data-shelf-id={b.id}
      tabIndex={0}
      aria-selected={props.selected || undefined}
    >
      <div className="exhibit-cover">
        <Link
          to={to}
          className="exhibit-cover-link"
          data-shelf-open
          aria-label={`${t('classic.shelf.open')} · ${b.title}`}
        >
          {b.cover_asset_id ? (
            <img draggable={false} src={assetUrl(b.cover_asset_id, 1024)} alt="" decoding="async" />
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
        <p className="synopsis">{b.synopsis || b.subtitle || t('classic.shelf.noSynopsis')}</p>
        <div className="edition-byline">
          {cast.length ? cast.slice(0, 3).join(' · ') : t('classic.shelf.original')}
        </div>
        <div className="edition-entry">
          <Link to={to} className="read-link" data-shelf-open>
            {t('classic.shelf.open')} <ArrowRight size={14} />
          </Link>
          <span className="spacer" />
          <StarButton series={b} />
          <BookMenuButton label={t('classic.shelf.manage')} onMenu={(e) => props.onMenu(b, e)} />
        </div>
        <div className="shelf-meta-line">
          <i className={`dot ${missing ? 'is-amber' : ''}`} />
          <span>{t(`classic.shelf.state.${state}`)}</span>
          <span className="sep">/</span>
          <time dateTime={b.created_at}>{shelfDate(b.created_at, i18n.language)}</time>
        </div>
        {missing && state !== 'generating' ? (
          <button
            type="button"
            className="btn sm shelf-resume"
            disabled={props.resuming}
            title={t('classic.shelf.resumeHint', { count: missing })}
            onClick={() => props.onResume(b)}
          >
            <RefreshCw size={13} /> {t('classic.shelf.resume', { count: missing })}
          </button>
        ) : null}
        <div className="edition-credit mono">
          MIO
          <span>{t('classic.shelf.credit')}</span>
        </div>
      </div>
    </article>
  );
}
