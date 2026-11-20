import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useEffect } from 'react';
import { create } from 'zustand';
import { raw } from '../api/client';
import { useExtensionPanels } from '../api/open';
import { useNavigate } from 'react-router-dom';
import type { components } from '../api/schema';
import { Icon } from '../app/icons';
import { ExtensionFrame, panelKey } from '../components/ExtensionFrame';
import type { ContextGroup } from '../components/ContextMenu';
import { toastError } from '../components/toast';
import { ActionMenu, Modal } from '../components/ui';
import {
  captureCreationSelection,
  getCreationContext,
  useCreationContext,
  type CreationContext,
} from './creationContext';

type Entry = components['schemas']['HostSlotEntry'];
export type HostSlot = Entry['slot'];
type Opened = {
  entry: Entry;
  series: string | null;
  episode: string;
  sourceId: string;
  context: CreationContext;
};
const useOpened = create<{ value: Opened | null; set: (value: Opened | null) => void }>((set) => ({
  value: null,
  set: (value) => set({ value }),
}));
const queryKey = ['extensions', 'host-slots'] as const;
let openSequence = 0;
const readSlots = async () => (await raw('/api/extension-host-slots')).json() as Promise<Entry[]>;

export function slotApplies(slot: HostSlot, context: CreationContext): boolean {
  return (
    !!context.episode_id && (slot !== 'inspector.panel' || context.selection.kind === 'panels')
  );
}

/** Only reviewed declarations become native host buttons; the action opens an opaque panel. */
export function useHostSlotActions(slot: HostSlot, targetIds?: readonly string[]) {
  const context = useCreationContext();
  const catalog = useQuery({
    queryKey,
    queryFn: readSlots,
    retry: false,
    staleTime: 30_000,
    enabled: !!context.episode_id,
  });
  const qc = useQueryClient();
  const { t } = useTranslation();
  const open = useOpened((state) => state.set);
  return (catalog.data ?? [])
    .filter((entry) => entry.slot === slot && slotApplies(slot, context))
    .map((entry) => ({
      id: `${entry.extension}.${entry.id}`,
      title: entry.title,
      icon: entry.icon ?? 'eye',
      run: () => {
        const sequence = ++openSequence;
        const captured = targetIds ? captureCreationSelection(context, targetIds) : context;
        void (async () => {
          if (getCreationContext().context_id !== context.context_id)
            throw new Error(t('interaction.contextStale'));
          const current = await readSlots();
          if (sequence !== openSequence) return;
          qc.setQueryData(queryKey, current);
          const found = current.find(
            (item) =>
              item.extension === entry.extension &&
              item.id === entry.id &&
              item.panel.activation === entry.panel.activation &&
              item.panel.digest === entry.panel.digest,
          );
          if (!found || getCreationContext().context_id !== context.context_id)
            throw new Error(t('interaction.contextStale'));
          open({
            entry: found,
            series: context.series_id,
            episode: context.episode_id!,
            sourceId: context.context_id,
            context: captured,
          });
        })().catch(toastError);
      },
    }));
}

export function useHostSlotMenu(targetIds?: readonly string[]): ContextGroup {
  return {
    items: useHostSlotActions('context_menu.episode', targetIds).map((action) => ({
      label: action.title,
      icon: <Icon name={action.icon} sm />,
      onSelect: action.run,
    })),
  };
}

export function HostSlotButtons() {
  const actions = useHostSlotActions('inspector.panel');
  return actions.length ? (
    <div className="col" style={{ gap: 6 }}>
      {actions.map((action) => (
        <button key={action.id} className="btn ghost" onClick={action.run}>
          <Icon name={action.icon} />
          {action.title}
        </button>
      ))}
    </div>
  ) : null;
}

/** All enabled episode panels remain discoverable without a fixed professional-tool entry. */
export function EpisodeExtensionMenu({ episodeId }: { episodeId: string }) {
  const panels = useExtensionPanels('episode');
  const navigate = useNavigate();
  const { t } = useTranslation();
  if (!panels.data?.length) return null;
  return (
    <div data-episode-extension-menu>
      <ActionMenu
        label={t('settings.tabs.extensions')}
        actions={panels.data.map((panel) => ({
          label: panel.title,
          icon: <Icon name="nodes" sm />,
          onSelect: () => navigate(`/workshop/assembly/${episodeId}/ext/${panelKey(panel)}`),
        }))}
      />
    </div>
  );
}

/** Kept outside transient menus so closing the invoking menu does not destroy the new panel. */
export function HostSlotDialog() {
  const { value, set } = useOpened();
  const context = useCreationContext();
  const slots = useQuery({
    queryKey,
    queryFn: readSlots,
    retry: false,
    staleTime: 30_000,
    enabled: !!value,
  });
  const stale =
    !!value &&
    (context.episode_id !== value.episode ||
      context.series_id !== value.series ||
      (!!slots.data &&
        !slots.data.some(
          (entry) =>
            entry.extension === value.entry.extension &&
            entry.id === value.entry.id &&
            entry.panel.activation === value.entry.panel.activation &&
            entry.panel.digest === value.entry.panel.digest,
        )));
  useEffect(() => {
    if (stale) set(null);
  }, [stale, set]);
  if (
    !value ||
    context.episode_id !== value.episode ||
    context.series_id !== value.series ||
    !slots.data?.some(
      (entry) =>
        entry.extension === value.entry.extension &&
        entry.id === value.entry.id &&
        entry.panel.activation === value.entry.panel.activation &&
        entry.panel.digest === value.entry.panel.digest,
    )
  )
    return null;
  return (
    <Modal open title={value.entry.title} size="lg" onOpenChange={(open) => !open && set(null)}>
      <ExtensionFrame
        panel={value.entry.panel}
        params={{ episode: value.episode, ...(value.series ? { series: value.series } : {}) }}
        creationContext={context.context_id === value.sourceId ? value.context : context}
        height={560}
      />
    </Modal>
  );
}
