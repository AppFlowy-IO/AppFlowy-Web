import { act, fireEvent, render, screen } from '@testing-library/react';
import { ReactNode } from 'react';

import { ChartAggregationType, ChartType } from '@/application/database-yjs/chart.type';
import Chart from '@/components/database/chart/Chart';
import { ChartContextValue, DEFAULT_CHART_CONTEXT } from '@/components/database/chart/useChartContext';
import { seriesDataOf } from '@/components/database/chart/widgets/__tests__/chartTestUtils';

const mockDatabaseContext: { isDashboardWidget?: boolean; paddingStart?: number; onRendered?: () => void } = {};
let mockContext: ChartContextValue = DEFAULT_CHART_CONTEXT;
let mockThrow = false;
const mockProviderMounts = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string } | string) =>
      typeof options === 'string' ? options : options?.defaultValue ?? key,
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/application/database-yjs', () => ({
  useDatabaseContext: () => mockDatabaseContext,
  useDatabaseViewId: () => 'chart-view',
}));

jest.mock('@/components/database/chart/ChartProvider', () => {
  const { useEffect } = jest.requireActual('react');
  const { ChartContext: Context } = jest.requireActual('@/components/database/chart/useChartContext');

  function MockChartProvider({ children }: { children: ReactNode }) {
    useEffect(() => {
      mockProviderMounts();
    }, []);
    return <Context.Provider value={mockContext}>{children}</Context.Provider>;
  }

  return { __esModule: true, default: MockChartProvider, ChartProvider: MockChartProvider };
});

jest.mock('@/components/database/chart/widgets/BarChart', () => ({
  __esModule: true,
  default: ({ fill }: { fill?: boolean }) => {
    if (mockThrow) throw new Error('chart crashed');
    return <div data-fill={fill ? 'true' : 'false'} data-testid='mock-bar-chart' />;
  },
}));

function context(overrides: Partial<ChartContextValue>): ChartContextValue {
  return {
    ...DEFAULT_CHART_CONTEXT,
    chartType: ChartType.Bar,
    effectiveAggregation: ChartAggregationType.Count,
    hasGroupableFields: true,
    isLoading: false,
    seriesData: seriesDataOf([{ key: 'a', label: 'A', value: 1, rowIds: ['r1'] }]),
    ...overrides,
  };
}

describe('Chart', () => {
  beforeEach(() => {
    mockDatabaseContext.isDashboardWidget = undefined;
    mockDatabaseContext.paddingStart = undefined;
    mockContext = context({});
    mockThrow = false;
    mockProviderMounts.mockClear();
  });

  it('fills a dashboard widget card without its own side padding', () => {
    mockDatabaseContext.isDashboardWidget = true;
    mockDatabaseContext.paddingStart = 12;
    render(<Chart />);

    const root = screen.getByTestId('database-chart');

    expect(root.className).toContain('h-full');
    expect(root.className).toContain('overflow-hidden');
    expect(root.style.paddingLeft).toBe('');
    expect(screen.getByTestId('mock-bar-chart').getAttribute('data-fill')).toBe('true');
  });

  it('keeps the page padding on a standalone chart', () => {
    render(<Chart />);

    expect(screen.getByTestId('database-chart').style.paddingLeft).toBe('96px');
    expect(screen.getByTestId('mock-bar-chart').getAttribute('data-fill')).toBe('false');
  });

  it('shows the preparing state while loading, not a spinner', () => {
    mockContext = context({ isLoading: true });
    render(<Chart />);

    expect(screen.getByTestId('chart-loading')).toBeTruthy();
    expect(document.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('shows the error state when the rows could not load, and Retry loads them again', () => {
    const retry = jest.fn();

    mockContext = context({ loadError: true, retry });
    render(<Chart />);
    fireEvent.click(screen.getByTestId('chart-error-retry'));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('catches a chart exception and remounts the chart on Retry', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      mockThrow = true;
      render(<Chart />);
      expect(screen.getByTestId('chart-error')).toBeTruthy();
      const mounts = mockProviderMounts.mock.calls.length;

      mockThrow = false;
      act(() => {
        fireEvent.click(screen.getByTestId('chart-error-retry'));
      });
      expect(screen.getByTestId('mock-bar-chart')).toBeTruthy();
      expect(mockProviderMounts.mock.calls.length).toBeGreaterThan(mounts);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('draws the empty donut ring for a donut without data', () => {
    mockContext = context({ chartType: ChartType.Donut, seriesData: seriesDataOf([]) });
    render(<Chart />);

    expect(screen.getByTestId('chart-no-data')).toBeTruthy();
  });

  it('says so when the database has no field to group by', () => {
    mockContext = context({ hasGroupableFields: false });
    render(<Chart />);

    expect(screen.getByTestId('chart-no-field').textContent).toBe('No fields available for grouping');
    expect(screen.queryByTestId('mock-bar-chart')).toBeNull();
  });

  it('clears a load error once the context reports none', () => {
    mockContext = context({ loadError: true });
    const { rerender } = render(<Chart />);

    expect(screen.getByTestId('chart-error')).toBeTruthy();
    mockContext = context({ loadError: false });
    rerender(<Chart />);
    expect(screen.queryByTestId('chart-error')).toBeNull();
    expect(screen.getByTestId('mock-bar-chart')).toBeTruthy();
  });

  describe('Number chart', () => {
    const item = { label: 'Amount', value: 1234.567, rowIds: ['r1', 'r2'] };

    it('prints the value through the chart formatter in card mode, under the generated title', () => {
      const format = jest.fn((value: number, mode: string) => `${mode}:${value}`);

      mockContext = context({
        chartType: ChartType.Number,
        numberItem: item,
        format,
        seriesLabel: 'Sum of Amount',
        // `ChartProvider` resolves the caption (`getNumberChartTitle`): the generated title here.
        numberTitle: 'Sum of Amount',
        hasGroupableFields: false,
      });
      render(<Chart />);

      expect(screen.getByTestId('number-chart-value').textContent).toBe('card:1234.567');
      expect(format).toHaveBeenCalledWith(1234.567, 'card');
      expect(screen.getByTestId('number-chart-title').textContent).toBe('Sum of Amount');
    });

    it('prefers the custom title and drills down with it', () => {
      const onItemClick = jest.fn();

      mockContext = context({
        chartType: ChartType.Number,
        numberItem: item,
        seriesLabel: 'Sum of Amount',
        settings: { titleText: '  Revenue  ' } as ChartContextValue['settings'],
        // What `ChartProvider` resolves for that title (its own test covers the trim and the fallback).
        numberTitle: 'Revenue',
        onItemClick,
      });
      render(<Chart />);

      expect(screen.getByTestId('number-chart-title').textContent).toBe('Revenue');
      fireEvent.click(screen.getByTestId('number-chart-value'));
      expect(onItemClick).toHaveBeenCalledWith({ ...item, label: 'Revenue' });
    });

    it('shows its empty state, not a formatted zero, while there is no item', () => {
      mockContext = context({ chartType: ChartType.Number, numberItem: null, seriesLabel: 'Count all' });
      render(<Chart />);

      expect(screen.getByTestId('number-chart').getAttribute('data-empty')).toBe('true');
      expect(screen.queryByTestId('number-chart-value')).toBeNull();
    });
  });
});
