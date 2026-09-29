import { fireEvent, render, screen } from '@testing-library/react';
import { TFunction } from 'i18next';

import { ChartAggregationType } from '@/application/database-yjs/chart.type';
import { NumberFormat } from '@/application/database-yjs/fields';
import NumberChartWidget from '@/components/database/chart/widgets/NumberChart';
import { formatNumberChartValue, getNumberChartTitle } from '@/components/database/chart/widgets/numberChartUtils';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string } | string) =>
      typeof options === 'string' ? options : options?.defaultValue ?? _key,
  }),
}));

const interpolatingT = ((key: string, options?: Record<string, string>) => {
  const template = options?.defaultValue ?? key;

  return template.replace(/{{(\w+)}}/g, (_, name: string) => options?.[name] ?? '');
}) as unknown as TFunction;

describe('NumberChartWidget', () => {
  it('renders the formatted value and title', () => {
    render(
      <NumberChartWidget
        item={{ label: '', value: 1234.567, rowIds: ['r1', 'r2'] }}
        title='Sum of Amount'
        numberFormat='auto'
        aggregationType={ChartAggregationType.Sum}
        fieldNumberFormat={NumberFormat.Num}
      />
    );

    expect(screen.getByTestId('number-chart').getAttribute('data-empty')).toBe('false');
    expect(screen.getByTestId('number-chart-value').textContent).toBe('1,234.57');
    expect(screen.getByTestId('number-chart-title').textContent).toBe('Sum of Amount');
  });

  it('shows the empty state when no rows match', () => {
    render(
      <NumberChartWidget
        item={{ label: '', value: 0, rowIds: [] }}
        title='Count all'
        numberFormat='auto'
        aggregationType={ChartAggregationType.Count}
      />
    );

    expect(screen.getByTestId('number-chart').getAttribute('data-empty')).toBe('true');
    expect(screen.queryByTestId('number-chart-value')).toBeNull();
    expect(screen.getByText('No rows to count')).toBeTruthy();
    expect(screen.getByTestId('number-chart-title').textContent).toBe('Count all');
  });

  it('drills down with the title as label when clicked', () => {
    const onClick = jest.fn();

    render(
      <NumberChartWidget
        item={{ label: '', value: 2, rowIds: ['r1', 'r2'], color: '#000' }}
        title='Count all'
        numberFormat='auto'
        aggregationType={ChartAggregationType.Count}
        onClick={onClick}
      />
    );

    fireEvent.click(screen.getByTestId('number-chart-value'));
    expect(onClick).toHaveBeenCalledWith({ label: 'Count all', value: 2, rowIds: ['r1', 'r2'], color: '#000' });
  });
});

describe('formatNumberChartValue', () => {
  it('uses the field currency format for value aggregations in auto mode', () => {
    expect(
      formatNumberChartValue(1500.456, {
        numberFormat: 'auto',
        aggregationType: ChartAggregationType.Sum,
        fieldNumberFormat: NumberFormat.USD,
      })
    ).toBe('$1,500.46');
  });

  it('ignores the field format for counts', () => {
    expect(
      formatNumberChartValue(1500, {
        numberFormat: 'auto',
        aggregationType: ChartAggregationType.Count,
        fieldNumberFormat: NumberFormat.USD,
      })
    ).toBe('1,500');
  });

  it('supports compact and percent formats', () => {
    expect(formatNumberChartValue(12_345, { numberFormat: 'compact', aggregationType: ChartAggregationType.Sum })).toBe(
      '12.3K'
    );
    expect(
      formatNumberChartValue(0.256, { numberFormat: 'percent', aggregationType: ChartAggregationType.Average })
    ).toBe('25.6%');
  });

  it('keeps the decimals of a Percent field like its cells', () => {
    // Average of 0.125 and 0.13: rounding before scaling would show 13%.
    expect(
      formatNumberChartValue(0.1275, {
        numberFormat: 'auto',
        aggregationType: ChartAggregationType.Average,
        fieldNumberFormat: NumberFormat.Percent,
      })
    ).toBe('12.75%');
    expect(
      formatNumberChartValue(1.234567, { numberFormat: 'auto', aggregationType: ChartAggregationType.Median })
    ).toBe('1.23');
  });

  it('guards against non-finite values', () => {
    expect(formatNumberChartValue(Number.NaN, { numberFormat: 'auto', aggregationType: ChartAggregationType.Sum })).toBe(
      '0'
    );
  });
});

describe('getNumberChartTitle', () => {
  it('prefers the custom title', () => {
    expect(
      getNumberChartTitle(interpolatingT, {
        titleText: '  Revenue  ',
        aggregationType: ChartAggregationType.Sum,
        yFieldName: 'Amount',
        hasYField: true,
      })
    ).toBe('Revenue');
  });

  it('generates Count all and <aggregation> of <field>', () => {
    expect(
      getNumberChartTitle(interpolatingT, {
        aggregationType: ChartAggregationType.Count,
        yFieldName: '',
        hasYField: false,
      })
    ).toBe('Count all');
    expect(
      getNumberChartTitle(interpolatingT, {
        aggregationType: ChartAggregationType.Average,
        yFieldName: 'Amount',
        hasYField: true,
      })
    ).toBe('Average of Amount');
    expect(
      getNumberChartTitle(interpolatingT, {
        aggregationType: ChartAggregationType.Max,
        yFieldName: 'Amount',
        hasYField: false,
      })
    ).toBe('Count all');
  });
});
