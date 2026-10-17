import { ChartDataItem } from '@/application/database-yjs/chart.type';
import {
  calculateAxisInterval,
  computeHorizontalAxisMax,
  isPlottableValue,
} from '@/components/database/chart/widgets/chartUtils';

describe('computeHorizontalAxisMax', () => {
  it('rounds 25% headroom up to a nice number', () => {
    expect(computeHorizontalAxisMax(0)).toBe(4);
    expect(computeHorizontalAxisMax(3)).toBe(4);
    expect(computeHorizontalAxisMax(8)).toBe(10);
    expect(computeHorizontalAxisMax(80)).toBe(150);
    expect(computeHorizontalAxisMax(801)).toBe(1500);
    expect(computeHorizontalAxisMax(8000)).toBe(15000);
  });

  it('floors the decade with log / ln10 like desktop, one decade low at some exact powers of ten', () => {
    // 800 × 1.25 = 1000, and Math.log(1000) / Math.LN10 is 2.9999999999999996: magnitude 100, so
    // the normalized value 10 rounds up to 1000 rather than to 1.5 × 1000.
    expect(computeHorizontalAxisMax(799)).toBe(1000);
    expect(computeHorizontalAxisMax(800)).toBe(1000);
    expect(computeHorizontalAxisMax(800000)).toBe(1e6);
    expect(computeHorizontalAxisMax(8e12)).toBe(1e13);
  });
});

describe('calculateAxisInterval', () => {
  it('splits the maximum into about five 1 / 2 / 5 / 10 × 10^n steps', () => {
    expect(calculateAxisInterval(0)).toBe(1);
    expect(calculateAxisInterval(3)).toBe(1);
    expect(calculateAxisInterval(12)).toBe(5);
    expect(calculateAxisInterval(5000)).toBe(1000);
    expect(calculateAxisInterval(5e6)).toBe(1e6);
  });

  it('keeps the desktop decade for float-noisy maxima just above 5 × 10^n', () => {
    // Math.log10 would see decade 6 and pick 2e6; desktop's log / ln10 stays in decade 5.
    expect(calculateAxisInterval(5000000.000000001)).toBe(1e6);
  });
});

describe('isPlottableValue', () => {
  const item = (value: number): ChartDataItem => ({ label: 'Item', value, rowIds: [] });

  it('keeps finite, non-negative values only', () => {
    expect(isPlottableValue(item(0))).toBe(true);
    expect(isPlottableValue(item(2.5))).toBe(true);
    expect(isPlottableValue(item(-1))).toBe(false);
    expect(isPlottableValue(item(Number.NaN))).toBe(false);
    expect(isPlottableValue(item(Number.POSITIVE_INFINITY))).toBe(false);
  });
});
