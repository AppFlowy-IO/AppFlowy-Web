/**
 * `resolveChartTap` against `dashboard-parity/chart-tap.json` (WP14 §1.4.6),
 * the cases desktop's `chart_tap.dart` reads too.
 */
import { loadParityFixture } from '@/application/database-yjs/__tests__/dashboard-parity-helpers';
import { chartTypeOf } from '@/application/database-yjs/chart-config/__tests__/fixture-helpers';

import { ChartTapAction, resolveChartTap } from '../chartTap';

interface TapCase {
  name: string;
  mobile: boolean;
  chart_type: string;
  selected: string | null;
  tapped: string | null;
  expected: ChartTapAction;
}

const fixture = loadParityFixture<{ fixture: string; version: number; cases: TapCase[] }>('chart-tap.json');

describe('resolveChartTap (dashboard-parity/chart-tap.json)', () => {
  it('is the chart-tap fixture, version 1', () => {
    expect(fixture.fixture).toBe('chart-tap');
    expect(fixture.version).toBe(1);
  });

  it.each(fixture.cases.map((entry) => [entry.name, entry] as const))('%s', (_, entry) => {
    expect(
      resolveChartTap({
        mobile: entry.mobile,
        chartType: chartTypeOf(entry.chart_type),
        selectedKey: entry.selected,
        tappedKey: entry.tapped,
      })
    ).toBe(entry.expected);
  });

  it('covers every branch and every chart type', () => {
    const outcomes = new Set(fixture.cases.map((entry) => entry.expected));
    const mobileTypes = new Set(fixture.cases.filter((entry) => entry.mobile).map((entry) => entry.chart_type));

    expect([...outcomes].sort()).toEqual(['clear', 'drill', 'select']);
    expect([...mobileTypes].sort()).toEqual(['Bar', 'Donut', 'HorizontalBar', 'Line', 'NumberChart']);
    // Each rule decides at least one case: outside, desktop, Number, same category, another category.
    expect(fixture.cases.some((entry) => entry.tapped === null && entry.mobile)).toBe(true);
    expect(fixture.cases.some((entry) => entry.tapped === null && !entry.mobile)).toBe(true);
    expect(fixture.cases.some((entry) => !entry.mobile && entry.tapped !== null && entry.selected !== entry.tapped)).toBe(
      true
    );
    expect(
      fixture.cases.some((entry) => entry.mobile && entry.chart_type === 'NumberChart' && entry.expected === 'drill')
    ).toBe(true);
    expect(fixture.cases.some((entry) => entry.mobile && entry.selected === entry.tapped && entry.tapped !== null)).toBe(
      true
    );
  });
});
