import { QueryError } from '../../app/errors';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { useExtensionPanels } from '../../api/open';
import { ExtensionFrame, panelKey } from '../../components/ExtensionFrame';
import { Empty, Loading } from '../../components/ui';
import { useEpisodeContext } from './EpisodePage';
import { useCreationContext, usePublishCreationContext } from '../../extensions/creationContext';

/** Hosts an extension panel declared for the `episode` slot. */
export default function ExtensionTab() {
  const { t } = useTranslation();
  const { panelId } = useParams();
  const { episode } = useEpisodeContext();
  usePublishCreationContext({
    route: 'other',
    series_id: episode.series_id,
    episode_id: episode.id,
    revision: episode.revision,
  });
  const creation = useCreationContext();
  const panels = useExtensionPanels('episode');
  if (panels.isError) return <QueryError error={panels.error} onRetry={panels.refetch} />;
  if (panels.isLoading) return <Loading />;
  const panel = panels.data?.find((p) => panelKey(p) === panelId);
  if (!panel) return <Empty>{t('settings.ext.panelGone')}</Empty>;
  return (
    <ExtensionFrame
      panel={panel}
      params={{ episode: episode.id, series: episode.series_id }}
      height={720}
      creationContext={creation.episode_id === episode.id ? creation : undefined}
    />
  );
}
