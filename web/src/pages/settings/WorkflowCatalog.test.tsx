import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { configSummary, configWorkflow, configurationRoutes } from '../../test/configuration';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { WorkflowsSection } from './WorkflowsSection';

afterEach(() => vi.unstubAllGlobals());

it('keeps healthy catalog entries usable when another LoRA summary is unavailable', async () => {
  mockFetch(
    configurationRoutes({
      'GET /api/workflows': [
        configSummary,
        {
          ...configSummary,
          id: 'wf_unavailable',
          name: 'Unavailable workflow',
          loras: null,
          lora_error: { code: 'MIO-SLOT-001', message: 'LoRA analysis is unavailable.' },
        },
      ],
      'GET /api/workflows/wf_unavailable': { ...configWorkflow, id: 'wf_unavailable' },
    }),
  );
  const user = userEvent.setup();
  renderWithProviders(<WorkflowsSection />);
  const list = await screen.findByRole('navigation', { name: '工作流列表' });
  const unavailable = within(list).getByRole('button', { name: /Unavailable workflow/ });
  expect(within(unavailable).getByText('LoRA 分析不可用')).toBeVisible();
  await user.click(unavailable);
  expect(unavailable).toHaveAttribute('aria-pressed', 'true');
  const healthy = within(list).getByRole('button', { name: /测试工作流/ });
  await user.click(healthy);
  expect(healthy).toHaveAttribute('aria-pressed', 'true');
  expect(within(healthy).queryByText('LoRA 分析不可用')).toBeNull();
});
