import { beforeEach, expect, it } from 'vitest';
import { quickStartDismissed, setQuickStartDismissed } from './onboarding';

beforeEach(() => localStorage.clear());

it('shows the new workspace guide once and keeps later UI persistence from dismissing it', () => {
  expect(quickStartDismissed()).toBe(false);
  localStorage.setItem('mio.ui', '{"state":{}}');
  expect(quickStartDismissed()).toBe(false);
});

it('hides the home panel for existing workspaces while leaving explicit reopening available', () => {
  localStorage.setItem('mio.ui', '{"state":{}}');
  expect(quickStartDismissed()).toBe(true);
  setQuickStartDismissed(false);
  expect(quickStartDismissed()).toBe(false);
});
