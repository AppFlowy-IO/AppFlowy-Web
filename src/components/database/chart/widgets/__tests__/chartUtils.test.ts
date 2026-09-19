import { ChartDataItem } from '@/application/database-yjs/chart.type';

import { computeValueAxis, generateNiceTicks } from '../chartUtils';

function item(value: number): ChartDataItem {
  return { label: String(value), value, rowIds: [] };
}

describe('generateNiceTicks', () => {
  it('rounds fractional ticks to the step precision', () => {
    const ticks = generateNiceTicks(0, 1);

    expect(ticks).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
    ticks.forEach((tick) => expect(String(tick).length).toBeLessThanOrEqual(3));
  });

  it('keeps two decimals for a 0.25-style step', () => {
    expect(generateNiceTicks(0, 0.5, 2)).toEqual([0, 0.2, 0.4, 0.6]);
    expect(generateNiceTicks(0, 1.9, 8).every((tick) => Number(tick.toFixed(2)) === tick)).toBe(true);
  });

  it('uses whole-number steps for integer data', () => {
    expect(generateNiceTicks(0, 1, 8, true)).toEqual([0, 1]);
    expect(generateNiceTicks(0, 3, 8, true)).toEqual([0, 1, 2, 3]);
    expect(generateNiceTicks(0, 40, 8, true)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40]);
  });

  it('still handles large ranges and negative minimums', () => {
    expect(generateNiceTicks(0, 690000)).toEqual([0, 100000, 200000, 300000, 400000, 500000, 600000, 700000]);
    expect(generateNiceTicks(-5, 5, 8, true)).toEqual([-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]);
  });
});

describe('computeValueAxis', () => {
  it('gives count charts whole-number ticks', () => {
    const { domain, ticks } = computeValueAxis([item(1), item(1), item(1)]);

    expect(ticks.every(Number.isInteger)).toBe(true);
    expect(domain).toEqual([0, 1]);
  });

  it('keeps decimal ticks for fractional averages without float noise', () => {
    const { ticks } = computeValueAxis([item(0.25), item(0.75)]);

    ticks.forEach((tick) => expect(Number(tick.toFixed(4))).toBe(tick));
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(0.75);
  });
});
