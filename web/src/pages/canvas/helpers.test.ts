import { describe, expect, it } from 'vitest';
import type { Take } from '../../api/types';
import { toMaskParams } from '../board/mask';
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
    const picked = pickAdopted(
      [
        take('a', { status: 'rejected' }),
        take('b', {}),
        take('c', {}),
        take('d', { panel_id: 'p2', status: 'candidate' }),
      ],
      null,
    );
    expect(picked).toEqual({ p1: 'asset_b' });
  });

  it('only considers the requested variant', () => {
    const takes = [take('a', {}), take('v', { variant_id: 'var_1' })];
    expect(pickAdopted(takes, 'var_1')).toEqual({ p1: 'asset_v' });
    expect(pickAdopted(takes, null)).toEqual({ p1: 'asset_a' });
  });
});

describe('toMaskParams', () => {
  it('splits shapes into the server inpaint params (0–1 fractions)', () => {
    expect(
      toMaskParams([
        { kind: 'box', box: [0.1, 0.2, 0.5, 0.6] },
        {
          kind: 'lasso',
          points: [
            [0, 0],
            [1, 0],
            [0.5, 1],
          ],
        },
      ]),
    ).toEqual({
      boxes: [[0.1, 0.2, 0.5, 0.6]],
      polygons: [
        [
          [0, 0],
          [1, 0],
          [0.5, 1],
        ],
      ],
    });
  });
});
