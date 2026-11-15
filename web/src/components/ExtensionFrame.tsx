import type { ExtensionPanel } from '../api/open';
import { useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { raw } from '../api/client';
import { createPanelBridge, type PanelResult } from './extensionBridge';

/** Panel key used in routes: `<extension>.<panel>`. */
export const panelKey = (p: ExtensionPanel) => `${p.extension}.${p.id}`;

/**
 * An extension's HTML panel. `allow-scripts` without `allow-same-origin` gives it an opaque origin:
 * it cannot read the app's storage or call /api with the page's cookies, and the server's CSP
 * blocks network access. Only the reviewed manifest's requests can cross the message bridge.
 */
export function ExtensionFrame(props: {
  panel: ExtensionPanel;
  params?: Record<string, string>;
  height?: number;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const bridge = useRef<ReturnType<typeof createPanelBridge> | null>(null);
  const qc = useQueryClient();
  const episode = props.params?.episode ?? props.params?.episode_id;
  const series = props.params?.series ?? props.params?.series_id;
  const declaration = JSON.stringify(props.panel);
  const session = useMemo(() => crypto.randomUUID(), [declaration, episode, series]);
  const query = new URLSearchParams({
    ...(episode ? { episode } : {}),
    ...(series ? { series } : {}),
  }).toString();
  useEffect(() => {
    const panel = JSON.parse(declaration) as ExtensionPanel;
    const current = createPanelBridge({
      panel,
      session,
      context: {
        ...(episode ? { episode_id: episode } : {}),
        ...(series ? { series_id: series } : {}),
      },
      frame: () => frame.current?.contentWindow ?? null,
      request: async (body, signal) => {
        const response = await raw(
          `/api/extension-panels/${encodeURIComponent(panel.extension)}/${encodeURIComponent(panel.id)}/requests`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal,
          },
        );
        return (await response.json()) as PanelResult;
      },
      onMutation: () => {
        void qc.invalidateQueries();
      },
    });
    bridge.current = current;
    window.addEventListener('message', current.handle);
    return () => {
      window.removeEventListener('message', current.handle);
      current.dispose();
      bridge.current = null;
    };
  }, [declaration, session, episode, series, qc]);
  return (
    <iframe
      key={session}
      ref={frame}
      className="ext-frame"
      title={props.panel.title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      src={`${props.panel.url}${query ? `?${query}` : ''}#mio-session=${session}`}
      onLoad={() => bridge.current?.abort()}
      style={{ height: props.height ?? 480 }}
    />
  );
}
