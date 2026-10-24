import { fireEvent, render, screen } from '@testing-library/react';
import { TFunction } from 'i18next';

import { effectiveChartAggregation } from '@/application/database-yjs/chart-config';
import { ChartAggregationType } from '@/application/database-yjs/chart.type';
import { FieldType } from '@/application/database-yjs/database.type';
import NumberChartWidget from '@/components/database/chart/widgets/NumberChart';
import {
  getChartSeriesTitle,
  getNumberChartTitle,
  numberColorVar,
} from '@/components/database/chart/widgets/numberChartUtils';

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
  it('renders the caption above the formatted value', () => {
    render(
      <NumberChartWidget
        item={{ label: '', value: 1234.567, rowIds: ['r1', 'r2'] }}
        title='Sum of Amount'
        showTitle
        color={null}
        valueText='1,235'
      />
    );

    const title = screen.getByTestId('number-chart-title');
    const value = screen.getByTestId('number-chart-value');

    expect(screen.getByTestId('number-chart').getAttribute('data-empty')).toBe('false');
    expect(value.textContent).toBe('1,235');
    expect(title.textContent).toBe('Sum of Amount');
    // The caption comes first in the DOM (WP11 §1.11).
    expect(title.compareDocumentPosition(value) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(title.getAttribute('data-parity-id')).toBe('dash-number-caption');
    expect(title.className).toContain('text-base');
    expect(title.className).toContain('font-semibold');
  });

  it('draws the value at 16% of the card width between 40 and 60px, semibold and tabular', () => {
    render(<NumberChartWidget item={{ label: '', value: 3, rowIds: ['r1'] }} title='Count all' valueText='3' />);

    const value = screen.getByTestId('number-chart-value');

    expect(value.className).toContain('[font-size:clamp(40px,16cqw,60px)]');
    expect(value.className).toContain('leading-[1.1]');
    expect(value.className).toContain('tabular-nums');
    expect(value.className).toContain('font-semibold');
    // The root is the size container and has no horizontal padding, so `cqw` is the card width.
    expect(screen.getByTestId('number-chart').style.containerType).toBe('inline-size');
    expect(screen.getByTestId('number-chart').className).not.toMatch(/\bpx-/);
  });

  it('hides only the caption when show_title is off', () => {
    render(
      <NumberChartWidget item={{ label: '', value: 3, rowIds: ['r1'] }} title='Count all' showTitle={false} valueText='3' />
    );

    expect(screen.queryByTestId('number-chart-title')).toBeNull();
    expect(screen.getByTestId('number-chart-value').textContent).toBe('3');
  });

  it('names the value color in data-color', () => {
    const { rerender } = render(
      <NumberChartWidget item={{ label: '', value: 3, rowIds: ['r1'] }} title='Count all' color='blue' valueText='3' />
    );
    const value = () => screen.getByTestId('number-chart-value');

    expect(value().getAttribute('data-color')).toBe('blue');
    rerender(<NumberChartWidget item={{ label: '', value: 3, rowIds: ['r1'] }} title='Count all' color={null} valueText='3' />);
    expect(value().getAttribute('data-color')).toBe('default');
  });

  it('shows only "No data" when no rows match: no caption, no value', () => {
    render(<NumberChartWidget item={{ label: '', value: 0, rowIds: [] }} title='Count all' valueText='0' />);

    expect(screen.getByTestId('number-chart').getAttribute('data-empty')).toBe('true');
    expect(screen.queryByTestId('number-chart-value')).toBeNull();
    expect(screen.getByTestId('number-chart-empty').textContent).toBe('No data');
    expect(screen.getByTestId('number-chart-empty').className).toContain('text-text-tertiary');
    expect(screen.queryByTestId('number-chart-title')).toBeNull();
  });

  it('shows "No data" for no value (an average over empty cells)', () => {
    render(<NumberChartWidget item={null} title='Average of Amount' valueText='' />);

    expect(screen.getByTestId('number-chart-empty').textContent).toBe('No data');
    expect(screen.queryByTestId('number-chart-title')).toBeNull();
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

describe('numberColorVar', () => {
  it('maps every color to its theme variable and unknown names to default', () => {
    expect(numberColorVar('blue')).toBe('var(--chart-number-blue)');
    expect(numberColorVar(null)).toBe('var(--chart-number-default)');
    expect(numberColorVar('neon')).toBe('var(--chart-number-default)');
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
    // A value aggregation without its Y field counts rows (`effectiveChartAggregation`).
    expect(
      getNumberChartTitle(interpolatingT, {
        aggregation: effectiveChartAggregation(ChartAggregationType.Max, null),
        yFieldName: 'Amount',
      })
    ).toBe('Count all');
  });

  it('names the WP11 aggregations', () => {
    expect(
      getNumberChartTitle(interpolatingT, { aggregation: ChartAggregationType.CountNotEmpty, yFieldName: 'Status' })
    ).toBe('Count values of Status');
    expect(
      getNumberChartTitle(interpolatingT, { aggregation: ChartAggregationType.PercentChecked, yFieldName: 'Urgent' })
    ).toBe('Percent checked of Urgent');
    expect(
      getNumberChartTitle(interpolatingT, { aggregation: ChartAggregationType.CountUnique, yFieldName: 'Status' })
    ).toBe('Count unique values of Status');
    // A legacy Max over a date reads as Latest.
    expect(
      getNumberChartTitle(interpolatingT, {
        aggregation: effectiveChartAggregation(ChartAggregationType.Max, FieldType.DateTime),
        yFieldName: 'Due',
      })
    ).toBe('Latest of Due');
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
