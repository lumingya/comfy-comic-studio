import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollectionAssignment, CollectionsIndex } from '../../api/collections';
import type { SeriesCard } from '../../api/types';
import { useUI } from '../../app/ui-store';
import { useToasts } from '../../components/toast';
import { series } from '../../test/fixtures';
import { mockFetch, renderWithProviders } from '../../test/utils';
import WorksPage from './WorksPage';

const books: SeriesCard[] = ['雨夜甲册', '雨夜乙册', '晴日丙册'].map((title, i) => ({
  ...(series as unknown as SeriesCard),
  id: `book_${i}`,
  title,
  cover_asset_id: null,
  episode_count: 1,
  panel_count: 2,
  adopted_count: i === 1 ? 1 : 2,
  created_at: `2026-11-${25 - i}T00:00:00`,
  updated_at: `2026-11-${25 - i}T00:00:00`,
}));

function collectionIndex(members: (string | null)[] = [null, null, null]): CollectionsIndex {
  return {
    collections: [
      {
        id: 'short',
        name: '短篇',
        created_at: '',
        updated_at: '',
        album_count: members.filter((id) => id === 'short').length,
      },
    ],
    memberships: Object.fromEntries(
      members.map((collection_id, i) => [`book_${i}`, { collection_id, revision: [4, 8, 2][i] }]),
    ),
    total_count: members.length,
    unfiled_count: members.filter((id) => id === null).length,
  };
}

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="测试地址">{location.pathname + location.search}</output>
      <button onClick={() => navigate(-1)}>返回上一页</button>
    </>
  );
}

async function mount(
  options: {
    index?: CollectionsIndex;
    route?: string;
    view?: 'grid' | 'showcase';
    items?: SeriesCard[];
    write?: () => Response | Promise<Response>;
  } = {},
) {
  let index = options.index ?? collectionIndex();
  useUI.setState({
    worksView: options.view ?? 'grid',
    starred: [],
    shelfOrder: [],
    shelfSort: 'createdAt',
  });
  const calls = mockFetch({
    'GET /api/series': options.items ?? books,
    'GET /api/collections': () => index,
    'GET /api/settings': { collection_title: '测试画册集' },
    'GET /api/update': {},
    'GET /api/jobs': [],
    'POST /api/collections/memberships': (body: unknown) => {
      if (options.write) return options.write();
      const { assignments } = body as { assignments: CollectionAssignment[] };
      const next = structuredClone(index);
      const changes = assignments.map((assignment) => {
        const before = index.memberships[assignment.series_id];
        const after = {
          collection_id: assignment.collection_id,
          revision: before.revision + 1,
        };
        next.memberships[assignment.series_id] = after;
        return { series_id: assignment.series_id, before, after };
      });
      next.collections = next.collections.map((collection) => ({
        ...collection,
        album_count: Object.values(next.memberships).filter(
          (membership) => membership.collection_id === collection.id,
        ).length,
      }));
      next.unfiled_count = Object.values(next.memberships).filter(
        (membership) => membership.collection_id === null,
      ).length;
      index = next;
      return { changes, index };
    },
  });
  renderWithProviders(
    <>
      <WorksPage />
      <LocationProbe />
    </>,
    options.route ?? '/gallery',
  );
  await screen.findByRole('tab', { name: /^短篇/ });
  await screen.findAllByRole('article');
  return calls;
}

class Pointer extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'mouse';
  }
}

const card = (i = 0) => screen.getByRole('article', { name: books[i].title });
const cover = (i = 0) => within(card(i)).getByRole('button', { name: books[i].title });
const pointer = { pointerId: 1, pointerType: 'mouse', button: 0 };
const movePointer = (x: number, y: number) =>
  fireEvent.pointerMove(window, { ...pointer, buttons: 1, clientX: x, clientY: y });
function aimAt(target: HTMLElement) {
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: () => target,
  });
}
function drag(source: HTMLElement, target: HTMLElement) {
  aimAt(target);
  fireEvent.pointerDown(source, { ...pointer, clientX: 50, clientY: 180 });
  movePointer(100, 30);
}
const picked = () => document.querySelectorAll('[data-shelf-id][aria-selected="true"]');
const posts = (calls: Awaited<ReturnType<typeof mount>>) =>
  calls.filter((call) => call.method === 'POST' && call.url === '/api/collections/memberships');
const currentUrl = () =>
  new URL(screen.getByLabelText('测试地址').textContent!, 'http://localhost');

beforeEach(() => vi.stubGlobal('PointerEvent', Pointer));
afterEach(() => {
  Reflect.deleteProperty(document, 'elementFromPoint');
  vi.unstubAllGlobals();
  useToasts.getState().items.forEach((item) => useToasts.getState().dismiss(item.id));
});

describe('shelf collection integration', () => {
  it('drops the selected covers in shelf order, shows a counted ghost and undoes with write revisions', async () => {
    const calls = await mount();
    fireEvent.click(cover(1), { ctrlKey: true });
    fireEvent.click(cover(0), { ctrlKey: true });
    const target = screen.getByRole('tab', { name: /^短篇/ });
    drag(cover(1), target);
    expect(document.querySelector('.shelf-drag-ghost')).toHaveAttribute('data-count', '2');
    expect(card(0)).toHaveClass('is-dragging');
    expect(card(1)).toHaveClass('is-dragging');
    expect(target).toHaveClass('is-collection-drop-target');
    fireEvent.pointerUp(window, pointer);
    fireEvent.click(target, { detail: 1 });
    expect(currentUrl().searchParams.has('collection')).toBe(false);
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0].body).toEqual({
      assignments: [
        { series_id: 'book_0', collection_id: 'short', expected_revision: 4 },
        { series_id: 'book_1', collection_id: 'short', expected_revision: 8 },
      ],
    });
    await waitFor(() => expect(useToasts.getState().items.at(-1)?.action?.label).toBe('撤销'));
    const toast = useToasts.getState().items.at(-1)!;
    expect(toast.text).toContain('2');
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(useUI.getState().shelfSort).toBe('createdAt');
    expect(document.querySelector('.shelf-drag-ghost,.is-collection-drop-target')).toBeNull();
    act(() => toast.action?.onClick());
    await waitFor(() => expect(posts(calls)).toHaveLength(2));
    expect(posts(calls)[1].body).toEqual({
      assignments: [
        { series_id: 'book_0', collection_id: null, expected_revision: 5 },
        { series_id: 'book_1', collection_id: null, expected_revision: 9 },
      ],
    });
    await waitFor(() => expect(target).toHaveTextContent('短篇0'));
  });

  it('drags the single featured Showcase cover into a collection', async () => {
    const calls = await mount({
      view: 'showcase',
      items: [books[0]],
      index: collectionIndex([null]),
    });
    const source = card().querySelector<HTMLElement>('[data-shelf-open]')!;
    const target = screen.getByRole('tab', { name: /^短篇/ });
    drag(source, target);
    expect(card()).toHaveClass('is-dragging');
    expect(document.querySelector('.shelf-drag-ghost')).toBeInTheDocument();
    expect(target).toHaveClass('is-collection-drop-target');
    fireEvent.pointerUp(window, pointer);
    fireEvent.click(source, { detail: 1 });
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0].body).toEqual({
      assignments: [{ series_id: 'book_0', collection_id: 'short', expected_revision: 4 }],
    });
    expect(currentUrl().pathname).toBe('/gallery');
  });

  it('keeps albums and selection on the filtered shelf while a failed move is pending and after failure', async () => {
    let settle!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => {
      settle = resolve;
    });
    const calls = await mount({
      index: collectionIndex(['short', null, null]),
      route: '/gallery?collection=short',
      write: () => response,
    });
    fireEvent.click(cover(), { ctrlKey: true });
    drag(cover(), screen.getByRole('tab', { name: /^未归类/ }));
    fireEvent.pointerUp(window, pointer);
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(card()).toBeInTheDocument();
    expect(picked()).toHaveLength(1);
    act(() => settle(new Response(JSON.stringify({ detail: '写入失败' }), { status: 500 })));
    await waitFor(() => expect(useToasts.getState().items.at(-1)?.text).toBe('写入失败'));
    expect(card()).toBeInTheDocument();
    expect(picked()).toHaveLength(1);
    expect(screen.getByRole('tab', { name: /^短篇/ })).toHaveAttribute('aria-selected', 'true');
    expect(currentUrl().searchParams.get('collection')).toBe('short');
  });

  it('lets the first Escape cancel the cover drag and the next Escape clear the selection', async () => {
    const calls = await mount();
    fireEvent.click(cover(1), { ctrlKey: true });
    fireEvent.click(cover(0), { ctrlKey: true });
    drag(cover(), screen.getByRole('tab', { name: /^短篇/ }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.querySelector('.shelf-drag-ghost,.is-collection-drop-target')).toBeNull();
    expect(picked()).toHaveLength(2);
    fireEvent.pointerUp(window, pointer);
    fireEvent.click(cover(), { detail: 1 });
    expect(currentUrl().pathname).toBe('/gallery');
    expect(picked()).toHaveLength(2);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(picked()).toHaveLength(0);
    expect(posts(calls)).toHaveLength(0);
  });

  it('keeps touch scrolling available and moves a tapped bulk selection through the keyboard menu', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(pointer: coarse)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const calls = await mount();
    const touch = { ...pointer, pointerType: 'touch' };
    aimAt(screen.getByRole('tab', { name: /^短篇/ }));
    fireEvent.pointerDown(cover(), { ...touch, clientX: 50, clientY: 180 });
    fireEvent.pointerMove(window, { ...touch, buttons: 1, clientX: 100, clientY: 30 });
    fireEvent.pointerUp(window, touch);
    expect(document.querySelector('.shelf-drag-ghost')).toBeNull();
    expect(posts(calls)).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '批量管理' }));
    fireEvent.click(cover());
    expect(picked()).toHaveLength(1);
    const trigger = screen.getByRole('button', { name: '移至合集' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('menu');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(posts(calls)[0].body).toEqual({
      assignments: [{ series_id: 'book_0', collection_id: 'short', expected_revision: 4 }],
    });
    expect(currentUrl().pathname).toBe('/gallery');
    expect(picked()).toHaveLength(1);
  });

  it('intersects collection, search and status and retains those filters through reading and Back', async () => {
    await mount({
      index: collectionIndex(['short', 'short', null]),
      route: '/gallery?collection=short&q=雨夜&status=complete&sort=updatedAt',
    });
    expect(screen.getAllByRole('article')).toEqual([card(0)]);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '雨' } });
    expect(currentUrl().searchParams.get('collection')).toBe('short');
    expect(currentUrl().searchParams.get('status')).toBe('complete');
    expect(currentUrl().searchParams.get('sort')).toBe('updatedAt');
    fireEvent.click(cover());
    expect(currentUrl().pathname).toBe('/gallery/book_0');
    expect(currentUrl().searchParams.get('collection')).toBe('short');
    expect(currentUrl().searchParams.get('q')).toBe('雨');
    expect(currentUrl().searchParams.get('status')).toBe('complete');
    fireEvent.click(screen.getByRole('button', { name: '返回上一页' }));
    expect(currentUrl().pathname).toBe('/gallery');
    expect(currentUrl().searchParams.get('collection')).toBe('short');
    fireEvent.change(screen.getByRole('combobox', { name: '画册状态' }), {
      target: { value: 'failed' },
    });
    expect(screen.getAllByRole('article')).toEqual([card(1)]);
    fireEvent.click(screen.getByRole('tab', { name: /^全部/ }));
    expect(currentUrl().searchParams.has('collection')).toBe(false);
    expect(currentUrl().searchParams.get('q')).toBe('雨');
    expect(currentUrl().searchParams.get('status')).toBe('failed');
    expect(screen.getAllByRole('article')).toEqual([card(1)]);
  });
});
