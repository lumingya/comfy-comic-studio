import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { episode } from '../../test/fixtures';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { PacingDialog } from './PacingDialog';

afterEach(() => vi.unstubAllGlobals());

const preview = (revision: number, gap: number) => ({
  revision,
  suggestions: [{ panel_id: 'p0', order: 0, changes: { gap_after: gap }, reasons: [] }],
});

it('discards an older preset response and applies only the reviewed latest suggestion', async () => {
  let finish!: (value: unknown) => void;
  let requests = 0;
  const calls = mockFetch({
    'POST /api/episodes/ep_1/pacing/suggest': () =>
      ++requests === 1
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : preview(10, 288),
    'POST /api/episodes/ep_1/pacing/apply': episode,
  });
  const onApplied = vi.fn();
  renderWithProviders(
    <PacingDialog
      episodeId="ep_1"
      panels={episode.panels}
      open
      onOpenChange={vi.fn()}
      onApplied={onApplied}
    />,
  );
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  fireEvent.change(screen.getByLabelText(i18n.t('pacing.preset')), {
    target: { value: 'lyrical' },
  });
  const apply = await screen.findByRole('button', { name: i18n.t('pacing.applyN', { count: 1 }) });
  finish(preview(1, 12));
  await waitFor(() => expect(apply).toBeEnabled());
  expect(calls.find((call) => call.url.endsWith('?preset=lyrical'))).toBeDefined();
  expect(calls.some((call) => call.url.endsWith('/apply'))).toBe(false);
  fireEvent.click(apply);
  await waitFor(() => expect(onApplied).toHaveBeenCalledOnce());
  expect(calls.find((call) => call.url.endsWith('/apply'))!.body).toEqual({
    base_revision: 10,
    patches: [{ panel_id: 'p0', changes: { gap_after: 288 } }],
  });
});
