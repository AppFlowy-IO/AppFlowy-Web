import { renderHook } from '@testing-library/react';

import { ChartAggregationType } from '@/application/database-yjs/chart.type';
import { NumberFormat } from '@/application/database-yjs/fields';

import { useChartFormatter, UseChartFormatterOptions } from './useChartFormatter';

let mockLanguage = 'en';
const mockT = (key: string, options?: { defaultValue?: string; count?: number }) =>
  key === 'chart.value.days' ? `${options?.count} Tage` : options?.defaultValue ?? key;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT, i18n: { language: mockLanguage } }),
}));

const BASE: UseChartFormatterOptions = {
  aggregation: ChartAggregationType.Sum,
  yField: null,
  decimalPlaces: null,
  numberFormat: 'auto',
};

function formatter(options: Partial<UseChartFormatterOptions> = {}) {
  return renderHook(() => useChartFormatter({ ...BASE, ...options })).result.current;
}

describe('useChartFormatter', () => {
  beforeEach(() => {
    mockLanguage = 'en';
  });

  // The Number card prints through `card` mode (these were `formatNumberChartValue`'s cases).
  describe('card mode', () => {
    it('uses the field currency format for value aggregations in auto mode', () => {
      const format = formatter({ yField: { type: 'number', numberFormat: NumberFormat.USD } });

      expect(format(1500.456, 'card')).toBe('$1,500');
    });

    it('ignores the field format for counts', () => {
      const format = formatter({
        aggregation: ChartAggregationType.Count,
        yField: { type: 'number', numberFormat: NumberFormat.USD },
      });

      expect(format(1500, 'card')).toBe('1,500');
    });

    it('supports compact and percent formats', () => {
      expect(formatter({ numberFormat: 'compact' })(12_345, 'card')).toBe('12.3K');
      expect(formatter({ aggregation: ChartAggregationType.Average, numberFormat: 'percent' })(0.256, 'card')).toBe(
        '25.6%'
      );
    });

    it('keeps the decimals of a Percent field like its cells', () => {
      // Average of 0.125 and 0.13: rounding before scaling would show 13%.
      expect(
        formatter({
          aggregation: ChartAggregationType.Average,
          yField: { type: 'number', numberFormat: NumberFormat.Percent },
        })(0.1275, 'card')
      ).toBe('12.75%');
      expect(formatter({ aggregation: ChartAggregationType.Median })(1.234567, 'card')).toBe('1.23');
    });

    it('applies decimal places and the chart locale', () => {
      expect(
        formatter({ yField: { type: 'number', numberFormat: NumberFormat.Num }, decimalPlaces: 2 })(1234.5, 'card')
      ).toBe('1,234.50');
      mockLanguage = 'zh-CN';
      expect(formatter({ numberFormat: 'compact' })(78_500_000, 'card')).toBe('7850万');
    });

    it('guards against non-finite values', () => {
      expect(formatter()(Number.NaN, 'card')).toBe('0');
    });

    it('applies the card format only in card mode', () => {
      const format = formatter({ numberFormat: 'percent' });

      expect(format(0.256, 'card')).toBe('25.6%');
      expect(format(0.256, 'tooltip')).toBe('0.26');
    });
  });

  it('keeps the formatter while its inputs are the same, and replaces it when the Y format changes', () => {
    const usd = { type: 'number' as const, numberFormat: NumberFormat.USD };
    const { result, rerender } = renderHook((options: UseChartFormatterOptions) => useChartFormatter(options), {
      initialProps: { ...BASE, yField: usd },
    });
    const first = result.current;

    // `useChartFields` hands over the same object while the Y format is the same.
    rerender({ ...BASE, yField: usd });
    expect(result.current).toBe(first);

    rerender({ ...BASE, yField: { type: 'number', numberFormat: NumberFormat.Percent } });
    expect(result.current).not.toBe(first);
    expect(result.current(0.5, 'tooltip')).toBe('50%');
  });

  it('localizes the days of a date range', () => {
    expect(formatter({ aggregation: 15 as ChartAggregationType })(3.4, 'tooltip')).toBe('3 Tage');
  });
});
