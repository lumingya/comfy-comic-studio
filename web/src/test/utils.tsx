import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

export interface Call {
  method: string;
  url: string;
  body: unknown;
}

/**
 * Replace global fetch with a route table: `"POST /api/x"` → JSON body (or a Response).
 * Returns the recorded calls so tests can assert what was sent.
 */
export function mockFetch(routes: Record<string, unknown | ((body: unknown) => unknown)>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const text = await request.clone().text();
    const body = text ? JSON.parse(text) : undefined;
    calls.push({ method: request.method, url: url.pathname + url.search, body });
    const key = `${request.method} ${url.pathname}`;
    if (!(key in routes))
      return new Response(JSON.stringify({ detail: `no route ${key}` }), { status: 404 });
    const value = routes[key];
    const result = typeof value === 'function' ? (value as (b: unknown) => unknown)(body) : value;
    return result instanceof Response
      ? result
      : new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

export function renderWithProviders(ui: ReactNode, route = '/') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}
