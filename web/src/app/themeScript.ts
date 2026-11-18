import { useEffect } from 'react';
import type { ThemeInfo } from '../api/open';

const COLOR_TOKENS = new Set([
  'bg',
  'bg-deep',
  'panel',
  'panel-2',
  'hover',
  'line',
  'line-strong',
  'text',
  'soft',
  'muted',
  'accent',
  'accent-strong',
  'on-accent',
  'tint',
  'amber',
  'red',
  'blue',
  'button-border',
  'button-hover',
  'button-primary',
  'button-primary-text',
  'button-danger',
  'button-active',
  'control-surface',
  'control-border',
  'control-focus',
  'surface-panel',
  'surface-raised',
]);
const SAFE_COLOR =
  /^(?:#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})|transparent|(?:rgb|rgba|hsl|hsla)\([\d.%\s,/-]+\))$/i;
const activeColors = new Map<string, { previous: string; value: string }>();

export function themeScriptKey(theme: ThemeInfo | undefined): string | undefined {
  if (!theme?.script_digest || !/^[a-f0-9]{64}$/.test(theme.script_digest)) return undefined;
  return theme.id + ':' + theme.script_digest;
}

async function matchesDigest(
  source: string,
  expected: string | null | undefined,
): Promise<boolean> {
  if (!expected || !window.crypto?.subtle) return false;
  const bytes = new TextEncoder().encode(source);
  const digest = await window.crypto.subtle.digest('SHA-256', bytes);
  const actual = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return actual === expected;
}

function clearColors() {
  for (const [name, color] of activeColors) {
    const property = `--${name}`;
    if (document.documentElement.style.getPropertyValue(property) !== color.value) continue;
    if (color.previous) document.documentElement.style.setProperty(property, color.previous);
    else document.documentElement.style.removeProperty(property);
  }
  activeColors.clear();
}

function base64(source: string): string {
  const bytes = new TextEncoder().encode(source);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function scriptDocument(source: string): string {
  const workerSource = `const theme=Object.freeze({setColor:(name,value)=>postMessage({type:'set-color',name,value}),resetColors:()=>postMessage({type:'reset-colors'})});\n${source}`;
  const bootstrap = `addEventListener('message',function(event){if(event.source!==parent||event.data?.type!=='mio-theme-connect'||!event.ports[0])return;const port=event.ports[0];port.start();const bytes=Uint8Array.from(atob('${base64(workerSource)}'),c=>c.charCodeAt(0));const worker=new Worker(URL.createObjectURL(new Blob([new TextDecoder().decode(bytes)],{type:'text/javascript'})));worker.onmessage=event=>port.postMessage(event.data);worker.onerror=()=>port.postMessage({type:'script-error'});},{once:true});`;
  const closeScript = '</scr' + 'ipt>';
  return (
    "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; worker-src blob:; connect-src 'none'; img-src 'none'; media-src 'none'; font-src 'none'; style-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'\"><script>" +
    bootstrap +
    closeScript
  );
}

export function useThemeScript(theme: ThemeInfo | undefined, enabled: boolean) {
  const scriptUrl = theme?.script_url;
  const scriptKey = themeScriptKey(theme);
  const expectedDigest = theme?.script_digest;
  useEffect(() => {
    clearColors();
    if (!scriptUrl || !enabled) return clearColors;
    const controller = new AbortController();
    let frame: HTMLIFrameElement | undefined;
    let channel: MessageChannel | undefined;
    let messageWindowStarted = Date.now();
    let messageCount = 0;
    let cancelled = false;
    let watchdog: number | undefined;

    void fetch(scriptUrl, { credentials: 'same-origin', signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Theme script unavailable');
        return response.text();
      })
      .then(async (source) => {
        if (cancelled || source.length > 1024 * 1024) return;
        if (!(await matchesDigest(source, expectedDigest)) || cancelled) return;
        frame = document.createElement('iframe');
        frame.setAttribute('sandbox', 'allow-scripts');
        frame.setAttribute('aria-hidden', 'true');
        frame.setAttribute('title', 'Isolated theme script');
        frame.referrerPolicy = 'no-referrer';
        frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-2px;bottom:0;border:0';
        frame.srcdoc = scriptDocument(source);
        frame.addEventListener(
          'load',
          () => {
            if (cancelled || !frame?.contentWindow) return;
            channel = new MessageChannel();
            channel.port1.onmessage = ({ data }) => {
              if (Date.now() - messageWindowStarted >= 1000) {
                messageWindowStarted = Date.now();
                messageCount = 0;
              }
              if (++messageCount > 30) {
                channel?.port1.close();
                frame?.remove();
                clearColors();
                return;
              }
              if (data?.type === 'reset-colors') {
                clearColors();
                return;
              }
              if (
                data?.type !== 'set-color' ||
                typeof data.name !== 'string' ||
                !COLOR_TOKENS.has(data.name) ||
                typeof data.value !== 'string' ||
                data.value.length > 64 ||
                !SAFE_COLOR.test(data.value) ||
                (typeof CSS !== 'undefined' && !CSS.supports('color', data.value))
              ) {
                return;
              }
              const property = `--${data.name}`;
              const previous =
                activeColors.get(data.name)?.previous ??
                document.documentElement.style.getPropertyValue(property);
              document.documentElement.style.setProperty(property, data.value);
              activeColors.set(data.name, { previous, value: data.value });
            };
            channel.port1.start();
            frame.contentWindow.postMessage({ type: 'mio-theme-connect' }, '*', [channel.port2]);
            watchdog = window.setTimeout(() => {
              channel?.port1.close();
              frame?.remove();
              channel = undefined;
              frame = undefined;
            }, 30_000);
          },
          { once: true },
        );
        document.body.append(frame);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      controller.abort();
      if (watchdog !== undefined) window.clearTimeout(watchdog);
      channel?.port1.close();
      frame?.remove();
      clearColors();
    };
  }, [scriptUrl, scriptKey, expectedDigest, enabled]);
}
