import { BookOpen, Download, Upload } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadPost } from '../../api/client';
import { useAlbumTemplates, useImportAlbumTemplate } from '../../api/open';
import { toast, toastError } from '../../components/toast';
import { Field, FilePick, Select, Switch, TextInput } from '../../components/ui';

/** Options for the offline HTML album (a secondary output built from the lettered strip). */
export function AlbumExport(props: {
  episodeId: string;
  variantId: string | null;
  fallbackName: string;
}) {
  const { t } = useTranslation();
  const templates = useAlbumTemplates();
  const importTpl = useImportAlbumTemplate();
  const [templateId, setTemplateId] = useState('export-paper');
  const [lettered, setLettered] = useState(true);
  const [captions, setCaptions] = useState(true);
  const [prompts, setPrompts] = useState(false);
  const [title, setTitle] = useState('');
  const [signature, setSignature] = useState('');
  const [busy, setBusy] = useState(false);
  const list = templates.data ?? [];
  const current = list.find((tpl) => tpl.id === templateId);

  const run = async () => {
    setBusy(true);
    try {
      await downloadPost(
        '/api/export/album',
        {
          episode_ids: [props.episodeId],
          template_id: templateId,
          variant_id: props.variantId,
          lettered,
          show_captions: captions,
          show_prompts: prompts,
          title,
          signature,
        },
        `${props.fallbackName}.html`,
      );
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File) => {
    try {
      const body = JSON.parse(await file.text());
      importTpl.mutate(body, {
        onSuccess: (tpl) => (toast(t('exporter.album.imported')), setTemplateId(tpl.id)),
        onError: toastError,
      });
    } catch {
      toastError(new Error(t('exporter.album.badFile')));
    }
  };

  return (
    <div className="card col" style={{ gap: 14, maxWidth: 520 }}>
      <Field label={t('exporter.album.template')}>
        <div className="row">
          <Select
            className="grow"
            value={templateId}
            onChange={setTemplateId}
            options={(list.length ? list : [{ id: 'export-paper', title: 'Paper' }]).map((tpl) => ({
              value: tpl.id,
              label: tpl.title,
            }))}
          />
          <FilePick className="btn ghost sm" accept=".json,application/json" onFile={onFile}>
            <Upload size={13} /> {t('exporter.album.import')}
          </FilePick>
        </div>
      </Field>
      {current ? (
        <p className="row small muted" style={{ margin: 0 }}>
          <BookOpen size={13} />
          {current.layout_name}
          {current.description ? ` · ${current.description}` : ''}
        </p>
      ) : null}
      <div className="grid-2">
        <Field label={t('exporter.album.title')}>
          <TextInput value={title} onChange={setTitle} />
        </Field>
        <Field label={t('exporter.album.signature')}>
          <TextInput value={signature} onChange={setSignature} />
        </Field>
      </div>
      <div className="col" style={{ gap: 8 }}>
        <Switch checked={lettered} onChange={setLettered} label={t('exporter.album.lettered')} />
        <Switch checked={captions} onChange={setCaptions} label={t('exporter.album.captions')} />
        <Switch checked={prompts} onChange={setPrompts} label={t('exporter.album.prompts')} />
      </div>
      <div>
        <button className="btn primary" disabled={busy} onClick={run}>
          {busy ? <span className="spinner" /> : <Download size={15} />} {t('exporter.go')}
        </button>
      </div>
    </div>
  );
}
