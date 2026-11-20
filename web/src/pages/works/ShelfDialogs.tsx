import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, data, download, downloadPost } from '../../api/client';
import { useAlbumTemplates } from '../../api/open';
import { exportCreationKit } from '../../api/creationKits';
import { listStoryboards } from '../workshop/storyActions';
import type { SeriesCard } from '../../api/types';
import { toast, toastError } from '../../components/toast';
import { Field, Modal, Select, TextInput } from '../../components/ui';
import { templateRank } from './templateFile';
import { useSettings } from '../../api/system';

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
    return look && look !== 'mio-fit' ? look : 'export-monograph';
  } catch {
    return 'export-monograph';
  }
};

type BatchFormat = 'html' | 'pdf' | 'zip' | 'source' | 'kit';
const BATCH_FORMATS: BatchFormat[] = ['html', 'pdf', 'zip', 'source', 'kit'];

/** All batch export choices share one entry point and one explicit download action. */
export function ExportBooks(props: {
  books: SeriesCard[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collectionTitle: string;
}) {
  const { t } = useTranslation();
  const templates = useAlbumTemplates();
  const [format, setFormat] = useState<BatchFormat>('html');
  const [picked, setTemplateId] = useState(lastLook);
  const [title, setTitle] = useState(props.collectionTitle.slice(0, 120));
  // Legacy: the signature field starts from 设置 → 工作室's default album signature.
  const fallback = useSettings().data?.signature ?? '';
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [includePresets, setIncludePresets] = useState(true);
  const [captions, setCaptions] = useState(true);
  const [profile, setProfile] = useState('auto');
  const [completed, setCompleted] = useState<string[]>([]);
  const [error, setError] = useState('');
  const individual = format === 'source' || format === 'kit';
  const list = useMemo(
    () => [...(templates.data ?? [])].sort((a, b) => templateRank(a.id) - templateRank(b.id)),
    [templates.data],
  );
  // A template that was deleted since falls back to the default collection edition.
  const templateId = list.some((x) => x.id === picked)
    ? picked
    : ((list.find((x) => x.id === 'export-monograph') ?? list[0])?.id ?? picked);
  const run = async () => {
    if (busy || !props.books.length) return;
    setBusy(true);
    setError('');
    try {
      if (individual) {
        for (const book of props.books) {
          if (completed.includes(book.id!)) continue;
          if (format === 'source') {
            await download(`/api/series/${book.id}/bundle`, `${book.title}.mio.zip`);
          } else {
            const episodes = await listStoryboards(book.id!);
            const source = includePresets
              ? data(
                  await api.GET('/api/series/{series_id}', {
                    params: { path: { series_id: book.id! } },
                  }),
                )
              : undefined;
            if (!episodes.length) throw new Error(t('classic.shelf.exportEmpty'));
            await exportCreationKit({
              series_id: book.id!,
              episode_ids: episodes.map((episode) => episode.id!),
              preset_ids: source?.presets?.map((preset) => preset.id) ?? [],
              title: book.title.slice(0, 120),
            });
          }
          setCompleted((ids) => [...ids, book.id!]);
        }
      } else {
        const pages = await Promise.all(props.books.map((book) => listStoryboards(book.id!)));
        const episode_ids = pages.flatMap((page) => page.map((episode) => episode.id!));
        if (!episode_ids.length) throw new Error(t('classic.shelf.exportEmpty'));
        if (episode_ids.length > 50)
          throw new Error(t('exportUi.tooMany', { count: episode_ids.length }));
        const options = {
          episode_ids,
          title: title.trim(),
          image_profile: profile,
          lettered: true,
          show_captions: captions,
          deduplicate_captions: true,
        };
        await downloadPost(
          format === 'html' ? '/api/export/album' : '/api/export/portable',
          format === 'html'
            ? { ...options, template_id: templateId, signature: (signature ?? fallback).trim() }
            : { ...options, format },
          `${title.trim() || props.collectionTitle}.${format}`,
        );
      }
      toast(t('classic.shelf.exportDone', { count: props.books.length }));
      props.onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={props.open}
      onOpenChange={(open) => !busy && props.onOpenChange(open)}
      title={t('exportUi.batchTitle', { count: props.books.length })}
      description={t(individual ? 'exportUi.batchSeparate' : 'exportUi.batchCombined')}
      footer={
        <>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => props.onOpenChange(false)}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !props.books.length}
            onClick={() => void run()}
          >
            {busy ? t('classic.shelf.exporting') : t('common.export')}
          </button>
        </>
      }
    >
      <fieldset
        className="book-export-form"
        disabled={busy}
        style={{ border: 0, padding: 0, margin: 0 }}
      >
        <Field label={t('exportUi.format')}>
          <Select
            value={format}
            onChange={(value) => {
              setFormat(value);
              setCompleted([]);
              setError('');
            }}
            options={BATCH_FORMATS.map((value) => ({
              value,
              label: t(`exportUi.formats.${value}`),
            }))}
          />
        </Field>
        {format === 'html' ? (
          <>
            <Field label={t('classic.shelf.exportTemplate')}>
              <Select
                value={templateId}
                onChange={setTemplateId}
                options={list.map((x) => ({ value: x.id, label: x.title }))}
              />
            </Field>
          </>
        ) : null}
        {!individual ? (
          <>
            <Field label={t('classic.shelf.exportName')}>
              <TextInput value={title} maxLength={120} onChange={setTitle} />
            </Field>
            {format === 'html' ? (
              <Field label={t('reader.signature')}>
                <TextInput value={signature ?? fallback} maxLength={120} onChange={setSignature} />
              </Field>
            ) : null}
            <Field label={t('exportUi.imageProfile')}>
              <Select
                value={profile}
                onChange={setProfile}
                options={['auto', 'clean', 'publish', 'archive'].map((value) => ({
                  value,
                  label: t(`reader.profiles.${value}.label`),
                }))}
              />
            </Field>
            {format !== 'pdf' ? (
              <label>
                <input
                  type="checkbox"
                  checked={captions}
                  onChange={(event) => setCaptions(event.target.checked)}
                />{' '}
                {t('exportUi.captions')}
              </label>
            ) : null}
          </>
        ) : null}
        {format === 'kit' ? (
          <label>
            <input
              type="checkbox"
              checked={includePresets}
              onChange={(event) => {
                setIncludePresets(event.target.checked);
                setCompleted([]);
                setError('');
              }}
            />{' '}
            {t('exportUi.includePresets')}
          </label>
        ) : null}
      </fieldset>
      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}
      {completed.length ? (
        <p role="status" className="small muted">
          {t('exportUi.partial', { done: completed.length, total: props.books.length })}
        </p>
      ) : null}
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
