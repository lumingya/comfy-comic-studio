import type { Take } from '../../api/types';

/**
 * The take the compositor uses per panel — mirrors `Episode.adopted()` on the server: adoption is
 * exclusive per panel and variant, and the first adopted take wins.
 */
export function pickAdopted(takes: Take[], variantId: string | null): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const tk of takes) {
    if (tk.status !== 'adopted' || (tk.variant_id ?? null) !== variantId) continue;
    picked[tk.panel_id] ??= tk.asset_id;
  }
  return picked;
}
