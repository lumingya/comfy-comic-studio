import type { ExtensionPanel } from '../api/open';
import { BRIDGE } from '../api/extensionProtocol';
import type { CreationContext } from './creationContext';

export type CreationEventName = 'creation.context.changed' | 'selection.changed';

/** Host-to-panel metadata only: frames cannot publish business events or address peers. */
export function createCreationChannel(options: {
  panel: ExtensionPanel;
  session: string;
  context: CreationContext;
  send: (message: unknown) => void;
  authorize: (signal: AbortSignal) => Promise<boolean>;
}) {
  const subscriptions = new Set<CreationEventName>();
  const queued = new Set<CreationEventName>();
  let context = options.context;
  let ready = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let checking: AbortController | null = null;
  let windowStart = 0;
  let messages = 0;
  const permitsRead = options.panel.requests?.some(
    (request) => request.method === 'GET' && request.scope === 'read',
  );
  const allowed = new Set<string>(options.panel.subscriptions ?? []);
  const abort = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    checking?.abort();
    checking = null;
    subscriptions.clear();
    queued.clear();
    ready = false;
  };
  const schedule = () => {
    if (disposed || !ready || timer !== null || !queued.size) return;
    timer = setTimeout(() => {
      timer = null;
      const captured = context;
      const events = [...queued];
      queued.clear();
      checking?.abort();
      const controller = new AbortController();
      checking = controller;
      void options
        .authorize(controller.signal)
        .then((authorized) => {
          if (disposed || controller.signal.aborted || captured.context_id !== context.context_id)
            return;
          if (!authorized) {
            abort();
            return;
          }
          for (const event of events) {
            if (!subscriptions.has(event)) continue;
            const message = {
              type: BRIDGE.creation.event,
              version: 1,
              session: options.session,
              activation: options.panel.activation,
              digest: options.panel.digest,
              event,
              context: captured,
            };
            if (
              new TextEncoder().encode(JSON.stringify(message)).byteLength <=
              BRIDGE.creation.maxBytes
            )
              options.send(message);
          }
        })
        .catch(() => {
          /* Failed authorization never becomes a permissive fallback. */
        });
    }, BRIDGE.creation.intervalMs);
  };
  return {
    // Only the document-bound bridge may feed this channel; no global window listener.
    handle(message: unknown) {
      if (disposed) return;
      if (
        !message ||
        typeof message !== 'object' ||
        Array.isArray(message) ||
        !('version' in message) ||
        !('session' in message) ||
        message.session !== options.session
      )
        return;
      if (
        !('type' in message) ||
        !('enabled' in message) ||
        !('event' in message) ||
        message.version !== BRIDGE.creation.version ||
        message.type !== BRIDGE.creation.subscribe ||
        !ready ||
        !permitsRead ||
        !options.panel.activation ||
        !options.panel.digest ||
        typeof message.enabled !== 'boolean' ||
        typeof message.event !== 'string' ||
        !allowed.has(message.event) ||
        !(BRIDGE.creation.events as readonly string[]).includes(message.event) ||
        Object.keys(message).some(
          (key) => !['type', 'version', 'session', 'event', 'enabled'].includes(key),
        )
      )
        return;
      const now = Date.now();
      if (now - windowStart >= 1000) {
        windowStart = now;
        messages = 0;
      }
      if (++messages > 20) return;
      if (message.enabled) {
        subscriptions.add(message.event as CreationEventName);
        queued.add(message.event as CreationEventName);
        schedule();
      } else {
        subscriptions.delete(message.event as CreationEventName);
        queued.delete(message.event as CreationEventName);
      }
    },
    ready() {
      if (!disposed) ready = true;
    },
    update(next: CreationContext) {
      if (disposed || next.seq <= context.seq || next.context_id === context.context_id) return;
      if (
        next.episode_id !== options.context.episode_id ||
        next.series_id !== options.context.series_id
      ) {
        abort();
        return;
      }
      const selectionChanged = JSON.stringify(next.selection) !== JSON.stringify(context.selection);
      context = next;
      if (subscriptions.has('creation.context.changed')) queued.add('creation.context.changed');
      if (selectionChanged && subscriptions.has('selection.changed'))
        queued.add('selection.changed');
      schedule();
    },
    dispose() {
      disposed = true;
      abort();
    },
  };
}
