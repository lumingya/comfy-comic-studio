import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockFetch } from '../test/utils';
import { api, ApiError, assetUrl, data, raw } from './client';

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('returns data for 2xx', async () => {
    mockFetch({ 'GET /api/series': [{ id: 's1', title: 'A' }] });
    const list = data(await api.GET('/api/series', {}));
    expect(list).toEqual([{ id: 's1', title: 'A' }]);
  });

  it('turns the server error envelope into ApiError', async () => {
    mockFetch({
      'GET /api/series/nope': new Response(
        JSON.stringify({ detail: '作品不存在', kind: 'not_found' }),
        { status: 404 },
      ),
    });
    const err = await api
      .GET('/api/series/{series_id}', { params: { path: { series_id: 'nope' } } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, kind: 'not_found', message: '作品不存在' });
  });

  it('flattens FastAPI validation errors', async () => {
    mockFetch({
      'POST /api/series': new Response(
        JSON.stringify({ detail: [{ loc: ['body', 'title'], msg: 'Field required' }] }),
        { status: 422 },
      ),
    });
    const err = await api.POST('/api/series', { body: { title: '' } }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 422, kind: 'invalid', message: 'title: Field required' });
  });

  it('falls back to the status text for non-JSON errors', async () => {
    mockFetch({ 'GET /api/x': new Response('boom', { status: 502, statusText: 'Bad Gateway' }) });
    await expect(raw('/api/x')).rejects.toMatchObject({ status: 502, message: 'Bad Gateway' });
  });

  it('builds asset URLs with optional thumbnails', () => {
    expect(assetUrl('a1')).toBe('/api/assets/a1');
    expect(assetUrl('a1', 240)).toBe('/api/assets/a1?thumb=240');
  });
});
