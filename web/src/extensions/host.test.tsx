import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { mockFetch, renderWithProviders } from '../test/utils';
import { WorkspaceExtensionOverlays } from './host';
import { toastError } from '../components/toast';

vi.mock('../components/toast', () => ({ toastError: vi.fn() }));

function preferenceRoutes(identifier: string, initial: Record<string, unknown> = {}) {
  let value = initial;
  let version = 0;
  const response = () =>
    new Response(JSON.stringify(value), {
      headers: {
        'Content-Type': 'application/json',
        ETag: `"${version.toString(16).padStart(64, '0')}"`,
      },
    });
  return {
    [`GET /api/ext/${identifier}/preferences`]: response,
    [`PATCH /api/ext/${identifier}/preferences`]: (body: unknown) => {
      const patch = body as { path: [string, string]; value: unknown };
      value = {
        ...value,
        floating_surfaces: {
          ...(value.floating_surfaces as Record<string, unknown> | undefined),
          [patch.path[1]]: patch.value,
        },
      };
      version += 1;
      return response();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
describe('generic workspace extensions', () => {
  it('keeps a minimized extension mounted and only accepts its own session messages', async () => {
    const calls = mockFetch({
      ...preferenceRoutes('my-tools'),
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
      ...preferenceRoutes('low-widget', {
        floating_surfaces: { pet: { position: { x: 7, y: 9 }, size: { width: 390, height: 310 } } },
      }),
      ...preferenceRoutes('high-widget'),
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
        (call) => call.method === 'PATCH' && call.url === '/api/ext/high-widget/preferences',
      );
      expect(save?.body).toMatchObject({
        path: ['floating_surfaces', 'bubble'],
        value: { clickThrough: true },
      });
    });
  });

  it('retains one keyboard subscription through floating interactions and suspends it while minimized', async () => {
    const calls = mockFetch({
      ...preferenceRoutes('my-tools'),
      'GET /api/extension-surfaces': {
        items: [
          {
            extension_id: 'my-tools',
            id: 'main',
            title: 'Floating tools',
            mode: 'floating',
            url: '/api/extensions/my-tools/workspace/index.html',
          },
        ],
      },
    });
    const view = renderWithProviders(<WorkspaceExtensionOverlays path="/" />);
    const frame = (await screen.findByTitle('Floating tools')) as HTMLIFrameElement;
    const session = new URLSearchParams(new URL(frame.src).hash.slice(1)).get('mio-session');
    const send = (data: Record<string, unknown>) => {
      act(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            origin: location.origin,
            source: frame.contentWindow,
            data: { ...data, session },
          }),
        );
      });
    };
    const events: unknown[] = [];
    vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation((message) => {
      if (message.type !== 'mio:workspace:event') return;
      events.push(message);
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: location.origin,
          source: frame.contentWindow,
          data: {
            type: 'mio:workspace:event-result',
            session,
            eventId: message.eventId,
            action: 'continue',
          },
        }),
      );
    });
    const press = async (expected: number) => {
      await act(async () => fireEvent.keyDown(document.body, { key: 'F8', code: 'F8' }));
      expect(events).toHaveLength(expected);
    };

    send({ type: 'mio:workspace:listen', event: 'keydown', enabled: true });
    await press(1);
    fireEvent.click(screen.getByRole('button', { name: '开启鼠标穿透' }));
    await press(2);
    send({ type: 'mio:workspace:resize', width: 720, height: 460 });
    expect(frame.closest<HTMLElement>('.workspace-extension-floating')?.style.width).toBe('720px');
    await press(3);

    vi.stubGlobal('PointerEvent', MouseEvent);
    const handle = document.querySelector<HTMLElement>('.workspace-extension-handle')!;
    handle.setPointerCapture = vi.fn();
    fireEvent.pointerDown(handle, { clientX: 1, clientY: 2, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 20, clientY: 30, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    await press(4);
    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    await press(4);
    fireEvent.click(screen.getByRole('button', { name: 'Floating tools' }));
    expect(screen.getByTitle('Floating tools')).toBe(frame);
    await press(5);
    view.rerender(<WorkspaceExtensionOverlays path="/settings" />);
    expect(screen.getByTitle('Floating tools')).toBe(frame);
    await press(6);
    view.rerender(<WorkspaceExtensionOverlays path="/extensions/my-tools/main" />);
    expect(frame.closest('[hidden]')).not.toBeNull();
    await press(6);
    view.rerender(<WorkspaceExtensionOverlays path="/" />);
    expect(screen.getByTitle('Floating tools')).toBe(frame);
    await press(7);
    send({ type: 'mio:workspace:changed' });
    await waitFor(() =>
      expect(calls.filter((call) => call.url === '/api/extension-surfaces')).toHaveLength(2),
    );
    expect(screen.getByTitle('Floating tools')).toBe(frame);
    await press(8);
    send({ type: 'mio:workspace:listen', event: 'keydown', enabled: false });
    await press(8);
    view.unmount();
    await press(8);
  });

  it('sends explicit visibility and focus lifecycle notifications and keeps the title bar interactive while passing through', async () => {
    mockFetch({
      ...preferenceRoutes('widget'),
      'GET /api/extension-surfaces': {
        items: [
          { extension_id: 'widget', id: 'pet', title: 'Pet', mode: 'floating', url: '/pet.html' },
        ],
      },
    });
    renderWithProviders(<WorkspaceExtensionOverlays path="/" />);
    const frame = (await screen.findByTitle('Pet')) as HTMLIFrameElement;
    const states: string[] = [];
    vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation((message) => {
      if (message.type === 'mio:workspace:lifecycle') states.push(message.state);
    });
    fireEvent.load(frame);
    fireEvent.focus(frame);
    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pet' }));
    expect(states).toEqual(['shown', 'focused', 'blurred', 'hidden', 'shown']);
    fireEvent.click(screen.getByRole('button', { name: '开启鼠标穿透' }));
    const panel = frame.closest<HTMLElement>('.workspace-extension-floating')!;
    expect(getComputedStyle(panel).pointerEvents).toBe('none');
    expect(getComputedStyle(panel.querySelector('header')!).pointerEvents).toBe('auto');
    expect(getComputedStyle(panel).resize).toBe('none');
  });

  it('clamps restored offsets and dimensions to a narrow viewport before displaying saved data', async () => {
    vi.stubGlobal('innerWidth', 320);
    vi.stubGlobal('innerHeight', 480);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const element = this as HTMLElement;
      const [, x = '0', y = '0'] =
        /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(element.style.transform) ?? [];
      const left = Number(x);
      const top = Number(y);
      const width = parseFloat(element.style.width) || 0;
      const height = parseFloat(element.style.height) || 0;
      return {
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        x: left,
        y: top,
        toJSON: () => ({}),
      };
    });
    mockFetch({
      ...preferenceRoutes('widget', {
        floating_surfaces: {
          pet: { position: { x: 900, y: 900 }, size: { width: 1000, height: 1000 } },
        },
      }),
      'GET /api/extension-surfaces': {
        items: [
          {
            extension_id: 'widget',
            id: 'pet',
            title: 'Pet',
            mode: 'floating',
            url: '/pet.html',
            default_position: { x: 'left', y: 'top', offset: [0, 0] },
          },
        ],
      },
    });
    renderWithProviders(<WorkspaceExtensionOverlays path="/" />);
    const frame = await screen.findByTitle('Pet');
    const panel = frame.closest<HTMLElement>('.workspace-extension-floating')!;
    await waitFor(() => {
      expect(panel.style.width).toBe('296px');
      expect(panel.style.height).toBe('420px');
      expect(panel.style.transform).toBe('translate(24px, 60px)');
    });
  });

  it('updates two surfaces through isolated subtrees and reports a failed save without leaving optimistic window state', async () => {
    let failed = false;
    const routes = preferenceRoutes('widget', {
      author_field: 'keep',
      floating_surfaces: { sibling: { author: 'keep' } },
    });
    const calls = mockFetch({
      ...routes,
      'PATCH /api/ext/widget/preferences': (body: unknown) =>
        failed
          ? new Response(JSON.stringify({ detail: 'Disk write failed' }), { status: 500 })
          : routes['PATCH /api/ext/widget/preferences'](body),
      'GET /api/extension-surfaces': {
        items: [
          { extension_id: 'widget', id: 'one', title: 'One', mode: 'floating', url: '/one.html' },
          { extension_id: 'widget', id: 'two', title: 'Two', mode: 'floating', url: '/two.html' },
        ],
      },
    });
    renderWithProviders(<WorkspaceExtensionOverlays path="/" />);
    await screen.findByTitle('One');
    await screen.findByTitle('Two');
    fireEvent.click(screen.getAllByRole('button', { name: '开启鼠标穿透' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: '开启鼠标穿透' })[0]);
    await waitFor(() => expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(2));
    const writes = calls.filter((call) => call.method === 'PATCH');
    expect(writes.map((call) => (call.body as { path: string[] }).path)).toEqual([
      ['floating_surfaces', 'one'],
      ['floating_surfaces', 'two'],
    ]);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: '关闭鼠标穿透' })).toHaveLength(2),
    );
    failed = true;
    fireEvent.click(screen.getAllByRole('button', { name: '关闭鼠标穿透' })[0]);
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(screen.getAllByRole('button', { name: '关闭鼠标穿透' })).toHaveLength(2);
  });

  it('replaces activation sessions and rejects old subscriptions after refetch or removal', async () => {
    let items = [
      {
        extension_id: 'widget',
        id: 'pet',
        title: 'Pet',
        mode: 'floating',
        url: '/pet.html',
        activation: 'one',
        digest: 'a',
      },
    ];
    mockFetch({ ...preferenceRoutes('widget'), 'GET /api/extension-surfaces': () => ({ items }) });
    renderWithProviders(<WorkspaceExtensionOverlays path="/" />);
    const original = (await screen.findByTitle('Pet')) as HTMLIFrameElement;
    const session = new URLSearchParams(new URL(original.src).hash.slice(1)).get('mio-session');
    const post = vi.spyOn(original.contentWindow!, 'postMessage');
    const send = (type: string, extra = {}) =>
      act(() =>
        window.dispatchEvent(
          new MessageEvent('message', {
            origin: location.origin,
            source: original.contentWindow,
            data: { type, session, ...extra },
          }),
        ),
      );
    send('mio:workspace:listen', { event: 'keydown', enabled: true });
    fireEvent.keyDown(document.body, { code: 'Digit0', ctrlKey: true, shiftKey: true });
    expect(
      post.mock.calls.filter(([message]) => message.type === 'mio:workspace:event'),
    ).toHaveLength(0);
    items = [{ ...items[0], activation: 'two' }];
    send('mio:workspace:changed');
    await waitFor(() => expect(screen.getByTitle('Pet')).not.toBe(original));
    fireEvent.keyDown(document.body, { key: 'F8', code: 'F8' });
    expect(
      post.mock.calls.filter(([message]) => message.type === 'mio:workspace:event'),
    ).toHaveLength(0);
    const current = screen.getByTitle('Pet') as HTMLIFrameElement;
    const currentSession = new URLSearchParams(new URL(current.src).hash.slice(1)).get(
      'mio-session',
    );
    items = [];
    act(() =>
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: location.origin,
          source: current.contentWindow,
          data: { type: 'mio:workspace:changed', session: currentSession },
        }),
      ),
    );
    await waitFor(() => expect(screen.queryByTitle('Pet')).not.toBeInTheDocument());
  });

  it('does not deliver a queued key to a surface removed while a higher priority listener is pending', async () => {
    let items = [
      {
        extension_id: 'widget',
        id: 'one',
        title: 'One',
        mode: 'floating',
        url: '/one',
        priority: 2,
      },
      {
        extension_id: 'widget',
        id: 'two',
        title: 'Two',
        mode: 'floating',
        url: '/two',
        priority: 1,
      },
    ];
    mockFetch({ ...preferenceRoutes('widget'), 'GET /api/extension-surfaces': () => ({ items }) });
    renderWithProviders(<WorkspaceExtensionOverlays path="/" />);
    const first = (await screen.findByTitle('One')) as HTMLIFrameElement;
    const second = (await screen.findByTitle('Two')) as HTMLIFrameElement;
    const session = (frame: HTMLIFrameElement) =>
      new URLSearchParams(new URL(frame.src).hash.slice(1)).get('mio-session');
    const send = (frame: HTMLIFrameElement, data: Record<string, unknown>) =>
      act(() =>
        window.dispatchEvent(
          new MessageEvent('message', {
            origin: location.origin,
            source: frame.contentWindow,
            data: { ...data, session: session(frame) },
          }),
        ),
      );
    send(first, { type: 'mio:workspace:listen', event: 'keydown', enabled: true });
    send(second, { type: 'mio:workspace:listen', event: 'keydown', enabled: true });
    let eventId = '';
    vi.spyOn(first.contentWindow!, 'postMessage').mockImplementation((message) => {
      if (message.type === 'mio:workspace:event') eventId = message.eventId;
    });
    const secondPost = vi
      .spyOn(second.contentWindow!, 'postMessage')
      .mockImplementation(() => undefined);
    fireEvent.keyDown(document.body, { key: 'F8', code: 'F8' });
    expect(eventId).not.toBe('');
    items = [items[0]];
    send(first, { type: 'mio:workspace:changed' });
    await waitFor(() => expect(screen.queryByTitle('Two')).not.toBeInTheDocument());
    send(first, { type: 'mio:workspace:event-result', eventId, action: 'continue' });
    await act(async () => undefined);
    expect(
      secondPost.mock.calls.filter(([message]) => message.type === 'mio:workspace:event'),
    ).toHaveLength(0);
  });
});
