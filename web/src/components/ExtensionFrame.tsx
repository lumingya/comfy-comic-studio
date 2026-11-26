import type { ExtensionPanel } from '../api/open';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { raw } from '../api/client';
import { createPanelBridge, type PanelResult } from './extensionBridge';
import { readPanelBinary, type PanelDownload } from './extensionMedia';
import type { CreationContext } from '../extensions/creationContext';
import { useCreationChannel } from '../extensions/useCreationChannel';
import { BRIDGE } from '../api/extensionProtocol';
import type { PanelAppearance } from './extensionBridge';

function currentAppearance(): PanelAppearance {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const tokens = Object.fromEntries(
    BRIDGE.colorTokens.flatMap((token) => {
      const value = style.getPropertyValue(`--${token}`).trim();
      return value ? [[token, value]] : [];
    }),
  );
  const theme = root.dataset.theme;
  return {
    tokens,
    theme: theme === 'dark' || theme === 'light' ? theme : null,
    locale: root.lang || 'zh-CN',
  };
}

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
  creationContext?: CreationContext;
}) {
  const { t } = useTranslation();
  const frame = useRef<HTMLIFrameElement>(null);
  const bridge = useRef<ReturnType<typeof createPanelBridge> | null>(null);
  const qc = useQueryClient();
  const [download, setDownload] = useState<{ session: string; value: PanelDownload } | null>(null);
  const episode = props.params?.episode ?? props.params?.episode_id;
  const series = props.params?.series ?? props.params?.series_id;
  const declaration = JSON.stringify(props.panel);
  const session = useMemo(() => crypto.randomUUID(), [declaration, episode, series]);
  const documentLoads = useRef({ session, loaded: false, revoked: false });
  if (documentLoads.current.session !== session)
    documentLoads.current = { session, loaded: false, revoked: false };
  const query = new URLSearchParams({
    ...(episode ? { episode } : {}),
    ...(series ? { series } : {}),
  }).toString();
  const creation = useCreationChannel(session, props.panel, props.creationContext, (message) =>
    bridge.current?.postMessage(message),
  );
  useEffect(() => {
    const panel = JSON.parse(declaration) as ExtensionPanel;
    const send = (body: unknown, signal: AbortSignal) =>
      raw(
        `/api/extension-panels/${encodeURIComponent(panel.extension)}/${encodeURIComponent(panel.id)}/requests`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        },
      );
    const current = createPanelBridge({
      panel,
      session,
      context: {
        ...(episode ? { episode_id: episode } : {}),
        ...(series ? { series_id: series } : {}),
      },
      appearance: currentAppearance(),
      frame: () => frame.current?.contentWindow ?? null,
      request: async (body, signal) => {
        const response = await send(body, signal);
        return (await response.json()) as PanelResult;
      },
      binaryRequest: async (body, kind, signal) =>
        readPanelBinary(await send(body, signal), kind, signal),
      uploadRequest: async (body, blob, signal) => {
        const form = new FormData();
        form.append(
          'metadata',
          new Blob([JSON.stringify(body)], { type: 'application/json' }),
          'metadata.json',
        );
        form.append('image', blob, body.filename);
        const response = await raw(
          `/api/extension-panels/${encodeURIComponent(panel.extension)}/${encodeURIComponent(panel.id)}/uploads`,
          { method: 'POST', body: form, signal },
        );
        return (await response.json()) as PanelResult;
      },
      onDownloadChange: (value) => setDownload(value ? { session, value } : null),
      onMutation: () => {
        void qc.invalidateQueries();
      },
      onReady: creation.ready,
      onMessage: creation.handle,
      onDispose: creation.dispose,
    });
    bridge.current = current;
    window.addEventListener('message', current.handle);
    const appearanceObserver = new MutationObserver(() => {
      current.updateAppearance(currentAppearance());
    });
    appearanceObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'data-theme', 'lang'],
    });
    return () => {
      appearanceObserver.disconnect();
      window.removeEventListener('message', current.handle);
      current.dispose();
      bridge.current = null;
    };
  }, [declaration, session, episode, series, qc, creation]);
  return (
    <>
      {download?.session === session ? (
        <div className="row" role="status" style={{ minWidth: 0, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => bridge.current?.saveDownload()}>
            {t('common.download')}
          </button>
          <span className="grow small" style={{ overflowWrap: 'anywhere', minWidth: 0 }}>
            {download.value.filename}
          </span>
          <button className="btn ghost" onClick={() => bridge.current?.clearDownload()}>
            {t('common.cancel')}
          </button>
        </div>
      ) : null}
      <iframe
        key={session}
        ref={frame}
        className="ext-frame"
        title={props.panel.title}
        sandbox="allow-scripts"
        allow="fullscreen"
        referrerPolicy="no-referrer"
        src={`${props.panel.url}${query ? `?${query}` : ''}#mio-session=${session}`}
        onLoad={() => {
          const loads = documentLoads.current;
          if (loads.session !== session || loads.revoked) return;
          if (loads.loaded) {
            // A panel may not hand its opaque-origin message channel to a document it navigates to.
            loads.revoked = true;
            bridge.current?.dispose();
            bridge.current = null;
            frame.current?.setAttribute('src', 'about:blank');
            return;
          }
          loads.loaded = true;
        }}
        style={{ height: props.height ?? 480 }}
      />
    </>
  );
}
