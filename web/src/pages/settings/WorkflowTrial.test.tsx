import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { configInstance, configurationRoutes } from '../../test/configuration';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { WorkflowsSection } from './WorkflowsSection';

afterEach(() => vi.unstubAllGlobals());
const result = {
  series: { id: 'trial_series' },
  episode: { id: 'trial_episode', takes: [] },
  job: { id: 'trial_job', state: 'queued' },
};
const trialRoutes = (extra: Record<string, unknown> = {}) =>
  configurationRoutes({
    'GET /api/jobs/trial_job': result.job,
    'GET /api/episodes/trial_episode': result.episode,
    ...extra,
  });
async function openTrial() {
  await userEvent.click(await screen.findByRole('button', { name: '试生成一张' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getByRole('textbox', { name: '画面描述' }), '窗边的一杯茶');
  return dialog;
}

it('creates one real trial task, preserves workflow dimensions by default and links to its assembly task', async () => {
  const calls = mockFetch(
    trialRoutes({
      'GET /api/instances': {
        instances: [
          { ...configInstance, id: 'off', name: '停用连接', enabled: false },
          configInstance,
        ],
        pool: {},
      },
      'POST /api/workflows/wf_demo/trial': result,
    }),
  );
  renderWithProviders(<WorkflowsSection />);
  const dialog = await openTrial();
  expect(within(dialog).getByLabelText('运行连接')).toHaveValue(configInstance.id);
  expect(within(dialog).queryByRole('option', { name: '停用连接' })).toBeNull();
  await userEvent.click(within(dialog).getByRole('button', { name: '试生成一张' }));
  expect(await within(dialog).findByText('已加入队列')).toBeInTheDocument();
  expect(within(dialog).getByRole('link', { name: '查看任务' })).toHaveAttribute(
    'href',
    '/workshop/assembly?task=trial_series',
  );
  const writes = calls.filter((call) => call.method === 'POST');
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({
    url: '/api/workflows/wf_demo/trial',
    body: {
      instance_id: configInstance.id,
      prompt: '窗边的一杯茶',
      idempotency_key: expect.any(String),
    },
  });
  expect(writes[0].body).not.toHaveProperty('width');
  expect(writes[0].body).not.toHaveProperty('height');
  expect(writes[0].body).not.toHaveProperty('candidates');
});

it('retries an unconfirmed request with the same idempotency key and input snapshot', async () => {
  let attempts = 0;
  const calls = mockFetch(
    trialRoutes({
      'POST /api/workflows/wf_demo/trial': () =>
        ++attempts === 1
          ? new Response(JSON.stringify({ detail: 'connection interrupted' }), { status: 502 })
          : result,
    }),
  );
  renderWithProviders(<WorkflowsSection />);
  const dialog = await openTrial();
  fireEvent.change(within(dialog).getByLabelText('宽度'), { target: { value: '768' } });
  await userEvent.click(within(dialog).getByRole('button', { name: '试生成一张' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('connection interrupted');
  expect(within(dialog).getByLabelText('画面描述')).toBeDisabled();
  await userEvent.click(within(dialog).getByRole('button', { name: '重试提交' }));
  await within(dialog).findByText('已加入队列');
  const writes = calls.filter((call) => call.method === 'POST');
  expect(writes).toHaveLength(2);
  expect(writes[1].body).toEqual(writes[0].body);
  expect(writes[1].body).toMatchObject({ width: 768 });
});

it('requires saved workflow edits before a real generation attempt', async () => {
  const calls = mockFetch(configurationRoutes());
  renderWithProviders(<WorkflowsSection />);
  fireEvent.change(await screen.findByLabelText('名称'), { target: { value: '尚未保存' } });
  expect(screen.getByRole('button', { name: '试生成一张' })).toBeDisabled();
  expect(screen.getByText('保存修改后即可试生成。')).toBeInTheDocument();
  await waitFor(() => expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0));
});

it('shows running progress and the completed image in place without another generation request', async () => {
  let completed = false;
  const calls = mockFetch(
    trialRoutes({
      'POST /api/workflows/wf_demo/trial': result,
      'GET /api/jobs/trial_job': () => ({
        ...result.job,
        state: completed ? 'completed' : 'running',
      }),
      'GET /api/episodes/trial_episode': () => ({
        ...result.episode,
        takes: completed ? [{ job_id: 'trial_job', asset_id: 'trial_image' }] : [],
      }),
    }),
  );
  renderWithProviders(<WorkflowsSection />);
  const dialog = await openTrial();
  await userEvent.click(within(dialog).getByRole('button', { name: '试生成一张' }));
  await within(dialog).findByText('正在生成…');
  expect(within(dialog).getByRole('progressbar', { name: '试生成进度' })).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: '调整参数' })).toBeDisabled();
  completed = true;
  const image = await within(dialog).findByRole('img', { name: '试生成结果' }, { timeout: 4000 });
  expect(image).toHaveAttribute('src', '/api/assets/trial_image?thumb=480');
  expect(within(dialog).queryByRole('progressbar')).toBeNull();
  expect(within(dialog).getByRole('button', { name: '调整参数' })).toBeEnabled();
  await userEvent.click(within(dialog).getByRole('button', { name: '调整参数' }));
  expect(within(dialog).getByRole('textbox', { name: '画面描述' })).toHaveValue('窗边的一杯茶');
  expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
});

it('shows the actual generation error instead of leaving a completed submission message', async () => {
  mockFetch(
    trialRoutes({
      'POST /api/workflows/wf_demo/trial': result,
      'GET /api/jobs/trial_job': {
        ...result.job,
        state: 'failed',
        items: [
          {
            state: 'failed',
            error: { kind: 'missing_model', message: '模型 comic.safetensors 不存在' },
          },
        ],
      },
    }),
  );
  renderWithProviders(<WorkflowsSection />);
  const dialog = await openTrial();
  await userEvent.click(within(dialog).getByRole('button', { name: '试生成一张' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    '模型 comic.safetensors 不存在',
  );
  expect(within(dialog).queryByText('已加入队列')).toBeNull();
  expect(within(dialog).queryByRole('img')).toBeNull();
});

it('matches backend dimension limits before submitting', async () => {
  const calls = mockFetch(trialRoutes());
  renderWithProviders(<WorkflowsSection />);
  const dialog = await openTrial();
  const width = within(dialog).getByLabelText('宽度');
  expect(width).toHaveAttribute('min', '64');
  expect(width).toHaveAttribute('max', '8192');
  for (const value of ['63', '8193', '512.5']) {
    fireEvent.change(width, { target: { value } });
    expect(within(dialog).getByRole('button', { name: '试生成一张' })).toBeDisabled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('64–8192');
  }
  fireEvent.change(width, { target: { value: '64' } });
  expect(within(dialog).getByRole('button', { name: '试生成一张' })).toBeEnabled();
  expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
});
