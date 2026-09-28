import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocation, useNavigate } from 'react-router-dom';
import type { SeriesCard } from '../../api/types';
import { useUI } from '../../app/ui-store';
import { confirm } from '../../components/confirm';
import { series } from '../../test/fixtures';
import { mockFetch, renderWithProviders } from '../../test/utils';
import WorksPage from './WorksPage';

vi.mock('../../components/confirm', () => ({ confirm: vi.fn().mockResolvedValue(false) }));

const books: SeriesCard[] = ['甲册', '乙册', '丙册'].map((title, i) => ({
  ...(series as unknown as SeriesCard),
  id: `book_${i}`,
  title,
  cover_asset_id: null,
  episode_count: 1,
  updated_at: `2026-09-${28 - i}T00:00:00`,
}));

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="测试路径">{location.pathname}</output>
      <button onClick={() => navigate('/gallery')}>返回画册集</button>
    </>
  );
}

async function mount(view: 'grid' | 'showcase' = 'grid') {
  useUI.setState({ worksView: view, starred: [] });
  mockFetch({
    'GET /api/series': books,
    'GET /api/settings': { collection_title: '交互测试画册集' },
    'GET /api/update': {},
    'GET /api/jobs': [],
    'GET /api/series/book_0/episodes': { items: [], total: 0, offset: 0, limit: 50 },
  });
  renderWithProviders(
    <>
      <WorksPage />
      <LocationProbe />
    </>,
    '/gallery',
  );
  await screen.findByRole('article', { name: '甲册' });
}
const card = (name = '甲册') => screen.getByRole('article', { name });
const cover = (name = '甲册') => within(card(name)).getByRole('button', { name });
const picked = () => [...document.querySelectorAll('[aria-selected="true"]')];
const key = (value: string, mods = {}) =>
  fireEvent.keyDown(document.activeElement ?? window, { key: value, ...mods });
const root = () => document.getElementById('gallery-results')!;

beforeEach(() => vi.mocked(confirm).mockClear());
afterEach(() => vi.unstubAllGlobals());

describe('legacy shelf selection', () => {
  it('right-click is only a temporary context highlight; one Escape dismisses it and restores card focus', async () => {
    await mount();
    fireEvent.contextMenu(card(), { clientX: 200, clientY: 200 });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(card()).not.toHaveAttribute('aria-selected', 'true');
    expect(card()).toHaveClass('is-context');
    key('Escape');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(card()).not.toHaveClass('is-context');
    expect(picked()).toHaveLength(0);
    expect(card()).toHaveFocus();
  });

  it('Escape first closes the menu, then clears an intentional multi-selection', async () => {
    await mount();
    fireEvent.click(cover(), { ctrlKey: true });
    fireEvent.click(cover('乙册'), { ctrlKey: true });
    fireEvent.contextMenu(card(), { clientX: 200, clientY: 200 });
    key('Escape');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(picked()).toHaveLength(2);
    expect(card()).toHaveFocus();
    key('Escape');
    expect(picked()).toHaveLength(0);
    expect(screen.queryByText('已选择 2 本')).toBeNull();
  });

  it('a plain click on a title opens that album and clears an existing selection', async () => {
    await mount();
    fireEvent.click(cover(), { ctrlKey: true });
    fireEvent.click(cover('乙册'), { ctrlKey: true });
    fireEvent.click(within(card('丙册')).getByRole('heading'));
    expect(screen.getByLabelText('测试路径')).toHaveTextContent('/gallery/book_2');
    expect(picked()).toHaveLength(0);
  });

  it('plain cover activation clears selection instead of leaving it behind the reader', async () => {
    await mount();
    fireEvent.click(cover(), { ctrlKey: true });
    fireEvent.click(cover('乙册'), { ctrlKey: true });
    fireEvent.click(cover());
    expect(screen.getByLabelText('测试路径')).toHaveTextContent('/gallery/book_0');
    expect(picked()).toHaveLength(0);
  });

  it('blank shelf click clears selection; blank right-click keeps its batch target', async () => {
    await mount();
    fireEvent.click(cover(), { ctrlKey: true });
    fireEvent.click(cover('乙册'), { ctrlKey: true });
    fireEvent.contextMenu(root(), { clientX: 100, clientY: 250 });
    expect(screen.getByRole('menu')).toHaveTextContent('已选择 2 本');
    key('Escape');
    fireEvent.click(root());
    expect(picked()).toHaveLength(0);
  });

  it('right-click outside a multi-selection replaces only the menu target, not the persistent selection', async () => {
    await mount();
    fireEvent.click(cover(), { ctrlKey: true });
    fireEvent.click(cover('乙册'), { ctrlKey: true });
    fireEvent.contextMenu(card('丙册'));
    expect(screen.getByRole('menu')).toHaveTextContent('丙册');
    expect(picked()).toHaveLength(0);
    key('Escape');
    expect(picked()).toHaveLength(0);
  });

  it('Ctrl/Command right-click adds a target without toggling an already selected one off', async () => {
    await mount();
    fireEvent.click(cover(), { ctrlKey: true });
    fireEvent.contextMenu(card('乙册'), { ctrlKey: true });
    expect(picked()).toHaveLength(2);
    expect(screen.getByRole('menu')).toHaveTextContent('已选择 2 本');
    key('Escape');
    fireEvent.contextMenu(card('甲册'), { metaKey: true });
    expect(picked()).toHaveLength(2);
  });

  it('card-body Ctrl/Command and Shift clicks use the same ordered selection as the cover', async () => {
    await mount();
    fireEvent.click(within(card()).getByRole('heading'), { metaKey: true });
    fireEvent.click(within(card('丙册')).getByRole('heading'), { shiftKey: true });
    expect(picked()).toHaveLength(3);
    fireEvent.click(within(card('乙册')).getByRole('heading'), { ctrlKey: true });
    expect(picked()).toHaveLength(2);
    expect(card('乙册')).not.toHaveAttribute('aria-selected', 'true');
  });

  it('Space toggles a focused card; Enter opens it without leaving a selection', async () => {
    await mount();
    card().focus();
    key(' ');
    expect(picked()).toEqual([card()]);
    key('Enter');
    expect(screen.getByLabelText('测试路径')).toHaveTextContent('/gallery/book_0');
    expect(picked()).toHaveLength(0);
  });

  it('the single-selected album has a status and can be opened from shelf focus with Enter', async () => {
    await mount();
    fireEvent.click(cover(), { ctrlKey: true });
    expect(screen.getByText('已选择 1 本')).toBeInTheDocument();
    root().focus();
    key('Enter');
    expect(screen.getByLabelText('测试路径')).toHaveTextContent('/gallery/book_0');
  });

  it('Escape and select-all work in the showcase too, without switching the presentation layout', async () => {
    await mount('showcase');
    fireEvent.contextMenu(card());
    expect(screen.getByRole('menu')).toBeInTheDocument();
    key('Escape');
    expect(card()).toHaveFocus();
    key(' ', { ctrlKey: true });
    expect(picked()).toHaveLength(1);
    expect(useUI.getState().worksView).toBe('showcase');
    expect(card()).toHaveClass('shelf-exhibit');
    key('Escape');
    expect(picked()).toHaveLength(0);
  });

  it('does not delete from Backspace, modified Delete, or a field; Delete still asks for confirmation', async () => {
    await mount();
    fireEvent.click(cover(), { ctrlKey: true });
    key('Backspace');
    key('Delete', { ctrlKey: true });
    key('Delete', { altKey: true });
    const search = screen.getByRole('searchbox');
    search.focus();
    key('Delete');
    key('a', { ctrlKey: true });
    key('Escape');
    expect(confirm).not.toHaveBeenCalled();
    expect(picked()).toHaveLength(1);
    root().focus();
    key('Delete');
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('blocks shelf shortcuts while a context menu or another dialog is open', async () => {
    await mount();
    fireEvent.click(cover(), { ctrlKey: true });
    fireEvent.contextMenu(card());
    key('a', { ctrlKey: true });
    key('Delete');
    expect(picked()).toHaveLength(1);
    expect(confirm).not.toHaveBeenCalled();
    key('Escape');
    const dialog = document.createElement('dialog');
    dialog.open = true;
    document.body.append(dialog);
    try {
      key('a', { ctrlKey: true });
      key('Delete');
      key('Escape');
      expect(picked()).toHaveLength(1);
      expect(confirm).not.toHaveBeenCalled();
    } finally {
      dialog.remove();
    }
  });

  it('keeps star/menu controls out of desktop selection and removes selection when filtering hides its album', async () => {
    await mount();
    fireEvent.click(cover(), { ctrlKey: true });
    fireEvent.click(within(card('乙册')).getByRole('button', { name: '星标收藏' }));
    expect(picked()).toEqual([card()]);
    expect(useUI.getState().starred).toEqual(['book_1']);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '丙册' } });
    expect(picked()).toHaveLength(0);
    expect(screen.queryByText('已选择 1 本')).toBeNull();
  });
});

class Pointer extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'mouse';
  }
}
function positions() {
  vi.stubGlobal('PointerEvent', Pointer);
  const rect = (x: number, y: number, width: number, height: number) => ({
    x,
    y,
    width,
    height,
    left: x,
    right: x + width,
    top: y,
    bottom: y + height,
    toJSON: () => ({}),
  });
  vi.spyOn(root(), 'getBoundingClientRect').mockReturnValue(rect(0, 0, 600, 500));
  ['甲册', '乙册', '丙册'].forEach((name, i) =>
    vi
      .spyOn(card(name), 'getBoundingClientRect')
      .mockReturnValue(rect(20 + i * 120, 100, 100, 100)),
  );
}
const pointer = { pointerId: 1, pointerType: 'mouse', button: 0 };

describe('shelf marquee and touch fallback', () => {
  it('drags from a cover, keeps the status layout still, and suppresses the release click', async () => {
    await mount();
    positions();
    fireEvent.pointerDown(cover(), { ...pointer, clientX: 30, clientY: 110 });
    fireEvent.pointerMove(window, { ...pointer, clientX: 235, clientY: 190 });
    expect(picked()).toEqual([card('甲册'), card('乙册')]);
    expect(document.querySelector('.shelf-marquee')).toBeInTheDocument();
    expect(screen.queryByText('已选择 2 本')).toBeNull();
    fireEvent.pointerUp(window, pointer);
    fireEvent.click(cover(), { detail: 1 });
    expect(screen.getByLabelText('测试路径')).toHaveTextContent(/^\/gallery$/);
    expect(document.querySelector('.shelf-marquee')).toBeNull();
    expect(screen.getByText('已选择 2 本')).toBeInTheDocument();
  });

  it('Ctrl-drag adds to a previous selection; pointer cancellation restores the snapshot', async () => {
    await mount();
    positions();
    fireEvent.click(cover('丙册'), { ctrlKey: true });
    fireEvent.pointerDown(cover(), { ...pointer, ctrlKey: true, clientX: 30, clientY: 110 });
    fireEvent.pointerMove(window, { ...pointer, clientX: 235, clientY: 190 });
    expect(picked()).toHaveLength(3);
    fireEvent.pointerCancel(window, pointer);
    expect(picked()).toEqual([card('丙册')]);
    expect(document.querySelector('.shelf-marquee')).toBeNull();
  });

  it('Escape cancels an in-progress drag and clears selection, without accidentally opening the release target', async () => {
    await mount();
    positions();
    fireEvent.click(cover('丙册'), { ctrlKey: true });
    fireEvent.pointerDown(cover(), { ...pointer, clientX: 30, clientY: 110 });
    fireEvent.pointerMove(window, { ...pointer, clientX: 235, clientY: 190 });
    key('Delete');
    expect(confirm).not.toHaveBeenCalled();
    key('Escape');
    fireEvent.pointerUp(window, pointer);
    fireEvent.click(cover(), { detail: 1 });
    expect(picked()).toHaveLength(0);
    expect(screen.getByLabelText('测试路径')).toHaveTextContent(/^\/gallery$/);
    expect(document.body).not.toHaveClass('shelf-marquee-active');
  });

  it('Escape cancels a mouse-down even before the marquee threshold', async () => {
    await mount();
    positions();
    fireEvent.pointerDown(cover(), { ...pointer, clientX: 30, clientY: 110 });
    key('Escape');
    fireEvent.pointerUp(window, pointer);
    fireEvent.click(cover(), { detail: 1 });
    expect(screen.getByLabelText('测试路径')).toHaveTextContent(/^\/gallery$/);
  });

  it('does not turn touch scrolling or star-button drags into a marquee', async () => {
    await mount();
    positions();
    fireEvent.pointerDown(cover(), { ...pointer, pointerType: 'touch', clientX: 30, clientY: 110 });
    fireEvent.pointerMove(window, { ...pointer, pointerType: 'touch', clientX: 235, clientY: 190 });
    fireEvent.pointerUp(window, { ...pointer, pointerType: 'touch' });
    const star = within(card()).getByRole('button', { name: '星标收藏' });
    fireEvent.pointerDown(star, { ...pointer, clientX: 30, clientY: 110 });
    fireEvent.pointerMove(window, { ...pointer, clientX: 235, clientY: 190 });
    fireEvent.pointerUp(window, pointer);
    expect(picked()).toHaveLength(0);
    expect(document.querySelector('.shelf-marquee')).toBeNull();
  });

  it('keeps the explicit tap-to-select mode for coarse pointers, but not as a desktop requirement', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(pointer: coarse)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    await mount();
    fireEvent.click(screen.getByRole('button', { name: '批量管理' }));
    fireEvent.click(cover());
    expect(picked()).toHaveLength(1);
    expect(screen.getByLabelText('测试路径')).toHaveTextContent(/^\/gallery$/);
    key('Escape');
    expect(picked()).toHaveLength(0);
    expect(screen.getByRole('button', { name: '批量管理' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});
