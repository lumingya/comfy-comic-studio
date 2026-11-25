import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { raw } from '../../api/client';
import {
  useAlbumTemplate,
  useDeleteAlbumTemplate,
  useImportAlbumTemplate,
  type AlbumTemplateDoc,
  type AlbumTemplateInfo,
} from '../../api/open';
import { Icon } from '../../app/icons';
import { confirm } from '../../components/confirm';
import { ownCancel } from '../../components/topLayer';
import { toast, toastError } from '../../components/toast';
import { TemplateEditorFields } from './TemplateEditorFields';
import { TemplateStudioPreview } from './TemplateStudioPreview';

const newId = () => `my-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** `value` after it stopped changing for `ms`; compared by content, so literals don't loop. */
function useDebounced<T>(value: T, ms: number): T {
  const key = JSON.stringify(value);
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(JSON.parse(key) as T), ms);
    return () => clearTimeout(id);
  }, [key, ms]);
  return v;
}

/**
 * 画册导出模板工作室 (legacy template studio, opened by 「自定义」 in the presentation drawer):
 * pick a template, change its look and information or its HTML / CSS source, see a live preview of
 * this album, then save. Built-in templates are never changed: saving one creates your own copy.
 */
export function TemplateStudio(props: {
  templates: AlbumTemplateInfo[];
  initialId: string;
  preview: {
    episodeId: string | undefined;
    lettered: boolean;
    captions: boolean;
    deduplicateCaptions?: boolean;
  };
  /** A template was saved or deleted: `id` is the one to show next in the reader. */
  onSaved: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(props.initialId);
  /** The edited copy; null = untouched (the stored template is shown). */
  const [edit, setEdit] = useState<AlbumTemplateDoc | null>(null);
  /** A brand-new template that is not in the library yet. */
  const [fresh, setFresh] = useState(false);
  const [tab, setTab] = useState<'design' | 'source'>('design');
  const stored = useAlbumTemplate(fresh ? null : selected);
  const save = useImportAlbumTemplate();
  const remove = useDeleteAlbumTemplate();
  const info = props.templates.find((x) => x.id === selected);
  const builtin = !fresh && info?.source !== 'user';
  const tpl = edit ?? stored.data ?? null;
  const dirty = edit !== null;

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal?.();
  }, []);

  const leave = async () =>
    !dirty ||
    (await confirm({
      title: t('reader.studio.discardTitle'),
      description: t('reader.studio.discardHelp'),
      confirmLabel: t('reader.studio.discard'),
      danger: true,
    }));
  const close = async () => {
    if (!(await leave())) return;
    ref.current?.close?.();
    props.onClose();
  };
  const pick = async (id: string) => {
    if (id === selected && !fresh) return;
    if (!(await leave())) return;
    setEdit(null);
    setFresh(false);
    setSelected(id);
  };
  const copyOf = (base: AlbumTemplateDoc, title: string): AlbumTemplateDoc => ({
    ...base,
    id: newId(),
    title: title.slice(0, 80),
  });
  const duplicate = async () => {
    if (!tpl || !(await leave())) return;
    setEdit(copyOf(tpl, t('reader.studio.copyOf', { title: tpl.title })));
    setFresh(true);
  };
  const create = async () => {
    if (!tpl || !(await leave())) return;
    setEdit({
      ...copyOf(tpl, t('reader.studio.untitled')),
      description: '',
      author: '',
      version: '',
    });
    setFresh(true);
  };
  const submit = () => {
    if (!tpl) return;
    // Built-in templates stay as they are: saving one makes your own copy.
    const body = builtin
      ? copyOf(
          tpl,
          tpl.title === info?.title ? t('reader.studio.copyOf', { title: tpl.title }) : tpl.title,
        )
      : tpl;
    save.mutate(body, {
      onSuccess: (out) => {
        toast(t('reader.studio.saved', { title: out.title }));
        setEdit(null);
        setFresh(false);
        setSelected(out.id);
        props.onSaved(out.id);
      },
      onError: toastError,
    });
  };
  const destroy = async () => {
    if (!info || builtin) return;
    const ok = await confirm({
      title: t('reader.studio.deleteTitle', { title: info.title }),
      description: t('reader.studio.deleteHelp'),
      confirmLabel: t('reader.studio.delete'),
      danger: true,
    });
    if (!ok) return;
    remove.mutate(info.id, {
      onSuccess: () => {
        const next = props.templates.find((x) => x.id !== info.id)?.id ?? 'mio-fit';
        setEdit(null);
        setSelected(next);
        props.onSaved(next);
      },
      onError: toastError,
    });
  };
  const exportFile = () => {
    if (!tpl) return;
    const blob = new Blob([JSON.stringify({ name: 'album_template', ...tpl }, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${tpl.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  // Live preview of this album with the unsaved draft (the server validates it like an import).
  const body = useDebounced(
    tpl && props.preview.episodeId
      ? {
          episode_ids: [props.preview.episodeId],
          template: tpl,
          lettered: props.preview.lettered,
          show_captions: props.preview.captions,
          deduplicate_captions: props.preview.deduplicateCaptions ?? true,
          include_source_data: false,
          image_profile: 'preview',
          max_width: 900,
        }
      : null,
    450,
  );
  const preview = useQuery({
    queryKey: ['album-studio-preview', body],
    enabled: !!body,
    retry: false,
    staleTime: 5 * 60_000,
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

  const status = preview.error
    ? { kind: 'error', text: (preview.error as Error).message }
    : dirty
      ? { kind: '', text: t('reader.studio.unsaved') }
      : { kind: 'ok', text: t('reader.studio.clean') };

  const listItem = (x: { id: string; title: string; sub: string }, active: boolean) => (
    <button
      key={x.id}
      type="button"
      className={`template-library-item ${active ? 'active' : ''}`}
      aria-pressed={active}
      onClick={() => void pick(x.id)}
    >
      <span className="template-glyph" aria-hidden="true">
        <i />
        <i />
      </span>
      <span>
        <strong>{x.title}</strong>
        <small>{x.sub}</small>
      </span>
    </button>
  );

  return (
    <dialog
      ref={ref}
      className="template-dialog"
      aria-labelledby="template-studio-title"
      onCancel={(e) => {
        if (!ownCancel(e)) return;
        e.preventDefault();
        void close();
      }}
    >
      <header className="template-dialog-head">
        <Icon name="book" />
        <div className="grow">
          <h2 id="template-studio-title">{t('reader.studio.title')}</h2>
          <p>{t('reader.studio.lede')}</p>
        </div>
        <button
          type="button"
          className="ibtn"
          title={t('reader.studio.close')}
          aria-label={t('reader.studio.close')}
          onClick={() => void close()}
        >
          <Icon name="close" />
        </button>
      </header>
      <div className="template-layout">
        <aside className="template-library">
          <div className="template-library-label">
            MY EXPORT TEMPLATES <span className="spacer" />
            {props.templates.length}
          </div>
          {props.templates.map((x) =>
            listItem(
              {
                id: x.id,
                title: x.title,
                sub: `${x.layout_name} · ${x.source === 'user' ? t('reader.studio.mine') : t('reader.studio.builtin')}`,
              },
              !fresh && x.id === selected,
            ),
          )}
          {fresh && tpl ? (
            <>
              <div className="template-library-label" style={{ paddingTop: 13 }}>
                {t('reader.studio.draft')}
              </div>
              {listItem({ id: tpl.id, title: tpl.title, sub: t('reader.studio.notSaved') }, true)}
            </>
          ) : null}
          <div className="template-library-tools">
            <button
              type="button"
              className="btn small"
              disabled={!tpl}
              onClick={() => void create()}
            >
              <Icon name="plus" sm />
              {t('reader.studio.new')}
            </button>
            <p className="tiny muted" style={{ lineHeight: 1.9, margin: '8px 0 0' }}>
              {t('reader.studio.libraryHelp')}
            </p>
          </div>
        </aside>
        <div className="template-workbench">
          <div className="template-tools">
            {(['design', 'source'] as const).map((x) => (
              <button
                key={x}
                type="button"
                className={`tab ${tab === x ? 'active' : ''}`}
                aria-pressed={tab === x}
                onClick={() => setTab(x)}
              >
                {t(`reader.studio.tab.${x}`)}
              </button>
            ))}
            <span className="spacer" />
            <button
              type="button"
              className="ibtn"
              title={t('reader.studio.duplicate')}
              aria-label={t('reader.studio.duplicate')}
              disabled={!tpl}
              onClick={() => void duplicate()}
            >
              <Icon name="copy" />
            </button>
            <button type="button" className="btn small" disabled={!tpl} onClick={exportFile}>
              <Icon name="download" sm />
              {t('reader.studio.exportFile')}
            </button>
            {!builtin && !fresh ? (
              <button
                type="button"
                className="ibtn"
                title={t('reader.studio.delete')}
                aria-label={t('reader.studio.delete')}
                disabled={remove.isPending}
                onClick={() => void destroy()}
              >
                <Icon name="trash" />
              </button>
            ) : null}
          </div>
          <div className="template-editor-grid">
            <TemplateEditorFields tpl={tpl} tab={tab} builtin={builtin} onChange={setEdit} />
            <TemplateStudioPreview
              html={preview.data}
              title={tpl?.title ?? ''}
              episodeId={props.preview.episodeId}
            />
          </div>
          <footer className="template-footer">
            <span
              id="template-save-status"
              className={`validation-result grow ${status.kind}`}
              role={status.kind === 'error' ? 'alert' : 'status'}
            >
              {status.text}
            </span>
            <button
              type="button"
              className="btn small"
              disabled={!dirty}
              onClick={() => {
                setEdit(null);
                if (fresh) setFresh(false);
              }}
            >
              <Icon name="refresh" sm />
              {t('reader.studio.revert')}
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={!tpl || save.isPending || (!dirty && !builtin)}
              onClick={submit}
            >
              <Icon name="check" />
              {builtin ? t('reader.studio.saveCopy') : t('reader.studio.save')}
            </button>
          </footer>
        </div>
      </div>
    </dialog>
  );
}
