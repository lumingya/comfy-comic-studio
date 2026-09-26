import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { useExtensionPanels } from '../../api/open';
import { ExtensionFrame, panelKey } from '../../components/ExtensionFrame';
import { Empty, Loading } from '../../components/ui';
import { useEpisodeContext } from './EpisodePage';

/** Hosts an extension panel declared for the `episode` slot. */
export default function ExtensionTab() {
  const { t } = useTranslation();
  const { panelId } = useParams();
  const { episode } = useEpisodeContext();
  const panels = useExtensionPanels('episode');
  if (panels.isLoading) return <Loading />;
  const panel = panels.data?.find((p) => panelKey(p) === panelId);
  if (!panel) return <Empty>{t('settings.ext.panelGone')}</Empty>;
  return (
    <ExtensionFrame
      panel={panel}
      params={{ episode: episode.id, series: episode.series_id }}
      height={720}
    />
  );
}
