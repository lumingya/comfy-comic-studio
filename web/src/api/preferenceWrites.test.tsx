import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { usePrivatePreferences, useWritePrivatePreferences } from './preferenceWrites';

const path = '/api/themes/queue/preferences';
const key = ['theme-preferences', 'queue'];
type Value = Record<string, unknown>;
type Patch = { expected_revision: string; path: string[]; value: unknown };

function revision(number: number) {
  return number.toString(16).padStart(64, '0');
}
function response(value: Value, version: number, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', ETag: `"${revision(version)}"` },
  });
}
function server() {
  let value: Value = { first: false, second: false };
  let version = 0;
  const requests: {
    body: Patch;
    finish: (next?: Value, status?: number) => void;
    respondSnapshot: (value: Value, version: number) => void;
  }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== 'PATCH') return response(value, version);
      return new Promise<Response>((resolve) => {
        requests.push({
          body: JSON.parse(String(init.body)) as Patch,
          respondSnapshot: (snapshot, revision) => resolve(response(snapshot, revision)),
          finish: (next, status = 200) => {
            if (next) {
              value = next;
              version += 1;
            }
            resolve(
              response(status === 200 ? value : { detail: 'write rejected' }, version, status),
            );
          },
        });
      });
    }),
  );
  return {
    requests,
    remote: (next: Value) => {
      value = next;
      version += 1;
    },
    value: () => value,
  };
}
function mount(
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  }),
) {
  const view = renderHook(
    () => ({
      query: usePrivatePreferences(path, key),
      first: useWritePrivatePreferences(path, key),
      second: useWritePrivatePreferences(path, key),
    }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  return { ...view, client };
}
afterEach(() => vi.unstubAllGlobals());

it.each([true, false])(
  'serializes hook instances and keeps the newest intent while an older save succeeds=%s',
  async (succeeds) => {
    const backend = server();
    const view = mount();
    await waitFor(() => expect(view.result.current.query.isSuccess).toBe(true));
    let first!: Promise<Value>;
    let second!: Promise<Value>;
    act(() => {
      first = view.result.current.first.mutateAsync({ path: ['first'], value: true });
      void first.catch(() => undefined);
      second = view.result.current.second.mutateAsync({ path: ['second'], value: true });
    });
    await waitFor(() => expect(backend.requests).toHaveLength(1));
    await waitFor(() =>
      expect(view.client.getQueryData(key)).toEqual({ first: true, second: true }),
    );
    expect(backend.requests[0].body).toEqual({
      expected_revision: revision(0),
      path: ['first'],
      value: true,
    });
    await act(async () =>
      backend.requests[0].finish(
        succeeds ? { first: true, second: false } : undefined,
        succeeds ? 200 : 500,
      ),
    );
    await waitFor(() => expect(backend.requests).toHaveLength(2));
    expect(view.client.getQueryData(key)).toMatchObject({ second: true });
    expect(backend.requests[1].body.expected_revision).toBe(revision(succeeds ? 1 : 0));
    await act(async () => {
      backend.requests[1].finish({ first: succeeds, second: true });
      await second;
    });
    if (succeeds) await first;
    else await expect(first).rejects.toThrow('write rejected');
    expect(view.client.getQueryData(key)).toEqual(backend.value());
    expect(view.client.getQueryData(key)).toEqual({ first: succeeds, second: true });
  },
);

it('replays a subtree once after CAS conflict and keeps the remote sibling', async () => {
  const backend = server();
  const view = mount();
  await waitFor(() => expect(view.result.current.query.isSuccess).toBe(true));
  let save!: Promise<Value>;
  act(() => {
    save = view.result.current.first.mutateAsync({ path: ['first'], value: true });
  });
  await waitFor(() => expect(backend.requests).toHaveLength(1));
  backend.remote({ first: false, second: 'remote' });
  await act(async () => backend.requests[0].finish(undefined, 409));
  await waitFor(() => expect(backend.requests).toHaveLength(2));
  expect(backend.requests[1].body.expected_revision).toBe(revision(1));
  await act(async () => {
    backend.requests[1].finish({ first: true, second: 'remote' });
    await save;
  });
  expect(view.client.getQueryData(key)).toEqual({ first: true, second: 'remote' });
});

it.each([{ intentPath: [] }, { intentPath: ['first'] }])(
  'rejects an unreplayable or repeatedly conflicting intent with path %j',
  async ({ intentPath }) => {
    const backend = server();
    const view = mount();
    await waitFor(() => expect(view.result.current.query.isSuccess).toBe(true));
    let save!: Promise<Value>;
    act(() => {
      save = view.result.current.first.mutateAsync({
        path: intentPath,
        value: intentPath.length ? true : { first: true },
      });
      void save.catch(() => undefined);
    });
    await waitFor(() => expect(backend.requests).toHaveLength(1));
    backend.remote({ remote: true });
    await act(async () => backend.requests[0].finish(undefined, 409));
    if (intentPath.length) {
      await waitFor(() => expect(backend.requests).toHaveLength(2));
      await act(async () => backend.requests[1].finish(undefined, 409));
    }
    await expect(save).rejects.toThrow('write rejected');
    expect(backend.requests).toHaveLength(intentPath.length ? 2 : 1);
    expect(view.client.getQueryData(key)).toEqual({ remote: true });
  },
);

it('allows separate QueryClients to send independently and finish in reverse order', async () => {
  const backend = server();
  const first = mount();
  const second = mount();
  await waitFor(() =>
    expect(first.result.current.query.isSuccess && second.result.current.query.isSuccess).toBe(
      true,
    ),
  );
  let one!: Promise<Value>;
  let two!: Promise<Value>;
  act(() => {
    one = first.result.current.first.mutateAsync({ path: ['first'], value: true });
    two = second.result.current.first.mutateAsync({ path: ['second'], value: true });
  });
  await waitFor(() => expect(backend.requests).toHaveLength(2));
  await act(async () => {
    backend.requests[1].finish({ first: false, second: true });
    await two;
  });
  await act(async () => backend.requests[0].finish(undefined, 409));
  await waitFor(() => expect(backend.requests).toHaveLength(3));
  await act(async () => {
    backend.requests[2].finish({ first: true, second: true });
    await one;
  });
  expect(first.client.getQueryData(key)).toEqual(backend.value());
  expect(second.client.getQueryData(key)).toEqual({ first: false, second: true });
});

it('persists the queue after unmount without calling a removed observer', async () => {
  const backend = server();
  const view = mount();
  await waitFor(() => expect(view.result.current.query.isSuccess).toBe(true));
  const onSuccess = vi.fn();
  act(() => view.result.current.first.mutate({ path: ['first'], value: true }, { onSuccess }));
  await waitFor(() => expect(backend.requests).toHaveLength(1));
  view.unmount();
  await act(async () => backend.requests[0].finish({ first: true, second: false }));
  await waitFor(() => expect(view.client.getQueryData(key)).toEqual(backend.value()));
  expect(onSuccess).not.toHaveBeenCalled();
});

it('rolls back a failed newest save to the actual server value, including a write whose response was lost', async () => {
  const backend = server();
  const view = mount();
  await waitFor(() => expect(view.result.current.query.isSuccess).toBe(true));
  let save!: Promise<Value>;
  act(() => {
    save = view.result.current.first.mutateAsync({ path: ['first'], value: true });
    void save.catch(() => undefined);
  });
  await waitFor(() => expect(backend.requests).toHaveLength(1));
  backend.remote({ first: true, second: 'server committed' });
  await act(async () => backend.requests[0].finish(undefined, 500));
  await expect(save).rejects.toThrow('write rejected');
  expect(view.client.getQueryData(key)).toEqual(backend.value());
});

it('ignores an old GET that completes after the newest write even if transport ignores abort', async () => {
  const backend = server();
  const view = mount();
  await waitFor(() => expect(view.result.current.query.isSuccess).toBe(true));
  const fetch = globalThis.fetch;
  let finishRead!: (response: Response) => void;
  let delayed = true;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== 'PATCH' && delayed) {
        delayed = false;
        return new Promise<Response>((resolve) => {
          finishRead = resolve;
        });
      }
      return fetch(input, init);
    }),
  );
  act(() => {
    void view.result.current.query.refetch();
  });
  await waitFor(() => expect(finishRead).toBeDefined());
  let save!: Promise<Value>;
  act(() => {
    save = view.result.current.first.mutateAsync({ path: ['first'], value: true });
  });
  await waitFor(() => expect(backend.requests).toHaveLength(1));
  await act(async () => {
    backend.requests[0].finish({ first: true, second: false });
    await save;
  });
  await act(async () => finishRead(response({ first: false, second: false }, 0)));
  expect(view.client.getQueryData(key)).toEqual({ first: true, second: false });
});

it('does not let a delayed write response reverse a newer server value already observed by GET', async () => {
  const backend = server();
  const view = mount();
  await waitFor(() => expect(view.result.current.query.isSuccess).toBe(true));
  let save!: Promise<Value>;
  act(() => {
    save = view.result.current.first.mutateAsync({ path: ['first'], value: true });
  });
  await waitFor(() => expect(backend.requests).toHaveLength(1));
  let replace!: Promise<Value>;
  await act(async () => {
    replace = view.result.current.second.mutateAsync({
      path: [],
      value: { first: true, second: false },
    });
    void replace.catch(() => undefined);
  });
  backend.remote({ first: true, second: false });
  backend.remote({ first: true, second: 'remote after write' });
  await act(async () => {
    await view.result.current.query.refetch();
  });
  // Complete the response with the older snapshot without changing the simulated authority.
  await act(async () => {
    backend.requests[0].respondSnapshot({ first: true, second: false }, 1);
    await save;
  });
  await expect(replace).rejects.toThrow('Preferences changed remotely');
  expect(backend.requests).toHaveLength(1);
  expect(view.client.getQueryData(key)).toEqual({ first: true, second: 'remote after write' });
});
