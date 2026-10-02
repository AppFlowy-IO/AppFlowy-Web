import { act, fireEvent, screen } from '@testing-library/react';

import { ChartAggregationType, ChartDataItem } from '@/application/database-yjs/chart.type';
import { NumberFormat } from '@/application/database-yjs/fields';
import BarChartWidget from '@/components/database/chart/widgets/BarChart';

import { firePointer, hoverCategory, installChartEnvironment, renderChart, texts } from './chartTestUtils';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const OWNERS: ChartDataItem[] = [
  { key: 'alice', label: 'Alice', value: 48500, rowIds: ['r1'], color: '#BF8EDA' },
  { key: 'bob', label: 'Bob', value: 1300000, rowIds: ['r2', 'r3'], color: '#DE9255' },
  { key: 'carol', label: 'Carol', value: 690000, rowIds: ['r4'], color: '#4FB9C9' },
];

const MARGINS: ChartDataItem[] = [
  { key: 'lead', label: 'Lead', value: 800, rowIds: ['r1'], color: '#5E9FE8' },
  { key: 'lost', label: 'Lost', value: -1500, rowIds: ['r2'], color: '#DF84A8' },
  { key: 'proposal', label: 'Proposal', value: 1200, rowIds: ['r3'], color: '#EAC26B' },
  { key: 'won', label: 'Won', value: 6.5, rowIds: ['r4'], color: '#72BC8F' },
];

const NUMBER_FIELD = { type: 'number' as const, numberFormat: NumberFormat.Num };

describe('BarChartWidget', () => {
  installChartEnvironment();

  it('renders the real Recharts component without an invalid hook call', () => {
    let container: HTMLElement | undefined;

    expect(() =>
      ({ container } = renderChart(
        <BarChartWidget data={[{ color: '#5E9FE8', label: 'In Progress', rowIds: ['row-1'], value: 1 }]} />
      ))
    ).not.toThrow();

    expect(screen.getByTestId('bar-chart-widget')).toBeTruthy();
    expect(container?.querySelector('.recharts-wrapper')).not.toBeNull();
    expect(container?.querySelector('.recharts-bar-rectangle')).not.toBeNull();
  });

  it('draws a measured value axis with nice compact ticks and no axis line', () => {
    const { container } = renderChart(<BarChartWidget data={OWNERS} />);

    expect(container.querySelector('.recharts-yAxis .recharts-cartesian-axis-line')).toBeNull();
    expect(texts(container, '[data-testid="chart-value-tick"]')).toEqual(['$0', '$500K', '$1M', '$1.5M']);
    // 6px per character: "$1.5M" is 30px, plus the 8px gap.
    const tick = container.querySelector('[data-testid="chart-value-tick"]') as SVGTextElement;

    expect(Number(tick.getAttribute('x'))).toBe(30);
    expect(tick.getAttribute('data-parity-id')).toBe('dash-chart-tick-label');
  });

  it('labels each bar with its compact value and keeps the bars thin', () => {
    const { container } = renderChart(<BarChartWidget data={OWNERS} />);
    const labels = Array.from(container.querySelectorAll('[data-testid="chart-data-label"]'));

    expect(labels.map((label) => [label.getAttribute('data-label'), label.textContent])).toEqual([
      ['Alice', '$48.5K'],
      ['Bob', '$1.3M'],
      ['Carol', '$690K'],
    ]);
    container.querySelectorAll('.recharts-bar-rectangle path').forEach((path) => {
      expect(Number(path.getAttribute('width'))).toBeLessThanOrEqual(16);
    });
    expect(container.querySelector('[data-parity-id="dash-chart-bar"]')).not.toBeNull();
  });

  it('draws a negative bar below the zero line', () => {
    const { container } = renderChart(<BarChartWidget data={MARGINS} />, { yField: NUMBER_FIELD });

    expect(texts(container, '[data-testid="chart-value-tick"]')).toEqual(['-2K', '-1K', '0', '1K', '2K']);
    const zero = container.querySelector('.recharts-reference-line line') as SVGLineElement;
    const zeroY = Number(zero.getAttribute('y1'));
    const paths = Array.from(container.querySelectorAll('.recharts-bar-rectangle path'));
    const lost = paths[1];
    const lead = paths[0];

    expect(Number(lost.getAttribute('y'))).toBeGreaterThanOrEqual(zeroY - 0.5);
    expect(Number(lead.getAttribute('y')) + Number(lead.getAttribute('height'))).toBeLessThanOrEqual(zeroY + 0.5);
    expect(texts(container, '[data-testid="chart-data-label"]')).toEqual(['800', '-1.5K', '1.2K', '6.5']);
  });

  it('hides the data labels when they are turned off', () => {
    const { container } = renderChart(<BarChartWidget data={OWNERS} />, { style: { showDataLabels: false } });

    expect(container.querySelector('[data-testid="chart-data-label"]')).toBeNull();
  });

  it('highlights the hovered category and shows the tooltip until the pointer leaves', () => {
    const onBarClick = jest.fn();
    const { container } = renderChart(<BarChartWidget data={OWNERS} onBarClick={onBarClick} />);

    act(() => hoverCategory(container, 1));

    const cursor = container.querySelector('.recharts-tooltip-cursor');

    expect(cursor).not.toBeNull();
    expect(cursor?.getAttribute('fill')).toBe('var(--chart-hover-band)');
    const tooltip = screen.getByTestId('chart-tooltip');

    expect(document.body.contains(tooltip)).toBe(true);
    expect(container.contains(tooltip)).toBe(false);
    expect(screen.getByTestId('chart-tooltip-name').textContent).toBe('Bob');
    expect(screen.getByTestId('chart-tooltip-value').textContent).toBe('$1,300,000');
    expect(screen.getByText('Click to view data')).toBeTruthy();

    act(() => {
      fireEvent.mouseLeave(screen.getByTestId('bar-chart-widget'));
    });
    expect(screen.queryByTestId('chart-tooltip')).toBeNull();
    expect(container.querySelector('.recharts-tooltip-cursor')).toBeNull();
  });

  it('drops the tooltip when the charted data changes', () => {
    const { container, rerenderChart } = renderChart(<BarChartWidget data={OWNERS} />);

    act(() => hoverCategory(container, 1));
    expect(screen.getByTestId('chart-tooltip')).toBeTruthy();

    rerenderChart(<BarChartWidget data={OWNERS.map((item) => (item.key === 'bob' ? { ...item, value: 2300000 } : item))} />);
    expect(screen.queryByTestId('chart-tooltip')).toBeNull();
  });

  it('opens the drill-down of the clicked category', () => {
    const onBarClick = jest.fn();
    const { container } = renderChart(<BarChartWidget data={OWNERS} onBarClick={onBarClick} />);

    act(() => hoverCategory(container, 2));
    const anchor = container.querySelectorAll('[data-testid="chart-category-anchor"]')[2] as SVGRectElement;

    act(() => {
      firePointer(
        container.querySelector('.recharts-wrapper') as HTMLElement,
        'click',
        Number(anchor.getAttribute('x')) + 5,
        200
      );
    });
    expect(onBarClick).toHaveBeenCalledWith(OWNERS[2]);
    // The click hides the tooltip before the drill-down opens.
    expect(screen.queryByTestId('chart-tooltip')).toBeNull();
  });

  it('lists every category in the accessibility table with its raw value and color', () => {
    const { container } = renderChart(<BarChartWidget data={OWNERS} />);
    const rows = Array.from(container.querySelectorAll('[data-testid="chart-data-table"] tr'));

    expect(rows.map((row) => [row.getAttribute('data-label'), row.getAttribute('data-value'), row.getAttribute('data-color')])).toEqual([
      ['Alice', '48500', '#BF8EDA'],
      ['Bob', '1300000', '#DE9255'],
      ['Carol', '690000', '#4FB9C9'],
    ]);
  });

  it('shows no legend for a single series under auto, and the categories when Bottom is picked', () => {
    const { rerenderChart } = renderChart(<BarChartWidget data={OWNERS} />);

    expect(screen.queryByTestId('chart-legend')).toBeNull();
    rerenderChart(<BarChartWidget data={OWNERS} />, { style: { legendPosition: 'bottom' } });
    expect(screen.getAllByTestId('chart-legend-item').map((item) => item.getAttribute('data-label'))).toEqual([
      'Alice',
      'Bob',
      'Carol',
    ]);
  });

  it('counts with whole-number ticks', () => {
    const { container } = renderChart(
      <BarChartWidget
        data={[
          { key: 'a', label: 'A', value: 2, rowIds: [] },
          { key: 'b', label: 'B', value: 5, rowIds: [] },
        ]}
      />,
      { aggregation: ChartAggregationType.Count, yField: null }
    );

    expect(texts(container, '[data-testid="chart-value-tick"]')).toEqual(['0', '2', '4', '6']);
  });
});
