import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { ExportPicker } from './ExportPicker';

const items = [
  { id: 'a', title: '第一份', meta: '3 幕' },
  { id: 'b', title: '第二份', meta: '5 幕' },
  { id: 'c', title: '第三份', meta: '1 幕' },
];

describe('ExportPicker (legacy 导出…)', () => {
  it('starts on the current item and exports the picked ones in list order', async () => {
    const onExport = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    renderWithProviders(
      <ExportPicker
        title="导出分镜"
        noun="分镜"
        items={items}
        current="b"
        onExport={onExport}
        onClose={onClose}
      />,
    );
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([false, true, false]);
    expect(screen.getByRole('status').textContent).toBe('已选 1 / 3');
    fireEvent.click(boxes[2]);
    fireEvent.click(boxes[0]);
    fireEvent.click(screen.getByRole('button', { name: '导出 3 份' }));
    await waitFor(() => expect(onExport).toHaveBeenCalledWith(['a', 'b', 'c']));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('cannot export nothing; 全选 and 只选当前 set the picks', () => {
    renderWithProviders(
      <ExportPicker
        title="导出预设"
        noun="预设"
        items={items}
        onExport={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: '导出' })).toHaveProperty('disabled', true);
    expect(screen.queryByRole('button', { name: '只选当前' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '全选' }));
    expect(screen.getByRole('status').textContent).toBe('已选 3 / 3');
  });
});
