import { describe, expect, it } from 'vitest';
import type { Take } from '../../api/types';
import { pickAdopted } from './adopted';

const take = (id: string, extra: Partial<Take>): Take =>
  ({
    id,
    panel_id: 'p1',
    asset_id: `asset_${id}`,
    status: 'adopted',
    stage: 'draft',
    variant_id: null,
    created_at: '2026-01-01T00:00:00',
    ...extra,
  }) as Take;

describe('pickAdopted', () => {
  it('uses the first adopted take per panel, like the server', () => {
    const picked = pickAdopted([
      take('a', { status: 'rejected' }),
      take('b', {}),
      take('c', {}),
      take('d', { panel_id: 'p2', status: 'candidate' }),
    ]);
    expect(picked).toEqual({ p1: 'asset_b' });
  });

  it('ignores takes of other versions', () => {
    const takes = [take('v', { variant_id: 'var_1' }), take('a', {})];
    expect(pickAdopted(takes)).toEqual({ p1: 'asset_a' });
  });
});
