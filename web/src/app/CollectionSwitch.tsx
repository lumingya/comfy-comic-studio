import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useSeriesList } from '../api/series';
import { usePatchSettings, useSettings } from '../api/system';
import { toastError } from '../components/toast';
import { topDialog } from '../components/topLayer';
import { Icon } from './icons';

/** The collection title (legacy 画册集), defaulting to 「遇见你，真好」. */
export function useCollectionTitle() {
  const { t } = useTranslation();
  const settings = useSettings();
  return settings.data?.collection_title || t('classic.shelf.defaultTitle');
}

/** Top bar collection switcher (legacy #project-switch-button + #project-popover). */
export function CollectionSwitch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const title = useCollectionTitle();
  const series = useSeriesList();
  const patch = usePatchSettings();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(title);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const button = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const renameButton = useRef<HTMLButtonElement>(null);
  const cancelRename = useRef(false);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!popover.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        e.isComposing ||
        e.keyCode === 229 ||
        e.key !== 'Escape' ||
        topDialog()
      )
        return;
      e.preventDefault();
      setOpen(false);
      button.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    const r = button.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left, top: r.bottom + 8 });
    setRenaming(false);
    setDraft(title);
    setOpen(!open);
  };

  const save = () => {
    if (cancelRename.current) {
      cancelRename.current = false;
      setRenaming(false);
      return;
    }
    const next = draft.trim();
    if (next && next !== title) patch.mutate({ collection_title: next }, { onError: toastError });
    setRenaming(false);
  };

  const count = series.data?.length ?? 0;
  return (
    <>
      <button
        ref={button}
        id="project-switch-button"
        className="project-switch"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="project-popover"
        aria-label={t('legacy.switchCollection')}
        onClick={toggle}
      >
        <Icon name="folder" sm />
        <span className="project-switch-name">{title}</span>
        <Icon name="down" sm />
      </button>
      {open ? (
        <div
          ref={popover}
          id="project-popover"
          className="project-popover"
          role="menu"
          aria-label={t('legacy.collectionMenu')}
          style={{ left: pos.left, top: pos.top }}
        >
          <div className="project-popover-label row">
            {t('legacy.switchCollection')}
            <span className="spacer" />
            <button
              type="button"
              className="ibtn"
              title={t('legacy.closeMenu')}
              aria-label={t('legacy.closeMenu')}
              onClick={() => {
                setOpen(false);
                button.current?.focus({ preventScroll: true });
              }}
            >
              <Icon name="close" />
            </button>
          </div>
          {renaming ? (
            <form
              className="project-rename"
              onSubmit={(e) => {
                e.preventDefault();
                // Focus the trigger, letting the input's blur commit once.
                renameButton.current?.focus({ preventScroll: true });
              }}
            >
              <input
                className="input"
                autoFocus
                value={draft}
                maxLength={60}
                aria-label={t('legacy.renameCollection')}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape' || e.nativeEvent.isComposing || e.keyCode === 229) return;
                  e.preventDefault();
                  e.stopPropagation();
                  cancelRename.current = true;
                  setDraft(title);
                  renameButton.current?.focus({ preventScroll: true });
                }}
                onBlur={save}
              />
            </form>
          ) : (
            <button
              className="project-choice"
              role="menuitem"
              aria-current="true"
              onClick={() => {
                setOpen(false);
                navigate('/gallery');
              }}
            >
              <Icon name="folder" />
              <span className="grow">
                <strong>{title}</strong>
                <small>{t('legacy.albums', { count })}</small>
              </span>
            </button>
          )}
          <button
            ref={renameButton}
            className="project-new"
            role="menuitem"
            onClick={() => {
              cancelRename.current = false;
              setDraft(title);
              setRenaming(true);
            }}
          >
            <Icon name="edit" />
            {t('legacy.renameCollection')}
          </button>
        </div>
      ) : null}
    </>
  );
}
