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

const LAYOUTS = ['webtoon', 'manga', 'artbook', 'flip'] as const;
const COLORS = ['accent', 'background', 'paper', 'text'] as const;
const SIZES = [
  ['width', 400, 1800],
  ['gap', 0, 100],
  ['radius', 0, 40],
] as const;
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
    variantId: string | null;
    lettered: boolean;
    captions: boolean;
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
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
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
  const change = (patch: Partial<AlbumTemplateDoc>) => tpl && setEdit({ ...tpl, ...patch });
  const option = (patch: Partial<AlbumTemplateDoc['options']>) =>
    tpl && setEdit({ ...tpl, options: { ...tpl.options, ...patch } });
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
  const hasLoop = !!tpl?.html.includes('{{#books}}');
  const insertLoop = () => {
    if (!tpl || hasLoop) return;
    change({
      html: `${tpl.html}\n{{#books}}\n<section>\n  {{#frames}}<figure><img src="{{image}}" alt=""><figcaption>{{caption}}</figcaption></figure>{{/frames}}\n</section>\n{{/books}}`,
    });
  };

  // Live preview of this album with the unsaved draft (the server validates it like an import).
  const body = useDebounced(
    tpl && props.preview.episodeId
      ? {
          episode_ids: [props.preview.episodeId],
          template: tpl,
          variant_id: props.preview.variantId,
          lettered: props.preview.lettered,
          show_captions: props.preview.captions,
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
            <section className="template-edit-fields">
              {!tpl ? (
                <p className="help">{t('reader.studio.loading')}</p>
              ) : tab === 'design' ? (
                <>
                  <h3>{t('reader.studio.designHead')}</h3>
                  <div className="field">
                    <label className="label" htmlFor="et-title">
                      {t('reader.studio.name')}
                    </label>
                    <input
                      id="et-title"
                      value={tpl.title}
                      maxLength={80}
                      onChange={(e) => change({ title: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="et-layout">
                      {t('reader.studio.layout')}
                    </label>
                    <select
                      id="et-layout"
                      value={tpl.layout}
                      onChange={(e) =>
                        change({ layout: e.target.value as AlbumTemplateDoc['layout'] })
                      }
                    >
                      {LAYOUTS.map((l) => (
                        <option key={l} value={l}>
                          {t(`reader.studio.layouts.${l}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="et-description">
                      {t('reader.studio.description')}
                    </label>
                    <textarea
                      id="et-description"
                      style={{ minHeight: 64 }}
                      value={tpl.description}
                      onChange={(e) => change({ description: e.target.value })}
                    />
                  </div>
                  <div className="grid2">
                    <div className="field">
                      <label className="label" htmlFor="et-author">
                        {t('reader.studio.author')}
                      </label>
                      <input
                        id="et-author"
                        value={tpl.author}
                        onChange={(e) => change({ author: e.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label className="label" htmlFor="et-version">
                        {t('reader.studio.version')}
                      </label>
                      <input
                        id="et-version"
                        value={tpl.version}
                        onChange={(e) => change({ version: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="divider" />
                  <h3>{t('reader.studio.paperHead')}</h3>
                  <div className="template-colors">
                    {COLORS.map((k) => (
                      <div className="field" key={k}>
                        <span className="label">{t(`reader.studio.colors.${k}`)}</span>
                        <div className="color-setting">
                          <input
                            type="color"
                            value={tpl.options[k]}
                            aria-label={t(`reader.studio.colors.${k}`)}
                            onChange={(e) => option({ [k]: e.target.value })}
                          />
                          <span>{tpl.options[k]}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="et-font">
                      {t('reader.studio.font')}
                    </label>
                    <select
                      id="et-font"
                      value={tpl.options.font}
                      onChange={(e) => option({ font: e.target.value as 'serif' | 'sans' })}
                    >
                      <option value="serif">{t('reader.studio.fonts.serif')}</option>
                      <option value="sans">{t('reader.studio.fonts.sans')}</option>
                    </select>
                  </div>
                  <div className="grid3">
                    {SIZES.map(([k, min, max]) => (
                      <div className="field" key={k}>
                        <label className="label" htmlFor={`et-${k}`}>
                          {t(`reader.studio.sizes.${k}`)}
                        </label>
                        <input
                          id={`et-${k}`}
                          type="number"
                          min={min}
                          max={max}
                          value={tpl.options[k]}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            if (Number.isFinite(v))
                              option({ [k]: Math.max(min, Math.min(max, Math.round(v))) });
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  <p className="help">
                    {t('reader.studio.variablesHelp', {
                      v1: '{{themeColor}}',
                      v2: '{{contentWidth}}',
                    })}
                  </p>
                  {builtin ? <p className="help">{t('reader.studio.builtinHelp')}</p> : null}
                </>
              ) : (
                <>
                  <div className="row between" style={{ marginBottom: 12 }}>
                    <h3 style={{ margin: 0 }}>{t('reader.studio.sourceHead')}</h3>
                    <button
                      type="button"
                      className="btn ghost small"
                      disabled={hasLoop}
                      title={hasLoop ? t('reader.studio.hasLoop') : undefined}
                      onClick={insertLoop}
                    >
                      <Icon name="plus" sm />
                      {t('reader.studio.insertLoop')}
                    </button>
                  </div>
                  <p className="template-source-info">
                    {t('reader.studio.sourceInfo', { img: '{{image}}' })}
                  </p>
                  <textarea
                    id="et-source"
                    className="template-source"
                    spellCheck={false}
                    aria-label={t('reader.studio.sourceLabel')}
                    value={tpl.html}
                    onChange={(e) => change({ html: e.target.value })}
                  />
                  <details className="source-guide">
                    <summary>{t('reader.studio.guideTitle')}</summary>
                    <p>
                      <code>
                        {'{{#books}} … {{#frames}} <img src="{{image}}"> {{/frames}} … {{/books}}'}
                      </code>
                    </p>
                    <p>{t('reader.studio.guideLoops', { img: '{{image}}' })}</p>
                    <p>
                      <code>
                        {
                          '{{title}} {{signature}} {{date}} {{themeColor}} {{background}} {{paperColor}} {{textColor}} {{contentWidth}} {{panelGap}} {{imageRadius}} {{bodyFont}} · {{number}} {{name}} {{caption}}'
                        }
                      </code>
                    </p>
                    <p>{t('reader.studio.guideSafety')}</p>
                  </details>
                </>
              )}
            </section>
            <section className="template-preview-pane">
              <div className="preview-toolbar">
                <i className="dot" style={{ width: 4, height: 4 }} />
                <span>{t('reader.studio.livePreview')}</span>
                <span className="spacer" />
                {(['desktop', 'mobile'] as const).map((x) => (
                  <button
                    key={x}
                    type="button"
                    className={`ibtn ${device === x ? 'on' : ''}`}
                    aria-pressed={device === x}
                    title={t(`reader.studio.device.${x}`)}
                    aria-label={t(`reader.studio.device.${x}`)}
                    onClick={() => setDevice(x)}
                  >
                    <Icon name={x === 'desktop' ? 'expand' : 'image'} sm />
                  </button>
                ))}
              </div>
              <div className={`preview-viewport ${device === 'mobile' ? 'mobile' : ''}`}>
                {preview.data ? (
                  <iframe
                    id="template-preview"
                    className="template-frame"
                    title={t('reader.studio.livePreview')}
                    sandbox="allow-scripts allow-popups"
                    srcDoc={preview.data}
                  />
                ) : (
                  <p className="help">
                    {props.preview.episodeId
                      ? t('reader.previewing')
                      : t('reader.studio.noEpisode')}
                  </p>
                )}
              </div>
            </section>
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
