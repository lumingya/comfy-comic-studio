import { fireEvent, screen, waitFor } from '@testing-library/react';
import { it, expect } from 'vitest';
import { mockFetch, renderWithProviders } from '../test/utils';
import { CollectionSwitch } from './CollectionSwitch';

it('cancels a rename before closing the collection menu and restores focus at each level', async () => {
  const calls = mockFetch({
    'GET /api/series': [],
    'GET /api/settings': { collection_title: 'Original name' },
    'PATCH /api/settings': { collection_title: 'New name' },
  });
  renderWithProviders(<CollectionSwitch />);
  const trigger = screen.getByRole('button', { name: '画册集菜单' });
  await screen.findByText('Original name');
  fireEvent.click(trigger);
  const rename = screen.getByRole('menuitem', { name: '重命名当前画册集' });
  fireEvent.click(rename);
  const edit = screen.getByRole('textbox', { name: '重命名当前画册集' });
  fireEvent.change(edit, { target: { value: 'Discarded name' } });
  fireEvent.keyDown(edit, { key: 'Escape' });
  expect(rename).toHaveFocus();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.getByRole('menu')).toBeInTheDocument();
  expect(calls.some((call) => call.method === 'PATCH')).toBe(false);

  fireEvent.keyDown(rename, { key: 'Escape' });
  expect(trigger).toHaveFocus();
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();

  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('menuitem', { name: '重命名当前画册集' }));
  const name = screen.getByRole('textbox', { name: '重命名当前画册集' });
  fireEvent.change(name, { target: { value: 'New name' } });
  fireEvent.submit(name.closest('form')!);
  await waitFor(() => expect(trigger).toHaveTextContent('New name'));
  expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
});
