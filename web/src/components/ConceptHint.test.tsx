import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ConceptHint } from './ConceptHint';

it('keeps the hovered guide reachable and closes the pinned card with Escape', async () => {
  const user = userEvent.setup();
  const submit = vi.fn((event) => event.preventDefault());
  render(
    <form onSubmit={submit}>
      <ConceptHint concept="profiles" />
    </form>,
  );
  const trigger = screen.getByRole('button', { name: '了解高级出图方案' });
  await user.hover(trigger);
  const guide = screen.getByRole('link', { name: '查看图文教程' });
  expect(guide).toHaveAttribute('href', '/manual/docs/guide/workflow.html#advanced-render-plans');
  await user.hover(guide);
  expect(guide).toBeVisible();

  await user.click(trigger);
  await user.unhover(trigger);
  expect(guide).toBeVisible();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(submit).not.toHaveBeenCalled();
});

it('reaches the guide by Tab, restores focus with Escape and never traps Tab', async () => {
  const user = userEvent.setup();
  render(
    <>
      <ConceptHint concept="mappings" />
      <button type="button">Next</button>
    </>,
  );
  const trigger = screen.getByRole('button', { name: '了解槽位映射与适配器' });
  await user.tab();
  expect(trigger).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('link')).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(trigger).toHaveFocus();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();

  await user.keyboard('{Enter}');
  await user.tab();
  expect(screen.getByRole('link')).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
