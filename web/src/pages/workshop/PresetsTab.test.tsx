import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Series } from '../../api/types';
import { workshopKey } from '../../api/workshop';
import { series } from '../../test/fixtures';
import { mockFetch } from '../../test/utils';
import PresetsTab from './PresetsTab';

let workshop: Series;

beforeEach(() => {
  localStorage.clear();
  workshop = {
    ...structuredClone(series),
    id: 'ws',
    kind: 'workshop',
    presets: ['first', 'second'].map((id) => ({
      id,
      title: `${id} preset`,
      groups: [{ id: `${id}_group`, title: `${id} group` }],
      bindings: [],
      entries: ['hero', 'outfit'].map((key) => ({
        id: `${id}_${key}`,
        key,
        label: `${id} ${key}`,
        value: `${id} original ${key}`,
        hint: '',
        group_id: null,
      })),
    })),
  };
});
afterEach(() => vi.unstubAllGlobals());

function mount() {
  const calls = mockFetch({
    'GET /api/workshop': () => workshop,
    'GET /api/creation-kits': [],
    'GET /api/series': [],
    'PATCH /api/series/ws': (body: unknown) => {
      workshop = { ...workshop, ...(body as object) };
      return workshop;
    },
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(workshopKey, workshop);
  const router = createMemoryRouter([{ path: '/workshop/presets', element: <PresetsTab /> }], {
    initialEntries: ['/workshop/presets'],
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return calls;
}

describe('preset editing across library and variable controls', () => {
  it('keeps rapid field edits when moving selected variables, and preserves the other preset', async () => {
    const untouched = structuredClone(workshop.presets[1]);
    const calls = mount();
    fireEvent.change(await screen.findByLabelText('first hero'), {
      target: { value: 'new hero' },
    });
    fireEvent.change(screen.getByLabelText('first outfit'), {
      target: { value: 'new outfit' },
    });
    fireEvent.click(screen.getByLabelText('选择 first hero'));
    fireEvent.click(screen.getByLabelText('选择 first outfit'));
    fireEvent.change(screen.getByLabelText('目标分组'), { target: { value: 'first_group' } });
    fireEvent.click(screen.getByRole('button', { name: '移动' }));
    await waitFor(() =>
      expect(workshop.presets[0].entries.map((entry) => [entry.value, entry.group_id])).toEqual([
        ['new hero', 'first_group'],
        ['new outfit', 'first_group'],
      ]),
    );
    expect(workshop.presets[1]).toEqual(untouched);
    expect(screen.queryByRole('toolbar', { name: '已选变量操作' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '展开「first group」' }));
    expect(screen.getByLabelText('first hero')).toHaveValue('new hero');
    expect(screen.getByLabelText('first outfit')).toHaveValue('new outfit');
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
  });

  it('clears variable selection when switching presets and keeps Escape separate from a committed rename', async () => {
    const calls = mount();
    fireEvent.click(await screen.findByLabelText('选择 first hero'));
    expect(screen.getByRole('toolbar', { name: '已选变量操作' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('当前预设'), { target: { value: 'second' } });
    expect(screen.getByLabelText('second hero')).toHaveValue('second original hero');
    expect(screen.queryByRole('toolbar', { name: '已选变量操作' })).toBeNull();
    expect(localStorage.getItem('mio.workshop.preset.ws')).toBe('second');

    const rename = screen.getByRole('button', { name: '重命名' });
    fireEvent.click(rename);
    fireEvent.change(screen.getByLabelText('预设名称'), { target: { value: 'discard name' } });
    fireEvent.keyDown(screen.getByLabelText('预设名称'), { key: 'Escape' });
    expect(screen.getByLabelText('当前预设')).toHaveValue('second');
    expect(rename).toHaveFocus();
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '重命名' }));
    fireEvent.change(screen.getByLabelText('预设名称'), { target: { value: 'Saved name' } });
    fireEvent.keyDown(screen.getByLabelText('预设名称'), { key: 'Enter' });
    await waitFor(() => expect(workshop.presets[1].title).toBe('Saved name'));
    expect(rename).toHaveFocus();
    expect(workshop.presets[0].title).toBe('first preset');
  });
});
