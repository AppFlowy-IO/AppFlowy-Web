import { act, fireEvent, render, screen } from '@testing-library/react';
import { ReactNode } from 'react';

import { ChartAggregationType, ChartType } from '@/application/database-yjs/chart.type';
import Chart from '@/components/database/chart/Chart';
import { ChartContextValue, DEFAULT_CHART_CONTEXT } from '@/components/database/chart/useChartContext';

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
    aggregationType: ChartAggregationType.Count,
    hasGroupableFields: true,
    isLoading: false,
    chartData: [{ key: 'a', label: 'A', value: 1, rowIds: ['r1'] }],
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
    mockContext = context({ chartType: ChartType.Donut, chartData: [] });
    render(<Chart />);

    expect(screen.getByTestId('chart-no-data')).toBeTruthy();
  });
});
