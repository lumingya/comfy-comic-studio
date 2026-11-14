import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Copy, Search } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  copyOrganizableEpisode,
  getOrganizableEpisode,
  nudgeEpisode,
  refreshOrganizedWork,
} from '../../api/longform';
import type { Episode } from '../../api/types';
import { flushEditors } from '../../app/useAutoDraft';
import { toast, toastError } from '../../components/toast';
import { ActionMenu, type MenuAction } from '../../components/ui';
import { VariableToolsDialog } from './VariableToolsDialog';

export function EpisodeOrganizeMenu({
  episode,
  onCopied,
  actions = [],
  canMoveUp = true,
  canMoveDown = true,
}: {
  episode: Pick<Episode, 'id' | 'series_id' | 'title'>;
  onCopied?: (episode: Episode) => void;
  actions?: MenuAction[];
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [variables, setVariables] = useState(false);
  const run = async (action: 'copy' | -1 | 1) => {
    if (busy) return;
    setBusy(true);
    try {
      await flushEditors();
      if (action === 'copy') {
        const source = await getOrganizableEpisode(episode.id);
        const result = await copyOrganizableEpisode(source);
        await refreshOrganizedWork(qc, episode.series_id, [result.episode]);
        toast(t('longform.copied', { title: episode.title }));
        onCopied?.(result.episode);
      } else {
        const result = await nudgeEpisode(episode.series_id, episode.id, action);
        await refreshOrganizedWork(qc, episode.series_id, result);
        if (result.length) toast(t('longform.reordered'));
      }
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <ActionMenu
        label={t('longform.organize')}
        actions={[
          {
            label: t('longform.copyEpisode'),
            icon: <Copy size={14} />,
            disabled: busy,
            onSelect: () => void run('copy'),
          },
          {
            label: t('longform.moveUp'),
            icon: <ArrowUp size={14} />,
            disabled: busy || !canMoveUp,
            onSelect: () => void run(-1),
          },
          {
            label: t('longform.moveDown'),
            icon: <ArrowDown size={14} />,
            disabled: busy || !canMoveDown,
            onSelect: () => void run(1),
          },
          {
            label: t('longform.variables'),
            icon: <Search size={14} />,
            disabled: busy,
            onSelect: () => {
              void flushEditors()
                .then(() => setVariables(true))
                .catch(toastError);
            },
          },
          ...actions.map((item) => ({ ...item, disabled: busy || item.disabled })),
        ]}
      />
      {variables ? (
        <VariableToolsDialog seriesId={episode.series_id} onClose={() => setVariables(false)} />
      ) : null}
    </>
  );
}
