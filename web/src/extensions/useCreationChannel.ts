import { useEffect, useRef, type RefObject } from 'react';
import type { ExtensionPanel } from '../api/open';
import { raw } from '../api/client';
import type { CreationContext } from './creationContext';
import { createCreationChannel } from './creationChannel';

export function useCreationChannel(
  frame: RefObject<HTMLIFrameElement | null>,
  session: string,
  panel: ExtensionPanel,
  context: CreationContext | undefined,
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
      frame: () => frame.current?.contentWindow ?? null,
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
    window.addEventListener('message', current.handle);
    return () => {
      window.removeEventListener('message', current.handle);
      current.dispose();
      channel.current = null;
    };
  }, [enabled, declaration, session]);
  useEffect(() => {
    if (context) channel.current?.update(context);
  }, [context]);
  return () => channel.current?.navigated();
}
