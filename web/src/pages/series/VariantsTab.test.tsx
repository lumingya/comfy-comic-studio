import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { series } from '../../test/fixtures';
import { mockFetch, renderWithProviders } from '../../test/utils';
import type { Series } from '../../api/types';
import VariantsTab from './VariantsTab';
let current: Series;
vi.mock('./SeriesPage', () => ({ useSeriesContext: () => ({ series: current }) }));
beforeEach(() => {
  current = structuredClone(series);
});
afterEach(() => vi.unstubAllGlobals());
describe('variant draft integrity', () => {
  it('keeps unsaved changes through background series refresh', () => {
    mockFetch({ 'GET /api/profiles': [] });
    const { rerender } = renderWithProviders(<VariantsTab />);
    fireEvent.change(screen.getByDisplayValue('冬装'), { target: { value: 'local variant' } });
    current = { ...current, title: 'renamed series', updated_at: '2026-09-28T12:00:00' };
    rerender(<VariantsTab />);
    expect(screen.getByDisplayValue('local variant')).toBeInTheDocument();
  });
  it('clears only tag_description, preserving custom character override fields', async () => {
    current.variants[0].characters = {
      char_a: { tag_description: ['old-tag'], expression: 'calm', custom: { keep: true } },
    };
    const calls = mockFetch({
      'GET /api/profiles': [],
      'PATCH /api/series/ser_1': (body: unknown) => ({ ...current, ...(body as object) }),
    });
    renderWithProviders(<VariantsTab />);
    fireEvent.click(screen.getByRole('button', { name: 'remove old-tag' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')).toBeDefined());
    expect(
      (calls.find((c) => c.method === 'PATCH')!.body as { variants: Series['variants'] })
        .variants[0].characters.char_a,
    ).toEqual({ expression: 'calm', custom: { keep: true } });
  });
});
