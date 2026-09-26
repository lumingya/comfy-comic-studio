import type { ExtensionPanel } from '../api/open';

/** Panel key used in routes: `<extension>.<panel>`. */
export const panelKey = (p: ExtensionPanel) => `${p.extension}.${p.id}`;

/**
 * An extension's HTML panel. `allow-scripts` without `allow-same-origin` gives it an opaque origin:
 * it cannot read the app's storage or call /api with the page's cookies, and the server's CSP
 * blocks network access. Context (e.g. the episode id) is passed in the query string.
 */
export function ExtensionFrame(props: {
  panel: ExtensionPanel;
  params?: Record<string, string>;
  height?: number;
}) {
  const query = new URLSearchParams(props.params ?? {}).toString();
  return (
    <iframe
      className="ext-frame"
      title={props.panel.title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      src={query ? `${props.panel.url}?${query}` : props.panel.url}
      style={{ height: props.height ?? 480 }}
    />
  );
}
