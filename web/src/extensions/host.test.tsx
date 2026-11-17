import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { mockFetch, renderWithProviders } from '../test/utils';
import { WorkspaceExtensionOverlays } from './host';

afterEach(() => vi.unstubAllGlobals());
describe('generic workspace extensions', () => {
  it('keeps a minimized extension mounted and only accepts its own session messages', async () => {
    const calls = mockFetch({
      'GET /api/extension-surfaces': {
        items: [
          {
            extension_id: 'my-tools',
            id: 'main',
            title: '绘页工具',
            mode: 'floating',
            url: '/api/extensions/my-tools/workspace/index.html',
          },
        ],
      },
    });
    renderWithProviders(<WorkspaceExtensionOverlays path="/" />);
    const frame = (await screen.findByTitle('绘页工具')) as HTMLIFrameElement;
    const session = new URL(frame.src).hash.slice(1).split('&')[0].split('=')[1];
    const before = calls.length;
    act(() =>
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: location.origin,
          source: window,
          data: { type: 'mio:workspace:changed', session },
        }),
      ),
    );
    expect(calls).toHaveLength(before);
    act(() =>
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: location.origin,
          source: frame.contentWindow,
          data: { type: 'mio:workspace:changed', session },
        }),
      ),
    );
    await waitFor(() => expect(calls.length).toBeGreaterThan(before));
    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    expect(frame).toBeInTheDocument();
    expect(frame.closest('[hidden]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '绘页工具' }));
    expect(screen.getByTitle('绘页工具')).toBe(frame);
    expect(frame.closest('[hidden]')).toBeNull();
  });
});
