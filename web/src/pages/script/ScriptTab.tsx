import { Plus, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useAddPanel, usePatchEpisode, useReorderPanels } from '../../api/series';
import { toastError } from '../../components/toast';
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
  const reorder = useReorderPanels(episode.id!);
  const patchEpisode = usePatchEpisode(episode.id!);
  const [assistant, setAssistant] = useState(false);
  const [synopsis, setSynopsis] = useState<string | null>(null);

  const panels = useMemo(
    () => [...episode.panels].sort((a, b) => a.order - b.order),
    [episode.panels],
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
            onDeleted={() => select(null)}
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
