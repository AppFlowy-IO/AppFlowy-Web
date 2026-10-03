import { fireEvent, render, screen } from '@testing-library/react';
import { TFunction } from 'i18next';

import { ChartAggregationType, resolveEffectiveAggregation } from '@/application/database-yjs/chart.type';
import NumberChartWidget from '@/components/database/chart/widgets/NumberChart';
import { getChartSeriesTitle, getNumberChartTitle } from '@/components/database/chart/widgets/numberChartUtils';

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
      <NumberChartWidget item={{ label: '', value: 1234.567, rowIds: ['r1', 'r2'] }} title='Sum of Amount' valueText='1,235' />
    );

    expect(screen.getByTestId('number-chart').getAttribute('data-empty')).toBe('false');
    expect(screen.getByTestId('number-chart-value').textContent).toBe('1,235');
    expect(screen.getByTestId('number-chart-title').textContent).toBe('Sum of Amount');
  });

  it('shows the empty state when no rows match', () => {
    render(<NumberChartWidget item={{ label: '', value: 0, rowIds: [] }} title='Count all' valueText='0' />);

    expect(screen.getByTestId('number-chart').getAttribute('data-empty')).toBe('true');
    expect(screen.queryByTestId('number-chart-value')).toBeNull();
    expect(screen.getByText('No rows to count')).toBeTruthy();
    expect(screen.getByTestId('number-chart-title').textContent).toBe('Count all');
  });

  it('drills down with the title as label when clicked', () => {
    const onItemClick = jest.fn();

    render(
      <NumberChartWidget
        item={{ label: '', value: 2, rowIds: ['r1', 'r2'], color: '#000' }}
        onItemClick={onItemClick}
        title='Count all'
        valueText='2'
      />
    );

    fireEvent.click(screen.getByTestId('number-chart-value'));
    expect(onItemClick).toHaveBeenCalledWith({ label: 'Count all', value: 2, rowIds: ['r1', 'r2'], color: '#000' });
  });

  it('is not a button to press without a drill-down', () => {
    render(<NumberChartWidget item={{ label: '', value: 2, rowIds: ['r1'] }} title='Count all' valueText='2' />);

    expect(screen.getByTestId<HTMLButtonElement>('number-chart-value').disabled).toBe(true);
  });
});

describe('getNumberChartTitle', () => {
  it('prefers the custom title', () => {
    expect(
      getNumberChartTitle(interpolatingT, {
        titleText: '  Revenue  ',
        aggregation: ChartAggregationType.Sum,
        yFieldName: 'Amount',
      })
    ).toBe('Revenue');
  });

  it('generates Count all and <aggregation> of <field>', () => {
    expect(getNumberChartTitle(interpolatingT, { aggregation: ChartAggregationType.Count, yFieldName: '' })).toBe(
      'Count all'
    );
    expect(getNumberChartTitle(interpolatingT, { aggregation: ChartAggregationType.Average, yFieldName: 'Amount' })).toBe(
      'Average of Amount'
    );
    // A value aggregation without its Y field counts rows (`resolveEffectiveAggregation`).
    expect(
      getNumberChartTitle(interpolatingT, {
        aggregation: resolveEffectiveAggregation(ChartAggregationType.Max, false),
        yFieldName: 'Amount',
      })
    ).toBe('Count all');
  });

  it('names an untitled field and ignores a blank custom title', () => {
    expect(
      getNumberChartTitle(interpolatingT, { titleText: '   ', aggregation: ChartAggregationType.Sum, yFieldName: '' })
    ).toBe('Sum of Untitled');
    expect(getChartSeriesTitle(interpolatingT, { aggregation: ChartAggregationType.Median, yFieldName: 'Amount' })).toBe(
      'Median of Amount'
    );
  });
});
