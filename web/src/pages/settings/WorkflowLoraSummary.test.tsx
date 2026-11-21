import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { workflowLoras } from '../../test/workflowLoras';
import { WorkflowLoraSummary } from './WorkflowLoraSummary';

it('filters a long recognized LoRA list without losing search focus', async () => {
  const group = workflowLoras.groups[0];
  const controls = {
    ...workflowLoras,
    groups: [
      {
        ...group,
        loras: Array.from({ length: 35 }, (_, index) => ({
          ...group.loras[0],
          key: `synthetic-${index}`,
          name: `synthetic_${index}.safetensors`,
        })),
      },
    ],
  };
  renderWithProviders(<WorkflowLoraSummary controls={controls} />);
  await userEvent.click(screen.getByText('识别到的 LoRA'));
  const search = screen.getByRole('searchbox');
  await userEvent.type(search, 'synthetic_34');
  expect(search).toHaveFocus();
  expect(screen.getByText('synthetic_34.safetensors')).toBeVisible();
  expect(screen.queryByText('synthetic_0.safetensors')).toBeNull();
  await userEvent.clear(search);
  await userEvent.type(search, 'absent');
  expect(screen.getByRole('status')).toHaveTextContent('没有名称匹配的 LoRA。');
});
