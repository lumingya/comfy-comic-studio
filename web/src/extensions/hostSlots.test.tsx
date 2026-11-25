import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { components } from '../api/schema';
import { BRIDGE } from '../api/extensionProtocol';
import { mockFetch, renderWithProviders } from '../test/utils';
import { toastError } from '../components/toast';
import { ContextMenu } from '../components/ContextMenu';
import {
  EpisodeExtensionMenu,
  HostSlotButtons,
  HostSlotDialog,
  useHostSlotActions,
  useHostSlotMenu,
} from './hostSlots';
import {
  getCreationContext,
  publishCreationContext,
  releaseCreationContext,
  usePublishCreationContext,
  type CreationContext,
} from './creationContext';

vi.mock('../components/toast', () => ({ toastError: vi.fn() }));
const panel = {
  extension: 'notes',
  id: 'inspect',
  title: 'Inspect',
  slot: 'episode' as const,
  entry: 'panel.html',
  priority: 0,
  url: '/inspect.html',
  activation: 'activation-a',
  digest: 'a'.repeat(64),
  requests: [],
  subscriptions: [],
};
const entries = ['command_palette', 'context_menu.episode', 'inspector.panel'].map(
  (slot, index) => ({
    extension: 'notes',
    id: `entry-${index}`,
    version: 1,
    slot,
    title: `Entry ${index}`,
    icon: 'eye',
    priority: 0,
    action: { kind: 'open_panel', panel_id: 'inspect' },
    panel,
  }),
) as components['schemas']['HostSlotEntry'][];

let captured: (() => void) | undefined;
function Harness({ targetIds }: { targetIds?: readonly string[] }) {
  usePublishCreationContext({
    route: 'script',
    series_id: 'work-a',
    episode_id: 'episode-a',
    panel_ids: ['panel-a'],
    revision: 2,
  });
  const commands = useHostSlotActions('command_palette');
  const menu = useHostSlotMenu(targetIds);
  captured = commands[0]?.run;
  return (
    <>
      {commands.map((command) => (
        <button key={command.id} onClick={command.run}>
          {command.title}
        </button>
      ))}
      <ContextMenu x={0} y={0} onClose={() => {}} groups={[menu]} />
      <HostSlotButtons />
      <HostSlotDialog />
    </>
  );
}

afterEach(() => {
  captured = undefined;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('reviewed native creation entry points', () => {
  it('has no entries when no extension declares slots', async () => {
    mockFetch({ 'GET /api/extension-host-slots': [] });
    const view = renderWithProviders(<Harness />);
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    expect(screen.queryByRole('button', { name: /Entry/ })).not.toBeInTheDocument();
    view.unmount();
  });

  it('uses all three native controls to reference declared panels and opens an opaque frame', async () => {
    const calls = mockFetch({ 'GET /api/extension-host-slots': entries });
    renderWithProviders(<Harness />);
    await screen.findByRole('button', { name: 'Entry 0' });
    expect(screen.getByRole('menuitem', { name: 'Entry 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entry 2' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Entry 0' }));
    const frame = await screen.findByTitle('Inspect');
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    expect(frame.getAttribute('src')).toContain('episode=episode-a');
    expect(calls.filter((call) => call.url === '/api/extension-host-slots')).toHaveLength(2);
    expect(calls.some((call) => call.method !== 'GET')).toBe(false);
  });

  it('refuses a captured action after the business context changes', async () => {
    const calls = mockFetch({ 'GET /api/extension-host-slots': entries });
    const view = renderWithProviders(<Harness />);
    await screen.findByRole('button', { name: 'Entry 0' });
    const old = captured!;
    const token = Symbol('new-route');
    act(() =>
      publishCreationContext(token, {
        route: 'canvas',
        series_id: 'work-b',
        episode_id: 'episode-b',
      }),
    );
    old();
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.queryByTitle('Inspect')).not.toBeInTheDocument();
    expect(calls.filter((call) => call.url === '/api/extension-host-slots')).toHaveLength(1);
    view.unmount();
  });

  it('delivers the actual context-menu target to the opened panel without changing editor selection', async () => {
    const subscribed = {
      ...panel,
      subscriptions: ['creation.context.changed'],
      requests: [{ id: 'read', method: 'GET', scope: 'read', path: '/episodes/{episode_id}' }],
    };
    mockFetch({
      'GET /api/extension-host-slots': entries.map((entry) => ({ ...entry, panel: subscribed })),
      'GET /api/extension-panels': [subscribed],
    });
    const view = renderWithProviders(<Harness targetIds={['panel-b']} />);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Entry 1' }));
    const frame = (await screen.findByTitle('Inspect')) as HTMLIFrameElement;
    const session = new URLSearchParams(new URL(frame.src).hash.slice(1)).get('mio-session');
    const post = vi.spyOn(frame.contentWindow!, 'postMessage');
    const channel = new MessageChannel();
    const received: { type: string; context?: CreationContext }[] = [];
    channel.port1.onmessage = ({ data }) => received.push(data);
    channel.port1.start();
    const updatedOwner = Symbol('context-update');
    try {
      fireEvent.load(frame);
      act(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            origin: 'null',
            source: frame.contentWindow,
            data: { type: BRIDGE.panel.types.ready, session, version: BRIDGE.panel.version },
            ports: [channel.port2],
          }),
        );
      });
      await waitFor(() =>
        expect(received.some((message) => message.type === BRIDGE.panel.types.init)).toBe(true),
      );
      channel.port1.postMessage({
        type: BRIDGE.creation.subscribe,
        session,
        version: BRIDGE.creation.version,
        event: 'creation.context.changed',
        enabled: true,
      });
      await waitFor(() =>
        expect(
          received.find((message) => message.type === BRIDGE.creation.event)?.context?.selection
            .ids,
        ).toEqual(['panel-b']),
      );
      expect(getCreationContext().selection.ids).toEqual(['panel-a']);

      act(() =>
        publishCreationContext(updatedOwner, {
          route: 'script',
          series_id: 'work-a',
          episode_id: 'episode-a',
          panel_ids: ['panel-c'],
          revision: 3,
        }),
      );
      await waitFor(() =>
        expect(
          received.filter((message) => message.type === BRIDGE.creation.event).at(-1)?.context
            ?.selection.ids,
        ).toEqual(['panel-c']),
      );
      expect(post).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      channel.port1.close();
      channel.port2.close();
      releaseCreationContext(updatedOwner);
    }
  });

  it('rechecks activation before opening and does not revive disabled declarations', async () => {
    let catalog = entries;
    mockFetch({ 'GET /api/extension-host-slots': () => catalog });
    renderWithProviders(<Harness />);
    await screen.findByRole('button', { name: 'Entry 0' });
    catalog = [];
    fireEvent.click(screen.getByRole('button', { name: 'Entry 0' }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.queryByTitle('Inspect')).not.toBeInTheDocument();
  });

  it('exposes enabled episode panels through the episode menu and preserves their native route', async () => {
    mockFetch({ 'GET /api/extension-panels': [panel] });
    const Location = () => <output data-testid="route">{useLocation().pathname}</output>;
    renderWithProviders(
      <>
        <EpisodeExtensionMenu episodeId="episode-a" />
        <Location />
      </>,
    );
    await userEvent.click(await screen.findByRole('button', { name: '扩展' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Inspect' }));
    expect(screen.getByTestId('route')).toHaveTextContent(
      '/workshop/assembly/episode-a/ext/notes.inspect',
    );
  });
});
