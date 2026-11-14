import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { StripStage } from './StripStage';
import type { Strip } from '../../api/types';
import i18n from '../../i18n';
import { episode, series } from '../../test/fixtures';
import { mockFetch } from '../../test/utils';
import CanvasTab from './CanvasTab';
vi.mock('../episode/EpisodePage', () => ({ useEpisodeContext: () => ({ episode, series }) }));
vi.mock('./useImage', () => ({ useImage: () => ({ width: 1600, height: 900 }) }));
vi.mock('./StripStage', () => ({
  StripStage: (props: ComponentProps<typeof StripStage>) => (
    <div>
      <button onClick={() => props.onSelect({ type: 'panel', id: 'p0' })}>select panel</button>
      <button onClick={() => props.onPanelBox('p0', [0, 200, 800, 1267])}>move panel</button>
      <button onClick={() => props.onSelect(null)}>deselect</button>
      <output data-testid="strip">{JSON.stringify(props.strip)}</output>
    </div>
  ),
}));
afterEach(() => vi.unstubAllGlobals());
const report = {
  problems: 0,
  missing: [],
  face_hits: [],
  overlaps: [],
  order: [],
  outside: [],
  cut: [],
};
function mount(routes: Record<string, unknown> = {}) {
  const calls = mockFetch({ 'GET /api/episodes/ep_1/strip/report': report, ...routes });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter([{ path: '/', element: <CanvasTab /> }]);
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return calls;
}
describe('canvas save and layout ordering', () => {
  it('does not silently relayout the server while a different local layout is unsaved', () => {
    const calls = mount();
    fireEvent.change(screen.getByLabelText(i18n.t('canvas.width')), { target: { value: '900' } });
    const relayout = screen.getByRole('button', { name: i18n.t('canvas.relayoutAll') });
    expect(relayout).toBeDisabled();
    fireEvent.click(relayout);
    expect(calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });
  it('keeps edits made during an in-flight save dirty and visible', async () => {
    let finish!: (value: unknown) => void;
    const calls = mount({
      'PUT /api/episodes/ep_1/strip': () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const width = screen.getByLabelText(i18n.t('canvas.width'));
    fireEvent.change(width, { target: { value: '900' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    fireEvent.change(width, { target: { value: '1000' } });
    finish(calls.find((c) => c.method === 'PUT')!.body);
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled());
    expect(width).toHaveValue(1000);
    expect(screen.getByText(i18n.t('canvas.unsaved'))).toBeInTheDocument();
  });

  it('allows undo across a save and redo to the clean checkpoint', async () => {
    mount({ 'PUT /api/episodes/ep_1/strip': { ...episode.strip, width: 900 } });
    const width = screen.getByLabelText(i18n.t('canvas.width'));
    fireEvent.change(width, { target: { value: '900' } });
    const save = screen.getByRole('button', { name: i18n.t('common.save') });
    fireEvent.click(save);
    await waitFor(() => expect(screen.queryByText(i18n.t('canvas.unsaved'))).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: i18n.t('canvas.undo') }));
    expect(width).toHaveValue(800);
    expect(save).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('canvas.redo') }));
    expect(width).toHaveValue(900);
    expect(save).toBeDisabled();
  });

  it('keeps an undo made during save dirty when the request completes', async () => {
    let finish!: (value: unknown) => void;
    const calls = mount({
      'PUT /api/episodes/ep_1/strip': () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const width = screen.getByLabelText(i18n.t('canvas.width'));
    fireEvent.change(width, { target: { value: '900' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.save') }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    fireEvent.click(screen.getByRole('button', { name: i18n.t('canvas.undo') }));
    finish(calls.find((c) => c.method === 'PUT')!.body);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: i18n.t('common.save') })).toBeEnabled(),
    );
    expect(width).toHaveValue(800);
  });

  it('retains the draft and undo history after a failed save', async () => {
    mount({
      'PUT /api/episodes/ep_1/strip': () => {
        throw new Error('offline');
      },
    });
    const width = screen.getByLabelText(i18n.t('canvas.width'));
    fireEvent.change(width, { target: { value: '900' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.save') }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: i18n.t('common.save') })).toBeEnabled(),
    );
    expect(width).toHaveValue(900);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('canvas.undo') }));
    expect(width).toHaveValue(800);
  });

  it('keeps edits made while layout runs and acknowledges the new server geometry', async () => {
    let finish!: (value: unknown) => void;
    mount({
      'POST /api/episodes/ep_1/strip/layout': () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('canvas.relayoutAll') }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    const width = screen.getByLabelText(i18n.t('canvas.width'));
    fireEvent.change(width, { target: { value: '900' } });
    expect(screen.getByRole('button', { name: i18n.t('common.save') })).toBeDisabled();
    finish({ ...episode.strip, height: 1800 });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: i18n.t('common.save') })).toBeEnabled(),
    );
    expect(width).toHaveValue(900);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('canvas.undo') }));
    expect(JSON.parse(screen.getByTestId('strip').textContent!).height).toBe(1800);
    expect(screen.queryByText(i18n.t('canvas.unsaved'))).toBeNull();
  });

  it('undoes moves and lettering deletion; a fresh edit discards the redo branch', () => {
    mount();
    const strip = (): Strip => JSON.parse(screen.getByTestId('strip').textContent!);
    fireEvent.click(screen.getByRole('button', { name: 'move panel' }));
    expect(strip().panel_boxes.p0[1]).toBe(200);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('canvas.addText') }));
    const id = strip().lettering.at(-1)!.id;
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.delete') }));
    expect(strip().lettering.some((l) => l.id === id)).toBe(false);
    const undo = screen.getByRole('button', { name: i18n.t('canvas.undo') });
    fireEvent.click(undo);
    expect(strip().lettering.some((l) => l.id === id)).toBe(true);
    fireEvent.click(undo);
    fireEvent.click(undo);
    expect(strip().panel_boxes.p0).toEqual(episode.strip.panel_boxes.p0);
    expect(screen.queryByText(i18n.t('canvas.unsaved'))).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('canvas.addText') }));
    expect(screen.getByRole('button', { name: i18n.t('canvas.redo') })).toBeDisabled();
  });

  it('frames an image without stretching, saves the crop, and can undo reset', async () => {
    const calls = mount({ 'PUT /api/episodes/ep_1/strip': () => strip() });
    const strip = (): Strip => JSON.parse(screen.getByTestId('strip').textContent!);
    fireEvent.click(screen.getByRole('button', { name: 'select panel' }));
    fireEvent.change(screen.getByLabelText(i18n.t('canvas.cropZoom')), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(i18n.t('canvas.cropX')), { target: { value: '1' } });
    const crop = strip().crops.p0;
    expect(crop[2]).toBeCloseTo(1);
    expect(((crop[2] - crop[0]) * 1600) / ((crop[3] - crop[1]) * 900)).toBeCloseTo(800 / 1067);
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.save') }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect((calls.find((c) => c.method === 'PUT')!.body as Strip).crops.p0).toEqual(crop);
    await waitFor(() => expect(screen.queryByText(i18n.t('canvas.unsaved'))).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: i18n.t('canvas.cropReset') }));
    expect(strip().crops.p0).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('canvas.undo') }));
    expect(strip().crops.p0).toEqual(crop);
    expect(screen.queryByText(i18n.t('canvas.unsaved'))).toBeNull();
  });

  it('handles canvas shortcuts without taking undo from typing, IME or dialogs', () => {
    mount();
    const width = screen.getByLabelText(i18n.t('canvas.width'));
    const scope = width.closest('.canvas-layout')!;
    fireEvent.change(width, { target: { value: '900' } });
    fireEvent.keyDown(width, { key: 'z', ctrlKey: true });
    expect(width).toHaveValue(900);
    fireEvent.keyDown(scope, { key: 'z', ctrlKey: true, isComposing: true });
    expect(width).toHaveValue(900);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    fireEvent.keyDown(scope, { key: 'z', ctrlKey: true });
    expect(width).toHaveValue(900);
    dialog.remove();
    fireEvent.keyDown(scope, { key: 'z', metaKey: true });
    expect(width).toHaveValue(800);
    fireEvent.keyDown(scope, { key: 'z', metaKey: true, shiftKey: true });
    expect(width).toHaveValue(900);
    fireEvent.keyDown(scope, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(scope, { key: 'y', ctrlKey: true });
    expect(width).toHaveValue(900);
  });
});
