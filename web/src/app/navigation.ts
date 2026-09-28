/** Reader-only parameters must not erase the collection's search, sort or star filter. */
export function gallerySearch(params: URLSearchParams): string {
  const result = new URLSearchParams();
  for (const name of ['q', 'status', 'sort', 'starred']) {
    const value = params.get(name);
    if (value !== null) result.set(name, value);
  }
  return result.size ? `?${result}` : '';
}
