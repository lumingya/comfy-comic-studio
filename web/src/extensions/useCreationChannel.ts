import { useEffect, useMemo, useRef } from 'react';
import type { ExtensionPanel } from '../api/open';
import { raw } from '../api/client';
import type { CreationContext } from './creationContext';
import { createCreationChannel } from './creationChannel';

export function useCreationChannel(
  session: string,
  panel: ExtensionPanel,
  context: CreationContext | undefined,
  send: (message: unknown) => void,
) {
  const channel = useRef<ReturnType<typeof createCreationChannel> | null>(null);
  const declaration = JSON.stringify(panel);
  const enabled = !!context && !!panel.subscriptions?.length;
  useEffect(() => {
    if (!enabled || !context) return;
    const current = createCreationChannel({
      panel,
      session,
      context,
      send,
      authorize: async (signal) => {
        const response = await raw('/api/extension-panels', { signal });
        const panels = (await response.json()) as ExtensionPanel[];
        return panels.some(
          (entry) =>
            entry.extension === panel.extension &&
            entry.id === panel.id &&
            entry.activation === panel.activation &&
            entry.digest === panel.digest &&
            panel.subscriptions?.every((event) => entry.subscriptions?.includes(event)),
        );
      },
    });
    channel.current = current;
    return () => {
      current.dispose();
      channel.current = null;
    };
  }, [enabled, declaration, session]);
  useEffect(() => {
    if (context) channel.current?.update(context);
  }, [context]);
  return useMemo(
    () => ({
      handle: (message: unknown) => channel.current?.handle(message),
      ready: () => channel.current?.ready(),
      dispose: () => channel.current?.dispose(),
    }),
    [],
  );
}
