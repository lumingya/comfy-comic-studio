import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useComfyHealth } from '../app/comfy';
import { configInstance } from '../test/configuration';
import { mockFetch } from '../test/utils';
import { useVersionStatus } from './update';

function mount<T>(hook: () => T) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 10_000, refetchOnWindowFocus: false },
    },
  });
  const view = renderHook(hook, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  return { client, ...view };
}

async function advance(time: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(time);
  });
}

async function regainFocus() {
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await vi.advanceTimersByTimeAsync(5);
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  focusManager.setFocused(undefined);
});

it('reads a connection snapshot without polling until the creator returns to the app', async () => {
  vi.useFakeTimers();
  let online = false;
  const calls = mockFetch({
    'GET /api/instances': { instances: [configInstance] },
    [`GET /api/instances/${configInstance.id}/health`]: () => ({ ok: online, stats: {} }),
  });
  const view = mount(() => useComfyHealth());
  const probes = () => calls.filter((call) => call.url.endsWith('/health'));

  await advance(500);
  expect(view.result.current.state).toBe('offline');
  expect(probes()).toHaveLength(1);
  online = true;
  await advance(60_000);
  expect(probes()).toHaveLength(1);
  await regainFocus();
  expect(probes()).toHaveLength(2);
  expect(view.result.current.state).toBe('online');
  view.unmount();
  view.client.clear();
});

it('polls for update progress only while an update is active', async () => {
  vi.useFakeTimers();
  let phase = 'downloading';
  const calls = mockFetch({ 'GET /api/update': () => ({ activity: { phase, error: '' } }) });
  const view = mount(useVersionStatus);

  await advance(500);
  expect(view.result.current.data?.activity.phase).toBe('downloading');
  expect(calls).toHaveLength(1);
  phase = 'idle';
  await advance(900);
  expect(view.result.current.data?.activity.phase).toBe('idle');
  expect(calls).toHaveLength(2);
  await advance(30_000);
  expect(calls).toHaveLength(2);
  await regainFocus();
  expect(calls).toHaveLength(3);
  view.unmount();
  view.client.clear();
});
