import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ThemeInfo } from '../api/open';
import { readThemeDiagnostics } from './themeDiagnostics';
import { useThemeScript } from './themeScript';

const theme: ThemeInfo = {
  id: 'my-theme',
  name: 'Theme',
  mode: 'dark',
  source: 'theme-package',
  author: '',
  tokens: {},
  script_url: '/api/themes/my-theme/script',
  script_digest: 'a'.repeat(64),
};

function Script({ selected = theme, enabled = true }: { selected?: ThemeInfo; enabled?: boolean }) {
  useThemeScript(selected, enabled);
  return null;
}
type Port = {
  onmessage: ((event: MessageEvent) => void) | null;
  start: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};
const channels: { port1: Port; port2: { close: ReturnType<typeof vi.fn> } }[] = [];

beforeEach(() => {
  sessionStorage.removeItem('mio.diagnostics');
  readThemeDiagnostics();
  sessionStorage.setItem('mio.diagnostics', 'true');
  channels.length = 0;
  vi.stubGlobal('crypto', {
    subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array(32).fill(0xaa).buffer) },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => new Response('theme.setColor("accent", "#123456")')),
  );
  vi.stubGlobal('CSS', { supports: () => true });
  vi.stubGlobal(
    'MessageChannel',
    class {
      port1: Port = { onmessage: null, start: vi.fn(), close: vi.fn() };
      port2 = { close: vi.fn() };
      constructor() {
        channels.push(this);
      }
    },
  );
});
afterEach(() => {
  cleanup();
  sessionStorage.removeItem('mio.diagnostics');
  readThemeDiagnostics();
  document.documentElement.style.removeProperty('--accent');
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function codes() {
  return readThemeDiagnostics().map((entry) => entry.code);
}
async function ready() {
  const view = render(<Script />);
  await waitFor(() =>
    expect(document.querySelector('iframe[title="Isolated theme script"]')).not.toBeNull(),
  );
  const frame = document.querySelector<HTMLIFrameElement>('iframe[title="Isolated theme script"]')!;
  vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined);
  fireEvent.load(frame);
  return { ...view, frame, port: channels[0].port1 };
}
function message(port: Port, data: unknown) {
  act(() => port.onmessage?.({ data } as MessageEvent));
}

it('does not expose any runtime records while diagnostics are disabled', async () => {
  sessionStorage.removeItem('mio.diagnostics');
  const view = await ready();
  message(view.port, { type: 'script-error', message: 'never log this' });
  view.unmount();
  expect(window.mioThemeDiagnostics).toEqual([]);
});

it.each(['disabled', 'digest', 'crypto'] as const)(
  'explains %s execution without fetching or creating a runtime',
  async (reason) => {
    if (reason === 'crypto') vi.stubGlobal('crypto', {});
    render(
      <Script
        enabled={reason !== 'disabled'}
        selected={reason === 'digest' ? { ...theme, script_digest: null } : theme}
      />,
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(document.querySelector('iframe')).toBeNull();
    expect(codes()).toEqual([
      reason === 'disabled'
        ? 'script-disabled'
        : reason === 'digest'
          ? 'script-missing-digest'
          : 'crypto-unavailable',
    ]);
  },
);

it('reports a digest mismatch without executing the returned source', async () => {
  vi.stubGlobal('crypto', {
    subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array(32).fill(0xbb).buffer) },
  });
  render(<Script />);
  await waitFor(() => expect(codes()).toContain('digest-mismatch'));
  expect(document.querySelector('iframe')).toBeNull();
});

it.each(['network', 'status', 'size', 'crypto'] as const)(
  'reports a %s failure without logging source or exception text',
  async (reason) => {
    const secret = 'private-script-or-credential';
    if (reason === 'network') vi.mocked(fetch).mockRejectedValue(new Error(secret));
    if (reason === 'status')
      vi.mocked(fetch).mockResolvedValue(new Response(secret, { status: 500 }));
    if (reason === 'size')
      vi.mocked(fetch).mockResolvedValue(new Response('x'.repeat(1024 * 1024 + 1)));
    if (reason === 'crypto')
      vi.stubGlobal('crypto', { subtle: { digest: vi.fn().mockRejectedValue(new Error(secret)) } });
    render(<Script />);
    const expected =
      reason === 'size'
        ? 'script-too-large'
        : reason === 'crypto'
          ? 'crypto-failed'
          : 'script-fetch-failed';
    await waitFor(() => expect(codes()).toContain(expected));
    expect(JSON.stringify(readThemeDiagnostics())).not.toContain(secret);
    expect(document.querySelector('iframe')).toBeNull();
  },
);

it('records the execution timeout and releases the frame, ports and colors on cleanup', async () => {
  document.documentElement.style.setProperty('--accent', '#abcdef');
  vi.useFakeTimers();
  const view = render(<Script />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  const frame = document.querySelector<HTMLIFrameElement>('iframe')!;
  expect(frame).not.toBeNull();
  vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined);
  fireEvent.load(frame);
  const port = channels[0].port1;
  message(port, { type: 'set-color', name: 'accent', value: '#123456' });
  expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#123456');
  act(() => vi.advanceTimersByTime(30_000));
  expect(codes()).toEqual(['script-started', 'script-timeout']);
  expect(frame).not.toBeInTheDocument();
  expect(port.close).toHaveBeenCalledTimes(1);
  expect(channels[0].port2.close).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#abcdef');
  expect(codes()).toEqual(['script-started', 'script-timeout', 'script-cleaned']);
  act(() => vi.advanceTimersByTime(30_000));
  expect(codes()).toHaveLength(3);
});

it.each(['error', 'rate'] as const)(
  'reports a runtime %s and ignores messages after its lifecycle ends',
  async (reason) => {
    const view = await ready();
    message(view.port, { type: 'set-color', name: 'accent', value: '#123456' });
    if (reason === 'error')
      message(view.port, { type: 'script-error', stack: 'must not log this' });
    else for (let index = 0; index < 30; index += 1) message(view.port, { type: 'reset-colors' });
    expect(codes()).toContain(reason === 'error' ? 'script-error' : 'script-rate-limited');
    if (reason === 'rate') expect(view.frame).not.toBeInTheDocument();
    else view.unmount();
    message(view.port, { type: 'set-color', name: 'accent', value: '#654321' });
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('');
    expect(JSON.stringify(readThemeDiagnostics())).not.toContain('must not log this');
  },
);

it('aborts a pending fetch and prevents its late response from creating a new script session', async () => {
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<Script />);
  const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
  view.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => finish(new Response('late source')));
  expect(codes()).toEqual(['script-cleaned']);
  expect(document.querySelector('iframe')).toBeNull();
});

it('keeps diagnostic sessions separate when a script digest changes under the same theme id', async () => {
  const view = await ready();
  view.rerender(<Script selected={{ ...theme, script_digest: 'b'.repeat(64) }} />);
  await waitFor(() => expect(codes()).toContain('digest-mismatch'));
  const records = readThemeDiagnostics();
  expect(records[0].session).toBe(records[1].session);
  expect(records[0].session).not.toBe(records[2].session);
  expect(records.map((record) => record.digest)).toEqual([
    'a'.repeat(64),
    'a'.repeat(64),
    'b'.repeat(64),
  ]);
});
