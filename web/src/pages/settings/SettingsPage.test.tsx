import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import SettingsPage from './SettingsPage';

vi.mock('./UpdatesSection', () => ({ UpdatesSection: () => <p>Update preferences</p> }));
vi.mock('../../api/system', () => ({
  useSettings: () => ({ data: {} }),
  usePatchSettings: () => ({}),
  useImportBundle: () => ({}),
}));

afterEach(() => vi.restoreAllMocks());

it('reveals the selected settings tab on a direct narrow-screen link without stealing focus', async () => {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(448);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(350);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.id === 'settings-tab-updates'
      ? new DOMRect(362, 72, 85, 35)
      : new DOMRect(16, 72, 350, 35);
  });
  render(
    <MemoryRouter initialEntries={['/settings?tab=updates']}>
      <SettingsPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByRole('tablist').scrollLeft).toBe(81));
  expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('关于与更新');
  expect(document.activeElement).toBe(document.body);
});
