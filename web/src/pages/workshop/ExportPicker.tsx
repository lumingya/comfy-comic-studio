import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../app/icons';
import { toast, toastError } from '../../components/toast';
import { Modal } from '../../components/ui';
import { exportStoryboards, listStoryboards } from './storyActions';

export interface ExportItem {
  id: string;
  title: string;
  meta: string;
}

/**
 * Legacy openWorkshopExportDialog: pick the storyboards / presets to take along. One is saved as
 * its own `.json`; several go into one `.json` list that 「导入」 reads back whole.
 */
export function ExportPicker({
  title,
  noun,
  items,
  current,
  onExport,
  onClose,
}: {
  title: string;
  noun: string;
  items: ExportItem[];
  current?: string;
  onExport: (ids: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(current && items.some((x) => x.id === current) ? [current] : []),
  );
  const [busy, setBusy] = useState(false);
  const n = picked.size;
  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const run = async () => {
    if (!n || busy) return;
    setBusy(true);
    try {
      // Keep the list order, not the click order.
      await onExport(items.filter((x) => picked.has(x.id)).map((x) => x.id));
      onClose();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={title}
      description={t('ws.exportPick.lead', { noun })}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn primary" disabled={!n || busy} onClick={run}>
            <Icon name="upload" sm />
            {n > 1 ? t('ws.exportPick.many', { count: n }) : t('ws.export')}
          </button>
        </>
      }
    >
      <div className="workshop-export-sheet">
        <div className="workshop-export-tools">
          <span className="workshop-export-count" role="status">
            {t('ws.exportPick.count', { n, total: items.length })}
          </span>
          <span className="grow" />
          <button
            type="button"
            className="btn small ghost"
            onClick={() => setPicked(new Set(items.map((x) => x.id)))}
          >
            <Icon name="check" sm />
            {t('ws.exportPick.all')}
          </button>
          {current ? (
            <button
              type="button"
              className="btn small ghost"
              onClick={() => setPicked(new Set([current]))}
            >
              <Icon name="edit" sm />
              {t('ws.exportPick.current')}
            </button>
          ) : null}
        </div>
        <div
          className="workshop-export-list"
          role="group"
          aria-label={t('ws.exportPick.group', { noun })}
        >
          {items.map((x) => (
            <label
              key={x.id}
              className={`workshop-export-item ${x.id === current ? 'is-current' : ''}`}
            >
              <input type="checkbox" checked={picked.has(x.id)} onChange={() => toggle(x.id)} />
              <span className="grow">
                <strong>{x.title || t('ws.exportPick.untitled')}</strong>
                <small>{x.meta}</small>
              </span>
              {x.id === current ? <em>{t('ws.exportPick.currentTag')}</em> : null}
            </label>
          ))}
        </div>
        <p className="help">{t('ws.exportPick.help')}</p>
      </div>
    </Modal>
  );
}

/** 「导出…」 / 「选择并导出…」 for storyboards: `open()` lists every storyboard, then the picker. */
export function useStoryboardExport(workshopId: string | undefined, currentId: string | undefined) {
  const { t } = useTranslation();
  const [items, setItems] = useState<ExportItem[] | null>(null);
  const open = () => {
    if (!workshopId) return;
    listStoryboards(workshopId)
      .then((list) =>
        setItems(
          list.map((b) => ({
            id: b.id,
            title: b.title,
            meta: t('ws.exportPick.frames', { count: b.panel_count }),
          })),
        ),
      )
      .catch(toastError);
  };
  const noun = t('ws.exportPick.storyNoun');
  const element = items ? (
    <ExportPicker
      title={t('ws.exportPick.storyTitle')}
      noun={noun}
      items={items}
      current={currentId}
      onClose={() => setItems(null)}
      onExport={async (ids) => {
        await exportStoryboards(ids, t('ws.exportPick.storyBundle', { count: ids.length }));
        if (ids.length > 1) toast(t('ws.exportPick.done', { count: ids.length, noun }));
      }}
    />
  ) : null;
  return { open, element };
}
