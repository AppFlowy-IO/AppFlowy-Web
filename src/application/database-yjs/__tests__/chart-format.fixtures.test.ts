import { CHART_CURRENCY_AFFIXES, ChartFormatContext, formatChartValue } from '../chart-format';

import { loadParityFixture } from './dashboard-parity-helpers';

interface FormatCase {
  value: number | 'NaN';
  ctx: Omit<ChartFormatContext, 'labels'>;
  expected: string;
}

interface FormatVectors {
  dayLabels: { one: string; other: string };
  currencyAffixes: Record<string, { prefix?: string; suffix?: string }>;
  cases: FormatCase[];
}

const fixture = loadParityFixture<FormatVectors>('format-vectors.json');
const days = (count: number) =>
  (count === 1 ? fixture.dayLabels.one : fixture.dayLabels.other).replace('{count}', String(count));

function describeCase({ value, ctx }: FormatCase) {
  const field = ctx.yField
    ? ` ${ctx.yField.type}(${ctx.yField.numberFormat ?? ctx.yField.dateFormat ?? ''})`
    : '';
  const extras = [ctx.numberFormat, ctx.decimalPlaces !== undefined ? `dp ${ctx.decimalPlaces}` : undefined, ctx.locale]
    .filter(Boolean)
    .join(' ');

  return `${value} agg ${ctx.aggregation}${field} ${ctx.mode} ${extras}`;
}

describe('formatChartValue (dashboard-parity/format-vectors.json)', () => {
  it('has a case for every row of WP10 §1.2', () => {
    expect(fixture.cases.length).toBe(60);
  });

  it.each(fixture.cases.map((entry) => [describeCase(entry), entry] as const))('%s', (_name, entry) => {
    const value = entry.value === 'NaN' ? Number.NaN : entry.value;

    expect(formatChartValue(value, { ...entry.ctx, labels: { days } })).toBe(entry.expected);
  });

  it('prints the compact currency affixes of the shared table', () => {
    const table = Object.fromEntries(Object.entries(CHART_CURRENCY_AFFIXES).map(([id, affix]) => [String(id), affix]));

    expect(table).toEqual(fixture.currencyAffixes);
  });
});
