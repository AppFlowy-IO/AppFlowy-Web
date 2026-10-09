import { act, render, screen } from '@testing-library/react';

import { DEFAULT_CHART_EXTENDED_SETTINGS } from '@/application/database-yjs/chart-extended-settings';
import {
  ChartAggregationType,
  ChartDataItem,
  ChartLayoutSettings,
  ChartType,
} from '@/application/database-yjs/chart.type';
import { DateGroupCondition, FieldType } from '@/application/database-yjs/database.type';
import { ChartDrillTarget, numberChartDrillTarget, toDrillTarget } from '@/application/database-yjs/drill-query';
import { NumberFormat } from '@/application/database-yjs/fields';
import ChartProvider from '@/components/database/chart/ChartProvider';
import { toCategoryItems } from '@/components/database/chart/hooks/chartSeries';
import { UseChartDataReturn } from '@/components/database/chart/hooks/useChartData';
import { ChartContextValue, useChartContext } from '@/components/database/chart/useChartContext';
import {
  FIXTURE_MEASURE,
  firePointer,
  installChartEnvironment,
  seriesDataOf,
} from '@/components/database/chart/widgets/__tests__/chartTestUtils';
import BarChartWidget from '@/components/database/chart/widgets/BarChart';
import { ChartMeasureContext } from '@/components/database/chart/widgets/measureText';

const mockUseChartLayoutSetting = jest.fn();
const mockUseChartData = jest.fn();

jest.mock('react-i18next', () => {
  const t = (key: string, options?: Record<string, string>) =>
    (options?.defaultValue ?? key).replace(/{{(\w+)}}/g, (_: string, name: string) => options?.[name] ?? '');

  return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});

jest.mock('@/application/database-yjs', () => ({
  useChartLayoutSetting: () => mockUseChartLayoutSetting(),
  useDatabaseViewId: () => 'chart-view',
}));

jest.mock('@/components/database/chart/hooks', () => ({
  useChartData: (options: unknown) => mockUseChartData(options),
  useChartFormatter: jest.requireActual('@/components/database/chart/hooks/useChartFormatter').useChartFormatter,
}));

// D5's drill-down dialog; the provider only decides what it opens.
const mockDrillDialog = jest.fn();

jest.mock('@/components/database/chart/drill/ChartDrillDialog', () => {
  const ChartDrillDialog = (props: { target: unknown; title: string; onClose(): void }) => {
    mockDrillDialog(props);
    return (
      <button data-testid='drill-down' data-title={props.title} onClick={props.onClose} type='button'>
        drill
      </button>
    );
  };

  return { __esModule: true, ChartDrillDialog, default: ChartDrillDialog };
});

/** The props the dialog rendered with last. */
const lastDrill = () =>
  mockDrillDialog.mock.calls[mockDrillDialog.mock.calls.length - 1][0] as { target: ChartDrillTarget; title: string };

const SETTINGS: ChartLayoutSettings = {
  chartType: ChartType.Bar,
  xFieldId: 'stage',
  showEmptyValues: true,
  aggregationType: ChartAggregationType.Count,
  cumulative: false,
  dateCondition: DateGroupCondition.Month,
  extended: DEFAULT_CHART_EXTENDED_SETTINGS,
};

/** A series build as `useChartData` returns it (colours resolved, unpainted). */
function computed(won = 4) {
  return seriesDataOf([
    { key: 'lead', label: 'Lead', value: 3, rowIds: ['a', 'b', 'c'], color: '#5E9FE8' },
    { key: 'won', label: 'Won', value: won, rowIds: ['d', 'e', 'f', 'g'], color: '#72BC8F' },
  ]);
}

function chartData(overrides: Partial<UseChartDataReturn> = {}): UseChartDataReturn {
  return {
    seriesData: computed(),
    numberItem: null,
    groupByField: null,
    isLoading: false,
    xAxisField: null,
    fieldType: FieldType.Checkbox,
    hasGroupableFields: true,
    effectiveAggregation: ChartAggregationType.Count,
    yFieldName: '',
    yFormatField: null,
    loadError: false,
    retry: () => undefined,
    allGroups: [],
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
  const innerWidth = window.innerWidth;

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: innerWidth });
  });

  beforeEach(() => {
    seen = [];
    mockDrillDialog.mockClear();
    mockUseChartLayoutSetting.mockReturnValue(SETTINGS);
    mockUseChartData.mockImplementation(() => chartData());
  });

  // `useChartData` keeps its build while the content is the same; the provider
  // hands that build on as it is, and paints its colours for the theme.
  it('hands the series build on and paints its colours', () => {
    const data = chartData();

    mockUseChartData.mockImplementation(() => data);
    const { rerender } = render(
      <ChartProvider>
        <Probe />
      </ChartProvider>
    );
    const first = last().seriesData;

    expect(first).toBe(data.seriesData);
    expect(toCategoryItems(first, last().paint).map((item) => [item.label, item.color])).toEqual([
      ['Lead', '#5E9FE8'],
      ['Won', '#72BC8F'],
    ]);
    expect(last().hasGroupBy).toBe(false);
    expect(last().groupStyle).toBe('none');

    rerender(
      <ChartProvider>
        <Probe />
      </ChartProvider>
    );
    expect(last().seriesData).toBe(first);

    mockUseChartData.mockImplementation(() => chartData({ seriesData: computed(5) }));
    rerender(
      <ChartProvider>
        <Probe />
      </ChartProvider>
    );
    expect(last().seriesData).not.toBe(first);
    expect(last().seriesData.series[0].values[1]).toBe(5);
  });

  it('draws a Group by with the stored group style, and a line without one', () => {
    const grouped = computed();
    const seriesData = {
      ...grouped,
      series: [{ ...grouped.series[0], key: 'biz', label: 'Business', color: { kind: 'hex' as const, hex: '#DE9255', alpha: 1 } }],
    };

    mockUseChartLayoutSetting.mockReturnValue({ ...SETTINGS, extended: { ...SETTINGS.extended, groupStyle: 'percent' } });
    mockUseChartData.mockImplementation(() => chartData({ seriesData }));
    const { rerender } = render(
      <ChartProvider>
        <Probe />
      </ChartProvider>
    );

    expect(last().hasGroupBy).toBe(true);
    expect(last().groupStyle).toBe('percent');

    mockUseChartLayoutSetting.mockReturnValue({
      ...SETTINGS,
      chartType: ChartType.Line,
      extended: { ...SETTINGS.extended, groupStyle: 'percent' },
    });
    rerender(
      <ChartProvider>
        <Probe />
      </ChartProvider>
    );
    expect(last().groupStyle).toBe('none');
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

    // A new result object around the same build, as `useChartData` returns per render.
    mockUseChartData.mockImplementation(() => ({ ...data }));
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

    act(() => last().onItemClick?.(toCategoryItems(last().seriesData)[1]));
    expect(screen.getByTestId('drill-down').getAttribute('data-title')).toBe('Won');
  });

  it('opens ChartDrillDialog with the target of a bar or segment and the category as its title', () => {
    render(
      <ChartProvider>
        <Probe />
      </ChartProvider>
    );
    const segment: ChartDataItem = {
      label: 'Won',
      value: 2,
      rowIds: ['d', 'e'],
      key: 'won',
      categoryKey: 'won',
      seriesKey: 'biz',
      seriesLabel: 'Business',
    };

    act(() => last().onItemClick?.(segment));
    expect(lastDrill()).toEqual({ target: toDrillTarget(segment), title: 'Won', onClose: expect.any(Function) });
    expect(lastDrill().target).toEqual({
      xKey: 'won',
      xLabel: 'Won',
      xIsEmpty: false,
      subGroupKey: 'biz',
      subGroupLabel: 'Business',
      subGroupIsEmpty: false,
      rowIds: ['d', 'e'],
    });

    // The empty category drills into its key too.
    const empty: ChartDataItem = { label: 'No Stage', value: 1, rowIds: ['h'], key: '__empty__', isEmptyCategory: true };

    act(() => last().onItemClick?.(empty));
    expect(lastDrill().target).toEqual(toDrillTarget(empty));
    expect(lastDrill().target.xIsEmpty).toBe(true);
    expect(lastDrill().title).toBe('No Stage');
  });

  it('closes the drill-down through onClose', () => {
    render(
      <ChartProvider>
        <Probe />
      </ChartProvider>
    );
    act(() => last().onItemClick?.(toCategoryItems(last().seriesData)[0]));
    expect(screen.getByTestId('drill-down')).toBeTruthy();

    act(() => screen.getByTestId('drill-down').click());
    expect(screen.queryByTestId('drill-down')).toBeNull();
  });

  it('opens the Number card into its rows, titled by the caption the card shows', () => {
    const numberItem: ChartDataItem = { label: 'Amount', value: 4, rowIds: ['a', 'b', 'c', 'd'] };

    mockUseChartLayoutSetting.mockReturnValue({ ...SETTINGS, chartType: ChartType.Number });
    mockUseChartData.mockImplementation(() =>
      chartData({
        numberItem,
        effectiveAggregation: ChartAggregationType.Sum,
        yFieldName: 'Amount',
        yFormatField: { type: 'number', numberFormat: NumberFormat.Num },
      })
    );
    const { rerender } = render(
      <ChartProvider>
        <Probe />
      </ChartProvider>
    );

    expect(last().numberTitle).toBe('Sum of Amount');
    // The card hands its item relabelled with the caption.
    act(() => last().onItemClick?.({ ...numberItem, label: last().numberTitle }));
    expect(lastDrill().target).toEqual(numberChartDrillTarget('Sum of Amount', ['a', 'b', 'c', 'd']));
    expect(lastDrill().target.xKey).toBe('');
    expect(lastDrill().title).toBe('Sum of Amount');

    // A custom title is the caption, so it titles the drill-down.
    mockUseChartLayoutSetting.mockReturnValue({ ...SETTINGS, chartType: ChartType.Number, titleText: '  Pipeline  ' });
    rerender(
      <ChartProvider>
        <Probe />
      </ChartProvider>
    );
    expect(last().numberTitle).toBe('Pipeline');
    act(() => last().onItemClick?.({ ...numberItem, label: last().numberTitle }));
    expect(lastDrill().target).toEqual(numberChartDrillTarget('Pipeline', ['a', 'b', 'c', 'd']));
    expect(lastDrill().title).toBe('Pipeline');
  });

  describe('with a bar chart', () => {
    installChartEnvironment();

    function Bars() {
      const { seriesData, onItemClick } = useChartContext();

      return <BarChartWidget data={seriesData} onItemClick={onItemClick} />;
    }

    function renderBars() {
      return render(
        <ChartMeasureContext.Provider value={FIXTURE_MEASURE}>
          <ChartProvider>
            <Bars />
          </ChartProvider>
        </ChartMeasureContext.Provider>
      );
    }

    function tapBar(container: HTMLElement, index: number) {
      const anchor = container.querySelectorAll('[data-testid="chart-category-anchor"]')[index] as SVGRectElement;

      act(() => {
        firePointer(
          container.querySelector('.recharts-wrapper') as HTMLElement,
          'click',
          Number(anchor.getAttribute('x')) + 5,
          200
        );
      });
    }

    const won: ChartDataItem = {
      label: 'Won',
      value: 4,
      rowIds: ['d', 'e', 'f', 'g'],
      key: 'won',
      categoryKey: 'won',
      isEmptyCategory: false,
    };

    it('opens the drill-down of a bar on the first click on a desktop', () => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
      const { container } = renderBars();

      tapBar(container, 1);
      expect(lastDrill().target).toEqual(toDrillTarget(won));
      expect(lastDrill().title).toBe('Won');
    });

    it('needs two taps on a phone: the first shows the tooltip, the second opens the drill-down', () => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
      const { container } = renderBars();

      tapBar(container, 1);
      expect(screen.queryByTestId('drill-down')).toBeNull();
      expect(mockDrillDialog).not.toHaveBeenCalled();
      expect(screen.getByTestId('chart-tooltip').getAttribute('data-category')).toBe('Won');
      expect(screen.getByTestId('chart-tooltip-footer').textContent).toBe('Tap again to view data');

      tapBar(container, 1);
      expect(screen.getByTestId('drill-down').getAttribute('data-title')).toBe('Won');
      expect(lastDrill().target).toEqual(toDrillTarget(won));
      expect(screen.queryByTestId('chart-tooltip')).toBeNull();
    });
  });

  it('tells the charts whether the page is a mobile context', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    const { unmount } = render(
      <ChartProvider>
        <Probe />
      </ChartProvider>
    );

    expect(last().mobile).toBe(false);
    unmount();

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    render(
      <ChartProvider>
        <Probe />
      </ChartProvider>
    );
    expect(last().mobile).toBe(true);
  });
});
