import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  BRIDGE,
  type WorkspaceToFrame,
  type WorkspaceFromFrame,
  type SurfaceLifecycle,
} from '../api/extensionProtocol';
import {
  isRecord,
  postWorkspace,
  type WorkspaceSurface,
  type WorkspaceEventCallbacks,
} from './hostSurfaces';

/** Reviewed application extensions run their own built assets; the host never imports their code. */
export function WorkspaceFrame({
  surface,
  floating,
  clickThrough = false,
  position,
  onResize,
  onClickThrough,
  onSubscribe,
  onEventResult,
  active = true,
  focused = false,
}: {
  surface: WorkspaceSurface;
  floating: boolean;
  clickThrough?: boolean;
  position?: { x: number; y: number };
  onResize?: (width: number, height: number) => void;
  onClickThrough?: (enabled: boolean) => void;
  focused?: boolean;
} & WorkspaceEventCallbacks) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [session] = useState(() => crypto.randomUUID());
  const subscriptions = useRef(new Set<'keydown'>());
  const qc = useQueryClient();
  const navigate = useNavigate();
  const latest = useRef({
    surface,
    floating,
    onResize,
    onClickThrough,
    onSubscribe,
    onEventResult,
    active,
    navigate,
  });
  latest.current = {
    surface,
    floating,
    onResize,
    onClickThrough,
    onSubscribe,
    onEventResult,
    active,
    navigate,
  };
  const context = (): Extract<
    WorkspaceToFrame,
    { type: typeof BRIDGE.workspace.types.context }
  > => {
    const style = getComputedStyle(document.documentElement);
    const tokens = Object.fromEntries(
      Array.from({ length: style.length }, (_, index) => style.item(index))
        .filter((key) => key.startsWith('--'))
        .map((key) => [key, style.getPropertyValue(key)]),
    );
    return {
      type: BRIDGE.workspace.types.context,
      session,
      tokens,
      theme: document.documentElement.dataset.theme,
      locale: document.documentElement.lang || 'zh-CN',
      floating: latest.current.floating,
    };
  };
  useEffect(() => {
    const ownedFrame = frame.current;
    const send = () => postWorkspace(frame.current, context());
    const listener = (event: MessageEvent) => {
      const value: unknown = event.data;
      if (
        event.origin !== location.origin ||
        event.source !== frame.current?.contentWindow ||
        !isRecord(value) ||
        value.session !== session
      )
        return;
      const message = value as WorkspaceFromFrame;
      if (message.type === BRIDGE.workspace.types.ready) send();
      if (message.type === BRIDGE.workspace.types.changed) void qc.invalidateQueries();
      if (
        message.type === BRIDGE.workspace.types.resize &&
        Number.isFinite(message.width) &&
        Number.isFinite(message.height)
      )
        latest.current.onResize?.(
          Math.max(240, Math.min(1200, Math.round(message.width))),
          Math.max(200, Math.min(1000, Math.round(message.height))),
        );
      if (
        message.type === BRIDGE.workspace.types.clickThrough &&
        typeof message.enabled === 'boolean'
      )
        latest.current.onClickThrough?.(message.enabled);
      if (
        message.type === BRIDGE.workspace.types.listen &&
        message.event === 'keydown' &&
        typeof message.enabled === 'boolean'
      ) {
        if (message.enabled) subscriptions.current.add('keydown');
        else subscriptions.current.delete('keydown');
        const currentFrame = frame.current;
        if (currentFrame)
          latest.current.onSubscribe?.(
            { surface: latest.current.surface, frame: currentFrame, session, event: 'keydown' },
            message.enabled && latest.current.active,
          );
      }
      if (
        message.type === BRIDGE.workspace.types.eventResult &&
        typeof message.eventId === 'string'
      ) {
        const decision = message.action;
        if (frame.current)
          latest.current.onEventResult?.(
            message.eventId,
            decision === 'handled' || decision === 'stop_propagation' ? decision : 'continue',
            frame.current,
            session,
          );
      }
      if (
        message.type === BRIDGE.workspace.types.navigate &&
        [
          '/',
          `/extensions/${latest.current.surface.extension_id}`,
          '/extensions?tab=installed',
          '/settings?tab=extensions',
        ].includes(message.path)
      )
        latest.current.navigate(message.path);
    };
    const observer = new MutationObserver(send);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'data-theme', 'lang', 'data-font-scale', 'data-density'],
    });
    window.addEventListener('message', listener);
    return () => {
      observer.disconnect();
      window.removeEventListener('message', listener);
      if (ownedFrame)
        for (const event of subscriptions.current)
          latest.current.onSubscribe?.(
            { surface: latest.current.surface, frame: ownedFrame, session, event },
            false,
          );
      subscriptions.current.clear();
    };
  }, [qc, session]);
  useEffect(() => {
    const currentFrame = frame.current;
    if (!currentFrame || !onSubscribe) return;
    for (const event of subscriptions.current)
      onSubscribe({ surface: latest.current.surface, frame: currentFrame, session, event }, active);
    return () => {
      for (const event of subscriptions.current)
        onSubscribe(
          { surface: latest.current.surface, frame: currentFrame, session, event },
          false,
        );
    };
  }, [active, onSubscribe, session]);
  const visibility = useRef<boolean | undefined>(undefined);
  const focus = useRef(false);
  const notifyLifecycle = () => {
    const send = (state: SurfaceLifecycle) =>
      postWorkspace(frame.current, { type: BRIDGE.workspace.types.lifecycle, session, state });
    if (focus.current && (!active || !focused)) {
      send('blurred');
      focus.current = false;
    }
    if (visibility.current !== active) {
      send(active ? 'shown' : 'hidden');
      visibility.current = active;
    }
    if (active && focused && !focus.current) {
      send('focused');
      focus.current = true;
    }
  };
  useEffect(notifyLifecycle, [active, focused, session]);
  useEffect(() => {
    if (!position) return;
    postWorkspace(frame.current, { type: BRIDGE.workspace.types.moved, session, position });
  }, [position, session]);
  return (
    <iframe
      ref={frame}
      className="workspace-extension-frame"
      title={surface.title}
      sandbox="allow-scripts allow-same-origin allow-downloads"
      referrerPolicy="no-referrer"
      src={`${surface.url}#mio-session=${session}&floating=${floating ? '1' : '0'}`}
      style={{ pointerEvents: clickThrough ? 'none' : undefined }}
      onLoad={() => {
        const currentFrame = frame.current;
        if (currentFrame)
          for (const event of subscriptions.current)
            latest.current.onSubscribe?.(
              { surface: latest.current.surface, frame: currentFrame, session, event },
              false,
            );
        subscriptions.current.clear();
        visibility.current = undefined;
        focus.current = false;
        postWorkspace(currentFrame, context());
        notifyLifecycle();
      }}
    />
  );
}
