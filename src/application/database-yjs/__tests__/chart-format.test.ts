import {
  formatChartValue,
  formatFieldCurrency,
  formatShare,
  resolveChartLocale,
  roundHalfAwayFromZero,
} from '../chart-format';
import { currencyFormaterMap, NumberFormat } from '../fields/number';

describe('roundHalfAwayFromZero', () => {
  it.each([
    [1.005, 2, 1.01],
    [-1.125, 2, -1.13],
    [2.675, 2, 2.68],
    [1.5, 0, 2],
    [-2.5, 0, -3],
    [0.125, 2, 0.13],
    [999.995, 2, 1000],
    [1e21, 2, 1e21],
    [1.5e-7, 2, 0],
    [1.5e-7, 7, 2e-7],
    [0.006, 2, 0.01],
    [0.0004, 2, 0],
    [12345.678, 0, 12346],
  ])('rounds %p to %p digits as %p', (value, digits, expected) => {
    expect(roundHalfAwayFromZero(value, digits)).toBe(expected);
  });

  it('never returns a negative zero', () => {
    expect(Object.is(roundHalfAwayFromZero(0, 2), 0)).toBe(true);
    expect(Object.is(roundHalfAwayFromZero(-0, 2), 0)).toBe(true);
    expect(Object.is(roundHalfAwayFromZero(-0.004, 2), 0)).toBe(true);
  });

  it('leaves non-finite values alone', () => {
    expect(roundHalfAwayFromZero(Number.POSITIVE_INFINITY, 2)).toBe(Number.POSITIVE_INFINITY);
    expect(Number.isNaN(roundHalfAwayFromZero(Number.NaN, 2))).toBe(true);
  });
});

describe('resolveChartLocale', () => {
  it.each([
    ['en', 'en-US'],
    ['zh', 'zh-CN'],
    ['zh-CN', 'zh-CN'],
    ['zh_TW', 'zh-TW'],
    ['pt', 'pt-BR'],
    ['de-DE', 'de-DE'],
    ['', 'en-US'],
    [undefined, 'en-US'],
    ['not a locale', 'en-US'],
  ])('%p → %p', (language, expected) => {
    expect(resolveChartLocale(language)).toBe(expected);
  });
});

describe('formatChartValue', () => {
  const sum = { aggregation: 1, yField: { type: 'number' as const, numberFormat: NumberFormat.Num }, locale: 'en-US' };

  it('never prints a negative zero', () => {
    expect(formatChartValue(-0.0001, { ...sum, mode: 'tooltip' })).toBe('0');
    expect(formatChartValue(-0, { ...sum, mode: 'axis' })).toBe('0');
    expect(
      formatChartValue(-0.001, {
        ...sum,
        yField: { type: 'number', numberFormat: NumberFormat.USD },
        mode: 'tooltip',
      })
    ).toBe('$0.00');
  });

  it('reuses its Intl formatters', () => {
    formatChartValue(1234.5, { ...sum, mode: 'tooltip' });
    formatChartValue(1234.5, { ...sum, mode: 'axis' });
    formatChartValue(1234.5, { ...sum, yField: { type: 'number', numberFormat: NumberFormat.USD }, mode: 'tooltip' });
    const construct = jest.spyOn(Intl, 'NumberFormat');

    try {
      for (let index = 0; index < 50; index += 1) {
        formatChartValue(1234.5 + index, { ...sum, mode: 'tooltip' });
        formatChartValue(1234.5 + index, { ...sum, mode: 'axis' });
        formatChartValue(1234.5 + index, {
          ...sum,
          yField: { type: 'number', numberFormat: NumberFormat.USD },
          mode: 'tooltip',
        });
      }

      expect(construct).not.toHaveBeenCalled();
    } finally {
      construct.mockRestore();
    }
  });

  it('builds one formatter per distinct locale and digits', () => {
    const construct = jest.spyOn(Intl, 'NumberFormat');

    try {
      // Digits no other test uses, so these formatters are not cached yet.
      formatChartValue(1.23456, { ...sum, mode: 'tooltip', decimalPlaces: 5, locale: 'fr-FR' });
      formatChartValue(2.34567, { ...sum, mode: 'tooltip', decimalPlaces: 5, locale: 'fr-FR' });
      expect(construct).toHaveBeenCalledTimes(1);
      formatChartValue(1.23456, { ...sum, mode: 'tooltip', decimalPlaces: 4, locale: 'fr-FR' });
      expect(construct).toHaveBeenCalledTimes(2);
    } finally {
      construct.mockRestore();
    }
  });

  it('formats the days of a date range with the given labels', () => {
    const days = (count: number) => `${count} Tage`;

    expect(formatChartValue(3.4, { aggregation: 15, mode: 'tooltip', locale: 'de-DE', labels: { days } })).toBe('3 Tage');
  });

  it('formats a date aggregation in the local time zone by default', () => {
    const text = formatChartValue(20361.5, {
      aggregation: 13,
      yField: { type: 'date', dateFormat: 2 },
      mode: 'tooltip',
      locale: 'en-US',
    });

    expect(text).toMatch(/^2025-(09-30|10-01)$/);
  });
});

describe('formatShare', () => {
  it.each([
    [4, 12, '33.3%'],
    [5, 10, '50%'],
    [1300000, 2038500, '63.8%'],
    [48500, 2038500, '2.4%'],
    [1, 0, '0%'],
  ])('%p of %p is %p', (value, total, expected) => {
    expect(formatShare(value, total)).toBe(expected);
  });
});

describe('formatFieldCurrency', () => {
  const currencies = (Object.values(NumberFormat).filter((value) => typeof value === 'number') as NumberFormat[]).filter(
    (format) => format !== NumberFormat.Num && format !== NumberFormat.Percent
  );

  it.each(currencies)('prints currency %p like its cells at 0–2 digits', (format) => {
    [1234567.891, -1234.5, 0, 12.5, 999.25].forEach((value) => {
      expect(formatFieldCurrency(value, format, 0, 2)).toBe(currencyFormaterMap[format](value));
    });
  });

  it('prints fixed digits', () => {
    expect(formatFieldCurrency(12.5, NumberFormat.USD, 2, 2)).toBe('$12.50');
    expect(formatFieldCurrency(-12.5, NumberFormat.EUR, 2, 2)).toBe('€-12,50');
    expect(formatFieldCurrency(48499.5, NumberFormat.USD, 0, 0)).toBe('$48,500');
  });
});

describe('currencyFormaterMap (cells)', () => {
  // Guards the cell output the chart currency path mirrors.
  it.each([
    [NumberFormat.USD, ['$1,234,567.89', '-$1,234.5', '$0']],
    [NumberFormat.EUR, ['€1.234.567,89', '€-1.234,5', '€0']],
    [NumberFormat.Ruble, ['1 234 567,89 RUB', '-1 234,5 RUB', '0 RUB']],
    [NumberFormat.Percent, ['123,456,789.1%', '-123,450%', '0%']],
  ])('prints %p as before', (format, expected) => {
    expect([1234567.891, -1234.5, 0].map((value) => currencyFormaterMap[format as NumberFormat](value))).toEqual(
      expected
    );
  });
});
