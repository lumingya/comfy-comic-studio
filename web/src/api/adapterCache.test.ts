import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockFetch } from '../test/utils';
import { raw } from './client';
import { keys } from './keys';
import { useExtensionAction } from './open';

afterEach(() => vi.unstubAllGlobals());

describe('adapter changes and inactive workflow caches', () => {
  it.each(['enable', 'disable', 'remove'] as const)(
    'refreshes cached trial controls and workflow metadata after extension %s',
    async (action) => {
      let adapter = action === 'enable' ? 'builtin' : 'ext:slot-codec';
      const nextAdapter = action === 'enable' ? 'ext:slot-codec' : 'builtin';
      const changeAdapter = () => {
        adapter = nextAdapter;
        return action === 'remove'
          ? null
          : { id: 'slot-codec', status: action === 'enable' ? 'active' : 'disabled', error: '' };
      };
      const calls = mockFetch({
        'GET /api/workflows/wf/loras': () => ({
          groups: [{ key: `${adapter}:group`, loras: [] }],
          adapters: [{ id: adapter }],
        }),
        'GET /api/workflows/wf': () => ({ id: 'wf', lora_controls: { adapter } }),
        'GET /api/workflows': () => [{ id: 'wf', loras: { adapter } }],
        'POST /api/extensions/slot-codec/enable': changeAdapter,
        'POST /api/extensions/slot-codec/disable': changeAdapter,
        'DELETE /api/extensions/slot-codec': changeAdapter,
      });
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      const wrapper = ({ children }: PropsWithChildren) =>
        createElement(QueryClientProvider, { client }, children);
      const { result, unmount } = renderHook(() => useExtensionAction(), { wrapper });
      // Trial controls use Infinity and are inactive while the extension page is open.
      const queries = [
        { queryKey: keys.workflowLoras('wf'), path: '/api/workflows/wf/loras' },
        { queryKey: keys.workflow('wf'), path: '/api/workflows/wf' },
        { queryKey: keys.workflows, path: '/api/workflows' },
      ].map(({ queryKey, path }) => ({
        queryKey,
        staleTime: Infinity,
        queryFn: async () => (await raw(path)).json(),
      }));
      try {
        const before = await Promise.all(queries.map((query) => client.fetchQuery(query)));
        expect(before[0].groups[0].key).toBe(`${adapter}:group`);
        expect(calls.filter((call) => call.method === 'GET')).toHaveLength(3);

        await act(async () => {
          await result.current.mutateAsync(
            action === 'remove'
              ? { id: 'slot-codec', action, deleteData: false }
              : { id: 'slot-codec', action, digest: 'reviewed-digest' },
          );
        });

        // Reopening must request new data even though the prior entries were permanently fresh.
        const after = await Promise.all(queries.map((query) => client.fetchQuery(query)));
        expect(after[0].groups[0].key).toBe(`${nextAdapter}:group`);
        expect(after[1].lora_controls.adapter).toBe(nextAdapter);
        expect(after[2][0].loras.adapter).toBe(nextAdapter);
        expect(calls.filter((call) => call.method === 'GET')).toHaveLength(6);
      } finally {
        unmount();
        client.clear();
      }
    },
  );
});
