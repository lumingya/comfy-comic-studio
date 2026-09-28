import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import i18n from '../../i18n';
import { episode, series } from '../../test/fixtures';
import { mockFetch } from '../../test/utils';
import CanvasTab from './CanvasTab';
vi.mock('../episode/EpisodePage', () => ({ useEpisodeContext: () => ({ episode, series }) }));
vi.mock('react-konva', () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Stage: Box,
    Layer: Box,
    Group: Box,
    Rect: Box,
    Text: Box,
    Line: Box,
    Circle: Box,
    Ellipse: Box,
    Image: Box,
    Transformer: () => null,
  };
});
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
});
