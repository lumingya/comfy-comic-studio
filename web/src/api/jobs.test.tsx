import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useJobEvents, useLive } from './jobs';
import { keys } from './keys';

class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  close = vi.fn(() => this.onclose?.());
  constructor() {
    FakeSocket.all.push(this);
  }
  emit(type: string, idx: number | null = null, data: Record<string, unknown> = {}) {
    this.onmessage?.({ data: JSON.stringify({ type, job_id: 'job_1', idx, data }) });
  }
}

const roots = {
  jobs: keys.jobs(),
  job: keys.job('job_1'),
  episode: keys.episode('ep_1'),
  episodes: keys.episodes('series_1'),
  series: keys.series('series_1'),
  queue: keys.queue,
};
const cleanups: (() => void)[] = [];

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
  });
  const server: Record<string, unknown> = Object.fromEntries(
    Object.keys(roots).map((root) => [root, 'before']),
  );
  const fetches = Object.fromEntries(
    Object.entries(roots).map(([root, key]) => {
      const fetch = vi.fn(async () => server[root]);
      const observer = new QueryObserver(client, {
        queryKey: key,
        queryFn: fetch,
        initialData: 'before',
      });
      cleanups.push(observer.subscribe(() => undefined));
      return [root, fetch];
    }),
  );
  client.setQueryData(['settings'], 'unrelated');
  const hook = renderHook(() => useJobEvents(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  cleanups.push(() => client.clear(), hook.unmount);
  return { client, server, fetches, ...hook };
}

async function run(action: () => void, elapsed = 0) {
  await act(async () => {
    action();
    await vi.advanceTimersByTimeAsync(elapsed);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
});
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((cleanup) => cleanup());
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('job events recovery', () => {
  it('fills the initial subscription gap and reconnects candidates, adopted images and new jobs', async () => {
    const { client, server, fetches } = mount();
    const first = FakeSocket.all[0];
    server.jobs = ['job_1'];
    await run(() => first.onopen?.());
    expect(client.getQueryData(keys.jobs())).toEqual(['job_1']);
    await run(() => first.close());

    // These changes occur without any event reaching this browser.
    server.jobs = ['job_1', 'job_2'];
    server.job = { state: 'completed' };
    server.episode = { takes: [{ id: 'take_new', status: 'adopted', asset_id: 'new_image' }] };
    server.episodes = [{ id: 'ep_1', revision: 2 }];
    server.series = { cover_asset_id: 'new_image' };
    server.queue = ['album_2'];
    await run(() => undefined, 2000);
    expect(FakeSocket.all).toHaveLength(2);
    await run(() => FakeSocket.all[1].onopen?.());
    for (const [root, key] of Object.entries(roots)) {
      expect(client.getQueryData(key)).toEqual(server[root]);
      expect(fetches[root]).toHaveBeenCalledTimes(3); // initial, disconnect, reconnect
    }
    expect(client.getQueryState(['settings'])?.isInvalidated).toBe(false);
    const count = fetches.jobs.mock.calls.length;
    await run(() => undefined, 9000);
    expect(fetches.jobs).toHaveBeenCalledTimes(count); // no polling when connected
  });

  it('refreshes active readers and task lists while offline, pauses hidden tabs and catches up on return', async () => {
    const { client, server, fetches } = mount();
    await run(() => FakeSocket.all[0].onopen?.());
    await run(() => FakeSocket.all[0].close());
    server.episode = { takes: ['completed_while_offline'] };
    server.jobs = ['new_job'];
    await run(() => undefined, 3000);
    expect(client.getQueryData(keys.episode('ep_1'))).toEqual(server.episode);
    expect(client.getQueryData(keys.jobs())).toEqual(server.jobs);
    const count = fetches.jobs.mock.calls.length;

    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await run(() => document.dispatchEvent(new Event('visibilitychange')), 12000);
    expect(fetches.jobs).toHaveBeenCalledTimes(count);
    server.episode = { takes: ['adopted_after_return'] };
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    await run(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(client.getQueryData(keys.episode('ep_1'))).toEqual(server.episode);
    expect(fetches.jobs).toHaveBeenCalledTimes(count + 1);
  });

  it('clears terminal and retry previews without erasing unrelated active work', async () => {
    mount();
    const socket = FakeSocket.all[0];
    await run(() => socket.onopen?.());
    useLive.getState().set({ progress: { 'job_2:0': 0.2 }, previews: { 'job_2:0': 'other' } });
    const progress = () => {
      socket.emit('progress', 0, { value: 9, max: 10 });
      socket.emit('progress', 0, { type: 'preview', data: 'image', format: 'png' });
    };
    for (const event of ['complete', 'failed', 'uncertain', 'started', 'retried', 'canceled']) {
      await run(progress);
      expect(useLive.getState().previews['job_1:0']).toBe('data:image/png;base64,image');
      await run(() => socket.emit(event, event === 'retried' || event === 'canceled' ? null : 0));
      expect(useLive.getState().previews).toEqual({ 'job_2:0': 'other' });
      expect(useLive.getState().progress).toEqual({ 'job_2:0': 0.2 });
    }
    await run(() => socket.close());
    expect(useLive.getState().previews).toEqual({});
    expect(useLive.getState().progress).toEqual({});
  });

  it('waits for slow HTTP refreshes before scheduling the next offline round', async () => {
    const { fetches, unmount } = mount();
    await run(() => FakeSocket.all[0].onopen?.());
    let finish!: (value: unknown) => void;
    fetches.jobs.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await run(() => FakeSocket.all[0].close(), 10000);
    await run(() => document.dispatchEvent(new Event('visibilitychange')), 10000);
    expect(fetches.jobs).toHaveBeenCalledTimes(2);
    expect(fetches.episode).toHaveBeenCalledTimes(2);
    await run(() => finish(['new_job']), 3000);
    expect(fetches.jobs).toHaveBeenCalledTimes(3);
    expect(fetches.episode).toHaveBeenCalledTimes(3);
    await run(unmount, 10000);
    expect(fetches.jobs).toHaveBeenCalledTimes(3);
  });

  it('suspends reconnect attempts while hidden and connects as soon as the page returns', async () => {
    const { fetches } = mount();
    const first = FakeSocket.all[0];
    await run(() => first.onopen?.());
    await run(() => first.close());
    const count = fetches.jobs.mock.calls.length;

    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await run(() => document.dispatchEvent(new Event('visibilitychange')), 30_000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(fetches.jobs).toHaveBeenCalledTimes(count);

    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    await run(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(FakeSocket.all).toHaveLength(2);
    await run(() => FakeSocket.all[1].onopen?.());
    expect(useLive.getState().connected).toBe(true);
  });

  it('ignores malformed frames and obsolete sockets, and disposes reconnect and polling on unmount', async () => {
    const { unmount, fetches } = mount();
    const first = FakeSocket.all[0];
    await run(() => first.onopen?.());
    await run(() => {
      first.onmessage?.({ data: 'not json' });
      first.onmessage?.({ data: 'null' });
      first.emit('hello');
    });
    const oldOpen = first.onopen;
    const oldMessage = first.onmessage;
    await run(() => first.close(), 2000);
    const second = FakeSocket.all[1];
    await run(() => oldOpen?.());
    expect(useLive.getState().connected).toBe(false);
    await run(() => second.onopen?.());
    const count = fetches.jobs.mock.calls.length;
    await run(() =>
      oldMessage?.({ data: JSON.stringify({ type: 'complete', job_id: 'job_1', idx: 0 }) }),
    );
    expect(fetches.jobs).toHaveBeenCalledTimes(count);
    await run(unmount, 20000);
    expect(FakeSocket.all).toHaveLength(2);
    expect(second.close).toHaveBeenCalledOnce();
    expect(fetches.jobs).toHaveBeenCalledTimes(count);
    expect(useLive.getState().connected).toBeNull();
  });
});
