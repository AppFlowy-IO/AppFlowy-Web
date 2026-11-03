import { act, screen } from '@testing-library/react';

import { CHART_ALL_SERIES_KEY, ChartAggregationType, ChartDataItem, ChartSeriesData } from '@/application/database-yjs/chart.type';
import LineChartWidget from '@/components/database/chart/widgets/LineChart';

import { hoverCategory, installChartEnvironment, renderChart, texts, seriesDataOf } from './chartTestUtils';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const MONTHS: ChartDataItem[] = [
  { key: 'm1', label: 'Jan 2026', value: 2, rowIds: ['a', 'b'] },
  { key: 'm2', label: 'Feb 2026', value: 5, rowIds: ['c', 'd', 'e', 'f', 'g'] },
  { key: 'm3', label: 'Mar 2026', value: 3, rowIds: ['h', 'i', 'j'] },
  { key: 'm4', label: 'Apr 2026', value: 2, rowIds: ['k', 'l'] },
];

const COUNT = { aggregation: ChartAggregationType.Count, yField: null, seriesLabel: 'Count all' };

describe('LineChartWidget', () => {
  installChartEnvironment();

  it('draws a smooth 1.5px line over a gradient area, without dots', () => {
    const { container } = renderChart(<LineChartWidget data={seriesDataOf(MONTHS)} fill />, COUNT);
    const curve = container.querySelector('.recharts-line-curve') as SVGPathElement;

    expect(curve.getAttribute('d')).toContain('C');
    expect(curve.getAttribute('stroke-width')).toBe('1.5');
    expect(curve.getAttribute('stroke')).toBe('#5E9FE8');
    const stops = Array.from(container.querySelectorAll('linearGradient stop'));

    expect(stops.map((stop) => stop.getAttribute('stop-opacity'))).toEqual(['0.2', '0']);
    // The area under the line is drawn and filled with that gradient.
    const area = container.querySelector('.recharts-area-area') as SVGPathElement;
    const gradient = container.querySelector('linearGradient') as SVGLinearGradientElement;

    expect(area.getAttribute('fill')).toBe(`url(#${gradient.id})`);
    expect(area.getAttribute('d')).toContain('C');
    // The gradient stops alone set the alpha: Recharts' default 0.6 area opacity would dim them.
    expect(area.getAttribute('fill-opacity')).toBe('1');
    // One line and one area carry the visual parity ids.
    expect(Array.from(container.querySelectorAll('[data-parity-id="dash-chart-line"]'))).toEqual([curve]);
    expect(Array.from(container.querySelectorAll('[data-parity-id="dash-chart-line-area"]'))).toEqual([area]);
    expect(container.querySelector('.recharts-dot')).toBeNull();
    expect(container.querySelector('.recharts-active-dot')).toBeNull();
  });

  it('shows one data point and the tooltip at the hovered month', () => {
    const { container } = renderChart(<LineChartWidget data={seriesDataOf(MONTHS)} fill />, COUNT);

    act(() => hoverCategory(container, 1));
    expect(container.querySelectorAll('.recharts-active-dot')).toHaveLength(1);
    expect(screen.getByTestId('chart-tooltip-name').textContent).toBe('Feb 2026');
    expect(screen.getByTestId('chart-tooltip-value').textContent).toBe('5');
    // The hover band covers the month's slot.
    expect(container.querySelector('.recharts-tooltip-cursor')?.getAttribute('fill')).toBe('var(--chart-hover-band)');
  });

  it('labels the points and lists the series in a line-glyph legend', () => {
    const { container } = renderChart(<LineChartWidget data={seriesDataOf(MONTHS)} fill />, COUNT);

    expect(texts(container, '[data-testid="chart-data-label"]')).toEqual(['2', '5', '3', '2']);
    const legend = screen.getByTestId('chart-legend');

    expect(legend.getAttribute('data-glyph')).toBe('line');
    expect(screen.getAllByTestId('chart-legend-item').map((item) => item.textContent)).toEqual(['Count all']);
  });

  it('follows the color theme and the style settings', () => {
    const { container } = renderChart(<LineChartWidget data={seriesDataOf(MONTHS)} fill />, {
      ...COUNT,
      style: { colorTheme: 'green', showDataLabels: false, legendPosition: 'off' },
    });

    expect(container.querySelector('.recharts-line-curve')?.getAttribute('stroke')).toBe('#72BC8F');
    expect(container.querySelector('[data-testid="chart-data-label"]')).toBeNull();
    expect(screen.queryByTestId('chart-legend')).toBeNull();
  });

  it('draws one line per group, without labels or area, and lists the groups', () => {
    const base = seriesDataOf(MONTHS);
    const color = (hex: string) => ({ kind: 'hex' as const, hex, alpha: 1 });
    const data: ChartSeriesData = {
      ...base,
      categories: base.categories.map((category) => ({ ...category, color: null })),
      series: [
        { key: 'biz', label: 'Business', color: color('#DE9255'), isEmpty: false, values: [1, 2, 0, 1], rowIds: [['a'], ['c', 'd'], [], ['k']] },
        { key: 'con', label: 'Consumers', color: color('#5E9FE8'), isEmpty: false, values: [1, 3, 3, 1], rowIds: [['b'], ['e', 'f', 'g'], ['h', 'i', 'j'], ['l']] },
        { key: '__empty__', label: 'No Audience', color: { kind: 'empty' }, isEmpty: true, values: [0, 0, 0, 0], rowIds: [[], [], [], []] },
      ],
    };

    expect(data.series.some((series) => series.key === CHART_ALL_SERIES_KEY)).toBe(false);
    const { container } = renderChart(<LineChartWidget data={data} fill />, COUNT);
    const lines = Array.from(container.querySelectorAll('.recharts-line-curve[data-testid="chart-line"]'));

    expect(lines).toHaveLength(3);
    expect(lines.map((line) => line.getAttribute('stroke'))).toEqual(['#DE9255', '#5E9FE8', '#F1F1EF']);
    expect(lines.map((line) => line.getAttribute('stroke-width'))).toEqual(['1.5', '1.5', '1.5']);
    expect(container.querySelector('[data-testid="chart-data-label"]')).toBeNull();
    expect(container.querySelector('linearGradient')).toBeNull();
    expect(container.querySelector('.recharts-area-area')).toBeNull();
    expect(screen.getByTestId('line-chart-widget').getAttribute('data-series-count')).toBe('3');
    expect(screen.getAllByTestId('chart-legend-item').map((item) => item.textContent)).toEqual([
      'Business',
      'Consumers',
      'No Audience',
    ]);
    act(() => hoverCategory(container, 1));
    expect(screen.getByTestId('chart-tooltip-title').textContent).toBe('Feb 2026');
    expect(screen.getAllByTestId('chart-tooltip-row').map((row) => row.textContent)).toEqual(['Business2', 'Consumers3']);
  });
});
