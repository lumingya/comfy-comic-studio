import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { QueryError } from '../../app/errors';
import { Loading, Modal } from '../../components/ui';
import { ExportPicker } from './ExportPicker';
import { listStoryboards } from './storyActions';
import './creation-kits.css';

export function CreationKitExport({
  seriesId,
  onClose,
}: {
  seriesId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['kit-export-episodes', seriesId],
    queryFn: () => listStoryboards(seriesId),
  });
  if (!query.data)
    return (
      <Modal open title={t('kits.export')} onOpenChange={(open) => !open && onClose()}>
        {query.isError ? <QueryError error={query.error} onRetry={query.refetch} /> : <Loading />}
      </Modal>
    );
  return (
    <ExportPicker
      title={t('kits.export')}
      noun={t('kits.episodes')}
      items={query.data.map((episode) => ({
        id: episode.id,
        title: episode.title,
        meta: t('kits.frames', { count: episode.panel_count }),
      }))}
      current={query.data[0]?.id}
      kit={{ seriesId, only: true }}
      onExport={async () => {}}
      onClose={onClose}
    />
  );
}
