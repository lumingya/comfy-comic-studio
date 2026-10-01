import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, data, downloadPost } from '../../api/client';
import { useAlbumTemplates } from '../../api/open';
import { episodePageQuery } from '../../api/series';
import type { SeriesCard } from '../../api/types';
import { toast, toastError } from '../../components/toast';
import { Field, Modal, Select, TextInput } from '../../components/ui';
import { templateRank } from './templateFile';

/** Legacy 画册名称 limit (organize.js saveBookNames). */
const MAX_TITLE = 150;

/**
 * Legacy 重命名 / 批量重命名: one field per album, saved together.  Only the names change —
 * images, files and generation jobs stay as they are.
 */
export function RenameBooks(props: {
  books: SeriesCard[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [names, setNames] = useState(() => props.books.map((b) => b.title));
  const [busy, setBusy] = useState(false);
  const single = props.books.length === 1;
  const invalid = names.some((n) => !n.trim() || n.trim().length > MAX_TITLE);
  const save = async () => {
    if (invalid || busy) return;
    setBusy(true);
    let changed = 0;
    try {
      for (const [i, b] of props.books.entries()) {
        const title = names[i].trim();
        if (title === b.title) continue;
        data(
          await api.PATCH('/api/series/{series_id}', {
            params: { path: { series_id: b.id! } },
            body: { title } as never,
          }),
        );
        changed++;
      }
      props.onOpenChange(false);
      if (changed) toast(t('classic.shelf.renamed', { count: changed }));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
      if (changed) void qc.invalidateQueries({ queryKey: ['series'] });
    }
  };
  return (
    <Modal
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('classic.shelf.renameTitle')}
      description={t('classic.shelf.renameHelp')}
      footer={
        <>
          <button type="button" className="btn" onClick={() => props.onOpenChange(false)}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={invalid || busy}
            onClick={() => void save()}
          >
            {t('classic.shelf.renameSave')}
          </button>
        </>
      }
    >
      <div className="book-rename-list">
        {props.books.map((b, i) => (
          <Field
            key={b.id}
            label={
              single ? t('classic.shelf.renameOne') : t('classic.shelf.renameMany', { n: i + 1 })
            }
          >
            <TextInput
              value={names[i]}
              maxLength={MAX_TITLE}
              autoFocus={i === 0}
              aria-label={single ? undefined : b.title}
              onChange={(v) => setNames((all) => all.map((n, j) => (j === i ? v : n)))}
              onEnter={() => void save()}
            />
          </Field>
        ))}
      </div>
    </Modal>
  );
}

/** The template the reader last used (ReaderPage keeps it here; mio-fit is not an HTML one). */
const lastLook = () => {
  try {
    const look = localStorage.getItem('mio.reader.look') ?? '';
    return look && look !== 'mio-fit' ? look : 'export-paper';
  } catch {
    return 'export-paper';
  }
};

/**
 * Legacy multi-select 导出离线画册…: the chosen albums bound into one offline HTML with one
 * template (POST /api/export/album with every album's episodes).  One album goes to the reader's
 * 版式 drawer instead, where the preview and all options live.
 */
export function ExportBooks(props: {
  books: SeriesCard[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collectionTitle: string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const templates = useAlbumTemplates();
  const [picked, setTemplateId] = useState(lastLook);
  const [title, setTitle] = useState(props.collectionTitle);
  const [busy, setBusy] = useState(false);
  const list = useMemo(
    () => [...(templates.data ?? [])].sort((a, b) => templateRank(a.id) - templateRank(b.id)),
    [templates.data],
  );
  // A template that was deleted since falls back to the paper one.
  const templateId = list.some((x) => x.id === picked)
    ? picked
    : ((list.find((x) => x.id === 'export-paper') ?? list[0])?.id ?? picked);
  const run = async () => {
    setBusy(true);
    try {
      const pages = await Promise.all(
        props.books.map((b) => qc.fetchQuery(episodePageQuery(b.id!))),
      );
      const episode_ids = pages.flatMap((p) => p.items.map((e) => e.id!)).slice(0, 50);
      if (!episode_ids.length) throw new Error(t('classic.shelf.exportEmpty'));
      await downloadPost(
        '/api/export/album',
        {
          episode_ids,
          template_id: templateId,
          title: title.trim() || undefined,
          image_profile: 'auto',
        },
        `${title.trim() || props.collectionTitle}.html`,
      );
      toast(t('classic.shelf.exportDone', { count: props.books.length }));
      props.onOpenChange(false);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('classic.shelf.exportTitle', { count: props.books.length })}
      description={t('classic.shelf.exportHelp')}
      footer={
        <>
          <button type="button" className="btn" onClick={() => props.onOpenChange(false)}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void run()}>
            {busy ? t('classic.shelf.exporting') : t('classic.shelf.exportRun')}
          </button>
        </>
      }
    >
      <div className="book-export-form">
        <Field label={t('classic.shelf.exportTemplate')}>
          <Select
            value={templateId}
            onChange={setTemplateId}
            options={list.map((x) => ({ value: x.id, label: x.title }))}
          />
        </Field>
        <Field label={t('classic.shelf.exportName')}>
          <TextInput value={title} maxLength={MAX_TITLE} onChange={setTitle} />
        </Field>
      </div>
      <ul className="book-export-list">
        {props.books.map((b) => (
          <li key={b.id}>
            {b.title} · {t('classic.shelf.frames', { count: b.panel_count ?? 0 })}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
