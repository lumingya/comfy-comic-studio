import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { workflowLoras } from '../../test/workflowLoras';
import { defaultLoraOverrides, LoraToggleList } from './LoraToggleList';

it('submits an independent toggle with valid full-precision model and CLIP weights', async () => {
  const groups = structuredClone(workflowLoras.groups);
  Object.assign(groups[0].loras[0], { strength: 0.333333, clip: 0.271828 });
  const submit = vi.fn();
  function Form() {
    const [value, setValue] = useState(() => defaultLoraOverrides(groups));
    return (
      <form
        aria-label="Precise LoRA defaults"
        onSubmit={(event) => {
          event.preventDefault();
          submit(value);
        }}
      >
        <LoraToggleList groups={groups} value={value} onChange={setValue} />
        <button type="submit">Save precise defaults</button>
      </form>
    );
  }
  renderWithProviders(<Form />);
  const user = userEvent.setup();
  expect(screen.getByRole('form')).toBeValid();
  await user.click(screen.getByRole('checkbox', { name: '启用 ink.safetensors' }));
  await user.click(screen.getByRole('button', { name: 'Save precise defaults' }));
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.calls[0][0][0].loras[0]).toMatchObject({
    enabled: false,
    strength: 0.333333,
    clip: 0.271828,
  });
});
