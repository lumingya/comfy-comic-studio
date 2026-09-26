import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLegacyImport, useLegacyScan } from '../../api/system';
import { QueryError } from '../../app/errors';
import { toast, toastError } from '../../components/toast';
import { Loading, Modal, Switch } from '../../components/ui';

export function LegacyImportDialog(props: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const scan = useLegacyScan(props.open);
  const run = useLegacyImport();
  const [overwrite, setOverwrite] = useState(false);
  const counts = scan.data ?? {};

  const submit = () =>
    run.mutate(overwrite, {
      onSuccess: (report) => {
        toast(t('works.imported', { count: report.series?.length ?? 0 }));
        props.onOpenChange(false);
      },
      onError: toastError,
    });

  return (
    <Modal
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('works.importLegacy')}
      description={t('works.legacyHint')}
      footer={
        <>
          <button className="btn ghost" onClick={() => props.onOpenChange(false)}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={!scan.data || run.isPending} onClick={submit}>
            {t('common.confirm')}
          </button>
        </>
      }
    >
      {scan.isLoading ? <Loading /> : null}
      {scan.error ? <QueryError error={scan.error} /> : null}
      {scan.data ? (
        <div className="col">
          <div className="notice">
            {t('works.legacyFound', {
              storyboards: counts.storyboards ?? 0,
              presets: counts['presets/characters'] ?? 0,
              workflows: counts.workflows ?? 0,
            })}
          </div>
          <Switch checked={overwrite} onChange={setOverwrite} label="overwrite" />
        </div>
      ) : null}
      {run.data?.warnings?.length ? (
        <ul className="small muted">
          {run.data.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </Modal>
  );
}
