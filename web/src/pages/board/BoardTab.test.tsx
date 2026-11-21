import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assetUrl } from '../../api/client';
import type { ActiveItem } from '../../api/jobs';
import type { Episode } from '../../api/types';
import { useUI } from '../../app/ui-store';
import { episode, series, take } from '../../test/fixtures';
import { renderWithProviders } from '../../test/utils';
import BoardTab from './BoardTab';

const actions = vi.hoisted(() => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  render: vi.fn(),
}));
let ep: Episode;
let pending: Record<string, ActiveItem[]>;
vi.mock('../episode/EpisodePage', () => ({ useEpisodeContext: () => ({ episode: ep, series }) }));
vi.mock('../../api/production', () => ({
  useRender: () => ({ mutate: actions.render, isPending: false }),
}));
vi.mock('../../api/series', () => ({
  useTakeAction: () => ({ mutate: actions.mutate, mutateAsync: actions.mutateAsync }),
}));
vi.mock('../../api/jobs', async (original) => ({
  ...(await original<typeof import('../../api/jobs')>()),
  // Like the real hook, reconstruct active records on every render.
  useActiveRenders: () => ({ byPanel: structuredClone(pending) }),
}));
vi.mock('../../api/client', async (original) => {
  const client = await original<typeof import('../../api/client')>();
  return { ...client, assetUrl: vi.fn(client.assetUrl) };
});

beforeEach(() => {
  vi.clearAllMocks();
  useUI.setState({ showRejected: false });
  pending = {};
  ep = {
    ...structuredClone(episode),
    panels: Array.from({ length: 3 }, (_, index) => ({
      ...structuredClone(episode.panels[0]),
      id: `p${index}`,
      order: index,
      description: `Panel ${index + 1}`,
    })),
    takes: Array.from({ length: 12 }, (_, index) => ({
      ...take(`t${index}`, `p${Math.floor(index / 4)}`, 'candidate'),
      created_at: `2026-11-16T10:00:${String(index).padStart(2, '0')}`,
    })),
  };
});

const cards = () => [...document.querySelectorAll<HTMLElement>('.take[data-selection-id]')];
const selected = () => cards().filter((card) => card.getAttribute('aria-selected') === 'true');
const thumbnailsRendered = () =>
  vi.mocked(assetUrl).mock.calls.filter(([, width]) => width === 480);
const imageButton = (card: HTMLElement) => card.querySelector<HTMLButtonElement>('.take-image')!;

describe('candidate board updates', () => {
  it('opens and browses across panels without rerendering the mounted thumbnail cards', () => {
    renderWithProviders(<BoardTab />);
    expect(cards()).toHaveLength(12);
    const renders = thumbnailsRendered().length;
    expect(renders).toBe(12);

    // Newest first within each panel; all panels participate in the zoom order.
    expect(cards().map((card) => card.dataset.selectionId)).toEqual([
      't3',
      't2',
      't1',
      't0',
      't7',
      't6',
      't5',
      't4',
      't11',
      't10',
      't9',
      't8',
    ]);
    fireEvent.click(imageButton(cards()[3]));
    expect(within(screen.getByRole('dialog')).getByRole('presentation')).toHaveAttribute(
      'src',
      expect.stringContaining('asset_t0'),
    );
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(within(screen.getByRole('dialog')).getByRole('presentation')).toHaveAttribute(
      'src',
      expect.stringContaining('asset_t7'),
    );
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(within(screen.getByRole('dialog')).getByRole('presentation')).toHaveAttribute(
      'src',
      expect.stringContaining('asset_t0'),
    );
    expect(thumbnailsRendered()).toHaveLength(renders);
    expect(cards()).toHaveLength(12);
  });

  it('keeps Ctrl/Shift and select-all across rows, updating only changed thumbnails', () => {
    renderWithProviders(<BoardTab />);
    const initial = thumbnailsRendered().length;
    fireEvent.click(imageButton(cards()[0]), { ctrlKey: true });
    expect(selected()).toHaveLength(1);
    expect(
      new Set(
        thumbnailsRendered()
          .slice(initial)
          .map(([id]) => id),
      ),
    ).toEqual(new Set(['asset_t3']));
    fireEvent.click(imageButton(cards()[5]), { shiftKey: true });
    expect(selected().map((card) => card.dataset.selectionId)).toEqual([
      't3',
      't2',
      't1',
      't0',
      't7',
      't6',
    ]);
    expect(
      new Set(
        thumbnailsRendered()
          .slice(initial)
          .map(([id]) => id),
      ),
    ).toEqual(new Set(['asset_t3', 'asset_t2', 'asset_t1', 'asset_t0', 'asset_t7', 'asset_t6']));
    fireEvent.keyDown(document.activeElement!, { key: 'a', ctrlKey: true });
    expect(selected()).toHaveLength(12);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(selected()).toHaveLength(0);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('updates live takes, hidden rejects, pending rows and action targets after memoization', () => {
    const view = renderWithProviders(<BoardTab />);
    fireEvent.click(imageButton(cards()[0]));
    ep = {
      ...ep,
      takes: ep.takes.map((item) => (item.id === 't3' ? { ...item, status: 'adopted' } : item)),
    };
    view.rerender(<BoardTab />);
    expect(cards()[0]).toHaveClass('adopted');
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: '已采用' }),
    ).toBeDisabled();
    fireEvent.keyDown(window, { key: 'x' });
    expect(actions.mutate).toHaveBeenLastCalledWith(
      { takeId: 't3', action: 'reject' },
      expect.anything(),
    );
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));

    ep = {
      ...ep,
      takes: [
        ...ep.takes.map((item) =>
          item.id === 't3' ? { ...item, status: 'rejected' as const } : item,
        ),
        { ...take('variant', 'p0', 'candidate'), variant_id: 'variant-1' },
      ],
    };
    pending = {
      p1: [{ jobId: 'job', idx: 0, state: 'running', label: 'Rendering', variantId: null }],
    };
    view.rerender(<BoardTab />);
    expect(cards()).toHaveLength(11);
    expect(document.querySelector('.take.pending')).toHaveClass('running');
    fireEvent.click(screen.getByRole('switch', { name: '显示弃用的候选' }));
    expect(cards()).toHaveLength(12);
    expect(cards()[0]).toHaveClass('rejected');
    fireEvent.click(within(cards()[0]).getByRole('button', { name: '撤销弃用' }));
    expect(actions.mutate).toHaveBeenLastCalledWith(
      { takeId: 't3', action: 'restore' },
      expect.anything(),
    );
    pending = { p1: [{ ...pending.p1[0], state: 'uncertain' }] };
    view.rerender(<BoardTab />);
    expect(document.querySelector('.take.pending')).toHaveClass('uncertain');
  });

  it('filters unadopted panels with stable numbering, ignoring adopted variants', () => {
    ep.takes[0].status = 'adopted';
    ep.takes.push({ ...take('variant', 'p1', 'adopted'), variant_id: 'variant-1' });
    const view = renderWithProviders(<BoardTab />);
    fireEvent.click(screen.getByRole('switch', { name: '未采用分幕' }));
    expect(cards()).toHaveLength(8);
    expect([...document.querySelectorAll('.panel-no')].map((node) => node.textContent)).toEqual([
      '02',
      '03',
    ]);
    fireEvent.click(imageButton(cards()[0]));
    fireEvent.keyDown(window, { key: 'a' });
    expect(actions.mutate).toHaveBeenLastCalledWith(
      { takeId: 't7', action: 'adopt' },
      expect.anything(),
    );
    ep = {
      ...ep,
      takes: ep.takes.map((item) => (item.id === 't7' ? { ...item, status: 'adopted' } : item)),
    };
    view.rerender(<BoardTab />);
    expect(cards()).toHaveLength(4);
    // After the current panel leaves the filter, Next starts at the next visible candidate.
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(within(screen.getByRole('dialog')).getByRole('presentation')).toHaveAttribute(
      'src',
      expect.stringContaining('asset_t11'),
    );
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    ep = {
      ...ep,
      takes: ep.takes.map((item) => (item.id === 't11' ? { ...item, status: 'adopted' } : item)),
    };
    view.rerender(<BoardTab />);
    expect(cards()).toHaveLength(0);
    expect(screen.getByText('所有分幕均已采用画面')).toBeInTheDocument();
  });

  it('compares original images within one panel and acts only on the explicitly selected side', () => {
    renderWithProviders(<BoardTab />);
    const renders = thumbnailsRendered().length;
    fireEvent.click(imageButton(cards()[0]));
    fireEvent.click(screen.getByRole('button', { name: '对比 C' }));
    const left = screen.getByRole('img', { name: '固定候选' });
    const right = screen.getByRole('img', { name: '浏览候选' });
    expect(left).toHaveAttribute('src', expect.stringContaining('asset_t3'));
    expect(right).toHaveAttribute('src', expect.stringContaining('asset_t2'));
    expect(actions.mutate).not.toHaveBeenCalled();
    expect(vi.mocked(assetUrl)).toHaveBeenCalledWith('asset_t3');
    expect(vi.mocked(assetUrl)).toHaveBeenCalledWith('asset_t2');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(right).toHaveAttribute('src', expect.stringContaining('asset_t1'));
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(right).toHaveAttribute('src', expect.stringContaining('asset_t2'));
    expect(left).toHaveAttribute('src', expect.stringContaining('asset_t3'));
    fireEvent.keyDown(window, { key: '1' });
    fireEvent.keyDown(window, { key: 'a' });
    expect(actions.mutate).toHaveBeenLastCalledWith(
      { takeId: 't3', action: 'adopt' },
      expect.anything(),
    );
    fireEvent.click(screen.getByRole('button', { name: '2 浏览候选' }));
    fireEvent.keyDown(window, { key: 'x' });
    expect(actions.mutate).toHaveBeenLastCalledWith(
      { takeId: 't2', action: 'reject' },
      expect.anything(),
    );
    const splitSlider = document.querySelector<HTMLInputElement>(
      '.board-split-controls input[type="range"]',
    )!;
    expect(splitSlider).toHaveValue('50');
    const dividerHandle = document.querySelector<HTMLButtonElement>('.board-split-handle')!;
    fireEvent.keyDown(dividerHandle, { key: 'ArrowRight' });
    expect(dividerHandle).toHaveAttribute('aria-valuenow', '52');
    fireEvent.keyDown(splitSlider, { key: 'ArrowRight' });
    expect(splitSlider).toHaveValue('54');
    fireEvent.change(splitSlider, { target: { value: '64' } });
    expect(document.querySelector('.board-split-divider')).toHaveStyle({ left: '64%' });
    fireEvent.keyDown(dividerHandle, { key: 'ArrowLeft' });
    expect(dividerHandle).toHaveAttribute('aria-valuenow', '62');
    const zoomSlider = document.querySelectorAll<HTMLInputElement>(
      '.board-split-controls input[type="range"]',
    )[1];
    fireEvent.change(zoomSlider, { target: { value: '2' } });
    expect(document.querySelectorAll('.board-split-frame')).toHaveLength(2);
    for (const frame of document.querySelectorAll('.board-split-frame'))
      expect(frame).toHaveStyle({ transform: 'translate(0px, 0px) scale(2)' });
    fireEvent.click(
      screen.getByRole('button', { name: /采用.*固定候选|board\.adopt.*board\.compareReference/ }),
    );
    expect(actions.mutate).toHaveBeenLastCalledWith(
      { takeId: 't3', action: 'adopt' },
      expect.anything(),
    );
    fireEvent.click(screen.getByRole('button', { name: /并排对比|board\.compareSideBySide/ }));
    fireEvent.click(screen.getByRole('button', { name: '原图细节' }));
    expect(document.querySelector('.board-compare')).toHaveAttribute('data-detail', 'true');
    const viewport = screen.getByRole('region', { name: '固定候选' });
    fireEvent.keyDown(viewport, { key: 'ArrowRight' });
    expect(right).toHaveAttribute('src', expect.stringContaining('asset_t2'));
    fireEvent.keyDown(window, { key: 'c' });
    expect(screen.queryByRole('img', { name: '固定候选' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByRole('presentation')).toHaveAttribute(
      'src',
      expect.stringContaining('asset_t2'),
    );
    expect(thumbnailsRendered()).toHaveLength(renders);
  });

  it('disables comparison when a panel has only one visible candidate', () => {
    ep.takes = [
      take('only', 'p0', 'candidate'),
      take('hidden', 'p0', 'rejected'),
      {
        ...take('variant', 'p0', 'candidate'),
        variant_id: 'variant-1',
      },
    ];
    renderWithProviders(<BoardTab />);
    fireEvent.click(imageButton(cards()[0]));
    expect(screen.getByRole('button', { name: '对比 C' })).toBeDisabled();
    fireEvent.keyDown(window, { key: 'c' });
    expect(document.querySelector('.board-compare')).not.toBeInTheDocument();
    expect(actions.mutate).not.toHaveBeenCalled();
  });
});
