import { Plus, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useAddPanel, useDeletePanel, usePatchEpisode, useReorderPanels } from '../../api/series';
import type { Panel } from '../../api/types';
import { toast, toastError } from '../../components/toast';
import { Empty, TextArea } from '../../components/ui';
import { useEpisodeContext } from '../episode/EpisodePage';
import { AssistantDialog } from './AssistantDialog';
import { PanelEditor } from './PanelEditor';
import { PanelList } from './PanelList';

export default function ScriptTab() {
  const { t } = useTranslation();
  const { episode, series } = useEpisodeContext();
  const [params, setParams] = useSearchParams();
  const add = useAddPanel(episode.id!);
  const remove = useDeletePanel(episode.id!);
  const reorder = useReorderPanels(episode.id!);
  const patchEpisode = usePatchEpisode(episode.id!);
  const [assistant, setAssistant] = useState(false);
  const [synopsis, setSynopsis] = useState<string | null>(null);

  const panels = useMemo(
    () => [...episode.panels].sort((a, b) => a.order - b.order),
    [episode.panels],
  );
  const covers = useMemo(
    () =>
      Object.fromEntries(
        episode.takes
          .filter((take) => take.status === 'adopted' && !take.variant_id)
          .map((take) => [take.panel_id, take.asset_id]),
      ),
    [episode.takes],
  );
  const selectedId = params.get('panel') ?? panels[0]?.id ?? null;
  const selected = panels.find((p) => p.id === selectedId) ?? null;
  const select = (id: string | null) => setParams(id ? { panel: id } : {}, { replace: true });

  const addAfter = () =>
    add.mutate(
      { panel: { description: '' }, after: selectedId },
      {
        onSuccess: (ep) => {
          const known = new Set(panels.map((p) => p.id));
          const created = ep.panels.find((p) => !known.has(p.id));
          if (created) select(created.id!);
        },
        onError: toastError,
      },
    );

  // Delete, land on the neighbour, and offer Undo (the panel's takes are kept server-side, so
  // re-adding it with the same id brings its images back).
  const deletePanel = (snapshot: Panel) => {
    const index = panels.findIndex((p) => p.id === snapshot.id);
    const before = panels[index - 1]?.id ?? null;
    const neighbour = panels[index + 1]?.id ?? before;
    remove.mutate(snapshot.id!, {
      onSuccess: () => {
        select(neighbour);
        toast(t('script.panelDeleted', { n: index + 1 }), {
          action: { label: t('common.undo'), onClick: () => restorePanel(snapshot, before) },
        });
      },
      onError: toastError,
    });
  };

  const restorePanel = async (snapshot: Panel, before: string | null) => {
    try {
      const ep = await add.mutateAsync({ panel: { ...snapshot }, after: before });
      if (before === null) {
        // `after: null` appends; move it back to the front.
        const rest = [...ep.panels].sort((a, b) => a.order - b.order).map((p) => p.id!);
        await reorder.mutateAsync([snapshot.id!, ...rest.filter((id) => id !== snapshot.id)]);
      }
      select(snapshot.id!);
    } catch (error) {
      toastError(error);
    }
  };

  return (
    <div className="script-layout">
      <aside className="script-rail">
        <div className="row" style={{ padding: '0 4px 10px' }}>
          <span className="small muted grow">{t('series.panels', { count: panels.length })}</span>
          <button className="btn sm" onClick={() => setAssistant(true)}>
            <Sparkles size={13} /> {t('script.assistant')}
          </button>
          <button className="btn icon sm" title={t('script.addPanel')} onClick={addAfter}>
            <Plus size={14} />
          </button>
        </div>
        <details className="synopsis">
          <summary className="small muted">{t('episode.synopsis')}</summary>
          <TextArea rows={3} value={synopsis ?? episode.synopsis ?? ''} onChange={setSynopsis} />
          {synopsis !== null && synopsis !== episode.synopsis ? (
            <button
              className="btn sm"
              onClick={() =>
                patchEpisode.mutate(
                  { synopsis },
                  { onSuccess: () => setSynopsis(null), onError: toastError },
                )
              }
            >
              {t('common.save')}
            </button>
          ) : null}
        </details>
        <PanelList
          panels={panels}
          series={series}
          selected={selectedId}
          covers={covers}
          onSelect={select}
          onReorder={(ids) => reorder.mutate(ids, { onError: toastError })}
        />
      </aside>
      <section className="script-main">
        {selected ? (
          <PanelEditor
            key={selected.id}
            episode={episode}
            series={series}
            panel={selected}
            index={panels.indexOf(selected)}
            onDelete={deletePanel}
          />
        ) : (
          <Empty
            action={
              <button className="btn primary" onClick={addAfter}>
                <Plus size={15} /> {t('script.addPanel')}
              </button>
            }
          >
            {t('script.selectPanel')}
          </Empty>
        )}
      </section>
      <AssistantDialog episodeId={episode.id!} open={assistant} onOpenChange={setAssistant} />
    </div>
  );
}
