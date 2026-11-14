import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nudgeEpisode } from '../../api/longform';
import { episode, series } from '../../test/fixtures';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { TransferDialog } from './TransferDialog';
import { VariableToolsDialog } from './VariableToolsDialog';

const source = { ...episode, id: 'source', revision: 3 };
const target = { ...episode, id: 'target', title: '第二话', revision: 7 };
const page = {
  items: [source, target],
  total: 2,
  offset: 0,
  limit: 200,
};
const listRoute = `GET /api/series/${series.id}/episodes`;
const prefix = `/api/series/${series.id}`;
const error = (detail: string) => new Response(JSON.stringify({ detail }), { status: 409 });
const changes = [
  {
    owner_id: source.id,
    path: '/panels/0/overrides/raw_prompt',
    kind: 'text',
    before: 'SERVER {hero} {{hero}}',
    after: 'SERVER {lead} {{hero}}',
    locked: false,
  },
];
const found = {
  head: 'find-head',
  key: 'hero',
  fields: [],
  occurrences: [
    {
      owner_id: source.id,
      path: '/panels/0/overrides/raw_prompt',
      kind: 'text',
      value: changes[0].before,
      count: 1,
      locked: false,
    },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe('longform transfers', () => {
  it('sends source and target revisions with server-owned selection and safe defaults', async () => {
    const close = vi.fn();
    const calls = mockFetch({
      [listRoute]: page,
      'GET /api/episodes/target': target,
      [`POST ${prefix}/panels/transfer`]: {
        source,
        target: { ...target, revision: 8 },
        panel_ids: {},
        take_ids: {},
        lettering_ids: {},
        layout_offset_y: 100,
        notes: [],
      },
    });
    renderWithProviders(
      <TransferDialog episode={source} panelIds={['p0', 'p1']} onClose={close} />,
    );
    expect(screen.getByRole('button', { name: '复制' })).toBeDisabled();
    await screen.findByRole('option', { name: '第二话' });
    expect(screen.queryByRole('option', { name: source.title })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('目标话 / 分镜'), { target: { value: 'target' } });
    await waitFor(() => expect(screen.getByRole('button', { name: '复制' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(calls.find((call) => call.url === `${prefix}/panels/transfer`)?.body).toEqual({
      source_episode_id: 'source',
      target_episode_id: 'target',
      source_revision: 3,
      target_revision: 7,
      panel_ids: ['p0', 'p1'],
      mode: 'copy',
      include_locked: false,
      break_bridges: false,
    });
    expect(calls.some((call) => /render|finalize|\/panels\/import/.test(call.url))).toBe(false);
  });

  it('keeps a rejected move open, refreshes snapshots explicitly and sends only chosen overrides', async () => {
    const close = vi.fn();
    let attempt = 0;
    const calls = mockFetch({
      [listRoute]: page,
      'GET /api/episodes/source': { ...source, revision: 4 },
      'GET /api/episodes/target': () => ({ ...target, revision: attempt ? 8 : 7 }),
      [`POST ${prefix}/panels/transfer`]: () =>
        ++attempt === 1 ? error('source changed; refresh first') : { source, target, notes: [] },
    });
    renderWithProviders(<TransferDialog episode={source} panelIds={['p0']} onClose={close} />);
    await screen.findByRole('option', { name: '第二话' });
    fireEvent.change(screen.getByLabelText('目标话 / 分镜'), { target: { value: 'target' } });
    fireEvent.change(screen.getByLabelText('操作'), { target: { value: 'move' } });
    await waitFor(() => expect(screen.getByRole('button', { name: '移动' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '移动' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('source changed; refresh first');
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '刷新内容后重试' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    fireEvent.click(screen.getByText('更多选项'));
    fireEvent.click(screen.getByLabelText('断开跨越选择范围的气泡'));
    fireEvent.click(screen.getByRole('button', { name: '移动' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    const mutations = calls.filter((call) => call.url === `${prefix}/panels/transfer`);
    expect(mutations).toHaveLength(2);
    expect(mutations[1].body).toMatchObject({
      source_revision: 4,
      target_revision: 8,
      mode: 'move',
      break_bridges: true,
      include_locked: false,
    });
  });

  it('uses paged lightweight revisions for episode reorder without fetching every document', async () => {
    const calls = mockFetch({
      [listRoute]: page,
      [`POST ${prefix}/episodes/reorder`]: [target, source],
    });
    await nudgeEpisode(series.id, 'target', -1);
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      order: ['target', 'source'],
      revisions: { source: 3, target: 7 },
    });
    expect(calls.some((call) => call.url.startsWith('/api/episodes/'))).toBe(false);
    expect(calls[0].url).toContain('limit=200');
  });
});

describe('variable review', () => {
  const routes = () => ({ [listRoute]: page, [`POST ${prefix}/variables/find`]: found });
  async function find() {
    fireEvent.change(screen.getByLabelText('变量名'), { target: { value: 'hero' } });
    fireEvent.click(screen.getByRole('button', { name: '查找引用' }));
    await screen.findByText('找到 1 处');
    fireEvent.change(screen.getByLabelText('新的变量名'), { target: { value: 'lead' } });
  }

  it('requires find and review, displays server text, and applies the reviewed content head', async () => {
    const close = vi.fn();
    const calls = mockFetch({
      ...routes(),
      [`POST ${prefix}/variables/preview`]: {
        head: 'reviewed-head',
        changes,
        conflicts: [],
        fields: [],
      },
      [`POST ${prefix}/variables/apply`]: {
        head: 'new-head',
        previous_head: 'reviewed-head',
        series,
        episodes: [source],
        changes,
        conflicts: [],
        fields: [],
      },
    });
    renderWithProviders(<VariableToolsDialog seriesId={series.id} onClose={close} />);
    expect(screen.getByRole('button', { name: '预览修改' })).toBeDisabled();
    await find();
    fireEvent.click(screen.getByRole('button', { name: '预览修改' }));
    expect(await screen.findByText('SERVER {lead} {{hero}}')).toBeVisible();
    expect(calls.filter((call) => call.url.endsWith('/apply'))).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '应用 1 处修改' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(calls.find((call) => call.url.endsWith('/apply'))?.body).toEqual({
      key: 'hero',
      action: 'rename',
      value: 'lead',
      include_locked: false,
      expected_head: 'reviewed-head',
    });
  });

  it('blocks reported conflicts, invalidates edited previews, and requires a fresh review after stale apply', async () => {
    let previews = 0;
    const calls = mockFetch({
      ...routes(),
      [`POST ${prefix}/variables/preview`]: () => ({
        head: `head-${++previews}`,
        changes,
        conflicts: previews === 1 ? ['locked panel'] : [],
        fields: [],
      }),
      [`POST ${prefix}/variables/apply`]: () => error('work changed; preview again'),
    });
    renderWithProviders(<VariableToolsDialog seriesId={series.id} onClose={vi.fn()} />);
    await find();
    fireEvent.click(screen.getByRole('button', { name: '预览修改' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('locked panel');
    expect(screen.getByRole('button', { name: '应用 1 处修改' })).toBeDisabled();
    fireEvent.click(screen.getByText('更多选项'));
    fireEvent.click(screen.getByLabelText('允许修改锁定的内容'));
    expect(screen.queryByRole('button', { name: '应用 1 处修改' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '预览修改' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '应用 1 处修改' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: '应用 1 处修改' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('work changed; preview again');
    expect(screen.queryByRole('button', { name: '应用 1 处修改' })).not.toBeInTheDocument();
    expect(calls.filter((call) => call.url.endsWith('/apply'))).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '预览修改' }));
    await screen.findByRole('button', { name: '应用 1 处修改' });
    expect(calls.filter((call) => call.url.endsWith('/preview'))).toHaveLength(3);
  });

  it('clears prior matches when the key changes and permits literal replacement including braces', async () => {
    const calls = mockFetch({
      ...routes(),
      [`POST ${prefix}/variables/preview`]: { head: 'h', changes, conflicts: [], fields: [] },
    });
    renderWithProviders(<VariableToolsDialog seriesId={series.id} onClose={vi.fn()} />);
    await find();
    fireEvent.change(screen.getByLabelText('操作'), { target: { value: 'replace' } });
    fireEvent.change(screen.getByLabelText('替换为'), {
      target: { value: '{literal} {{escaped}}' },
    });
    fireEvent.click(screen.getByRole('button', { name: '预览修改' }));
    await screen.findByRole('button', { name: '应用 1 处修改' });
    expect(calls.find((call) => call.url.endsWith('/preview'))?.body).toMatchObject({
      action: 'replace',
      value: '{literal} {{escaped}}',
    });
    fireEvent.change(screen.getByLabelText('变量名'), { target: { value: 'other' } });
    expect(screen.queryByText('找到 1 处')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '预览修改' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('变量名'), { target: { value: '{invalid}' } });
    expect(screen.getByRole('button', { name: '查找引用' })).toBeDisabled();
  });
});
