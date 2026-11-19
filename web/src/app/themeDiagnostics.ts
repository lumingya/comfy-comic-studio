/**
 * Opt in with sessionStorage.setItem('mio.diagnostics', 'true') and reload.
 * Read window.mioThemeDiagnostics in DevTools. The getter returns frozen snapshots of
 * at most 128 events; it exposes no mutation, script source, resource URLs or user settings.
 * Disabling the flag clears the in-memory history on the next read or diagnostic event.
 */
export const MAX_THEME_DIAGNOSTICS = 128;

const messages = {
  'script-disabled': 'Script execution is disabled by consent or reduced-motion policy.',
  'script-missing-digest': 'The theme does not provide a valid script digest.',
  'crypto-unavailable': 'WebCrypto is unavailable; the script was not executed.',
  'crypto-failed': 'Script integrity verification failed to run.',
  'script-fetch-failed': 'The script could not be retrieved.',
  'script-too-large': 'The script exceeds the 1 MiB source limit.',
  'digest-mismatch': 'The script does not match the reviewed digest and was not executed.',
  'script-started': 'The isolated script session started.',
  'script-start-failed': 'The isolated script session could not be started.',
  'script-error': 'The isolated script reported an execution error.',
  'script-timeout': 'The isolated script reached its 30 second execution limit.',
  'script-rate-limited': 'The script exceeded 30 messages in one second and was stopped.',
  'script-cleaned': 'The script session was released and its owned colors were restored.',
  'style-loading': 'The theme stylesheet is loading.',
  'style-loaded': 'The theme stylesheet loaded.',
  'style-load-error': 'The theme stylesheet failed to load.',
  'style-cleaned': 'The theme stylesheet was removed.',
} as const;

export type ThemeDiagnosticCode = keyof typeof messages;
export type ThemeDiagnostic = Readonly<{
  theme_id: string;
  digest: string | null;
  component: 'script' | 'stylesheet';
  session: number;
  code: ThemeDiagnosticCode;
  message: string;
  at: number;
}>;

const history: ThemeDiagnostic[] = [];
let nextSession = 0;

function enabled(): boolean {
  try {
    if (
      typeof window !== 'undefined' &&
      window.sessionStorage.getItem('mio.diagnostics') === 'true'
    )
      return true;
  } catch {
    // Unavailable storage cannot silently opt in to diagnostic collection.
  }
  history.length = 0;
  return false;
}

export function readThemeDiagnostics(): readonly ThemeDiagnostic[] {
  return Object.freeze(enabled() ? [...history] : []);
}

export function themeDiagnosticSession(
  component: ThemeDiagnostic['component'],
  themeId: string,
  digest?: string | null,
): (code: ThemeDiagnosticCode) => void {
  const session = ++nextSession;
  const identity = /^[a-z0-9][a-z0-9_-]{1,47}$/.test(themeId) ? themeId : '[invalid]';
  const reviewedDigest = digest && /^[a-f0-9]{64}$/.test(digest) ? digest : null;
  return (code) => {
    if (!enabled()) return;
    history.push(
      Object.freeze({
        theme_id: identity,
        digest: reviewedDigest,
        component,
        session,
        code,
        message: messages[code],
        at: Date.now(),
      }),
    );
    if (history.length > MAX_THEME_DIAGNOSTICS)
      history.splice(0, history.length - MAX_THEME_DIAGNOSTICS);
  };
}

declare global {
  interface Window {
    readonly mioThemeDiagnostics: readonly ThemeDiagnostic[];
  }
}

if (
  typeof window !== 'undefined' &&
  !Object.getOwnPropertyDescriptor(window, 'mioThemeDiagnostics')
) {
  Object.defineProperty(window, 'mioThemeDiagnostics', {
    configurable: false,
    enumerable: false,
    get: readThemeDiagnostics,
  });
}
