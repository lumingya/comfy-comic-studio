import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keys } from '../../api/keys';
import type { Episode } from '../../api/types';
import { episode, series } from '../../test/fixtures';
import { mockFetch } from '../../test/utils';
import { FrameVariablePreview } from '../workshop/FrameVariablePreview';
import { biblePromptSources } from './biblePrompts';
import { CastPicker } from './CastPicker';
import { PanelVariableFix } from './PanelVariableFix';
import { ReferencePreview } from './ReferencePreview';

afterEach(() => vi.unstubAllGlobals());

function mount(ui: ReactNode, initial = episode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(keys.episode(initial.id!), initial);
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return client;
}

describe('Bible prompt sources', () => {
  it('uses only compiler-supported tokens and reports the effective local value', () => {
    const source = structuredClone(series);
    source.bible.characters[0].tag_description = ['ink hero'];
    source.variables = { style: 'series ink' };
    const panel = structuredClone(episode.panels[0]);
    panel.overrides.values = { $style: 'panel ink', steps: 20 };
    const sources = biblePromptSources(source, panel, {
      bible: (name) => `Bible: ${name}`,
      series: 'series',
      panel: 'panel',
    });
    expect(sources.get('林夏')).toEqual([{ title: 'Bible: 林夏', value: 'ink hero' }]);
    expect(sources.get('scene')).toEqual([{ title: 'Bible: 便利店', value: 'convenience store' }]);
    expect(sources.get('style')).toEqual([{ title: 'panel', value: 'panel ink' }]);
    expect(sources.has('steps')).toBe(false);
    panel.characters = [];
    expect(
      biblePromptSources(source, panel, {
        bible: (name) => name,
        series: 'series',
        panel: 'panel',
      }).has('林夏'),
    ).toBe(false);
  });
});

describe('Bible assistance controls', () => {
  it('finds a character by tags and explicitly adds the unique match with Enter', () => {
    const source = structuredClone(series);
    source.bible.characters[0].tag_description = ['round glasses'];
    const changed = vi.fn();
    mount(<CastPicker series={source} value={[]} onChange={changed} />);
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索角色' }), {
      target: { value: 'glasses' },
    });
    fireEvent.keyDown(screen.getByRole('searchbox', { name: '搜索角色' }), { key: 'Enter' });
    expect(changed).toHaveBeenCalledWith([expect.objectContaining({ character_id: 'char_a' })]);
    expect(screen.getByRole('searchbox', { name: '搜索角色' })).toHaveValue('');
  });

  it('opens the precise nested missing variable instead of the outer token', async () => {
    const resolve = vi.fn();
    render(
      <FrameVariablePreview
        prompt="{hero}"
        negative=""
        caption=""
        values={new Map([['hero', '{outfit}']])}
        onResolve={resolve}
      />,
    );
    const details = document.querySelector('details')!;
    details.open = true;
    fireEvent(details, new Event('toggle'));
    fireEvent.click(await screen.findByRole('button', { name: '补齐 {outfit}' }));
    expect(resolve).toHaveBeenCalledWith('outfit');
  });

  it('fetches references only on demand after saving and shows owner names without other response data', async () => {
    let saved = false;
    const calls = mockFetch({
      'GET /api/episodes/ep_1/panels/p0/prompt': () => {
        expect(saved).toBe(true);
        return {
          tags: { positive: 'private upstream prompt' },
          references: [
            { slot: 1, asset_id: 'front', owner: 'char_a', role: 'front', reason: 'front view' },
          ],
          provider: { api_key: 'never display this' },
        };
      },
    });
    mount(
      <ReferencePreview
        episodeId="ep_1"
        panelId="p0"
        series={series}
        beforeOpen={async () => {
          saved = true;
        }}
      />,
    );
    expect(calls).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '预览参考图来源' }));
    await screen.findByRole('dialog', { name: '预览参考图来源' });
    expect(screen.getByText('#1 · 林夏')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('src', '/api/assets/front?thumb=320');
    expect(screen.queryByText('private upstream prompt')).toBeNull();
    expect(screen.queryByText('never display this')).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('does not fetch a reference preview when saving the draft fails', async () => {
    const calls = mockFetch({});
    mount(
      <ReferencePreview
        episodeId="ep_1"
        panelId="p0"
        series={series}
        beforeOpen={async () => {
          throw new Error('offline');
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '预览参考图来源' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '预览参考图来源' })).toBeEnabled(),
    );
    expect(calls).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('panel-local variable repair', () => {
  it('saves with the revision after flushing and preserves all unrelated overrides', async () => {
    const latest = structuredClone(episode);
    latest.revision += 1;
    latest.panels[0].overrides.values = { steps: 31, $weather: 'rain' };
    const calls = mockFetch({ 'PATCH /api/episodes/ep_1/panels/p0': latest });
    let client: QueryClient;
    const close = vi.fn();
    client = mount(
      <PanelVariableFix
        name="outfit"
        initialValue=""
        episode={episode}
        panelId="p0"
        onClose={close}
        beforeSave={async () => {
          client.setQueryData(keys.episode('ep_1'), latest);
        }}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'coat' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: 'PATCH',
      url: '/api/episodes/ep_1/panels/p0',
      body: {
        revision: latest.revision,
        changes: { overrides: { values: { steps: 31, $weather: 'rain', $outfit: 'coat' } } },
      },
    });
    expect((calls[0].body as { changes: object }).changes).not.toHaveProperty('characters');
  });

  it('keeps the input on a CAS conflict and requires reload plus another explicit save', async () => {
    let server = structuredClone(episode);
    let attempts = 0;
    const calls = mockFetch({
      'PATCH /api/episodes/ep_1/panels/p0': (body: unknown) => {
        attempts += 1;
        if (attempts === 1)
          return new Response(JSON.stringify({ detail: 'revision conflict' }), { status: 409 });
        expect((body as { revision: number }).revision).toBe(server.revision);
        return server;
      },
      'GET /api/episodes/ep_1': () => server,
    });
    const close = vi.fn();
    mount(
      <PanelVariableFix
        name="outfit"
        initialValue=""
        episode={episode}
        panelId="p0"
        onClose={close}
        beforeSave={async () => {}}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'my coat' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('textbox')).toHaveValue('my coat');
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    expect(attempts).toBe(1);
    expect(close).not.toHaveBeenCalled();
    server = { ...server, revision: server.revision + 1 } as Episode;
    server.panels[0].overrides.values = { $outfit: 'their coat' };
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    await screen.findByText('当前值：their coat');
    expect(screen.getByRole('textbox')).toHaveValue('my coat');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(attempts).toBe(2);
    expect(calls.every((call) => call.url.startsWith('/api/episodes/'))).toBe(true);
  });
});
