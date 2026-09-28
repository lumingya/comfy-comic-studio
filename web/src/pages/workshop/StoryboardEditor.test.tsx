import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { episode, series } from '../../test/fixtures';
import { mockFetch, renderWithProviders } from '../../test/utils';
import type { Episode } from '../../api/types';
import StoryboardEditor from './StoryboardEditor';
let ep: Episode;
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
