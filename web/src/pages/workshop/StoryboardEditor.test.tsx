import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { episode, series } from '../../test/fixtures';
import { mockFetch, renderWithProviders } from '../../test/utils';
import type { Episode } from '../../api/types';
import { useToasts } from '../../components/toast';
import StoryboardEditor from './StoryboardEditor';
const toasts = () => useToasts.getState().items.map((i) => i.text);
let ep: Episode;
vi.mock('../../components/confirm', () => ({ confirm: vi.fn().mockResolvedValue(true) }));
vi.mock('../episode/EpisodePage', () => ({ useEpisodeContext: () => ({ episode: ep, series }) }));
beforeEach(() => {
  ep = structuredClone(episode);
  ep.id = 'sb_test';
});
afterEach(() => vi.unstubAllGlobals());
const prompt = () => document.getElementById('workshop-frame-prompt') as HTMLTextAreaElement;
const negative = () => document.getElementById('workshop-frame-negative') as HTMLTextAreaElement;
const rows = () => [
  ...document.querySelectorAll<HTMLButtonElement>('.workshop-frames-list [data-selection-id]'),
];
function start(fail = false) {
  const calls = mockFetch({
    'GET /api/workshop': series,
    'PATCH /api/episodes/sb_test/panels/p0': (body: unknown) => {
      if (fail) return new Response(JSON.stringify({ detail: 'offline' }), { status: 503 });
      const changes = (body as { changes: object }).changes;
      ep = {
        ...ep,
        revision: ep.revision + 1,
        panels: ep.panels.map((p) => (p.id === 'p0' ? { ...p, ...changes } : p)),
      };
      return ep;
    },
  });
  renderWithProviders(<StoryboardEditor />);
  return calls;
}
describe('storyboard editing recovery', () => {
  it('saves prompt and negative from one coherent draft instead of overwriting the previous override', async () => {
    const calls = start();
    fireEvent.change(prompt(), { target: { value: 'new prompt' } });
    fireEvent.change(negative(), { target: { value: 'new negative' } });
    fireEvent.blur(negative());
    await waitFor(() => expect(ep.panels[0].overrides.raw_negative).toBe('new negative'));
    expect(ep.panels[0].overrides.raw_prompt).toBe('new prompt');
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });
  it('flushes the last keystroke before switching frames', async () => {
    start();
    fireEvent.change(prompt(), { target: { value: 'last keystroke' } });
    fireEvent.click(rows()[1]);
    await waitFor(() =>
      expect(document.querySelector('[data-editor-key]')).toHaveAttribute('data-editor-key', 'p1'),
    );
    expect(ep.panels[0].overrides.raw_prompt).toBe('last keystroke');
  });
  it('stays on the original frame with its input when saving fails', async () => {
    const calls = start(true);
    fireEvent.change(prompt(), { target: { value: 'keep me' } });
    fireEvent.click(rows()[1]);
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'PATCH').length).toBeGreaterThan(0),
    );
    await screen.findByText(/保存失败/);
    expect(document.querySelector('[data-editor-key]')).toHaveAttribute('data-editor-key', 'p0');
    expect(prompt()).toHaveValue('keep me');
  });
  it('edits the caption it displays rather than creating a second, contradictory line', async () => {
    start();
    const text = document.getElementById('workshop-frame-caption')!;
    fireEvent.change(text, { target: { value: 'new dialogue' } });
    fireEvent.blur(text);
    await waitFor(() => expect(ep.panels[0].dialogues[0].text).toBe('new dialogue'));
    expect(ep.panels[0].dialogues).toHaveLength(1);
    expect(ep.panels[0].dialogues[0].kind).toBe('speech');
  });
  it('gives frame right-click a temporary target and supports range selection plus Escape', () => {
    start();
    fireEvent.contextMenu(rows()[1]);
    expect(rows()[1]).toHaveClass('is-context');
    expect(rows()[1]).not.toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(rows()[1]).toHaveFocus();
    expect(rows()[1]).not.toHaveClass('is-context');
    fireEvent.click(rows()[0], { ctrlKey: true });
    fireEvent.click(rows()[1], { shiftKey: true });
    expect(rows().filter((r) => r.getAttribute('aria-selected') === 'true')).toHaveLength(2);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(rows().filter((r) => r.getAttribute('aria-selected') === 'true')).toHaveLength(0);
  });
});

describe('adding frames (legacy workshop-add-frame / batchFramesModal)', () => {
  const routes = () => ({
    'GET /api/workshop': series,
    'POST /api/episodes/sb_test/panels': (body: unknown) => {
      const { panel } = body as { panel: { description: string } };
      ep = {
        ...ep,
        panels: [...ep.panels, { ...ep.panels[0], id: 'p_new', order: 99, ...panel }],
      };
      return ep;
    },
    'POST /api/episodes/sb_test/panels/import': (body: unknown) => {
      const { panels } = body as { panels: { description: string }[] };
      ep = {
        ...ep,
        panels: [
          ...ep.panels,
          ...panels.map((p, i) => ({ ...ep.panels[0], id: `p_b${i}`, order: 10 + i, ...p })),
        ],
      };
      return ep;
    },
    'PATCH /api/episodes/sb_test': (body: unknown) => {
      ep = { ...ep, ...(body as object) };
      return ep;
    },
  });

  it('「新增分幕」 appends a blank 「第 N 幕」 at the end, even with an earlier frame open', async () => {
    const calls = mockFetch(routes());
    renderWithProviders(<StoryboardEditor />);
    fireEvent.click(screen.getByRole('button', { name: '新增分幕' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toMatchObject({
      after: null,
      panel: { description: '第 3 幕', overrides: { raw_prompt: '' } },
    });
  });

  it('prefills the common prompt start, appends the batch and remembers the template', async () => {
    ep.panels = ep.panels.map((p, i) => ({
      ...p,
      overrides: { ...p.overrides, raw_prompt: `{character}, {style}, shot ${i}` },
    }));
    const calls = mockFetch(routes());
    renderWithProviders(<StoryboardEditor />);
    fireEvent.click(screen.getByRole('button', { name: '批量新增…' }));
    const dialog = await screen.findByRole('dialog', { name: '批量新增分幕' });
    expect(dialog).toHaveTextContent('最多还可新增 510 幕。');
    expect(document.getElementById('batch-frames-base')).toHaveValue('{character}, {style}, ');
    expect(dialog).toHaveTextContent('已按现有分幕的共同开头预填。');
    fireEvent.change(document.getElementById('batch-frames-count')!, { target: { value: '2' } });
    fireEvent.change(document.getElementById('batch-frames-pattern')!, {
      target: { value: '镜头 {n}' },
    });
    fireEvent.click(screen.getByRole('button', { name: '新增分幕' }));
    await waitFor(() => expect(ep.base_prompt).toBe('{character}, {style}, '));
    const imported = calls.find((c) => c.url.endsWith('/panels/import'))!;
    expect(imported.body).toEqual({
      after: null,
      panels: [
        { description: '镜头 3', overrides: { raw_prompt: '{character}, {style}, ' } },
        { description: '镜头 4', overrides: { raw_prompt: '{character}, {style}, ' } },
      ],
    });
    await waitFor(() => expect(toasts()).toContain('已新增 2 个分幕'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('refuses a count beyond the frames left', async () => {
    mockFetch(routes());
    renderWithProviders(<StoryboardEditor />);
    fireEvent.click(screen.getByRole('button', { name: '批量新增…' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(document.getElementById('batch-frames-count')!, { target: { value: '600' } });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('最多还可新增 510 幕。');
    expect(within(dialog).getByRole('button', { name: '新增分幕' })).toBeDisabled();
  });
});

describe('负向「应用到所有分幕」', () => {
  it('saves the open frame first, then applies the typed negative to every frame', async () => {
    const order: string[] = [];
    mockFetch({
      'GET /api/workshop': series,
      'PATCH /api/episodes/sb_test/panels/p0': (body: unknown) => {
        order.push('patch');
        const changes = (body as { changes: { overrides?: object } }).changes;
        ep = {
          ...ep,
          panels: ep.panels.map((p) =>
            p.id === 'p0' ? { ...p, overrides: { ...p.overrides, ...changes.overrides } } : p,
          ),
        };
        return ep;
      },
      'POST /api/episodes/sb_test/panels/batch': (body: unknown) => {
        order.push('batch');
        const { changes } = body as { changes: { overrides: object } };
        ep = {
          ...ep,
          panels: ep.panels.map((p) => ({
            ...p,
            overrides: { ...p.overrides, ...changes.overrides },
          })),
        };
        return ep;
      },
    });
    renderWithProviders(<StoryboardEditor />);
    fireEvent.change(prompt(), { target: { value: 'typed prompt' } });
    fireEvent.change(negative(), { target: { value: 'blurry' } });
    fireEvent.click(screen.getByRole('button', { name: '应用到所有分幕' }));
    await waitFor(() => expect(toasts()).toContain('负向提示词已应用到 2 个分幕'));
    expect(order).toEqual(['patch', 'batch']);
    expect(ep.panels.map((p) => p.overrides.raw_negative)).toEqual(['blurry', 'blurry']);
    expect(ep.panels[0].overrides.raw_prompt).toBe('typed prompt');
  });
});

describe('bulk delete (legacy workshop-frame-delete-bulk)', () => {
  const routes = () => ({
    'GET /api/workshop': series,
    'POST /api/episodes/sb_test/panels/batch-delete': (body: unknown) => {
      const { panel_ids } = body as { panel_ids: string[] };
      ep = { ...ep, panels: ep.panels.filter((p) => !panel_ids.includes(p.id!)) };
      return ep;
    },
    'POST /api/episodes/sb_test/panels/import': (body: unknown) => {
      const { panels } = body as { panels: object[] };
      ep = {
        ...ep,
        panels: [
          ...ep.panels,
          ...panels.map(
            (p, i) => ({ ...p, id: `back${i}`, order: 50 + i }) as Episode['panels'][0],
          ),
        ],
      };
      return ep;
    },
    'POST /api/episodes/sb_test/panels/reorder': (body: unknown) => {
      const { order } = body as { order: string[] };
      ep = {
        ...ep,
        panels: ep.panels.map((p) => ({ ...p, order: order.indexOf(p.id!) })),
      };
      return ep;
    },
  });

  it('refuses to delete every frame', async () => {
    const calls = mockFetch(routes());
    renderWithProviders(<StoryboardEditor />);
    fireEvent.click(rows()[0], { ctrlKey: true });
    fireEvent.click(rows()[1], { shiftKey: true });
    fireEvent.keyDown(document.activeElement!, { key: 'Delete' });
    await waitFor(() => expect(toasts()).toContain('分镜至少保留一幕。'));
    expect(calls.some((c) => c.url.includes('batch-delete'))).toBe(false);
  });

  it('can be undone: the frames come back where they were', async () => {
    const calls = mockFetch(routes());
    renderWithProviders(<StoryboardEditor />);
    fireEvent.click(rows()[0], { ctrlKey: true });
    fireEvent.keyDown(document.activeElement!, { key: 'Delete' });
    await waitFor(() => expect(toasts()).toContain('已删除 1 幕分镜'));
    const undo = useToasts.getState().items.find((i) => i.text === '已删除 1 幕分镜')!;
    undo.action!.onClick();
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/panels/reorder'))).toBe(true));
    const reorder = calls.find((c) => c.url.endsWith('/panels/reorder'))!;
    expect(reorder.body).toMatchObject({ order: ['back0', 'p1'] });
  });
});
