import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SeriesCard } from '../../api/types';
import { useUI } from '../../app/ui-store';
import { confirm } from '../../components/confirm';
import { Toaster, useToasts } from '../../components/toast';
import { series } from '../../test/fixtures';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { TrashSection } from '../trash/TrashPage';
import WorksPage from './WorksPage';

vi.mock('../../components/confirm', () => ({ confirm: vi.fn().mockResolvedValue(false) }));

const books: SeriesCard[] = ['甲册', '乙册'].map((title, index) => ({
  ...(series as unknown as SeriesCard),
  id: `book_${index}`,
  title,
  cover_asset_id: null,
  episode_count: 0,
  updated_at: `2026-09-${28 - index}T00:00:00`,
}));

beforeEach(() => {
  useUI.setState({ worksView: 'grid', starred: [], shelfSort: 'updatedAt' });
  vi.mocked(confirm).mockReset().mockResolvedValue(false);
});
afterEach(() => {
  vi.unstubAllGlobals();
  useToasts.getState().items.forEach((item) => useToasts.getState().dismiss(item.id));
});

async function mount(failSecond = false) {
  const removed = new Set<string>();
  const calls = mockFetch({
    'GET /api/series': () => books.filter((book) => !removed.has(book.id!)),
    'GET /api/settings': { collection_title: '回收站操作测试' },
    'GET /api/update': {},
    'GET /api/jobs': [],
    ...Object.fromEntries(
      books.flatMap((book) => [
        [
          `DELETE /api/series/${book.id}`,
          () => {
            if (failSecond && book.id === 'book_1')
              return new Response(JSON.stringify({ detail: 'busy album' }), { status: 409 });
            removed.add(book.id!);
            return {};
          },
        ],
        [
          `POST /api/series/${book.id}/restore`,
          () => {
            removed.delete(book.id!);
            return {};
          },
        ],
      ]),
    ),
  });
  renderWithProviders(
    <>
      <WorksPage />
      <Toaster />
    </>,
    '/gallery',
  );
  await screen.findByRole('article', { name: '甲册' });
  return calls;
}

function selectBoth() {
  for (const title of ['甲册', '乙册']) {
    const article = screen.getByRole('article', { name: title });
    fireEvent.click(within(article).getByRole('button', { name: title }), { ctrlKey: true });
  }
}

it.each(['single menu', 'batch menu', 'selection bar'])(
  '%s moves albums straight to trash and can undo only those albums',
  async (entry) => {
    const calls = await mount();
    const many = entry !== 'single menu';
    if (many) selectBoth();
    if (entry === 'selection bar') {
      fireEvent.click(screen.getByRole('button', { name: '移入回收站' }));
    } else {
      fireEvent.contextMenu(screen.getByRole('article', { name: '甲册' }));
      fireEvent.click(screen.getByRole('menuitem', { name: /移入回收站/ }));
    }
    expect(await screen.findByText(`已移到回收站 ${many ? 2 : 1} 本`)).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.url)).toEqual(
      many ? ['/api/series/book_0', '/api/series/book_1'] : ['/api/series/book_0'],
    );
    await waitFor(() => expect(screen.queryByRole('article', { name: '甲册' })).toBeNull());
    if (many) expect(screen.queryByRole('article', { name: '乙册' })).toBeNull();
    else expect(screen.getByRole('article', { name: '乙册' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(await screen.findByRole('article', { name: '甲册' })).toBeInTheDocument();
    expect(await screen.findByRole('article', { name: '乙册' })).toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.url)).toEqual(
      many
        ? ['/api/series/book_0/restore', '/api/series/book_1/restore']
        : ['/api/series/book_0/restore'],
    );
    expect(calls.some((call) => call.url.startsWith('/api/trash/'))).toBe(false);
  },
);

it('keeps failed albums visible and limits undo to successfully trashed albums', async () => {
  const calls = await mount(true);
  selectBoth();
  fireEvent.click(screen.getByRole('button', { name: '移入回收站' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('busy album');
  expect(await screen.findByText('已移到回收站 1 本')).toBeInTheDocument();
  expect(screen.getByRole('article', { name: '乙册' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '撤销' }));
  expect(await screen.findByRole('article', { name: '甲册' })).toBeInTheDocument();
  expect(calls.filter((call) => call.method === 'POST').map((call) => call.url)).toEqual([
    '/api/series/book_0/restore',
  ]);
  expect(confirm).not.toHaveBeenCalled();
});

it('still requires confirmation for permanent deletion in the trash', async () => {
  const calls = mockFetch({
    'GET /api/trash': {
      retention_days: 30,
      items: [{ kind: 'series', id: 'book_0', title: '甲册', deleted_at: null }],
    },
    'DELETE /api/trash/series/book_0': {},
  });
  renderWithProviders(<TrashSection />);
  const purge = await screen.findByRole('button', { name: '彻底删除' });
  fireEvent.click(purge);
  expect(confirm).toHaveBeenCalledWith(
    expect.objectContaining({ title: '彻底删除「甲册」？', danger: true }),
  );
  expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
  vi.mocked(confirm).mockResolvedValueOnce(true);
  fireEvent.click(purge);
  await waitFor(() =>
    expect(calls.filter((call) => call.method === 'DELETE')).toMatchObject([
      { url: '/api/trash/series/book_0' },
    ]),
  );
});
