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
    fireEvent.click(screen.getByRole('switch'));
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
});
