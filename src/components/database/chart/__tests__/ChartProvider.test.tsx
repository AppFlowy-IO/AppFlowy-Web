import { act, render, screen } from '@testing-library/react';

import { DEFAULT_CHART_EXTENDED_SETTINGS } from '@/application/database-yjs/chart-extended-settings';
import {
  ChartAggregationType,
  ChartDataItem,
  ChartLayoutSettings,
  ChartType,
} from '@/application/database-yjs/chart.type';
import { DateGroupCondition, FieldType } from '@/application/database-yjs/database.type';
import { NumberFormat } from '@/application/database-yjs/fields';
import ChartProvider from '@/components/database/chart/ChartProvider';
import { UseChartDataReturn } from '@/components/database/chart/hooks/useChartData';
import { ChartContextValue, useChartContext } from '@/components/database/chart/useChartContext';

const mockUseChartLayoutSetting = jest.fn();
const mockUseChartData = jest.fn();

jest.mock('react-i18next', () => {
  const t = (key: string, options?: Record<string, string>) =>
    (options?.defaultValue ?? key).replace(/{{(\w+)}}/g, (_: string, name: string) => options?.[name] ?? '');

  return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});

jest.mock('@/application/database-yjs', () => ({
  useChartLayoutSetting: () => mockUseChartLayoutSetting(),
}));

jest.mock('@/components/database/chart/hooks', () => ({
  useChartData: (options: unknown) => mockUseChartData(options),
  useChartFormatter: jest.requireActual('@/components/database/chart/hooks/useChartFormatter').useChartFormatter,
}));

jest.mock('@/components/database/chart/ChartRowListPopup', () => ({
  __esModule: true,
  default: ({ item }: { item: ChartDataItem }) => <div data-label={item.label} data-testid='drill-down' />,
}));

const SETTINGS: ChartLayoutSettings = {
  chartType: ChartType.Bar,
  xFieldId: 'stage',
  showEmptyValues: true,
  aggregationType: ChartAggregationType.Count,
  cumulative: false,
  dateCondition: DateGroupCondition.Month,
  extended: DEFAULT_CHART_EXTENDED_SETTINGS,
};

/** Freshly computed data, as `useChartData` returns after any recomputation. */
function computed(won = 4): ChartDataItem[] {
  return [
    { key: 'lead', label: 'Lead', value: 3, rowIds: ['a', 'b', 'c'] },
    { key: 'won', label: 'Won', value: won, rowIds: ['d', 'e', 'f', 'g'] },
  ];
}

function chartData(overrides: Partial<UseChartDataReturn> = {}): UseChartDataReturn {
  return {
    chartData: computed(),
    isLoading: false,
    xAxisField: null,
    fieldType: FieldType.Checkbox,
    hasGroupableFields: true,
    effectiveAggregation: ChartAggregationType.Count,
    yFieldName: '',
    yFormatField: null,
    loadError: false,
    retry: () => undefined,
    ...overrides,
  };
}

let seen: ChartContextValue[] = [];

function Probe() {
  seen.push(useChartContext());
  return null;
}

const last = () => seen[seen.length - 1];

describe('ChartProvider', () => {
  beforeEach(() => {
    seen = [];
    mockUseChartLayoutSetting.mockReturnValue(SETTINGS);
    mockUseChartData.mockImplementation(() => chartData());
  });

  // The single content comparison of the chart: the widgets below are plain
  // `memo` components and the hover compares the array by reference.
  it('keeps the data array while a recomputation yields the same content', () => {
    const { rerender } = render(
      <ChartProvider>
        <Probe />
      </ChartProvider>
    );
    const first = last().chartData;

    expect(first.map((item) => item.label)).toEqual(['Lead', 'Won']);
    // Colors are assigned here, at render time.
    expect(first.every((item) => typeof item.color === 'string' && item.color.length > 0)).toBe(true);

    // Rows hydrating in batches: a new array, the same chart.
    rerender(
      <ChartProvider>
        <Probe />
      </ChartProvider>
    );
    expect(last().chartData).toBe(first);

    mockUseChartData.mockImplementation(() => chartData({ chartData: computed(5) }));
    rerender(
      <ChartProvider>
        <Probe />
      </ChartProvider>
    );
    expect(last().chartData).not.toBe(first);
    expect(last().chartData[1].value).toBe(5);
  });

  it('gives a row that moved to another category a new array, although every value is the same', () => {
    const { rerender } = render(
      <ChartProvider>
        <Probe />
      </ChartProvider>
    );
    const first = last().chartData;
    const swapped = computed();

    swapped[1] = { ...swapped[1], rowIds: ['d', 'e', 'f', 'z'] };
    mockUseChartData.mockImplementation(() => chartData({ chartData: swapped }));
    rerender(
      <ChartProvider>
        <Probe />
      </ChartProvider>
    );
    expect(last().chartData).not.toBe(first);
    expect(last().chartData[1].rowIds).toEqual(['d', 'e', 'f', 'z']);
  });

  it('formats and titles a row count as a count', () => {
    render(
      <ChartProvider>
        <Probe />
      </ChartProvider>
    );

    expect(last().effectiveAggregation).toBe(ChartAggregationType.Count);
    expect(last().format(1234.5, 'tooltip')).toBe('1,235');
    expect(last().seriesLabel).toBe('Count all');
  });

  it('formats and titles a value aggregation with the Y field', () => {
    mockUseChartData.mockImplementation(() =>
      chartData({
        effectiveAggregation: ChartAggregationType.Sum,
        yFieldName: 'Amount',
        yFormatField: { type: 'number', numberFormat: NumberFormat.USD },
      })
    );
    render(
      <ChartProvider>
        <Probe />
      </ChartProvider>
    );

    expect(last().effectiveAggregation).toBe(ChartAggregationType.Sum);
    expect(last().format(234.5, 'tooltip')).toBe('$234.50');
    expect(last().seriesLabel).toBe('Sum of Amount');
  });

  it('keeps the context value while nothing it holds changed', () => {
    const data = chartData();

    mockUseChartData.mockImplementation(() => ({ ...data, chartData: computed() }));
    const { rerender } = render(
      <ChartProvider>
        <Probe />
      </ChartProvider>
    );
    const first = last();

    rerender(
      <ChartProvider>
        <Probe />
      </ChartProvider>
    );
    expect(last()).toBe(first);
  });

  it('opens the drill-down of the clicked item', () => {
    render(
      <ChartProvider>
        <Probe />
      </ChartProvider>
    );
    expect(screen.queryByTestId('drill-down')).toBeNull();

    act(() => last().onItemClick?.(last().chartData[1]));
    expect(screen.getByTestId('drill-down').getAttribute('data-label')).toBe('Won');
  });
});
