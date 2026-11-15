import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, it } from 'vitest';
import { renderWithProviders } from '../test/utils';
import { SearchableSelect } from './SearchableSelect';

const options = Array.from({ length: 1200 }, (_, index) => ({
  value: `/${index}/inputs/strength`,
  label: `#${index} · 插件节点 ${index} → strength`,
  search: `CustomControlNode${index}`,
}));
function Selector() {
  const [value, setValue] = useState('/0/inputs/strength');
  return <SearchableSelect label="参数目标" value={value} onChange={setValue} options={options} />;
}

it('searches a large catalog by node ID, title, class and input without mounting the whole list', async () => {
  renderWithProviders(<Selector />);
  await userEvent.click(screen.getByRole('combobox', { name: '参数目标' }));
  expect(screen.getAllByRole('option')).toHaveLength(60);
  expect(screen.getByRole('status')).toHaveTextContent('1200');
  const search = screen.getByRole('combobox', { name: '搜索参数目标' });
  await userEvent.type(search, '#1199 strength');
  expect(screen.getAllByRole('option')).toHaveLength(1);
  expect(screen.getByRole('option')).toHaveTextContent('插件节点 1199');
  await userEvent.clear(search);
  await userEvent.type(search, 'CustomControlNode1199');
  await userEvent.keyboard('{Enter}');
  expect(screen.getByRole('combobox', { name: '参数目标' })).toHaveTextContent('#1199');
  expect(screen.queryByRole('listbox')).toBeNull();
});

it('supports keyboard opening, arrow selection and Escape without changing the saved value', async () => {
  renderWithProviders(<Selector />);
  const trigger = screen.getByRole('combobox', { name: '参数目标' });
  trigger.focus();
  await userEvent.keyboard('{ArrowDown}');
  expect(screen.getByRole('combobox', { name: '搜索参数目标' })).toHaveFocus();
  await userEvent.keyboard('{ArrowDown}{Enter}');
  expect(trigger).toHaveTextContent('#1 ·');
  await userEvent.click(trigger);
  await userEvent.type(screen.getByRole('combobox', { name: '搜索参数目标' }), 'missing node');
  expect(screen.getByText('没有匹配项')).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  expect(trigger).toHaveTextContent('#1 ·');
  expect(trigger).toHaveFocus();
});
