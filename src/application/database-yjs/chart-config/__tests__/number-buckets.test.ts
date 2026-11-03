import { loadParityFixture } from '../../__tests__/dashboard-parity-helpers';
import { MAX_NUMBER_BUCKETS, niceStep, numberBucketRef, resolveNumberBuckets } from '../number-buckets';

import { axisFormatter } from './fixture-helpers';

interface BucketCase {
  name: string;
  values: number[];
  settings: { size?: number; min?: number; max?: number };
  expect: null | {
    size: number;
    start: number;
    min?: number;
    max?: number;
    groups: { key: string; label: string; count: number }[];
  };
}

const fixture = loadParityFixture<{ numberBuckets: BucketCase[]; niceStep: [number, number][] }>('group-keys.json');
const format = axisFormatter(0);

describe('resolveNumberBuckets (dashboard-parity/group-keys.json#numberBuckets)', () => {
  it.each(fixture.numberBuckets.map((entry) => [entry.name, entry] as const))('%s', (_, entry) => {
    const buckets = resolveNumberBuckets(entry.values, entry.settings);

    if (entry.expect === null) {
      expect(buckets).toBeNull();
      return;
    }

    const { groups, ...resolved } = entry.expect;

    expect(buckets).toEqual(resolved);
    const counts = new Map<string, { key: string; label: string; count: number; rank: number }>();

    entry.values.forEach((value) => {
      const ref = numberBucketRef(value, buckets!, format);
      const rank = 'rank' in ref.hint ? ref.hint.rank : 0;
      const known = counts.get(ref.key);

      if (known) known.count += 1;
      else counts.set(ref.key, { key: ref.key, label: ref.label, count: 1, rank });
    });
    expect(
      [...counts.values()].sort((a, b) => a.rank - b.rank).map(({ key, label, count }) => ({ key, label, count }))
    ).toEqual(groups);
  });

  it('never draws more than 200 ranges', () => {
    const buckets = resolveNumberBuckets([0, 1_000_000], { size: 1 })!;

    expect(Math.floor((1_000_000 - buckets.start) / buckets.size) + 1).toBeLessThanOrEqual(MAX_NUMBER_BUCKETS);
  });
});

describe('niceStep (dashboard-parity/group-keys.json#niceStep)', () => {
  it.each(fixture.niceStep)('niceStep(%p) = %p', (x, step) => {
    expect(niceStep(x)).toBe(step);
  });
});
