import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionPanel } from '../api/open';
import { createCreationChannel } from './creationChannel';
import {
  captureCreationSelection,
  getCreationContext,
  publishCreationContext,
  releaseCreationContext,
} from './creationContext';

const owner = Symbol('test');
const makeContext = (ids = ['panel-a']) => {
  publishCreationContext(owner, {
    route: 'script',
    series_id: 'work-a',
    episode_id: 'episode-a',
    panel_ids: ids,
    revision: 3,
  });
  return getCreationContext();
};
const panel: ExtensionPanel = {
  extension: 'notes',
  id: 'inspect',
  slot: 'episode',
  title: 'Inspect',
  url: '/inspect.html',
  activation: 'activation-a',
  digest: 'a'.repeat(64),
  requests: [{ id: 'read', method: 'GET', path: '/episodes/{episode_id}', scope: 'read' }],
  subscriptions: ['creation.context.changed', 'selection.changed'],
};

afterEach(() => {
  releaseCreationContext(owner);
  vi.useRealTimers();
});

function setup(authorize = vi.fn(async (_signal: AbortSignal) => true)) {
  const postMessage = vi.fn();
  const frame = { postMessage } as unknown as Window;
  const channel = createCreationChannel({
    panel,
    session: 'session-a',
    context: makeContext(),
    frame: () => frame,
    authorize,
  });
  const message = (data: Record<string, unknown>, extra: Partial<MessageEventInit> = {}) =>
    channel.handle(
      new MessageEvent('message', {
        origin: 'null',
        source: frame,
        data: { version: 1, session: 'session-a', ...data },
        ...extra,
      }),
    );
  const ready = () => message({ type: 'mio:panel:ready' });
  const subscribe = (event = 'creation.context.changed', enabled = true) =>
    message({ type: 'mio:creation:subscribe', event, enabled });
  return { channel, authorize, message, ready, subscribe, postMessage };
}

describe('bounded creation metadata channel', () => {
  it('requires opaque origin, exact source/session, ready and declared read-only subscription', async () => {
    vi.useFakeTimers();
    const value = setup();
    value.subscribe();
    value.message({ type: 'mio:panel:ready' }, { origin: location.origin });
    value.subscribe();
    await vi.advanceTimersByTimeAsync(120);
    expect(value.authorize).not.toHaveBeenCalled();
    value.ready();
    value.message(
      { type: 'mio:creation:subscribe', event: 'creation.context.changed', enabled: true },
      { source: window },
    );
    value.message({
      type: 'mio:creation:subscribe',
      event: 'creation.context.changed',
      enabled: true,
      session: 'old',
    });
    value.subscribe('ext.other.business');
    value.message({
      type: 'mio:creation:subscribe',
      event: 'selection.changed',
      enabled: true,
      payload: { secret: true },
    });
    await vi.advanceTimersByTimeAsync(120);
    expect(value.authorize).not.toHaveBeenCalled();
    value.subscribe();
    await vi.advanceTimersByTimeAsync(120);
    expect(value.postMessage).toHaveBeenCalledTimes(1);
    expect(value.postMessage.mock.calls[0][0]).toMatchObject({
      type: 'mio:creation:event',
      session: 'session-a',
      activation: panel.activation,
      digest: panel.digest,
      context: { episode_id: 'episode-a', selection: { ids: ['panel-a'] } },
    });
    value.channel.dispose();
  });

  it('coalesces to the latest business selection, bounds IDs and never adds content', async () => {
    vi.useFakeTimers();
    const value = setup();
    value.ready();
    value.subscribe();
    value.subscribe('selection.changed');
    for (let i = 0; i < 10; i++) value.channel.update(makeContext([`panel-${i}`]));
    await vi.advanceTimersByTimeAsync(120);
    expect(value.authorize).toHaveBeenCalledTimes(1);
    expect(value.postMessage).toHaveBeenCalledTimes(2);
    const latest = value.postMessage.mock.calls[0][0].context;
    expect(latest.selection.ids).toEqual(['panel-9']);
    expect(Object.keys(latest).sort()).toEqual([
      'context_id',
      'episode_id',
      'revisions',
      'route',
      'selection',
      'seq',
      'series_id',
      'version',
    ]);
    const bounded = makeContext(Array.from({ length: 120 }, (_, i) => `panel-${i}`));
    expect(bounded.selection).toMatchObject({ truncated: true });
    expect(bounded.selection.ids).toHaveLength(100);
    expect(Object.isFrozen(bounded.selection.ids)).toBe(true);
    value.channel.dispose();
  });

  it('drops authorization responses after context change, disablement, disposal or navigation', async () => {
    vi.useFakeTimers();
    let resolve!: (value: boolean) => void;
    const value = setup(
      vi.fn(
        () =>
          new Promise<boolean>((done) => {
            resolve = done;
          }),
      ),
    );
    value.ready();
    value.subscribe();
    await vi.advanceTimersByTimeAsync(100);
    value.channel.update(makeContext(['panel-new']));
    resolve(true);
    await Promise.resolve();
    expect(value.postMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    resolve(false);
    await Promise.resolve();
    expect(value.postMessage).not.toHaveBeenCalled();
    value.ready();
    value.subscribe();
    value.channel.navigated();
    value.channel.navigated();
    await vi.advanceTimersByTimeAsync(120);
    expect(value.postMessage).not.toHaveBeenCalled();
    value.channel.dispose();
    resolve(true);
    await Promise.resolve();
    expect(value.postMessage).not.toHaveBeenCalled();
  });

  it('keeps context IDs stable across identical renders and ignores an old publisher cleanup', () => {
    const context = makeContext();
    expect(makeContext()).toBe(context);
    const newer = Symbol('newer-page');
    publishCreationContext(newer, { route: 'canvas', episode_id: 'episode-b' });
    releaseCreationContext(owner);
    expect(getCreationContext().episode_id).toBe('episode-b');
    releaseCreationContext(newer);
    expect(getCreationContext().episode_id).toBeNull();
  });

  it('captures a right-click target without rewriting the persistent editor selection', () => {
    const base = makeContext(['panel-a']);
    const target = captureCreationSelection(base, ['panel-b']);
    expect(target.selection.ids).toEqual(['panel-b']);
    expect(target.context_id).not.toBe(base.context_id);
    expect(target.seq).toBe(base.seq);
    expect(getCreationContext()).toBe(base);
    expect(getCreationContext().selection.ids).toEqual(['panel-a']);
  });
});
