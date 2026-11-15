import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GenerationOptions } from '../../api/workshop';
import { configurationRoutes } from '../../test/configuration';
import { series, episode } from '../../test/fixtures';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { GenerationSettings, generationValid } from './GenerationSettings';
import PresetsTab from './PresetsTab';

afterEach(() => vi.unstubAllGlobals());

describe('generation controls', () => {
  it('allows count editing and blocks invalid dimensions before submission', async () => {
    mockFetch(configurationRoutes());
    function Editor() {
      const [value, setValue] = useState<GenerationOptions>({
        workflow_id: 'wf_demo',
        candidates: 1,
      });
      return (
        <>
          <GenerationSettings value={value} onChange={setValue} />
          <button disabled={!generationValid(value)}>Submit</button>
        </>
      );
    }
    renderWithProviders(<Editor />);
    const count = await screen.findByLabelText('每幕生成张数');
    await waitFor(() => expect(count).toBeEnabled());
    fireEvent.change(count, { target: { value: '' } });
    expect(count).toHaveValue(null);
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    fireEvent.change(count, { target: { value: '12' } });
    fireEvent.blur(count);
    expect(count).toHaveValue(12);
    fireEvent.change(screen.getByLabelText('画面尺寸'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('宽度（像素）'), { target: { value: '8193' } });
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('宽度（像素）'), { target: { value: '768' } });
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
  });

  it('edits user-defined negative variables without dedicated prompt additions', async () => {
    const preset = {
      id: 'p',
      title: 'Watercolor',
      groups: [],
      bindings: [],
      entries: [{ id: 'v', key: 'negative', label: '负向词', value: '', hint: '', group_id: null }],
    };
    const workshop = { ...series, id: 'ws', kind: 'workshop', presets: [preset] };
    const calls = mockFetch(
      configurationRoutes({
        'GET /api/workshop': workshop,
        'GET /api/series': [],
        'PATCH /api/series/ws': (body: unknown) => ({ ...workshop, ...(body as object) }),
      }),
    );
    renderWithProviders(<PresetsTab />, '/workshop/presets');
    fireEvent.change(await screen.findByLabelText('负向词'), { target: { value: 'watermark' } });
    expect(screen.queryByLabelText('正向追加词')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('负向追加词')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(calls.find((call) => call.method === 'PATCH')?.body).toMatchObject({
        presets: [{ ...preset, entries: [{ ...preset.entries[0], value: 'watermark' }] }],
      }),
    );
  });

  it('retries starting an existing preset preview without creating another album', async () => {
    const workshop = {
      ...series,
      id: 'ws',
      kind: 'workshop',
      presets: [{ id: 'p', title: 'Watercolor', groups: [], bindings: [], entries: [] }],
    };
    let starts = 0;
    const calls = mockFetch(
      configurationRoutes({
        'GET /api/workshop': workshop,
        'GET /api/series': [],
        'POST /api/workshop/preview': { series, episode },
        'POST /api/workshop/queue/start': () =>
          ++starts === 1 ? { fault: '无法保存生成队列' } : {},
      }),
    );
    renderWithProviders(<PresetsTab />, '/workshop/presets');
    fireEvent.click(await screen.findByRole('button', { name: '独立试绘' }));
    fireEvent.change(screen.getByLabelText('画面描述'), { target: { value: 'a quiet sea' } });
    await waitFor(() => expect(screen.getByLabelText('出图工作流或云端服务')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('出图工作流或云端服务'), {
      target: { value: 'workflow:wf_demo' },
    });
    const start = screen.getByRole('button', { name: '开始生成' });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    await waitFor(() => {
      expect(starts).toBe(1);
      expect(start).toBeEnabled();
    });
    fireEvent.click(start);
    await waitFor(() => expect(starts).toBe(2));
    expect(calls.filter((call) => call.url === '/api/workshop/preview')).toHaveLength(1);
  });

  it('keeps a preview receipt key after a lost response and replaces it when the prompt changes', async () => {
    const workshop = {
      ...series,
      id: 'ws',
      kind: 'workshop',
      presets: [{ id: 'p', title: 'Watercolor', groups: [], bindings: [], entries: [] }],
    };
    const calls = mockFetch(
      configurationRoutes({
        'GET /api/workshop': workshop,
        'GET /api/series': [],
        'POST /api/workshop/preview': () =>
          new Response(JSON.stringify({ detail: 'response lost' }), { status: 503 }),
      }),
    );
    renderWithProviders(<PresetsTab />, '/workshop/presets');
    fireEvent.click(await screen.findByRole('button', { name: '独立试绘' }));
    const prompt = screen.getByLabelText('画面描述');
    fireEvent.change(prompt, { target: { value: 'a quiet sea' } });
    await waitFor(() => expect(screen.getByLabelText('出图工作流或云端服务')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('出图工作流或云端服务'), {
      target: { value: 'workflow:wf_demo' },
    });
    const start = screen.getByRole('button', { name: '开始生成' });
    const sent = () =>
      calls
        .filter((call) => call.url === '/api/workshop/preview')
        .map((call) => call.body as { idempotency_key: string });
    fireEvent.click(start);
    await waitFor(() => {
      expect(sent()).toHaveLength(1);
      expect(start).toBeEnabled();
    });
    fireEvent.click(start);
    await waitFor(() => {
      expect(sent()).toHaveLength(2);
      expect(start).toBeEnabled();
    });
    expect(sent()[0].idempotency_key).toBeTruthy();
    expect(sent()[0].idempotency_key).toBe(sent()[1].idempotency_key);
    fireEvent.change(prompt, { target: { value: 'a sunny sea' } });
    fireEvent.click(start);
    await waitFor(() => expect(sent()).toHaveLength(3));
    expect(sent()[2].idempotency_key).not.toBe(sent()[1].idempotency_key);
  });
});
