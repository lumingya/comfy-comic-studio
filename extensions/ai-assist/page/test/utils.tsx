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

/** Route table for this independently built extension. No live service is used. */
export function mockFetch(routes: Record<string, unknown | ((body: unknown) => unknown)>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request
          ? input
          : new Request(new URL(String(input), window.location.origin), init);
      const url = new URL(request.url);
      const text = await request.clone().text();
      const body = text ? JSON.parse(text) : undefined;
      calls.push({ method: request.method, url: url.pathname + url.search, body });
      const key = `${request.method} ${url.pathname}`;
      const route =
        key in routes
          ? routes[key]
          : Object.entries(routes).find(([pattern]) =>
              pattern.endsWith('/*') ? key.startsWith(pattern.slice(0, -1)) : false,
            )?.[1];
      if (route === undefined)
        return new Response(JSON.stringify({ detail: `no route ${key}` }), { status: 404 });
      const value = route;
      const result = await (typeof value === 'function'
        ? (value as (b: unknown) => unknown)(body)
        : value);
      return result instanceof Response
        ? result
        : new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
    }),
  );
  return calls;
}

export function renderWithProviders(ui: ReactNode, route = '/') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
      </QueryClientProvider>
    ),
  });
}
