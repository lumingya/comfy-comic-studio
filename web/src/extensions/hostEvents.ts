import { useCallback, useEffect, useRef } from 'react';
import { BRIDGE, type WorkspaceKeyEvent } from '../api/extensionProtocol';
import { dispatchByPriority, type ExtensionEventDecision } from './eventPipeline';
import {
  postWorkspace,
  subscriptionKey,
  type WorkspaceEventSubscription,
  type WorkspaceEventCallbacks,
} from './hostSurfaces';

/** One keyboard pipeline owns pending decisions and drops stale surface sessions. */
export function useWorkspaceEvents() {
  const subscribers = useRef(new Map<string, WorkspaceEventSubscription>());
  const pendingEvents = useRef(
    new Map<
      string,
      {
        subscription: WorkspaceEventSubscription;
        finish: (decision: ExtensionEventDecision) => void;
      }
    >(),
  );
  const onSubscribe = useCallback<NonNullable<WorkspaceEventCallbacks['onSubscribe']>>(
    (subscription, enabled) => {
      const key = subscriptionKey(subscription);
      if (enabled) subscribers.current.set(key, subscription);
      else {
        const current = subscribers.current.get(key);
        if (current?.frame === subscription.frame && current.session === subscription.session)
          subscribers.current.delete(key);
        for (const pending of pendingEvents.current.values()) {
          if (
            pending.subscription.frame === subscription.frame &&
            pending.subscription.session === subscription.session
          )
            pending.finish('continue');
        }
      }
    },
    [],
  );
  const onEventResult = useCallback<NonNullable<WorkspaceEventCallbacks['onEventResult']>>(
    (eventId, decision, frame, session) => {
      const pending = pendingEvents.current.get(eventId);
      if (pending?.subscription.frame === frame && pending.subscription.session === session)
        pending.finish(decision);
    },
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented) return;
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        ['Digit0', 'Numpad0'].includes(event.code)
      )
        return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')
      )
        return;
      const payload: WorkspaceKeyEvent = {
        type: 'keydown',
        key: event.key,
        code: event.code,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        repeat: event.repeat,
      };
      const listeners = [...subscribers.current.values()].filter(
        (subscription) => subscription.event === 'keydown',
      );
      void dispatchByPriority(
        listeners,
        (subscription) => subscription.surface.priority ?? 0,
        (subscription) => {
          const current = subscribers.current.get(subscriptionKey(subscription));
          if (current?.frame !== subscription.frame || current.session !== subscription.session)
            return Promise.resolve('continue');
          const eventId = crypto.randomUUID();
          return new Promise<ExtensionEventDecision>((resolve) => {
            const timeout = window.setTimeout(() => {
              pendingEvents.current.delete(eventId);
              resolve('continue');
            }, BRIDGE.workspace.eventTimeoutMs);
            pendingEvents.current.set(eventId, {
              subscription,
              finish: (decision) => {
                window.clearTimeout(timeout);
                pendingEvents.current.delete(eventId);
                resolve(decision);
              },
            });
            postWorkspace(subscription.frame, {
              type: BRIDGE.workspace.types.event,
              eventId,
              session: subscription.session,
              event: payload,
            });
          });
        },
      );
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      for (const pending of pendingEvents.current.values()) pending.finish('continue');
      pendingEvents.current.clear();
      subscribers.current.clear();
    };
  }, []);
  return { onSubscribe, onEventResult };
}
