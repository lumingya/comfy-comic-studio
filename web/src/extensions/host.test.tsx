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

  it('orders floating surfaces by priority and restores position, size, and click-through', async () => {
    const calls = mockFetch({
      'GET /api/extension-surfaces': {
        items: [
          {
            extension_id: 'low-widget',
            id: 'pet',
            title: '低优先级桌宠',
            mode: 'floating',
            url: '/api/extensions/low-widget/workspace/pet.html',
            priority: 1,
            global: true,
            transparent: true,
            default_position: { x: 'right', y: 'bottom', offset: [20, 20] },
          },
          {
            extension_id: 'high-widget',
            id: 'bubble',
            title: '高优先级气泡',
            mode: 'floating',
            url: '/api/extensions/high-widget/workspace/bubble.html',
            priority: 20,
            global: true,
            transparent: true,
            default_position: { x: 'left', y: 'top', offset: [12, 16] },
          },
        ],
      },
      'GET /api/ext/low-widget/preferences': {
        floating_surfaces: { pet: { position: { x: 7, y: 9 }, size: { width: 390, height: 310 } } },
      },
      'GET /api/ext/high-widget/preferences': {},
    });
    renderWithProviders(<WorkspaceExtensionOverlays path="/" />);
    const highFrame = (await screen.findByTitle('高优先级气泡')) as HTMLIFrameElement;
    await screen.findByTitle('低优先级桌宠');
    await waitFor(() => {
      const panels = [...document.querySelectorAll<HTMLElement>('.workspace-extension-floating')];
      expect(panels[0].dataset.transparent).toBe('true');
      expect(panels[0].style.zIndex).toBe('520');
      expect(panels[0].style.left).toBe('12px');
      expect(panels[1].style.zIndex).toBe('501');
      expect(panels[1].style.right).toBe('20px');
      expect(panels[1].style.bottom).toBe('20px');
      expect(panels[1].style.width).toBe('390px');
      expect(panels[1].style.height).toBe('310px');
      expect(panels[1].style.transform).toBe('translate(7px, 9px)');
    });
    fireEvent.click(screen.getAllByRole('button', { name: '开启鼠标穿透' })[0]);
    expect(highFrame.style.pointerEvents).toBe('none');
    await waitFor(() => {
      const save = calls.find(
        (call) => call.method === 'PUT' && call.url === '/api/ext/high-widget/preferences',
      );
      expect(save?.body).toMatchObject({
        floating_surfaces: { bubble: { clickThrough: true } },
      });
    });
  });
});
