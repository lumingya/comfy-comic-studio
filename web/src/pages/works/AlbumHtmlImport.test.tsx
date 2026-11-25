import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  importAlbumHtml,
  MAX_ALBUM_HTML_BYTES,
  type AlbumHtmlImportResult,
} from '../../api/albumImport';
import i18n from '../../i18n';
import { AlbumHtmlImport } from './AlbumHtmlImport';

vi.mock('../../api/albumImport', async (original) => ({
  ...(await original<typeof import('../../api/albumImport')>()),
  importAlbumHtml: vi.fn(),
}));
const upload = vi.mocked(importAlbumHtml);
const report: AlbumHtmlImportResult = {
  series_ids: ['first', 'second'],
  episode_ids: ['ep-first', 'ep-second'],
  imported_books: 2,
  imported_frames: 7,
  imported_assets: 5,
  source_data_used: true,
  warnings: ['Skipped one unavailable image'],
};
const t = (key: string) => i18n.t(key);
function Location() {
  const location = useLocation();
  return <output aria-label="location">{location.pathname + location.search}</output>;
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['series'], []);
  client.setQueryData(['episodes'], []);
  client.setQueryData(['collections'], {});
  const onDialogChange = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/gallery?collection=short&q=old']}>
        <AlbumHtmlImport onDialogChange={onDialogChange} />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: t('albumImport.action') }));
  return { ...view, client, onDialogChange };
}
function choose(file = new File(['<html/>'], 'album.html')) {
  fireEvent.change(screen.getByLabelText(t('albumImport.file')), { target: { files: [file] } });
  return file;
}
const submit = () =>
  fireEvent.click(screen.getByRole('button', { name: t('albumImport.confirm') }));
beforeEach(() => upload.mockReset());
afterEach(() => vi.restoreAllMocks());

it('shows import counts and source-data warnings, refreshes the shelf and opens the first unfiled book', async () => {
  upload.mockResolvedValue(report);
  const { client } = mount();
  const file = choose();
  submit();
  expect(await screen.findByRole('status')).toHaveTextContent(
    i18n.t('albumImport.summary', { books: 2, frames: 7, assets: 5 }),
  );
  expect(upload).toHaveBeenCalledWith(file, expect.any(AbortSignal));
  expect(screen.getByText(t('albumImport.sourceUsed'))).toBeInTheDocument();
  expect(screen.getByRole('region', { name: t('albumImport.warnings') })).toHaveTextContent(
    report.warnings[0],
  );
  expect(document.querySelector('iframe')).toBeNull();
  for (const key of ['series', 'episodes', 'collections'])
    expect(client.getQueryState([key])?.isInvalidated).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: t('albumImport.openFirst') }));
  expect(screen.getByLabelText('location')).toHaveTextContent('/gallery/first?collection=unfiled');
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('clears prior counts, file and warnings on reopening and explains a reading-only import', async () => {
  upload.mockResolvedValueOnce(report).mockResolvedValueOnce({
    ...report,
    source_data_used: false,
    warnings: [],
  });
  mount();
  choose();
  submit();
  await screen.findByRole('status');
  fireEvent.click(screen.getAllByRole('button', { name: t('common.close') }).at(-1)!);
  fireEvent.click(screen.getByRole('button', { name: t('albumImport.action') }));
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.queryByText(report.warnings[0])).toBeNull();
  expect(screen.getByRole('button', { name: t('albumImport.confirm') })).toBeDisabled();
  choose();
  submit();
  expect(await screen.findByText(t('albumImport.readingOnly'))).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: t('albumImport.warnings') })).toBeNull();
});

it('blocks an oversized or non-HTML file before uploading, and accepts exactly 1 GiB', async () => {
  mount();
  const large = new File([], 'large.html');
  Object.defineProperty(large, 'size', { value: MAX_ALBUM_HTML_BYTES + 1 });
  choose(large);
  expect(screen.getByRole('alert')).toHaveTextContent(t('albumImport.tooLarge'));
  expect(screen.getByRole('button', { name: t('albumImport.confirm') })).toBeDisabled();
  choose(new File([], 'template.json'));
  expect(screen.getByRole('alert')).toHaveTextContent(t('albumImport.wrongType'));
  const exact = new File([], 'album.HTM');
  Object.defineProperty(exact, 'size', { value: MAX_ALBUM_HTML_BYTES });
  choose(exact);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('button', { name: t('albumImport.confirm') })).toBeEnabled();
  expect(upload).not.toHaveBeenCalled();
});

it('shows a server error without navigating and allows retrying the same selected file', async () => {
  upload.mockRejectedValueOnce(new Error('Invalid manifest')).mockResolvedValueOnce(report);
  mount();
  const file = choose();
  submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid manifest');
  expect(screen.getByLabelText('location')).toHaveTextContent('/gallery?collection=short&q=old');
  submit();
  await screen.findByRole('status');
  expect(upload).toHaveBeenCalledTimes(2);
  expect(upload.mock.calls[1][0]).toBe(file);
});

it('locks same-tick duplicate submissions, aborts on cancel and ignores a late success', async () => {
  let finish!: (value: AlbumHtmlImportResult) => void;
  upload.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
  mount();
  choose();
  const button = screen.getByRole('button', { name: t('albumImport.confirm') });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(upload).toHaveBeenCalledTimes(1);
  const signal = upload.mock.calls[0][1];
  expect(signal.aborted).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: t('common.cancel') }));
  expect(signal.aborted).toBe(true);
  await act(async () => finish(report));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: t('albumImport.action') }));
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('button', { name: t('albumImport.confirm') })).toBeDisabled();
});

it('aborts an upload on unmount and ignores its later failure', async () => {
  let fail!: (error: Error) => void;
  upload.mockImplementation(() => new Promise((_resolve, reject) => (fail = reject)));
  const view = mount();
  choose();
  submit();
  const signal = upload.mock.calls[0][1];
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => fail(new Error('connection closed')));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
